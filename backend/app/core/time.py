from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from zoneinfo import ZoneInfo

# Market-day boundary for US markets (DST-aware).
MARKET_TZ = ZoneInfo("America/New_York")


def market_today() -> date:
    return datetime.now(timezone.utc).astimezone(MARKET_TZ).date()


def market_day_bounds(day: date) -> tuple[str, str]:
    """Return (start_utc_iso, end_utc_iso) for a market calendar day."""

    start_local = datetime(day.year, day.month, day.day, 0, 0, 0, tzinfo=MARKET_TZ)
    end_local = datetime(day.year, day.month, day.day, 23, 59, 59, tzinfo=MARKET_TZ)
    return start_local.astimezone(timezone.utc).isoformat(), end_local.astimezone(timezone.utc).isoformat()


def parse_iso_datetime(value: Any) -> datetime:
    """Parse common ISO-ish datetime values coming from Supabase JSON.

    Raises:
        ValueError: when the input cannot be parsed.
    """

    if not value:
        raise ValueError("Missing datetime value")

    text = str(value)
    # Supabase commonly returns ISO strings with a trailing 'Z'.
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"

    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        raise ValueError(f"Invalid datetime value: {value!r}")

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt
