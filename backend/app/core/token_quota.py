from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from functools import lru_cache

from starlette.requests import Request

from app.settings import get_settings


def get_client_ip(request: Request) -> str:
    """Best-effort client IP.

    If behind a reverse proxy, ensure it forwards `X-Forwarded-For`.
    """

    xff = request.headers.get("x-forwarded-for")
    if xff:
        # XFF can be a comma-separated chain: client, proxy1, proxy2...
        first = xff.split(",")[0].strip()
        if first:
            return first

    client = request.client
    if client and client.host:
        return client.host

    return "unknown"


def estimate_tokens(text: str) -> int:
    """Rough token estimator.

    We avoid introducing a tokenizer dependency (e.g. tiktoken). For English-like
    text, chars/4 is a common approximation.
    """

    if not text:
        return 0
    return max(1, (len(text) + 3) // 4)


@dataclass
class TokenQuotaSnapshot:
    limit: int
    used: int
    remaining: int
    window_seconds: int


class TokenQuota:
    """In-memory per-IP token quota.

    Notes:
    - This is per-process. With multiple gunicorn workers or multiple replicas,
      quotas are not shared.
    - For production, back this with Redis/Supabase.
    """

    def __init__(self, *, tokens_per_window: int, window_seconds: int):
        self._tokens_per_window = max(0, int(tokens_per_window))
        self._window_seconds = max(1, int(window_seconds))
        self._lock = threading.Lock()
        # ip -> (window_id, used_tokens)
        self._used: dict[str, tuple[int, int]] = {}

    @property
    def enabled(self) -> bool:
        return self._tokens_per_window > 0

    def _window_id(self, now: float) -> int:
        return int(now // self._window_seconds)

    def snapshot(self, ip: str) -> TokenQuotaSnapshot:
        now = time.time()
        window_id = self._window_id(now)

        with self._lock:
            stored = self._used.get(ip)
            if not stored or stored[0] != window_id:
                used = 0
            else:
                used = stored[1]

        limit = self._tokens_per_window
        remaining = max(0, limit - used) if limit > 0 else 0
        return TokenQuotaSnapshot(limit=limit, used=used, remaining=remaining, window_seconds=self._window_seconds)

    def try_consume(self, ip: str, tokens: int) -> TokenQuotaSnapshot | None:
        """Attempt to consume tokens from the IP budget.

        Returns a snapshot if allowed; returns None if the quota is exceeded.
        """

        if not self.enabled:
            return TokenQuotaSnapshot(limit=0, used=0, remaining=0, window_seconds=self._window_seconds)

        tokens = max(0, int(tokens))
        now = time.time()
        window_id = self._window_id(now)

        with self._lock:
            stored = self._used.get(ip)
            if not stored or stored[0] != window_id:
                used = 0
            else:
                used = stored[1]

            limit = self._tokens_per_window
            if used + tokens > limit:
                return None

            used2 = used + tokens
            self._used[ip] = (window_id, used2)

        return TokenQuotaSnapshot(limit=limit, used=used2, remaining=max(0, limit - used2), window_seconds=self._window_seconds)


@lru_cache(maxsize=1)
def get_token_quota() -> TokenQuota:
    settings = get_settings()
    return TokenQuota(tokens_per_window=settings.chat_tokens_per_ip_per_window, window_seconds=settings.chat_token_window_seconds)
