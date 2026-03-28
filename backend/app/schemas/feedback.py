from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class FeedbackRequest(BaseModel):
    message: str = Field(min_length=5, max_length=10_000, description="User feedback message")
    email: str | None = Field(default=None, max_length=320, description="Optional contact email")

    # Best-effort client context.
    path: str = Field(default="/", max_length=500, description="SPA path (e.g. /, /chat)")
    search: str | None = Field(default=None, max_length=500, description="Optional query string (e.g. ?q=TSLA)")
    referrer: str | None = Field(default=None, max_length=500, description="Optional referrer URL")


class FeedbackSurveyRequest(BaseModel):
    subscription_intent: Literal["yes", "free_only", "no"] = Field(
        description="Whether the user thinks some part of the product should require a subscription"
    )
    fair_price_monthly: float | None = Field(
        default=None,
        ge=0,
        description="What monthly subscription price feels fair",
    )
    usage_frequency: Literal["daily", "weekly", "monthly", "occasionally", "first_time"] = Field(
        description="How often the user expects to use the product",
    )
    primary_market_focus: Literal["thai_stocks", "us_stocks", "both", "crypto", "global_macro", "other"] = Field(
        description="Which market or asset class matters most to the user",
    )
    discovery_source: Literal["search", "social_media", "youtube", "friend_or_colleague", "direct", "other"] = Field(
        description="How the user found the product",
    )
    trust_score: int = Field(
        ge=1,
        le=5,
        description="How much the user currently trusts the product, from 1 to 5",
    )
    referral_likelihood: int = Field(
        ge=0,
        le=10,
        description="How likely the user is to recommend the product, from 0 to 10",
    )
    most_wanted_feature: str = Field(default="", max_length=500, description="Optional top requested feature")
    must_improve_before_pay: str = Field(
        default="",
        max_length=1_000,
        description="Optional notes on what needs to improve before the product feels worth paying for",
    )
    ideal_alert_channel: str | None = Field(default=None, max_length=200, description="Preferred alert or update channel")
    additional_notes: str | None = Field(default=None, max_length=4_000, description="Anything else the user wants to share")
    web_helpful: Literal["yes", "slightly_yes", "somewhat", "slightly_no", "no"] | None = Field(
        default=None,
        description="Whether this website actually helps the user",
    )
    email: str | None = Field(default=None, max_length=320, description="Optional contact email")

    path: str = Field(default="/", max_length=500, description="SPA path (e.g. /, /chat)")
    search: str | None = Field(default=None, max_length=500, description="Optional query string (e.g. ?q=TSLA)")
    referrer: str | None = Field(default=None, max_length=500, description="Optional referrer URL")
