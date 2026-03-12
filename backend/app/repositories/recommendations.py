from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.time import parse_iso_datetime

logger = logging.getLogger(__name__)


class RecommendationsRepository:
    def __init__(self, *, supabase: Any):
        self._supa = supabase

    @staticmethod
    def _normalize_symbol(symbol: str | None) -> str | None:
        s = str(symbol or "").strip().upper()
        return s or None

    def fetch_recommendation_rows(self, *, symbol: str | None, days: int, limit: int) -> list[dict[str, Any]]:
        """Read recommendation events from `youtuber_recommendations` joined to `videos`.

        Returns an empty list when the table is missing or on query errors.
        """

        sym = self._normalize_symbol(symbol)
        start_dt = datetime.now(timezone.utc) - timedelta(days=max(1, int(days)))

        try:
            q = (
                self._supa.table("youtuber_recommendations")
                .select(
                    "video_id,ticker,action,published_at,"
                    "videos(title,channel,published_at,video_url,thumbnail_url)"
                )
                .gte("published_at", start_dt.isoformat())
                .order("published_at", desc=True)
                .limit(max(1, min(2000, int(limit))))
            )
            if sym:
                q = q.eq("ticker", sym)
            resp = q.execute()
            rows = resp.data or []
            return [r for r in rows if isinstance(r, dict)]
        except Exception:
            # Backward compatibility: older DBs may not have youtuber_recommendations.published_at.
            try:
                q = (
                    self._supa.table("youtuber_recommendations")
                    .select(
                        "video_id,ticker,action,created_at,"
                        "videos(title,channel,published_at,video_url,thumbnail_url)"
                    )
                    .order("created_at", desc=True)
                    .limit(max(1, min(2000, int(limit))))
                )
                if sym:
                    q = q.eq("ticker", sym)
                resp = q.execute()
                rows = [r for r in (resp.data or []) if isinstance(r, dict)]

                def _get_published_dt(row: dict[str, Any]) -> datetime | None:
                    pa_row = row.get("published_at")
                    if pa_row:
                        try:
                            return parse_iso_datetime(str(pa_row)).astimezone(timezone.utc)
                        except Exception:
                            return None
                    v = row.get("videos")
                    if isinstance(v, list):
                        v = v[0] if v else None
                    if not isinstance(v, dict):
                        return None
                    pa = v.get("published_at")
                    if not pa:
                        return None
                    try:
                        return parse_iso_datetime(str(pa)).astimezone(timezone.utc)
                    except Exception:
                        return None

                start_dt_utc = start_dt.astimezone(timezone.utc)
                filtered: list[dict[str, Any]] = []
                for r in rows:
                    pub_dt = _get_published_dt(r)
                    if pub_dt is None:
                        continue
                    if pub_dt >= start_dt_utc:
                        filtered.append(r)

                filtered.sort(
                    key=lambda r: (_get_published_dt(r) or datetime.min.replace(tzinfo=timezone.utc)),
                    reverse=True,
                )
                return filtered
            except Exception as exc2:
                msg = str(exc2)
                if "youtuber_recommendations" in msg and (
                    "does not exist" in msg or "relation" in msg or "404" in msg
                ):
                    return []
                logger.exception("Failed to query youtuber_recommendations")
                return []

    def fetch_summary_rows_for_recommendations(self, *, video_ids: list[str], tickers: list[str]) -> list[dict[str, Any]]:
        video_ids_norm = [str(v).strip() for v in video_ids if str(v).strip()]
        tickers_norm = [str(t).strip().upper() for t in tickers if str(t).strip()]
        if not video_ids_norm or not tickers_norm:
            return []

        try:
            resp = (
                self._supa.table("summaries")
                .select("video_id,ticker,summary")
                .in_("video_id", video_ids_norm)
                .in_("ticker", tickers_norm)
                .limit(max(1, min(5000, len(video_ids_norm) * 4)))
                .execute()
            )
            rows = resp.data or []
            return [r for r in rows if isinstance(r, dict)]
        except Exception:
            logger.exception("Failed to query summaries for recommendations")
            return []
