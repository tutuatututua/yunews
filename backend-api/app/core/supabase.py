from __future__ import annotations

from functools import lru_cache
from typing import Any

from supabase import create_client

from app.settings import get_settings


@lru_cache(maxsize=1)
def get_supabase_client() -> Any:
    """Return a cached Supabase client.

    The Supabase client is threadsafe for typical request usage and is cheap to
    reuse; caching avoids reconnect/handshake overhead per request.
    """

    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_key)
