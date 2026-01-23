from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field
from pydantic import model_validator


class VideoMetadata(BaseModel):
    video_id: str
    title: str
    channel: str
    published_at: datetime
    description: str
    duration_seconds: Optional[int] = None

    # Useful YouTube metadata for explaining content / ranking
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None

    view_count: Optional[int] = None
    like_count: Optional[int] = None
    comment_count: Optional[int] = None

    tags: Optional[list[str]] = None
    category_id: Optional[str] = None
    default_language: Optional[str] = None
    default_audio_language: Optional[str] = None

    channel_subscriber_count: Optional[int] = None
    channel_video_count: Optional[int] = None


class TranscriptEntry(BaseModel):
    start: float
    duration: float
    text: str


class TranscriptChunk(BaseModel):
    video_id: str
    chunk_index: int
    chunk_start_time: float
    chunk_end_time: float
    chunk_text: str


class TickerTopicPair(BaseModel):
    """Per-ticker categorized keypoints extracted from a chunk."""

    ticker: str = Field(description="Uppercase ticker without $ prefix")
    positive_keypoints: list[str] = Field(default_factory=list, description="Positive/bullish points about this ticker")
    negative_keypoints: list[str] = Field(default_factory=list, description="Negative/bearish points about this ticker")
    neutral_keypoints: list[str] = Field(default_factory=list, description="Neutral/factual points about this ticker")


class ExtractionResult(BaseModel):
    """Extraction result with one entry per ticker."""

    ticker_topic_pairs: list[TickerTopicPair] = Field(default_factory=list, description="Per-ticker keypoints")
    # Keep legacy fields for backward compatibility (deprecated)
    tickers: list[str] = Field(default_factory=list, description="Uppercase tickers without $ prefix [DEPRECATED]")


class AggregatedSummary(BaseModel):
    """Aggregated keypoints structure.

    Current format (preferred): {positive, negative, neutral}
    Legacy format (accepted on input): {bull_case, bear_case, risks}
    """

    positive: list[str] = Field(default_factory=list)
    negative: list[str] = Field(default_factory=list)
    neutral: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _accept_legacy_formats(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        if any(k in data for k in ("positive", "negative", "neutral")):
            return data

        # Legacy mapping.
        bull = data.get("bull_case") or []
        bear = data.get("bear_case") or []
        risks = data.get("risks") or []

        positive = list(bull) if isinstance(bull, list) else []
        negative: list[Any] = []
        if isinstance(bear, list):
            negative.extend(bear)
        if isinstance(risks, list):
            negative.extend(risks)

        return {
            "positive": [str(x) for x in positive if str(x).strip()],
            "negative": [str(x) for x in negative if str(x).strip()],
            "neutral": [],
        }


class VideoEvent(BaseModel):
    """Transcript-grounded dated catalyst/event mentioned in the video."""

    # ISO date (YYYY-MM-DD) if the transcript provides an explicit date; otherwise null.
    date: Optional[str] = None
    # Short timeframe hint when there's no exact date (e.g., "next week", "Q1").
    timeframe: Optional[str] = None
    description: str = ""
    tickers: list[str] = Field(default_factory=list)


class VideoMover(BaseModel):
    symbol: str
    direction: Literal["up", "down", "mixed"]
    reason: str


class VideoOverallSummary(BaseModel):
    """Overall per-video summary (stored in `video_summaries`)."""

    summary_markdown: str = ""
    overall_explanation: str = ""
    movers: list[VideoMover] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    opportunities: list[str] = Field(default_factory=list)
    key_points: list[str] = Field(default_factory=list)
    tickers: list[str] = Field(default_factory=list)
    sentiment: Optional[str] = None
    events: list[VideoEvent] = Field(default_factory=list)


class DailyMover(BaseModel):
    symbol: str
    direction: Literal["up", "down", "mixed"]
    reason: str


class DailyOverallSummary(BaseModel):
    """Overall per-day summary (stored in `daily_summaries`)."""

    title: str = ""
    # Plain-text, short daily TL;DR (in addition to summary_markdown).
    overall_summarize: str = ""
    summary_markdown: str = ""
    movers: list[DailyMover] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    opportunities: list[str] = Field(default_factory=list)
    # Overall market tone for the next session, grounded in the input videos.
    sentiment: Optional[str] = None
    sentiment_confidence: Optional[float] = None
    sentiment_reason: str = ""
