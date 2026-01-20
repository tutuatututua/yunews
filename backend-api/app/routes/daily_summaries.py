from __future__ import annotations

import logging

from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.schemas.common import ApiResponse
from app.schemas.daily_summaries import DailySummary
from app.services.daily_summaries_service import get_daily_summary, get_latest_daily_summary, list_daily_summaries

logger = logging.getLogger(__name__)

router = APIRouter(tags=["daily_summaries"])


@router.get("/daily-summaries/latest", response_model=ApiResponse[DailySummary | None])
def latest() -> dict:
    try:
        return {"data": get_latest_daily_summary()}
    except Exception:
        logger.exception("Failed to fetch latest daily summary")
        raise HTTPException(status_code=500, detail="Internal Server Error")


@router.get("/daily-summaries", response_model=ApiResponse[list[DailySummary]])
def list_daily(limit: int = Query(default=30, ge=1, le=365)) -> dict:
    try:
        return {"data": list_daily_summaries(limit=limit)}
    except Exception:
        logger.exception("Failed to list daily summaries")
        raise HTTPException(status_code=500, detail="Internal Server Error")


@router.get("/daily-summaries/{market_date}", response_model=ApiResponse[DailySummary | None])
def get_daily(market_date: date) -> dict:
    try:
        return {"data": get_daily_summary(market_date)}
    except Exception:
        logger.exception("Failed to fetch daily summary market_date=%s", market_date)
        raise HTTPException(status_code=500, detail="Internal Server Error")
