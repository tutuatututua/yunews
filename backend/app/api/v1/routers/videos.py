from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_videos_service
from app.core.errors import NotFoundError
from app.schemas.common import ApiResponse
from app.schemas.videos import VideoDetailData, VideoInfographicItem, VideoListItem
from app.services.videos import VideosService

router = APIRouter(prefix="/videos", tags=["videos"])


@router.get("", response_model=ApiResponse[list[VideoListItem]])
def list_videos(
	date_: date | None = Query(default=None, alias="date"),
	days: int | None = Query(default=None, ge=1, le=30),
	limit: int = Query(default=50, ge=1, le=200),
	svc: VideosService = Depends(get_videos_service),
) -> dict:
	return {"data": svc.list_videos(date_=date_, days=days, limit=limit)}


@router.get("/infographic", response_model=ApiResponse[list[VideoInfographicItem]])
def infographic(
	date_: date | None = Query(default=None, alias="date"),
	days: int = Query(default=7, ge=1, le=30),
	limit: int = Query(default=200, ge=1, le=500),
	svc: VideosService = Depends(get_videos_service),
) -> dict:
	"""Returns a compact (video -> tickers) structure for a recent time window.

	Used by the frontend to draw a video/ticker network infographic.
	"""

	return {"data": svc.video_infographic(date_=date_, days=days, limit=limit)}


@router.get("/{video_id}", response_model=ApiResponse[VideoDetailData])
def get_video(video_id: str, svc: VideosService = Depends(get_videos_service)) -> dict:
	detail = svc.get_video_detail(video_id=video_id)
	if detail is None:
		raise NotFoundError("Video not found")
	return {"data": detail}

