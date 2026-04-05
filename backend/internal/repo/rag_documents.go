package repo

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"yunews/backend/internal/supabase"
)

// RagDocumentsRepository handles the match_rag_documents RPC function.
type RagDocumentsRepository struct {
	db *supabase.Client
}

// NewRagDocumentsRepository creates a new RagDocumentsRepository.
func NewRagDocumentsRepository(db *supabase.Client) *RagDocumentsRepository {
	return &RagDocumentsRepository{db: db}
}

// MatchRagDocuments executes the match_rag_documents Supabase RPC to perform vector search.
func (r *RagDocumentsRepository) MatchRagDocuments(
	queryEmbedding []float32,
	matchCount int,
	filterTicker *string,
	filterDocumentType *string,
) ([]map[string]interface{}, error) {
	params := map[string]interface{}{
		"query_embedding":     queryEmbedding,
		"match_count":         matchCount,
		"filter_ticker":       filterTicker,
		"filter_document_type": filterDocumentType,
	}

	data, err := r.db.Rpc("match_rag_documents", params)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "different vector dimensions") || strings.Contains(msg, "vector dimensions") {
			slog.Error("match_rag_documents: embedding dimension mismatch",
				"query_dim", len(queryEmbedding),
				"hint", "Fix by updating the SQL function to filter d.dimension = vector_dims(query_embedding)")
		}
		return nil, fmt.Errorf("match_rag_documents rpc: %w", err)
	}

	var rows []map[string]interface{}
	if err := json.Unmarshal(data, &rows); err != nil {
		return nil, fmt.Errorf("parse match_rag_documents response: %w", err)
	}
	return rows, nil
}
