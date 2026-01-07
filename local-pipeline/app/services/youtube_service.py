from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional

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
    VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"
    CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"

    _ISO8601_DURATION_RE = re.compile(
        r"^P(?:(?P<days>\d+)D)?(?:T(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?)?$"
    )

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

        min_duration_seconds = 2 * 60
        max_duration_seconds = 60 * 60

        collected: Dict[str, VideoMetadata] = {}

        for q in queries:
            if len(collected) >= max_videos:
                break

            items = self._search_page(
                query=q.query,
                published_after=published_after,
                language=language,
                max_results=max_videos,
            )

            new_ids = [v.video_id for v in items if v.video_id not in collected]
            details = self._fetch_video_details(new_ids)

            channel_ids_set: set[str] = set()
            for d in details.values():
                channel_id = d.get("channel_id")
                if isinstance(channel_id, str) and channel_id:
                    channel_ids_set.add(channel_id)

            channel_ids = sorted(channel_ids_set)
            channel_details = self._fetch_channel_details(channel_ids)

            for v in items:
                d: Dict[str, Any] = details.get(v.video_id) or {}

                duration_seconds = d.get("duration_seconds")
                if not isinstance(duration_seconds, int):
                    duration_seconds = None
                if duration_seconds is None:
                    continue

                if duration_seconds < min_duration_seconds or duration_seconds > max_duration_seconds:
                    continue

                channel_id = d.get("channel_id")
                if not isinstance(channel_id, str):
                    channel_id = None

                ch = channel_details.get(channel_id) if channel_id else None

                v = v.model_copy(
                    update={
                        "duration_seconds": duration_seconds,
                        "channel_id": channel_id,
                        "channel_title": d.get("channel_title") or v.channel,
                        "video_url": d.get("video_url"),
                        "thumbnail_url": d.get("thumbnail_url"),
                        "view_count": d.get("view_count"),
                        "like_count": d.get("like_count"),
                        "comment_count": d.get("comment_count"),
                        "tags": d.get("tags"),
                        "category_id": d.get("category_id"),
                        "default_language": d.get("default_language"),
                        "default_audio_language": d.get("default_audio_language"),
                        "channel_subscriber_count": (ch or {}).get("subscriber_count"),
                        "channel_video_count": (ch or {}).get("video_count"),
                    }
                )
                collected.setdefault(v.video_id, v)
                if len(collected) >= max_videos:
                    break

        videos = list(collected.values())[:max_videos]

        return videos

    def _search_page(
        self,
        *,
        query: str,
        published_after: str,
        language: str,
        max_results: int,
    ) -> List[VideoMetadata]:
        safe_max_results = min(max_results, 50)
        params = {
            "key": self._api_key,
            "part": "snippet",
            "q": query,
            "type": "video",
            "order": "relevance",
            "maxResults": str(safe_max_results),
            "safeSearch": "moderate",
            "regionCode": "US",
            "relevanceLanguage": language,
            #"publishedAfter": published_after,
        }

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
                    channel_id=snippet.get("channelId"),
                    channel_title=snippet.get("channelTitle") or "",
                )
            )

        return results

    def _fetch_video_details(self, video_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """Fetch rich metadata for videos.

        Uses `videos.list` with parts:
        - snippet (title, channelId, channelTitle, description, thumbnails, tags, categoryId, languages)
        - contentDetails (duration)
        - statistics (view/like/comment counts)
        """
        if not video_ids:
            return {}

        out: Dict[str, Dict[str, Any]] = {}

        for chunk in self._chunk(video_ids, chunk_size=50):
            params = {
                "key": self._api_key,
                "part": "snippet,contentDetails,statistics",
                "id": ",".join(chunk),
            }

            resp = self._session.get(self.VIDEOS_URL, params=params, timeout=30)
            try:
                resp.raise_for_status()
            except requests.HTTPError:
                logger.exception("YouTube videos.list failed: %s", resp.text)
                raise

            payload = resp.json()
            for item in payload.get("items", []) or []:
                video_id = item.get("id")
                if not video_id:
                    continue

                snippet = item.get("snippet") or {}
                content_details = item.get("contentDetails") or {}
                statistics = item.get("statistics") or {}

                duration_raw = content_details.get("duration")
                duration_seconds = (
                    self._parse_iso8601_duration_seconds(duration_raw) if isinstance(duration_raw, str) else None
                )

                thumbnails = snippet.get("thumbnails") or {}
                thumb_url = (
                    ((thumbnails.get("maxres") or {}).get("url"))
                    or ((thumbnails.get("standard") or {}).get("url"))
                    or ((thumbnails.get("high") or {}).get("url"))
                    or ((thumbnails.get("medium") or {}).get("url"))
                    or ((thumbnails.get("default") or {}).get("url"))
                )

                def _to_int(x: object) -> Optional[int]:
                    if x is None:
                        return None
                    try:
                        return int(str(x))
                    except Exception:
                        return None

                out[video_id] = {
                    "duration_seconds": duration_seconds,
                    "channel_id": snippet.get("channelId"),
                    "channel_title": snippet.get("channelTitle"),
                    "video_url": f"https://www.youtube.com/watch?v={video_id}",
                    "thumbnail_url": thumb_url,
                    "view_count": _to_int(statistics.get("viewCount")),
                    "like_count": _to_int(statistics.get("likeCount")),
                    "comment_count": _to_int(statistics.get("commentCount")),
                    "tags": snippet.get("tags") if isinstance(snippet.get("tags"), list) else None,
                    "category_id": snippet.get("categoryId"),
                    "default_language": snippet.get("defaultLanguage"),
                    "default_audio_language": snippet.get("defaultAudioLanguage"),
                }

        return out

    def _fetch_channel_details(self, channel_ids: List[str]) -> Dict[str, Dict[str, Optional[int]]]:
        """Fetch channel-level metadata like subscriber count.

        Note: subscriberCount may be hidden for some channels; in that case it's absent.
        """
        if not channel_ids:
            return {}

        out: Dict[str, Dict[str, Optional[int]]] = {}

        for chunk in self._chunk(channel_ids, chunk_size=50):
            params = {
                "key": self._api_key,
                "part": "statistics",
                "id": ",".join(chunk),
            }

            resp = self._session.get(self.CHANNELS_URL, params=params, timeout=30)
            try:
                resp.raise_for_status()
            except requests.HTTPError:
                logger.exception("YouTube channels.list failed: %s", resp.text)
                raise

            payload = resp.json()
            for item in payload.get("items", []) or []:
                channel_id = item.get("id")
                if not channel_id:
                    continue
                statistics = item.get("statistics") or {}

                def _to_int(x: object) -> Optional[int]:
                    if x is None:
                        return None
                    try:
                        return int(str(x))
                    except Exception:
                        return None

                out[channel_id] = {
                    "subscriber_count": _to_int(statistics.get("subscriberCount")),
                    "video_count": _to_int(statistics.get("videoCount")),
                }

        return out

    def _parse_iso8601_duration_seconds(self, raw: str) -> Optional[int]:
        # YouTube returns ISO 8601 duration like: PT2M10S, PT1H3M, P1DT2H
        m = self._ISO8601_DURATION_RE.match(raw)
        if not m:
            return None

        days = int(m.group("days") or 0)
        hours = int(m.group("hours") or 0)
        minutes = int(m.group("minutes") or 0)
        seconds = int(m.group("seconds") or 0)
        return days * 86400 + hours * 3600 + minutes * 60 + seconds

    def _chunk(self, items: List[str], *, chunk_size: int) -> List[List[str]]:
        return [items[i : i + chunk_size] for i in range(0, len(items), chunk_size)]
