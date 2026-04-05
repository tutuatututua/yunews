package handler

import (
	"net/http"

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
	date := q.Get("date")
	days := queryInt(r, "days", 7)
	limit := queryInt(r, "limit", 50)

	result, err := h.svc.ListVideos(date, days, limit)
	if err != nil {
		HandleAppError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, APIResponse(result))
}

// Infographic handles GET /videos/infographic.
func (h *VideosHandler) Infographic(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	date := q.Get("date")
	days := queryInt(r, "days", 7)
	limit := queryInt(r, "limit", 200)

	result, err := h.svc.VideoInfographic(date, days, limit)
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
