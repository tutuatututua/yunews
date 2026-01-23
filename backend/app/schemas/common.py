from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """Standard success envelope.

    We keep the existing `{ data: ... }` contract consumed by the frontend.
    """

    data: T | None


class ApiError(BaseModel):
    model_config = ConfigDict(extra="ignore")

    code: str
    message: str
    details: Any | None = None
    request_id: str | None = None


class ApiErrorResponse(BaseModel):
    error: ApiError
