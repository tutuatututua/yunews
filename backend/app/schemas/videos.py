from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class VideoListItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

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
    model_config = ConfigDict(extra="ignore")

    ticker: str
    sentiment: Literal["positive", "negative", "neutral"] = "neutral"
    key_points: list[str] = Field(default_factory=list)


class VideoInfographicItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    video_id: str
    title: str | None = None
    channel: str | None = None
    published_at: str | None = None
    video_url: str | None = None
    thumbnail_url: str | None = None
    edges: list[VideoInfographicEdge] = Field(default_factory=list)


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
    tickers: list[str] = Field(default_factory=list)


class VideoTickerDetail(BaseModel):
    """Per-ticker details sourced from the normalized `summaries` table."""

    model_config = ConfigDict(extra="ignore")

    ticker: str
    summary: dict[str, Any]
    sentiment: Literal["positive", "negative", "neutral"] = "neutral"
    key_points: list[str] = Field(default_factory=list)


class VideoSummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    summary_markdown: str = ""
    overall_explanation: str = ""
    movers: list[VideoMover] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    opportunities: list[str] = Field(default_factory=list)
    key_points: list[str] = Field(default_factory=list)
    tickers: list[str] = Field(default_factory=list)
    sentiment: str | None = None
    events: list[VideoEvent] = Field(default_factory=list)
    model: str
    summarized_at: str

    # From `video_summaries` table (when available)
    video_titles: str | None = None
    published_at: str | None = None


class VideoTranscript(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    transcript_text: str
    transcript_language: str | None = None


class VideoDetailData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    video: dict[str, Any]
    transcript: VideoTranscript | None = None
    summary: VideoSummary | None = None
    ticker_details: list[VideoTickerDetail] = Field(default_factory=list)
