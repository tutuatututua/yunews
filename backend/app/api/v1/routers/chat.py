from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.api.deps import get_chat_service
from app.core.token_quota import get_client_ip
from app.schemas.chat import ChatRequest
from app.services.chat import ChatService

router = APIRouter(tags=["chat"])


@router.post("/chat")
@router.post("/api/chat")
def chat(req: ChatRequest, request: Request, service: ChatService = Depends(get_chat_service)):
	client_ip = get_client_ip(request)
	request_id = getattr(request.state, "request_id", None)
	return service.stream_chat(req=req, client_ip=client_ip, request_id=request_id)
