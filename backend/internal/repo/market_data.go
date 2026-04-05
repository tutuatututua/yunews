package repo

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"yunews/backend/internal/supabase"
)

// MarketDataRepository fetches daily OHLCV data from Yahoo Finance (with Stooq fallback).
// The supabase.Client is kept for interface consistency but not used for market data.
type MarketDataRepository struct {
	_ *supabase.Client // unused, kept for symmetry
	httpClient *http.Client
}

// NewMarketDataRepository creates a new MarketDataRepository.
func NewMarketDataRepository(_ *supabase.Client) *MarketDataRepository {
	return &MarketDataRepository{
		httpClient: &http.Client{
			Timeout: 12 * time.Second,
		},
	}
}

// CloseBar represents a single daily close price.
type CloseBar struct {
	Date     string   `json:"date"`
	Close    *float64 `json:"close"`
	AdjClose *float64 `json:"adj_close"`
}

// FetchDailyCloseSeries fetches daily close prices for symbol from Yahoo Finance.
// start is inclusive; endExclusive is the first date NOT included.
func (r *MarketDataRepository) FetchDailyCloseSeries(symbol string, start, endExclusive time.Time) ([]CloseBar, error) {
	// Try Yahoo Finance chart API.
	if bars, err := r.fetchYahooChart(symbol, start, endExclusive); err == nil && len(bars) > 0 {
		return bars, nil
	}

	// Fallback: Stooq (US equities only).
	if bars, err := r.fetchStooq(symbol, start, endExclusive); err == nil && len(bars) > 0 {
		return bars, nil
	}

	return nil, fmt.Errorf("all market data sources failed for %q", symbol)
}

func (r *MarketDataRepository) fetchYahooChart(symbol string, start, endExclusive time.Time) ([]CloseBar, error) {
	period1 := start.UTC().Unix()
	period2 := endExclusive.UTC().Unix()

	url := fmt.Sprintf(
		"https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=1d&events=history&includeAdjustedClose=true&period1=%d&period2=%d",
		symbol, period1, period2,
	)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
	req.Header.Set("Accept", "application/json")

	resp, err := r.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yahoo chart HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}

	chart, _ := payload["chart"].(map[string]interface{})
	if chart == nil {
		return nil, fmt.Errorf("yahoo chart: missing chart key")
	}
	if errVal := chart["error"]; errVal != nil {
		return nil, fmt.Errorf("yahoo chart error: %v", errVal)
	}

	result, _ := chart["result"].([]interface{})
	if len(result) == 0 {
		return nil, fmt.Errorf("yahoo chart: empty result")
	}

	r0, _ := result[0].(map[string]interface{})
	if r0 == nil {
		return nil, fmt.Errorf("yahoo chart: invalid result[0]")
	}

	tsRaw, _ := r0["timestamp"].([]interface{})
	indicators, _ := r0["indicators"].(map[string]interface{})
	if tsRaw == nil || indicators == nil {
		return nil, fmt.Errorf("yahoo chart: missing timestamp or indicators")
	}

	quoteArr, _ := indicators["quote"].([]interface{})
	if len(quoteArr) == 0 {
		return nil, fmt.Errorf("yahoo chart: no quote data")
	}
	q0, _ := quoteArr[0].(map[string]interface{})
	closesRaw, _ := q0["close"].([]interface{})
	if closesRaw == nil {
		return nil, fmt.Errorf("yahoo chart: no close values")
	}

	var adjVals []interface{}
	if adjcloseArr, ok := indicators["adjclose"].([]interface{}); ok && len(adjcloseArr) > 0 {
		if a0, ok := adjcloseArr[0].(map[string]interface{}); ok {
			adjVals, _ = a0["adjclose"].([]interface{})
		}
	}

	startDate := start.UTC().Truncate(24 * time.Hour)
	endDate := endExclusive.UTC().Truncate(24 * time.Hour)

	var bars []CloseBar
	for i, tsVal := range tsRaw {
		tsFloat, _ := toFloat64(tsVal)
		if tsFloat == 0 {
			continue
		}
		t := time.Unix(int64(tsFloat), 0).UTC()
		d := t.Truncate(24 * time.Hour)
		if d.Before(startDate) || !d.Before(endDate) {
			continue
		}

		var closePtr *float64
		if i < len(closesRaw) {
			if v, ok := toFloat64(closesRaw[i]); ok && !math.IsNaN(v) {
				closePtr = &v
			}
		}

		var adjPtr *float64
		if adjVals != nil && i < len(adjVals) {
			if v, ok := toFloat64(adjVals[i]); ok && !math.IsNaN(v) {
				adjPtr = &v
			}
		}

		bars = append(bars, CloseBar{
			Date:     d.Format("2006-01-02"),
			Close:    closePtr,
			AdjClose: adjPtr,
		})
	}

	return bars, nil
}

var usTickerRe = regexp.MustCompile(`^[A-Z]{1,10}$`)

func (r *MarketDataRepository) fetchStooq(symbol string, start, endExclusive time.Time) ([]CloseBar, error) {
	if !usTickerRe.MatchString(symbol) {
		return nil, fmt.Errorf("stooq: symbol %q not a simple US ticker", symbol)
	}

	url := fmt.Sprintf("https://stooq.com/q/d/l/?s=%s.us&i=d", strings.ToLower(symbol))
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")

	resp, err := r.httpClient.Do(req)
	if err != nil {
		slog.Warn("stooq request failed", "symbol", symbol, "error", err)
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("stooq HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	text := strings.TrimSpace(string(body))
	if text == "" || !strings.Contains(text, "Date") {
		return nil, fmt.Errorf("stooq: invalid response for %q", symbol)
	}

	reader := csv.NewReader(strings.NewReader(text))
	records, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}

	if len(records) < 2 {
		return nil, fmt.Errorf("stooq: no data rows")
	}

	// Find column indices
	header := records[0]
	dateIdx, closeIdx := -1, -1
	for i, col := range header {
		switch strings.TrimSpace(col) {
		case "Date":
			dateIdx = i
		case "Close":
			closeIdx = i
		}
	}
	if dateIdx < 0 || closeIdx < 0 {
		return nil, fmt.Errorf("stooq: missing Date or Close column")
	}

	startDate := start.UTC().Truncate(24 * time.Hour)
	endDate := endExclusive.UTC().Truncate(24 * time.Hour)

	var bars []CloseBar
	for _, row := range records[1:] {
		if len(row) <= dateIdx || len(row) <= closeIdx {
			continue
		}
		ds := strings.TrimSpace(row[dateIdx])
		if ds == "" {
			continue
		}
		d, err := time.Parse("2006-01-02", ds)
		if err != nil {
			continue
		}
		d = d.UTC()
		if d.Before(startDate) || !d.Before(endDate) {
			continue
		}

		var closePtr *float64
		if cv := strings.TrimSpace(row[closeIdx]); cv != "" {
			if f, err := strconv.ParseFloat(cv, 64); err == nil {
				closePtr = &f
			}
		}

		bars = append(bars, CloseBar{Date: d.Format("2006-01-02"), Close: closePtr})
	}

	return bars, nil
}

func toFloat64(v interface{}) (float64, bool) {
	if v == nil {
		return 0, false
	}
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case string:
		f, err := strconv.ParseFloat(t, 64)
		return f, err == nil
	}
	return 0, false
}
