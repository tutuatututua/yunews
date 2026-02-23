from __future__ import annotations

import logging
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.core.supabase import get_supabase_client
from app.core.time import parse_iso_datetime
from app.schemas.youtuber_recommendations import (
	PriceBar,
	RecommendationEvent,
	RecommendationListData,
	RecommendationOverlayData,
)
from app.services.market_data_service import fetch_daily_close_series

logger = logging.getLogger(__name__)


_TITLE_RE = re.compile(
	r"\b(recommend(?:ation)?|recomend(?:ation)?|buy(?:ing)?|stock\s+picks?|picks?|top\s+stocks?|best\s+stocks?)\b",
	re.IGNORECASE,
)
_TITLE_EXCLUDE_RE = re.compile(r"\b(don't\s+buy|do\s+not\s+buy|sell|short|avoid)\b", re.IGNORECASE)


def _normalize_symbol(symbol: str | None) -> str | None:
	s = str(symbol or "").strip().upper()
	return s or None


def _is_reco_title(title: Any) -> bool:
	t = str(title or "").strip()
	if not t:
		return False
	if _TITLE_EXCLUDE_RE.search(t):
		return False
	return _TITLE_RE.search(t) is not None


def _utc_today() -> date:
	return datetime.now(timezone.utc).date()


def _safe_or_title_clause() -> str:
	# PostgREST `or` filter string (comma-separated expressions).
	patterns = [
		"%recommend%",
		"%recomend%",
		"%buy%",
		"%stock pick%",
		"%stock picks%",
		"%top stocks%",
		"%best stocks%",
	]
	return ",".join([f"title.ilike.{p}" for p in patterns])


def _try_list_from_table(*, symbol: str | None, days: int, limit: int) -> list[dict[str, Any]] | None:
	"""Try reading from `youtuber_recommendations` table.

	Returns None when the table doesn't exist.
	"""

	supa = get_supabase_client()
	try:
		q = (
			supa.table("youtuber_recommendations")
			.select("video_id,ticker,action,created_at,videos(title,channel,published_at,video_url)")
			.order("created_at", desc=True)
			.limit(limit)
		)
		if symbol:
			q = q.eq("ticker", symbol)

		# Filter by created_at (pipeline insert time). In most cases this closely
		# tracks `videos.published_at`, and avoids cross-table filter quirks.
		start_dt = datetime.now(timezone.utc) - timedelta(days=max(1, int(days)))
		q = q.gte("created_at", start_dt.isoformat())

		resp = q.execute()
		rows = resp.data or []
		return [r for r in rows if isinstance(r, dict)]
	except Exception as exc:
		msg = str(exc)
		if "youtuber_recommendations" in msg and (
			"does not exist" in msg or "relation" in msg or "404" in msg
		):
			return None
		logger.exception("Failed to query youtuber_recommendations")
		return []


def _list_from_videos_and_summaries(*, symbol: str | None, days: int, limit: int) -> list[dict[str, Any]]:
	supa = get_supabase_client()

	start_dt = datetime.now(timezone.utc) - timedelta(days=max(1, int(days)))
	q = (
		supa.table("videos")
		.select("video_id,title,channel,published_at,video_url")
		.gte("published_at", start_dt.isoformat())
		.order("published_at", desc=True)
		.limit(max(200, min(3000, limit * 10)))
	)

	# Filter candidates by title keywords at the DB.
	q = q.or_(_safe_or_title_clause())
	resp = q.execute()
	videos = [r for r in (resp.data or []) if isinstance(r, dict) and r.get("video_id")]
	if not videos:
		return []

	# Double-check titles locally to reduce false positives.
	videos = [v for v in videos if _is_reco_title(v.get("title"))]
	if not videos:
		return []

	video_ids = [str(v.get("video_id")) for v in videos if v.get("video_id")]
	# Fetch tickers mentioned in each video.
	s_q = supa.table("summaries").select("video_id,ticker").in_("video_id", video_ids).limit(5000)
	if symbol:
		s_q = s_q.eq("ticker", symbol)
	s_resp = s_q.execute()
	rows = [r for r in (s_resp.data or []) if isinstance(r, dict) and r.get("video_id") and r.get("ticker")]
	if not rows:
		return []

	v_by_id = {str(v.get("video_id")): v for v in videos if v.get("video_id")}

	out: list[dict[str, Any]] = []
	seen: set[tuple[str, str]] = set()
	for r in rows:
		vid = str(r.get("video_id"))
		sym = _normalize_symbol(r.get("ticker"))
		if not sym or sym == "MARKET":
			continue

		key = (vid, sym)
		if key in seen:
			continue
		seen.add(key)

		v = v_by_id.get(vid) or {}
		out.append(
			{
				"video_id": vid,
				"ticker": sym,
				"action": "buy",
				"videos": {
					"title": v.get("title"),
					"channel": v.get("channel"),
					"published_at": v.get("published_at"),
					"video_url": v.get("video_url"),
				},
			}
		)

		if len(out) >= limit:
			break

	return out


def list_recommendations(*, symbol: str | None, days: int, limit: int) -> RecommendationListData:
	sym = _normalize_symbol(symbol)
	days = max(1, int(days))
	limit = max(1, int(limit))

	rows = _try_list_from_table(symbol=sym, days=days, limit=limit)
	if rows is None:
		rows = _list_from_videos_and_summaries(symbol=sym, days=days, limit=limit)

	events: list[RecommendationEvent] = []

	for r in rows:
		if not isinstance(r, dict):
			continue

		vid = str(r.get("video_id") or "").strip()
		ticker = _normalize_symbol(r.get("ticker"))
		if not vid or not ticker:
			continue
		if ticker == "MARKET":
			continue

		v = r.get("videos")
		if isinstance(v, list):
			v = v[0] if v else None
		if not isinstance(v, dict):
			v = {}

		events.append(
			RecommendationEvent(
				video_id=vid,
				ticker=ticker,
				action="buy",
				title=v.get("title"),
				channel=v.get("channel"),
				published_at=v.get("published_at"),
				video_url=v.get("video_url"),
			)
		)

	return RecommendationListData(items=events)


def _close_on_or_after(prices: list[PriceBar], target: date) -> tuple[str | None, float | None]:
	if not prices:
		return None, None

	# prices are sorted by date already (yfinance output order).
	for b in prices:
		d = str(b.date or "")
		if not d:
			continue
		try:
			bd = date.fromisoformat(d)
		except Exception:
			continue
		if bd >= target:
			return d, (float(b.close) if b.close is not None else None)

	# Fallback: last
	last = prices[-1]
	d = str(last.date or "") or None
	close_f = float(last.close) if last.close is not None else None
	return d, close_f


def get_recommendation_overlay(*, symbol: str, days: int) -> RecommendationOverlayData:
	sym = _normalize_symbol(symbol)
	if not sym:
		return RecommendationOverlayData(symbol="", prices=[], events=[])

	recs = list_recommendations(symbol=sym, days=days, limit=2000)
	events = recs.items
	if not events:
		return RecommendationOverlayData(symbol=sym, prices=[], events=[])

	# Determine date range from events.
	earliest: date | None = None
	for e in events:
		if not e.published_at:
			continue
		try:
			dt = parse_iso_datetime(e.published_at)
		except Exception:
			continue
		d = dt.astimezone(timezone.utc).date()
		earliest = d if earliest is None else min(earliest, d)

	if earliest is None:
		earliest = _utc_today() - timedelta(days=max(1, int(days)))

	start = earliest - timedelta(days=7)
	end = _utc_today()

	prices_raw = fetch_daily_close_series(symbol=sym, start=start, end=end)
	prices: list[PriceBar] = []
	for b in prices_raw:
		if not isinstance(b, dict):
			continue
		try:
			prices.append(PriceBar.model_validate(b))
		except Exception:
			continue

	latest_date, latest_close = _close_on_or_after(prices, end)

	# Enrich events with profit/loss stats.
	enriched: list[RecommendationEvent] = []
	for e in events:
		entry_date: date | None = None
		if e.published_at:
			try:
				entry_date = parse_iso_datetime(e.published_at).astimezone(timezone.utc).date()
			except Exception:
				entry_date = None

		if entry_date is None:
			enriched.append(e)
			continue

		entry_iso, entry_close = _close_on_or_after(prices, entry_date)
		if entry_close is None or latest_close is None or entry_close == 0:
			enriched.append(
				e.model_copy(
					update={
						"entry_date": entry_iso,
						"entry_close": entry_close,
						"latest_date": latest_date,
						"latest_close": latest_close,
					}
				)
			)
			continue

		entry_close_f = float(entry_close)

		def _ret_pct(close_at: float | None) -> float | None:
			if close_at is None or entry_close_f == 0:
				return None
			return (float(close_at) - entry_close_f) / entry_close_f

		d7 = entry_date + timedelta(days=7)
		d30 = entry_date + timedelta(days=30)
		_, close7 = _close_on_or_after(prices, d7)
		_, close30 = _close_on_or_after(prices, d30)

		enriched.append(
			e.model_copy(
				update={
					"entry_date": entry_iso,
					"entry_close": entry_close,
					"latest_date": latest_date,
					"latest_close": latest_close,
					"return_pct": _ret_pct(latest_close),
					"return_7d_pct": _ret_pct(close7),
					"return_30d_pct": _ret_pct(close30),
				}
			)
		)

	return RecommendationOverlayData(symbol=sym, prices=prices, events=enriched)

