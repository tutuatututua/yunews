from __future__ import annotations

import logging
from time import perf_counter
from typing import Any

from app.core.supabase import get_supabase_client
from app.schemas.chat import RetrievedChunk
from app.schemas.query_plan import QueryPlan
from app.services.embedding_service import get_embedding_service


logger = logging.getLogger(__name__)


def _clip(s: str, n: int = 500) -> str:
    s = (s or "").strip()
    if len(s) <= n:
        return s
    return s[:n] + "…"


def retrieve_chunks(
    *,
    question: str,
    top_k: int = 5,
    min_similarity: float = 0.20,
    query_plan: QueryPlan | None = None,
) -> list[RetrievedChunk]:
    """Retrieve top-k relevant RAG chunks for a user question.

    Uses a well-known, production-friendly approach:
    1) vector search with the strongest available metadata filters
    2) progressively broaden filters if results are insufficient
    3) dedupe by id, keep best similarity, and apply a minimum similarity threshold
    """

    t0 = perf_counter()

    if top_k <= 0:
        return []

    embedder = get_embedding_service()
    q_for_embedding = query_plan.rewritten_prompt if query_plan else question

    if query_plan is not None:
        logger.info(
            "Retrieval start top_k=%s min_similarity=%s original=%s rewritten=%s tickers=%s",
            top_k,
            min_similarity,
            _clip(question, 280),
            q_for_embedding[:300],
            query_plan.tickers,
        )
    else:
        logger.info(
            "Retrieval start top_k=%s min_similarity=%s query=%s",
            top_k,
            min_similarity,
            _clip(question, 280),
        )

    q_vec = embedder.embed(q_for_embedding)
    if not q_vec:
        logger.warning("Retrieval skipped: embedding service returned an empty vector")
        return []

    tickers: list[str] = []
    if query_plan is not None and query_plan.tickers:
        seen: set[str] = set()
        for t in query_plan.tickers:
            sym = str(t or "").strip().upper().lstrip("$")
            if not sym or sym in seen:
                continue
            seen.add(sym)
            tickers.append(sym)

    supa = get_supabase_client()
    best_by_id: dict[int, RetrievedChunk] = {}

    def run_stage(*, stage: str, document_type: str | None, filter_ticker: str | None, match_count: int) -> None:
        method = " | ".join(
            [
                stage,
                f"type={document_type or '*'}",
                f"ticker={filter_ticker or '*'}",
            ]
        )
        before = len(best_by_id)

        payload: dict[str, Any] = {
            "query_embedding": q_vec,
            "match_count": int(match_count),
            "filter_ticker": filter_ticker,
            "filter_document_type": document_type,
        }
        try:
            resp = supa.rpc("match_rag_documents", payload).execute()
        except Exception as exc:
            msg = str(exc)
            if "different vector dimensions" in msg or "vector dimensions" in msg:
                logger.error(
                    "Supabase RPC match_rag_documents failed due to embedding dimension mismatch. "
                    "query_dim=%s. This usually means rag_documents contains mixed embedding dimensions. "
                    "Fix by updating the SQL function to filter `d.dimension = vector_dims(query_embedding)`.",
                    len(q_vec),
                )
            raise
        rows = [r for r in (resp.data or []) if isinstance(r, dict)]

        for r in rows:
            raw_id = r.get("id")
            if raw_id is None:
                continue
            try:
                chunk_id = int(raw_id)
            except Exception:
                continue

            try:
                similarity = float(r.get("similarity") or 0.0)
            except Exception:
                similarity = 0.0
            if similarity < float(min_similarity):
                continue

            chunk = RetrievedChunk(
                id=chunk_id,
                document_type=str(r.get("document_type") or ""),
                ticker=(str(r.get("ticker")).strip().upper() if r.get("ticker") else None),
                video_title=(str(r.get("video_title")) if r.get("video_title") else None),
                thumbnail_url=(str(r.get("thumbnail_url")) if r.get("thumbnail_url") else None),
                summary_text=str(r.get("summary_text") or ""),
                similarity=similarity,
                retrieval_method=method,
            )

            prev = best_by_id.get(chunk.id)
            if prev is None or chunk.similarity > prev.similarity:
                best_by_id[chunk.id] = chunk

        logger.info(
            "Retrieval stage=%s type=%s ticker=%s rows=%s unique_before=%s unique_after=%s",
            stage,
            document_type,
            filter_ticker,
            len(rows),
            before,
            len(best_by_id),
        )
    # Oversample to allow dedupe + threshold filtering, then keep top_k.
    oversample = max(int(top_k) * 3, 12)

    # Progressive broadening (most constrained -> least constrained).
    if tickers:
        per_ticker_count = max(5, (oversample + len(tickers) - 1) // len(tickers))
        for t in tickers:
            run_stage(stage="ticker", document_type="ticker_summary", filter_ticker=t, match_count=per_ticker_count)

        # Daily market context (not ticker-filtered).
        run_stage(stage="daily", document_type="daily_summary", filter_ticker=None, match_count=max(2, top_k // 3))

        # Supporting, but not ticker-filtered: catches relevant context even when
        # metadata is imperfect.
        run_stage(stage="general", document_type="video_summary", filter_ticker=None, match_count=max(4, top_k // 2))
    else:
        # Default ordering when we don't have a reliable ticker filter.
        run_stage(stage="daily", document_type="daily_summary", filter_ticker=None, match_count=max(2, top_k // 3))
        run_stage(stage="general", document_type="video_summary", filter_ticker=None, match_count=max(6, top_k))

    # Final: completely unfiltered vector search (skip if we already have enough).
    if len(best_by_id) < top_k:
        run_stage(stage="unfiltered", document_type=None, filter_ticker=None, match_count=max(oversample, top_k))

    final = sorted(best_by_id.values(), key=lambda c: c.similarity, reverse=True)[: int(top_k)]
    elapsed_ms = int((perf_counter() - t0) * 1000)
    top_bits: list[str] = []
    for c in final[:3]:
        title = _clip(c.video_title or "", 80)
        top_bits.append(
            f"type={c.document_type} ticker={c.ticker or '-'} sim={c.similarity:.3f} video={title}".strip()
        )

    logger.info("Retrieval done chunks=%s elapsed_ms=%s top=%s", len(final), elapsed_ms, " | ".join(top_bits))
    return final


