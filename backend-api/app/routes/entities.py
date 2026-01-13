from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, HTTPException, Query
from supabase import create_client

from app.settings import settings

router = APIRouter(prefix="/entities", tags=["entities"])


def _client():
    return create_client(settings.supabase_url, settings.supabase_key)


_EST = timezone(timedelta(hours=-5))


def _est_today() -> date:
    return datetime.now(timezone.utc).astimezone(_EST).date()


def _est_day_bounds(d: date) -> Tuple[str, str]:
    """Return (start_utc_iso, end_utc_iso) for an EST (UTC-5) calendar day."""

    start_local = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=_EST)
    end_local = datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=_EST)
    return start_local.astimezone(timezone.utc).isoformat(), end_local.astimezone(timezone.utc).isoformat()


def _utc_day_bounds(d: date) -> Tuple[str, str]:
    start = d.isoformat() + "T00:00:00+00:00"
    end = d.isoformat() + "T23:59:59+00:00"
    return start, end


def _first_claim_from_summary(summary_obj: Any) -> str | None:
    if not isinstance(summary_obj, dict):
        return None
    for key in ("positive", "negative", "neutral", "bull_case", "bear_case", "risks"):
        items = summary_obj.get(key)
        if isinstance(items, list) and items:
            s = str(items[0]).strip()
            if s:
                return s
    return None


def _chunked(seq: List[str], size: int) -> List[List[str]]:
    return [seq[i : i + size] for i in range(0, len(seq), size)]


def _summary_sentiment_counts(summary_obj: Any) -> tuple[int, int, int]:
    """Return (positive, negative, neutral) counts for supported schemas."""

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

    # Alternate schema used by some extractors.
    bull = summary_obj.get("bull_case")
    bear = summary_obj.get("bear_case")
    risks = summary_obj.get("risks")
    p = len(bull) if isinstance(bull, list) else 0
    n = (len(bear) if isinstance(bear, list) else 0) + (len(risks) if isinstance(risks, list) else 0)
    return p, n, 0


@router.get("/top-movers")
def top_movers(
    date_: date | None = Query(default=None, alias="date"),
    days: int = Query(default=7, ge=1, le=30, description="Lookback window in days (default 7)."),
    limit: int = Query(default=8, ge=1, le=50),
) -> dict:
    """Compute a movers-like list from entity-level summaries.

    This is intentionally independent of `daily_summaries.movers` so the UI can
    render movers even when daily summaries haven't been generated.

    Windowing matches `/videos` and `/videos/infographic` (EST calendar days).
    """

    try:
        supa = _client()

        end_d = date_ or _est_today()
        start_d = end_d - timedelta(days=days - 1)
        start, _ = _est_day_bounds(start_d)
        _, end = _est_day_bounds(end_d)

        v_resp = (
            supa.table("videos")
            .select("video_id")
            .gte("published_at", start)
            .lte("published_at", end)
            .order("published_at", desc=True)
            .limit(4000)
            .execute()
        )
        video_ids = [str(r.get("video_id")) for r in (v_resp.data or []) if isinstance(r, dict) and r.get("video_id")]
        if not video_ids:
            return {"data": []}

        # Prefer the per-(video,ticker) aggregated `summaries` table to avoid
        # pulling raw chunk-level rows.
        rows: List[Dict[str, Any]] = []
        for group in _chunked(video_ids, 400):
            s_resp = (
                supa.table("summaries")
                .select("video_id,ticker,summary")
                .in_("video_id", group)
                .limit(5000)
                .execute()
            )
            rows.extend([r for r in (s_resp.data or []) if isinstance(r, dict)])

        # Fallback: if `summaries` isn't populated, derive from chunk-level analysis.
        if not rows:
            for group in _chunked(video_ids, 400):
                ca_resp = (
                    supa.table("chunk_analysis")
                    .select("video_id,chunk_index,ticker,chunk_summary")
                    .in_("video_id", group)
                    .limit(5000)
                    .execute()
                )
                for r in (ca_resp.data or []):
                    if not isinstance(r, dict):
                        continue
                    rows.append(
                        {
                            "video_id": r.get("video_id"),
                            "ticker": r.get("ticker"),
                            "summary": r.get("chunk_summary"),
                        }
                    )

        if not rows:
            return {"data": []}

        acc: Dict[str, Dict[str, Any]] = {}
        for r in rows:
            ticker = r.get("ticker")
            if not ticker:
                continue
            sym = str(ticker).strip().upper()
            if not sym or sym == "MARKET":
                continue

            summary_obj = r.get("summary")
            p, n, u = _summary_sentiment_counts(summary_obj)
            if p + n + u <= 0:
                # Still count it as a mention if schema doesn't provide buckets.
                u = 1

            bucket = acc.setdefault(
                sym,
                {
                    "symbol": sym,
                    "positive": 0,
                    "negative": 0,
                    "neutral": 0,
                    "reason": None,
                },
            )
            bucket["positive"] += int(p)
            bucket["negative"] += int(n)
            bucket["neutral"] += int(u)

            if not bucket.get("reason"):
                reason = _first_claim_from_summary(summary_obj)
                if reason:
                    bucket["reason"] = reason

        movers: List[Dict[str, Any]] = []
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
            movers.append(
                {
                    "symbol": sym,
                    "direction": direction,
                    "reason": reason,
                    "_total": total,
                    "_net": pos - neg,
                }
            )

        # Sort before sending: strongest movers first.
        # Primary: absolute net sentiment (pos-neg)
        # Secondary: total mentions
        # Tertiary: symbol for stable ordering
        movers.sort(
            key=lambda m: (
                abs(int(m.get("_net") or 0)),
                int(m.get("_total") or 0),
                str(m.get("symbol") or ""),
            ),
            reverse=True,
        )
        for m in movers:
            m.pop("_total", None)
            m.pop("_net", None)

        return {"data": movers[:limit]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{symbol}")
@router.get("/{symbol}/chunks")
def chunks_for_entity(
    symbol: str,
    days: int = Query(default=7, ge=1, le=30, description="Lookback window in days (default 7)."),
    limit: int = Query(default=100, ge=1, le=500),
) -> dict:
    """Returns recent (last week) keypoints mentioning a ticker symbol.

    The current local-pipeline schema stores ticker mentions in `chunk_analysis` with a
    JSON `chunk_summary`. This endpoint intentionally does NOT return transcript text.

    Filtering:
    - Always filters to the last `days` days using `videos.published_at` (UTC).

    """

    sym = (symbol or "").strip().upper()
    if not sym:
        raise HTTPException(status_code=400, detail="symbol is required")

    try:
        supa = _client()

        # Always filter via videos.published_at (UTC) using a rolling lookback window.
        now_utc = datetime.now(timezone.utc)
        start_utc = now_utc - timedelta(days=days)
        start = start_utc.isoformat()
        end = now_utc.isoformat()

        v_resp = (
            supa.table("videos")
            .select("video_id,published_at,video_url,channel,title")
            .gte("published_at", start)
            .lte("published_at", end)
            .limit(4000)
            .execute()
        )
        vids = v_resp.data or []
        allowed_video_ids: List[str] = [
            str(v["video_id"]) for v in vids if isinstance(v, dict) and v.get("video_id")
        ]
        video_meta: Dict[str, Dict[str, Any]] = {}
        for v in vids:
            if isinstance(v, dict) and v.get("video_id"):
                video_meta[str(v["video_id"])] = v

        if not allowed_video_ids:
            return {"data": []}

        # Pull rows from chunk_analysis and embed basic video info when available.
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

        ca_resp = q.execute()
        ca_rows = [r for r in (ca_resp.data or []) if isinstance(r, dict)]
        if not ca_rows:
            return {"data": []}

        out: List[Dict[str, Any]] = []
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
            keypoint = _first_claim_from_summary(summary_obj)
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

        return {"data": out}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
