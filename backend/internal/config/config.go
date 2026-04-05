package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// Config holds all application settings loaded from environment variables.
type Config struct {
	SupabaseURL             string
	SupabaseServiceRoleKey  string
	APIKey                  string
	LogLevel                string
	BackendPort             int
	OpenAIAPIKey            string
	OpenAIChatModel         string
	OpenAIQueryPlannerModel string
	OpenAIEmbeddingModel    string
	ChatTokensPerIPPerWindow int
	ChatTokenWindowSeconds   int
	LogVisitIPs             bool
	LogChatHistory          bool
	CORSAllowOrigins        []string
	CORSAllowMethods        []string
	CORSAllowHeaders        []string
}

// Load reads configuration from environment variables.
func Load() (*Config, error) {
	supabaseURL := os.Getenv("SUPABASE_URL")
	serviceRoleKey := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")

	if supabaseURL == "" {
		return nil, fmt.Errorf("SUPABASE_URL is required")
	}
	if serviceRoleKey == "" {
		return nil, fmt.Errorf("SUPABASE_SERVICE_ROLE_KEY is required")
	}

	port := 8080
	if p := os.Getenv("PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 {
			port = n
		}
	}
	if p := os.Getenv("BACKEND_PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil && n > 0 {
			port = n
		}
	}

	chatTokensPerIP := 0
	if v := os.Getenv("CHAT_TOKENS_PER_IP_PER_WINDOW"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			chatTokensPerIP = n
		}
	}

	chatTokenWindow := 86400
	if v := os.Getenv("CHAT_TOKEN_WINDOW_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			chatTokenWindow = n
		}
	}

	logVisitIPs := true
	if v := strings.ToLower(os.Getenv("LOG_VISIT_IPS")); v == "false" || v == "0" {
		logVisitIPs = false
	}

	logChatHistory := true
	if v := strings.ToLower(os.Getenv("LOG_CHAT_HISTORY")); v == "false" || v == "0" {
		logChatHistory = false
	}

	corsOrigins := parseList(os.Getenv("CORS_ALLOW_ORIGINS"))

	corsMethods := parseList(os.Getenv("CORS_ALLOW_METHODS"))
	if len(corsMethods) == 0 {
		corsMethods = []string{"GET", "POST", "OPTIONS"}
	}

	corsHeaders := parseList(os.Getenv("CORS_ALLOW_HEADERS"))
	if len(corsHeaders) == 0 {
		corsHeaders = []string{"*"}
	}

	logLevel := strings.ToUpper(os.Getenv("LOG_LEVEL"))
	if logLevel == "" {
		logLevel = "INFO"
	}

	return &Config{
		SupabaseURL:              supabaseURL,
		SupabaseServiceRoleKey:   serviceRoleKey,
		APIKey:                   os.Getenv("API_KEY"),
		LogLevel:                 logLevel,
		BackendPort:              port,
		OpenAIAPIKey:             os.Getenv("OPENAI_API_KEY"),
		OpenAIChatModel:          envDefault("OPENAI_CHAT_MODEL", "gpt-4.1-mini"),
		OpenAIQueryPlannerModel:  envDefault("OPENAI_QUERY_PLANNER_MODEL", "gpt-4.1-mini"),
		OpenAIEmbeddingModel:     envDefault("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"),
		ChatTokensPerIPPerWindow: chatTokensPerIP,
		ChatTokenWindowSeconds:   chatTokenWindow,
		LogVisitIPs:              logVisitIPs,
		LogChatHistory:           logChatHistory,
		CORSAllowOrigins:         corsOrigins,
		CORSAllowMethods:         corsMethods,
		CORSAllowHeaders:         corsHeaders,
	}, nil
}

func envDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func parseList(v string) []string {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	parts := strings.Split(v, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		s := strings.TrimSpace(p)
		if s != "" {
			out = append(out, s)
		}
	}
	return out
}
