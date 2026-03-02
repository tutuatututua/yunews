from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_recommendations_service
from app.schemas.common import ApiResponse
from app.schemas.recommendations import RecommendationListData, RecommendationOverlayData
from app.services.recommendations import RecommendationsService

router = APIRouter(prefix="/recommendations", tags=["recommendations"])


@router.get("", response_model=ApiResponse[RecommendationListData])
def list_recommendations(
    symbol: str | None = Query(default=None, description="Optional ticker symbol filter (e.g. TSLA)."),
    days: int = Query(default=365, ge=1, le=3650, description="Lookback window in days."),
    limit: int = Query(default=200, ge=1, le=2000),
    service: RecommendationsService = Depends(get_recommendations_service),
) -> dict:
    return {"data": service.list_recommendations(symbol=symbol, days=days, limit=limit)}


@router.get("/overlay", response_model=ApiResponse[RecommendationOverlayData])
def overlay(
    symbol: str = Query(description="Ticker symbol (e.g. TSLA)."),
    days: int = Query(default=365, ge=1, le=3650, description="Lookback window for recommendation events."),
    service: RecommendationsService = Depends(get_recommendations_service),
) -> dict:
    return {"data": service.get_recommendation_overlay(symbol=symbol, days=days)}
