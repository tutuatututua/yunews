from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

from supabase import Client, create_client

from app.models.schemas import VideoMetadata

logger = logging.getLogger(__name__)


class SupabaseDB:
    """Thin DB wrapper for idempotent inserts and lookups."""

    def __init__(self, *, url: str, service_key: str) -> None:
        self._client: Client = create_client(url, service_key)

    @property
    def client(self) -> Client:
        return self._client

    def is_video_processed(self, video_id: str) -> bool:
        resp = (
            self._client.table("video_summaries")
            .select("video_id, summarized_at")
            .eq("video_id", video_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return False
        return rows[0].get("summarized_at") is not None

    def upsert_video(self, video: VideoMetadata) -> None:
        title = video.title.replace("&#39;", "'")
        payload = {
            "video_id": video.video_id,
            "title": title,
            "channel": video.channel,
            "published_at": video.published_at.isoformat(),
            "description": video.description,
            "duration_seconds": video.duration_seconds,
            "video_url": video.video_url,
            "thumbnail_url": video.thumbnail_url,
            "view_count": video.view_count,
            "like_count": video.like_count,
            "comment_count": video.comment_count,
            "tags": video.tags,
            "category_id": video.category_id,
            "default_language": video.default_language,
            "default_audio_language": video.default_audio_language,
            "channel_subscriber_count": video.channel_subscriber_count,
            "channel_video_count": video.channel_video_count,
            "discovered_at": datetime.now(timezone.utc).isoformat(),
        }
        self._client.table("videos").upsert(payload).execute()

    def mark_video_processed(self, video_id: str) -> None:
        self._client.table("videos").update({"processed_at": datetime.now(timezone.utc).isoformat()}).eq(
            "video_id", video_id
        ).execute()

    def upsert_aggregated_summary(
        self,
        *,
        video_id: str,
        published_at: datetime | None = None,
        ticker: str,
        aggregated_summary: dict[str, Any],
    ) -> int:
        """Upsert and return summary_id."""

        payload = {
            "video_id": video_id,
            "published_at": published_at.isoformat() if published_at else None,
            "ticker": ticker,
            "summary": aggregated_summary,
        }

        # Keep payload clean (avoid storing explicit NULL unless caller passes it).
        if payload["published_at"] is None:
            payload.pop("published_at", None)

        try:
            resp = self._client.table("summaries").upsert(
                payload,
                on_conflict="video_id,ticker",
            ).execute()
        except Exception as exc:
            # Backward compatibility: older schemas may not have published_at.
            msg = str(exc)
            if "published_at" in msg and ("does not exist" in msg or "column" in msg):
                payload.pop("published_at", None)
                resp = self._client.table("summaries").upsert(
                    payload,
                    on_conflict="video_id,ticker",
                ).execute()
            else:
                raise
        rows = resp.data or []
        if not rows:
            # If Supabase doesn't return rows, fetch the id.
            fetch = (
                self._client.table("summaries")
                .select("id")
                .eq("video_id", video_id)
                .eq("ticker", ticker)
                .limit(1)
                .execute()
            )
            fetched = fetch.data or []
            if not fetched:
                raise RuntimeError("Failed to upsert summary")
            return int(fetched[0]["id"])

        return int(rows[0]["id"])

    def upsert_embedding(
        self,
        *,
        summary_id: int,
        model: str,
        embedding: list[float],
        dimension: int,
    ) -> None:
        raise NotImplementedError(
            "This project uses `rag_documents` as the canonical embedding store. "
            "Use upsert_rag_documents(...) instead."
        )

    def upsert_rag_documents(self, docs: list[dict[str, Any]]) -> None:
        """Upsert semantic-search documents into `rag_documents`.

                Expected keys per doc:
                - document_type, video_id, ticker, source_key, video_title, thumbnail_url,
                    summary_text, model, dimension, embedding

                Backward compatibility:
                - If the Supabase table (or PostgREST schema cache) does not expose a
                    `model` column, we retry without it.
        """

        if not docs:
            return

        # Supabase can reject very large payloads; keep batches reasonably small.
        batch_size = 200
        for i in range(0, len(docs), batch_size):
            batch = docs[i : i + batch_size]
            try:
                self._client.table("rag_documents").upsert(
                    batch,
                    on_conflict="document_type,video_id,ticker,source_key,model",
                ).execute()
            except Exception as exc:
                msg = str(exc)
                if "Could not find the 'model' column" in msg and "rag_documents" in msg:
                    logger.warning(
                        "Supabase rag_documents is missing `model` column (or schema cache is stale). "
                        "Retrying rag_documents upsert without model. Error=%s",
                        msg,
                    )
                    fallback_batch = [{k: v for k, v in d.items() if k != "model"} for d in batch]
                    self._client.table("rag_documents").upsert(
                        fallback_batch,
                        on_conflict="document_type,video_id,ticker,source_key",
                    ).execute()
                else:
                    raise

    def upsert_video_summary(
        self,
        *,
        video_id: str,
        video_titles: str,
        published_at: datetime | None = None,
        summary_markdown: str,
        overall_explanation: str = "",
        movers: list[dict[str, Any]] | None = None,
        risks: list[str] | None = None,
        opportunities: list[str] | None = None,
        key_points: list[str],
        sentiment: str | None,
        events: list[dict[str, Any]] | None = None,
        model: str,
        summarized_at: str | None = None,
    ) -> None:
        payload = {
            "video_id": video_id,
            "video_titles": video_titles,
            "published_at": published_at.isoformat() if published_at else None,
            "summary_markdown": summary_markdown,
            "overall_explanation": overall_explanation,
            "movers": movers or [],
            "risks": risks or [],
            "opportunities": opportunities or [],
            "key_points": key_points,
            "sentiment": sentiment,
            "events": events or [],
            "model": model,
            "summarized_at": summarized_at or datetime.now(timezone.utc).isoformat(),
        }

        if payload["published_at"] is None:
            payload.pop("published_at", None)
        try:
            self._client.table("video_summaries").upsert(payload, on_conflict="video_id").execute()
        except Exception as exc:
            # Backward compatibility: older schemas may not have newer columns.
            msg = str(exc)
            removed_any = False
            if "overall_explanation" in msg and ("does not exist" in msg or "column" in msg):
                payload.pop("overall_explanation", None)
                removed_any = True
            if "movers" in msg and ("does not exist" in msg or "column" in msg):
                payload.pop("movers", None)
                removed_any = True
            if "risks" in msg and ("does not exist" in msg or "column" in msg):
                payload.pop("risks", None)
                removed_any = True
            if "opportunities" in msg and ("does not exist" in msg or "column" in msg):
                payload.pop("opportunities", None)
                removed_any = True
            if "events" in msg and ("does not exist" in msg or "column" in msg):
                payload.pop("events", None)
                removed_any = True
            if "published_at" in msg and ("does not exist" in msg or "column" in msg):
                payload.pop("published_at", None)
                removed_any = True
            if removed_any:
                self._client.table("video_summaries").upsert(payload, on_conflict="video_id").execute()
                return
            raise

    def upsert_daily_summary(
        self,
        *,
        market_date: date,
        title: str,
        overall_summarize: str | None = None,
        key_points: list[str],
        movers: list[dict[str, Any]],
        risks: list[str],
        opportunities: list[str],
        sentiment: str | None = None,
        sentiment_score: float | None = None,
        sentiment_reason: str | None = None,
        model: str,
        generated_at: str | None = None,
    ) -> None:
        payload = {
            "market_date": market_date.isoformat(),
            "title": title,
            "overall_summarize": overall_summarize or "",
            "key_points": key_points,
            "movers": movers,
            "risks": risks,
            "opportunities": opportunities,
            "sentiment": sentiment,
            "sentiment_score": sentiment_score,
            "sentiment_reason": sentiment_reason or "",
            "model": model,
            "generated_at": generated_at or datetime.now(timezone.utc).isoformat(),
        }
        # Backward compatibility: older schemas may not have newer columns.
        # Some clients only report one missing column per failure, so retry until stable.
        candidate_cols = (
            "overall_summarize",
            "movers",
            "risks",
            "opportunities",
            "sentiment",
            "sentiment_score",
            "sentiment_reason",
            "generated_at",
        )
        while True:
            try:
                self._client.table("daily_summaries").upsert(payload, on_conflict="market_date").execute()
                return
            except Exception as exc:
                msg = str(exc)
                removed_any = False
                for col in candidate_cols:
                    if col in payload and col in msg and ("does not exist" in msg or "column" in msg):
                        payload.pop(col, None)
                        removed_any = True

                if removed_any:
                    continue
                raise

    def upsert_video_summary_embedding(
        self,
        *,
        video_id: str,
        published_at: datetime | None = None,
        model: str,
        embedding: list[float],
        dimension: int,
    ) -> None:
        raise NotImplementedError(
            "This project uses `rag_documents` as the canonical embedding store. "
            "Store video-level embeddings as a rag_documents row of type `video_summary`."
        )

    def upsert_youtuber_recommendation(
        self,
        *,
        video_id: str,
        published_at: datetime | None = None,
        ticker: str,
        action: str = "buy",
        source: str | None = "title",
    ) -> None:
        """Upsert a lightweight recommendation event.

        This is intentionally small to minimize Supabase storage: we store only
        (video_id, ticker, action) and join against `videos` for metadata.

        If the table isn't present (older schema), this becomes a safe no-op.
        """

        sym = str(ticker or "").strip().upper()
        if not sym:
            return

        payload: dict[str, Any] = {
            "video_id": str(video_id),
            "published_at": published_at.isoformat() if published_at else None,
            "ticker": sym,
            "action": str(action or "buy").strip().lower() or "buy",
            "source": source,
        }

        if payload["published_at"] is None:
            payload.pop("published_at", None)

        try:
            self._client.table("youtuber_recommendations").upsert(
                payload,
                on_conflict="video_id,ticker,action",
            ).execute()
        except Exception as exc:
            # Backward compatibility: older DBs may not have this table/columns.
            msg = str(exc)
            if "youtuber_recommendations" in msg and (
                "does not exist" in msg or "relation" in msg or "404" in msg
            ):
                logger.debug("youtuber_recommendations table missing; skipping upsert")
                return
            if "published_at" in msg and ("does not exist" in msg or "column" in msg):
                payload.pop("published_at", None)
                self._client.table("youtuber_recommendations").upsert(
                    payload,
                    on_conflict="video_id,ticker,action",
                ).execute()
                return
            if "source" in msg and ("does not exist" in msg or "column" in msg):
                payload.pop("source", None)
                self._client.table("youtuber_recommendations").upsert(
                    payload,
                    on_conflict="video_id,ticker,action",
                ).execute()
                return
            raise
