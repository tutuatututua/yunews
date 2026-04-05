package svc

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/sashabaranov/go-openai"
)

const plannerSystemPrompt = `You are a financial news assistant that helps users search for information.
Given a user question and conversation history, produce a JSON object with:
- "rewritten_prompt": rewrite the question to be self-contained and clear (preserve the user's exact intent)
- "tickers": a list of stock ticker symbols mentioned or implied (uppercase, no $ prefix, max 3), or empty list
- "is_stock_related": true if the question is about stocks, markets, companies, or financial topics

Return ONLY valid JSON with these three fields.`

// QueryPlan represents structured intent extracted from a user question.
type QueryPlan struct {
	RewrittenPrompt string   `json:"rewritten_prompt"`
	Tickers         []string `json:"tickers"`
	IsStockRelated  bool     `json:"is_stock_related"`
}

// QueryPlannerService plans queries using an LLM.
type QueryPlannerService struct {
	client *openai.Client
	model  string
}

// NewQueryPlannerService creates a QueryPlannerService.
func NewQueryPlannerService(apiKey, model string) *QueryPlannerService {
	return &QueryPlannerService{
		client: openai.NewClient(apiKey),
		model:  model,
	}
}

// PlanQuery analyses the user question and conversation history and returns a QueryPlan.
func (s *QueryPlannerService) PlanQuery(question string, history []openai.ChatCompletionMessage) (*QueryPlan, error) {
	msgs := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: plannerSystemPrompt},
	}
	// Append recent history (last 6 messages max).
	if len(history) > 6 {
		history = history[len(history)-6:]
	}
	msgs = append(msgs, history...)
	msgs = append(msgs, openai.ChatCompletionMessage{
		Role:    openai.ChatMessageRoleUser,
		Content: question,
	})

	resp, err := s.client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model:          s.model,
		Messages:       msgs,
		ResponseFormat: &openai.ChatCompletionResponseFormat{Type: openai.ChatCompletionResponseFormatTypeJSONObject},
		MaxTokens:      256,
		Temperature:    0,
	})
	if err != nil {
		return nil, fmt.Errorf("query planner: %w", err)
	}
	if len(resp.Choices) == 0 || resp.Choices[0].Message.Content == "" {
		return nil, fmt.Errorf("query planner: empty response from model")
	}

	var plan QueryPlan
	if err := json.Unmarshal([]byte(resp.Choices[0].Message.Content), &plan); err != nil {
		return nil, fmt.Errorf("query planner: invalid JSON: %w", err)
	}

	// Normalize tickers.
	plan.Tickers = normalizeTickers(plan.Tickers)
	if plan.RewrittenPrompt == "" {
		plan.RewrittenPrompt = question
	}

	return &plan, nil
}

func normalizeTickers(tickers []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(tickers))
	for _, t := range tickers {
		t = strings.TrimPrefix(strings.TrimSpace(strings.ToUpper(t)), "$")
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
		if len(out) >= 3 {
			break
		}
	}
	return out
}
