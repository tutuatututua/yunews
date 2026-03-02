from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.routers import (
    chat,
    daily_summaries,
    entities,
    recommendations,
    videos,
)
from app.routes.health import router as health_router

public_router = APIRouter()
public_router.include_router(health_router)

protected_router = APIRouter()
protected_router.include_router(daily_summaries.router)
protected_router.include_router(videos.router)
protected_router.include_router(entities.router)
protected_router.include_router(chat.router)
protected_router.include_router(recommendations.router)
