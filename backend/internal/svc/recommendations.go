package svc

import (
	"time"

	"yunews/backend/internal/apperr"
	"yunews/backend/internal/repo"
	"yunews/backend/internal/supabase"
	"yunews/backend/internal/timeutil"
)

// RecommendationEvent mirrors recommendations schema.
type RecommendationEvent struct {
	VideoID           string   `json:"video_id"`
	Ticker            string   `json:"ticker"`
	Action            string   `json:"action"`
	Title             *string  `json:"title,omitempty"`
	Channel           *string  `json:"channel,omitempty"`
	PublishedAt       *string  `json:"published_at,omitempty"`
	VideoURL          *string  `json:"video_url,omitempty"`
	ThumbnailURL      *string  `json:"thumbnail_url,omitempty"`
	PositiveKeypoints []string `json:"positive_keypoints"`
	EntryDate         *string  `json:"entry_date,omitempty"`
	EntryClose        *float64 `json:"entry_close,omitempty"`
	LatestDate        *string  `json:"latest_date,omitempty"`
	LatestClose       *float64 `json:"latest_close,omitempty"`
	ReturnPct         *float64 `json:"return_pct,omitempty"`
	Return7dPct       *float64 `json:"return_7d_pct,omitempty"`
	Return30dPct      *float64 `json:"return_30d_pct,omitempty"`
}

// RecommendationListData is the response for the list endpoint.
type RecommendationListData struct {
	Items []RecommendationEvent `json:"items"`
}

// RecommendationOverlayData is the response for the overlay endpoint.
type RecommendationOverlayData struct {
	Symbol string                `json:"symbol"`
	Prices []repo.CloseBar       `json:"prices"`
	Events []RecommendationEvent `json:"events"`
}

// RecommendationsService handles recommendation business logic.
type RecommendationsService struct {
	repo        *repo.RecommendationsRepository
	marketData  *MarketDataService
}

// NewRecommendationsService creates a RecommendationsService.
func NewRecommendationsService(r *repo.RecommendationsRepository, mds *MarketDataService) *RecommendationsService {
	return &RecommendationsService{repo: r, marketData: mds}
}

// ListRecommendations returns a filtered, shaped list of recommendation events.
func (s *RecommendationsService) ListRecommendations(symbol *string, days, limit int) (*RecommendationListData, error) {
	if days < 1 {
		days = 1
	}
	if limit < 1 {
		limit = 1
	}

	start := timeutil.MarketToday().AddDate(0, 0, -days)
	startISO := start.Format("2006-01-02")

	var sym string
	if symbol != nil {
		sym = *symbol
	}

	rows, err := s.repo.FetchRecommendationRows(sym, startISO, limit)
	if err != nil {
		return nil, err
	}

	// Collect video_ids and tickers for the summary query.
	videoIDs := make([]string, 0, len(rows))
	tickers := make([]string, 0, len(rows))
	for _, r := range rows {
		vid := supabase.GetStr(r, "video_id")
		ticker := normalizeSymbol(supabase.GetStr(r, "ticker"))
		if vid != "" {
			videoIDs = append(videoIDs, vid)
		}
		if ticker != "" {
			tickers = append(tickers, ticker)
		}
	}

	summaryRows, err := s.repo.FetchSummaryRowsForRecommendations(videoIDs, tickers)
	if err != nil {
		return nil, err
	}

	// Map (video_id, ticker) → positive keypoints.
	type pairKey struct{ vid, ticker string }
	keypointsMap := map[pairKey][]string{}
	for _, sr := range summaryRows {
		vid := supabase.GetStr(sr, "video_id")
		ticker := normalizeSymbol(supabase.GetStr(sr, "ticker"))
		if vid == "" || ticker == "" {
			continue
		}
		summaryRaw := sr["summary"]
		keypointsMap[pairKey{vid, ticker}] = extractPositiveKeypoints(summaryRaw, 6)
	}

	events := make([]RecommendationEvent, 0, len(rows))
	for _, r := range rows {
		vid := supabase.GetStr(r, "video_id")
		ticker := normalizeSymbol(supabase.GetStr(r, "ticker"))
		if vid == "" || ticker == "" || ticker == "MARKET" {
			continue
		}

		// videos is a nested object (first element if array).
		v := supabase.GetMap(r, "videos")

		publishedAt := supabase.GetStrPtr(r, "published_at")
		if publishedAt == nil {
			if pa := supabase.GetStrPtr(v, "published_at"); pa != nil {
				publishedAt = pa
			}
		}

		events = append(events, RecommendationEvent{
			VideoID:           vid,
			Ticker:            ticker,
			Action:            "buy",
			Title:             supabase.GetStrPtr(v, "title"),
			Channel:           supabase.GetStrPtr(v, "channel"),
			PublishedAt:       publishedAt,
			VideoURL:          supabase.GetStrPtr(v, "video_url"),
			ThumbnailURL:      supabase.GetStrPtr(v, "thumbnail_url"),
			PositiveKeypoints: keypointsMap[pairKey{vid, ticker}],
		})
	}

	return &RecommendationListData{Items: events}, nil
}

// GetRecommendationOverlay returns price series + enriched recommendation events.
func (s *RecommendationsService) GetRecommendationOverlay(symbol string, days int) (*RecommendationOverlayData, error) {
	sym := normalizeSymbol(symbol)
	if sym == "" {
		return nil, apperr.BadRequest("symbol is required")
	}
	if days < 1 {
		days = 1
	}

	recs, err := s.ListRecommendations(&sym, days, 2000)
	if err != nil {
		return nil, err
	}
	if len(recs.Items) == 0 {
		return &RecommendationOverlayData{Symbol: sym, Prices: []repo.CloseBar{}, Events: []RecommendationEvent{}}, nil
	}

	end := timeutil.MarketToday()
	start := end.AddDate(0, 0, -days)

	prices, _ := s.marketData.FetchDailyCloseSeries(sym, start, end)
	if prices == nil {
		prices = []repo.CloseBar{}
	}

	// Determine latest available close.
	latestDate, latestClose := closeOnOrAfter(prices, end, true)

	enriched := make([]RecommendationEvent, 0, len(recs.Items))
	for _, e := range recs.Items {
		// Determine event day from published_at.
		eventDay := end
		if e.PublishedAt != nil && *e.PublishedAt != "" {
			if t, err2 := time.Parse(time.RFC3339, *e.PublishedAt); err2 == nil {
				ny := timeutil.MarketTZ
				eventDay = t.In(ny).Truncate(24 * time.Hour).In(ny).Round(0)
				// Convert to a plain date.
				eventDay = time.Date(eventDay.Year(), eventDay.Month(), eventDay.Day(), 0, 0, 0, 0, time.UTC)
			}
		}

		entryDate, entryClose := closeOnOrAfter(prices, eventDay, true)
		if entryDate == "" {
			entryDate = latestDate
			entryClose = latestClose
		}

		day7Date, day7Close := closeOnOrAfter(prices, eventDay.AddDate(0, 0, 7), false)
		day30Date, day30Close := closeOnOrAfter(prices, eventDay.AddDate(0, 0, 30), false)
		_ = day7Date
		_ = day30Date

		ret := computeReturn(entryClose, latestClose)
		ret7d := computeReturn(entryClose, day7Close)
		ret30d := computeReturn(entryClose, day30Close)

		ev := e // copy
		ev.EntryDate = strPtr(entryDate)
		ev.EntryClose = entryClose
		ev.LatestDate = strPtr(latestDate)
		ev.LatestClose = latestClose
		ev.ReturnPct = ret
		ev.Return7dPct = ret7d
		ev.Return30dPct = ret30d

		enriched = append(enriched, ev)
	}

	return &RecommendationOverlayData{Symbol: sym, Prices: prices, Events: enriched}, nil
}

// closeOnOrAfter returns the first price bar on or after target, or latest if fallback is true.
func closeOnOrAfter(prices []repo.CloseBar, target time.Time, fallback bool) (string, *float64) {
	if len(prices) == 0 {
		return "", nil
	}

	targetDate := target.UTC().Format("2006-01-02")

	var bestDate string
	var bestClose *float64

	var latestDate string
	var latestClose *float64

	for _, b := range prices {
		d := b.Date
		if d == "" {
			continue
		}

		cl := chooseClose(&b)

		// Track latest overall.
		if latestDate == "" || d > latestDate {
			latestDate = d
			latestClose = cl
		}

		// Track first on-or-after target.
		if d >= targetDate {
			if bestDate == "" || d < bestDate {
				bestDate = d
				bestClose = cl
			}
		}
	}

	if bestDate != "" {
		return bestDate, bestClose
	}
	if fallback {
		return latestDate, latestClose
	}
	return "", nil
}

func chooseClose(b *repo.CloseBar) *float64 {
	if b.AdjClose != nil {
		return b.AdjClose
	}
	return b.Close
}

func computeReturn(entry, exit *float64) *float64 {
	if entry == nil || exit == nil || *entry <= 0 {
		return nil
	}
	r := (*exit - *entry) / *entry
	return &r
}

func extractPositiveKeypoints(summaryRaw interface{}, maxItems int) []string {
	m, ok := summaryRaw.(map[string]interface{})
	if !ok {
		return nil
	}

	var items []interface{}
	if v, ok2 := m["positive"]; ok2 {
		if sl, ok3 := v.([]interface{}); ok3 {
			items = sl
		}
	}
	if items == nil {
		if v, ok2 := m["bull_case"]; ok2 {
			if sl, ok3 := v.([]interface{}); ok3 {
				items = sl
			}
		}
	}
	if len(items) == 0 {
		return nil
	}

	seen := map[string]bool{}
	out := make([]string, 0, maxItems)
	for _, item := range items {
		if len(out) >= maxItems {
			break
		}
		var value string
		switch v := item.(type) {
		case string:
			value = v
		case map[string]interface{}:
			for _, k := range []string{"claim", "text", "reason", "summary", "content"} {
				if raw, ok2 := v[k]; ok2 {
					if s, ok3 := raw.(string); ok3 && s != "" {
						value = s
						break
					}
				}
			}
		}
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
