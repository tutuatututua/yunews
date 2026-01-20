from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class VideoListItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | None = None
    video_id: str | None = None
    title: str | None = None
    channel: str | None = None
    published_at: str | None = None
    video_url: str | None = None
    thumbnail_url: str | None = None
    view_count: int | None = None
    like_count: int | None = None
    comment_count: int | None = None
    duration_seconds: int | None = None
    overall_explanation: str | None = None
    sentiment: str | None = None


class VideoInfographicEdge(BaseModel):
    model_config = ConfigDict(extra="allow")

    ticker: str
    sentiment: str = "neutral"
    key_points: list[str] = []


class VideoInfographicItem(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    video_id: str
    title: str | None = None
    channel: str | None = None
    published_at: str | None = None
    video_url: str | None = None
    thumbnail_url: str | None = None
    edges: list[VideoInfographicEdge] = []


class VideoMover(BaseModel):
    model_config = ConfigDict(extra="ignore")

    symbol: str
    direction: Literal["up", "down", "mixed"]
    reason: str


class VideoEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    date: str | None = None
    timeframe: str | None = None
    description: str
    tickers: list[str] = []


class VideoSummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    summary_markdown: str
    overall_explanation: str = ""
    movers: list[VideoMover] = []
    risks: list[str] = []
    opportunities: list[str] = []
    key_points: list[str] = []
    tickers: list[str] = []
    sentiment: str | None = None
    events: list[VideoEvent] = []
    model: str
    summarized_at: str


class VideoTranscript(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    transcript_text: str
    transcript_language: str | None = None


class VideoDetailData(BaseModel):
    model_config = ConfigDict(extra="allow")

    video: dict[str, Any]
    transcript: VideoTranscript | None = None
    summary: VideoSummary | None = None
