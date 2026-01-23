from __future__ import annotations

from fastapi import Header, Request

from app.core.errors import UnauthorizedError
from app.settings import get_settings


def _extract_bearer(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.strip().split(" ", 1)
    if len(parts) != 2:
        return None
    scheme, token = parts[0].strip().lower(), parts[1].strip()
    if scheme != "bearer" or not token:
        return None
    return token


def require_api_key(
    request: Request,
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> None:
    """Optionally require an API key for non-public deployments.

    Backwards compatible: if `API_KEY` (or `BACKEND_API_KEY`) is not configured,
    this is a no-op.

    Accepted formats:
    - `X-API-Key: <key>`
    - `Authorization: Bearer <key>`
    """

    settings = get_settings()
    expected = (settings.api_key or "").strip()
    if not expected:
        return

    provided = (x_api_key or "").strip() or (_extract_bearer(authorization) or "").strip()
    if not provided or provided != expected:
        raise UnauthorizedError(
            "Missing or invalid API key",
            details={"hint": "Provide X-API-Key header or Authorization: Bearer"},
        )
