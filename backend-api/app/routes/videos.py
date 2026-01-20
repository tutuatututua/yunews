from __future__ import annotations

from datetime import date
import logging

from fastapi import APIRouter, HTTPException, Query

from app.schemas.common import ApiResponse
from app.schemas.videos import VideoDetailData, VideoInfographicItem, VideoListItem
from app.services.videos_service import get_video_detail, list_videos as svc_list_videos
from app.services.videos_service import video_infographic as svc_video_infographic

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/videos", tags=["videos"])


@router.get("", response_model=ApiResponse[list[VideoListItem]])
def list_videos(
    date_: date | None = Query(default=None, alias="date"),
    days: int | None = Query(default=None, ge=1, le=30),
    limit: int = Query(default=50, ge=1, le=200),
) -> dict:
    try:
        return {"data": svc_list_videos(date_=date_, days=days, limit=limit)}
    except Exception:
        logger.exception("Failed to list videos")
        raise HTTPException(status_code=500, detail="Internal Server Error")


@router.get("/infographic", response_model=ApiResponse[list[VideoInfographicItem]])
def infographic(
    date_: date | None = Query(default=None, alias="date"),
    days: int = Query(default=7, ge=1, le=30),
    limit: int = Query(default=200, ge=1, le=500),
) -> dict:
    """Returns a compact (video -> tickers) structure for a recent time window.

    Used by the frontend to draw a video/ticker network infographic.
    """

    try:
        return {"data": svc_video_infographic(date_=date_, days=days, limit=limit)}
    except Exception:
        logger.exception("Failed to build infographic")
        raise HTTPException(status_code=500, detail="Internal Server Error")


@router.get("/{video_id}", response_model=ApiResponse[VideoDetailData | None])
def get_video(video_id: str) -> dict:
    try:
        return {"data": get_video_detail(video_id)}
    except Exception:
        logger.exception("Failed to fetch video_id=%s", video_id)
        raise HTTPException(status_code=500, detail="Internal Server Error")
