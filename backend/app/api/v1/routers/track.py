from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_logs_repo
from app.core.config import get_settings
from app.core.token_quota import get_client_ip
from app.repositories.logs import LogsRepository
from app.schemas.track import TrackVisitRequest

logger = logging.getLogger(__name__)

router = APIRouter(tags=["tracking"])


@router.post("/track")
@router.post("/api/track")
def track_visit(
    payload: TrackVisitRequest,
    request: Request,
    repo: LogsRepository = Depends(get_logs_repo),
):
    settings = get_settings()
    if not settings.log_visit_ips:
        return {"ok": True}

    ip = get_client_ip(request)
    rid = getattr(request.state, "request_id", None)
    ua = request.headers.get("user-agent")
    referer = payload.referrer or request.headers.get("referer")

    path = (payload.path or "/").strip()[:500]
    if payload.search:
        search = str(payload.search).strip()
        if search and not search.startswith("?"):
            search = "?" + search
        path = (path + search)[:500]

    repo.insert_visit(
        ip=ip,
        path=path,
        method="VISIT",
        user_agent=ua,
        referer=referer,
        request_id=rid,
    )

    return {"ok": True}
