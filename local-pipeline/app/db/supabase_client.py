from __future__ import annotations

import logging
from datetime import date
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, cast

from supabase import Client, create_client

from app.models.schemas import TranscriptChunk, VideoMetadata

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
        payload = {
            "video_id": video.video_id,
            "title": video.title,
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

    def upsert_transcript_chunks(self, chunks: List[TranscriptChunk]) -> None:
        if not chunks:
            return

        payload = [
            {
                "video_id": c.video_id,
                "chunk_index": c.chunk_index,
                "chunk_start_time": c.chunk_start_time,
                "chunk_end_time": c.chunk_end_time,
                "chunk_text": c.chunk_text,
            }
            for c in chunks
        ]

        # `transcript_chunks` is keyed by (video_id, chunk_index). Target that key to make reruns idempotent.
        self._client.table("transcript_chunks").upsert(
            payload,
            on_conflict="video_id,chunk_index",
        ).execute()

    def upsert_chunk_analysis(
        self,
        *,
        video_id: str,
        chunk_index: int,
        ticker: str,
        chunk_summary: Dict[str, Any],
    ) -> None:
        payload = {
            "video_id": video_id,
            "chunk_index": chunk_index,
            "ticker": ticker,
            "chunk_summary": chunk_summary,
        }
        self._client.table("chunk_analysis").upsert(
            payload,
            on_conflict="video_id,chunk_index,ticker",
        ).execute()

    def list_chunk_analysis(self, video_id: str) -> List[Dict[str, Any]]:
        resp = self._client.table("chunk_analysis").select("*").eq("video_id", video_id).execute()
        return resp.data or []

    def upsert_aggregated_summary(
        self,
        *,
        video_id: str,
        published_at: datetime | None = None,
        ticker: str,
        aggregated_summary: Dict[str, Any],
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
        embedding: List[float],
        dimension: int,
    ) -> None:
        if len(embedding) != dimension:
            raise ValueError(f"Embedding dimension mismatch: got {len(embedding)} expected {dimension}")

        payload = {
            "summary_id": summary_id,
            "model": model,
            "dimension": dimension,
            "embedding": embedding,
        }
        self._client.table("embeddings").upsert(payload, on_conflict="summary_id,model").execute()

    def upsert_video_summary(
        self,
        *,
        video_id: str,
        video_titles: str,
        published_at: datetime | None = None,
        summary_markdown: str,
        overall_explanation: str = "",
        movers: List[Dict[str, Any]] | None = None,
        risks: List[str] | None = None,
        opportunities: List[str] | None = None,
        key_points: List[str],
        tickers: List[str],
        sentiment: str | None,
        events: List[Dict[str, Any]] | None = None,
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
            "tickers": tickers,
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
        summary_markdown: str,
        movers: List[Dict[str, Any]],
        risks: List[str],
        opportunities: List[str],
        model: str,
        generated_at: str | None = None,
    ) -> None:
        payload = {
            "market_date": market_date.isoformat(),
            "title": title,
            "overall_summarize": overall_summarize or "",
            "summary_markdown": summary_markdown,
            "movers": movers,
            "risks": risks,
            "opportunities": opportunities,
            "model": model,
            "generated_at": generated_at or datetime.now(timezone.utc).isoformat(),
        }
        # Backward compatibility: older schemas may not have newer columns.
        # Some clients only report one missing column per failure, so retry until stable.
        candidate_cols = ("overall_summarize", "movers", "risks", "opportunities", "generated_at")
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
        embedding: List[float],
        dimension: int,
    ) -> None:
        """Upsert embedding for overall per-video summary.

        Stored in `video_summary_embeddings` (separate from per-(video,ticker) `summaries`).
        """

        if len(embedding) != dimension:
            raise ValueError(f"Embedding dimension mismatch: got {len(embedding)} expected {dimension}")

        payload = {
            "video_id": video_id,
            "published_at": published_at.isoformat() if published_at else None,
            "model": model,
            "dimension": dimension,
            "embedding": embedding,
        }

        if payload["published_at"] is None:
            payload.pop("published_at", None)

        # NOTE: table may not exist in older DBs; caller may catch and continue.
        try:
            self._client.table("video_summary_embeddings").upsert(payload, on_conflict="video_id,model").execute()
        except Exception as exc:
            # Backward compatibility: older schemas may not have published_at.
            msg = str(exc)
            if "published_at" in msg and ("does not exist" in msg or "column" in msg):
                payload.pop("published_at", None)
                self._client.table("video_summary_embeddings").upsert(payload, on_conflict="video_id,model").execute()
                return
            raise
