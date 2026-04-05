package repo

import (
	"fmt"
	"strings"

	"yunews/backend/internal/supabase"
)

const dailySummaryColumns = "market_date,title,overall_summarize,key_points,risks,opportunities,sentiment,sentiment_score,sentiment_reason,model,generated_at"

// DailySummariesRepository accesses the daily_summaries and videos tables.
type DailySummariesRepository struct {
	db *supabase.Client
}

// NewDailySummariesRepository creates a new DailySummariesRepository.
func NewDailySummariesRepository(db *supabase.Client) *DailySummariesRepository {
	return &DailySummariesRepository{db: db}
}

// FetchDailySummaryRow fetches a single daily summary row by market date ISO string.
func (r *DailySummariesRepository) FetchDailySummaryRow(marketDateISO string) (map[string]interface{}, error) {
	var rows []map[string]interface{}
	err := r.db.From("daily_summaries").
		Select(dailySummaryColumns).
		Eq("market_date", marketDateISO).
		Limit(1).
		Execute(&rows)
	if err != nil {
		return nil, fmt.Errorf("fetch daily summary row: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

// FetchLatestDailySummaryRow fetches the most recent daily summary row.
func (r *DailySummariesRepository) FetchLatestDailySummaryRow() (map[string]interface{}, error) {
	var rows []map[string]interface{}
	err := r.db.From("daily_summaries").
		Select(dailySummaryColumns).
		Order("market_date", true).
		Limit(1).
		Execute(&rows)
	if err != nil {
		return nil, fmt.Errorf("fetch latest daily summary row: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	return rows[0], nil
}

// FetchRecentVideoPublishedAtRows fetches published_at values from the videos table.
func (r *DailySummariesRepository) FetchRecentVideoPublishedAtRows(limit int) ([]map[string]interface{}, error) {
	var rows []map[string]interface{}
	err := r.db.From("videos").
		Select("published_at").
		Order("published_at", true).
		Limit(limit).
		Execute(&rows)
	if err != nil {
		return nil, fmt.Errorf("fetch video published_at rows: %w", err)
	}
	return rows, nil
}

// FetchDailySummaryRowsForDates fetches daily summary rows for specific market dates.
func (r *DailySummariesRepository) FetchDailySummaryRowsForDates(marketDateISOs []string) ([]map[string]interface{}, error) {
	if len(marketDateISOs) == 0 {
		return nil, nil
	}
	// Deduplicate
	seen := map[string]bool{}
	unique := make([]string, 0, len(marketDateISOs))
	for _, d := range marketDateISOs {
		d = strings.TrimSpace(d)
		if d != "" && !seen[d] {
			seen[d] = true
			unique = append(unique, d)
		}
	}
	if len(unique) == 0 {
		return nil, nil
	}

	var rows []map[string]interface{}
	err := r.db.From("daily_summaries").
		Select(dailySummaryColumns).
		In("market_date", unique).
		Limit(len(unique)).
		Execute(&rows)
	if err != nil {
		return nil, fmt.Errorf("fetch daily summary rows for dates: %w", err)
	}
	return rows, nil
}
