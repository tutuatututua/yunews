from __future__ import annotations

from typing import List

from app.models.schemas import TranscriptChunk, TranscriptEntry


class ChunkingService:
    """Time-window chunking (< 5 minutes) using transcript timestamps."""

    def __init__(self, window_seconds: int = 300, overlap_seconds: int = 90) -> None:
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive")
        if overlap_seconds < 0:
            raise ValueError("overlap_seconds must be non-negative")
        if overlap_seconds >= window_seconds:
            raise ValueError("overlap_seconds must be smaller than window_seconds")
        self._window = float(window_seconds)
        self._overlap = float(overlap_seconds)

    def chunk_by_time(self, video_id: str, entries: List[TranscriptEntry]) -> List[TranscriptChunk]:
        # Defensive: upstream typically provides sorted, non-empty entries,
        # but keep this robust in case the source changes.
        entries = [e for e in entries if getattr(e, "text", "") and str(e.text).strip()]
        if not entries:
            return []

        entries = sorted(entries, key=lambda e: float(e.start))

        chunks: List[TranscriptChunk] = []

        current_entries: List[TranscriptEntry] = []
        chunk_start = 0.0
        chunk_end = 0.0
        chunk_index = 0

        def flush() -> None:
            nonlocal chunk_index, current_entries, chunk_start, chunk_end
            text = " ".join(str(entry.text).strip() for entry in current_entries if str(entry.text).strip()).strip()
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

            current_entries = []

        def overlap_entries(entries_in_chunk: List[TranscriptEntry], current_chunk_end: float) -> List[TranscriptEntry]:
            if self._overlap <= 0:
                return []

            overlap_start = max(chunk_start, current_chunk_end - self._overlap)
            return [entry for entry in entries_in_chunk if float(entry.start + max(entry.duration, 0.0)) > overlap_start]

        for e in entries:
            entry_start = float(e.start)
            entry_end = float(e.start + max(e.duration, 0.0))

            # Initialize a chunk when empty
            if not current_entries:
                chunk_start = entry_start
                chunk_end = entry_end
                current_entries.append(e)
                continue

            # If adding this entry exceeds the window, flush and start a new chunk
            proposed_end = max(chunk_end, entry_end)
            if proposed_end - chunk_start > self._window:
                retained_entries = overlap_entries(current_entries, chunk_end)
                flush()

                current_entries = list(retained_entries)
                if current_entries:
                    chunk_start = float(current_entries[0].start)
                    chunk_end = max(float(entry.start + max(entry.duration, 0.0)) for entry in current_entries)
                else:
                    chunk_start = entry_start
                    chunk_end = entry_start

                if not current_entries or current_entries[-1] is not e:
                    current_entries.append(e)
                chunk_end = max(chunk_end, entry_end)
            else:
                chunk_end = proposed_end
                current_entries.append(e)

        flush()
        return chunks
