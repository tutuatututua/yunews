package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"yunews/backend/internal/svc"
)

// EntitiesHandler handles all /entities routes.
type EntitiesHandler struct {
	svc *svc.EntitiesService
}

// NewEntitiesHandler creates an EntitiesHandler.
func NewEntitiesHandler(s *svc.EntitiesService) *EntitiesHandler {
	return &EntitiesHandler{svc: s}
}

// TopMovers handles GET /entities/top-movers.
func (h *EntitiesHandler) TopMovers(w http.ResponseWriter, r *http.Request) {
	var datePtr *time.Time
	if raw := r.URL.Query().Get("date"); raw != "" {
		if t, err := time.Parse("2006-01-02", raw); err == nil {
			datePtr = &t
		}
	}
	days := queryInt(r, "days", 7)
	limit := queryInt(r, "limit", 8)

	result, err := h.svc.TopMovers(datePtr, days, limit)
	if err != nil {
		HandleAppError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, APIResponse(result))
}

// Chunks handles GET /entities/{symbol}/chunks.
func (h *EntitiesHandler) Chunks(w http.ResponseWriter, r *http.Request) {
	symbol := chi.URLParam(r, "symbol")
	days := queryInt(r, "days", 7)
	limit := queryInt(r, "limit", 100)

	result, err := h.svc.ChunksForEntity(symbol, days, limit)
	if err != nil {
		HandleAppError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, APIResponse(result))
}
