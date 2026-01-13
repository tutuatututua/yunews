from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple

from fastapi import APIRouter, HTTPException, Query
from supabase import create_client

from app.settings import settings

router = APIRouter(tags=["daily_summaries"])


def _client():
    return create_client(settings.supabase_url, settings.supabase_key)


_EST = timezone(timedelta(hours=-5))


def _parse_iso_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    s = str(value)
    # Supabase commonly returns ISO with trailing 'Z'.
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _est_day_bounds(d: date) -> Tuple[str, str]:
    """Return (start_utc_iso, end_utc_iso) for an EST (UTC-5) calendar day."""

    start_local = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=_EST)
    end_local = datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=_EST)
    return start_local.astimezone(timezone.utc).isoformat(), end_local.astimezone(timezone.utc).isoformat()




def _shape_daily_summary_row(row: Dict[str, Any], market_date: date) -> Dict[str, Any] | None:
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




def _derive_daily_summary(market_date: date) -> Dict[str, Any] | None:
    """Fetch from daily_summaries table if present; return API-shaped dict."""

    try:
        # Backward compatibility: `overall_summarize` may not exist in older schemas.
        supa = _client()
        try:
            resp = (
                supa.table("daily_summaries")
                .select(
                    "market_date,title,overall_summarize,summary_markdown,movers,risks,opportunities,model,generated_at"
                )
                .eq("market_date", market_date.isoformat())
                .limit(1)
                .execute()
            )
        except Exception as exc:
            raise exc
        row = resp.data[0] if resp.data else None
        return _shape_daily_summary_row(row, market_date)
    except Exception:
        # Table may not exist in older deployments.
        return None


@router.get("/daily-summaries/latest")
def latest() -> dict:
    try:
        supa = _client()
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
            return {"data": None}
        raw_market_date = row.get("market_date")
        if not raw_market_date:
            return {"data": None}
        market_date = date.fromisoformat(str(raw_market_date))

        return {"data": _shape_daily_summary_row(row, market_date)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/daily-summaries")
def list_daily(limit: int = Query(default=30, ge=1, le=365)) -> dict:
    try:
        # Get recent market dates from videos; for each date, prefer stored daily summary, else derive.
        v_resp = (
            _client()
            .table("videos")
            .select("published_at")
            .order("published_at", desc=True)
            .limit(2000)
            .execute()
        )

        seen: set[str] = set()
        dates: List[date] = []
        for row in v_resp.data or []:
            if not isinstance(row, dict):
                continue
            pa = row.get("published_at")
            if not pa:
                continue
            dt = _parse_iso_datetime(pa)
            if not dt:
                continue
            d = dt.astimezone(_EST).date().isoformat()
            if d in seen:
                continue
            seen.add(d)
            dates.append(date.fromisoformat(d))
            if len(dates) >= limit:
                break

        data = [s for d in dates if (s := _derive_daily_summary(d)) is not None]
        return {"data": data}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/daily-summaries/{market_date}")
def get_daily(market_date: date) -> dict:
    try:
        return {"data": _derive_daily_summary(market_date)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
