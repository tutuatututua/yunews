from __future__ import annotations

from typing import Any


class DailySummariesRepository:
    def __init__(self, *, supabase: Any):
        self._supa = supabase

    def fetch_daily_summary_row(self, *, market_date_iso: str) -> dict[str, Any] | None:
        resp = (
            self._supa.table("daily_summaries")
            .select(
                "market_date,title,overall_summarize,summary_markdown,movers,risks,opportunities,"
                "sentiment,sentiment_score,sentiment_reason,model,generated_at"
            )
            .eq("market_date", market_date_iso)
            .limit(1)
            .execute()
        )
        row = resp.data[0] if resp.data else None
        return row if isinstance(row, dict) else None

    def fetch_latest_daily_summary_row(self) -> dict[str, Any] | None:
        resp = (
            self._supa.table("daily_summaries")
            .select(
                "market_date,title,overall_summarize,summary_markdown,movers,risks,opportunities,"
                "sentiment,sentiment_score,sentiment_reason,model,generated_at"
            )
            .order("market_date", desc=True)
            .limit(1)
            .execute()
        )
        row = resp.data[0] if resp.data else None
        return row if isinstance(row, dict) else None

    def fetch_recent_video_published_at_rows(self, *, limit: int) -> list[dict[str, Any]]:
        resp = (
            self._supa.table("videos")
            .select("published_at")
            .order("published_at", desc=True)
            .limit(int(limit))
            .execute()
        )
        rows = resp.data or []
        return [r for r in rows if isinstance(r, dict)]

    def fetch_daily_summary_rows_for_dates(self, *, market_date_isos: list[str]) -> list[dict[str, Any]]:
        if not market_date_isos:
            return []
        resp = (
            self._supa.table("daily_summaries")
            .select(
                "market_date,title,overall_summarize,summary_markdown,movers,risks,opportunities,"
                "sentiment,sentiment_score,sentiment_reason,model,generated_at"
            )
            .in_("market_date", [str(x) for x in market_date_isos])
            .limit(len(market_date_isos))
            .execute()
        )
        rows = resp.data or []
        return [r for r in rows if isinstance(r, dict)]
