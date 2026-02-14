from __future__ import annotations

from typing import List

from app.models.schemas import TranscriptChunk, TranscriptEntry


class ChunkingService:
    """Time-window chunking (< 5 minutes) using transcript timestamps."""

    def __init__(self, window_seconds: int = 300) -> None:
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        self._window = float(window_seconds)

    def chunk_by_time(self, video_id: str, entries: List[TranscriptEntry]) -> List[TranscriptChunk]:
        # Defensive: upstream typically provides sorted, non-empty entries,
        # but keep this robust in case the source changes.
        entries = [e for e in entries if getattr(e, "text", "") and str(e.text).strip()]
        if not entries:
            return []

        entries = sorted(entries, key=lambda e: float(e.start))

        chunks: List[TranscriptChunk] = []

        current_text_parts: List[str] = []
        chunk_start = 0.0
        chunk_end = 0.0
        chunk_index = 0

        def flush() -> None:
            nonlocal chunk_index, current_text_parts, chunk_start, chunk_end
            text = " ".join(p.strip() for p in current_text_parts if p.strip()).strip()
            if text:
                chunks.append(
                    TranscriptChunk(
                        video_id=video_id,
                        chunk_index=chunk_index,
                        chunk_start_time=chunk_start,
                        chunk_end_time=chunk_end,
                        chunk_text=text,
                    )
                )
                chunk_index += 1

            current_text_parts = []

        for e in entries:
            entry_start = float(e.start)
            entry_end = float(e.start + max(e.duration, 0.0))

            # Initialize a chunk when empty
            if not current_text_parts:
                chunk_start = entry_start
                chunk_end = entry_end
                current_text_parts.append(e.text)
                continue

            # If adding this entry exceeds the window, flush and start a new chunk
            proposed_end = max(chunk_end, entry_end)
            if proposed_end - chunk_start > self._window:
                flush()
                chunk_start = entry_start
                chunk_end = entry_end
                current_text_parts.append(e.text)
            else:
                chunk_end = proposed_end
                current_text_parts.append(e.text)

        flush()
        return chunks
