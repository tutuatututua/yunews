from __future__ import annotations

from typing import Any


class VideosRepository:
    def __init__(self, *, supabase: Any):
        self._supa = supabase

    def fetch_video_list_rows(self, *, start_iso: str | None, end_iso: str | None, limit: int) -> list[dict[str, Any]]:
        q = (
            self._supa.table("videos")
            .select(
                "video_id,title,channel,published_at,video_url,thumbnail_url,view_count,like_count,comment_count,duration_seconds,video_summaries(overall_explanation,sentiment)"
            )
            .order("published_at", desc=True)
            .limit(int(limit))
        )

        if start_iso is not None and end_iso is not None:
            q = q.gte("published_at", start_iso).lte("published_at", end_iso)

        resp = q.execute()
        rows = resp.data or []
        return [r for r in rows if isinstance(r, dict)]

    def fetch_videos_basic_window(self, *, start_iso: str, end_iso: str, limit: int) -> list[dict[str, Any]]:
        resp = (
            self._supa.table("videos")
            .select("video_id,title,channel,published_at,video_url,thumbnail_url")
            .gte("published_at", start_iso)
            .lte("published_at", end_iso)
            .order("published_at", desc=True)
            .limit(int(limit))
            .execute()
        )
        rows = resp.data or []
        return [r for r in rows if isinstance(r, dict)]

    def fetch_summaries_for_video_ids(self, *, video_ids: list[str], limit: int = 5000) -> list[dict[str, Any]]:
        if not video_ids:
            return []
        resp = (
            self._supa.table("summaries")
            .select("video_id,ticker,summary")
            .in_("video_id", [str(x) for x in video_ids])
            .limit(int(limit))
            .execute()
        )
        rows = resp.data or []
        return [r for r in rows if isinstance(r, dict)]

    def fetch_video_row(self, *, video_id: str) -> dict[str, Any] | None:
        resp = (
            self._supa.table("videos")
            .select(
                "video_id,title,channel,published_at,video_url,thumbnail_url,view_count,like_count,comment_count,duration_seconds"
            )
            .eq("video_id", video_id)
            .limit(1)
            .execute()
        )
        row = resp.data[0] if resp.data else None
        return row if isinstance(row, dict) else None

    def fetch_video_summary_row(self, *, video_id: str) -> dict[str, Any] | None:
        resp = (
            self._supa.table("video_summaries")
            .select(
                "video_titles,published_at,summary_markdown,overall_explanation,movers,risks,opportunities,key_points,sentiment,events,model,summarized_at"
            )
            .eq("video_id", video_id)
            .limit(1)
            .execute()
        )
        row = resp.data[0] if resp.data else None
        return row if isinstance(row, dict) else None

    def fetch_video_ticker_rows(self, *, video_id: str, limit: int = 500) -> list[dict[str, Any]]:
        resp = self._supa.table("summaries").select("ticker").eq("video_id", video_id).limit(int(limit)).execute()
        rows = resp.data or []
        return [r for r in rows if isinstance(r, dict)]

    def fetch_latest_per_ticker_summary_rows(self, *, video_id: str, limit: int = 500) -> list[dict[str, Any]]:
        resp = (
            self._supa.table("summaries")
            .select("ticker,summary,created_at")
            .eq("video_id", video_id)
            .order("created_at", desc=True)
            .limit(int(limit))
            .execute()
        )
        rows = resp.data or []
        return [r for r in rows if isinstance(r, dict)]
