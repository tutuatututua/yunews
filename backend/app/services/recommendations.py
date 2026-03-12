from __future__ import annotations

import calendar
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.core.time import market_today
from app.repositories.recommendations import RecommendationsRepository
from app.schemas.recommendations import (
    PriceBar,
    RecommendationEvent,
    RecommendationListData,
    RecommendationOverlayData,
)
from app.services.market_data import MarketDataService

logger = logging.getLogger(__name__)


class RecommendationsService:
    def __init__(self, *, repo: RecommendationsRepository, market_data: MarketDataService):
        self._repo = repo
        self._market_data = market_data

    @staticmethod
    def _normalize_symbol(symbol: str | None) -> str | None:
        s = str(symbol or "").strip().upper()
        return s or None

    @staticmethod
    def _market_today() -> date:
        return market_today()

    @staticmethod
    def _subtract_months(d: date, months: int) -> date:
        m = int(months)
        if m <= 0:
            return d
        month0 = d.month - m
        year = d.year
        while month0 <= 0:
            year -= 1
            month0 += 12
        last_day = calendar.monthrange(year, month0)[1]
        day = min(d.day, last_day)
        return date(year, month0, day)

    @staticmethod
    def _extract_positive_keypoints(summary_obj: Any, *, max_items: int = 6) -> list[str]:
        if not isinstance(summary_obj, dict):
            return []

        items = summary_obj.get("positive")
        if items is None:
            items = summary_obj.get("bull_case")
        if not isinstance(items, list) or not items:
            return []

        out: list[str] = []
        seen: set[str] = set()
        max_items_i = max(1, int(max_items))

        for item in items:
            if len(out) >= max_items_i:
                break

            value: str | None = None
            if isinstance(item, str):
                value = item.strip()
            elif isinstance(item, dict):
                for key in ("claim", "text", "reason", "summary", "content"):
                    raw = item.get(key)
                    if isinstance(raw, str) and raw.strip():
                        value = raw.strip()
                        break
            else:
                raw = str(item).strip()
                value = raw or None

            if not value:
                continue
            if value.lower() in {"none", "null", "{}", "[]"}:
                continue
            if value in seen:
                continue
            seen.add(value)
            out.append(value)

        return out

    def list_recommendations(self, *, symbol: str | None, days: int, limit: int) -> RecommendationListData:
        sym = self._normalize_symbol(symbol)
        days = max(1, int(days))
        limit = max(1, int(limit))

        rows = self._repo.fetch_recommendation_rows(symbol=sym, days=days, limit=limit)
        summary_rows = self._repo.fetch_summary_rows_for_recommendations(
            video_ids=[str(r.get("video_id") or "").strip() for r in rows],
            tickers=[str(r.get("ticker") or "").strip() for r in rows],
        )

        positive_keypoints_by_pair: dict[tuple[str, str], list[str]] = {}
        for row in summary_rows:
            vid = str(row.get("video_id") or "").strip()
            ticker = self._normalize_symbol(row.get("ticker"))
            if not vid or not ticker:
                continue
            positive_keypoints_by_pair[(vid, ticker)] = self._extract_positive_keypoints(row.get("summary"))

        events: list[RecommendationEvent] = []
        for r in rows:
            vid = str(r.get("video_id") or "").strip()
            ticker = self._normalize_symbol(r.get("ticker"))
            if not vid or not ticker or ticker == "MARKET":
                continue

            v = r.get("videos")
            if isinstance(v, list):
                v = v[0] if v else None
            if not isinstance(v, dict):
                v = {}

            published_at = r.get("published_at") or v.get("published_at")

            events.append(
                RecommendationEvent(
                    video_id=vid,
                    ticker=ticker,
                    action="buy",
                    title=v.get("title"),
                    channel=v.get("channel"),
                    published_at=published_at,
                    video_url=v.get("video_url"),
                    thumbnail_url=v.get("thumbnail_url"),
                    positive_keypoints=positive_keypoints_by_pair.get((vid, ticker), []),
                )
            )

        return RecommendationListData(items=events)

    @staticmethod
    def _close_on_or_after(
        prices: list[PriceBar], target: date, *, fallback_to_latest: bool = True
    ) -> tuple[str | None, float | None]:
        if not prices:
            return None, None

        def _px(b: PriceBar) -> float | None:
            if b.adj_close is not None:
                try:
                    return float(b.adj_close)
                except Exception:
                    return None
            if b.close is None:
                return None
            try:
                return float(b.close)
            except Exception:
                return None

        parsed: list[tuple[date, str, float | None]] = []
        for b in prices:
            d = str(b.date or "").strip()
            if not d:
                continue
            try:
                bd = date.fromisoformat(d)
            except Exception:
                continue
            parsed.append((bd, d, _px(b)))

        if not parsed:
            return None, None

        candidate: tuple[date, str, float | None] | None = None
        for row in parsed:
            bd = row[0]
            if bd < target:
                continue
            if candidate is None or bd < candidate[0]:
                candidate = row

        if candidate is not None:
            _, d, px = candidate
            return d, px

        if not fallback_to_latest:
            return None, None

        latest = max(parsed, key=lambda r: r[0])
        _, d, px = latest
        return d, px

    @staticmethod
    def _compute_return(entry_close: float | None, exit_close: float | None) -> float | None:
        if entry_close is None or exit_close is None:
            return None
        try:
            entry_f = float(entry_close)
            exit_f = float(exit_close)
        except Exception:
            return None
        if entry_f <= 0:
            return None
        return (exit_f - entry_f) / entry_f

    def get_recommendation_overlay(self, *, symbol: str, days: int) -> RecommendationOverlayData:
        sym = self._normalize_symbol(symbol)
        if not sym:
            return RecommendationOverlayData(symbol="", prices=[], events=[])

        days_i = max(1, int(days))

        recs = self.list_recommendations(symbol=sym, days=days_i, limit=2000)
        events = recs.items
        if not events:
            return RecommendationOverlayData(symbol=sym, prices=[], events=[])

        end = self._market_today()
        start = end - timedelta(days=days_i)

        prices_raw: list[dict[str, Any]]
        try:
            prices_raw = self._market_data.fetch_daily_close_series(symbol=sym, start=start, end=end)
        except Exception:
            logger.warning("market data unavailable for overlay", extra={"symbol": sym})
            prices_raw = []

        prices: list[PriceBar] = []
        for b in prices_raw:
            if not isinstance(b, dict):
                continue
            try:
                prices.append(PriceBar.model_validate(b))
            except Exception:
                continue

        latest_date, latest_close = self._close_on_or_after(prices, end)

        enriched: list[RecommendationEvent] = []
        for e in events:
            pub = e.published_at
            pub_dt: datetime | None = None
            if isinstance(pub, str) and pub.strip():
                try:
                    pub_dt = datetime.fromisoformat(pub.replace("Z", "+00:00")).astimezone(timezone.utc)
                except Exception:
                    pub_dt = None
            elif isinstance(pub, datetime):
                try:
                    pub_dt = pub.astimezone(timezone.utc)
                except Exception:
                    pub_dt = None

            # Event day: use market date (ET) when possible, but keep existing behavior forgiving.
            event_day = (pub_dt.date() if pub_dt is not None else None) or end

            entry_date, entry_close = self._close_on_or_after(prices, event_day)
            if entry_date is None or entry_close is None:
                entry_date, entry_close = latest_date, latest_close

            day_7_date, day_7_close = self._close_on_or_after(
                prices, event_day + timedelta(days=7), fallback_to_latest=False
            )
            day_30_date, day_30_close = self._close_on_or_after(
                prices, event_day + timedelta(days=30), fallback_to_latest=False
            )

            ret = self._compute_return(entry_close, latest_close)
            ret_7d = self._compute_return(entry_close, day_7_close)
            ret_30d = self._compute_return(entry_close, day_30_close)

            payload = e.model_dump(
                exclude={
                    "entry_date",
                    "entry_close",
                    "latest_date",
                    "latest_close",
                    "return_pct",
                    "return_7d_pct",
                    "return_30d_pct",
                }
            )
            payload["entry_date"] = entry_date
            payload["entry_close"] = entry_close
            payload["latest_date"] = latest_date
            payload["latest_close"] = latest_close
            payload["return_pct"] = ret
            payload["return_7d_pct"] = ret_7d
            payload["return_30d_pct"] = ret_30d

            enriched.append(
                RecommendationEvent(
                    **payload,
                )
            )

        return RecommendationOverlayData(symbol=sym, prices=prices, events=enriched)
