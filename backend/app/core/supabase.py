from __future__ import annotations

from functools import lru_cache
from typing import Any

from supabase import create_client

from app.core.config import get_settings


@lru_cache(maxsize=1)
def get_supabase_client() -> Any:
    """Return a cached Supabase client.

    The Supabase client is threadsafe for typical request usage and is cheap to
    reuse; caching avoids reconnect/handshake overhead per request.
    """

    settings = get_settings()
    # Settings validation guarantees this is present.
    assert settings.supabase_service_role_key
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
