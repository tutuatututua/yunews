package repo

import (
	"fmt"

	"yunews/backend/internal/supabase"
)

// EntitiesRepository accesses the videos and summaries tables for entity/ticker operations.
type EntitiesRepository struct {
	db *supabase.Client
}

// NewEntitiesRepository creates a new EntitiesRepository.
func NewEntitiesRepository(db *supabase.Client) *EntitiesRepository {
	return &EntitiesRepository{db: db}
}

// FetchVideoIDsInWindow fetches video_id values within a published_at window.
func (r *EntitiesRepository) FetchVideoIDsInWindow(startISO, endISO string, limit int) ([]string, error) {
	var rows []map[string]interface{}
	err := r.db.From("videos").
		Select("video_id").
		Gte("published_at", startISO).
		Lte("published_at", endISO).
		Order("published_at", true).
		Limit(limit).
		Execute(&rows)
	if err != nil {
		return nil, fmt.Errorf("fetch video ids in window: %w", err)
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		if id := supabase.GetStr(row, "video_id"); id != "" {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

// FetchSummariesForVideoIDs fetches ticker summaries for given video IDs.
func (r *EntitiesRepository) FetchSummariesForVideoIDs(videoIDs []string, limit int) ([]map[string]interface{}, error) {
	if len(videoIDs) == 0 {
		return nil, nil
	}
	var rows []map[string]interface{}
	err := r.db.From("summaries").
		Select("video_id,ticker,summary").
		In("video_id", videoIDs).
		Limit(limit).
		Execute(&rows)
	if err != nil {
		return nil, fmt.Errorf("fetch summaries for video ids: %w", err)
	}
	return rows, nil
}

// FetchRecentVideos fetches video metadata within a published_at window.
func (r *EntitiesRepository) FetchRecentVideos(startISO, endISO string, limit int) ([]map[string]interface{}, error) {
	var rows []map[string]interface{}
	err := r.db.From("videos").
		Select("video_id,published_at,video_url,channel,title").
		Gte("published_at", startISO).
		Lte("published_at", endISO).
		Order("published_at", true).
		Limit(limit).
		Execute(&rows)
	if err != nil {
		return nil, fmt.Errorf("fetch recent videos: %w", err)
	}
	return rows, nil
}

// FetchEntitySummaryRows fetches summaries for a symbol within allowed video IDs, with embedded video metadata.
func (r *EntitiesRepository) FetchEntitySummaryRows(symbol string, allowedVideoIDs []string, limit int) ([]map[string]interface{}, error) {
	if len(allowedVideoIDs) == 0 {
		return nil, nil
	}
	var rows []map[string]interface{}
	err := r.db.From("summaries").
		Select("video_id,ticker,summary,created_at,videos(video_url,video_id,channel,title,published_at)").
		Eq("ticker", symbol).
		Order("created_at", true).
		Limit(limit).
		In("video_id", allowedVideoIDs).
		Execute(&rows)
	if err != nil {
		return nil, fmt.Errorf("fetch entity summary rows: %w", err)
	}
	return rows, nil
}
