package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"yunews/backend/internal/config"
	"yunews/backend/internal/middleware"
	"yunews/backend/internal/repo"
)

// TrackHandler handles visit tracking.
type TrackHandler struct {
	repo    *repo.LogsRepository
	logIPs  bool
}

// NewTrackHandler creates a TrackHandler.
func NewTrackHandler(r *repo.LogsRepository, cfg *config.Config) *TrackHandler {
	return &TrackHandler{repo: r, logIPs: cfg.LogVisitIPs}
}

type trackRequest struct {
	Path     string  `json:"path"`
	Search   *string `json:"search,omitempty"`
	Referrer *string `json:"referrer,omitempty"`
}

// Track handles POST /track and POST /api/track.
func (h *TrackHandler) Track(w http.ResponseWriter, r *http.Request) {
	if !h.logIPs {
		WriteJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
		return
	}

	var payload trackRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]interface{}{"error": "BAD_REQUEST", "message": "invalid request body"})
		return
	}

	ip := ClientIP(r)
	rid := middleware.GetRequestID(r.Context())
	ua := r.Header.Get("User-Agent")
	var uaPtr, ridPtr *string
	if ua != "" {
		uaPtr = &ua
	}
	if rid != "" {
		ridPtr = &rid
	}

	referer := payload.Referrer
	if referer == nil {
		if rf := r.Header.Get("Referer"); rf != "" {
			referer = &rf
		}
	}

	path := strings.TrimSpace(payload.Path)
	if path == "" {
		path = "/"
	}
	if len(path) > 500 {
		path = path[:500]
	}
	if payload.Search != nil && *payload.Search != "" {
		s := strings.TrimSpace(*payload.Search)
		if !strings.HasPrefix(s, "?") {
			s = "?" + s
		}
		combined := path + s
		if len(combined) > 500 {
			combined = combined[:500]
		}
		path = combined
	}

	h.repo.InsertVisit(ip, path, r.Method, uaPtr, referer, ridPtr)
	WriteJSON(w, http.StatusOK, map[string]interface{}{"ok": true})
}
