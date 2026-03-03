from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class LogsRepository:
    def __init__(self, *, supabase: Any):
        self._supa = supabase

    def insert_visit(
        self,
        *,
        ip: str,
        path: str,
        method: str,
        user_agent: str | None,
        referer: str | None,
        request_id: str | None,
    ) -> None:
        payload = {
            "ip": (ip or "unknown")[:100],
            "path": (path or "").strip()[:500],
            "method": (method or "").strip()[:20],
            "user_agent": (user_agent or "").strip()[:500] or None,
            "referer": (referer or "").strip()[:500] or None,
            "request_id": (request_id or "").strip()[:100] or None,
        }

        try:
            self._supa.table("visit_logs").insert(payload).execute()
        except Exception:
            logger.exception("Failed to insert visit log")

    def insert_chat_log(
        self,
        *,
        ip: str,
        request_id: str | None,
        question: str,
        history: list[dict],
        response_text: str | None,
        sources: list[dict] | None,
        query_plan: dict | None,
        model: str | None,
        status: str,
        error_message: str | None = None,
    ) -> None:
        payload = {
            "ip": (ip or "unknown")[:100],
            "request_id": (request_id or "").strip()[:100] or None,
            "question": (question or "").strip()[:20_000],
            "history": history or [],
            "response_text": (response_text or "")[:80_000] or None,
            "sources": sources or [],
            "query_plan": query_plan,
            "model": (model or "").strip()[:100] or None,
            "status": (status or "").strip()[:50] or "unknown",
            "error_message": (error_message or "").strip()[:2_000] or None,
        }

        try:
            self._supa.table("chat_logs").insert(payload).execute()
        except Exception:
            logger.exception("Failed to insert chat log")
