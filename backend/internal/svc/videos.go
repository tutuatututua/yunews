package svc

import (
	"fmt"
	"html"
	"strings"
	"time"

	"yunews/backend/internal/repo"
	"yunews/backend/internal/timeutil"
)

// VideoListItem is the shaped output for a video list row.
type VideoListItem struct {
	ID                 string   `json:"id"`
	VideoID            string   `json:"video_id"`
	Title              *string  `json:"title"`
	Channel            *string  `json:"channel"`
	PublishedAt        *string  `json:"published_at"`
	VideoURL           *string  `json:"video_url"`
	ThumbnailURL       *string  `json:"thumbnail_url"`
	ViewCount          *int     `json:"view_count"`
	LikeCount          *int     `json:"like_count"`
	CommentCount       *int     `json:"comment_count"`
	DurationSeconds    *int     `json:"duration_seconds"`
	OverallExplanation *string  `json:"overall_explanation"`
	Sentiment          *string  `json:"sentiment"`
}

// VideoInfographicEdge represents a ticker edge in the infographic.
type VideoInfographicEdge struct {
	Ticker    string   `json:"ticker"`
	Sentiment string   `json:"sentiment"`
	KeyPoints []string `json:"key_points"`
}

// VideoInfographicItem is the shaped output for the infographic endpoint.
type VideoInfographicItem struct {
	ID          string                 `json:"id"`
	VideoID     string                 `json:"video_id"`
	Title       string                 `json:"title"`
	Channel     string                 `json:"channel"`
	PublishedAt *string                `json:"published_at"`
	VideoURL    *string                `json:"video_url"`
	ThumbnailURL *string               `json:"thumbnail_url"`
	Edges       []VideoInfographicEdge `json:"edges"`
}

// VideoDetailData is the response for a single video.
type VideoDetailData struct {
	Video         map[string]interface{}   `json:"video"`
	Summary       map[string]interface{}   `json:"summary"`
	TickerDetails []map[string]interface{} `json:"ticker_details"`
}

// VideosService retrieves and shapes video data.
type VideosService struct {
	repo *repo.VideosRepository
}

// NewVideosService creates a new VideosService.
func NewVideosService(r *repo.VideosRepository) *VideosService {
	return &VideosService{repo: r}
}

// cleanText unescapes HTML entities and trims whitespace.
func cleanText(v interface{}) string {
	if v == nil {
		return ""
	}
	return html.UnescapeString(strings.TrimSpace(fmt.Sprintf("%v", v)))
}

// cleanTextPtr returns a pointer to the cleaned text, or nil if empty.
func cleanTextPtr(v interface{}) *string {
	s := cleanText(v)
	if s == "" {
		return nil
	}
	return &s
}

// edgeSentiment computes the dominant sentiment from a summary object.
func edgeSentiment(summary map[string]interface{}) string {
	if summary == nil {
		return "neutral"
	}
	p := sliceLen(summary["positive"])
	n := sliceLen(summary["negative"])
	u := sliceLen(summary["neutral"])
	if p > n && p > u {
		return "positive"
	}
	if n > p && n > u {
		return "negative"
	}
	return "neutral"
}

func sliceLen(v interface{}) int {
	if arr, ok := v.([]interface{}); ok {
		return len(arr)
	}
	return 0
}

// summaryKeyPoints extracts up to maxPoints unique key points from a summary object.
func summaryKeyPoints(summary map[string]interface{}, maxPoints int) []string {
	if summary == nil {
		return nil
	}

	var candidates []string

	addItems := func(arr []interface{}) {
		for _, x := range arr {
			if x == nil {
				continue
			}
			s := strings.TrimSpace(fmt.Sprintf("%v", x))
			if s != "" {
				candidates = append(candidates, s)
			}
		}
	}

	if _, hasPosNegNeu := summary["positive"]; hasPosNegNeu {
		addItems(toIfaceSlice(summary["positive"]))
		addItems(toIfaceSlice(summary["negative"]))
		addItems(toIfaceSlice(summary["neutral"]))
	} else {
		addItems(toIfaceSlice(summary["bull_case"]))
		addItems(toIfaceSlice(summary["bear_case"]))
		addItems(toIfaceSlice(summary["risks"]))
	}

	seen := map[string]bool{}
	var out []string
	for _, s := range candidates {
		if seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
		if len(out) >= maxPoints {
			break
		}
	}
	return out
}

func toIfaceSlice(v interface{}) []interface{} {
	if arr, ok := v.([]interface{}); ok {
		return arr
	}
	return nil
}

// ListVideos returns shaped video list items.
func (s *VideosService) ListVideos(date *time.Time, days *int, limit int) ([]VideoListItem, error) {
	var startISO, endISO string

	if date != nil && days == nil {
		start, end := timeutil.MarketDayBounds(*date)
		startISO, endISO = start, end
	} else if days != nil {
		endD := timeutil.MarketToday()
		if date != nil {
			endD = *date
		}
		startD := timeutil.DateAdd(endD, -((*days) - 1))
		start, _ := timeutil.MarketDayBounds(startD)
		_, end := timeutil.MarketDayBounds(endD)
		startISO, endISO = start, end
	}

	rows, err := s.repo.FetchVideoListRows(startISO, endISO, limit)
	if err != nil {
		return nil, fmt.Errorf("list videos: %w", err)
	}

	var out []VideoListItem
	for _, row := range rows {
		videoID, _ := row["video_id"].(string)
		if videoID == "" {
			continue
		}

		id := videoID

		title := cleanText(row["title"])
		channel := cleanText(row["channel"])

		vs := firstMap(row["video_summaries"])
		var overallExplanation, sentiment *string
		if vs != nil {
			overallExplanation = strPtrFrom(vs, "overall_explanation")
			sentiment = strPtrFrom(vs, "sentiment")
		}

		item := VideoListItem{
			ID:                 id,
			VideoID:            videoID,
			Title:              ptrStr(title),
			Channel:            ptrStr(channel),
			PublishedAt:        strPtrFrom(row, "published_at"),
			VideoURL:           strPtrFrom(row, "video_url"),
			ThumbnailURL:       strPtrFrom(row, "thumbnail_url"),
			ViewCount:          intPtrFrom(row, "view_count"),
			LikeCount:          intPtrFrom(row, "like_count"),
			CommentCount:       intPtrFrom(row, "comment_count"),
			DurationSeconds:    intPtrFrom(row, "duration_seconds"),
			OverallExplanation: overallExplanation,
			Sentiment:          sentiment,
		}
		out = append(out, item)
	}
	return out, nil
}

// VideoInfographic returns the infographic items for the given time window.
func (s *VideosService) VideoInfographic(date *time.Time, days, limit int) ([]VideoInfographicItem, error) {
	excludedTickers := map[string]bool{"MARKET": true}

	endD := timeutil.MarketToday()
	if date != nil {
		endD = *date
	}
	startD := timeutil.DateAdd(endD, -(days - 1))
	start, _ := timeutil.MarketDayBounds(startD)
	_, end := timeutil.MarketDayBounds(endD)

	videos, err := s.repo.FetchVideosBasicWindow(start, end, limit)
	if err != nil {
		return nil, fmt.Errorf("video infographic: %w", err)
	}

	videoList := filterHasVideoID(videos)
	if len(videoList) == 0 {
		return nil, nil
	}

	videoIDs := make([]string, 0, len(videoList))
	for _, v := range videoList {
		videoIDs = append(videoIDs, fmt.Sprintf("%v", v["video_id"]))
	}

	summaryRows, err := s.repo.FetchSummariesForVideoIDs(videoIDs, 5000)
	if err != nil {
		return nil, fmt.Errorf("video infographic: fetch summaries: %w", err)
	}

	// acc[videoID][symbol] = {positive, negative, neutral, key_points}
	type bucketT struct {
		positive  int
		negative  int
		neutral   int
		keyPoints []string
		kpSeen    map[string]bool
	}
	acc := map[string]map[string]*bucketT{}
	for _, id := range videoIDs {
		acc[id] = map[string]*bucketT{}
	}

	for _, row := range summaryRows {
		vidID, _ := row["video_id"].(string)
		ticker, _ := row["ticker"].(string)
		if vidID == "" || ticker == "" {
			continue
		}
		sym := strings.ToUpper(strings.TrimSpace(ticker))
		if sym == "" {
			continue
		}

		summary, _ := row["summary"].(map[string]interface{})
		kp := summaryKeyPoints(summary, 10)
		sent := edgeSentiment(summary)

		if acc[vidID] == nil {
			acc[vidID] = map[string]*bucketT{}
		}
		if acc[vidID][sym] == nil {
			acc[vidID][sym] = &bucketT{kpSeen: map[string]bool{}}
		}
		b := acc[vidID][sym]

		w := len(kp)
		if w < 1 {
			w = 1
		}
		switch sent {
		case "positive":
			b.positive += w
		case "negative":
			b.negative += w
		case "neutral":
			b.neutral += w
		}
		for _, kpItem := range kp {
			if len(b.keyPoints) >= 10 {
				break
			}
			if b.kpSeen[kpItem] {
				continue
			}
			b.kpSeen[kpItem] = true
			b.keyPoints = append(b.keyPoints, kpItem)
		}
	}

	var out []VideoInfographicItem
	for _, v := range videoList {
		vid := fmt.Sprintf("%v", v["video_id"])
		perTicker := acc[vid]

		var edgesNonMarket, edgesMarket []VideoInfographicEdge
		for sym, b := range perTicker {
			scores := map[string]int{"positive": b.positive, "negative": b.negative, "neutral": b.neutral}
			maxScore := 0
			for _, sc := range scores {
				if sc > maxScore {
					maxScore = sc
				}
			}
			tops := []string{}
			for k, sc := range scores {
				if sc == maxScore {
					tops = append(tops, k)
				}
			}
			sentiment := "neutral"
			if len(tops) == 1 {
				sentiment = tops[0]
			}
			edge := VideoInfographicEdge{
				Ticker:    sym,
				Sentiment: sentiment,
				KeyPoints: b.keyPoints,
			}
			if excludedTickers[sym] {
				edgesMarket = append(edgesMarket, edge)
			} else {
				edgesNonMarket = append(edgesNonMarket, edge)
			}
		}

		edges := edgesNonMarket
		if len(edges) == 0 {
			edges = edgesMarket
		}
		if len(edges) == 0 {
			continue
		}

		pa := strPtrFrom(v, "published_at")
		item := VideoInfographicItem{
			ID:           vid,
			VideoID:      vid,
			Title:        cleanText(v["title"]),
			Channel:      cleanText(v["channel"]),
			PublishedAt:  pa,
			VideoURL:     strPtrFrom(v, "video_url"),
			ThumbnailURL: strPtrFrom(v, "thumbnail_url"),
			Edges:        edges,
		}
		out = append(out, item)
	}
	return out, nil
}

// GetVideoDetail returns the full detail for a single video.
func (s *VideosService) GetVideoDetail(videoID string) (*VideoDetailData, error) {
	video, err := s.repo.FetchVideoRow(videoID)
	if err != nil || video == nil {
		return nil, err
	}

	// Normalize video row
	if v, ok := video["title"].(string); ok {
		video["title"] = cleanText(v)
	}
	if v, ok := video["channel"].(string); ok {
		video["channel"] = cleanText(v)
	}
	if _, ok := video["id"]; !ok {
		video["id"] = video["video_id"]
	}

	vsObj, _ := s.repo.FetchVideoSummaryRow(videoID)
	if vsObj == nil {
		vsObj = map[string]interface{}{}
	}

	// Collect tickers
	tRows, _ := s.repo.FetchVideoTickerRows(videoID, 500)
	var tickers []string
	tickerSeen := map[string]bool{}
	marketSeen := false
	for _, r := range tRows {
		t, _ := r["ticker"].(string)
		sym := strings.ToUpper(strings.TrimSpace(t))
		if sym == "" || tickerSeen[sym] {
			continue
		}
		tickerSeen[sym] = true
		if sym == "MARKET" {
			marketSeen = true
			continue
		}
		tickers = append(tickers, sym)
	}
	if len(tickers) == 0 && marketSeen {
		tickers = []string{"MARKET"}
	}

	// Summarised_at fallback
	summarizedAt, _ := vsObj["summarized_at"].(string)
	if summarizedAt == "" {
		summarizedAt = time.Now().UTC().Format(time.RFC3339)
	}

	// Clean video_titles
	var videoTitles interface{}
	if vt, ok := vsObj["video_titles"].([]interface{}); ok {
		cleaned := make([]string, 0, len(vt))
		for _, x := range vt {
			s := cleanText(x)
			if s != "" {
				cleaned = append(cleaned, s)
			}
		}
		videoTitles = cleaned
	} else {
		videoTitles = vsObj["video_titles"]
	}

	pa := vsObj["published_at"]
	if pa == nil {
		pa = video["published_at"]
	}

	model, _ := vsObj["model"].(string)

	summary := map[string]interface{}{
		"id":                  fmt.Sprintf("%s:overall", videoID),
		"summary_markdown":    vsObj["summary_markdown"],
		"overall_explanation": strOrEmpty(vsObj["overall_explanation"]),
		"movers":              sliceOrEmpty(vsObj["movers"]),
		"risks":               sliceOrEmpty(vsObj["risks"]),
		"opportunities":       sliceOrEmpty(vsObj["opportunities"]),
		"key_points":          sliceOrEmpty(vsObj["key_points"]),
		"tickers":             tickers,
		"sentiment":           vsObj["sentiment"],
		"events":              sliceOrEmpty(vsObj["events"]),
		"model":               model,
		"summarized_at":       summarizedAt,
		"video_titles":        videoTitles,
		"published_at":        pa,
	}

	// Per-ticker details
	perRows, _ := s.repo.FetchLatestPerTickerSummaryRows(videoID, 500)
	latestByTicker := map[string]map[string]interface{}{}
	for _, r := range perRows {
		t, _ := r["ticker"].(string)
		sym := strings.ToUpper(strings.TrimSpace(t))
		if sym == "" {
			continue
		}
		summaryObj, _ := r["summary"].(map[string]interface{})
		if summaryObj == nil {
			continue
		}
		if _, exists := latestByTicker[sym]; !exists {
			latestByTicker[sym] = r
		}
	}

	var tickerDetails []map[string]interface{}
	for sym, r := range latestByTicker {
		summaryObj, _ := r["summary"].(map[string]interface{})
		tickerDetails = append(tickerDetails, map[string]interface{}{
			"ticker":     sym,
			"summary":    summaryObj,
			"sentiment":  edgeSentiment(summaryObj),
			"key_points": summaryKeyPoints(summaryObj, 12),
		})
	}
	// Sort ticker details by symbol for deterministic output
	sortTickerDetails(tickerDetails)

	return &VideoDetailData{
		Video:         video,
		Summary:       summary,
		TickerDetails: tickerDetails,
	}, nil
}

// ─── helpers ───────────────────────────────────────────────────────────────

func filterHasVideoID(rows []map[string]interface{}) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(rows))
	for _, r := range rows {
		if vid, _ := r["video_id"].(string); vid != "" {
			out = append(out, r)
		}
	}
	return out
}

func firstMap(v interface{}) map[string]interface{} {
	switch t := v.(type) {
	case map[string]interface{}:
		return t
	case []interface{}:
		if len(t) > 0 {
			if m, ok := t[0].(map[string]interface{}); ok {
				return m
			}
		}
	}
	return nil
}

func strPtrFrom(m map[string]interface{}, key string) *string {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	s := fmt.Sprintf("%v", v)
	if s == "" || s == "<nil>" {
		return nil
	}
	return &s
}

func intPtrFrom(m map[string]interface{}, key string) *int {
	v, ok := m[key]
	if !ok || v == nil {
		return nil
	}
	switch t := v.(type) {
	case float64:
		n := int(t)
		return &n
	case int:
		return &t
	case int64:
		n := int(t)
		return &n
	}
	return nil
}

func ptrStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func strOrEmpty(v interface{}) string {
	if v == nil {
		return ""
	}
	return fmt.Sprintf("%v", v)
}

func sliceOrEmpty(v interface{}) []interface{} {
	if arr, ok := v.([]interface{}); ok {
		return arr
	}
	return []interface{}{}
}

func sortTickerDetails(details []map[string]interface{}) {
	// Simple insertion sort by ticker symbol
	for i := 1; i < len(details); i++ {
		key := details[i]
		sym, _ := key["ticker"].(string)
		j := i - 1
		for j >= 0 {
			prevSym, _ := details[j]["ticker"].(string)
			if prevSym <= sym {
				break
			}
			details[j+1] = details[j]
			j--
		}
		details[j+1] = key
	}
}
