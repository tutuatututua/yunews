package svc

import (
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"yunews/backend/internal/repo"
)

// RetrievedChunk is a single RAG document chunk with metadata.
type RetrievedChunk struct {
	ID              int     `json:"id"`
	DocumentType    string  `json:"document_type"`
	Ticker          *string `json:"ticker,omitempty"`
	VideoTitle      *string `json:"video_title,omitempty"`
	ThumbnailURL    *string `json:"thumbnail_url,omitempty"`
	SummaryText     string  `json:"summary_text"`
	Similarity      float64 `json:"similarity"`
	RetrievalMethod string  `json:"retrieval_method"`
}

// RagRetrievalService performs multi-stage vector search.
type RagRetrievalService struct {
	repo    *repo.RagDocumentsRepository
	embedder EmbeddingService
}

// NewRagRetrievalService creates a RagRetrievalService.
func NewRagRetrievalService(r *repo.RagDocumentsRepository, e EmbeddingService) *RagRetrievalService {
	return &RagRetrievalService{repo: r, embedder: e}
}

// RetrieveChunks returns top-k relevant chunks for the question using multi-stage search.
func (s *RagRetrievalService) RetrieveChunks(question string, topK int, minSimilarity float64, plan *QueryPlan) ([]RetrievedChunk, error) {
	if topK <= 0 {
		return nil, nil
	}

	searchText := question
	if plan != nil && plan.RewrittenPrompt != "" {
		searchText = plan.RewrittenPrompt
	}

	embedding, err := s.embedder.Embed(searchText)
	if err != nil {
		return nil, fmt.Errorf("embedding: %w", err)
	}
	if len(embedding) == 0 {
		slog.Warn("retrieval skipped: empty embedding")
		return nil, nil
	}

	tickers := []string{}
	if plan != nil {
		tickers = plan.Tickers
	}

	bestByID := map[int]*RetrievedChunk{}
	oversample := topK * 3
	if oversample < 12 {
		oversample = 12
	}

	runStage := func(stage, docType string, ticker *string, matchCount int) {
		method := stage
		if docType != "" {
			method += "|type=" + docType
		} else {
			method += "|type=*"
		}
		if ticker != nil {
			method += "|ticker=" + *ticker
		} else {
			method += "|ticker=*"
		}

		rows, err2 := s.repo.MatchRagDocuments(embedding, matchCount, ticker, strPtrOrNil(docType))
		if err2 != nil {
			slog.Warn("retrieval stage failed", "stage", stage, "error", err2)
			return
		}
		for _, r := range rows {
			rawID, _ := r["id"]
			if rawID == nil {
				continue
			}
			chunkID := 0
			switch v := rawID.(type) {
			case float64:
				chunkID = int(v)
			case int:
				chunkID = v
			default:
				continue
			}

			sim := 0.0
			if sv, ok := r["similarity"]; ok && sv != nil {
				if sf, ok2 := sv.(float64); ok2 {
					sim = sf
				}
			}
			if sim < minSimilarity {
				continue
			}

			docTypeStr := ""
			if v, ok := r["document_type"]; ok && v != nil {
				docTypeStr, _ = v.(string)
			}

			summaryText := ""
			if v, ok := r["summary_text"]; ok && v != nil {
				summaryText, _ = v.(string)
			}

			var tickerStr *string
			if v, ok := r["ticker"]; ok && v != nil {
				if s2, ok2 := v.(string); ok2 && s2 != "" {
					ts := strings.TrimSpace(strings.ToUpper(s2))
					tickerStr = &ts
				}
			}

			var videoTitle *string
			if v, ok := r["video_title"]; ok && v != nil {
				if s2, ok2 := v.(string); ok2 && s2 != "" {
					videoTitle = &s2
				}
			}

			var thumbnailURL *string
			if v, ok := r["thumbnail_url"]; ok && v != nil {
				if s2, ok2 := v.(string); ok2 && s2 != "" {
					thumbnailURL = &s2
				}
			}

			chunk := &RetrievedChunk{
				ID:              chunkID,
				DocumentType:    docTypeStr,
				Ticker:          tickerStr,
				VideoTitle:      videoTitle,
				ThumbnailURL:    thumbnailURL,
				SummaryText:     summaryText,
				Similarity:      sim,
				RetrievalMethod: method,
			}

			prev, exists := bestByID[chunkID]
			if !exists || chunk.Similarity > prev.Similarity {
				bestByID[chunkID] = chunk
			}
		}
	}

	if len(tickers) > 0 {
		perTicker := oversample / len(tickers)
		if perTicker < 5 {
			perTicker = 5
		}
		for _, t := range tickers {
			tc := t
			runStage("ticker", "ticker_summary", &tc, perTicker)
		}
		dailyCount := topK / 3
		if dailyCount < 2 {
			dailyCount = 2
		}
		generalCount := topK / 2
		if generalCount < 4 {
			generalCount = 4
		}
		runStage("daily", "daily_summary", nil, dailyCount)
		runStage("general", "video_summary", nil, generalCount)
	} else {
		dailyCount := topK / 3
		if dailyCount < 2 {
			dailyCount = 2
		}
		generalCount := topK
		if generalCount < 6 {
			generalCount = 6
		}
		runStage("daily", "daily_summary", nil, dailyCount)
		runStage("general", "video_summary", nil, generalCount)
	}

	if len(bestByID) < topK {
		runStage("unfiltered", "", nil, oversample)
	}

	all := make([]RetrievedChunk, 0, len(bestByID))
	for _, c := range bestByID {
		all = append(all, *c)
	}
	sort.Slice(all, func(i, j int) bool {
		return all[i].Similarity > all[j].Similarity
	})
	if len(all) > topK {
		all = all[:topK]
	}
	return all, nil
}

func strPtrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
