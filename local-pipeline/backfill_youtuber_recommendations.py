from __future__ import annotations

import argparse
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from supabase import create_client

from app.core.config import get_settings

logger = logging.getLogger(__name__)


_TITLE_RE = re.compile(
    r"\b(recommend(?:ation)?|recomend(?:ation)?|buy(?:ing)?|stock\s+picks?|picks?|top\s+stocks?|best\s+stocks?)\b",
    re.IGNORECASE,
)
_TITLE_EXCLUDE_RE = re.compile(r"\b(don't\s+buy|do\s+not\s+buy|sell|short|avoid)\b", re.IGNORECASE)


def _is_reco_title(title: Any) -> bool:
    t = str(title or "").strip()
    if not t:
        return False
    if _TITLE_EXCLUDE_RE.search(t):
        return False
    return _TITLE_RE.search(t) is not None


def _chunked(items: list[str], size: int) -> Iterable[list[str]]:
    if size <= 0:
        raise ValueError("chunk size must be positive")
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _parse_iso_dt(value: Any) -> datetime | None:
    if not value:
        return None
    s = str(value)
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _safe_or_title_clause() -> str:
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


def _ensure_table_exists(supa) -> bool:
    """Best-effort check that the recommendation table exists."""

    try:
        # A select with limit=1 is cheap and will error if relation is missing.
        supa.table("youtuber_recommendations").select("id").limit(1).execute()
        return True
    except Exception as exc:
        msg = str(exc)
        if "youtuber_recommendations" in msg and (
            "does not exist" in msg or "relation" in msg or "404" in msg
        ):
            return False
        # Unknown errors: treat as not-ready.
        logger.warning("Unable to verify youtuber_recommendations table: %s", msg)
        return False


def backfill(*, days: int, limit: int, batch_size: int, dry_run: bool) -> None:
    settings = get_settings()
    supa = create_client(settings.supabase_url, settings.supabase_key)

    if not _ensure_table_exists(supa):
        raise SystemExit(
            "Missing table 'youtuber_recommendations'. Apply SQL in local-pipeline/app/db/schema.sql first."
        )

    days = max(1, int(days))
    limit = max(1, int(limit))
    batch_size = max(50, min(1000, int(batch_size)))

    since = datetime.now(timezone.utc) - timedelta(days=days)

    scanned = 0
    matched_videos = 0
    inserted_pairs = 0

    # Paginate videos using range offsets.
    offset = 0
    while scanned < limit:
        page = min(batch_size, limit - scanned)

        v_resp = (
            supa.table("videos")
            .select("video_id,title,channel,published_at,video_url")
            .gte("published_at", since.isoformat())
            .or_(_safe_or_title_clause())
            .order("published_at", desc=True)
            .range(offset, offset + page - 1)
            .execute()
        )

        rows = [r for r in (v_resp.data or []) if isinstance(r, dict) and r.get("video_id")]
        if not rows:
            break

        scanned += len(rows)
        offset += len(rows)

        # Confirm titles client-side to reduce false positives.
        candidates = [r for r in rows if _is_reco_title(r.get("title"))]
        if not candidates:
            continue

        matched_videos += len(candidates)
        video_ids = [str(r.get("video_id")) for r in candidates if r.get("video_id")]

        # Fetch tickers for these videos.
        s_resp = (
            supa.table("summaries")
            .select("video_id,ticker")
            .in_("video_id", video_ids)
            .limit(5000)
            .execute()
        )

        sums = [
            r
            for r in (s_resp.data or [])
            if isinstance(r, dict) and r.get("video_id") and r.get("ticker")
        ]
        if not sums:
            continue

        pairs: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for r in sums:
            vid = str(r.get("video_id"))
            sym = str(r.get("ticker")).strip().upper()
            if not sym or sym == "MARKET":
                continue
            key = (vid, sym)
            if key in seen:
                continue
            seen.add(key)
            pairs.append({"video_id": vid, "ticker": sym, "action": "buy", "source": "backfill:title"})

        if not pairs:
            continue

        inserted_pairs += len(pairs)

        if dry_run:
            logger.info("[dry-run] would upsert %d pairs (batch)", len(pairs))
            continue

        supa.table("youtuber_recommendations").upsert(
            pairs,
            on_conflict="video_id,ticker,action",
        ).execute()

        logger.info("Upserted %d recommendation pairs (batch)", len(pairs))

    logger.info(
        "Done. scanned_videos=%d matched_reco_titles=%d upsert_pairs=%d dry_run=%s",
        scanned,
        matched_videos,
        inserted_pairs,
        dry_run,
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    ap = argparse.ArgumentParser(description="Backfill youtuber_recommendations from existing Supabase data")
    ap.add_argument("--days", type=int, default=3650, help="Lookback window in days (default: 3650)")
    ap.add_argument("--limit", type=int, default=20000, help="Max videos to scan (default: 20000)")
    ap.add_argument("--batch-size", type=int, default=300, help="Video page size (default: 300)")
    ap.add_argument("--dry-run", action="store_true", help="Do not write; only log what would happen")

    args = ap.parse_args()

    backfill(days=args.days, limit=args.limit, batch_size=args.batch_size, dry_run=bool(args.dry_run))


if __name__ == "__main__":
    main()
