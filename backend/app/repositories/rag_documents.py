from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class RagDocumentsRepository:
    def __init__(self, *, supabase: Any):
        self._supa = supabase

    def match_rag_documents(
        self,
        *,
        query_embedding: list[float],
        match_count: int,
        filter_ticker: str | None,
        filter_document_type: str | None,
    ) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {
            "query_embedding": query_embedding,
            "match_count": int(match_count),
            "filter_ticker": filter_ticker,
            "filter_document_type": filter_document_type,
        }

        try:
            resp = self._supa.rpc("match_rag_documents", payload).execute()
        except Exception as exc:
            msg = str(exc)
            if "different vector dimensions" in msg or "vector dimensions" in msg:
                logger.error(
                    "Supabase RPC match_rag_documents failed due to embedding dimension mismatch. "
                    "query_dim=%s. This usually means rag_documents contains mixed embedding dimensions. "
                    "Fix by updating the SQL function to filter `d.dimension = vector_dims(query_embedding)`.",
                    len(query_embedding),
                )
            raise

        rows = resp.data or []
        return [r for r in rows if isinstance(r, dict)]
