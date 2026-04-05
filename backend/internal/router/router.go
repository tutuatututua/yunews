package router

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"yunews/backend/internal/config"
	"yunews/backend/internal/handler"
	"yunews/backend/internal/middleware"
	"yunews/backend/internal/repo"
	"yunews/backend/internal/svc"
	"yunews/backend/internal/supabase"
	"yunews/backend/internal/tokenquota"
)

// New builds and returns the chi.Router with all routes wired up.
func New(cfg *config.Config) http.Handler {
	db := supabase.NewClient(cfg.SupabaseURL, cfg.SupabaseServiceRoleKey)

	// Repositories.
	logsRepo := repo.NewLogsRepository(db)
	feedbackRepo := repo.NewFeedbackRepository(db)
	dailySumRepo := repo.NewDailySummariesRepository(db)
	videosRepo := repo.NewVideosRepository(db)
	entitiesRepo := repo.NewEntitiesRepository(db)
	recsRepo := repo.NewRecommendationsRepository(db)
	ragRepo := repo.NewRagDocumentsRepository(db)
	marketRepo := repo.NewMarketDataRepository(db)

	// Services.
	marketSvc := svc.NewMarketDataService(marketRepo)
	dailySumSvc := svc.NewDailySummariesService(dailySumRepo)
	videosSvc := svc.NewVideosService(videosRepo)
	entitiesSvc := svc.NewEntitiesService(entitiesRepo)
	recsSvc := svc.NewRecommendationsService(recsRepo, marketSvc)

	embedder := svc.NewEmbeddingService(cfg.OpenAIAPIKey, cfg.OpenAIEmbeddingModel)
	ragSvc := svc.NewRagRetrievalService(ragRepo, embedder)

	var planner *svc.QueryPlannerService
	if cfg.OpenAIAPIKey != "" && cfg.OpenAIQueryPlannerModel != "" {
		planner = svc.NewQueryPlannerService(cfg.OpenAIAPIKey, cfg.OpenAIQueryPlannerModel)
	}

	quota := tokenquota.NewQuota(cfg.ChatTokensPerIPPerWindow, cfg.ChatTokenWindowSeconds)

	chatSvc := svc.NewChatService(
		cfg.OpenAIAPIKey, cfg.OpenAIChatModel,
		planner, quota, ragSvc,
		logsRepo, cfg.LogChatHistory,
	)

	// Handlers.
	trackH := handler.NewTrackHandler(logsRepo, cfg)
	feedbackH := handler.NewFeedbackHandler(feedbackRepo)
	chatH := handler.NewChatHandler(chatSvc)
	dailySumH := handler.NewDailySummariesHandler(dailySumSvc)
	videosH := handler.NewVideosHandler(videosSvc)
	entitiesH := handler.NewEntitiesHandler(entitiesSvc)
	recsH := handler.NewRecommendationsHandler(recsSvc)

	// CORS origins.
	allowedOrigins := []string{"*"}
	if len(cfg.CORSAllowOrigins) > 0 {
		allowedOrigins = cfg.CORSAllowOrigins
	}

	methods := []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"}
	if len(cfg.CORSAllowMethods) > 0 {
		methods = cfg.CORSAllowMethods
	}

	headers := []string{"Accept", "Authorization", "Content-Type", "X-Api-Key", "X-Request-Id"}
	if len(cfg.CORSAllowHeaders) > 0 {
		headers = cfg.CORSAllowHeaders
	}

	r := chi.NewRouter()

	// Global middleware.
	r.Use(chimiddleware.Recoverer)
	r.Use(middleware.RequestIDMiddleware)
	r.Use(middleware.SecurityHeadersMiddleware)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   methods,
		AllowedHeaders:   headers,
		AllowCredentials: false,
		MaxAge:           300,
	}))
	r.Use(middleware.RequestLoggingMiddleware)

	// Public routes.
	r.Get("/health", handler.HealthHandler)
	r.Post("/track", trackH.Track)
	r.Post("/api/track", trackH.Track)
	r.Post("/feedback", feedbackH.SubmitFeedback)
	r.Post("/api/feedback", feedbackH.SubmitFeedback)
	r.Get("/feedback-survey/status", feedbackH.SurveyStatus)
	r.Get("/api/feedback-survey/status", feedbackH.SurveyStatus)
	r.Post("/feedback-survey", feedbackH.SubmitSurvey)
	r.Post("/api/feedback-survey", feedbackH.SubmitSurvey)

	// Protected routes.
	authMiddleware := middleware.APIKeyAuth(cfg.APIKey)

	r.Group(func(rg chi.Router) {
		rg.Use(authMiddleware)

		rg.Post("/chat", chatH.ServeHTTP)
		rg.Post("/api/chat", chatH.ServeHTTP)

		rg.Get("/daily-summaries/latest", dailySumH.Latest)
		rg.Get("/daily-summaries/{market_date}", dailySumH.ByDate)
		rg.Get("/daily-summaries", dailySumH.List)
		rg.Get("/api/daily-summaries/latest", dailySumH.Latest)
		rg.Get("/api/daily-summaries/{market_date}", dailySumH.ByDate)
		rg.Get("/api/daily-summaries", dailySumH.List)

		rg.Get("/videos/infographic", videosH.Infographic)
		rg.Get("/videos/{video_id}", videosH.Detail)
		rg.Get("/videos", videosH.List)
		rg.Get("/api/videos/infographic", videosH.Infographic)
		rg.Get("/api/videos/{video_id}", videosH.Detail)
		rg.Get("/api/videos", videosH.List)

		rg.Get("/entities/top-movers", entitiesH.TopMovers)
		rg.Get("/entities/{symbol}/chunks", entitiesH.Chunks)
		rg.Get("/api/entities/top-movers", entitiesH.TopMovers)
		rg.Get("/api/entities/{symbol}/chunks", entitiesH.Chunks)

		rg.Get("/recommendations/overlay", recsH.Overlay)
		rg.Get("/recommendations", recsH.List)
		rg.Get("/api/recommendations/overlay", recsH.Overlay)
		rg.Get("/api/recommendations", recsH.List)
	})

	return r
}
