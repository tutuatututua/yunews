from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_feedback_repo
from app.core.errors import ConflictError
from app.core.token_quota import get_client_ip
from app.repositories.feedback import DuplicateFeedbackSurveyError, FeedbackRepository
from app.schemas.feedback import FeedbackRequest, FeedbackSurveyRequest

logger = logging.getLogger(__name__)

router = APIRouter(tags=["feedback"])


def _combine_path(path: str, search: str | None) -> str:
    combined = (path or "/").strip()[:500]
    if search:
        query = str(search).strip()
        if query and not query.startswith("?"):
            query = "?" + query
        combined = (combined + query)[:500]
    return combined


@router.post("/feedback")
@router.post("/api/feedback")
def submit_feedback(
    payload: FeedbackRequest,
    request: Request,
    repo: FeedbackRepository = Depends(get_feedback_repo),
):
    ip = get_client_ip(request)
    rid = getattr(request.state, "request_id", None)
    ua = request.headers.get("user-agent")

    path = _combine_path(payload.path, payload.search)

    repo.insert_feedback(
        ip=ip,
        request_id=rid,
        message=payload.message,
        email=payload.email,
        path=path,
        user_agent=ua,
        referrer=payload.referrer or request.headers.get("referer"),
    )

    return {"ok": True, "request_id": rid}


@router.get("/feedback-survey/status")
@router.get("/api/feedback-survey/status")
def get_feedback_survey_status(
    request: Request,
    repo: FeedbackRepository = Depends(get_feedback_repo),
):
    ip = get_client_ip(request)
    return {"submitted": repo.has_feedback_survey_for_ip(ip=ip)}


@router.post("/feedback-survey")
@router.post("/api/feedback-survey")
def submit_feedback_survey(
    payload: FeedbackSurveyRequest,
    request: Request,
    repo: FeedbackRepository = Depends(get_feedback_repo),
):
    ip = get_client_ip(request)
    rid = getattr(request.state, "request_id", None)
    ua = request.headers.get("user-agent")

    if repo.has_feedback_survey_for_ip(ip=ip):
        raise ConflictError(
            message="This survey has already been submitted from your connection.",
            code="feedback_survey_already_submitted",
        )

    try:
        repo.insert_feedback_survey(
            ip=ip,
            request_id=rid,
            subscription_intent=payload.subscription_intent,
            fair_price_monthly=payload.fair_price_monthly,
            usage_frequency=payload.usage_frequency,
            primary_market_focus=payload.primary_market_focus,
            discovery_source=payload.discovery_source,
            trust_score=payload.trust_score,
            referral_likelihood=payload.referral_likelihood,
            most_wanted_feature=payload.most_wanted_feature,
            must_improve_before_pay=payload.must_improve_before_pay,
            ideal_alert_channel=payload.ideal_alert_channel,
            additional_notes=payload.additional_notes,
            web_helpful=payload.web_helpful,
            email=payload.email,
            path=_combine_path(payload.path, payload.search),
            user_agent=ua,
            referrer=payload.referrer or request.headers.get("referer"),
        )
    except DuplicateFeedbackSurveyError as exc:
        raise ConflictError(
            message="This survey has already been submitted from your connection.",
            code="feedback_survey_already_submitted",
        ) from exc

    return {"ok": True, "request_id": rid}
