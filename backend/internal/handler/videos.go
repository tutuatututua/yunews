package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"yunews/backend/internal/svc"
)

// VideosHandler handles all /videos routes.
type VideosHandler struct {
	svc *svc.VideosService
}

// NewVideosHandler creates a VideosHandler.
func NewVideosHandler(s *svc.VideosService) *VideosHandler {
	return &VideosHandler{svc: s}
}

// List handles GET /videos.
func (h *VideosHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var datePtr *time.Time
	if raw := q.Get("date"); raw != "" {
		if t, err := time.Parse("2006-01-02", raw); err == nil {
			datePtr = &t
		}
	}
	days := queryInt(r, "days", 7)
	daysPtr := &days
	limit := queryInt(r, "limit", 50)

	result, err := h.svc.ListVideos(datePtr, daysPtr, limit)
	if err != nil {
		HandleAppError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, APIResponse(result))
}

// Infographic handles GET /videos/infographic.
func (h *VideosHandler) Infographic(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	var datePtr *time.Time
	if raw := q.Get("date"); raw != "" {
		if t, err := time.Parse("2006-01-02", raw); err == nil {
			datePtr = &t
		}
	}
	days := queryInt(r, "days", 7)
	limit := queryInt(r, "limit", 200)

	result, err := h.svc.VideoInfographic(datePtr, days, limit)
	if err != nil {
		HandleAppError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, APIResponse(result))
}

// Detail handles GET /videos/{video_id}.
func (h *VideosHandler) Detail(w http.ResponseWriter, r *http.Request) {
	videoID := chi.URLParam(r, "video_id")
	result, err := h.svc.GetVideoDetail(videoID)
	if err != nil {
		HandleAppError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, APIResponse(result))
}
