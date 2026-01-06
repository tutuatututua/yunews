from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


Topic = Literal[
    "Earnings",
    "Valuation",
    "Macro",
    "Technical Analysis",
    "Risk",
    "Long-term thesis",
    "Short-term trade",
]


class VideoMetadata(BaseModel):
    video_id: str
    title: str
    channel: str
    published_at: datetime
    description: str


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
