package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"yunews/backend/internal/apperr"
	"yunews/backend/internal/svc"
)

// DailySummariesHandler handles all /daily-summaries routes.
type DailySummariesHandler struct {
	svc *svc.DailySummariesService
}

// NewDailySummariesHandler creates a DailySummariesHandler.
func NewDailySummariesHandler(s *svc.DailySummariesService) *DailySummariesHandler {
	return &DailySummariesHandler{svc: s}
}

// Latest handles GET /daily-summaries/latest.
func (h *DailySummariesHandler) Latest(w http.ResponseWriter, r *http.Request) {
	summary, err := h.svc.GetLatestDailySummary()
	if err != nil {
		HandleAppError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, APIResponse(summary))
}

// ByDate handles GET /daily-summaries/{market_date}.
func (h *DailySummariesHandler) ByDate(w http.ResponseWriter, r *http.Request) {
	raw := chi.URLParam(r, "market_date")
	marketDate, parseErr := time.Parse("2006-01-02", raw)
	if parseErr != nil {
		WriteError(w, apperr.BadRequest("invalid date format, expected YYYY-MM-DD"))
		return
	}
	summary, err := h.svc.GetDailySummary(marketDate)
	if err != nil {
		HandleAppError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, APIResponse(summary))
}

// List handles GET /daily-summaries.
func (h *DailySummariesHandler) List(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 30)
	summaries, err := h.svc.ListDailySummaries(limit)
	if err != nil {
		HandleAppError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, APIResponse(summaries))
}

// queryInt reads an integer query parameter with a default value.
func queryInt(r *http.Request, key string, defaultVal int) int {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return defaultVal
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		return defaultVal
	}
	return v
}
