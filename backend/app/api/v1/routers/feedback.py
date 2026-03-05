from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_feedback_repo
from app.core.token_quota import get_client_ip
from app.repositories.feedback import FeedbackRepository
from app.schemas.feedback import FeedbackRequest

logger = logging.getLogger(__name__)

router = APIRouter(tags=["feedback"])


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

    path = (payload.path or "/").strip()[:500]
    if payload.search:
        search = str(payload.search).strip()
        if search and not search.startswith("?"):
            search = "?" + search
        path = (path + search)[:500]

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
