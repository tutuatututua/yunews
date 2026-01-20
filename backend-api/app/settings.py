from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Load from env vars in production/docker, but also support local dev via .env.
    # Order matters: prefer backend-api/.env, then workspace-root/.env.
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    # Keep secrets/config out of source control: prefer env vars or docker-compose env.
    supabase_url: str = Field(validation_alias=AliasChoices("SUPABASE_URL", "supabase_url"))

    # For the backend API, prefer the ANON key + RLS policies.
    # The SERVICE ROLE key bypasses RLS and should only be used server-side when necessary.
    supabase_key: str = Field(
        validation_alias=AliasChoices(
            "SUPABASE_ANON_KEY",
            "SUPABASE_KEY",
            "supabase_key",
        )
    )

    environment: Literal["development", "production", "test"] = Field(
        default="development",
        validation_alias=AliasChoices("ENV", "ENVIRONMENT", "environment"),
    )

    log_level: str = Field(default="INFO", validation_alias=AliasChoices("LOG_LEVEL", "log_level"))

    # CORS: set explicitly in production. Accepts either JSON array (preferred) or comma-separated string.
    cors_allow_origins: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("CORS_ALLOW_ORIGINS", "cors_allow_origins"),
    )
    cors_allow_methods: list[str] = Field(
        default_factory=lambda: ["GET", "OPTIONS"],
        validation_alias=AliasChoices("CORS_ALLOW_METHODS", "cors_allow_methods"),
    )
    cors_allow_headers: list[str] = Field(
        default_factory=lambda: ["*"],
        validation_alias=AliasChoices("CORS_ALLOW_HEADERS", "cors_allow_headers"),
    )

    # Optional hardening; when set, rejects requests with unknown Host headers.
    trusted_hosts: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("TRUSTED_HOSTS", "trusted_hosts"),
    )

    backend_port: int = Field(default=8080, validation_alias=AliasChoices("PORT", "BACKEND_PORT", "backend_port"))

    @field_validator("cors_allow_origins", "cors_allow_methods", "cors_allow_headers", "trusted_hosts", mode="before")
    @classmethod
    def _split_csv_or_passthrough(cls, v):
        if v is None:
            return []
        if isinstance(v, str):
            raw = v.strip()
            if not raw:
                return []
            # If user passed JSON-ish, let pydantic handle it elsewhere.
            if raw.startswith("[") and raw.endswith("]"):
                return v
            return [x.strip() for x in raw.split(",") if x.strip()]
        return v

    @property
    def effective_cors_allow_origins(self) -> list[str]:
        if self.cors_allow_origins:
            return self.cors_allow_origins

        # Dev-friendly defaults only.
        if self.environment != "production":
            return [
                "http://localhost:5173",
                "http://127.0.0.1:5173",
            ]

        # In production, require explicit allowlist.
        return []


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
