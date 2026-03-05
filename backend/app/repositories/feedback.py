from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class FeedbackRepository:
    def __init__(self, *, supabase: Any):
        self._supa = supabase

    def insert_feedback(
        self,
        *,
        ip: str,
        request_id: str | None,
        message: str,
        email: str | None,
        path: str,
        user_agent: str | None,
        referrer: str | None,
    ) -> None:
        payload = {
            "ip": (ip or "unknown")[:100],
            "request_id": (request_id or "").strip()[:100] or None,
            "message": (message or "").strip()[:10_000],
            "email": (email or "").strip()[:320] or None,
            "path": (path or "").strip()[:500],
            "user_agent": (user_agent or "").strip()[:500] or None,
            "referrer": (referrer or "").strip()[:500] or None,
        }

        try:
            self._supa.table("feedback").insert(payload).execute()
        except Exception:
            # Best-effort; do not break UI if DB is missing.
            logger.exception("Failed to insert feedback")
