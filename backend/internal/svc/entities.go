package svc

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"yunews/backend/internal/repo"
	"yunews/backend/internal/timeutil"
)

const (
	maxVideosScan        = 4000
	videoIDChunkSize     = 400
	summaryBatchLimit    = 5000
	chunksPrefetchMult   = 3
	chunksPrefetchCap    = 1500
)

// TopMover represents a stock mover with direction and reason.
type TopMover struct {
	Symbol    string `json:"symbol"`
	Direction string `json:"direction"` // "bullish" | "bearish" | "mixed"
	Reason    string `json:"reason"`
}

// EntityChunkRow is the output for the chunks-for-entity endpoint.
type EntityChunkRow struct {
	Entities            []map[string]interface{} `json:"entities"`
	ComputedAt          interface{}              `json:"computed_at"`
	MarketDate          *string                  `json:"market_date"`
	KeypointsBySentiment map[string][]string     `json:"keypoints_by_sentiment"`
	Videos              map[string]interface{}   `json:"videos"`
}

// EntitiesService provides entity-level analytics.
type EntitiesService struct {
	repo *repo.EntitiesRepository
}

// NewEntitiesService creates a new EntitiesService.
func NewEntitiesService(r *repo.EntitiesRepository) *EntitiesService {
	return &EntitiesService{repo: r}
}

func clampInt(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func normalizeSymbol(s string) string {
	return strings.ToUpper(strings.TrimSpace(s))
}

// TopMovers computes the top-mover list for the given window.
func (s *EntitiesService) TopMovers(date *time.Time, days, limit int) ([]TopMover, error) {
	days = clampInt(days, 1, 30)
	limit = clampInt(limit, 1, 50)

	endD := timeutil.MarketToday()
	if date != nil {
		endD = *date
	}
	startD := timeutil.DateAdd(endD, -(days - 1))
	start, _ := timeutil.MarketDayBounds(startD)
	_, end := timeutil.MarketDayBounds(endD)

	videoIDs, err := s.repo.FetchVideoIDsInWindow(start, end, maxVideosScan)
	if err != nil {
		return nil, fmt.Errorf("top movers: %w", err)
	}
	if len(videoIDs) == 0 {
		return nil, nil
	}

	type bucket struct {
		symbol   string
		positive int
		negative int
		neutral  int
		reason   string
	}
	acc := map[string]*bucket{}

	for _, chunk := range chunked(videoIDs, videoIDChunkSize) {
		rows, err := s.repo.FetchSummariesForVideoIDs(chunk, summaryBatchLimit)
		if err != nil {
			continue
		}
		for _, r := range rows {
			ticker, _ := r["ticker"].(string)
			if ticker == "" {
				continue
			}
			sym := normalizeSymbol(ticker)
			if sym == "" || sym == "MARKET" {
				continue
			}
			sumObj, _ := r["summary"].(map[string]interface{})
			p, n, u := summarySentimentCounts(sumObj)
			if p+n+u <= 0 {
				u = 1
			}
			if acc[sym] == nil {
				acc[sym] = &bucket{symbol: sym}
			}
			b := acc[sym]
			b.positive += p
			b.negative += n
			b.neutral += u
			if b.reason == "" {
				if reason := firstClaimFromSummary(sumObj); reason != "" {
					b.reason = reason
				}
			}
		}
	}

	if len(acc) == 0 {
		return nil, nil
	}

	type moverEntry struct {
		symbol string
		dir    string
		reason string
		net    int
		total  int
	}
	var movers []moverEntry
	for sym, b := range acc {
		total := b.positive + b.negative + b.neutral
		if total <= 0 {
			continue
		}
		dir := "mixed"
		if b.positive > b.negative {
			dir = "bullish"
		} else if b.negative > b.positive {
			dir = "bearish"
		}
		reason := b.reason
		if reason == "" {
			reason = "Mentioned frequently in recent coverage."
		}
		movers = append(movers, moverEntry{
			symbol: sym,
			dir:    dir,
			reason: reason,
			net:    b.positive - b.negative,
			total:  total,
		})
	}

	sort.Slice(movers, func(i, j int) bool {
		ai := abs(movers[i].net)
		aj := abs(movers[j].net)
		if ai != aj {
			return ai > aj
		}
		if movers[i].total != movers[j].total {
			return movers[i].total > movers[j].total
		}
		return movers[i].symbol < movers[j].symbol
	})

	if len(movers) > limit {
		movers = movers[:limit]
	}
	out := make([]TopMover, len(movers))
	for i, m := range movers {
		out[i] = TopMover{Symbol: m.symbol, Direction: m.dir, Reason: m.reason}
	}
	return out, nil
}

// ChunksForEntity returns recent keypoint chunks for a ticker symbol.
func (s *EntitiesService) ChunksForEntity(symbol string, days, limit int) ([]EntityChunkRow, error) {
	sym := normalizeSymbol(symbol)
	if sym == "" {
		return nil, nil
	}
	days = clampInt(days, 1, 30)
	limit = clampInt(limit, 1, 500)

	nowUTC := time.Now().UTC()
	startUTC := nowUTC.Add(-time.Duration(days) * 24 * time.Hour)
	startISO := startUTC.Format(time.RFC3339)
	endISO := nowUTC.Format(time.RFC3339)

	vids, err := s.repo.FetchRecentVideos(startISO, endISO, maxVideosScan)
	if err != nil {
		return nil, fmt.Errorf("chunks for entity: %w", err)
	}

	allowedIDs := make([]string, 0, len(vids))
	videoMeta := map[string]map[string]interface{}{}
	for _, v := range vids {
		vid, _ := v["video_id"].(string)
		if vid == "" {
			continue
		}
		allowedIDs = append(allowedIDs, vid)
		videoMeta[vid] = v
	}
	if len(allowedIDs) == 0 {
		return nil, nil
	}

	prefetch := limit * chunksPrefetchMult
	if prefetch > chunksPrefetchCap {
		prefetch = chunksPrefetchCap
	}
	if prefetch < limit {
		prefetch = limit
	}

	caRows, err := s.repo.FetchEntitySummaryRows(sym, allowedIDs, prefetch)
	if err != nil {
		return nil, fmt.Errorf("chunks for entity: fetch summaries: %w", err)
	}
	if len(caRows) == 0 {
		return nil, nil
	}

	var out []EntityChunkRow
	for _, r := range caRows {
		vid, _ := r["video_id"].(string)

		var v map[string]interface{}
		if embedded, ok := r["videos"].(map[string]interface{}); ok {
			v = embedded
		} else if meta := videoMeta[vid]; meta != nil {
			v = meta
		} else {
			v = map[string]interface{}{}
		}

		pa, _ := v["published_at"].(string)
		var marketDate *string
		if pa != "" {
			md := pa[:10]
			marketDate = &md
		}

		sumObj, _ := r["summary"].(map[string]interface{})
		kpsBySentiment := keypointsBySentiment(sumObj, 12)
		if !hasAnyKeypoints(kpsBySentiment) {
			continue
		}

		videoVidID := vid
		if vvid, ok := v["video_id"].(string); ok && vvid != "" {
			videoVidID = vvid
		}

		out = append(out, EntityChunkRow{
			Entities:             []map[string]interface{}{{"type": "ticker", "symbol": sym}},
			ComputedAt:           r["created_at"],
			MarketDate:           marketDate,
			KeypointsBySentiment: kpsBySentiment,
			Videos: map[string]interface{}{
				"video_url":    v["video_url"],
				"video_id":     videoVidID,
				"channel":      v["channel"],
				"title":        v["title"],
				"published_at": v["published_at"],
			},
		})
	}

	// Sort by (published_at desc, computed_at desc)
	sort.SliceStable(out, func(i, j int) bool {
		pi := parseSortTime(out[i].Videos["published_at"])
		pj := parseSortTime(out[j].Videos["published_at"])
		if !pi.Equal(pj) {
			return pi.After(pj)
		}
		ci := parseSortTimeIface(out[i].ComputedAt)
		cj := parseSortTimeIface(out[j].ComputedAt)
		return ci.After(cj)
	})

	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

// ─── helpers ───────────────────────────────────────────────────────────────

func chunked(items []string, size int) [][]string {
	var out [][]string
	for i := 0; i < len(items); i += size {
		end := i + size
		if end > len(items) {
			end = len(items)
		}
		out = append(out, items[i:end])
	}
	return out
}

func summarySentimentCounts(sum map[string]interface{}) (pos, neg, neutral int) {
	if sum == nil {
		return
	}
	if _, hasPNN := sum["positive"]; hasPNN {
		pos = sliceLen(sum["positive"])
		neg = sliceLen(sum["negative"])
		neutral = sliceLen(sum["neutral"])
		return
	}
	pos = sliceLen(sum["bull_case"])
	neg = sliceLen(sum["bear_case"]) + sliceLen(sum["risks"])
	return
}

func firstClaimFromSummary(sum map[string]interface{}) string {
	if sum == nil {
		return ""
	}
	for _, key := range []string{"positive", "negative", "neutral", "bull_case", "bear_case", "risks"} {
		items := toIfaceSlice(sum[key])
		if len(items) == 0 {
			continue
		}
		first := items[0]
		if s, ok := first.(string); ok {
			s = strings.TrimSpace(s)
			if s != "" {
				return s
			}
		}
		if m, ok := first.(map[string]interface{}); ok {
			for _, k := range []string{"claim", "text", "reason", "summary", "content"} {
				if v, ok := m[k].(string); ok && strings.TrimSpace(v) != "" {
					return strings.TrimSpace(v)
				}
			}
		}
	}
	return ""
}

func keypointsBySentiment(sum map[string]interface{}, maxPerBucket int) map[string][]string {
	result := map[string][]string{"positive": nil, "negative": nil, "neutral": nil}
	if sum == nil {
		return result
	}

	extractItems := func(items []interface{}) []string {
		seen := map[string]bool{}
		var out []string
		for _, item := range items {
			if len(out) >= maxPerBucket {
				break
			}
			var s string
			switch t := item.(type) {
			case string:
				s = strings.TrimSpace(t)
			case map[string]interface{}:
				for _, k := range []string{"claim", "text", "reason", "summary", "content"} {
					if v, ok := t[k].(string); ok && strings.TrimSpace(v) != "" {
						s = strings.TrimSpace(v)
						break
					}
				}
				if s == "" {
					s = fmt.Sprintf("%v", item)
				}
			default:
				s = fmt.Sprintf("%v", item)
			}
			s = strings.TrimSpace(s)
			if s == "" || strings.ToLower(s) == "none" || strings.ToLower(s) == "null" {
				continue
			}
			if seen[s] {
				continue
			}
			seen[s] = true
			out = append(out, s)
		}
		return out
	}

	if _, hasPNN := sum["positive"]; hasPNN {
		result["positive"] = extractItems(toIfaceSlice(sum["positive"]))
		result["negative"] = extractItems(toIfaceSlice(sum["negative"]))
		result["neutral"] = extractItems(toIfaceSlice(sum["neutral"]))
		return result
	}

	// bull_case / bear_case / risks mapping
	pos := extractItems(toIfaceSlice(sum["bull_case"]))
	bearNeg := extractItems(toIfaceSlice(sum["bear_case"]))
	risksNeg := extractItems(toIfaceSlice(sum["risks"]))
	neg := append(bearNeg, risksNeg...)
	if len(neg) > maxPerBucket {
		neg = neg[:maxPerBucket]
	}
	result["positive"] = pos
	result["negative"] = neg
	return result
}

func hasAnyKeypoints(kps map[string][]string) bool {
	for _, items := range kps {
		if len(items) > 0 {
			return true
		}
	}
	return false
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func parseSortTime(v interface{}) time.Time {
	if v == nil {
		return time.Time{}
	}
	s, _ := v.(string)
	if s == "" {
		return time.Time{}
	}
	t, _ := timeutil.ParseISODatetime(s)
	return t
}

func parseSortTimeIface(v interface{}) time.Time {
	if v == nil {
		return time.Time{}
	}
	s := fmt.Sprintf("%v", v)
	t, _ := timeutil.ParseISODatetime(s)
	return t
}
