package handler

import (
	"net/http"
)

// HealthHandler returns a simple health response.
func HealthHandler(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, map[string]interface{}{
		"status": "ok",
	})
}
