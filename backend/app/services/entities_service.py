from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.core.supabase import get_supabase_client
from app.core.time import market_day_bounds, market_today, parse_iso_datetime

_MAX_VIDEOS_SCAN = 4000
_VIDEO_ID_CHUNK_SIZE = 400
_SUMMARY_BATCH_LIMIT = 5000
_CHUNKS_PREFETCH_MULTIPLIER = 3
_CHUNKS_PREFETCH_CAP = 1500


def _clamp_int(value: int, *, min_value: int, max_value: int) -> int:
    try:
        n = int(value)
    except Exception:
        return min_value
    return max(min_value, min(max_value, n))


def _normalize_symbol(symbol: str) -> str:
    return (symbol or "").strip().upper()


def first_claim_from_summary(summary_obj: Any) -> str | None:
    if not isinstance(summary_obj, dict):
        return None
    for key in ("positive", "negative", "neutral", "bull_case", "bear_case", "risks"):
        items = summary_obj.get(key)
        if isinstance(items, list) and items:
            first = items[0]
            if isinstance(first, str):
                s = first.strip()
                if s:
                    return s

            if isinstance(first, dict):
                for k in ("claim", "text", "reason", "summary", "content"):
                    v = first.get(k)
                    if isinstance(v, str) and v.strip():
                        return v.strip()

            s = str(first).strip()
            if s and s.lower() not in ("none", "null", "{}", "[]"):
                return s
    return None


def keypoints_from_summary(summary_obj: Any, *, max_items: int = 12) -> list[str]:
    if not isinstance(summary_obj, dict):
        return []

    max_items = _clamp_int(max_items, min_value=1, max_value=50)
    out: list[str] = []
    seen: set[str] = set()

    def _add(value: Any) -> None:
        if len(out) >= max_items:
            return
        s = str(value).strip()
        if not s:
            return
        if s.lower() in ("none", "null", "{}", "[]"):
            return
        if s in seen:
            return
        seen.add(s)
        out.append(s)

    for key in ("positive", "negative", "neutral", "bull_case", "bear_case", "risks"):
        items = summary_obj.get(key)
        if not isinstance(items, list) or not items:
            continue
        for item in items:
            if len(out) >= max_items:
                break

            if isinstance(item, str):
                _add(item)
                continue

            if isinstance(item, dict):
                # Prefer common structured fields when present.
                for k in ("claim", "text", "reason", "summary", "content"):
                    v = item.get(k)
                    if isinstance(v, str) and v.strip():
                        _add(v)
                        break
                else:
                    _add(item)
                continue

            _add(item)

    return out


def keypoints_by_sentiment_from_summary(
    summary_obj: Any,
    *,
    max_items_per_bucket: int = 12,
) -> dict[str, list[str]]:
    """Extract keypoints grouped by sentiment.

    Supported summary shapes:
    - {positive: [...], negative: [...], neutral: [...]} (preferred)
    - {bull_case: [...], bear_case: [...], risks: [...]} (mapped to pos/neg)
    """

    if not isinstance(summary_obj, dict):
        return {"positive": [], "negative": [], "neutral": []}

    max_items_per_bucket = _clamp_int(max_items_per_bucket, min_value=1, max_value=50)

    def _extract(items: Any) -> list[str]:
        if not isinstance(items, list) or not items:
            return []

        out: list[str] = []
        seen: set[str] = set()

        def _add(value: Any) -> None:
            if len(out) >= max_items_per_bucket:
                return
            s = str(value).strip()
            if not s:
                return
            if s.lower() in ("none", "null", "{}", "[]"):
                return
            if s in seen:
                return
            seen.add(s)
            out.append(s)

        for item in items:
            if len(out) >= max_items_per_bucket:
                break

            if isinstance(item, str):
                _add(item)
                continue

            if isinstance(item, dict):
                for k in ("claim", "text", "reason", "summary", "content"):
                    v = item.get(k)
                    if isinstance(v, str) and v.strip():
                        _add(v)
                        break
                else:
                    _add(item)
                continue

            _add(item)

        return out

    # Preferred shape
    if any(k in summary_obj for k in ("positive", "negative", "neutral")):
        return {
            "positive": _extract(summary_obj.get("positive")),
            "negative": _extract(summary_obj.get("negative")),
            "neutral": _extract(summary_obj.get("neutral")),
        }

    # Legacy shape
    return {
        "positive": _extract(summary_obj.get("bull_case")),
        "negative": _extract((summary_obj.get("bear_case") or [])) + _extract((summary_obj.get("risks") or [])),
        "neutral": [],
    }


def chunked(items: list[str], size: int):
    if size <= 0:
        raise ValueError("chunk size must be positive")
    for i in range(0, len(items), size):
        yield items[i : i + size]


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


def top_movers(*, date_: date | None, days: int, limit: int) -> list[dict[str, Any]]:
    supa = get_supabase_client()

    days = _clamp_int(days, min_value=1, max_value=30)
    limit = _clamp_int(limit, min_value=1, max_value=50)

    end_d = date_ or market_today()
    start_d = end_d - timedelta(days=days - 1)
    start, _ = market_day_bounds(start_d)
    _, end = market_day_bounds(end_d)

    v_resp = (
        supa.table("videos")
        .select("video_id")
        .gte("published_at", start)
        .lte("published_at", end)
        .order("published_at", desc=True)
        .limit(_MAX_VIDEOS_SCAN)
        .execute()
    )
    video_ids = [str(r.get("video_id")) for r in (v_resp.data or []) if isinstance(r, dict) and r.get("video_id")]
    if not video_ids:
        return []

    acc: dict[str, dict[str, Any]] = {}

    for group in chunked(video_ids, _VIDEO_ID_CHUNK_SIZE):
        s_resp = (
            supa.table("summaries")
            .select("video_id,ticker,summary")
            .in_("video_id", group)
            .limit(_SUMMARY_BATCH_LIMIT)
            .execute()
        )
        for r in (s_resp.data or []):
            if not isinstance(r, dict):
                continue

            ticker = r.get("ticker")
            if not ticker:
                continue
            sym = _normalize_symbol(str(ticker))
            if not sym or sym == "MARKET":
                continue

            summary_obj = r.get("summary")
            p, n, u = summary_sentiment_counts(summary_obj)
            if p + n + u <= 0:
                u = 1

            bucket = acc.setdefault(
                sym, {"symbol": sym, "positive": 0, "negative": 0, "neutral": 0, "reason": None}
            )
            bucket["positive"] += int(p)
            bucket["negative"] += int(n)
            bucket["neutral"] += int(u)

            if not bucket.get("reason"):
                reason = first_claim_from_summary(summary_obj)
                if reason:
                    bucket["reason"] = reason

    if not acc:
        return []

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
    sym = _normalize_symbol(symbol)
    if not sym:
        return []

    days = _clamp_int(days, min_value=1, max_value=30)
    limit = _clamp_int(limit, min_value=1, max_value=500)

    supa = get_supabase_client()

    now_utc = datetime.now(timezone.utc)
    start_utc = now_utc - timedelta(days=days)
    start = start_utc.isoformat()
    end = now_utc.isoformat()

    v_resp = (
        supa.table("videos")
        .select("video_id,published_at,video_url,channel,title")
        .gte("published_at", start)
        .lte("published_at", end)
        .order("published_at", desc=True)
        .limit(_MAX_VIDEOS_SCAN)
        .execute()
    )
    vids = v_resp.data or []
    allowed_video_ids = [str(v["video_id"]) for v in vids if isinstance(v, dict) and v.get("video_id")]
    video_meta: dict[str, dict[str, Any]] = {str(v["video_id"]): v for v in vids if isinstance(v, dict) and v.get("video_id")}

    if not allowed_video_ids:
        return []

    prefetch = min(max(limit * _CHUNKS_PREFETCH_MULTIPLIER, limit), _CHUNKS_PREFETCH_CAP)
    q = (
        supa.table("summaries")
        .select(
            "video_id,ticker,summary,created_at,"
            "videos(video_url,video_id,channel,title,published_at)"
        )
        .eq("ticker", sym)
        .order("created_at", desc=True)
        .limit(prefetch)
        .in_("video_id", allowed_video_ids)
    )

    ca_resp = q.execute()
    ca_rows = [r for r in (ca_resp.data or []) if isinstance(r, dict)]
    if not ca_rows:
        return []

    out: list[dict[str, Any]] = []
    for r in ca_rows:
        vid = r.get("video_id")

        v: dict[str, Any] = {}
        embedded_video = r.get("videos") if isinstance(r.get("videos"), dict) else None
        if isinstance(embedded_video, dict):
            v = embedded_video
        else:
            meta = video_meta.get(str(vid))
            if isinstance(meta, dict):
                v = meta
        published_at = v.get("published_at")
        market_date = str(published_at)[:10] if published_at else None

        summary_obj = r.get("summary")
        keypoints_by_sentiment = keypoints_by_sentiment_from_summary(summary_obj)
        if not any(keypoints_by_sentiment.values()):
            continue

        out.append(
            {
                "entities": [{"type": "ticker", "symbol": sym}],
                "computed_at": r.get("created_at"),
                "market_date": market_date,
                "keypoints_by_sentiment": keypoints_by_sentiment,
                "videos": {
                    "video_url": v.get("video_url"),
                    "video_id": v.get("video_id") or vid,
                    "channel": v.get("channel"),
                    "title": v.get("title"),
                    "published_at": v.get("published_at"),
                },
            }
        )

    def _sort_key(row: dict[str, Any]):
        videos_obj = row.get("videos")
        v: dict[str, Any] = videos_obj if isinstance(videos_obj, dict) else {}
        published_at = v.get("published_at")
        computed_at = row.get("computed_at")

        try:
            pub_dt = parse_iso_datetime(published_at)
        except Exception:
            pub_dt = datetime.min.replace(tzinfo=timezone.utc)

        try:
            comp_dt = parse_iso_datetime(computed_at)
        except Exception:
            comp_dt = datetime.min.replace(tzinfo=timezone.utc)

        return (pub_dt, comp_dt)

    out.sort(key=_sort_key, reverse=True)
    return out[:limit]
