from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.core.supabase import get_supabase_client
from app.core.time import MARKET_TZ, market_today, parse_iso_datetime
from app.schemas.recommendations import (
    PriceBar,
    RecommendationEvent,
    RecommendationListData,
    RecommendationOverlayData,
)
from app.services.market_data_service import fetch_daily_close_series

logger = logging.getLogger(__name__)


def _normalize_symbol(symbol: str | None) -> str | None:
    s = str(symbol or "").strip().upper()
    return s or None


def _utc_today() -> date:
    # Keep function name for backward compatibility; the overlay should align
    # with US market dates (ET) rather than raw UTC calendar days.
    return market_today()


def _subtract_months(d: date, months: int) -> date:
    m = int(months)
    if m <= 0:
        return d
    month0 = d.month - m
    year = d.year
    while month0 <= 0:
        year -= 1
        month0 += 12
    last_day = calendar.monthrange(year, month0)[1]
    day = min(d.day, last_day)
    return date(year, month0, day)


def _fetch_recommendation_rows(*, symbol: str | None, days: int, limit: int) -> list[dict[str, Any]]:
    """Read recommendation events from `youtuber_recommendations` joined to `videos`.

    Returns an empty list when the table is missing or on query errors.
    """

    supa = get_supabase_client()
    sym = _normalize_symbol(symbol)

    start_dt = datetime.now(timezone.utc) - timedelta(days=max(1, int(days)))
    try:
        q = (
            supa.table("youtuber_recommendations")
            .select(
                "video_id,ticker,action,published_at,"
                "videos(title,channel,published_at,video_url,thumbnail_url)"
            )
            .gte("published_at", start_dt.isoformat())
            .order("published_at", desc=True)
            .limit(max(1, min(2000, int(limit))))
        )
        if sym:
            q = q.eq("ticker", sym)
        resp = q.execute()
        rows = resp.data or []
        return [r for r in rows if isinstance(r, dict)]
    except Exception as exc:
        # Backward compatibility: older DBs may not have youtuber_recommendations.published_at.
        # In that case, fall back to joining videos and filtering/sorting in Python.
        try:
            q = (
                supa.table("youtuber_recommendations")
                .select(
                    "video_id,ticker,action,created_at,"
                    "videos(title,channel,published_at,video_url,thumbnail_url)"
                )
                .order("created_at", desc=True)
                .limit(max(1, min(2000, int(limit))))
            )
            if sym:
                q = q.eq("ticker", sym)
            resp = q.execute()
            rows = [r for r in (resp.data or []) if isinstance(r, dict)]

            def _get_published_dt(row: dict[str, Any]) -> datetime | None:
                pa_row = row.get("published_at")
                if pa_row:
                    try:
                        return parse_iso_datetime(str(pa_row)).astimezone(timezone.utc)
                    except Exception:
                        return None
                v = row.get("videos")
                if isinstance(v, list):
                    v = v[0] if v else None
                if not isinstance(v, dict):
                    return None
                pa = v.get("published_at")
                if not pa:
                    return None
                try:
                    return parse_iso_datetime(str(pa)).astimezone(timezone.utc)
                except Exception:
                    return None

            start_dt_utc = start_dt.astimezone(timezone.utc)
            filtered: list[dict[str, Any]] = []
            for r in rows:
                pub_dt = _get_published_dt(r)
                if pub_dt is None:
                    continue
                if pub_dt >= start_dt_utc:
                    filtered.append(r)

            filtered.sort(key=lambda r: (_get_published_dt(r) or datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
            return filtered
        except Exception as exc2:
            msg = str(exc2)
            if "youtuber_recommendations" in msg and (
                "does not exist" in msg or "relation" in msg or "404" in msg
            ):
                return []
            logger.exception("Failed to query youtuber_recommendations")
            return []


def list_recommendations(*, symbol: str | None, days: int, limit: int) -> RecommendationListData:
    sym = _normalize_symbol(symbol)
    days = max(1, int(days))
    limit = max(1, int(limit))

    rows = _fetch_recommendation_rows(symbol=sym, days=days, limit=limit)

    events: list[RecommendationEvent] = []
    for r in rows:
        vid = str(r.get("video_id") or "").strip()
        ticker = _normalize_symbol(r.get("ticker"))
        if not vid or not ticker or ticker == "MARKET":
            continue

        v = r.get("videos")
        if isinstance(v, list):
            v = v[0] if v else None
        if not isinstance(v, dict):
            v = {}

        published_at = r.get("published_at") or v.get("published_at")

        events.append(
            RecommendationEvent(
                video_id=vid,
                ticker=ticker,
                action="buy",
                title=v.get("title"),
                channel=v.get("channel"),
                published_at=published_at,
                video_url=v.get("video_url"),
                thumbnail_url=v.get("thumbnail_url"),
            )
        )

    return RecommendationListData(items=events)


def _close_on_or_after(prices: list[PriceBar], target: date) -> tuple[str | None, float | None]:
    """Return the first available close on/after `target`.

    Market data sources sometimes return bars newest→oldest; callers expect this
    helper to work regardless of input ordering.
    """

    if not prices:
        return None, None

    def _px(b: PriceBar) -> float | None:
        if b.adj_close is not None:
            try:
                return float(b.adj_close)
            except Exception:
                return None
        if b.close is None:
            return None
        try:
            return float(b.close)
        except Exception:
            return None

    parsed: list[tuple[date, str, float | None]] = []
    for b in prices:
        d = str(b.date or "").strip()
        if not d:
            continue
        try:
            bd = date.fromisoformat(d)
        except Exception:
            continue
        parsed.append((bd, d, _px(b)))

    if not parsed:
        return None, None

    # Earliest bar on/after target.
    candidate: tuple[date, str, float | None] | None = None
    for row in parsed:
        bd = row[0]
        if bd < target:
            continue
        if candidate is None or bd < candidate[0]:
            candidate = row

    if candidate is not None:
        _, d, px = candidate
        return d, px

    # If target is after our last bar, fall back to the latest bar.
    latest = max(parsed, key=lambda r: r[0])
    _, d, px = latest
    return d, px


def get_recommendation_overlay(*, symbol: str, days: int) -> RecommendationOverlayData:
    sym = _normalize_symbol(symbol)
    if not sym:
        return RecommendationOverlayData(symbol="", prices=[], events=[])

    days_i = max(1, int(days))

    recs = list_recommendations(symbol=sym, days=days_i, limit=2000)
    events = recs.items
    if not events:
        return RecommendationOverlayData(symbol=sym, prices=[], events=[])

    end = _utc_today()
    # Price history must span the recommendation lookback window; otherwise we can't
    # resolve each event's entry close ("next trading day" logic) for older events.
    start = end - timedelta(days=days_i)

    prices_raw: list[dict[str, Any]]
    try:
        prices_raw = fetch_daily_close_series(symbol=sym, start=start, end=end)
    except Exception:
        logger.warning("market data unavailable for overlay", extra={"symbol": sym})
        prices_raw = []

    prices: list[PriceBar] = []
    for b in prices_raw:
        if not isinstance(b, dict):
            continue
        try:
            prices.append(PriceBar.model_validate(b))
        except Exception:
            continue

    latest_date, latest_close = _close_on_or_after(prices, end)

    enriched: list[RecommendationEvent] = []
    for e in events:
        entry_date: date | None = None
        if e.published_at:
            try:
                # Group recommendations by US market day (ET).
                entry_date = parse_iso_datetime(e.published_at).astimezone(MARKET_TZ).date()
            except Exception:
                entry_date = None

        if entry_date is None:
            enriched.append(e)
            continue

        entry_iso, entry_close = _close_on_or_after(prices, entry_date)
        if entry_close is None or latest_close is None or entry_close == 0:
            enriched.append(
                e.model_copy(
                    update={
                        "entry_date": entry_iso,
                        "entry_close": entry_close,
                        "latest_date": latest_date,
                        "latest_close": latest_close,
                    }
                )
            )
            continue

        entry_close_f = float(entry_close)

        def _ret_pct(close_at: float | None) -> float | None:
            if close_at is None or entry_close_f == 0:
                return None
            return (float(close_at) - entry_close_f) / entry_close_f

        d7 = entry_date + timedelta(days=7)
        d30 = entry_date + timedelta(days=30)
        _, close7 = _close_on_or_after(prices, d7)
        _, close30 = _close_on_or_after(prices, d30)

        enriched.append(
            e.model_copy(
                update={
                    "entry_date": entry_iso,
                    "entry_close": entry_close,
                    "latest_date": latest_date,
                    "latest_close": latest_close,
                    "return_pct": _ret_pct(latest_close),
                    "return_7d_pct": _ret_pct(close7),
                    "return_30d_pct": _ret_pct(close30),
                }
            )
        )

    return RecommendationOverlayData(symbol=sym, prices=prices, events=enriched)
