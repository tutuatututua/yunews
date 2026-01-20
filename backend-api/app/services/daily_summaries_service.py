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
        "per_entity_summaries": None,
        "chunks_total": None,
        "chunks_used": None,
        "model": row.get("model") or "daily_summaries",
        "generated_at": row.get("generated_at") or datetime.now(timezone.utc).isoformat(),
    }


def get_daily_summary(market_date: date) -> dict[str, Any] | None:
    """Fetch from daily_summaries table if present; return API-shaped dict."""

    # Backward compatibility: `overall_summarize` may not exist in older schemas.
    try:
        supa = get_supabase_client()
        resp = (
            supa.table("daily_summaries")
            .select(
                "market_date,title,overall_summarize,summary_markdown,movers,risks,opportunities,model,generated_at"
            )
            .eq("market_date", market_date.isoformat())
            .limit(1)
            .execute()
        )
        row = resp.data[0] if resp.data else None
        return shape_daily_summary_row(row, market_date)
    except Exception:
        # Table may not exist in older deployments.
        return None


def get_latest_daily_summary() -> dict[str, Any] | None:
    supa = get_supabase_client()
    resp = (
        supa.table("daily_summaries")
        .select(
            "market_date,title,overall_summarize,summary_markdown,movers,risks,opportunities,model,generated_at"
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
    v_resp = (
        get_supabase_client()
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
        if not dt:
            continue
        d = dt.astimezone(MARKET_TZ).date().isoformat()
        if d in seen:
            continue
        seen.add(d)
        dates.append(date.fromisoformat(d))
        if len(dates) >= limit:
            break

    return [s for d in dates if (s := get_daily_summary(d)) is not None]
