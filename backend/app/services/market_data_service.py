from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from threading import Lock
from typing import Any

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


_prices_cache = _TtlCache(ttl_seconds=60 * 60, max_items=128)


def _to_iso_date(d: date) -> str:
    return d.isoformat()


def fetch_daily_close_series(*, symbol: str, start: date, end: date) -> list[dict[str, Any]]:
    """Fetch daily close prices using yfinance.

    Returns list of {date: 'YYYY-MM-DD', close: float}.

    Notes:
    - We intentionally do NOT store this in Supabase to keep usage low.
    - In serverless deployments, in-memory cache is best-effort.
    """

    sym = (symbol or "").strip().upper()
    if not sym:
        return []

    # yfinance end is effectively exclusive; include one extra day.
    start_d = start
    end_d = end + timedelta(days=1)

    key = _CacheKey(symbol=sym, start=_to_iso_date(start_d), end=_to_iso_date(end_d))
    cached = _prices_cache.get(key)
    if cached is not None:
        return cached

    try:
        import yfinance as yf  # type: ignore

        hist = yf.Ticker(sym).history(
            start=_to_iso_date(start_d),
            end=_to_iso_date(end_d),
            interval="1d",
            auto_adjust=False,
        )

        if hist is None or getattr(hist, "empty", False):
            _prices_cache.set(key, [])
            return []

        out: list[dict[str, Any]] = []

        # hist.index is a DatetimeIndex. Keep UTC date.
        for idx, row in hist.iterrows():
            try:
                dt = idx.to_pydatetime()
            except Exception:
                try:
                    dt = datetime.fromisoformat(str(idx))
                except Exception:
                    continue

            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            else:
                dt = dt.astimezone(timezone.utc)

            close = row.get("Close") if hasattr(row, "get") else None
            try:
                close_f = float(close) if close is not None else None
            except Exception:
                close_f = None

            out.append({"date": dt.date().isoformat(), "close": close_f})

        # yfinance can occasionally return duplicates; normalize.
        seen: set[str] = set()
        deduped: list[dict[str, Any]] = []
        for b in out:
            d = str(b.get("date") or "")
            if not d or d in seen:
                continue
            seen.add(d)
            deduped.append(b)

        _prices_cache.set(key, deduped)
        return deduped
    except Exception:
        logger.exception("yfinance fetch failed", extra={"symbol": sym})
        return []
