from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


Topic = Literal[
    "Earnings",
    "Valuation",
    "Macro",
    "Technical",
    "Risk",
    "LongTerm",
    "ShortTerm",
]

class VideoMetadata(BaseModel):
    video_id: str
    title: str
    # Keep both for backward compatibility with older DB schemas.
    channel: str
    channel_id: Optional[str] = None
    channel_title: Optional[str] = None
    published_at: datetime
    description: str
    duration_seconds: Optional[int] = None

    # Useful YouTube metadata for explaining content / ranking
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None

    view_count: Optional[int] = None
    like_count: Optional[int] = None
    comment_count: Optional[int] = None

    tags: Optional[List[str]] = None
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


class ExtractionResult(BaseModel):
    tickers: List[str] = Field(default_factory=list, description="Uppercase tickers without $ prefix")
    topics: List[Topic] = Field(default_factory=list)


class ChunkSummary(BaseModel):
    bullets: List[str] = Field(default_factory=list)
    financial_claims: List[str] = Field(default_factory=list)
    opinions_vs_facts: List[str] = Field(default_factory=list)


class AggregatedSummary(BaseModel):
    bull_case: List[str] = Field(default_factory=list)
    bear_case: List[str] = Field(default_factory=list)
    risks: List[str] = Field(default_factory=list)


class SummaryRow(BaseModel):
    """DB payload for a single aggregated (video_id, ticker, topic) summary."""

    video_id: str
    ticker: str
    topic: str
    summary: Dict[str, Any]


class EmbeddingRow(BaseModel):
    summary_id: int
    model: str
    embedding: List[float]
