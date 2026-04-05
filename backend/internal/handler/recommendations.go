package handler

import (
	"net/http"
	"strings"

	"yunews/backend/internal/svc"
)

// RecommendationsHandler handles all /recommendations routes.
type RecommendationsHandler struct {
	svc *svc.RecommendationsService
}

// NewRecommendationsHandler creates a RecommendationsHandler.
func NewRecommendationsHandler(s *svc.RecommendationsService) *RecommendationsHandler {
	return &RecommendationsHandler{svc: s}
}

// List handles GET /recommendations.
func (h *RecommendationsHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	symbolRaw := strings.TrimSpace(strings.ToUpper(q.Get("symbol")))
	days := queryInt(r, "days", 365)
	limit := queryInt(r, "limit", 200)

	var sym *string
	if symbolRaw != "" {
		sym = &symbolRaw
	}

	result, err := h.svc.ListRecommendations(sym, days, limit)
	if err != nil {
		HandleAppError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, APIResponse(result))
}

// Overlay handles GET /recommendations/overlay.
func (h *RecommendationsHandler) Overlay(w http.ResponseWriter, r *http.Request) {
	symbol := strings.TrimSpace(strings.ToUpper(r.URL.Query().Get("symbol")))
	days := queryInt(r, "days", 365)

	result, err := h.svc.GetRecommendationOverlay(symbol, days)
	if err != nil {
		HandleAppError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, APIResponse(result))
}
