from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.recommendations import is_recommendation_title
from app.db.supabase_client import SupabaseDB
from app.services.chunking_service import ChunkingService
from app.services.embedding_service import EmbeddingService
from app.services.summarization_service import SummarizationService
from app.services.ticker_topic_service import TickerTopicService
from app.services.transcript_service import TranscriptService
from app.services.youtube_service import YouTubeSearchQuery, YouTubeService

logger = logging.getLogger(__name__)


def _clip(text: str, n: int = 1200) -> str:
    s = str(text or "")
    if len(s) <= n:
        return s
    return s[:n] + "…"


def _keypoints_to_markdown(keypoints: dict[str, Any]) -> str:
    def _section(name: str, items: Any) -> str:
        lst = items if isinstance(items, list) else []
        bits = [str(x).strip() for x in lst if str(x).strip()]
        if not bits:
            return f"{name}:\n- (none)"
        return f"{name}:\n" + "\n".join(f"- {b}" for b in bits)

    return "\n\n".join(
        [
            _section("Positive", keypoints.get("positive")),
            _section("Negative", keypoints.get("negative")),
            _section("Neutral", keypoints.get("neutral")),
        ]
    ).strip()

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

        rag_docs_to_upsert: list[dict[str, Any]] = []

        aggregated_items_for_video: list[dict[str, Any]] = []

        # Aggregate ONCE per video (LLM), producing per-ticker aggregates.
        # This is much cheaper than calling the LLM once per ticker.
        agg_map = summarizer.aggregate_video_tickers(grouped_chunk_summaries=grouped)
        if not agg_map:
            logger.warning(f"aggregate_video_tickers returned empty for video_id={video.video_id}")
            break
        aggregated_by_ticker: dict[str, dict[str, Any]] = {t: a.model_dump() for t, a in agg_map.items()}

        # 8a) Upsert per-(video,ticker) semantic search docs
        ticker_jobs: list[dict[str, Any]] = []

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

            ticker_md = _keypoints_to_markdown(aggregated_keypoints)
            ticker_jobs.append(
                {
                    "document_type": "ticker_summary",
                    "video_id": video.video_id,
                    "ticker": ticker_u,
                    "source_key": "aggregate",
                    "video_title": video.title,
                    "thumbnail_url": video.thumbnail_url,
                    "summary_text": ticker_md,
                    "_embed_text": "\n\n".join(
                        [
                            f"Type: ticker_summary",
                            f"Ticker: {ticker_u}",
                            f"Video: {video.title}",
                            f"Channel: {video.channel}",
                            ticker_md,
                        ]
                    ).strip(),
                }
            )

        # Embed + store ticker_summary docs
        if ticker_jobs:
            try:
                embed_texts = [str(j.get("_embed_text") or " ") for j in ticker_jobs]
                vectors = embedder.embed_texts(embed_texts)
                if len(vectors) != len(ticker_jobs):
                    raise RuntimeError(f"Embedding batch size mismatch: got {len(vectors)} expected {len(ticker_jobs)}")

                for j, vec in zip(ticker_jobs, vectors, strict=False):
                    rag_docs_to_upsert.append(
                        {
                            "document_type": j["document_type"],
                            "video_id": j["video_id"],
                            "ticker": j.get("ticker") or "",
                            "source_key": j.get("source_key") or "",
                            "video_title": j.get("video_title"),
                            "thumbnail_url": j.get("thumbnail_url"),
                            "summary_text": j.get("summary_text") or "",
                            "model": settings.openai_embedding_model,
                            "dimension": dimension,
                            "embedding": vec,
                        }
                    )
            except Exception:
                logger.exception("Failed to embed/store ticker_summary rag documents for video_id=%s", video.video_id)


        # 8b) If the video title suggests explicit stock recommendations, store lightweight events.
        # This keeps Supabase usage low: we do NOT store price history, only the recommendation event.
        try:
            if is_recommendation_title(video.title):
                logger.info("!!!!!Video title suggests recommendation-style content; applying recommendation filters video_id=%s title=%s", video.video_id, video.title)
                def _count_keypoints(summary: Any, key: str) -> int:
                    if not isinstance(summary, dict):
                        return 0
                    raw = summary.get(key)
                    if not isinstance(raw, list):
                        return 0
                    return sum(1 for x in raw if str(x).strip())

                reco_candidates: list[str] = []
                for it in (aggregated_items_for_video or []):
                    if not isinstance(it, dict):
                        continue

                    ticker_u = str(it.get("ticker") or "").strip().upper()
                    if not ticker_u or ticker_u == "MARKET":
                        continue

                    summary = it.get("summary")
                    pos = _count_keypoints(summary, "positive")
                    neg = _count_keypoints(summary, "negative")

                    if pos > neg:
                        reco_candidates.append(ticker_u)
                        logger.info("Recommendation ticker passed filter (pos>neg): ticker=%s pos=%s neg=%s video_id=%s", ticker_u, pos, neg, video.video_id)
                    else:
                        logger.debug(
                            "Recommendation ticker filtered out (pos<=neg): ticker=%s pos=%s neg=%s video_id=%s",
                            ticker_u,
                            pos,
                            neg,
                            video.video_id,
                        )

                reco_tickers = sorted(set(reco_candidates))
                for sym in reco_tickers:
                    db.upsert_youtuber_recommendation(
                        video_id=video.video_id,
                        published_at=video.published_at,
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
                else:
                    logger.info(
                        "Recommendation-style video detected but no tickers passed filter (pos>neg): video_id=%s title=%s",
                        video.video_id,
                        video.title,
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
                    rag_docs_to_upsert.append(
                        {
                            "document_type": "video_summary",
                            "video_id": video.video_id,
                            "ticker": "",
                            "source_key": "overall",
                            "video_title": video.title,
                            "thumbnail_url": video.thumbnail_url,
                            "summary_text": summary_markdown,
                            "model": settings.openai_embedding_model,
                            "dimension": dimension,
                            "embedding": video_vector,
                        }
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

        # Flush all rag documents for this video (best-effort).
        if rag_docs_to_upsert:
            try:
                db.upsert_rag_documents(rag_docs_to_upsert)
            except Exception:
                logger.exception("Failed to upsert rag_documents for video_id=%s", video.video_id)

        db.mark_video_processed(video.video_id)
        processed += 1
        # Continue to next discovered video.

    # 10) Store an overall daily summary for the UI (optional table)
    try:
        # Keep the daily summary labeled by the current EST market date.
        est = timezone(timedelta(hours=-5))
        market_date = run_started.astimezone(est).date()

        summary_lookback_hours = max(settings.daily_summary_lookback_hours, 1)
        summary_start = (run_started - timedelta(hours=summary_lookback_hours)).isoformat()

        # Prefer the actual video publish timestamp for the daily summary input window.
        try:
            vs_resp = (
                db.client.table("video_summaries")
                .select(
                    "video_id,video_titles,published_at,overall_explanation,risks,opportunities,key_points,summarized_at"
                )
                .gte("published_at", summary_start)
                .order("published_at", desc=True)
                .limit(1000)
                .execute()
            )
        except Exception as exc:
            raise RuntimeError(f"Failed to query video_summaries for daily summary: {exc}") from exc
    
    
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
                        "sentiment": r.get("sentiment") or "",
                        "tickers": tickers_market_only,
                        "overall_explanation": r.get("overall_explanation") or "",
                        "risks": r.get("risks") or [],
                        "opportunities": r.get("opportunities") or [],
                        "key_points": r.get("key_points") or [],
                    }
                )

            daily = summarizer.summarize_daily_overall(market_date=market_date, video_items=video_items)

            if getattr(daily, "key_points", None):
                db.upsert_daily_summary(
                    market_date=market_date,
                    title=daily.title,
                    overall_summarize=getattr(daily, "overall_summarize", "") or "",
                    key_points=getattr(daily, "key_points", []) or [],
                    movers=[m.model_dump() for m in daily.movers],
                    risks=daily.risks,
                    opportunities=daily.opportunities,
                    sentiment=getattr(daily, "sentiment", None),
                    sentiment_score=getattr(daily, "sentiment_score", None),
                    sentiment_reason=getattr(daily, "sentiment_reason", "") or "",
                    model=f"llm:{settings.openai_chat_model}",
                )

                # Also embed the daily summary for chat/RAG retrieval.
                try:
                    dimension = embedder.embedding_dimension()
                    daily_embed_text = "\n\n".join(
                        [
                            "Type: daily_summary",
                            f"Market date: {market_date.isoformat()}",
                            f"Title: {daily.title}",
                            "Key points:\n" + "\n".join(
                                f"- {x}" for x in (getattr(daily, "key_points", None) or []) if str(x).strip()
                            ),
                        ]
                    ).strip()
                    daily_vector = embedder.embed_text(daily_embed_text)

                    # Note: daily summaries aren't tied to a specific YouTube video.
                    # We store them in rag_documents with a synthetic video_id.
                    db.upsert_rag_documents(
                        [
                            {
                                "document_type": "daily_summary",
                                "video_id": f"daily:{market_date.isoformat()}",
                                "ticker": "",
                                "source_key": market_date.isoformat(),
                                "video_title": f"Daily Summary {market_date.isoformat()}",
                                "thumbnail_url": None,
                                "summary_text": "\n".join(
                                    f"- {x}" for x in (getattr(daily, "key_points", None) or []) if str(x).strip()
                                ).strip(),
                                "model": settings.openai_embedding_model,
                                "dimension": dimension,
                                "embedding": daily_vector,
                            }
                        ]
                    )
                except Exception:
                    logger.exception("Failed to embed/store daily_summary rag document")
            else:
                logger.info("Daily summary key_points empty; skipping daily_summary upsert")
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
