from __future__ import annotations

from typing import Any


class EntitiesRepository:
    def __init__(self, *, supabase: Any):
        self._supa = supabase

    def fetch_video_ids_in_window(
        self,
        *,
        start_iso: str,
        end_iso: str,
        limit: int,
    ) -> list[str]:
        resp = (
            self._supa.table("videos")
            .select("video_id")
            .gte("published_at", start_iso)
            .lte("published_at", end_iso)
            .order("published_at", desc=True)
            .limit(int(limit))
            .execute()
        )
        return [str(r.get("video_id")) for r in (resp.data or []) if isinstance(r, dict) and r.get("video_id")]

    def fetch_summaries_for_video_ids(
        self,
        *,
        video_ids: list[str],
        limit: int,
    ) -> list[dict[str, Any]]:
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

    def fetch_recent_videos(
        self,
        *,
        start_iso: str,
        end_iso: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        resp = (
            self._supa.table("videos")
            .select("video_id,published_at,video_url,channel,title")
            .gte("published_at", start_iso)
            .lte("published_at", end_iso)
            .order("published_at", desc=True)
            .limit(int(limit))
            .execute()
        )
        rows = resp.data or []
        return [r for r in rows if isinstance(r, dict)]

    def fetch_entity_summary_rows(
        self,
        *,
        symbol: str,
        allowed_video_ids: list[str],
        limit: int,
    ) -> list[dict[str, Any]]:
        if not allowed_video_ids:
            return []
        resp = (
            self._supa.table("summaries")
            .select(
                "video_id,ticker,summary,created_at,"
                "videos(video_url,video_id,channel,title,published_at)"
            )
            .eq("ticker", symbol)
            .order("created_at", desc=True)
            .limit(int(limit))
            .in_("video_id", [str(x) for x in allowed_video_ids])
            .execute()
        )
        rows = resp.data or []
        return [r for r in rows if isinstance(r, dict)]
