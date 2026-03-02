from __future__ import annotations

import logging

from fastapi import Request
from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.responses import Response

from app.core.errors import AppError
from app.schemas.common import ApiError, ApiErrorResponse

logger = logging.getLogger(__name__)


def _request_id_from_scope(request) -> str | None:
    try:
        return getattr(request.state, "request_id", None)
    except Exception:
        return None


async def handle_app_error(request: Request, exc: Exception) -> Response:
    if not isinstance(exc, AppError):
        return await handle_unhandled_error(request, exc)

    payload = ApiErrorResponse(
        error=ApiError(
            code=exc.code,
            message=exc.message,
            details=exc.details,
            request_id=_request_id_from_scope(request),
        )
    ).model_dump()
    return JSONResponse(status_code=exc.status_code, content=payload)


async def handle_validation_error(request: Request, exc: Exception) -> Response:
    if not isinstance(exc, RequestValidationError):
        return await handle_unhandled_error(request, exc)

    payload = ApiErrorResponse(
        error=ApiError(
            code="validation_error",
            message="Request validation failed",
            details={"errors": exc.errors()},
            request_id=_request_id_from_scope(request),
        )
    ).model_dump()
    return JSONResponse(status_code=422, content=payload)


async def handle_http_exception(request: Request, exc: Exception) -> Response:
    if not isinstance(exc, HTTPException):
        return await handle_unhandled_error(request, exc)

    detail = exc.detail
    message = detail if isinstance(detail, str) else "Request failed"
    payload = ApiErrorResponse(
        error=ApiError(
            code="http_error",
            message=message,
            details=None if isinstance(detail, str) else {"detail": detail},
            request_id=_request_id_from_scope(request),
        )
    ).model_dump()
    return JSONResponse(status_code=exc.status_code, content=payload)


async def handle_unhandled_error(request: Request, exc: Exception) -> Response:
    logger.exception("Unhandled error")
    payload = ApiErrorResponse(
        error=ApiError(
            code="internal_error",
            message="Internal Server Error",
            request_id=_request_id_from_scope(request),
        )
    ).model_dump()
    return JSONResponse(status_code=500, content=payload)
