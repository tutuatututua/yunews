from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PriceBar(BaseModel):
    model_config = ConfigDict(extra="ignore")

    date: str = Field(description="UTC date in YYYY-MM-DD")
    close: float | None = None


class RecommendationEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    video_id: str
    ticker: str
    action: Literal["buy"] = "buy"

    title: str | None = None
    channel: str | None = None
    published_at: str | None = None
    video_url: str | None = None

    # Computed from market data (best-effort; null when unavailable)
    entry_date: str | None = None
    entry_close: float | None = None
    latest_date: str | None = None
    latest_close: float | None = None

    return_pct: float | None = None
    return_7d_pct: float | None = None
    return_30d_pct: float | None = None


class RecommendationListData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    items: list[RecommendationEvent] = Field(default_factory=list)


class RecommendationOverlayData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    symbol: str
    prices: list[PriceBar] = Field(default_factory=list)
    events: list[RecommendationEvent] = Field(default_factory=list)
