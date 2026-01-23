from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AppError(Exception):
    """A safe, user-facing application error.

    These errors are intentionally non-leaky: `message` should be safe to show to clients.
    """

    status_code: int
    code: str
    message: str
    details: Any | None = None


class BadRequestError(AppError):
    def __init__(self, message: str = "Bad Request", *, code: str = "bad_request", details: Any | None = None):
        super().__init__(status_code=400, code=code, message=message, details=details)


class NotFoundError(AppError):
    def __init__(self, message: str = "Not Found", *, code: str = "not_found", details: Any | None = None):
        super().__init__(status_code=404, code=code, message=message, details=details)


class UpstreamError(AppError):
    def __init__(
        self,
        message: str = "Upstream Service Error",
        *,
        code: str = "upstream_error",
        status_code: int = 502,
        details: Any | None = None,
    ):
        super().__init__(status_code=status_code, code=code, message=message, details=details)


class UnauthorizedError(AppError):
    def __init__(
        self,
        message: str = "Unauthorized",
        *,
        code: str = "unauthorized",
        details: Any | None = None,
    ):
        super().__init__(status_code=401, code=code, message=message, details=details)


class ForbiddenError(AppError):
    def __init__(
        self,
        message: str = "Forbidden",
        *,
        code: str = "forbidden",
        details: Any | None = None,
    ):
        super().__init__(status_code=403, code=code, message=message, details=details)
