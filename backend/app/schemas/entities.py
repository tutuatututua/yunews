from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict


class TopMover(BaseModel):
    model_config = ConfigDict(extra="ignore")

    symbol: str
    direction: Literal["bullish", "bearish", "mixed"]
    reason: str


class EntityChunkRow(BaseModel):
    model_config = ConfigDict(extra="ignore")

    computed_at: datetime | None = None
    market_date: str | None = None
    keypoints_by_sentiment: dict[str, list[str]] | None = None
    entities: list[Any] | None = None
    videos: dict[str, Any] | None = None
