from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class TopMover(BaseModel):
    model_config = ConfigDict(extra="ignore")

    symbol: str
    direction: str
    reason: str


class EntityChunkRow(BaseModel):
    model_config = ConfigDict(extra="allow")

    chunk_id: str
    computed_at: str | None = None
    market_date: str | None = None
    keypoint: str | None = None
    entities: list[Any] | None = None
    videos: dict[str, Any] | None = None
