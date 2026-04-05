// Package svc implements business logic services.
package svc

import (
	"fmt"
	"time"

	"yunews/backend/internal/repo"
	"yunews/backend/internal/timeutil"
)

// DailySummary is the shaped output for a single daily summary.
type DailySummary struct {
	ID              string   `json:"id"`
	MarketDate      string   `json:"market_date"`
	Title           string   `json:"title"`
	OverallSummarize string  `json:"overall_summarize"`
	KeyPoints       []string `json:"key_points"`
	Risks           []string `json:"risks"`
	Opportunities   []string `json:"opportunities"`
	Sentiment       *string  `json:"sentiment"`
	SentimentScore  *float64 `json:"sentiment_score"`
	SentimentReason string   `json:"sentiment_reason"`
	Model           string   `json:"model"`
	GeneratedAt     string   `json:"generated_at"`
}

// DailySummariesService retrieves and shapes daily summary data.
type DailySummariesService struct {
	repo *repo.DailySummariesRepository
}

// NewDailySummariesService creates a new DailySummariesService.
func NewDailySummariesService(r *repo.DailySummariesRepository) *DailySummariesService {
	return &DailySummariesService{repo: r}
}

// GetDailySummary returns a shaped daily summary for the given market date, or nil if not found.
func (s *DailySummariesService) GetDailySummary(marketDate time.Time) (*DailySummary, error) {
	iso := marketDate.Format("2006-01-02")
	row, err := s.repo.FetchDailySummaryRow(iso)
	if err != nil {
		return nil, fmt.Errorf("get daily summary: %w", err)
	}
	return shapeDailySummaryRow(row, marketDate), nil
}

// GetLatestDailySummary returns the most recent shaped daily summary, or nil if none.
func (s *DailySummariesService) GetLatestDailySummary() (*DailySummary, error) {
	row, err := s.repo.FetchLatestDailySummaryRow()
	if err != nil {
		return nil, fmt.Errorf("get latest daily summary: %w", err)
	}
	if row == nil {
		return nil, nil
	}
	rawDate, _ := row["market_date"].(string)
	if rawDate == "" {
		return nil, nil
	}
	md, err := time.Parse("2006-01-02", rawDate)
	if err != nil {
		return nil, nil
	}
	return shapeDailySummaryRow(row, md), nil
}

// ListDailySummaries returns up to limit shaped daily summaries ordered by latest market date.
func (s *DailySummariesService) ListDailySummaries(limit int) ([]DailySummary, error) {
	vRows, err := s.repo.FetchRecentVideoPublishedAtRows(2000)
	if err != nil {
		return nil, fmt.Errorf("list daily summaries: %w", err)
	}

	seen := map[string]bool{}
	var dates []time.Time
	for _, row := range vRows {
		pa, _ := row["published_at"].(string)
		if pa == "" {
			continue
		}
		t, err := timeutil.ParseISODatetime(pa)
		if err != nil {
			continue
		}
		d := t.In(timeutil.MarketTZ)
		iso := fmt.Sprintf("%04d-%02d-%02d", d.Year(), d.Month(), d.Day())
		if seen[iso] {
			continue
		}
		seen[iso] = true
		dates = append(dates, time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC))
		if len(dates) >= limit {
			break
		}
	}

	if len(dates) == 0 {
		return nil, nil
	}

	isos := make([]string, len(dates))
	for i, d := range dates {
		isos[i] = d.Format("2006-01-02")
	}

	sRows, err := s.repo.FetchDailySummaryRowsForDates(isos)
	if err != nil {
		return nil, fmt.Errorf("list daily summaries: fetch rows: %w", err)
	}

	rowsByDate := map[string]map[string]interface{}{}
	for _, r := range sRows {
		md, _ := r["market_date"].(string)
		if md != "" {
			rowsByDate[md] = r
		}
	}

	var out []DailySummary
	for _, d := range dates {
		iso := d.Format("2006-01-02")
		if shaped := shapeDailySummaryRow(rowsByDate[iso], d); shaped != nil {
			out = append(out, *shaped)
		}
	}
	return out, nil
}

// shapeDailySummaryRow converts a raw Supabase row into a DailySummary.
// Returns nil if the row has no key_points (incomplete data).
func shapeDailySummaryRow(row map[string]interface{}, marketDate time.Time) *DailySummary {
	if row == nil {
		return nil
	}

	kp := toStringSlice(row["key_points"])
	if len(kp) == 0 {
		return nil
	}

	iso := marketDate.Format("2006-01-02")
	title, _ := row["title"].(string)
	if title == "" {
		title = "Market Summary — " + iso
	}

	genAt, _ := row["generated_at"].(string)
	if genAt == "" {
		genAt = time.Now().UTC().Format(time.RFC3339)
	}

	model, _ := row["model"].(string)
	if model == "" {
		model = "daily_summaries"
	}

	overallSummarize, _ := row["overall_summarize"].(string)
	sentimentReason, _ := row["sentiment_reason"].(string)

	var sentiment *string
	if v, ok := row["sentiment"].(string); ok && v != "" {
		sentiment = &v
	}

	var sentimentScore *float64
	if v, ok := row["sentiment_score"].(float64); ok {
		sentimentScore = &v
	}

	return &DailySummary{
		ID:               iso,
		MarketDate:       iso,
		Title:            title,
		OverallSummarize: overallSummarize,
		KeyPoints:        kp,
		Risks:            toStringSlice(row["risks"]),
		Opportunities:    toStringSlice(row["opportunities"]),
		Sentiment:        sentiment,
		SentimentScore:   sentimentScore,
		SentimentReason:  sentimentReason,
		Model:            model,
		GeneratedAt:      genAt,
	}
}

// toStringSlice converts an interface{} JSON array to []string, returning nil if empty.
func toStringSlice(v interface{}) []string {
	if v == nil {
		return nil
	}
	arr, ok := v.([]interface{})
	if !ok {
		return nil
	}
	out := make([]string, 0, len(arr))
	for _, item := range arr {
		if item == nil {
			continue
		}
		s := fmt.Sprintf("%v", item)
		if s != "" {
			out = append(out, s)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
