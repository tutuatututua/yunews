from __future__ import annotations

import logging
from typing import List, Optional

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

    def fetch_transcript(self, video_id: str, *, languages: Optional[List[str]] = None) -> List[TranscriptEntry]:
        languages = languages or ["en"]

        try:
            transcript = YouTubeTranscriptApi.get_transcript(video_id, languages=languages)
        except (TranscriptsDisabled, NoTranscriptFound, CouldNotRetrieveTranscript):
            logger.info("No transcript available for video_id=%s", video_id)
            return []
        except Exception:
            logger.exception("Unexpected transcript error for video_id=%s", video_id)
            return []

        entries: List[TranscriptEntry] = []
        for row in transcript:
            try:
                entries.append(
                    TranscriptEntry(
                        start=float(row.get("start", 0.0)),
                        duration=float(row.get("duration", 0.0)),
                        text=str(row.get("text", "")).strip(),
                    )
                )
            except Exception:
                continue

        # Filter blanks
        entries = [e for e in entries if e.text]
        return entries
