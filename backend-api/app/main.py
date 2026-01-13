from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import daily_summaries, entities, health, videos

app = FastAPI(title="yuNews Backend API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"]
)

app.include_router(health.router)
app.include_router(daily_summaries.router)
app.include_router(videos.router)
app.include_router(entities.router)
