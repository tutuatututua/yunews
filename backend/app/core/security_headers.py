from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.settings import get_settings


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add baseline security headers to every response.

    This is intentionally conservative for an API service:
    - No CSP by default (CSP is most meaningful for HTML documents)
    - No HSTS unless explicitly enabled (requires HTTPS termination)

    If a header is already set by an upstream proxy (e.g. Nginx/Cloudflare), we
    do not overwrite it.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        def _set(name: str, value: str) -> None:
            if name not in response.headers:
                response.headers[name] = value

        _set("X-Content-Type-Options", "nosniff")
        _set("Referrer-Policy", "strict-origin-when-cross-origin")
        _set("X-Frame-Options", "DENY")
        _set(
            "Permissions-Policy",
            "geolocation=(), microphone=(), camera=()",
        )

        settings = get_settings()
        if settings.enable_hsts:
            # Only send HSTS when we can reasonably infer HTTPS.
            # If you terminate TLS at a reverse proxy, ensure it forwards proto.
            forwarded_proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
            is_https = request.url.scheme == "https" or forwarded_proto == "https"
            if is_https:
                _set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

        return response
