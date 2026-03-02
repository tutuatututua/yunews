from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_daily_summaries_service
from app.core.errors import NotFoundError
from app.schemas.common import ApiResponse
from app.schemas.daily_summaries import DailySummary
from app.services.daily_summaries import DailySummariesService

router = APIRouter(tags=["daily_summaries"])


@router.get("/daily-summaries/latest", response_model=ApiResponse[DailySummary])
def latest(svc: DailySummariesService = Depends(get_daily_summaries_service)) -> dict:
	summary = svc.get_latest_daily_summary()
	if summary is None:
		raise NotFoundError("Daily summary not found")
	return {"data": summary}


@router.get("/daily-summaries", response_model=ApiResponse[list[DailySummary]])
def list_daily(
	limit: int = Query(default=30, ge=1, le=365),
	svc: DailySummariesService = Depends(get_daily_summaries_service),
) -> dict:
	return {"data": svc.list_daily_summaries(limit=limit)}


@router.get("/daily-summaries/{market_date}", response_model=ApiResponse[DailySummary])
def get_daily(
	market_date: date,
	svc: DailySummariesService = Depends(get_daily_summaries_service),
) -> dict:
	summary = svc.get_daily_summary(market_date)
	if summary is None:
		raise NotFoundError("Daily summary not found")
	return {"data": summary}

