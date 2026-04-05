package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"yunews/backend/internal/config"
	"yunews/backend/internal/router"
)

func main() {
	// Load .env if present (non-fatal if missing in production).
	if err := godotenv.Load(); err != nil {
		slog.Info("no .env file found, using environment variables")
	}

	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	// Configure structured logging level.
	level := slog.LevelInfo
	if cfg.LogLevel == "debug" {
		level = slog.LevelDebug
	} else if cfg.LogLevel == "warn" {
		level = slog.LevelWarn
	} else if cfg.LogLevel == "error" {
		level = slog.LevelError
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})))

	addr := fmt.Sprintf(":%d", cfg.BackendPort)
	slog.Info("starting server", "addr", addr)

	srv := &http.Server{
		Addr:         addr,
		Handler:      router.New(cfg),
		ReadTimeout:  60 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start serving in background.
	serverErrs := make(chan error, 1)
	go func() {
		serverErrs <- srv.ListenAndServe()
	}()

	// Wait for signal or server error.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-quit:
		slog.Info("shutdown signal received", "signal", sig)
	case err := <-serverErrs:
		slog.Error("server error", "error", err)
	}

	// Graceful shutdown with 30s timeout.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("graceful shutdown failed", "error", err)
		os.Exit(1)
	}
	slog.Info("server stopped")
}
