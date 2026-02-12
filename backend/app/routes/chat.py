from __future__ import annotations

import json
import logging
from typing import Iterable

from fastapi import APIRouter
from starlette.requests import Request
from fastapi.responses import StreamingResponse

from app.core.errors import BadRequestError, UpstreamError
from app.core.token_quota import estimate_tokens, get_client_ip, get_token_quota
from app.schemas.chat import ChatRequest
from app.services.query_planner_service import plan_query
from app.services.rag_retrieval_service import retrieve_chunks
from app.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


def _sse(obj: dict) -> bytes:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n".encode("utf-8")


def _trim_history(history: list[dict], max_messages: int = 10) -> list[dict]:
    if not history:
        return []
    # Keep only user/assistant roles, last N.
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


def _build_context(chunks) -> str:
    parts: list[str] = []
    for i, c in enumerate(chunks, start=1):
        # Summary-only context: keep chunk numbering so the model can cite [#N],
        # but omit all other metadata fields.
        parts.append(f"[#${i}]".replace("$", ""))
        parts.append((c.summary_text or "").strip())
        parts.append("")

    return "\n".join(parts).strip()


def _retrieval_payload(chunks) -> list[dict]:
    out: list[dict] = []
    for c in chunks:
        text = (c.summary_text or "").strip()
        if not text:
            continue
        # Keep the UI payload bounded.
        out.append(
            {
                "document_type": c.document_type,
                "retrieval_method": getattr(c, "retrieval_method", None),
                "text": text[:4000],
            }
        )
    return out


def _sources_payload(chunks) -> list[dict]:
    """Structured sources aligned with retrieved chunk numbers (#1/#2/...)."""

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


@router.post("/chat")
@router.post("/api/chat")
def chat(req: ChatRequest, request: Request) -> StreamingResponse:
    settings = get_settings()

    question = (req.question or "").strip()
    if not question:
        raise BadRequestError("question is required")

    history = _trim_history([m.model_dump() for m in (req.history or [])], max_messages=10)

    query_plan = None
    if (settings.openai_api_key or "").strip():
        query_plan = plan_query(
            question=question,
            history=history,
            openai_api_key=settings.openai_api_key or "",
            model=settings.openai_query_planner_model,
        )

    if query_plan is not None:
        logger.info(
            "QueryPlan created stock_related=%s tickers=%s rewritten=%s",
            getattr(query_plan, "is_stock_related", True),
            getattr(query_plan, "tickers", None),
            (query_plan.rewritten_prompt or "")[:300],
        )

    # Cost-saving short-circuit: if the planner says this isn't a stock/business-market
    # question, skip retrieval + chat generation entirely.
    if query_plan is not None and (getattr(query_plan, "is_stock_related", True) is False):

        def event_stream_non_stock() -> Iterable[bytes]:
            yield _sse({"type": "query_plan", "query_plan": query_plan.model_dump(exclude_none=True)})
            yield _sse({"type": "sources", "sources": []})
            yield _sse({"type": "retrieval", "chunks": [], "context": ""})
            yield _sse(
                {
                    "type": "delta",
                    "delta": "I can only help with stock/company/market questions. Try asking about a ticker (e.g., AAPL, TSLA) or a company’s earnings/news.",
                }
            )
            yield _sse({"type": "done"})

        return StreamingResponse(event_stream_non_stock(), media_type="text/event-stream")

    retrieval_error: str | None = None
    try:
        chunks = retrieve_chunks(question=question,top_k=5, min_similarity=0.50, query_plan=query_plan)
    except Exception as exc:
        logger.exception("Retrieval failed")
        chunks = []
        # Keep this safe/non-leaky (no raw SQL / stack traces).
        retrieval_error = str(exc)[:200]

    # This is the exact context string that will be sent to the model.
    prompt_context = _build_context(chunks) if chunks else ""

    # Per-IP chat token quota (best-effort).
    quota = get_token_quota()
    client_ip = get_client_ip(request)

    def event_stream() -> Iterable[bytes]:
        if query_plan is not None:
            yield _sse({"type": "query_plan", "query_plan": query_plan.model_dump(exclude_none=True)})

        # Always send sources first so the UI can render citations.
        yield _sse({"type": "sources", "sources": _sources_payload(chunks)})

        # Also send the exact retrieved text + the exact prompt context string for transparency.
        # Keep the UI payload bounded.
        yield _sse(
            {
                "type": "retrieval",
                "chunks": _retrieval_payload(chunks),
                "context": prompt_context[:40_000],
            }
        )

        if retrieval_error:
            yield _sse(
                {
                    "type": "error",
                    "message": "Retrieval failed. Update your Supabase schema/RPC.",
                    "details": {"hint": retrieval_error},
                }
            )
            yield _sse({"type": "done"})
            return

        if not chunks:
            msg = "I don't have that information.\n\n"
            yield _sse({"type": "delta", "delta": msg})
            yield _sse({"type": "done"})
            return

        if not (settings.openai_api_key or "").strip():
            yield _sse({"type": "error", "message": "Server is missing OPENAI_API_KEY"})
            yield _sse({"type": "done"})
            return

        system = (
            "You are yuNews, a stock-video summary assistant.\n"
            "Answer the user's question using ONLY the retrieved context.\n\n"
            "Hard rules (must follow):\n"
            "- Use ONLY the retrieved context as your source of truth.\n"
            "- Do NOT add new facts, guess, assume, or fill in missing details.\n"
            "- If the context does not contain the answer, say exactly: \"I don't have that information.\"\n"
            "- Cite sources as [#N] where N is the chunk number.\n"
            "- Every factual claim must have a citation. If you cannot cite it, do not say it.\n\n"
            "Output format (clear and easy to scan, no bullets):\n"
            "- Write 1–3 short paragraphs. Keep sentences short and direct.\n"
            "- If the question has multiple parts, answer in separate short paragraphs (one per part).\n"
            "- Put citations at the end of each sentence that contains factual information.\n"
            "- If the context is ambiguous or conflicting, say so and describe the possible interpretations in separate sentences, each with citations.\n\n"
            "Tone: professional, friendly, concise.\n"
        )


        messages = [
            {"role": "system", "content": system},
            {
                "role": "system",
                "content": "Retrieved context (use this as the only source of truth):\n\n" + prompt_context,
            },
            *history,
            {"role": "user", "content": question},
        ]

        # Keep logs compact; do not log the full retrieved context/history contents.
        logger.info(
            "chat_input_summary question=%r history_messages=%d chunks=%d context_chars=%d model=%s quota=%s ip=%s",
            question[:200],
            len(history),
            len(chunks),
            len(prompt_context),
            settings.openai_chat_model,
            quota.enabled,
            client_ip,
        )
        if quota.enabled:
            # Estimate prompt tokens and reserve them up-front.
            prompt_text = "".join(str(m.get("content") or "") for m in messages)
            # Add a small overhead for message formatting.
            prompt_tokens = estimate_tokens(prompt_text) + 64

            snap = quota.try_consume(client_ip, prompt_tokens)
            if snap is None:
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
                return

        try:
            from openai import OpenAI

            client = OpenAI(api_key=settings.openai_api_key)

            full_text = ""
            stream = client.chat.completions.create(
                model=settings.openai_chat_model,
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
                        return

                full_text += delta
                yield _sse({"type": "delta", "delta": delta})


            yield _sse({"type": "done"})
        except Exception as exc:
            logger.exception("Chat generation failed")
            # Keep the error safe; don't leak exception details.
            raise UpstreamError("Chat model failed", details={"hint": str(exc)[:200]})

    return StreamingResponse(event_stream(), media_type="text/event-stream")
