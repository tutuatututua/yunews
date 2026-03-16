from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from app.core.time import MARKET_TZ, parse_iso_datetime
from app.repositories.daily_summaries import DailySummariesRepository


def shape_daily_summary_row(row: dict[str, Any] | None, market_date: date) -> dict[str, Any] | None:
    if not isinstance(row, dict):
        return None
    if not (row.get("key_points") or []):
        return None

    return {
        "id": market_date.isoformat(),
        "market_date": market_date.isoformat(),
        "title": row.get("title") or f"Market Summary — {market_date.isoformat()}",
        "overall_summarize": row.get("overall_summarize") or "",
        "key_points": row.get("key_points") or [],
        "risks": row.get("risks") or [],
        "opportunities": row.get("opportunities") or [],
        "sentiment": row.get("sentiment"),
        "sentiment_score": row.get("sentiment_score"),
        "sentiment_reason": row.get("sentiment_reason") or "",
        "model": row.get("model") or "daily_summaries",
        "generated_at": row.get("generated_at") or datetime.now(timezone.utc).isoformat(),
    }


class DailySummariesService:
    def __init__(self, *, repo: DailySummariesRepository):
        self._repo = repo

    def get_daily_summary(self, market_date: date) -> dict[str, Any] | None:
        row = self._repo.fetch_daily_summary_row(market_date_iso=market_date.isoformat())
        return shape_daily_summary_row(row, market_date)

    def get_latest_daily_summary(self) -> dict[str, Any] | None:
        row = self._repo.fetch_latest_daily_summary_row()
        if not isinstance(row, dict):
            return None
        raw_market_date = row.get("market_date")
        if not raw_market_date:
            return None
        market_date = date.fromisoformat(str(raw_market_date))
        return shape_daily_summary_row(row, market_date)

    def list_daily_summaries(self, *, limit: int) -> list[dict[str, Any]]:
        # Get recent market dates from videos; for each date, prefer stored daily summary.
        v_rows = self._repo.fetch_recent_video_published_at_rows(limit=2000)

        seen: set[str] = set()
        dates: list[date] = []
        for row in v_rows:
            pa = row.get("published_at")
            if not pa:
                continue
            dt = parse_iso_datetime(pa)
            d = dt.astimezone(MARKET_TZ).date().isoformat()
            if d in seen:
                continue
            seen.add(d)
            dates.append(date.fromisoformat(d))
            if len(dates) >= int(limit):
                break

        if not dates:
            return []

        date_keys = [d.isoformat() for d in dates]
        s_rows = self._repo.fetch_daily_summary_rows_for_dates(market_date_isos=date_keys)

        rows_by_date: dict[str, dict[str, Any]] = {}
        for r in s_rows:
            md = r.get("market_date")
            if not md:
                continue
            rows_by_date[str(md)] = r

        out: list[dict[str, Any]] = []
        for d in dates:
            if shaped := shape_daily_summary_row(rows_by_date.get(d.isoformat()), d):
                out.append(shaped)

        return out
