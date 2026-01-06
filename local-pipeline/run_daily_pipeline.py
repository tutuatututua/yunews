from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Tuple

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


def _summary_to_embedding_text(ticker: str, topic: str, summary: Dict[str, Any]) -> str:
    parts: List[str] = [f"Ticker: {ticker}", f"Topic: {topic}"]
    for key in ["bull_case", "bear_case", "risks"]:
        items = summary.get(key) or []
        if items:
            joined = "\n".join(f"- {x}" for x in items)
            parts.append(f"{key}:\n{joined}")
    return "\n\n".join(parts)


def main() -> None:
    configure_logging()
    settings = get_settings()

    db = SupabaseDB(url=settings.supabase_url, service_key=settings.supabase_service_key)

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
        hf_token=settings.hf_api_key,
        model_name=settings.hf_embedding_model,
        device=settings.embedding_device,
        max_length=settings.embedding_max_length,
    )

    # 1) Daily discovery
    queries = [
        YouTubeSearchQuery("stock market analysis"),
        YouTubeSearchQuery("earnings analysis"),
        YouTubeSearchQuery("investing commentary"),
    ]

    videos = youtube.discover_daily_videos(
        queries,
        lookback_hours=settings.discovery_lookback_hours,
        max_videos=settings.discovery_max_videos,
        language=settings.discovery_language,
    )

    run_started = datetime.now(timezone.utc)
    processed = 0
    skipped = 0
    no_transcript = 0

    for video in videos:
        db.upsert_video(video)

        if db.is_video_processed(video.video_id):
            logger.info("Skip already processed video_id=%s", video.video_id)
            skipped += 1
            continue

        logger.info("Processing video_id=%s title=%s", video.video_id, video.title)

        # 3) Transcript fetching
        entries = transcript.fetch_transcript(video.video_id, languages=["en"])
        if not entries:
            logger.info("Skipping video with missing transcript: %s", video.video_id)
            # Mark processed to remain idempotent and avoid daily re-tries.
            db.mark_video_processed(video.video_id)
            no_transcript += 1
            continue

        # 4) Time-based chunking
        chunks = chunker.chunk_by_time(video.video_id, entries)
        db.upsert_transcript_chunks(chunks)

        # 5-6) Ticker/topic extraction + chunk summary
        for c in chunks:
            extraction = extractor.extract(c.chunk_text)
            chunk_summary = summarizer.summarize_chunk(
                chunk_text=c.chunk_text,
                tickers=extraction.tickers,
                topics=list(extraction.topics),
            )
            db.upsert_chunk_analysis(
                video_id=video.video_id,
                chunk_index=c.chunk_index,
                tickers=extraction.tickers,
                topics=list(extraction.topics),
                chunk_summary=chunk_summary.model_dump(),
            )

        # 7) Aggregation: (video_id, ticker, topic)
        analysis_rows = db.list_chunk_analysis(video.video_id)

        grouped: Dict[Tuple[str, str], List[Dict[str, Any]]] = defaultdict(list)
        for row in analysis_rows:
            tickers = row.get("tickers") or []
            topics = row.get("topics") or []
            summary = row.get("chunk_summary") or {}

            # If the model didn't produce a ticker/topic, skip aggregation.
            for t in tickers:
                for topic in topics:
                    grouped[(str(t).upper(), str(topic))].append(summary)

        if not grouped:
            logger.info("No (ticker, topic) groups created for video_id=%s", video.video_id)
            db.mark_video_processed(video.video_id)
            processed += 1
            continue

        # 8) Embeddings per aggregated summary
        dimension = embedder.embedding_dimension()

        for (ticker, topic), items in grouped.items():
            aggregated = summarizer.aggregate(ticker=ticker, topic=topic, chunk_summaries=items)
            summary_id = db.upsert_aggregated_summary(
                video_id=video.video_id,
                ticker=ticker,
                topic=topic,
                aggregated_summary=aggregated.model_dump(),
            )

            embedding_text = _summary_to_embedding_text(ticker, topic, aggregated.model_dump())
            vector = embedder.embed_text(embedding_text)
            db.upsert_embedding(
                summary_id=summary_id,
                model=settings.hf_embedding_model,
                embedding=vector,
                dimension=dimension,
            )

        db.mark_video_processed(video.video_id)
        processed += 1

    # Store run metadata
    try:
        db.client.table("metadata").upsert(
            {
                "key": "last_run",
                "value": {
                    "started_at": run_started.isoformat(),
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "processed": processed,
                    "skipped": skipped,
                    "no_transcript": no_transcript,
                    "discovered": len(videos),
                },
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        ).execute()
    except Exception:
        logger.exception("Failed to write run metadata")

    logger.info(
        "Done. discovered=%s processed=%s skipped=%s no_transcript=%s",
        len(videos),
        processed,
        skipped,
        no_transcript,
    )


if __name__ == "__main__":
    main()
