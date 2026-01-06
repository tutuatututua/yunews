from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional

import requests

from app.models.schemas import VideoMetadata

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class YouTubeSearchQuery:
    query: str


class YouTubeService:
    """YouTube Data API v3 discovery (search endpoint).

    Requirements implemented:
    - published in last N hours
    - order by relevance
    - language: English
    - type: video
    - fetch exactly `max_videos` (unique video_ids)
    """

    BASE_URL = "https://www.googleapis.com/youtube/v3/search"

    def __init__(self, api_key: str, session: Optional[requests.Session] = None) -> None:
        self._api_key = api_key
        self._session = session or requests.Session()

    def discover_daily_videos(
        self,
        queries: Iterable[YouTubeSearchQuery],
        *,
        lookback_hours: int,
        max_videos: int,
        language: str = "en",
    ) -> List[VideoMetadata]:
        published_after = (datetime.now(timezone.utc) - timedelta(hours=lookback_hours)).isoformat()

        collected: Dict[str, VideoMetadata] = {}

        for q in queries:
            if len(collected) >= max_videos:
                break

            page_token: Optional[str] = None
            # We may need to page to get enough unique results across queries.
            for _ in range(3):
                items, next_token = self._search_page(
                    query=q.query,
                    published_after=published_after,
                    language=language,
                    max_results=min(25, max_videos * 3),
                    page_token=page_token,
                )

                for v in items:
                    collected.setdefault(v.video_id, v)
                    if len(collected) >= max_videos:
                        break

                if len(collected) >= max_videos or not next_token:
                    break
                page_token = next_token

        videos = list(collected.values())[:max_videos]
        if len(videos) != max_videos:
            raise RuntimeError(
                f"YouTube discovery returned {len(videos)} videos, expected exactly {max_videos}. "
                "Try expanding queries or increasing lookback_hours."
            )
        return videos

    def _search_page(
        self,
        *,
        query: str,
        published_after: str,
        language: str,
        max_results: int,
        page_token: Optional[str],
    ) -> tuple[List[VideoMetadata], Optional[str]]:
        params = {
            "key": self._api_key,
            "part": "snippet",
            "q": query,
            "type": "video",
            "order": "relevance",
            "maxResults": str(max_results),
            "publishedAfter": published_after,
            "relevanceLanguage": language,
            "safeSearch": "none",
        }
        if page_token:
            params["pageToken"] = page_token

        resp = self._session.get(self.BASE_URL, params=params, timeout=30)
        try:
            resp.raise_for_status()
        except requests.HTTPError:
            logger.exception("YouTube search failed: %s", resp.text)
            raise

        payload = resp.json()
        items = payload.get("items", [])

        results: List[VideoMetadata] = []
        for item in items:
            id_block = item.get("id") or {}
            snippet = item.get("snippet") or {}
            if id_block.get("kind") != "youtube#video":
                continue

            video_id = id_block.get("videoId")
            if not video_id:
                continue

            published_at_raw = snippet.get("publishedAt")
            if not published_at_raw:
                continue

            try:
                published_at = datetime.fromisoformat(published_at_raw.replace("Z", "+00:00"))
            except ValueError:
                continue

            results.append(
                VideoMetadata(
                    video_id=video_id,
                    title=snippet.get("title") or "",
                    channel=snippet.get("channelTitle") or "",
                    published_at=published_at,
                    description=snippet.get("description") or "",
                )
            )

        return results, payload.get("nextPageToken")
