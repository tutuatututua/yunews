from __future__ import annotations

import csv
import io
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from json import JSONDecodeError
import math
import time
from threading import Lock
from typing import Any

from app.core.errors import UpstreamError

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


def _build_http_session():
    # yfinance/Yahoo can intermittently return HTML or empty bodies (rate-limit/edge issues).
    # A stable UA helps avoid some block pages.
    import requests

    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/csv,application/json;q=0.9,*/*;q=0.8",
        }
    )
    return s


def _sleep_backoff(attempt: int) -> None:
    # attempt: 0,1,2...
    delay = min(2.0, 0.5 * (2**attempt))
    time.sleep(delay)


def _fetch_yahoo_chart_daily_close_series(
    *, session, symbol: str, start: date, end_exclusive: date
) -> list[dict[str, Any]] | None:
    # Direct Yahoo chart endpoint fallback (no yfinance). This can succeed when yfinance
    # fails due to transient parsing issues.
    start_dt = datetime(start.year, start.month, start.day, tzinfo=timezone.utc)
    end_dt = datetime(end_exclusive.year, end_exclusive.month, end_exclusive.day, tzinfo=timezone.utc)
    period1 = int(start_dt.timestamp())
    period2 = int(end_dt.timestamp())

    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    params = {
        "interval": "1d",
        "events": "history",
        "includeAdjustedClose": "true",
        "period1": str(period1),
        "period2": str(period2),
    }

    try:
        resp = session.get(url, params=params, timeout=(3, 8))
    except Exception as e:
        logger.warning("yahoo chart request failed", extra={"symbol": symbol, "error": str(e)})
        return None

    if not getattr(resp, "ok", False):
        return None

    try:
        payload = resp.json()
    except (JSONDecodeError, ValueError):
        return None
    except Exception:
        return None

    chart = (payload or {}).get("chart") if isinstance(payload, dict) else None
    if not isinstance(chart, dict):
        return None

    error = chart.get("error")
    if error:
        return None

    result = chart.get("result")
    if not isinstance(result, list) or not result:
        return None

    r0 = result[0]
    if not isinstance(r0, dict):
        return None

    ts = r0.get("timestamp")
    indicators = r0.get("indicators")
    if not isinstance(ts, list) or not isinstance(indicators, dict):
        return None

    quote = indicators.get("quote")
    if not isinstance(quote, list) or not quote:
        return None
    q0 = quote[0]
    if not isinstance(q0, dict):
        return None

    closes = q0.get("close")
    if not isinstance(closes, list):
        return None

    adjclose = indicators.get("adjclose")
    adj_vals = None
    if isinstance(adjclose, list) and adjclose:
        a0 = adjclose[0]
        if isinstance(a0, dict) and isinstance(a0.get("adjclose"), list):
            adj_vals = a0.get("adjclose")

    out: list[dict[str, Any]] = []
    for i, t in enumerate(ts):
        try:
            t_int = int(t)
        except Exception:
            continue
        dt = datetime.fromtimestamp(t_int, tz=timezone.utc)
        d = dt.date()
        if d < start or d >= end_exclusive:
            continue

        close_f = None
        if i < len(closes):
            v = closes[i]
            try:
                if v is not None and not (isinstance(v, float) and math.isnan(v)):
                    close_f = float(v)
            except Exception:
                close_f = None

        adj_f = None
        if adj_vals is not None and i < len(adj_vals):
            v = adj_vals[i]
            try:
                if v is not None and not (isinstance(v, float) and math.isnan(v)):
                    adj_f = float(v)
            except Exception:
                adj_f = None

        out.append({"date": d.isoformat(), "close": close_f, "adj_close": adj_f})

    return out or None


def _fetch_stooq_daily_close_series(*, symbol: str, start: date, end_exclusive: date) -> list[dict[str, Any]] | None:
    # Stooq is a simple CSV fallback primarily for US equities.
    # It uses lowercase symbols with ".us" suffix.
    import re

    if not re.fullmatch(r"[A-Z]{1,10}", symbol):
        return None

    s = _build_http_session()
    url = f"https://stooq.com/q/d/l/?s={symbol.lower()}.us&i=d"
    try:
        resp = s.get(url, timeout=(3, 8))
    except Exception as e:
        # Fallbacks are best-effort; avoid noisy tracebacks.
        logger.warning("stooq request failed", extra={"symbol": symbol, "error": str(e)})
        return None

    if not getattr(resp, "ok", False) or not getattr(resp, "text", ""):
        return None

    text = resp.text.strip()
    if not text or "Date" not in text:
        return None

    reader = csv.DictReader(io.StringIO(text))
    out: list[dict[str, Any]] = []
    for row in reader:
        ds = str(row.get("Date") or "").strip()
        if not ds:
            continue
        try:
            d = date.fromisoformat(ds)
        except Exception:
            continue
        if d < start or d >= end_exclusive:
            continue

        close_v = row.get("Close")
        try:
            close_f = float(close_v) if close_v not in (None, "") else None
        except Exception:
            close_f = None

        out.append({"date": d.isoformat(), "close": close_f, "adj_close": None})

    return out or None


def fetch_daily_close_series(*, symbol: str, start: date, end: date) -> list[dict[str, Any]]:
    """Fetch daily close prices using yfinance.

    Returns list of {date: 'YYYY-MM-DD', close: float, adj_close: float}.

    Notes:
    - We intentionally do NOT store this in Supabase to keep usage low.
    - In serverless deployments, in-memory cache is best-effort.
    """

    sym = (symbol or "").strip().upper()
    # Sometimes inputs are prefixed (e.g. "$NVDA"); yfinance expects bare tickers.
    sym = sym.lstrip("$")
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
    except Exception as e:
        if isinstance(e, ModuleNotFoundError):
            logger.warning("yfinance not installed; attempting fallback", extra={"symbol": sym})
        else:
            logger.exception("yfinance import failed", extra={"symbol": sym})

        stooq = _fetch_stooq_daily_close_series(symbol=sym, start=start_d, end_exclusive=end_d)
        if stooq is not None:
            _prices_cache.set(key, stooq)
            return stooq

        raise UpstreamError(message="Market data provider unavailable", details={"provider": "yfinance"})

    # yfinance logs very noisy ERROR lines for transient Yahoo failures.
    # We retry and produce our own structured log instead.
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)

    session = _build_http_session()
    hist = None
    last_exc: Exception | None = None
    for attempt in range(3):
        try:
            # Prefer download() over Ticker().history(): it supports passing a session and
            # tends to be a bit more resilient for single-ticker daily series.
            hist = yf.download(
                sym,
                start=_to_iso_date(start_d),
                end=_to_iso_date(end_d),
                interval="1d",
                auto_adjust=False,
                progress=False,
                threads=False,
                group_by="column",
                session=session,
            )
            if hist is not None and not getattr(hist, "empty", False):
                break

            # Secondary attempt: per-ticker history call (can behave differently than download).
            hist = yf.Ticker(sym, session=session).history(
                start=_to_iso_date(start_d),
                end=_to_iso_date(end_d),
                interval="1d",
                auto_adjust=False,
            )
            if hist is not None and not getattr(hist, "empty", False):
                break
        except (JSONDecodeError, ValueError) as e:
            last_exc = e
            _sleep_backoff(attempt)
        except Exception as e:
            last_exc = e
            _sleep_backoff(attempt)

    if hist is None or getattr(hist, "empty", False):
        # Fallback: hit Yahoo chart endpoint directly.
        yahoo = _fetch_yahoo_chart_daily_close_series(session=session, symbol=sym, start=start_d, end_exclusive=end_d)
        if yahoo is not None:
            _prices_cache.set(key, yahoo)
            return yahoo

        # Fallback: for simple US tickers, use Stooq CSV.
        stooq = _fetch_stooq_daily_close_series(symbol=sym, start=start_d, end_exclusive=end_d)
        if stooq is not None:
            _prices_cache.set(key, stooq)
            return stooq

        if last_exc is not None:
            logger.warning(
                "market data fetch failed",
                extra={"symbol": sym, "provider": "yfinance", "attempts": 3},
                exc_info=(type(last_exc), last_exc, last_exc.__traceback__),
            )
        raise UpstreamError(message="Failed to fetch market data", details={"symbol": sym, "provider": "yfinance"})

    if hist is None or getattr(hist, "empty", False):
        raise UpstreamError(message="No market data returned", details={"symbol": sym})

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

        adj_close = row.get("Adj Close") if hasattr(row, "get") else None
        try:
            adj_close_f = float(adj_close) if adj_close is not None else None
        except Exception:
            adj_close_f = None

        out.append({"date": dt.date().isoformat(), "close": close_f, "adj_close": adj_close_f})

    # yfinance can occasionally return duplicates; normalize.
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for b in out:
        d = str(b.get("date") or "")
        if not d or d in seen:
            continue
        seen.add(d)
        deduped.append(b)

    if not deduped:
        raise UpstreamError(message="No market data returned", details={"symbol": sym})

    _prices_cache.set(key, deduped)
    return deduped
