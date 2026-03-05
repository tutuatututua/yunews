from __future__ import annotations

from pydantic import BaseModel, Field


class FeedbackRequest(BaseModel):
    message: str = Field(min_length=5, max_length=10_000, description="User feedback message")
    email: str | None = Field(default=None, max_length=320, description="Optional contact email")

    # Best-effort client context.
    path: str = Field(default="/", max_length=500, description="SPA path (e.g. /, /chat)")
    search: str | None = Field(default=None, max_length=500, description="Optional query string (e.g. ?q=TSLA)")
    referrer: str | None = Field(default=None, max_length=500, description="Optional referrer URL")
