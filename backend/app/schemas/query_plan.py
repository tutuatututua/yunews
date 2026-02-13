from __future__ import annotations

from typing import List

from pydantic import BaseModel, ConfigDict, Field


class QueryPlan(BaseModel):
    """A structured, model-produced plan for retrieval.

    This is used ONLY to improve retrieval. The assistant answer still uses the
    user's original question.
    """

    model_config = ConfigDict(extra="ignore")


    rewritten_prompt: str = Field(
        min_length=1,
        max_length=2_000,
        validation_alias="rewritten_prompt",
    )
    tickers: List[str] | None = Field(
        default=None,
        description="Optional list of tickers (uppercase, no '$'). Use when one or more tickers are central to the question.",
    )

    is_stock_related: bool = Field(
        ...,
        description=(
            "Whether the question is about stocks/companies/markets/business news. "
            "If false, tickers should be null and retrieval should be skipped."
        ),
    )
