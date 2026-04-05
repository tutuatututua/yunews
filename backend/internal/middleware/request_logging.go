package middleware

import (
	"log/slog"
	"net/http"
	"time"
)

// RequestLoggingMiddleware logs every request with method, path, status, and latency.
func RequestLoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rid := GetRequestID(r.Context())

		wrapped := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(wrapped, r)

		slog.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", wrapped.status,
			"latency_ms", time.Since(start).Milliseconds(),
			"request_id", rid,
		)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}
