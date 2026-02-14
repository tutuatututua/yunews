from __future__ import annotations

import logging
import random
import time
from typing import Optional

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    CouldNotRetrieveTranscript,
    NoTranscriptFound,
    TranscriptsDisabled,
)

from app.models.schemas import TranscriptEntry

logger = logging.getLogger(__name__)


class TranscriptService:
    """Fetch transcripts with timestamps via youtube-transcript-api."""

    _MIN_SLEEP_SECONDS = 1.5
    _MAX_SLEEP_SECONDS = 2.5

    def fetch_transcript(self, video_id: str, *, languages: Optional[list[str]] = None) -> list[TranscriptEntry]:
        languages = languages or ["en"]

        # Simple throttling to reduce chances of YouTube blocking your IP.
        # (Keep values fixed per your request; adjust here if needed.)
        time.sleep(random.uniform(self._MIN_SLEEP_SECONDS, self._MAX_SLEEP_SECONDS))

        try:
            # NOTE: youtube-transcript-api can return an iterable that performs
            # network work lazily; eagerly materialize it so errors are caught here.
            transcript = list(YouTubeTranscriptApi().fetch(video_id, languages=languages))
        except (NoTranscriptFound, TranscriptsDisabled) as exc:
            logger.info("No transcript for video_id=%s: %s", video_id, exc)
            transcript = None
        except CouldNotRetrieveTranscript as exc:
            logger.warning("Could not retrieve transcript for video_id=%s: %s", video_id, exc)
            transcript = None
        except Exception as exc:
            logger.warning("Error fetching transcript for video_id=%s: %s", video_id, exc)
            transcript = None

        time.sleep(random.uniform(self._MIN_SLEEP_SECONDS, self._MAX_SLEEP_SECONDS))


        if transcript is None:
            return []

        entries: list[TranscriptEntry] = []
        for row in transcript:
            try:
                start = getattr(row, "start", None)
                duration = getattr(row, "duration", None)
                text = getattr(row, "text", None)

                if isinstance(row, dict):
                    start = row.get("start", start)
                    duration = row.get("duration", duration)
                    text = row.get("text", text)

                entries.append(
                    TranscriptEntry(
                        start=float(start or 0.0),
                        duration=float(duration or 0.0),
                        text=str(text or "").strip(),
                    )
                )
            except Exception:
                continue

        # Filter blanks
        entries = [e for e in entries if e.text]
        return entries
