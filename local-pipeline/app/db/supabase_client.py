from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, cast

from supabase import Client, create_client

from app.models.schemas import TranscriptChunk, VideoMetadata

logger = logging.getLogger(__name__)


class SupabaseDB:
    """Thin DB wrapper for idempotent inserts and lookups."""

    def __init__(self, *, url: str, service_key: str) -> None:
        self._client: Client = create_client(url, service_key)

    @property
    def client(self) -> Client:
        return self._client

    def is_video_processed(self, video_id: str) -> bool:
        resp = (
            self._client.table("videos")
            .select("video_id, processed_at")
            .eq("video_id", video_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return False
        return rows[0].get("processed_at") is not None

    def upsert_video(self, video: VideoMetadata) -> None:
        payload = {
            "video_id": video.video_id,
            "title": video.title,
            "channel": video.channel,
            "channel_id": video.channel_id,
            "channel_title": video.channel_title or video.channel,
            "published_at": video.published_at.isoformat(),
            "description": video.description,
            "duration_seconds": video.duration_seconds,
            "video_url": video.video_url,
            "thumbnail_url": video.thumbnail_url,
            "view_count": video.view_count,
            "like_count": video.like_count,
            "comment_count": video.comment_count,
            "tags": video.tags,
            "category_id": video.category_id,
            "default_language": video.default_language,
            "default_audio_language": video.default_audio_language,
            "channel_subscriber_count": video.channel_subscriber_count,
            "channel_video_count": video.channel_video_count,
            "discovered_at": datetime.now(timezone.utc).isoformat(),
        }
        self._client.table("videos").upsert(payload).execute()

    def mark_video_processed(self, video_id: str) -> None:
        self._client.table("videos").update({"processed_at": datetime.now(timezone.utc).isoformat()}).eq(
            "video_id", video_id
        ).execute()

    def upsert_transcript_chunks(self, chunks: List[TranscriptChunk]) -> None:
        if not chunks:
            return

        payload = [
            {
                "video_id": c.video_id,
                "chunk_index": c.chunk_index,
                "chunk_start_time": c.chunk_start_time,
                "chunk_end_time": c.chunk_end_time,
                "chunk_text": c.chunk_text,
            }
            for c in chunks
        ]

        self._client.table("transcript_chunks").upsert(payload).execute()

    def upsert_chunk_analysis(
        self,
        *,
        video_id: str,
        chunk_index: int,
        tickers: List[str],
        topics: List[str],
        chunk_summary: Dict[str, Any],
    ) -> None:
        payload = {
            "video_id": video_id,
            "chunk_index": chunk_index,
            "tickers": tickers,
            "topics": topics,
            "chunk_summary": chunk_summary,
        }
        self._client.table("chunk_analysis").upsert(payload).execute()

    def list_chunk_analysis(self, video_id: str) -> List[Dict[str, Any]]:
        resp = self._client.table("chunk_analysis").select("*").eq("video_id", video_id).execute()
        return resp.data or []

    def upsert_aggregated_summary(
        self,
        *,
        video_id: str,
        ticker: str,
        topic: str,
        aggregated_summary: Dict[str, Any],
    ) -> int:
        """Upsert and return summary_id."""

        payload = {
            "video_id": video_id,
            "ticker": ticker,
            "topic": topic,
            "summary": aggregated_summary,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        # supabase-py type stubs are incomplete; treat the builder as Any.
        builder: Any = self._client.table("summaries").upsert(payload, on_conflict="video_id,ticker,topic")
        resp = builder.select("id").execute()
        rows = resp.data or []
        if not rows:
            # If Supabase doesn't return rows, fetch the id.
            fetch = (
                self._client.table("summaries")
                .select("id")
                .eq("video_id", video_id)
                .eq("ticker", ticker)
                .eq("topic", topic)
                .limit(1)
                .execute()
            )
            fetched = fetch.data or []
            if not fetched:
                raise RuntimeError("Failed to upsert summary")
            return int(fetched[0]["id"])

        return int(rows[0]["id"])

    def upsert_embedding(
        self,
        *,
        summary_id: int,
        model: str,
        embedding: List[float],
        dimension: int,
    ) -> None:
        if len(embedding) != dimension:
            raise ValueError(f"Embedding dimension mismatch: got {len(embedding)} expected {dimension}")

        payload = {
            "summary_id": summary_id,
            "model": model,
            "dimension": dimension,
            "embedding": embedding,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        self._client.table("embeddings").upsert(payload, on_conflict="summary_id,model").execute()
