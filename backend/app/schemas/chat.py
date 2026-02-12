from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


ChatRole = Literal["user", "assistant"]


class ChatMessage(BaseModel):
    role: ChatRole
    content: str = Field(min_length=1, max_length=20_000)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=10_000)
    history: list[ChatMessage] = Field(default_factory=list, description="Last N messages (user/assistant)")


class RetrievedChunk(BaseModel):
    id: int
    document_type: str
    ticker: str | None = None
    video_title: str | None = None
    thumbnail_url: str | None = None
    summary_text: str
    similarity: float
    retrieval_method: str | None = None
