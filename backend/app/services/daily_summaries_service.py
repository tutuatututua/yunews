from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from app.core.supabase import get_supabase_client
from app.core.time import MARKET_TZ, parse_iso_datetime


def shape_daily_summary_row(row: dict[str, Any] | None, market_date: date) -> dict[str, Any] | None:
    if not isinstance(row, dict):
        return None
    if not (row.get("summary_markdown") or "").strip():
        return None

    return {
        "id": market_date.isoformat(),
        "market_date": market_date.isoformat(),
        "title": row.get("title") or f"Market Summary — {market_date.isoformat()}",
        "overall_summarize": row.get("overall_summarize") or "",
        "summary_markdown": row.get("summary_markdown") or "",
        "movers": row.get("movers") or [],
        "risks": row.get("risks") or [],
        "opportunities": row.get("opportunities") or [],
        "sentiment": row.get("sentiment"),
        "sentiment_confidence": row.get("sentiment_confidence"),
        "sentiment_reason": row.get("sentiment_reason") or "",
        "model": row.get("model") or "daily_summaries",
        "generated_at": row.get("generated_at") or datetime.now(timezone.utc).isoformat(),
    }


def get_daily_summary(market_date: date) -> dict[str, Any] | None:
    """Fetch from daily_summaries table if present; return API-shaped dict."""

    supa = get_supabase_client()
    resp = (
        supa.table("daily_summaries")
        .select(
            "market_date,title,overall_summarize,summary_markdown,movers,risks,opportunities,sentiment,sentiment_confidence,sentiment_reason,model,generated_at"
        )
        .eq("market_date", market_date.isoformat())
        .limit(1)
        .execute()
    )
    row = resp.data[0] if resp.data else None
    return shape_daily_summary_row(row, market_date)


def get_latest_daily_summary() -> dict[str, Any] | None:
    supa = get_supabase_client()
    resp = (
        supa.table("daily_summaries")
        .select(
            "market_date,title,overall_summarize,summary_markdown,movers,risks,opportunities,sentiment,sentiment_confidence,sentiment_reason,model,generated_at"
        )
        .order("market_date", desc=True)
        .limit(1)
        .execute()
    )

    row = resp.data[0] if resp.data else None
    if not isinstance(row, dict):
        return None
    raw_market_date = row.get("market_date")
    if not raw_market_date:
        return None

    market_date = date.fromisoformat(str(raw_market_date))
    return shape_daily_summary_row(row, market_date)


def list_daily_summaries(*, limit: int) -> list[dict[str, Any]]:
    # Get recent market dates from videos; for each date, prefer stored daily summary.
    supa = get_supabase_client()

    v_resp = (
        supa
        .table("videos")
        .select("published_at")
        .order("published_at", desc=True)
        .limit(2000)
        .execute()
    )

    seen: set[str] = set()
    dates: list[date] = []
    for row in v_resp.data or []:
        if not isinstance(row, dict):
            continue
        pa = row.get("published_at")
        if not pa:
            continue
        dt = parse_iso_datetime(pa)
        d = dt.astimezone(MARKET_TZ).date().isoformat()
        if d in seen:
            continue
        seen.add(d)
        dates.append(date.fromisoformat(d))
        if len(dates) >= limit:
            break

    if not dates:
        return []

    date_keys = [d.isoformat() for d in dates]
    s_resp = (
        supa.table("daily_summaries")
        .select(
            "market_date,title,overall_summarize,summary_markdown,movers,risks,opportunities,sentiment,sentiment_confidence,sentiment_reason,model,generated_at"
        )
        .in_("market_date", date_keys)
        .limit(len(date_keys))
        .execute()
    )

    rows_by_date: dict[str, dict[str, Any]] = {}
    for r in (s_resp.data or []):
        if not isinstance(r, dict):
            continue
        md = r.get("market_date")
        if not md:
            continue
        rows_by_date[str(md)] = r

    out: list[dict[str, Any]] = []
    for d in dates:
        if shaped := shape_daily_summary_row(rows_by_date.get(d.isoformat()), d):
            out.append(shaped)

    return out
