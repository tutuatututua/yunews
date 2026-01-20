from __future__ import annotations

from functools import lru_cache
from typing import Any

from supabase import create_client

from app.core.errors import UpstreamError
from app.settings import get_settings


@lru_cache(maxsize=1)
def get_supabase_client() -> Any:
    """Return a cached Supabase client.

    The Supabase client is threadsafe for typical request usage and is cheap to
    reuse; caching avoids reconnect/handshake overhead per request.
    """

    settings = get_settings()

    key = settings.supabase_key
    if settings.supabase_use_service_role and settings.supabase_service_role_key:
        key = settings.supabase_service_role_key

    return create_client(settings.supabase_url, key)


def execute(query: Any, *, context: str) -> Any:
    """Execute a Supabase/PostgREST query and raise on upstream errors.

    Supabase client libraries often return an object with `.data` and `.error`.
    If `.error` is present we treat it as a 502 so clients don't get silent empty lists.
    """

    resp = query.execute()
    err = getattr(resp, "error", None)
    if err:
        raise UpstreamError(
            message="Supabase query failed",
            code="supabase_error",
            details={"context": context, "error": err},
        )
    return resp
