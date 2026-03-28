from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class DuplicateFeedbackSurveyError(Exception):
    pass


class FeedbackRepository:
    def __init__(self, *, supabase: Any):
        self._supa = supabase

    @staticmethod
    def _normalize_ip(ip: str) -> str:
        return (ip or "unknown")[:100]

    @staticmethod
    def _is_duplicate_key_error(exc: Exception) -> bool:
        text = str(exc or "").lower()
        return "23505" in text or "duplicate key" in text or ("unique" in text and "feedback_surveys" in text)

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
            "ip": self._normalize_ip(ip),
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

    def has_feedback_survey_for_ip(self, *, ip: str) -> bool:
        response = self._supa.table("feedback_surveys").select("id").eq("ip", self._normalize_ip(ip)).limit(1).execute()
        rows = response.data or []
        return any(isinstance(row, dict) and row.get("id") is not None for row in rows)

    def insert_feedback_survey(
        self,
        *,
        ip: str,
        request_id: str | None,
        subscription_intent: str,
        fair_price_monthly: float | None,
        usage_frequency: str,
        primary_market_focus: str,
        discovery_source: str,
        trust_score: int,
        referral_likelihood: int,
        most_wanted_feature: str,
        must_improve_before_pay: str,
        ideal_alert_channel: str | None,
        additional_notes: str | None,
        web_helpful: str | None,
        email: str | None,
        path: str,
        user_agent: str | None,
        referrer: str | None,
    ) -> None:
        payload = {
            "ip": self._normalize_ip(ip),
            "request_id": (request_id or "").strip()[:100] or None,
            "subscription_intent": (subscription_intent or "").strip()[:20],
            "fair_price_monthly": round(float(fair_price_monthly), 2) if fair_price_monthly is not None else None,
            "usage_frequency": (usage_frequency or "").strip()[:20],
            "primary_market_focus": (primary_market_focus or "").strip()[:40],
            "discovery_source": (discovery_source or "").strip()[:40],
            "trust_score": int(trust_score),
            "referral_likelihood": int(referral_likelihood),
            "most_wanted_feature": (most_wanted_feature or "").strip()[:500],
            "must_improve_before_pay": (must_improve_before_pay or "").strip()[:1_000],
            "ideal_alert_channel": (ideal_alert_channel or "").strip()[:200] or None,
            "additional_notes": (additional_notes or "").strip()[:4_000] or None,
            "web_helpful": (web_helpful or "").strip()[:20] or None,
            "email": (email or "").strip()[:320] or None,
            "path": (path or "").strip()[:500],
            "user_agent": (user_agent or "").strip()[:500] or None,
            "referrer": (referrer or "").strip()[:500] or None,
        }

        try:
            self._supa.table("feedback_surveys").insert(payload).execute()
        except Exception as exc:
            if self._is_duplicate_key_error(exc):
                raise DuplicateFeedbackSurveyError() from exc
            logger.exception("Failed to insert feedback survey")
            raise
