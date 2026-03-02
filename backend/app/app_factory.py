from __future__ import annotations

import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import protected_router, public_router
from app.core.auth import require_api_key
from app.core.config import get_settings
from app.core.exception_handlers import (
    handle_app_error,
    handle_http_exception,
    handle_unhandled_error,
    handle_validation_error,
)
from app.core.errors import AppError
from app.core.logging import configure_logging
from app.core.request_id import RequestIdMiddleware
from app.core.request_logging import RequestLoggingMiddleware
from app.core.security_headers import SecurityHeadersMiddleware

logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(level=settings.log_level)

    app = FastAPI(title="yuNews Backend API", version="1.0.0")

    # Middlewares
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=False,
        allow_methods=settings.cors_allow_methods,
        allow_headers=settings.cors_allow_headers,
    )

    # Exception handlers
    app.add_exception_handler(AppError, handle_app_error)
    app.add_exception_handler(Exception, handle_unhandled_error)

    # FastAPI uses distinct classes for these
    from fastapi import HTTPException
    from fastapi.exceptions import RequestValidationError

    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(HTTPException, handle_http_exception)

    # Routes
    app.include_router(public_router)

    # Keep auth dependency at the router level (not middleware) so public routes stay public.
    protected_deps = [Depends(require_api_key)]
    app.include_router(protected_router, dependencies=protected_deps)

    return app
