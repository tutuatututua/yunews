package handler

import (
	"encoding/json"
	"net/http"

	"yunews/backend/internal/middleware"
	"yunews/backend/internal/svc"
)

// ChatHandler streams SSE chat responses.
type ChatHandler struct {
	svc *svc.ChatService
}

// NewChatHandler creates a ChatHandler.
func NewChatHandler(s *svc.ChatService) *ChatHandler {
	return &ChatHandler{svc: s}
}

// ServeHTTP handles POST /chat and POST /api/chat.
func (h *ChatHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var req svc.ChatRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error":   "BAD_REQUEST",
			"message": "invalid request body",
		})
		return
	}

	clientIP := ClientIP(r)
	requestID := middleware.GetRequestID(r.Context())
	h.svc.StreamChat(req, clientIP, requestID, w)
}
