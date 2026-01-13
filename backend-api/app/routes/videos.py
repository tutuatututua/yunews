from __future__ import annotations

from datetime import date

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Query
from supabase import create_client

from app.settings import settings

router = APIRouter(prefix="/videos", tags=["videos"])


_EST = timezone(timedelta(hours=-5))


def _est_today() -> date:
    return datetime.now(timezone.utc).astimezone(_EST).date()


def _est_day_bounds(d: date) -> tuple[str, str]:
    """Return (start_utc_iso, end_utc_iso) for an EST (UTC-5) calendar day."""

    start_local = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=_EST)
    end_local = datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=_EST)
    return start_local.astimezone(timezone.utc).isoformat(), end_local.astimezone(timezone.utc).isoformat()


def _client():
    return create_client(settings.supabase_url, settings.supabase_key)


def _edge_sentiment(summary_obj) -> str:
    """Compute a simple (positive|negative|neutral) label from a summary JSON."""

    if not isinstance(summary_obj, dict):
        return "neutral"

    pos = summary_obj.get("positive")
    neg = summary_obj.get("negative")
    neu = summary_obj.get("neutral")

    p = len(pos) if isinstance(pos, list) else 0
    n = len(neg) if isinstance(neg, list) else 0
    u = len(neu) if isinstance(neu, list) else 0

    if p > n and p > u:
        return "positive"
    if n > p and n > u:
        return "negative"
    return "neutral"


def _summary_key_points(summary_obj, max_points: int = 10) -> list[str]:
    """Extract a compact list of key points from a summary JSON object.

    Supports both schemas:
      - {positive: [], negative: [], neutral: []}
      - {bull_case: [], bear_case: [], risks: []}
    """

    if not isinstance(summary_obj, dict):
        return []

    candidates: list[str] = []

    def _extend(items) -> None:
        if not isinstance(items, list):
            return
        for x in items:
            s = str(x or "").strip()
            if s:
                candidates.append(s)

    if any(k in summary_obj for k in ("positive", "negative", "neutral")):
        _extend(summary_obj.get("positive") or [])
        _extend(summary_obj.get("negative") or [])
        _extend(summary_obj.get("neutral") or [])
    else:
        _extend(summary_obj.get("bull_case") or [])
        _extend(summary_obj.get("bear_case") or [])
        _extend(summary_obj.get("risks") or [])

    # De-dupe while preserving order.
    seen: set[str] = set()
    out: list[str] = []
    for s in candidates:
        if s in seen:
            continue
        seen.add(s)
        out.append(s)
        if len(out) >= max_points:
            break
    return out


@router.get("")
def list_videos(
    date_: date | None = Query(default=None, alias="date"),
    days: int | None = Query(default=None, ge=1, le=30),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict:
    try:
        q = (
            _client()
            .table("videos")
            .select(
                "video_id,title,channel,published_at,video_url,thumbnail_url,view_count,like_count,comment_count,duration_seconds,video_summaries(overall_explanation,sentiment)"
            )
            .order("published_at", desc=True)
            .limit(limit)
        )
        if date_ is not None and days is None:
            start, end = _est_day_bounds(date_)
            q = q.gte("published_at", start).lte("published_at", end)
        elif days is not None:
            end_d = date_ or _est_today()
            start_d = end_d - timedelta(days=days - 1)
            start, _ = _est_day_bounds(start_d)
            _, end = _est_day_bounds(end_d)
            q = q.gte("published_at", start).lte("published_at", end)

        resp = q.execute()
        data = resp.data or []
        # The DB schema uses `video_id` as the primary key; the frontend expects `id`.
        for row in data:
            if isinstance(row, dict) and "id" not in row:
                row["id"] = row.get("video_id")

            # Flatten optional overall summary fields for list rendering.
            if isinstance(row, dict):
                vs = row.get("video_summaries")
                if isinstance(vs, list):
                    vs = vs[0] if vs else None
                if isinstance(vs, dict):
                    row["overall_explanation"] = vs.get("overall_explanation")
                    row["sentiment"] = vs.get("sentiment")
                else:
                    row.setdefault("overall_explanation", None)
                    row.setdefault("sentiment", None)

                # Remove nested relation payload to keep response compact.
                row.pop("video_summaries", None)
        return {"data": data}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/infographic")
def infographic(
    date_: date | None = Query(default=None, alias="date"),
    days: int = Query(default=7, ge=1, le=30),
    limit: int = Query(default=200, ge=1, le=500),
) -> dict:
    """Returns a compact (video -> tickers) structure for a recent time window.

    Used by the frontend to draw a video/ticker network infographic.
    """

    try:
        supa = _client()

        # Keep MARKET as a special macro node only when there are no real tickers.
        # This prevents the graph from appearing "empty" when the extractor only
        # produces macro commentary.
        excluded_tickers = {"MARKET"}

        end_d = date_ or _est_today()
        start_d = end_d - timedelta(days=days - 1)
        start, _ = _est_day_bounds(start_d)
        _, end = _est_day_bounds(end_d)

        v_resp = (
            supa.table("videos")
            .select(
                "video_id,title,channel,published_at,video_url,thumbnail_url"
            )
            .gte("published_at", start)
            .lte("published_at", end)
            .order("published_at", desc=True)
            .limit(limit)
            .execute()
        )

        videos = [r for r in (v_resp.data or []) if isinstance(r, dict) and r.get("video_id")]
        if not videos:
            return {"data": []}

        video_ids = [str(v.get("video_id")) for v in videos if v.get("video_id")]

        # Per-(video,ticker) edges from aggregated summaries.
        # IMPORTANT: frontend keys edges by `${video_id}__${ticker}`; ensure uniqueness.
        edges_by_video: dict[str, list[dict]] = {vid: [] for vid in video_ids}
        try:
            s_resp = (
                supa.table("summaries")
                .select("video_id,ticker,summary")
                .in_("video_id", video_ids)
                .limit(5000)
                .execute()
            )
            # Aggregate to a single edge per (video_id, ticker).
            # We keep sentiment based on the majority of key-points, and expose the
            # actual `key_points` instead of any numeric weight.
            acc: dict[str, dict[str, dict]] = {vid: {} for vid in video_ids}
            for row in (s_resp.data or []):
                if not isinstance(row, dict):
                    continue
                vid_raw = row.get("video_id")
                ticker = row.get("ticker")
                if not vid_raw or not ticker:
                    continue

                vid = str(vid_raw)
                sym = str(ticker).strip().upper()
                if not sym:
                    continue

                summary_obj = row.get("summary")
                key_points = _summary_key_points(summary_obj, max_points=10)
                sentiment = _edge_sentiment(summary_obj)

                bucket = acc.setdefault(vid, {}).setdefault(
                    sym,
                    {
                        "positive": 0,
                        "negative": 0,
                        "neutral": 0,
                        "key_points": [],
                    },
                )

                # Use number of key-points as the aggregation mass (fallback to 1).
                w = max(1, len(key_points))
                if sentiment in ("positive", "negative", "neutral"):
                    bucket[sentiment] = int(bucket.get(sentiment) or 0) + w

                # Merge key points (dedupe, preserve order).
                existing = bucket.get("key_points") or []
                if not isinstance(existing, list):
                    existing = []
                seen = set(str(x) for x in existing)
                for kp in key_points:
                    if kp in seen:
                        continue
                    seen.add(kp)
                    existing.append(kp)
                    if len(existing) >= 10:
                        break
                bucket["key_points"] = existing

            edges_by_video = {}
            for vid, per_ticker in acc.items():
                edges_non_market: list[dict] = []
                edges_market: list[dict] = []
                for sym, b in per_ticker.items():
                    scores = {
                        "positive": int(b.get("positive") or 0),
                        "negative": int(b.get("negative") or 0),
                        "neutral": int(b.get("neutral") or 0),
                    }

                    max_score = max(scores.values())
                    top = [k for k, v in scores.items() if v == max_score]
                    # Avoid biasing to 'positive' when tied; treat ties as neutral.
                    sentiment = top[0] if len(top) == 1 else "neutral"
                    edge = (
                        {
                            "ticker": sym,
                            "sentiment": sentiment,
                            "key_points": b.get("key_points") or [],
                        }
                    )

                    if sym in excluded_tickers:
                        edges_market.append(edge)
                    else:
                        edges_non_market.append(edge)

                # If we have real tickers, hide MARKET to reduce noise; otherwise keep MARKET.
                edges_by_video[vid] = edges_non_market or edges_market
        except Exception:
            edges_by_video = {vid: [] for vid in video_ids}

        # Fallback: if no per-ticker summaries exist, at least return tickers from video_summaries.
        if not any(edges_by_video.get(vid) for vid in edges_by_video):
            try:
                vs_resp = (
                    supa.table("video_summaries")
                    .select("video_id,tickers")
                    .in_("video_id", video_ids)
                    .limit(2000)
                    .execute()
                )
                for row in (vs_resp.data or []):
                    if not isinstance(row, dict) or not row.get("video_id"):
                        continue
                    vid = str(row.get("video_id"))
                    tickers_raw = row.get("tickers") or []
                    if not isinstance(tickers_raw, list):
                        continue
                    seen: set[str] = set()
                    edges = []
                    market_edge: dict | None = None
                    for t in tickers_raw:
                        s = str(t).strip().upper()
                        if s and s not in seen:
                            seen.add(s)
                            edge = {"ticker": s, "sentiment": "neutral", "key_points": []}
                            if s in excluded_tickers:
                                # Only keep MARKET if it is the only available edge.
                                market_edge = edge
                            else:
                                edges.append(edge)

                    if not edges and market_edge is not None:
                        edges = [market_edge]
                    edges_by_video[vid] = edges
            except Exception:
                pass

        out = []
        for v in videos:
            vid = str(v.get("video_id"))
            edges = edges_by_video.get(vid) or []

            out.append(
                {
                    "id": vid,
                    "video_id": vid,
                    "title": v.get("title"),
                    "channel": v.get("channel"),
                    "published_at": v.get("published_at"),
                    "video_url": v.get("video_url"),
                    "thumbnail_url": v.get("thumbnail_url"),
                    "edges": edges,
                }
            )

        # If a video has no edges, the frontend graph effectively has no node for it.
        # Filtering here makes the infographic reliably show only processed videos.
        out = [row for row in out if (row.get("edges") or [])]

        return {"data": out}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{video_id}")
def get_video(video_id: str) -> dict:
    try:
        supa = _client()
        v_resp = supa.table("videos").select("*").eq("video_id", video_id).limit(1).execute()
        video = v_resp.data[0] if v_resp.data else None
        if not video:
            return {"data": None}

        # Keep frontend compatibility: expose `id` as `video_id`.
        if "id" not in video:
            video["id"] = video.get("video_id")

        # Schema.sql stores transcripts as time-windowed chunks.
        tr_resp = (
            supa.table("transcript_chunks")
            .select("chunk_index,chunk_text")
            .eq("video_id", video_id)
            .order("chunk_index", desc=False)
            .limit(500)
            .execute()
        )
        chunks = tr_resp.data or []
        transcript_text = "\n\n".join((c.get("chunk_text") or "").strip() for c in chunks if isinstance(c, dict))
        transcript = (
            {
                "id": f"{video_id}:merged",
                "transcript_text": transcript_text,
                "transcript_language": None,
            }
            if transcript_text
            else None
        )

        # Prefer stored overall video summary (if table exists / populated).
        summary = None
        try:
            try:
                vs_resp = (
                    supa.table("video_summaries")
                    .select(
                        "summary_markdown,overall_explanation,movers,risks,opportunities,key_points,tickers,sentiment,events,model,summarized_at"
                    )
                    .eq("video_id", video_id)
                    .limit(1)
                    .execute()
                )
            except Exception:
                # Backward compatibility: older schemas may not have newer columns (e.g., events).
                vs_resp = (
                    supa.table("video_summaries")
                    .select(
                        "summary_markdown,overall_explanation,risks,opportunities,key_points,tickers,sentiment,model,summarized_at"
                    )
                    .eq("video_id", video_id)
                    .limit(1)
                    .execute()
                )
            vs = vs_resp.data[0] if vs_resp.data else None
            if isinstance(vs, dict) and (vs.get("summary_markdown") or "").strip():
                summary = {
                    "id": f"{video_id}:overall",
                    "summary_markdown": vs.get("summary_markdown"),
                    "overall_explanation": vs.get("overall_explanation") or "",
                    "movers": vs.get("movers") or [],
                    "risks": vs.get("risks") or [],
                    "opportunities": vs.get("opportunities") or [],
                    "key_points": vs.get("key_points") or [],
                    "tickers": vs.get("tickers") or [],
                    "sentiment": vs.get("sentiment"),
                    "events": vs.get("events") or [],
                    "model": vs.get("model") or "video_summaries",
                    "summarized_at": vs.get("summarized_at") or datetime.now(timezone.utc).isoformat(),
                }
        except Exception:
            # Table may not exist; fall back below.
            summary = None

        if summary is None:
            # Fallback: derive summary from per-(video,ticker) aggregated summaries.
            s_resp = (
                supa.table("summaries")
                .select("ticker,summary,created_at")
                .eq("video_id", video_id)
                .order("created_at", desc=True)
                .limit(200)
                .execute()
            )

            rows = s_resp.data or []
            if rows:
                tickers = sorted(
                    {
                        (r.get("ticker") or "").strip().upper()
                        for r in rows
                        if isinstance(r, dict) and r.get("ticker")
                    }
                )

                key_points: list[str] = []
                opportunities: list[str] = []
                risks: list[str] = []
                md_lines: list[str] = []

                def _add_unique(target: list[str], items, max_items: int) -> None:
                    if not isinstance(items, list):
                        return
                    for x in items:
                        if len(target) >= max_items:
                            return
                        s = str(x or "").strip()
                        if not s:
                            continue
                        if s not in target:
                            target.append(s)

                for r in rows:
                    if not isinstance(r, dict):
                        continue
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

                    header = f"## {ticker}".strip()
                    md_lines.append(header)
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

                summary = {
                    "id": f"{video_id}:derived",
                    "summary_markdown": "\n".join(md_lines).strip(),
                    "overall_explanation": "",
                    "risks": risks,
                    "opportunities": opportunities,
                    "key_points": key_points[:30],
                    "tickers": tickers,
                    "sentiment": None,
                    "model": "derived-from-summaries",
                    "summarized_at": datetime.now(timezone.utc).isoformat(),
                }

        return {"data": {"video": video, "transcript": transcript, "summary": summary}}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
