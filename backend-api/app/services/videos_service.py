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

    edges_by_video: dict[str, list[dict]] = {vid: [] for vid in video_ids}
    try:
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
    except Exception:
        edges_by_video = {vid: [] for vid in video_ids}

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

    return [row for row in out if (row.get("edges") or [])]


def get_video_detail(video_id: str) -> dict[str, Any] | None:
    supa = get_supabase_client()
    v_resp = supa.table("videos").select("*").eq("video_id", video_id).limit(1).execute()
    video = v_resp.data[0] if v_resp.data else None
    if not video:
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
        summary = None

    if summary is None:
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

    return {"video": video, "transcript": transcript, "summary": summary}
