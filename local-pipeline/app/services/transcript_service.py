from __future__ import annotations

import logging
import time
from typing import List, Optional
import random
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

        # Simple throttling to reduce chances of YouTube blocking your IP.
        # (Keep values fixed per your request; adjust here if needed.)
        time.sleep(1.5)

        transcript = None
        try:
            transcript = YouTubeTranscriptApi().fetch(video_id, languages=languages)
        except Exception as exc:
            print(f"Error fetching transcript for video {video_id}: {exc}")
        time.sleep(random.uniform(0.5, 1.5))


        if transcript is None:
            return []

        entries: List[TranscriptEntry] = []
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
