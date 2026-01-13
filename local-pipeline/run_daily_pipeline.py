from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
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


def _aggregate_keypoints(keypoints_list: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Aggregate keypoints from multiple chunks into a single structure."""
    positive = []
    negative = []
    neutral = []
    
    for kp_dict in keypoints_list:
        if not isinstance(kp_dict, dict):
            continue
        
        # Add unique keypoints to each category
        for kp in kp_dict.get("positive", []):
            if kp and kp not in positive:
                positive.append(kp)
        for kp in kp_dict.get("negative", []):
            if kp and kp not in negative:
                negative.append(kp)
        for kp in kp_dict.get("neutral", []):
            if kp and kp not in neutral:
                neutral.append(kp)
    
    return {
        "positive": positive[:10],  # Limit to top 10 per category
        "negative": negative[:10],
        "neutral": neutral[:10],
    }


def _summary_to_embedding_text(ticker: str, summary: Dict[str, Any]) -> str:
    parts: List[str] = [f"Ticker: {ticker}"]
    
    # Handle both old (bull_case, bear_case, risks) and new (positive, negative, neutral) formats
    if "positive" in summary or "negative" in summary or "neutral" in summary:
        # New keypoints format
        for key in ["positive", "negative", "neutral"]:
            items = summary.get(key) or []
            if items:
                joined = "\n".join(f"- {x}" for x in items)
                parts.append(f"{key}_keypoints:\n{joined}")
    else:
        # Old summary format (backward compatibility)
        for key in ["bull_case", "bear_case", "risks"]:
            items = summary.get(key) or []
            if items:
                joined = "\n".join(f"- {x}" for x in items)
                parts.append(f"{key}:\n{joined}")
    
    return "\n\n".join(parts)


def _derive_video_summary(*, video_id: str, summary_rows: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    """Create a lightweight per-video summary from aggregated (ticker) rows."""

    rows = [r for r in (summary_rows or []) if isinstance(r, dict)]
    if not rows:
        return None

    tickers = sorted({(r.get("ticker") or "").strip().upper() for r in rows if r.get("ticker")})

    key_points: List[str] = []
    opportunities: List[str] = []
    risks: List[str] = []
    md_lines: List[str] = []

    def _add_unique(target: List[str], items: Any, max_items: int) -> None:
        if not isinstance(items, list):
            return
        for x in items:
            if len(target) >= max_items:
                return
            sx = str(x).strip()
            if not sx:
                continue
            if sx not in target:
                target.append(sx)

    for r in rows:
        ticker = (r.get("ticker") or "").strip().upper()
        summary_obj = r.get("summary") or {}
        if any(k in summary_obj for k in ("positive", "negative", "neutral")):
            sections = [
                ("**Positive**", summary_obj.get("positive") or []),
                ("**Negative**", summary_obj.get("negative") or []),
                ("**Neutral**", summary_obj.get("neutral") or []),
            ]
        else:
            sections = [
                ("**Bull case**", summary_obj.get("bull_case") or []),
                ("**Bear case**", summary_obj.get("bear_case") or []),
                ("**Risks**", summary_obj.get("risks") or []),
            ]

        md_lines.append(f"## {ticker}".strip())
        for title, items in sections:
            if items:
                md_lines.append(title)
                md_lines.extend(f"- {x}" for x in items)
                key_points.extend(str(x) for x in items)
        md_lines.append("")

        if any(k in summary_obj for k in ("positive", "negative", "neutral")):
            _add_unique(opportunities, summary_obj.get("positive") or [], max_items=12)
            _add_unique(risks, summary_obj.get("negative") or [], max_items=12)
        else:
            _add_unique(opportunities, summary_obj.get("bull_case") or [], max_items=12)
            _add_unique(risks, summary_obj.get("risks") or [], max_items=12)
            _add_unique(risks, summary_obj.get("bear_case") or [], max_items=12)

    return {
        "video_id": video_id,
        "summary_markdown": "\n".join(md_lines).strip(),
        "overall_explanation": "",
        "risks": risks,
        "opportunities": opportunities,
        "key_points": key_points[:12],
        "tickers": tickers,
        "sentiment": None,
        "model": "derived-from-summaries",
        "summarized_at": datetime.now(timezone.utc).isoformat(),
    }


def _derive_daily_summary(*, market_date: date, rows: List[Dict[str, Any]]) -> Dict[str, Any] | None:
    """Create a daily market summary derived from aggregated (video,ticker) summaries."""

    if not rows:
        return None

    ticker_counts: Dict[str, int] = {}
    opportunities: List[str] = []
    risks: List[str] = []

    md_lines: List[str] = [f"# Market Summary — {market_date.isoformat()}", ""]

    def _add_unique(target: List[str], items: Any, max_items: int) -> None:
        if not isinstance(items, list):
            return
        for x in items:
            if len(target) >= max_items:
                return
            sx = str(x).strip()
            if not sx:
                continue
            if sx not in target:
                target.append(sx)

    for r in rows:
        if not isinstance(r, dict):
            continue
        ticker = (r.get("ticker") or "").strip().upper()
        summary_obj = r.get("summary") or {}
        if not ticker:
            continue

        ticker_counts[ticker] = ticker_counts.get(ticker, 0) + 1

        if any(k in summary_obj for k in ("positive", "negative", "neutral")):
            sections = [
                ("**Positive**", summary_obj.get("positive") or []),
                ("**Negative**", summary_obj.get("negative") or []),
                ("**Neutral**", summary_obj.get("neutral") or []),
            ]
        else:
            sections = [
                ("**Bull case**", summary_obj.get("bull_case") or []),
                ("**Bear case**", summary_obj.get("bear_case") or []),
                ("**Risks**", summary_obj.get("risks") or []),
            ]

        md_lines.append(f"## {ticker}")
        for title, items in sections:
            if items:
                md_lines.append(title)
                md_lines.extend(f"- {x}" for x in items)
        md_lines.append("")

        if any(k in summary_obj for k in ("positive", "negative", "neutral")):
            _add_unique(opportunities, summary_obj.get("positive") or [], max_items=12)
            _add_unique(risks, summary_obj.get("negative") or [], max_items=12)
        else:
            _add_unique(opportunities, summary_obj.get("bull_case") or [], max_items=12)
            _add_unique(risks, summary_obj.get("risks") or [], max_items=12)
            _add_unique(risks, summary_obj.get("bear_case") or [], max_items=12)

    movers = [
        {
            "symbol": sym,
            "direction": "mixed",
            "reason": f"Mentioned in {ticker_counts[sym]} ticker summaries",
        }
        for sym in sorted(ticker_counts, key=lambda s: (-ticker_counts[s], s))[:10]
    ]

    return {
        "id": market_date.isoformat(),
        "market_date": market_date.isoformat(),
        "title": f"Market Summary — {market_date.isoformat()}",
        "summary_markdown": "\n".join(md_lines).strip(),
        "movers": movers,
        "risks": risks,
        "opportunities": opportunities,
        "model": "derived-from-summaries",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


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
        hf_token=settings.hf_api_key,
        model_name=settings.hf_embedding_model,
        device=settings.embedding_device,
        max_length=settings.embedding_max_length,
    )

    # 1) Daily discovery
    queries = [
        YouTubeSearchQuery("stock"),
    ]

    videos = youtube.discover_daily_videos(
        queries,
        lookback_hours=settings.discovery_lookback_hours,
        max_videos=settings.discovery_max_videos,
        language=settings.discovery_language,
    )
    print([video.video_id for video in videos])

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

        # 5) Extract tickers from EACH chunk with categorized keypoints
        total_extractions = 0
        for c in chunks:

            chunk_extraction = extractor.extract(c.chunk_text)
            if not chunk_extraction.ticker_topic_pairs:
                logger.debug("No tickers in chunk %d for video_id=%s", c.chunk_index, video.video_id)
                continue
            
            # Filter out invalid pairs
            valid_pairs = [
                pair
                for pair in chunk_extraction.ticker_topic_pairs
                if pair.ticker
            ]
            
            if not valid_pairs:
                continue
            
            logger.debug(
                "Chunk %d: extracted %d tickers with keypoints",
                c.chunk_index,
                len(valid_pairs)
            )
            
            # 6) Store one analysis row per (chunk, ticker) with keypoints
            for pair in valid_pairs:
                ticker = pair.ticker
                
                # Build keypoints structure
                keypoints = {
                    "positive": pair.positive_keypoints,
                    "negative": pair.negative_keypoints,
                    "neutral": pair.neutral_keypoints,
                }
                
                total_extractions += 1
                
                db.upsert_chunk_analysis(
                    video_id=video.video_id,
                    chunk_index=c.chunk_index,
                    ticker=ticker,
                    chunk_summary=keypoints,
                )
        
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

        # 7) Aggregation: group chunk keypoints by (video_id, ticker)
        analysis_rows = db.list_chunk_analysis(video.video_id)

        # Group by ticker
        grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for row in analysis_rows:
            ticker_value = row.get("ticker")
            keypoints = row.get("chunk_summary") or {}

            if ticker_value:
                ticker = str(ticker_value).upper()
                grouped[ticker].append(keypoints)
            else:
                logger.debug(
                    "Skipping malformed chunk_analysis row: ticker=%s",
                    ticker_value,
                )

        if not grouped:
            logger.info("No ticker groups created for video_id=%s", video.video_id)
            db.mark_video_processed(video.video_id)
            processed += 1
            continue

        # 8) Aggregate keypoints and create embeddings
        dimension = embedder.embedding_dimension()

        aggregated_items_for_video: List[Dict[str, Any]] = []

        # Aggregate ONCE per video (LLM), producing per-ticker aggregates.
        # This is much cheaper than calling the LLM once per ticker.
        aggregated_by_ticker: Dict[str, Dict[str, Any]] = {}
        try:
            agg_map = summarizer.aggregate_video_tickers(grouped_chunk_summaries=grouped)
            aggregated_by_ticker = {t: a.model_dump() for t, a in (agg_map or {}).items()}
        except Exception:
            logger.exception("Failed video-level aggregation; falling back to deterministic aggregation")

        for ticker, keypoints_list in grouped.items():
            ticker_u = str(ticker).strip().upper()

            aggregated_keypoints = aggregated_by_ticker.get(ticker_u)
            if not aggregated_keypoints:
                # Deterministic fallback (dedupe/limit) if LLM output is missing/invalid.
                aggregated_keypoints = _aggregate_keypoints(keypoints_list)

            aggregated_items_for_video.append(
                {
                    "ticker": ticker_u,
                    "summary": aggregated_keypoints,
                }
            )

            summary_id = db.upsert_aggregated_summary(
                video_id=video.video_id,
                published_at=video.published_at,
                ticker=ticker_u,
                aggregated_summary=aggregated_keypoints,
            )

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
                derived_tickers = [str(x.get("ticker")).strip().upper() for x in (aggregated_items_for_video or []) if isinstance(x, dict) and x.get("ticker")]
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
                    tickers=tickers,
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
                            "Opportunities:\n" + "\n".join(f"- {x}" for x in (overall.opportunities or []) if str(x).strip()),
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
                        model=settings.hf_embedding_model,
                        embedding=video_vector,
                        dimension=dimension,
                    )
                except Exception:
                    logger.exception("Failed to embed/store video summary embedding")
            else:
                # Fallback to derived-from-summaries (keeps UI populated even if LLM fails).
                print("Falling back to derived video summary")
                sr2 = (
                    db.client.table("summaries")
                    .select("ticker,summary,created_at")
                    .eq("video_id", video.video_id)
                    .order("created_at", desc=True)
                    .limit(500)
                    .execute()
                ).data or []
                vs = _derive_video_summary(video_id=video.video_id, summary_rows=sr2)
                if vs is not None:
                    db.upsert_video_summary(
                        video_id=video.video_id,
                        video_titles=video.title,
                        published_at=video.published_at,
                        summary_markdown=vs["summary_markdown"],
                        overall_explanation=vs.get("overall_explanation") or "",
                        movers=vs.get("movers") or [],
                        risks=vs.get("risks") or [],
                        opportunities=vs.get("opportunities") or [],
                        key_points=vs["key_points"],
                        tickers=vs["tickers"],
                        sentiment=vs["sentiment"],
                        events=vs.get("events") or [],
                        model=vs["model"],
                        summarized_at=vs["summarized_at"],
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
                "video_id,video_titles,published_at,overall_explanation,risks,opportunities,key_points,tickers,summarized_at"
            )
            .gte("summarized_at", start)
            .lte("summarized_at", end)
            .order("summarized_at", desc=True)
            .limit(1000)
            .execute()
        )
        raw_items = [r for r in (vs_resp.data or []) if isinstance(r, dict)]
        video_ids: List[str] = [str(r.get("video_id")) for r in raw_items if r.get("video_id")]
        if raw_items:

            # Keep the daily prompt inputs small: only pass the fields the prompt expects.
            video_items: List[Dict[str, Any]] = []
            for r in raw_items:
                vid = r.get("video_id")
                vid_str = str(vid) if vid else ""
                tickers_raw = r.get("tickers") or []
                tickers_market_only = [
                    str(t).strip().upper()
                    for t in tickers_raw
                    if str(t).strip().upper() == "MARKET"
                ]
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
                    model=f"llm:{settings.openai_chat_model}",
                )
            else:
                s_resp = (
                    db.client.table("summaries")
                    .select("video_id,ticker,summary,created_at")
                    .in_("video_id", video_ids)
                    .order("created_at", desc=True)
                    .limit(4000)
                    .execute()
                )
                ds = _derive_daily_summary(market_date=market_date, rows=(s_resp.data or []))
                if ds is not None:
                    db.upsert_daily_summary(
                        market_date=market_date,
                        title=ds["title"],
                        summary_markdown=ds["summary_markdown"],
                        movers=ds["movers"],
                        risks=ds["risks"],
                        opportunities=ds["opportunities"],
                        model=ds["model"],
                        generated_at=ds["generated_at"],
                    )
    except Exception:
        logger.exception("Failed to store daily summary", Exception)

    logger.info(
        "Done. discovered=%s processed=%s skipped=%s no_transcript=%s",
        len(videos),
        processed,
        skipped,
        no_transcript,
    )


if __name__ == "__main__":
    main()
