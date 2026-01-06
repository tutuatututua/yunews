from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException, Query
from supabase import create_client

from app.settings import settings

router = APIRouter(tags=["daily_summaries"])


def _client():
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


@router.get("/daily-summaries/latest")
def latest() -> dict:
    try:
        resp = (
            _client()
            .table("daily_summaries")
            .select("*")
            .order("market_date", desc=True)
            .limit(1)
            .execute()
        )
        return {"data": resp.data[0] if resp.data else None}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/daily-summaries")
def list_daily(limit: int = Query(default=30, ge=1, le=365)) -> dict:
    try:
        resp = (
            _client()
            .table("daily_summaries")
            .select("*")
            .order("market_date", desc=True)
            .limit(limit)
            .execute()
        )
        return {"data": resp.data}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/daily-summaries/{market_date}")
def get_daily(market_date: date) -> dict:
    try:
        resp = (
            _client()
            .table("daily_summaries")
            .select("*")
            .eq("market_date", market_date.isoformat())
            .limit(1)
            .execute()
        )
        return {"data": resp.data[0] if resp.data else None}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
