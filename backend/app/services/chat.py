from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from textwrap import dedent
from typing import Iterable

from fastapi.responses import StreamingResponse

from app.core.errors import AppError, BadRequestError, UpstreamError
from app.core.time import market_today
from app.core.token_quota import TokenQuota, estimate_tokens
from app.schemas.chat import ChatRequest, RetrievedChunk
from app.schemas.query_plan import QueryPlan
from app.repositories.logs import LogsRepository
from app.services.query_planner import QueryPlannerService
from app.services.rag_retrieval import RagRetrievalService

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = dedent(
    """
    You are yuNews, a stock-video summary assistant.
    Answer the user's question using ONLY the retrieved context.
    The retrieved context may be incomplete, outdated, or internally inconsistent.

    Hard rules (must follow):
    - Use ONLY the retrieved context as your source of truth.
    - Do NOT add new facts, guess, assume, or fill in missing details.
    - If the context does not contain the answer, say exactly: "I don't have that information."
    - Cite sources as [#N] where N is the chunk number.
    - Every factual claim about companies/events/numbers must have a citation [#N]. If you cannot cite it, do not say it.
    - You may use the provided Date context (today's date/time) to interpret relative time words like "today"/"yesterday".
        Do NOT cite the Date context; cite only retrieved chunks as [#N].
    - If chunks conflict or seem to describe different things, do NOT reconcile them.
        Instead, describe each version separately with its own citation(s), and explicitly say the sources conflict.
    - When certainty is not supported, attribute claims (e.g., "According to [#N] ...") rather than stating them as absolute fact.

    Output format (clear and easy to scan, no bullets):
    - Write 1–3 short paragraphs. Keep sentences short and direct.
    - Put citations at the end of each sentence that contains factual information.
    - If the context is ambiguous or conflicting, say so and describe the possible interpretations in separate sentences, each with citations.

    Tone: professional, friendly, concise.
    """
).strip()


def _sse(obj: dict) -> bytes:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8")


def _trim_history(history: list[dict], max_messages: int = 10) -> list[dict]:
    if not history:
        return []

    cleaned: list[dict] = []
    for m in history:
        if not isinstance(m, dict):
            continue
        role = str(m.get("role") or "").strip()
        if role not in ("user", "assistant"):
            continue
        content = str(m.get("content") or "").strip()
        if not content:
            continue
        cleaned.append({"role": role, "content": content[:20_000]})
    return cleaned[-max_messages:]


def _safe_retrieval_error_details(raw_error: str) -> dict:
    msg = (raw_error or "").strip()
    low = msg.lower()

    hint = msg[:300] if msg else "Unknown retrieval error"
    fix = "Verify your Supabase schema and RPC function match_rag_documents are up to date."

    if "match_rag_documents" in low and (
        "could not find" in low or "not found" in low or "does not exist" in low
    ):
        fix = (
            "Your Supabase RPC function match_rag_documents is missing. "
            "Run local-pipeline/app/db/schema.sql (and any migrations in local-pipeline/app/db/migrations/) on the same Supabase project used by the backend."
        )
    elif "column" in low and "does not exist" in low:
        fix = (
            "Your Supabase schema/RPC is outdated. Apply the latest SQL migrations in local-pipeline/app/db/migrations/ "
            "(and re-run schema.sql if needed)."
        )
    elif "permission" in low and "denied" in low:
        fix = (
            "Supabase rejected the query due to permissions. Ensure the backend uses SUPABASE_SERVICE_ROLE_KEY "
            "and that the key/project match your deployed database."
        )
    elif "jwt" in low or "invalid api key" in low or "unauthorized" in low:
        fix = (
            "Supabase credentials look invalid for this deployment. Double-check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel env vars."
        )
    elif "vector" in low and "dimension" in low:
        fix = (
            "Embedding dimension mismatch. Ensure your Supabase function filters on embedding dimension "
            "(see README troubleshooting about vector dims), and that your rag_documents embeddings were generated with the same model/dimension."
        )

    return {"hint": hint, "fix": fix}


def _build_context(chunks: list[RetrievedChunk]) -> str:
    parts: list[str] = []
    for i, c in enumerate(chunks, start=1):
        parts.append(f"[#{i}]")
        parts.append((c.summary_text or "").strip())
        parts.append("")

    return "\n".join(parts).strip()


def _retrieval_payload(chunks: list[RetrievedChunk]) -> list[dict]:
    out: list[dict] = []
    for c in chunks:
        text = (c.summary_text or "").strip()
        if not text:
            continue
        out.append(
            {
                "document_type": c.document_type,
                "retrieval_method": getattr(c, "retrieval_method", None),
                "text": text[:4000],
            }
        )
    return out


def _sources_payload(chunks: list[RetrievedChunk]) -> list[dict]:
    out: list[dict] = []
    for i, c in enumerate(chunks, start=1):
        out.append(
            {
                "chunk": i,
                "document_type": c.document_type,
                "ticker": c.ticker,
                "video_title": c.video_title,
                "thumbnail_url": c.thumbnail_url,
                "similarity": c.similarity,
                "retrieval_method": getattr(c, "retrieval_method", None),
            }
        )
    return out


class ChatService:
    def __init__(
        self,
        *,
        openai_api_key: str | None,
        chat_model: str,
        planner: QueryPlannerService | None,
        quota: TokenQuota,
        retrieval: RagRetrievalService,
        logs: LogsRepository | None = None,
        log_chat_history: bool = True,
    ) -> None:
        self._openai_api_key = (openai_api_key or "").strip()
        self._chat_model = (chat_model or "").strip()
        self._planner = planner
        self._quota = quota
        self._retrieval = retrieval
        self._logs = logs
        self._log_chat_history = bool(log_chat_history)

    def stream_chat(self, *, req: ChatRequest, client_ip: str, request_id: str | None) -> StreamingResponse:
        question = (req.question or "").strip()
        if not question:
            raise BadRequestError("question is required")

        history = _trim_history([m.model_dump() for m in (req.history or [])], max_messages=10)

        query_plan: QueryPlan | None = None
        if self._planner is not None:
            query_plan = self._planner.plan_query(question=question, history=history)

        if query_plan is not None:
            logger.info(
                "QueryPlan created stock_related=%s tickers=%s rewritten=%s",
                getattr(query_plan, "is_stock_related", True),
                getattr(query_plan, "tickers", None),
                (query_plan.rewritten_prompt or "")[:300],
            )

        if query_plan is not None and (getattr(query_plan, "is_stock_related", True) is False):

            def event_stream_non_stock() -> Iterable[bytes]:
                response_parts: list[str] = []
                status = "non_stock"
                yield _sse({"type": "query_plan", "query_plan": query_plan.model_dump(exclude_none=True)})
                yield _sse({"type": "sources", "sources": []})
                yield _sse({"type": "retrieval", "chunks": [], "context": ""})
                msg = (
                    "I can only help with stock/company/market questions. "
                    "(Why you’re seeing this: the query planner marked this question as not stock-related.) "
                    "If this is actually about a stock, include an explicit ticker (e.g., AAPL, TSLA — or 'SOFI' if you mean SoFi Technologies)."
                )
                response_parts.append(msg)
                yield _sse(
                    {
                        "type": "delta",
                        "delta": msg,
                    }
                )
                yield _sse({"type": "done"})

                if self._logs is not None and self._log_chat_history:
                    self._logs.insert_chat_log(
                        ip=client_ip,
                        request_id=request_id,
                        question=question,
                        history=history,
                        response_text="".join(response_parts),
                        sources=[],
                        query_plan=query_plan.model_dump(exclude_none=True),
                        model=self._chat_model,
                        status=status,
                    )

            return StreamingResponse(event_stream_non_stock(), media_type="text/event-stream")

        retrieval_error: str | None = None
        retrieval_error_details: dict | None = None
        try:
            chunks = self._retrieval.retrieve_chunks(question=question, top_k=5, query_plan=query_plan)
        except Exception as exc:
            logger.exception("Retrieval failed")
            chunks = []
            if isinstance(exc, AppError):
                retrieval_error = (exc.message or "").strip()[:400]
            else:
                retrieval_error = str(exc)[:400]
            if not retrieval_error:
                retrieval_error = type(exc).__name__
            retrieval_error_details = _safe_retrieval_error_details(retrieval_error)

        prompt_context = _build_context(chunks) if chunks else ""

        quota = self._quota

        def event_stream() -> Iterable[bytes]:
            response_parts: list[str] = []
            status = "started"
            error_message: str | None = None
            if query_plan is not None:
                yield _sse({"type": "query_plan", "query_plan": query_plan.model_dump(exclude_none=True)})

            yield _sse({"type": "sources", "sources": _sources_payload(chunks)})
            yield _sse({"type": "retrieval", "chunks": _retrieval_payload(chunks), "context": prompt_context[:40_000]})

            if retrieval_error:
                status = "retrieval_error"
                error_message = retrieval_error
                yield _sse(
                    {
                        "type": "error",
                        "message": "Retrieval failed. Update your Supabase schema/RPC.",
                        "details": {
                            **(retrieval_error_details or {}),
                            "request_id": request_id,
                        },
                    }
                )
                yield _sse({"type": "done"})
                if self._logs is not None and self._log_chat_history:
                    self._logs.insert_chat_log(
                        ip=client_ip,
                        request_id=request_id,
                        question=question,
                        history=history,
                        response_text=None,
                        sources=_sources_payload(chunks),
                        query_plan=query_plan.model_dump(exclude_none=True) if query_plan is not None else None,
                        model=self._chat_model,
                        status=status,
                        error_message=error_message,
                    )
                return

            if not chunks:
                status = "no_info"
                msg = "I don't have that information.\n\n"
                response_parts.append(msg)
                yield _sse({"type": "delta", "delta": msg})
                yield _sse({"type": "done"})
                if self._logs is not None and self._log_chat_history:
                    self._logs.insert_chat_log(
                        ip=client_ip,
                        request_id=request_id,
                        question=question,
                        history=history,
                        response_text="".join(response_parts),
                        sources=_sources_payload(chunks),
                        query_plan=query_plan.model_dump(exclude_none=True) if query_plan is not None else None,
                        model=self._chat_model,
                        status=status,
                    )
                return

            if not self._openai_api_key:
                status = "missing_openai_key"
                yield _sse({"type": "error", "message": "Server is missing OPENAI_API_KEY"})
                yield _sse({"type": "done"})
                if self._logs is not None and self._log_chat_history:
                    self._logs.insert_chat_log(
                        ip=client_ip,
                        request_id=request_id,
                        question=question,
                        history=history,
                        response_text=None,
                        sources=_sources_payload(chunks),
                        query_plan=query_plan.model_dump(exclude_none=True) if query_plan is not None else None,
                        model=self._chat_model,
                        status=status,
                    )
                return

            date_context = (
                f"Date context: Today is {market_today().isoformat()} (America/New_York). "
                f"Current time is {datetime.now(timezone.utc).replace(microsecond=0).isoformat()} (UTC)."
            )

            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "system", "content": date_context},
                {"role": "system", "content": "Retrieved context (use this as the only source of truth):\n\n" + prompt_context},
                *history,
                {"role": "user", "content": question},
            ]

            logger.info(
                "chat_input_summary question=%r history_messages=%d chunks=%d context_chars=%d model=%s quota=%s ip=%s",
                question[:200],
                len(history),
                len(chunks),
                len(prompt_context),
                self._chat_model,
                quota.enabled,
                client_ip,
            )

            if quota.enabled:
                prompt_text = "".join(str(m.get("content") or "") for m in messages)
                prompt_tokens = estimate_tokens(prompt_text) + 64

                snap = quota.try_consume(client_ip, prompt_tokens)
                if snap is None:
                    status = "quota_exceeded_prompt"
                    current = quota.snapshot(client_ip)
                    yield _sse(
                        {
                            "type": "error",
                            "message": "Chat token quota exceeded",
                            "details": {
                                "ip": client_ip,
                                "limit": current.limit,
                                "used": current.used,
                                "window_seconds": current.window_seconds,
                            },
                        }
                    )
                    yield _sse({"type": "done"})
                    if self._logs is not None and self._log_chat_history:
                        self._logs.insert_chat_log(
                            ip=client_ip,
                            request_id=request_id,
                            question=question,
                            history=history,
                            response_text=None,
                            sources=_sources_payload(chunks),
                            query_plan=query_plan.model_dump(exclude_none=True) if query_plan is not None else None,
                            model=self._chat_model,
                            status=status,
                        )
                    return

            try:
                from openai import OpenAI

                client = OpenAI(api_key=self._openai_api_key)

                stream = client.chat.completions.create(
                    model=self._chat_model,
                    messages=messages,
                    temperature=0.2,
                    stream=True,
                )

                for evt in stream:
                    try:
                        delta = evt.choices[0].delta.content or ""
                    except Exception:
                        delta = ""
                    if not delta:
                        continue

                    if quota.enabled:
                        delta_tokens = estimate_tokens(delta)
                        snap2 = quota.try_consume(client_ip, delta_tokens)
                        if snap2 is None:
                            status = "quota_exceeded_response"
                            yield _sse(
                                {
                                    "type": "error",
                                    "message": "Chat token quota exceeded for your IP",
                                    "details": {
                                        "ip": client_ip,
                                        "note": "Response truncated due to quota",
                                    },
                                }
                            )
                            yield _sse({"type": "done"})
                            if self._logs is not None and self._log_chat_history:
                                self._logs.insert_chat_log(
                                    ip=client_ip,
                                    request_id=request_id,
                                    question=question,
                                    history=history,
                                    response_text="".join(response_parts),
                                    sources=_sources_payload(chunks),
                                    query_plan=query_plan.model_dump(exclude_none=True)
                                    if query_plan is not None
                                    else None,
                                    model=self._chat_model,
                                    status=status,
                                )
                            return

                    response_parts.append(delta)
                    yield _sse({"type": "delta", "delta": delta})

                status = "done"
                yield _sse({"type": "done"})
                if self._logs is not None and self._log_chat_history:
                    self._logs.insert_chat_log(
                        ip=client_ip,
                        request_id=request_id,
                        question=question,
                        history=history,
                        response_text="".join(response_parts),
                        sources=_sources_payload(chunks),
                        query_plan=query_plan.model_dump(exclude_none=True) if query_plan is not None else None,
                        model=self._chat_model,
                        status=status,
                    )
            except Exception as exc:
                logger.exception("Chat generation failed")
                status = "upstream_error"
                error_message = str(exc)[:200]
                if self._logs is not None and self._log_chat_history:
                    self._logs.insert_chat_log(
                        ip=client_ip,
                        request_id=request_id,
                        question=question,
                        history=history,
                        response_text="".join(response_parts) or None,
                        sources=_sources_payload(chunks),
                        query_plan=query_plan.model_dump(exclude_none=True) if query_plan is not None else None,
                        model=self._chat_model,
                        status=status,
                        error_message=error_message,
                    )
                raise UpstreamError("Chat model failed", details={"hint": str(exc)[:200]})

        return StreamingResponse(event_stream(), media_type="text/event-stream")
