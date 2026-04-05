package handler

import (
	"encoding/json"
	"net/http"

	"yunews/backend/internal/apperr"
	"yunews/backend/internal/tokenquota"
)

// WriteJSON writes a JSON response with status code.
func WriteJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// WriteError writes an AppError as JSON.
func WriteError(w http.ResponseWriter, err *apperr.AppError) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(err.StatusCode)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"error":   err.Code,
		"message": err.Message,
		"details": err.Details,
	})
}

// APIResponse wraps data in a standard {"data": ...} envelope.
func APIResponse(data interface{}) map[string]interface{} {
	return map[string]interface{}{"data": data}
}

// ClientIP extracts the best-effort client IP from the request.
func ClientIP(r *http.Request) string {
	xff := r.Header.Get("X-Forwarded-For")
	return tokenquota.ClientIP(xff, r.RemoteAddr)
}

// HandleAppError checks if err is an *apperr.AppError and writes it; otherwise writes a 500.
func HandleAppError(w http.ResponseWriter, err error) {
	if ae, ok := err.(*apperr.AppError); ok {
		WriteError(w, ae)
		return
	}
	WriteJSON(w, http.StatusInternalServerError, map[string]interface{}{
		"error":   "INTERNAL_ERROR",
		"message": "An unexpected error occurred",
	})
}
