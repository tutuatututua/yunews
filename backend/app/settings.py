from __future__ import annotations

from functools import lru_cache
import json
from typing import Annotated

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    # Load from env (prod/docker) and optional .env (dev).
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    supabase_url: str = Field(validation_alias=AliasChoices("SUPABASE_URL"))

    # Optional API key auth.
    api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("API_KEY"),
    )

    # Service role key (bypasses RLS); server-side only.
    supabase_service_role_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "SUPABASE_SERVICE_ROLE_KEY",
        ),
    )

    log_level: str = Field(default="INFO", validation_alias=AliasChoices("LOG_LEVEL"))

    backend_port: int = Field(default=8080, validation_alias=AliasChoices("BACKEND_PORT"))

    # Chatbot (RAG)
    openai_api_key: str | None = Field(default=None, validation_alias=AliasChoices("OPENAI_API_KEY"))
    openai_chat_model: str = Field(
        default="gpt-4.1-mini",
        validation_alias=AliasChoices("OPENAI_CHAT_MODEL"),
    )

    # Best-effort per-process token quota per client IP (0 disables).
    chat_tokens_per_ip_per_window: int = Field(
        default=0,
        validation_alias=AliasChoices(
            "CHAT_TOKENS_PER_IP_PER_WINDOW",
        ),
    )
    # Default: 24 hours.
    chat_token_window_seconds: int = Field(
        default=60 * 60 * 24,
        validation_alias=AliasChoices(
            "CHAT_TOKEN_WINDOW_SECONDS",
        ),
    )

    # Query planner model (used only for retrieval).
    openai_query_planner_model: str = Field(
        default="gpt-4.1-mini",
        validation_alias=AliasChoices("OPENAI_QUERY_PLANNER_MODEL"),
    )

    # Embeddings model for RAG retrieval.
    openai_embedding_model: str = Field(
        default="text-embedding-3-small",
        validation_alias=AliasChoices("OPENAI_EMBEDDING_MODEL"),
    )

    @model_validator(mode="after")
    def _validate_supabase_keys(self):
        if self.supabase_service_role_key:
            return self
        raise ValueError(
            "Missing Supabase credentials: set SUPABASE_SERVICE_ROLE_KEY"
        )

    # CORS (JSON array preferred; also supports CSV).
    cors_allow_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        validation_alias=AliasChoices("CORS_ALLOW_ORIGINS"),
    )
    cors_allow_methods: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["GET", "POST", "OPTIONS"],
        validation_alias=AliasChoices("CORS_ALLOW_METHODS"),
    )
    cors_allow_headers: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["*"],
        validation_alias=AliasChoices("CORS_ALLOW_HEADERS"),
    )

    @field_validator("cors_allow_origins", "cors_allow_methods", "cors_allow_headers", mode="before")
    @classmethod
    def _parse_list_setting(cls, v):
        if v is None:
            return []

        if isinstance(v, (list, tuple, set)):
            return [s for s in (str(x).strip() for x in v) if s]

        if isinstance(v, str):
            raw = v.strip()
            if not raw:
                return []

            # Prefer JSON arrays (e.g. '["https://a","https://b"]'), common in Vercel env vars.
            if raw[:1] in ("[", "{"):
                try:
                    loaded = json.loads(raw)
                except json.JSONDecodeError:
                    loaded = None

                if isinstance(loaded, list):
                    return [s for s in (str(x).strip() for x in loaded) if s]

            # Fallback: comma-separated values.
            return [s for s in (part.strip() for part in raw.split(",")) if s]

        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    # BaseSettings loads required fields from environment/.env at runtime.
    return Settings()  # type: ignore[call-arg]
