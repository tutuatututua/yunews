from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.supabase import execute, get_supabase_client
from app.core.time import market_day_bounds, market_today


def first_claim_from_summary(summary_obj: Any) -> str | None:
    if not isinstance(summary_obj, dict):
        return None
    for key in ("positive", "negative", "neutral", "bull_case", "bear_case", "risks"):
        items = summary_obj.get(key)
        if isinstance(items, list) and items:
            s = str(items[0]).strip()
            if s:
                return s
    return None


def chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def summary_sentiment_counts(summary_obj: Any) -> tuple[int, int, int]:
    if not isinstance(summary_obj, dict):
        return 0, 0, 0

    if any(k in summary_obj for k in ("positive", "negative", "neutral")):
        pos = summary_obj.get("positive")
        neg = summary_obj.get("negative")
        neu = summary_obj.get("neutral")
        p = len(pos) if isinstance(pos, list) else 0
        n = len(neg) if isinstance(neg, list) else 0
        u = len(neu) if isinstance(neu, list) else 0
        return p, n, u

    bull = summary_obj.get("bull_case")
    bear = summary_obj.get("bear_case")
    risks = summary_obj.get("risks")
    p = len(bull) if isinstance(bull, list) else 0
    n = (len(bear) if isinstance(bear, list) else 0) + (len(risks) if isinstance(risks, list) else 0)
    return p, n, 0


def top_movers(*, date_, days: int, limit: int) -> list[dict[str, Any]]:
    supa = get_supabase_client()

    end_d = date_ or market_today()
    start_d = end_d - timedelta(days=days - 1)
    start, _ = market_day_bounds(start_d)
    _, end = market_day_bounds(end_d)

    v_resp = execute(
        supa.table("videos")
        .select("video_id")
        .gte("published_at", start)
        .lte("published_at", end)
        .order("published_at", desc=True)
        .limit(4000),
        context="entities:top_movers:videos",
    )
    video_ids = [str(r.get("video_id")) for r in (v_resp.data or []) if isinstance(r, dict) and r.get("video_id")]
    if not video_ids:
        return []

    rows: list[dict[str, Any]] = []
    for group in chunked(video_ids, 400):
        s_resp = execute(
            supa.table("summaries")
            .select("video_id,ticker,summary")
            .in_("video_id", group)
            .limit(5000),
            context="entities:top_movers:summaries",
        )
        rows.extend([r for r in (s_resp.data or []) if isinstance(r, dict)])

    if not rows:
        for group in chunked(video_ids, 400):
            ca_resp = execute(
                supa.table("chunk_analysis")
                .select("video_id,chunk_index,ticker,chunk_summary")
                .in_("video_id", group)
                .limit(5000),
                context="entities:top_movers:chunk_analysis_fallback",
            )
            for r in (ca_resp.data or []):
                if not isinstance(r, dict):
                    continue
                rows.append({"video_id": r.get("video_id"), "ticker": r.get("ticker"), "summary": r.get("chunk_summary")})

    if not rows:
        return []

    acc: dict[str, dict[str, Any]] = {}
    for r in rows:
        ticker = r.get("ticker")
        if not ticker:
            continue
        sym = str(ticker).strip().upper()
        if not sym or sym == "MARKET":
            continue

        summary_obj = r.get("summary")
        p, n, u = summary_sentiment_counts(summary_obj)
        if p + n + u <= 0:
            u = 1

        bucket = acc.setdefault(sym, {"symbol": sym, "positive": 0, "negative": 0, "neutral": 0, "reason": None})
        bucket["positive"] += int(p)
        bucket["negative"] += int(n)
        bucket["neutral"] += int(u)

        if not bucket.get("reason"):
            reason = first_claim_from_summary(summary_obj)
            if reason:
                bucket["reason"] = reason

    movers: list[dict[str, Any]] = []
    for sym, b in acc.items():
        pos = int(b.get("positive") or 0)
        neg = int(b.get("negative") or 0)
        neu = int(b.get("neutral") or 0)
        total = pos + neg + neu
        if total <= 0:
            continue

        if pos > neg:
            direction = "bullish"
        elif neg > pos:
            direction = "bearish"
        else:
            direction = "mixed"

        reason = str(b.get("reason") or "Mentioned frequently in recent coverage.").strip()
        movers.append({"symbol": sym, "direction": direction, "reason": reason, "_total": total, "_net": pos - neg})

    movers.sort(
        key=lambda m: (abs(int(m.get("_net") or 0)), int(m.get("_total") or 0), str(m.get("symbol") or "")),
        reverse=True,
    )
    for m in movers:
        m.pop("_total", None)
        m.pop("_net", None)

    return movers[:limit]


def chunks_for_entity(*, symbol: str, days: int, limit: int) -> list[dict[str, Any]]:
    sym = (symbol or "").strip().upper()
    if not sym:
        return []

    supa = get_supabase_client()

    now_utc = datetime.now(timezone.utc)
    start_utc = now_utc - timedelta(days=days)
    start = start_utc.isoformat()
    end = now_utc.isoformat()

    v_resp = execute(
        supa.table("videos")
        .select("video_id,published_at,video_url,channel,title")
        .gte("published_at", start)
        .lte("published_at", end)
        .limit(4000),
        context="entities:chunks_for_entity:videos",
    )
    vids = v_resp.data or []
    allowed_video_ids = [str(v["video_id"]) for v in vids if isinstance(v, dict) and v.get("video_id")]
    video_meta: dict[str, dict[str, Any]] = {str(v["video_id"]): v for v in vids if isinstance(v, dict) and v.get("video_id")}

    if not allowed_video_ids:
        return []

    q = (
        supa.table("chunk_analysis")
        .select(
            "video_id,chunk_index,ticker,chunk_summary,created_at,"
            "videos(video_url,video_id,channel,title,published_at)"
        )
        .eq("ticker", sym)
        .order("created_at", desc=True)
        .limit(limit)
    )
    q = q.in_("video_id", allowed_video_ids)

    ca_resp = execute(q, context="entities:chunks_for_entity:chunk_analysis")
    ca_rows = [r for r in (ca_resp.data or []) if isinstance(r, dict)]
    if not ca_rows:
        return []

    out: list[dict[str, Any]] = []
    for r in ca_rows:
        vid = r.get("video_id")
        idx = r.get("chunk_index")
        if not vid or idx is None:
            continue
        try:
            idx_i = int(idx)
        except Exception:
            continue

        embedded_video = r.get("videos") if isinstance(r.get("videos"), dict) else None
        v = embedded_video or video_meta.get(str(vid)) or {}
        published_at = v.get("published_at")
        market_date = str(published_at)[:10] if published_at else None

        summary_obj = r.get("chunk_summary")
        keypoint = first_claim_from_summary(summary_obj)
        if not keypoint:
            continue

        out.append(
            {
                "chunk_id": f"{vid}:{idx_i}",
                "entities": [{"type": "ticker", "symbol": sym}],
                "computed_at": r.get("created_at"),
                "market_date": market_date,
                "keypoint": keypoint,
                "videos": {
                    "video_url": v.get("video_url"),
                    "video_id": v.get("video_id") or vid,
                    "channel": v.get("channel"),
                    "title": v.get("title"),
                    "published_at": v.get("published_at"),
                },
            }
        )

    return out
