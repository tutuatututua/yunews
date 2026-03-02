from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from threading import Lock
from typing import Any

from app.repositories.market_data import MarketDataRepository

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _CacheKey:
    symbol: str
    start: str
    end: str


class _TtlCache:
    def __init__(self, *, ttl_seconds: int, max_items: int) -> None:
        self._ttl = max(1, int(ttl_seconds))
        self._max = max(1, int(max_items))
        self._lock = Lock()
        self._store: dict[_CacheKey, tuple[float, Any]] = {}

    def get(self, key: _CacheKey) -> Any | None:
        now = datetime.now(timezone.utc).timestamp()
        with self._lock:
            item = self._store.get(key)
            if not item:
                return None
            ts, value = item
            if now - ts > self._ttl:
                self._store.pop(key, None)
                return None
            return value

    def set(self, key: _CacheKey, value: Any) -> None:
        now = datetime.now(timezone.utc).timestamp()
        with self._lock:
            if len(self._store) >= self._max:
                # Simple eviction: drop oldest.
                oldest_key = None
                oldest_ts = None
                for k, (ts, _) in self._store.items():
                    if oldest_ts is None or ts < oldest_ts:
                        oldest_ts = ts
                        oldest_key = k
                if oldest_key is not None:
                    self._store.pop(oldest_key, None)
            self._store[key] = (now, value)


def _to_iso_date(d: date) -> str:
    return d.isoformat()


class MarketDataService:
    """High-level market data API.

    Adds best-effort caching and normalizes caller inputs.
    """

    def __init__(
        self,
        *,
        repo: MarketDataRepository,
        ttl_seconds: int = 60 * 60,
        max_items: int = 128,
    ) -> None:
        self._repo = repo
        self._cache = _TtlCache(ttl_seconds=ttl_seconds, max_items=max_items)

    def fetch_daily_close_series(self, *, symbol: str, start: date, end: date) -> list[dict[str, Any]]:
        """Fetch daily close prices.

        Returns list of {date: 'YYYY-MM-DD', close: float, adj_close: float}.

        Notes:
        - Results are cached in-memory (best-effort in serverless).
        - `end` is treated as inclusive; upstream calls use `end + 1 day`.
        """

        sym = (symbol or "").strip().upper().lstrip("$")
        if not sym:
            return []

        start_d = start
        end_exclusive = end + timedelta(days=1)

        key = _CacheKey(symbol=sym, start=_to_iso_date(start_d), end=_to_iso_date(end_exclusive))
        cached = self._cache.get(key)
        if cached is not None:
            return cached

        data = self._repo.fetch_daily_close_series(symbol=sym, start=start_d, end_exclusive=end_exclusive)
        self._cache.set(key, data)
        return data
