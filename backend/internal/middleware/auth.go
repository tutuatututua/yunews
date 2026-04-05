package middleware

import (
	"net/http"
	"strings"
)

// APIKeyAuth returns a middleware that enforces an API key on protected routes.
// If apiKey is empty the middleware is a no-op (open deployment).
func APIKeyAuth(apiKey string) func(http.Handler) http.Handler {
	apiKey = strings.TrimSpace(apiKey)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if apiKey == "" {
				next.ServeHTTP(w, r)
				return
			}
			token := extractBearer(r.Header.Get("Authorization"))
			if token == "" {
				token = strings.TrimSpace(r.Header.Get("X-API-Key"))
			}
			if token != apiKey {
				http.Error(w, `{"error":{"code":"unauthorized","message":"Unauthorized"}}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func extractBearer(authorization string) string {
	authorization = strings.TrimSpace(authorization)
	if authorization == "" {
		return ""
	}
	parts := strings.SplitN(authorization, " ", 2)
	if len(parts) != 2 {
		return ""
	}
	if !strings.EqualFold(parts[0], "bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}
