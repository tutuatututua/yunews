from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.core.supabase import get_supabase_client
from app.core.time import market_day_bounds, market_today


def edge_sentiment(summary_obj: Any) -> str:
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


def summary_key_points(summary_obj: Any, max_points: int = 10) -> list[str]:
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


def list_videos(*, date_: date | None, days: int | None, limit: int) -> list[dict[str, Any]]:
    q = (
        get_supabase_client()
        .table("videos")
        .select(
            "video_id,title,channel,published_at,video_url,thumbnail_url,view_count,like_count,comment_count,duration_seconds,video_summaries(overall_explanation,sentiment)"
        )
        .order("published_at", desc=True)
        .limit(limit)
    )

    if date_ is not None and days is None:
        start, end = market_day_bounds(date_)
        q = q.gte("published_at", start).lte("published_at", end)
    elif days is not None:
        end_d = date_ or market_today()
        start_d = end_d - timedelta(days=days - 1)
        start, _ = market_day_bounds(start_d)
        _, end = market_day_bounds(end_d)
        q = q.gte("published_at", start).lte("published_at", end)

    resp = q.execute()
    data = resp.data or []

    for row in data:
        if isinstance(row, dict) and "id" not in row:
            row["id"] = row.get("video_id")

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

            row.pop("video_summaries", None)

    return data


def video_infographic(*, date_: date | None, days: int, limit: int) -> list[dict[str, Any]]:
    supa = get_supabase_client()

    excluded_tickers = {"MARKET"}

    end_d = date_ or market_today()
    start_d = end_d - timedelta(days=days - 1)
    start, _ = market_day_bounds(start_d)
    _, end = market_day_bounds(end_d)

    v_resp = (
        supa.table("videos")
        .select("video_id,title,channel,published_at,video_url,thumbnail_url")
        .gte("published_at", start)
        .lte("published_at", end)
        .order("published_at", desc=True)
        .limit(limit)
        .execute()
    )

    videos = [r for r in (v_resp.data or []) if isinstance(r, dict) and r.get("video_id")]
    if not videos:
        return []

    video_ids = [str(v.get("video_id")) for v in videos if v.get("video_id")]

    s_resp = (
        supa.table("summaries")
        .select("video_id,ticker,summary")
        .in_("video_id", video_ids)
        .limit(5000)
        .execute()
    )

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
        key_points = summary_key_points(summary_obj, max_points=10)
        sentiment = edge_sentiment(summary_obj)

        bucket = acc.setdefault(vid, {}).setdefault(
            sym,
            {
                "positive": 0,
                "negative": 0,
                "neutral": 0,
                "key_points": [],
            },
        )

        w = max(1, len(key_points))
        if sentiment in ("positive", "negative", "neutral"):
            bucket[sentiment] = int(bucket.get(sentiment) or 0) + w

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

    edges_by_video: dict[str, list[dict]] = {}
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
            sentiment = top[0] if len(top) == 1 else "neutral"
            edge = {
                "ticker": sym,
                "sentiment": sentiment,
                "key_points": b.get("key_points") or [],
            }

            if sym in excluded_tickers:
                edges_market.append(edge)
            else:
                edges_non_market.append(edge)

        edges_by_video[vid] = edges_non_market or edges_market

    # Note: We intentionally do not fall back to `video_summaries.tickers`.
    # Ticker relationships are sourced from the normalized `summaries` table.

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

    return [row for row in out if (row.get("edges") or [])]


def get_video_detail(video_id: str) -> dict[str, Any] | None:
    supa = get_supabase_client()
    v_resp = supa.table("videos").select("*").eq("video_id", video_id).limit(1).execute()
    video = v_resp.data[0] if v_resp.data else None

    if not isinstance(video, dict) or not video:
        return None

    if "id" not in video:
        video["id"] = video.get("video_id")

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

    ticker_details: list[dict[str, Any]] = []

    summary: dict[str, Any] | None = None
    vs_resp = (
        supa.table("video_summaries")
        .select(
            "video_titles,published_at,summary_markdown,overall_explanation,movers,risks,opportunities,key_points,sentiment,events,model,summarized_at"
        )
        .eq("video_id", video_id)
        .limit(1)
        .execute()
    )

    vs = vs_resp.data[0] if vs_resp.data else None

    vs_obj: dict[str, Any] = vs if isinstance(vs, dict) else {}

    t_resp = supa.table("summaries").select("ticker").eq("video_id", video_id).limit(500).execute()
    t_rows = t_resp.data or []

    tickers: list[str] = []
    seen: set[str] = set()
    market_seen = False
    for r in t_rows:
        if not isinstance(r, dict):
            continue
        ticker_raw = r.get("ticker")
        s = str(ticker_raw or "").strip().upper()
        if not s or s in seen:
            continue
        seen.add(s)
        if s == "MARKET":
            market_seen = True
            continue
        tickers.append(s)

    tickers = tickers or (["MARKET"] if market_seen else [])
    summary = {
        "id": f"{video_id}:overall",
        "summary_markdown": vs_obj.get("summary_markdown"),
        "overall_explanation": vs_obj.get("overall_explanation") or "",
        "movers": vs_obj.get("movers") or [],
        "risks": vs_obj.get("risks") or [],
        "opportunities": vs_obj.get("opportunities") or [],
        "key_points": vs_obj.get("key_points") or [],
        "tickers": tickers,
        "sentiment": vs_obj.get("sentiment"),
        "events": vs_obj.get("events") or [],
        "model": vs_obj.get("model") or "",
        "summarized_at": vs_obj.get("summarized_at") or datetime.now(timezone.utc).isoformat(),
        "video_titles": vs_obj.get("video_titles"),
        "published_at": vs_obj.get("published_at") or video.get("published_at"),
    }


    per_resp = (
        supa.table("summaries")
        .select("ticker,summary,created_at")
        .eq("video_id", video_id)
        .order("created_at", desc=True)
        .limit(500)
        .execute()
    )
    rows = per_resp.data or []
    latest_by_ticker: dict[str, dict[str, Any]] = {}
    for r in rows:
        if not isinstance(r, dict):
            continue
        ticker_raw = r.get("ticker")
        summary_obj = r.get("summary")
        if not ticker_raw or not isinstance(summary_obj, dict):
            continue

        sym = str(ticker_raw).strip().upper()
        if not sym or sym in latest_by_ticker:
            continue

        latest_by_ticker[sym] = r

    for sym in sorted(latest_by_ticker.keys()):
        summary_obj = latest_by_ticker[sym].get("summary")
        ticker_details.append(
            {
                "ticker": sym,
                "summary": summary_obj,
                "sentiment": edge_sentiment(summary_obj),
                "key_points": summary_key_points(summary_obj, max_points=12),
            }
        )

    return {"video": video, "transcript": transcript, "summary": summary, "ticker_details": ticker_details}
