from __future__ import annotations

import logging
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("app.request")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Lightweight request logging with duration and request id."""

    async def dispatch(self, request: Request, call_next):
        start = time.perf_counter()
        response: Response | None = None
        try:
            response = await call_next(request)
            return response
        finally:
            duration_ms = (time.perf_counter() - start) * 1000.0
            request_id = getattr(request.state, "request_id", None)
            status_code = response.status_code if response is not None else 500
            logger.info(
                "%s %s -> %s (%.1fms) rid=%s",
                request.method,
                request.url.path,
                status_code,
                duration_ms,
                request_id,
            )
