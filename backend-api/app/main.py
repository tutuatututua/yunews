from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.routes import daily_summaries, entities, health, videos
from app.core.errors import AppError
from app.core.logging import configure_logging
from app.core.request_id import RequestIdMiddleware
from app.core.request_logging import RequestLoggingMiddleware
from app.schemas.common import ApiError, ApiErrorResponse
from app.settings import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()

configure_logging(level=settings.log_level)

app = FastAPI(title="yuNews Backend API", version="1.0.0")

app.add_middleware(RequestIdMiddleware)
app.add_middleware(RequestLoggingMiddleware)

if settings.trusted_hosts:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.effective_cors_allow_origins,
    allow_credentials=False,
    allow_methods=settings.cors_allow_methods,
    allow_headers=settings.cors_allow_headers,
)


def _request_id_from_scope(request) -> str | None:
    try:
        return getattr(request.state, "request_id", None)
    except Exception:
        return None


@app.exception_handler(AppError)
async def handle_app_error(request, exc: AppError):
    payload = ApiErrorResponse(
        error=ApiError(code=exc.code, message=exc.message, details=exc.details, request_id=_request_id_from_scope(request))
    ).model_dump()
    return JSONResponse(status_code=exc.status_code, content=payload)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(request, exc: RequestValidationError):
    payload = ApiErrorResponse(
        error=ApiError(
            code="validation_error",
            message="Request validation failed",
            details={"errors": exc.errors()},
            request_id=_request_id_from_scope(request),
        )
    ).model_dump()
    return JSONResponse(status_code=422, content=payload)


@app.exception_handler(HTTPException)
async def handle_http_exception(request, exc: HTTPException):
    # Normalize FastAPI-raised HTTP errors.
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


@app.exception_handler(Exception)
async def handle_unhandled_error(request, exc: Exception):
    # Log full exception, return safe message.
    logger.exception("Unhandled error")
    payload = ApiErrorResponse(
        error=ApiError(code="internal_error", message="Internal Server Error", request_id=_request_id_from_scope(request))
    ).model_dump()
    return JSONResponse(status_code=500, content=payload)

app.include_router(health.router)
app.include_router(daily_summaries.router)
app.include_router(videos.router)
app.include_router(entities.router)
