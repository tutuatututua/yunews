from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

try:  # Python 3.9+
    from zoneinfo import ZoneInfo
except Exception:  # pragma: no cover
    ZoneInfo = None  # type: ignore[assignment]

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


def _clean_bullets(items: Any, *, max_items: int) -> list[str]:
    """Return up to max_items non-empty, stripped string bullets."""

    if not isinstance(items, list):
        return []
    out: list[str] = []
    for x in items:
        sx = str(x).strip()
        if not sx:
            continue
        out.append(sx)
        if len(out) >= max_items:
            break
    return out


def _summary_sections(summary_obj: dict[str, Any]) -> tuple[bool, list[tuple[str, list[str]]]]:
    """Return (categorized, sections) for a summary object.

    - categorized=True: expects positive/negative/neutral keys
    - categorized=False: expects bull_case/bear_case/risks keys
    """

    categorized = any(k in summary_obj for k in ("positive", "negative", "neutral"))
    if categorized:
        return (
            True,
            [
                ("**Positive**", _clean_bullets(summary_obj.get("positive") or [], max_items=50)),
                ("**Negative**", _clean_bullets(summary_obj.get("negative") or [], max_items=50)),
                ("**Neutral**", _clean_bullets(summary_obj.get("neutral") or [], max_items=50)),
            ],
        )

    return (
        False,
        [
            ("**Bull case**", _clean_bullets(summary_obj.get("bull_case") or [], max_items=50)),
            ("**Bear case**", _clean_bullets(summary_obj.get("bear_case") or [], max_items=50)),
            ("**Risks**", _clean_bullets(summary_obj.get("risks") or [], max_items=50)),
        ],
    )


def _previous_et_day_window(*, now_utc: datetime) -> tuple[date, datetime, datetime]:
    """Return (market_date, start_utc, end_utc) for the previous ET calendar day.

    Example: if run at 00:00 ET, summarize the day that just ended.
    This avoids partial-day rollups and handles DST via America/New_York.
    """

    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    else:
        now_utc = now_utc.astimezone(timezone.utc)

    if ZoneInfo is None:
        # Fallback (no DST support): treat ET as UTC-5.
        et = timezone(timedelta(hours=-5))
    else:
        et = ZoneInfo("America/New_York")

    now_et = now_utc.astimezone(et)
    end_et = now_et.replace(hour=0, minute=0, second=0, microsecond=0)
    start_et = end_et - timedelta(days=1)

    start_utc = start_et.astimezone(timezone.utc)
    end_utc = end_et.astimezone(timezone.utc)
    return (start_et.date(), start_utc, end_utc)


def _add_unique_strings(target: list[str], items: Any, *, max_items: int) -> None:
    """Append unique, non-empty strings from items into target up to max_items."""

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


def _aggregate_keypoints(keypoints_list: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate keypoints from multiple chunks into a single structure."""

    positive: list[str] = []
    negative: list[str] = []
    neutral: list[str] = []

    for kp_dict in keypoints_list:
        if not isinstance(kp_dict, dict):
            continue

        _add_unique_strings(positive, kp_dict.get("positive", []), max_items=10)
        _add_unique_strings(negative, kp_dict.get("negative", []), max_items=10)
        _add_unique_strings(neutral, kp_dict.get("neutral", []), max_items=10)

    return {
        "positive": positive,
        "negative": negative,
        "neutral": neutral,
    }


def _derive_video_summary(*, video_id: str, summary_rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Create a lightweight per-video summary from aggregated (ticker) rows."""

    rows = [r for r in (summary_rows or []) if isinstance(r, dict)]
    if not rows:
        return None

    tickers = sorted({(r.get("ticker") or "").strip().upper() for r in rows if r.get("ticker")})

    key_points: list[str] = []
    opportunities: list[str] = []
    risks: list[str] = []
    md_lines: list[str] = []

    for r in rows:
        ticker = (r.get("ticker") or "").strip().upper()
        summary_obj = r.get("summary") or {}
        if not ticker:
            continue

        categorized, sections = _summary_sections(summary_obj if isinstance(summary_obj, dict) else {})

        md_lines.append(f"## {ticker}")
        for title, items in sections:
            if not items:
                continue
            md_lines.append(title)
            md_lines.extend(f"- {x}" for x in items)
            key_points.extend(items)
        md_lines.append("")

        if categorized:
            _add_unique_strings(opportunities, summary_obj.get("positive") or [], max_items=12)
            _add_unique_strings(risks, summary_obj.get("negative") or [], max_items=12)
        else:
            _add_unique_strings(opportunities, summary_obj.get("bull_case") or [], max_items=12)
            _add_unique_strings(risks, summary_obj.get("risks") or [], max_items=12)
            _add_unique_strings(risks, summary_obj.get("bear_case") or [], max_items=12)

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


def _derive_daily_summary(*, market_date: date, rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Create a daily market summary derived from aggregated (video,ticker) summaries."""

    if not rows:
        return None

    ticker_counts: dict[str, int] = {}
    opportunities: list[str] = []
    risks: list[str] = []

    md_lines: list[str] = [f"# Market Summary — {market_date.isoformat()}", ""]

    for r in rows:
        if not isinstance(r, dict):
            continue
        ticker = (r.get("ticker") or "").strip().upper()
        summary_obj = r.get("summary") or {}
        if not ticker:
            continue

        ticker_counts[ticker] = ticker_counts.get(ticker, 0) + 1

        categorized, sections = _summary_sections(summary_obj if isinstance(summary_obj, dict) else {})

        md_lines.append(f"## {ticker}")
        for title, items in sections:
            if not items:
                continue
            md_lines.append(title)
            md_lines.extend(f"- {x}" for x in items)
        md_lines.append("")

        if categorized:
            _add_unique_strings(opportunities, summary_obj.get("positive") or [], max_items=12)
            _add_unique_strings(risks, summary_obj.get("negative") or [], max_items=12)
        else:
            _add_unique_strings(opportunities, summary_obj.get("bull_case") or [], max_items=12)
            _add_unique_strings(risks, summary_obj.get("risks") or [], max_items=12)
            _add_unique_strings(risks, summary_obj.get("bear_case") or [], max_items=12)

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
        "sentiment": None,
        "sentiment_score": None,
        "sentiment_reason": "",
        "model": "derived-from-summaries",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def _format_ticker_summary_text(*, ticker: str, summary_obj: dict[str, Any], video_title: str, published_at: datetime) -> str:
    ticker_u = (ticker or "").strip().upper()
    pos = summary_obj.get("positive") or []
    neg = summary_obj.get("negative") or []
    neu = summary_obj.get("neutral") or []

    lines: list[str] = [
        f"Ticker: {ticker_u}",
        f"Video: {video_title}",
        f"Date: {published_at.date().isoformat()}",
        "",
    ]

    p = _clean_bullets(pos, max_items=10)
    n = _clean_bullets(neg, max_items=10)
    u = _clean_bullets(neu, max_items=10)
    if p:
        lines.append("Positive:")
        lines.extend(f"- {x}" for x in p)
        lines.append("")
    if n:
        lines.append("Negative:")
        lines.extend(f"- {x}" for x in n)
        lines.append("")
    if u:
        lines.append("Neutral:")
        lines.extend(f"- {x}" for x in u)
        lines.append("")

    return "\n".join(lines).strip()


def _chunk_highlights(items: list[str], *, chunk_size: int = 4) -> list[list[str]]:
    cleaned = [str(x).strip() for x in (items or []) if str(x).strip()]
    if not cleaned:
        return []
    out: list[list[str]] = []
    for i in range(0, len(cleaned), max(1, chunk_size)):
        out.append(cleaned[i : i + chunk_size])
    return out


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

    embedder: EmbeddingService | None = None
    embedding_model_name: str | None = None
    if settings.pipeline_enable_embeddings:
        embedding_model_name = settings.openai_embedding_model
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
            try:
                # Persist required metadata so processed_at can be set safely.
                db.upsert_video(video)
            except Exception:
                logger.exception("Failed to upsert video metadata before marking processed")
            db.mark_video_processed(video.video_id)
            no_transcript += 1
            continue

        # 4) Time-based chunking (in-memory). Only persist if we extract at least one ticker.
        chunks = chunker.chunk_by_time(video.video_id, entries)

        # 5) Extract tickers from EACH chunk with categorized keypoints (in-memory)
        total_extractions = 0
        pending_chunk_analyses: list[tuple[int, str, dict[str, Any]]] = []
        for chunk in chunks:
            chunk_extraction = extractor.extract(chunk.chunk_text)
            if not chunk_extraction.ticker_topic_pairs:
                logger.debug("No tickers in chunk %d for video_id=%s", chunk.chunk_index, video.video_id)
                continue

            # Filter out invalid pairs
            valid_pairs = [pair for pair in chunk_extraction.ticker_topic_pairs if (pair.ticker or "").strip()]
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

                pending_chunk_analyses.append((chunk.chunk_index, ticker_u, keypoints))
                total_extractions += 1

        if total_extractions == 0:
            logger.info("No tickers extracted from any chunk for video_id=%s, skipping", video.video_id)
            try:
                # Persist required metadata so processed_at can be set safely.
                db.upsert_video(video)
            except Exception:
                logger.exception("Failed to upsert video metadata before marking processed")
            db.mark_video_processed(video.video_id)
            processed += 1
            continue

        logger.info(
            "Extracted %d total tickers across all chunks for video_id=%s",
            total_extractions,
            video.video_id
        )

        # Persist only now that we know there is at least one ticker.
        db.upsert_video(video)
        db.upsert_transcript_chunks(chunks)
        for chunk_index, ticker_u, keypoints in pending_chunk_analyses:
            db.upsert_chunk_analysis(
                video_id=video.video_id,
                chunk_index=chunk_index,
                ticker=ticker_u,
                chunk_summary=keypoints,
            )

        # 7) Aggregation: group chunk keypoints by (video_id, ticker)
        grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for _, ticker_u, keypoints in pending_chunk_analyses:
            grouped[ticker_u].append(keypoints)

        if not grouped:
            logger.info("No ticker groups created for video_id=%s", video.video_id)
            db.mark_video_processed(video.video_id)
            processed += 1
            continue

        # 8) Aggregate keypoints and (optionally) create embeddings
        dimension: int | None = None
        if embedder is not None:
            dimension = embedder.embedding_dimension()

        aggregated_items_for_video: list[dict[str, Any]] = []

        # Aggregate ONCE per video (LLM), producing per-ticker aggregates.
        # This is much cheaper than calling the LLM once per ticker.
        aggregated_by_ticker: dict[str, dict[str, Any]] = {}
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

            db.upsert_aggregated_summary(
                video_id=video.video_id,
                published_at=video.published_at,
                ticker=ticker_u,
                aggregated_summary=aggregated_keypoints,
            )

            if embedder is not None and dimension is not None:
                # RAG doc: per-ticker summary (most important)
                try:
                    ticker_text = _format_ticker_summary_text(
                        ticker=ticker_u,
                        summary_obj=aggregated_keypoints,
                        video_title=video.title,
                        published_at=video.published_at,
                    )
                    # Avoid embedding extremely short text.
                    if len(ticker_text) >= 120:
                        ticker_vec = embedder.embed_text(ticker_text)
                        db.upsert_rag_document(
                            source_key=f"ticker_summary:{video.video_id}:{ticker_u}",
                            document_type="ticker_summary",
                            ticker=ticker_u,
                            video_id=video.video_id,
                            summary_text=ticker_text,
                            model=str(embedding_model_name or settings.openai_embedding_model),
                            embedding=ticker_vec,
                            dimension=dimension,
                        )
                except Exception:
                    logger.exception("Failed to embed/store ticker RAG document")

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

                if embedder is not None and dimension is not None:
                    # RAG doc: overall per-video summary
                    try:
                        video_doc_text = "\n\n".join(
                            [
                                f"Video title: {video.title}",
                                f"Channel: {video.channel}",
                                f"Date: {video.published_at.date().isoformat()}",
                                (overall.overall_explanation or '').strip(),
                                "Key points:\n" + "\n".join(
                                    f"- {x}" for x in (key_points or []) if str(x).strip()
                                ),
                                "Risks:\n" + "\n".join(
                                    f"- {x}" for x in (overall.risks or []) if str(x).strip()
                                ),
                                "Opportunities:\n" + "\n".join(
                                    f"- {x}" for x in (overall.opportunities or []) if str(x).strip()
                                ),
                                "Summary:\n" + (summary_markdown or '').strip(),
                            ]
                        ).strip()
                        if len(video_doc_text) >= 200:
                            video_doc_vec = embedder.embed_text(video_doc_text)
                            db.upsert_rag_document(
                                source_key=f"video_summary:{video.video_id}",
                                document_type="video_summary",
                                ticker=None,
                                video_id=video.video_id,
                                summary_text=video_doc_text,
                                model=str(embedding_model_name or settings.openai_embedding_model),
                                embedding=video_doc_vec,
                                dimension=dimension,
                            )
                    except Exception:
                        logger.exception("Failed to embed/store video_summary RAG document")

                if embedder is not None and dimension is not None:
                    # RAG docs: highlight chunks (short takeaways for ranking questions)
                    try:
                        highlight_chunks = _chunk_highlights(key_points or [], chunk_size=4)
                        for idx, chunk in enumerate(highlight_chunks):
                            if not chunk:
                                continue
                            hl_text = "\n".join(
                                [
                                    f"Highlights from: {video.title}",
                                    f"Date: {video.published_at.date().isoformat()}",
                                    "",
                                    *[f"- {x}" for x in chunk],
                                ]
                            ).strip()
                            if len(hl_text) < 120:
                                continue
                            hl_vec = embedder.embed_text(hl_text)
                            db.upsert_rag_document(
                                source_key=f"highlight:{video.video_id}:{idx}",
                                document_type="highlight",
                                ticker=None,
                                video_id=video.video_id,
                                summary_text=hl_text,
                                model=str(embedding_model_name or settings.openai_embedding_model),
                                embedding=hl_vec,
                                dimension=dimension,
                            )
                    except Exception:
                        logger.exception("Failed to embed/store highlight RAG documents")

                if embedder is not None and dimension is not None:
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
                                "Risks:\n" + "\n".join(
                                    f"- {x}" for x in (overall.risks or []) if str(x).strip()
                                ),
                                "Events:\n"
                                + "\n".join(
                                    f"- {e.description} ({e.date or e.timeframe or 'unspecified'})"
                                    for e in (overall.events or [])
                                    if getattr(e, "description", "")
                                    and str(getattr(e, "description", "")).strip()
                                ),
                                f"Tickers: {', '.join(tickers) if tickers else '(none)'}",
                                "Key points:\n" + "\n".join(
                                    f"- {x}" for x in key_points if str(x).strip()
                                ),
                                "Summary:\n" + summary_markdown,
                            ]
                        ).strip()
                        video_vector = embedder.embed_text(video_embed_text)
                        db.upsert_video_summary_embedding(
                            video_id=video.video_id,
                            published_at=video.published_at,
                            model=str(embedding_model_name or settings.openai_embedding_model),
                            embedding=video_vector,
                            dimension=dimension,
                        )
                    except Exception:
                        logger.exception("Failed to embed/store video summary embedding")
            else:
                # Fallback to derived-from-summaries (keeps UI populated even if LLM fails).
                logger.info("Falling back to derived video summary video_id=%s", video.video_id)
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
        # Group videos by ET (America/New_York) day boundaries.
        # When triggered at midnight ET, summarize the previous ET day.
        market_date, start_utc, end_utc = _previous_et_day_window(now_utc=run_started)
        start = start_utc.isoformat()
        end = end_utc.isoformat()

        # Prefer LLM daily summary from per-video summaries (or fall back to derived from aggregated summaries).
        # Date-based ("what was published that day"): filter by published_at within the ET day window.
        vs_resp = (
            db.client.table("video_summaries")
            .select(
                "video_id,video_titles,published_at,overall_explanation,risks,opportunities,key_points,summarized_at"
            )
            .gte("published_at", start)
            .lt("published_at", end)
            .order("published_at", desc=True)
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
                        sentiment=ds.get("sentiment"),
                        sentiment_score=ds.get("sentiment_score"),
                        sentiment_reason=ds.get("sentiment_reason") or "",
                        model=ds["model"],
                        generated_at=ds["generated_at"],
                    )
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
