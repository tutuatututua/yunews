package repo

import (
	"log/slog"

	"yunews/backend/internal/supabase"
)

// LogsRepository handles visit_logs and chat_logs tables.
type LogsRepository struct {
	db *supabase.Client
}

// NewLogsRepository creates a new LogsRepository.
func NewLogsRepository(db *supabase.Client) *LogsRepository {
	return &LogsRepository{db: db}
}

// InsertVisit inserts a visit log row. Best-effort — errors are only logged.
func (r *LogsRepository) InsertVisit(ip, path, method string, userAgent, referer, requestID *string) {
	payload := map[string]interface{}{
		"ip":         truncate(normalizeIP(ip), 100),
		"path":       truncate(path, 500),
		"method":     truncate(method, 20),
		"user_agent": truncateOrNilPtr(userAgent, 500),
		"referer":    truncateOrNilPtr(referer, 500),
		"request_id": truncateOrNilPtr(requestID, 100),
	}
	if err := r.db.Insert("visit_logs", payload); err != nil {
		slog.Warn("failed to insert visit log", "error", err)
	}
}

// ChatLogParams holds all fields for a chat log insert.
type ChatLogParams struct {
	IP           string
	RequestID    string
	Question     string
	History      interface{}
	ResponseText *string
	Sources      interface{}
	QueryPlan    interface{}
	Model        string
	Status       string
	ErrorMessage *string
}

// InsertChatLog inserts a chat log row. Best-effort — errors are only logged.
func (r *LogsRepository) InsertChatLog(params ChatLogParams) {
	status := params.Status
	if status == "" {
		status = "unknown"
	}
	payload := map[string]interface{}{
		"ip":            truncate(normalizeIP(params.IP), 100),
		"request_id":    truncateOrNil(params.RequestID, 100),
		"question":      truncate(params.Question, 20000),
		"history":       params.History,
		"response_text": params.ResponseText,
		"sources":       params.Sources,
		"query_plan":    params.QueryPlan,
		"model":         truncateOrNil(params.Model, 100),
		"status":        truncate(status, 50),
		"error_message": params.ErrorMessage,
	}
	if err := r.db.Insert("chat_logs", payload); err != nil {
		slog.Warn("failed to insert chat log", "error", err)
	}
}
