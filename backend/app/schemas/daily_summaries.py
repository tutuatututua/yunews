from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


class DailySummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    market_date: date
    title: str
    overall_summarize: str = ""
    key_points: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    opportunities: list[str] = Field(default_factory=list)
    sentiment: str | None = None
    sentiment_score: float | None = Field(default=None, ge=-1, le=1)
    sentiment_reason: str = ""
    model: str
    generated_at: datetime
