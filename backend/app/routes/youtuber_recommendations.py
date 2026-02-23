from __future__ import annotations

from fastapi import APIRouter, Query

from app.schemas.common import ApiResponse
from app.schemas.youtuber_recommendations import RecommendationListData, RecommendationOverlayData
from app.services.youtuber_recommendations_service import (
    get_recommendation_overlay as svc_get_recommendation_overlay,
    list_recommendations as svc_list_recommendations,
)

router = APIRouter(prefix="/youtuber-recommendations", tags=["youtuber-recommendations"])


@router.get("", response_model=ApiResponse[RecommendationListData])
def list_recommendations(
    symbol: str | None = Query(default=None, description="Optional ticker symbol filter (e.g. TSLA)."),
    days: int = Query(default=365, ge=1, le=3650, description="Lookback window in days."),
    limit: int = Query(default=200, ge=1, le=2000),
) -> dict:
    return {"data": svc_list_recommendations(symbol=symbol, days=days, limit=limit)}


@router.get("/overlay", response_model=ApiResponse[RecommendationOverlayData])
def overlay(
    symbol: str = Query(description="Ticker symbol (e.g. TSLA)."),
    days: int = Query(default=365, ge=1, le=3650, description="Lookback window for recommendation events."),
) -> dict:
    return {"data": svc_get_recommendation_overlay(symbol=symbol, days=days)}
