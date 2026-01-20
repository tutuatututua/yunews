from __future__ import annotations

from datetime import date
import logging

from fastapi import APIRouter, HTTPException, Query

from app.schemas.common import ApiResponse
from app.schemas.entities import EntityChunkRow, TopMover
from app.services.entities_service import chunks_for_entity as svc_chunks_for_entity
from app.services.entities_service import top_movers as svc_top_movers

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/entities", tags=["entities"])


@router.get("/top-movers", response_model=ApiResponse[list[TopMover]])
def top_movers(
    date_: date | None = Query(default=None, alias="date"),
    days: int = Query(default=7, ge=1, le=30, description="Lookback window in days (default 7)."),
    limit: int = Query(default=8, ge=1, le=50),
) -> dict:
    """Compute a movers-like list from entity-level summaries.

    This is intentionally independent of `daily_summaries.movers` so the UI can
    render movers even when daily summaries haven't been generated.

    Windowing matches `/videos` and `/videos/infographic` (market calendar days).
    """

    try:
        return {"data": svc_top_movers(date_=date_, days=days, limit=limit)}
    except Exception:
        logger.exception("Failed to compute top movers")
        raise HTTPException(status_code=500, detail="Internal Server Error")


@router.get("/{symbol}", response_model=ApiResponse[list[EntityChunkRow]])
@router.get("/{symbol}/chunks", response_model=ApiResponse[list[EntityChunkRow]])
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

    try:
        if not (symbol or "").strip():
            raise HTTPException(status_code=400, detail="symbol is required")

        return {"data": svc_chunks_for_entity(symbol=symbol, days=days, limit=limit)}
    except Exception:
        logger.exception("Failed to fetch chunks for symbol=%s", (symbol or "").strip().upper())
        raise HTTPException(status_code=500, detail="Internal Server Error")
