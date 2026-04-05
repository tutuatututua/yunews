package svc

import (
	"context"
	"fmt"
	"sync"

	"github.com/sashabaranov/go-openai"
	"yunews/backend/internal/apperr"
)

// EmbeddingService produces text embeddings.
type EmbeddingService interface {
	Embed(text string) ([]float32, error)
}

// OpenAIEmbeddingService uses the OpenAI embeddings API.
type OpenAIEmbeddingService struct {
	client *openai.Client
	model  openai.EmbeddingModel
	mu     sync.Mutex
}

// NewOpenAIEmbeddingService creates an OpenAI-backed EmbeddingService.
func NewOpenAIEmbeddingService(apiKey, model string) *OpenAIEmbeddingService {
	return &OpenAIEmbeddingService{
		client: openai.NewClient(apiKey),
		model:  openai.EmbeddingModel(model),
	}
}

// Embed returns the embedding vector for text.
func (s *OpenAIEmbeddingService) Embed(text string) ([]float32, error) {
	if text == "" {
		return nil, nil
	}
	resp, err := s.client.CreateEmbeddings(context.Background(), openai.EmbeddingRequest{
		Input: []string{text},
		Model: s.model,
	})
	if err != nil {
		return nil, fmt.Errorf("openai embeddings: %w", err)
	}
	if len(resp.Data) == 0 || len(resp.Data[0].Embedding) == 0 {
		return nil, fmt.Errorf("openai embeddings: empty response")
	}
	return resp.Data[0].Embedding, nil
}

// DisabledEmbeddingService always returns an error.
type DisabledEmbeddingService struct {
	reason string
}

// NewDisabledEmbeddingService creates a disabled embedding service.
func NewDisabledEmbeddingService(reason string) *DisabledEmbeddingService {
	return &DisabledEmbeddingService{reason: reason}
}

// Embed always returns an upstream error.
func (s *DisabledEmbeddingService) Embed(_ string) ([]float32, error) {
	return nil, apperr.Upstream("Embedding service unavailable", map[string]string{"reason": s.reason})
}

// NewEmbeddingService creates the appropriate EmbeddingService based on configuration.
func NewEmbeddingService(apiKey, model string) EmbeddingService {
	if apiKey == "" {
		return NewDisabledEmbeddingService("Missing OPENAI_API_KEY")
	}
	if model == "" {
		return NewDisabledEmbeddingService("Missing OPENAI_EMBEDDING_MODEL")
	}
	return NewOpenAIEmbeddingService(apiKey, model)
}
