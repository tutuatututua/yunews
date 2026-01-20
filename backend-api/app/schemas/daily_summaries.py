from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class DailySummaryMover(BaseModel):
    model_config = ConfigDict(extra="allow")

    symbol: str | None = None
    direction: str | None = None
    reason: str | None = None


class DailySummary(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    market_date: str
    title: str
    overall_summarize: str = ""
    summary_markdown: str
    movers: list[Any] = []
    risks: list[Any] = []
    opportunities: list[Any] = []
    model: str
    generated_at: str
