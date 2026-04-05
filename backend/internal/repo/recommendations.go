package repo

import (
	"fmt"
	"log/slog"

	"yunews/backend/internal/supabase"
)

// RecommendationsRepository accesses the youtuber_recommendations and summaries tables.
type RecommendationsRepository struct {
	db *supabase.Client
}

// NewRecommendationsRepository creates a new RecommendationsRepository.
func NewRecommendationsRepository(db *supabase.Client) *RecommendationsRepository {
	return &RecommendationsRepository{db: db}
}

// FetchRecommendationRows fetches recommendation events joined with video metadata.
// symbol may be empty to fetch all. startISO is the earliest published_at to include.
func (r *RecommendationsRepository) FetchRecommendationRows(symbol, startISO string, limit int) ([]map[string]interface{}, error) {
	// Try published_at column first; fall back to created_at for older schemas.
	rows, err := r.fetchRecsByPublishedAt(symbol, startISO, limit)
	if err == nil {
		return rows, nil
	}

	slog.Warn("recommendations: published_at query failed, trying created_at fallback", "error", err)
	rows, err2 := r.fetchRecsByCreatedAt(symbol, limit)
	if err2 != nil {
		if isTableMissingError(err2) {
			return nil, nil
		}
		slog.Error("recommendations: created_at fallback also failed", "error", err2)
		return nil, nil
	}
	return rows, nil
}

func (r *RecommendationsRepository) fetchRecsByPublishedAt(symbol, startISO string, limit int) ([]map[string]interface{}, error) {
	q := r.db.From("youtuber_recommendations").
		Select("video_id,ticker,action,published_at,videos(title,channel,published_at,video_url,thumbnail_url)").
		Gte("published_at", startISO).
		Order("published_at", true).
		Limit(limit)
	if symbol != "" {
		q = q.Eq("ticker", symbol)
	}
	var rows []map[string]interface{}
	if err := q.Execute(&rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *RecommendationsRepository) fetchRecsByCreatedAt(symbol string, limit int) ([]map[string]interface{}, error) {
	q := r.db.From("youtuber_recommendations").
		Select("video_id,ticker,action,created_at,videos(title,channel,published_at,video_url,thumbnail_url)").
		Order("created_at", true).
		Limit(limit)
	if symbol != "" {
		q = q.Eq("ticker", symbol)
	}
	var rows []map[string]interface{}
	if err := q.Execute(&rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// FetchSummaryRowsForRecommendations fetches summaries matching video_id+ticker pairs.
func (r *RecommendationsRepository) FetchSummaryRowsForRecommendations(videoIDs, tickers []string) ([]map[string]interface{}, error) {
	if len(videoIDs) == 0 || len(tickers) == 0 {
		return nil, nil
	}

	limitN := len(videoIDs) * 4
	if limitN < 1 {
		limitN = 1
	}
	if limitN > 5000 {
		limitN = 5000
	}

	var rows []map[string]interface{}
	err := r.db.From("summaries").
		Select("video_id,ticker,summary").
		In("video_id", videoIDs).
		In("ticker", tickers).
		Limit(limitN).
		Execute(&rows)
	if err != nil {
		slog.Error("fetch summary rows for recommendations failed", "error", err)
		return nil, fmt.Errorf("fetch summary rows for recommendations: %w", err)
	}
	return rows, nil
}

func isTableMissingError(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return contains(msg, "youtuber_recommendations") && (contains(msg, "does not exist") || contains(msg, "relation") || contains(msg, "404"))
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		func() bool {
			for i := 0; i+len(substr) <= len(s); i++ {
				if s[i:i+len(substr)] == substr {
					return true
				}
			}
			return false
		}())
}
