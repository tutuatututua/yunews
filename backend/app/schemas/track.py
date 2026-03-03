from __future__ import annotations

from pydantic import BaseModel, Field


class TrackVisitRequest(BaseModel):
    path: str = Field(default="/", description="SPA path (e.g. /, /chat, /videos)")
    search: str | None = Field(default=None, description="Optional query string (e.g. ?q=TSLA)")
    referrer: str | None = Field(default=None, description="Optional referrer URL")
