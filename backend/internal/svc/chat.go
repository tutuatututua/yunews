package svc

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/sashabaranov/go-openai"
	"yunews/backend/internal/repo"
	"yunews/backend/internal/timeutil"
	"yunews/backend/internal/tokenquota"
)

const chatSystemPrompt = `You are yuNews, a stock-video summary assistant.
Answer the user's question using ONLY the retrieved context.
The retrieved context may be incomplete, outdated, or internally inconsistent.

Hard rules (must follow):
- Use ONLY the retrieved context as your source of truth.
- Do NOT add new facts, guess, assume, or fill in missing details.
- If the context does not contain the answer, say exactly: "I don't have that information."
- Cite sources as [#N] where N is the chunk number.
- Every factual claim about companies/events/numbers must have a citation [#N]. If you cannot cite it, do not say it.
- You may use the provided Date context (today's date/time) to interpret relative time words like "today"/"yesterday".
  Do NOT cite the Date context; cite only retrieved chunks as [#N].
- If chunks conflict or seem to describe different things, do NOT reconcile them.
  Instead, describe each version separately with its own citation(s), and explicitly say the sources conflict.
- When certainty is not supported, attribute claims (e.g., "According to [#N] ...") rather than stating them as absolute fact.

Output format (clear and easy to scan, no bullets):
- Write 1-3 short paragraphs. Keep sentences short and direct.
- Put citations at the end of each sentence that contains factual information.
- If the context is ambiguous or conflicting, say so and describe the possible interpretations in separate sentences, each with citations.

Tone: professional, friendly, concise.`

// ChatMessage is a single turn in conversation history.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest is the user's chat payload.
type ChatRequest struct {
	Question string        `json:"question"`
	History  []ChatMessage `json:"history,omitempty"`
}

// ChatService handles streaming chat over SSE.
type ChatService struct {
	openaiAPIKey    string
	chatModel       string
	planner         *QueryPlannerService
	quota           *tokenquota.Quota
	retrieval       *RagRetrievalService
	logs            *repo.LogsRepository
	logChatHistory  bool
}

// NewChatService creates a ChatService.
func NewChatService(
	openaiAPIKey, chatModel string,
	planner *QueryPlannerService,
	quota *tokenquota.Quota,
	retrieval *RagRetrievalService,
	logs *repo.LogsRepository,
	logChatHistory bool,
) *ChatService {
	return &ChatService{
		openaiAPIKey:   strings.TrimSpace(openaiAPIKey),
		chatModel:      strings.TrimSpace(chatModel),
		planner:        planner,
		quota:          quota,
		retrieval:      retrieval,
		logs:           logs,
		logChatHistory: logChatHistory,
	}
}

func sseBytes(obj map[string]interface{}) []byte {
	b, _ := json.Marshal(obj)
	return []byte("data: " + string(b) + "\n\n")
}

func flushWrite(w http.ResponseWriter, f http.Flusher, data []byte) {
	_, _ = w.Write(data)
	f.Flush()
}

// StreamChat writes SSE events to w. Must be called with a ResponseWriter that supports flushing.
func (s *ChatService) StreamChat(req ChatRequest, clientIP, requestID string, w http.ResponseWriter) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	question := strings.TrimSpace(req.Question)
	if question == "" {
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "error", "message": "question is required"}))
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "done"}))
		return
	}

	history := trimHistory(req.History, 10)
	planMsgs := historyToOpenAI(history)

	var plan *QueryPlan
	if s.planner != nil {
		var err error
		plan, err = s.planner.PlanQuery(question, planMsgs)
		if err != nil {
			slog.Warn("query planner failed", "error", err)
		}
	}

	// Non-stock bypass.
	if plan != nil && !plan.IsStockRelated {
		msg := "I can only help with stock/company/market questions. " +
			"(Why you're seeing this: the query planner marked this question as not stock-related.) " +
			"If this is actually about a stock, include an explicit ticker (e.g., AAPL, TSLA)."
		if plan != nil {
			flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "query_plan", "query_plan": planToMap(plan)}))
		}
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "sources", "sources": []interface{}{}}))
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "retrieval", "chunks": []interface{}{}, "context": ""}))
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "delta", "delta": msg}))
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "done"}))

		if s.logs != nil && s.logChatHistory {
			_ = s.logs.InsertChatLog(repo.ChatLogParams{
				IP:          clientIP,
				RequestID:   requestID,
				Question:    question,
				History:     historyToAny(history),
				ResponseText:    &msg,
				Sources:     []interface{}{},
				QueryPlan:   planToMap(plan),
				Model:       s.chatModel,
				Status:      "non_stock",
			})
		}
		return
	}

	// Retrieve chunks.
	chunks, retrievalErr := s.retrieval.RetrieveChunks(question, 5, 0.20, plan)
	var retrievalErrStr string
	if retrievalErr != nil {
		slog.Error("retrieval failed", "error", retrievalErr)
		retrievalErrStr = retrievalErr.Error()
	}

	promptContext := buildContext(chunks)

	if plan != nil {
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "query_plan", "query_plan": planToMap(plan)}))
	}
	flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "sources", "sources": sourcesPayload(chunks)}))
	flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "retrieval", "chunks": retrievalPayload(chunks), "context": clip(promptContext, 40000)}))

	// Retrieval error.
	if retrievalErrStr != "" {
		details := safeRetrievalErrorDetails(retrievalErrStr)
		details["request_id"] = requestID
		flushWrite(w, flusher, sseBytes(map[string]interface{}{
			"type":    "error",
			"message": "Retrieval failed. Update your Supabase schema/RPC.",
			"details": details,
		}))
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "done"}))
		if s.logs != nil && s.logChatHistory {
			_ = s.logs.InsertChatLog(repo.ChatLogParams{
				IP: clientIP, RequestID: requestID, Question: question,
				History: historyToAny(history), Sources: sourcesPayload(chunks),
				QueryPlan: planToMap(plan), Model: s.chatModel, Status: "retrieval_error",
				ErrorMessage: &retrievalErrStr,
			})
		}
		return
	}

	// No chunks.
	if len(chunks) == 0 {
		msg := "I don't have that information.\n\n"
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "delta", "delta": msg}))
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "done"}))
		if s.logs != nil && s.logChatHistory {
			_ = s.logs.InsertChatLog(repo.ChatLogParams{
				IP: clientIP, RequestID: requestID, Question: question,
				History: historyToAny(history), ResponseText: &msg, Sources: sourcesPayload(chunks),
				QueryPlan: planToMap(plan), Model: s.chatModel, Status: "no_info",
			})
		}
		return
	}

	// Missing OpenAI key.
	if s.openaiAPIKey == "" {
		errMsg := "Server is missing OPENAI_API_KEY"
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "error", "message": errMsg}))
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "done"}))
		if s.logs != nil && s.logChatHistory {
			_ = s.logs.InsertChatLog(repo.ChatLogParams{
				IP: clientIP, RequestID: requestID, Question: question,
				History: historyToAny(history), Sources: sourcesPayload(chunks),
				QueryPlan: planToMap(plan), Model: s.chatModel, Status: "missing_openai_key",
			})
		}
		return
	}

	// Build messages.
	dateCtx := fmt.Sprintf("Date context: Today is %s (America/New_York). Current time is %s (UTC).",
		timeutil.MarketToday().Format("2006-01-02"), time.Now().UTC().Format(time.RFC3339))

	messages := []openai.ChatCompletionMessage{
		{Role: openai.ChatMessageRoleSystem, Content: chatSystemPrompt},
		{Role: openai.ChatMessageRoleSystem, Content: dateCtx},
		{Role: openai.ChatMessageRoleSystem, Content: "Retrieved context (use this as the only source of truth):\n\n" + promptContext},
	}
	messages = append(messages, planMsgs...)
	messages = append(messages, openai.ChatCompletionMessage{Role: openai.ChatMessageRoleUser, Content: question})

	// Token quota check.
	if s.quota != nil && s.quota.Enabled() {
		promptText := messagesText(messages)
		promptTokens := tokenquota.EstimateTokens(promptText) + 64
		snap := s.quota.TryConsume(clientIP, promptTokens)
		if snap == nil {
			cur := s.quota.Snapshot(clientIP)
			flushWrite(w, flusher, sseBytes(map[string]interface{}{
				"type":    "error",
				"message": "Chat token quota exceeded",
				"details": map[string]interface{}{
					"ip": clientIP, "limit": cur.Limit, "used": cur.Used, "window_seconds": cur.WindowSeconds,
				},
			}))
			flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "done"}))
			if s.logs != nil && s.logChatHistory {
				_ = s.logs.InsertChatLog(repo.ChatLogParams{
					IP: clientIP, RequestID: requestID, Question: question,
					History: historyToAny(history), Sources: sourcesPayload(chunks),
					QueryPlan: planToMap(plan), Model: s.chatModel, Status: "quota_exceeded_prompt",
				})
			}
			return
		}
	}

	// Stream from OpenAI.
	client := openai.NewClient(s.openaiAPIKey)
	stream, err := client.CreateChatCompletionStream(context.Background(), openai.ChatCompletionRequest{
		Model:       s.chatModel,
		Messages:    messages,
		Temperature: 0.2,
		Stream:      true,
	})

	if err != nil {
		slog.Error("chat stream creation failed", "error", err)
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "error", "message": "Chat model failed", "details": map[string]string{"hint": clip(err.Error(), 200)}}))
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "done"}))
		errStr := err.Error()
		if s.logs != nil && s.logChatHistory {
			_ = s.logs.InsertChatLog(repo.ChatLogParams{
				IP: clientIP, RequestID: requestID, Question: question,
				History: historyToAny(history), Sources: sourcesPayload(chunks),
				QueryPlan: planToMap(plan), Model: s.chatModel, Status: "upstream_error",
				ErrorMessage: &errStr,
			})
		}
		return
	}
	defer stream.Close()

	var responseParts []string
	status := "done"
	var streamErr string

	for {
		resp, err2 := stream.Recv()
		if err2 != nil {
			if err2.Error() == "EOF" {
				break
			}
			streamErr = clip(err2.Error(), 200)
			status = "upstream_error"
			break
		}
		if len(resp.Choices) == 0 {
			continue
		}
		delta := resp.Choices[0].Delta.Content
		if delta == "" {
			continue
		}

		// Per-delta quota check.
		if s.quota != nil && s.quota.Enabled() {
			deltaTokens := tokenquota.EstimateTokens(delta)
			if snap := s.quota.TryConsume(clientIP, deltaTokens); snap == nil {
				status = "quota_exceeded_response"
				cur := s.quota.Snapshot(clientIP)
				flushWrite(w, flusher, sseBytes(map[string]interface{}{
					"type":    "error",
					"message": "Chat token quota exceeded for your IP",
					"details": map[string]interface{}{"ip": clientIP, "limit": cur.Limit, "used": cur.Used, "note": "Response truncated due to quota"},
				}))
				flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "done"}))
				full := strings.Join(responseParts, "")
				if s.logs != nil && s.logChatHistory {
					_ = s.logs.InsertChatLog(repo.ChatLogParams{
						IP: clientIP, RequestID: requestID, Question: question,
						History: historyToAny(history), ResponseText: &full, Sources: sourcesPayload(chunks),
						QueryPlan: planToMap(plan), Model: s.chatModel, Status: status,
					})
				}
				return
			}
		}

		responseParts = append(responseParts, delta)
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "delta", "delta": delta}))
	}

	if streamErr != "" {
		flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "error", "message": "Chat model failed", "details": map[string]string{"hint": streamErr}}))
	}
	flushWrite(w, flusher, sseBytes(map[string]interface{}{"type": "done"}))

	if s.logs != nil && s.logChatHistory {
		full := strings.Join(responseParts, "")
		params := repo.ChatLogParams{
			IP: clientIP, RequestID: requestID, Question: question,
			History: historyToAny(history), ResponseText: &full, Sources: sourcesPayload(chunks),
			QueryPlan: planToMap(plan), Model: s.chatModel, Status: status,
		}
		if streamErr != "" {
			params.ErrorMessage = &streamErr
		}
		_ = s.logs.InsertChatLog(params)
	}
}

// --- helpers ---

func buildContext(chunks []RetrievedChunk) string {
	var sb strings.Builder
	for i, c := range chunks {
		if i > 0 {
			sb.WriteString("\n")
		}
		fmt.Fprintf(&sb, "[#%d]\n%s\n", i+1, strings.TrimSpace(c.SummaryText))
	}
	return strings.TrimSpace(sb.String())
}

func retrievalPayload(chunks []RetrievedChunk) []interface{} {
	out := make([]interface{}, 0, len(chunks))
	for _, c := range chunks {
		text := strings.TrimSpace(c.SummaryText)
		if text == "" {
			continue
		}
		if len(text) > 4000 {
			text = text[:4000]
		}
		out = append(out, map[string]interface{}{
			"document_type":    c.DocumentType,
			"retrieval_method": c.RetrievalMethod,
			"text":             text,
		})
	}
	return out
}

func sourcesPayload(chunks []RetrievedChunk) []interface{} {
	out := make([]interface{}, 0, len(chunks))
	for i, c := range chunks {
		out = append(out, map[string]interface{}{
			"chunk":            i + 1,
			"document_type":    c.DocumentType,
			"ticker":           c.Ticker,
			"video_title":      c.VideoTitle,
			"thumbnail_url":    c.ThumbnailURL,
			"similarity":       c.Similarity,
			"retrieval_method": c.RetrievalMethod,
		})
	}
	return out
}

func safeRetrievalErrorDetails(raw string) map[string]interface{} {
	low := strings.ToLower(raw)
	hint := clip(raw, 300)
	fix := "Verify your Supabase schema and RPC function match_rag_documents are up to date."

	switch {
	case strings.Contains(low, "match_rag_documents") && (strings.Contains(low, "not found") || strings.Contains(low, "does not exist")):
		fix = "Your Supabase RPC function match_rag_documents is missing. Run local-pipeline/app/db/schema.sql on your Supabase project."
	case strings.Contains(low, "column") && strings.Contains(low, "does not exist"):
		fix = "Your Supabase schema/RPC is outdated. Apply the latest SQL migrations in local-pipeline/app/db/migrations/."
	case strings.Contains(low, "permission") && strings.Contains(low, "denied"):
		fix = "Supabase rejected the query due to permissions. Ensure SUPABASE_SERVICE_ROLE_KEY is set correctly."
	case strings.Contains(low, "jwt") || strings.Contains(low, "invalid api key") || strings.Contains(low, "unauthorized"):
		fix = "Supabase credentials look invalid. Double-check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
	case strings.Contains(low, "vector") && strings.Contains(low, "dimension"):
		fix = "Embedding dimension mismatch. Ensure your Supabase match_rag_documents function and embeddings use the same model/dimension."
	}

	return map[string]interface{}{"hint": hint, "fix": fix}
}

func trimHistory(history []ChatMessage, maxMessages int) []ChatMessage {
	out := make([]ChatMessage, 0, len(history))
	for _, m := range history {
		role := strings.TrimSpace(m.Role)
		if role != "user" && role != "assistant" {
			continue
		}
		content := strings.TrimSpace(m.Content)
		if content == "" {
			continue
		}
		if len(content) > 20000 {
			content = content[:20000]
		}
		out = append(out, ChatMessage{Role: role, Content: content})
	}
	if len(out) > maxMessages {
		out = out[len(out)-maxMessages:]
	}
	return out
}

func historyToOpenAI(history []ChatMessage) []openai.ChatCompletionMessage {
	msgs := make([]openai.ChatCompletionMessage, len(history))
	for i, m := range history {
		msgs[i] = openai.ChatCompletionMessage{Role: m.Role, Content: m.Content}
	}
	return msgs
}

func historyToAny(history []ChatMessage) []interface{} {
	out := make([]interface{}, len(history))
	for i, m := range history {
		out[i] = map[string]interface{}{"role": m.Role, "content": m.Content}
	}
	return out
}

func planToMap(plan *QueryPlan) map[string]interface{} {
	if plan == nil {
		return nil
	}
	return map[string]interface{}{
		"rewritten_prompt": plan.RewrittenPrompt,
		"tickers":          plan.Tickers,
		"is_stock_related": plan.IsStockRelated,
	}
}

func messagesText(msgs []openai.ChatCompletionMessage) string {
	var sb strings.Builder
	for _, m := range msgs {
		sb.WriteString(m.Content)
	}
	return sb.String()
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
