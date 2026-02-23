from __future__ import annotations

import logging
import re
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.db.supabase_client import SupabaseDB
from app.services.chunking_service import ChunkingService
from app.services.embedding_service import EmbeddingService
from app.services.summarization_service import SummarizationService
from app.services.ticker_topic_service import TickerTopicService
from app.services.transcript_service import TranscriptService
from app.services.youtube_service import YouTubeSearchQuery, YouTubeService

logger = logging.getLogger(__name__)


_RECO_TITLE_RE = re.compile(
    r"\b(recommend(?:ation)?|recomend(?:ation)?|buy(?:ing)?|stock\s+picks?|picks?|top\s+stocks?|best\s+stocks?)\b",
    re.IGNORECASE,
)
_RECO_TITLE_EXCLUDE_RE = re.compile(r"\b(don't\s+buy|do\s+not\s+buy|sell|short|avoid)\b", re.IGNORECASE)


def _is_recommendation_title(title: str | None) -> bool:
    t = str(title or "").strip()
    if not t:
        return False
    if _RECO_TITLE_EXCLUDE_RE.search(t):
        return False
    return _RECO_TITLE_RE.search(t) is not None

def main() -> None:
    configure_logging()
    settings = get_settings()

    db = SupabaseDB(url=settings.supabase_url, service_key=settings.supabase_key)

    youtube = YouTubeService(api_key=settings.youtube_api_key)
    transcript = TranscriptService()
    chunker = ChunkingService(window_seconds=settings.chunk_window_seconds)

    extractor = TickerTopicService(
        openai_api_key=settings.openai_api_key,
        model=settings.openai_chat_model,
        temperature=settings.llm_temperature,
    )
    summarizer = SummarizationService(
        openai_api_key=settings.openai_api_key,
        model=settings.openai_chat_model,
        temperature=settings.llm_temperature,
    )

    embedder = EmbeddingService(
        openai_api_key=settings.openai_api_key,
        model=settings.openai_embedding_model,
    )

    # 1) Daily discovery
    queries = [
        YouTubeSearchQuery(q.strip())
        for q in settings.pipeline_search_query.split(",")
        if q.strip()
    ]

    videos = youtube.discover_daily_videos(
        queries,
        lookback_hours=settings.discovery_lookback_hours,
        max_videos=settings.discovery_max_videos,
        language=settings.discovery_language,
        region_code=settings.pipeline_region_code,
        min_duration_seconds=settings.pipeline_min_duration_seconds,
        max_duration_seconds=settings.pipeline_max_duration_seconds,
    )
    logger.info("Discovered video_ids=%s", [video.video_id for video in videos])

    run_started = datetime.now(timezone.utc)
    processed = 0
    skipped = 0
    no_transcript = 0

    for video in videos:
        if db.is_video_processed(video.video_id):
            logger.info("Skip already processed video_id=%s", video.video_id)
            skipped += 1
            continue

        logger.info("Processing video_id=%s title=%s", video.video_id, video.title)

        # 3) Transcript fetching
        entries = transcript.fetch_transcript(video.video_id, languages=[settings.discovery_language])
        if not entries:
            logger.info("Skipping video with missing transcript: %s", video.video_id)
            # Mark processed to remain idempotent and avoid daily re-tries.
            db.mark_video_processed(video.video_id)
            no_transcript += 1
            continue

        # Only persist the video if we're actually going to process it.
        # This avoids inserting non-English/unsupported videos that lack an English transcript.
        db.upsert_video(video)

        # 4) Time-based chunking
        chunks = chunker.chunk_by_time(video.video_id, entries)

        # 5) Extract tickers from EACH chunk with categorized keypoints
        # Note: We aggregate in-memory to avoid persisting per-chunk rows in Supabase.
        total_extractions = 0
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for chunk in chunks:
            chunk_extraction = extractor.extract(chunk.chunk_text)
            if not chunk_extraction.ticker_topic_pairs:
                logger.debug("No tickers in chunk %d for video_id=%s", chunk.chunk_index, video.video_id)
                continue

            # Filter out invalid pairs
            valid_pairs = [pair for pair in chunk_extraction.ticker_topic_pairs if pair.ticker]
            if not valid_pairs:
                continue

            logger.debug(
                "Chunk %d: extracted %d tickers with keypoints",
                chunk.chunk_index,
                len(valid_pairs),
            )

            for pair in valid_pairs:
                ticker_u = str(pair.ticker).strip().upper()
                if not ticker_u:
                    continue

                keypoints = {
                    "positive": pair.positive_keypoints,
                    "negative": pair.negative_keypoints,
                    "neutral": pair.neutral_keypoints,
                }

                grouped[ticker_u].append(keypoints)
                total_extractions += 1

        if total_extractions == 0:
            logger.info("No tickers extracted from any chunk for video_id=%s, skipping", video.video_id)
            db.mark_video_processed(video.video_id)
            processed += 1
            continue

        logger.info(
            "Extracted %d total tickers across all chunks for video_id=%s",
            total_extractions,
            video.video_id
        )

        if not grouped:
            logger.info("No ticker groups created for video_id=%s", video.video_id)
            db.mark_video_processed(video.video_id)
            processed += 1
            continue

        # 8) Aggregate keypoints and create embeddings
        dimension = embedder.embedding_dimension()

        aggregated_items_for_video: list[dict[str, Any]] = []

        # Aggregate ONCE per video (LLM), producing per-ticker aggregates.
        # This is much cheaper than calling the LLM once per ticker.
        agg_map = summarizer.aggregate_video_tickers(grouped_chunk_summaries=grouped)
        if not agg_map:
            raise RuntimeError(f"aggregate_video_tickers returned empty for video_id={video.video_id}")
        aggregated_by_ticker: dict[str, dict[str, Any]] = {t: a.model_dump() for t, a in agg_map.items()}

        for ticker, keypoints_list in grouped.items():
            ticker_u = str(ticker).strip().upper()

            aggregated_keypoints = aggregated_by_ticker.get(ticker_u)
            if not aggregated_keypoints:
                logger.info(
                    "Missing LLM aggregated keypoints; skipping aggregated summary ticker=%s video_id=%s",
                    ticker_u,
                    video.video_id,
                )
                continue

            aggregated_items_for_video.append(
                {
                    "ticker": ticker_u,
                    "summary": aggregated_keypoints,
                }
            )

            db.upsert_aggregated_summary(
                video_id=video.video_id,
                published_at=video.published_at,
                ticker=ticker_u,
                aggregated_summary=aggregated_keypoints,
            )

        # 8b) If the video title suggests explicit stock recommendations, store lightweight events.
        # This keeps Supabase usage low: we do NOT store price history, only the recommendation event.
        try:
            if _is_recommendation_title(video.title):
                reco_tickers = sorted(
                    {
                        str(it.get("ticker")).strip().upper()
                        for it in (aggregated_items_for_video or [])
                        if isinstance(it, dict) and it.get("ticker")
                    }
                )
                reco_tickers = [t for t in reco_tickers if t and t != "MARKET"]
                for sym in reco_tickers:
                    db.upsert_youtuber_recommendation(
                        video_id=video.video_id,
                        ticker=sym,
                        action="buy",
                        source="title",
                    )
                if reco_tickers:
                    logger.info(
                        "Stored %d youtuber recommendations for video_id=%s",
                        len(reco_tickers),
                        video.video_id,
                    )
        except Exception:
            logger.exception("Failed to upsert youtuber recommendations")

        # 9) Store an overall per-video summary for the UI (optional table)
        try:
            # Cheaper overall summary: use already-generated aggregated summaries.
            overall = summarizer.summarize_video_overall_from_aggregates(
                title=video.title,
                channel=video.channel,
                aggregated_items=aggregated_items_for_video,
            )

            if overall.summary_markdown.strip():
                summary_markdown = overall.summary_markdown
                key_points = overall.key_points
                derived_tickers = [
                    str(x.get("ticker")).strip().upper()
                    for x in (aggregated_items_for_video or [])
                    if isinstance(x, dict) and x.get("ticker")
                ]
                tickers = sorted({t.strip().upper() for t in (overall.tickers or derived_tickers) if t and t.strip()})
                sentiment = overall.sentiment
                events = [e.model_dump() for e in (overall.events or [])]
                movers = [m.model_dump() for m in (getattr(overall, "movers", None) or [])]

                db.upsert_video_summary(
                    video_id=video.video_id,
                    video_titles=video.title,
                    published_at=video.published_at,
                    summary_markdown=summary_markdown,
                    overall_explanation=overall.overall_explanation,
                    movers=movers,
                    risks=overall.risks,
                    opportunities=overall.opportunities,
                    key_points=key_points,
                    sentiment=sentiment,
                    events=events,
                    model=f"llm:{settings.openai_chat_model}",
                )

                # Embed the overall per-video summary (for semantic search over videos).
                try:
                    video_embed_text = "\n\n".join(
                        [
                            f"Title: {video.title}",
                            f"Channel: {video.channel}",
                            f"Published at: {video.published_at}",
                            f"overall_explanation: {overall.overall_explanation}",
                            "Opportunities:\n"
                            + "\n".join(f"- {x}" for x in (overall.opportunities or []) if str(x).strip()),
                            "Risks:\n" + "\n".join(f"- {x}" for x in (overall.risks or []) if str(x).strip()),
                            "Events:\n"
                            + "\n".join(
                                f"- {e.description} ({e.date or e.timeframe or 'unspecified'})"
                                for e in (overall.events or [])
                                if getattr(e, "description", "") and str(getattr(e, "description", "")).strip()
                            ),
                            f"Tickers: {', '.join(tickers) if tickers else '(none)'}",
                            "Key points:\n" + "\n".join(f"- {x}" for x in key_points if str(x).strip()),
                            "Summary:\n" + summary_markdown,
                        ]
                    ).strip()
                    video_vector = embedder.embed_text(video_embed_text)
                    db.upsert_video_summary_embedding(
                        video_id=video.video_id,
                        published_at=video.published_at,
                        model=settings.openai_embedding_model,
                        embedding=video_vector,
                        dimension=dimension,
                    )
                except Exception:
                    logger.exception("Failed to embed/store video summary embedding")
            else:
                logger.info(
                    "Overall video summary markdown empty; skipping video_summary upsert video_id=%s",
                    video.video_id,
                )
        except Exception:
            logger.exception("Failed to store video summary")

        db.mark_video_processed(video.video_id)
        processed += 1
        # Continue to next discovered video.

    # 10) Store an overall daily summary for the UI (optional table)
    try:
        # Use a fixed EST day boundary (UTC-5) for the daily summary window.
        # This avoids the UTC day rollover making the "daily" summary feel like the wrong day.
        est = timezone(timedelta(hours=-5))
        market_date = run_started.astimezone(est).date()

        start_local = datetime(market_date.year, market_date.month, market_date.day, 0, 0, 0, tzinfo=est)
        end_local = datetime(market_date.year, market_date.month, market_date.day, 23, 59, 59, tzinfo=est)
        start = start_local.astimezone(timezone.utc).isoformat()
        end = end_local.astimezone(timezone.utc).isoformat()

        # Prefer LLM daily summary from per-video summaries (or fall back to derived from aggregated summaries).
        # Run-based ("what we processed today"): filter by summarized_at within the EST day window.
        vs_resp = (
            db.client.table("video_summaries")
            .select(
                "video_id,video_titles,published_at,overall_explanation,risks,opportunities,key_points,summarized_at"
            )
            .gte("summarized_at", start)
            .lte("summarized_at", end)
            .order("summarized_at", desc=True)
            .limit(1000)
            .execute()
        )
        raw_items = [r for r in (vs_resp.data or []) if isinstance(r, dict)]
        video_ids: list[str] = [str(r.get("video_id")) for r in raw_items if r.get("video_id")]
        if raw_items:

            market_video_ids: set[str] = set()
            if video_ids:
                try:
                    m_resp = (
                        db.client.table("summaries")
                        .select("video_id")
                        .in_("video_id", video_ids)
                        .eq("ticker", "MARKET")
                        .limit(5000)
                        .execute()
                    )
                    market_video_ids = {
                        str(r.get("video_id"))
                        for r in (m_resp.data or [])
                        if isinstance(r, dict) and r.get("video_id")
                    }
                except Exception:
                    market_video_ids = set()

            # Keep the daily prompt inputs small: only pass the fields the prompt expects.
            video_items: list[dict[str, Any]] = []
            for r in raw_items:
                vid = str(r.get("video_id") or "")
                tickers_market_only = ["MARKET"] if vid and vid in market_video_ids else []
                video_items.append(
                    {
                        "title": r.get("video_titles") or "",
                        "tickers": tickers_market_only,
                        "overall_explanation": r.get("overall_explanation") or "",
                        "risks": r.get("risks") or [],
                        "opportunities": r.get("opportunities") or [],
                        "key_points": r.get("key_points") or [],
                    }
                )

            daily = summarizer.summarize_daily_overall(market_date=market_date, video_items=video_items)

            if daily.summary_markdown.strip():
                db.upsert_daily_summary(
                    market_date=market_date,
                    title=daily.title,
                    overall_summarize=getattr(daily, "overall_summarize", "") or "",
                    summary_markdown=daily.summary_markdown,
                    movers=[m.model_dump() for m in daily.movers],
                    risks=daily.risks,
                    opportunities=daily.opportunities,
                    sentiment=getattr(daily, "sentiment", None),
                    sentiment_score=getattr(daily, "sentiment_score", None),
                    sentiment_reason=getattr(daily, "sentiment_reason", "") or "",
                    model=f"llm:{settings.openai_chat_model}",
                )
            else:
                logger.info("Daily summary markdown empty; skipping daily_summary upsert")
    except Exception:
        logger.exception("Failed to store daily summary")

    logger.info(
        "Done. discovered=%s processed=%s skipped=%s no_transcript=%s",
        len(videos),
        processed,
        skipped,
        no_transcript,
    )


if __name__ == "__main__":
    main()
