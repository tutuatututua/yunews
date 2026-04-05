package repo

import (
	"fmt"

	"yunews/backend/internal/supabase"
)

// VideosRepository accesses the videos, video_summaries, and summaries tables.
type VideosRepository struct {
	db *supabase.Client
}

// NewVideosRepository creates a new VideosRepository.
func NewVideosRepository(db *supabase.Client) *VideosRepository {
	return &VideosRepository{db: db}
}

// FetchVideoListRows fetches videos with embedded video_summaries.
// If startISO/endISO are non-empty, filters by published_at range.
func (r *VideosRepository) FetchVideoListRows(startISO, endISO string, limit int) ([]map[string]interface{}, error) {
	q := r.db.From("videos").
		Select("video_id,title,channel,published_at,video_url,thumbnail_url,view_count,like_count,comment_count,duration_seconds,video_summaries(overall_explanation,sentiment)").
		Order("published_at", true).
		Limit(limit)

	if startISO != "" && endISO != "" {
		q = q.Gte("published_at", startISO).Lte("published_at", endISO)
	}

	var rows []map[string]interface{}
	if err := q.Execute(&rows); err != nil {
		return nil, fmt.Errorf("fetch video list rows: %w", err)
	}
	return rows, nil
}

// FetchVideosBasicWindow fetches video metadata within a published_at window.
func (r *VideosRepository) FetchVideosBasicWindow(startISO, endISO string, limit int) ([]map[string]interface{}, error) {
	var rows []map[string]interface{}
	err := r.db.From("videos").
		Select("video_id,title,channel,published_at,video_url,thumbnail_url").
		Gte("published_at", startISO).
		Lte("published_at", endISO).
		Order("published_at", true).
		Limit(limit).
		Execute(&rows)
	if err != nil {
		return nil, fmt.Errorf("fetch videos basic window: %w", err)
	}
	return rows, nil
}

// FetchSummariesForVideoIDs fetches ticker-level summaries for the given video IDs.
func (r *VideosRepository) FetchSummariesForVideoIDs(videoIDs []string, limit int) ([]map[string]interface{}, error) {
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

// FetchVideoRow fetches a single video row by video_id.
func (r *VideosRepository) FetchVideoRow(videoID string) (map[string]interface{}, error) {
	var rows []map[string]interface{}
	err := r.db.From("videos").
		Select("video_id,title,channel,published_at,video_url,thumbnail_url,view_count,like_count,comment_count,duration_seconds").
		Eq("video_id", videoID).
		Limit(1).
		Execute(&rows)
	if err != nil {
		return nil, fmt.Errorf("fetch video row: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

// FetchVideoSummaryRow fetches the video-level summary for a video_id.
func (r *VideosRepository) FetchVideoSummaryRow(videoID string) (map[string]interface{}, error) {
	var rows []map[string]interface{}
	err := r.db.From("video_summaries").
		Select("video_titles,published_at,summary_markdown,overall_explanation,movers,risks,opportunities,key_points,sentiment,events,model,summarized_at").
		Eq("video_id", videoID).
		Limit(1).
		Execute(&rows)
	if err != nil {
		return nil, fmt.Errorf("fetch video summary row: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

// FetchVideoTickerRows fetches the set of tickers associated with a video.
func (r *VideosRepository) FetchVideoTickerRows(videoID string, limit int) ([]map[string]interface{}, error) {
	var rows []map[string]interface{}
	err := r.db.From("summaries").
		Select("ticker").
		Eq("video_id", videoID).
		Limit(limit).
		Execute(&rows)
	if err != nil {
		return nil, fmt.Errorf("fetch video ticker rows: %w", err)
	}
	return rows, nil
}

// FetchLatestPerTickerSummaryRows fetches per-ticker summaries for a video, newest first.
func (r *VideosRepository) FetchLatestPerTickerSummaryRows(videoID string, limit int) ([]map[string]interface{}, error) {
	var rows []map[string]interface{}
	err := r.db.From("summaries").
		Select("ticker,summary,created_at").
		Eq("video_id", videoID).
		Order("created_at", true).
		Limit(limit).
		Execute(&rows)
	if err != nil {
		return nil, fmt.Errorf("fetch latest per-ticker summary rows: %w", err)
	}
	return rows, nil
}
