from __future__ import annotations

from functools import lru_cache
import json
from typing import Annotated

from pydantic import AliasChoices, Field, computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    # Load from env vars in production/docker, but also support local dev via .env.
    # Order matters: prefer backends/.env, then workspace-root/.env.
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    # Keep secrets/config out of source control: prefer env vars or docker-compose env.
    supabase_url: str = Field(validation_alias=AliasChoices("SUPABASE_URL"))

    # Optional API key auth for public deployments.
    # If set, clients must send `X-API-Key: <key>` or `Authorization: Bearer <key>`.
    api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("API_KEY", "BACKEND_API_KEY"),
    )

    # Supabase keys:
    # - `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS and MUST stay server-side.
    #
    # Backend behavior: require service role key.
    supabase_service_role_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "SUPABASE_SERVICE_ROLE_KEY",
            "SUPABASE_SERVICE_KEY",
        ),
    )


    log_level: str = Field(default="INFO", validation_alias=AliasChoices("LOG_LEVEL"))
    
    # CORS: set explicitly in production. Accepts either JSON array (preferred) or comma-separated string.
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

    # Optional hardening; when set, rejects requests with unknown Host headers.
    trusted_hosts: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        validation_alias=AliasChoices("TRUSTED_HOSTS"),
    )

    # Only enable when the API is served over HTTPS (directly or via a reverse proxy).
    enable_hsts: bool = Field(default=False, validation_alias=AliasChoices("ENABLE_HSTS"))

    backend_port: int = Field(default=8080, validation_alias=AliasChoices("PORT", "BACKEND_PORT"))

    # Chatbot (RAG)
    openai_api_key: str | None = Field(default=None, validation_alias=AliasChoices("OPENAI_API_KEY"))
    openai_chat_model: str = Field(
        default="gpt-4.1-mini",
        validation_alias=AliasChoices("OPENAI_CHAT_MODEL", "OPENAI_MODEL"),
    )

    # Embeddings used for retrieval (RAG)
    embedding_provider: str = Field(
        default="openai",
        validation_alias=AliasChoices("EMBEDDING_PROVIDER"),
    )
    openai_embedding_model: str = Field(
        default="text-embedding-3-small",
        validation_alias=AliasChoices("OPENAI_EMBEDDING_MODEL"),
    )

    # Chat quota (best-effort, per-process) - limits approximate LLM tokens per client IP.
    # Set to 0 to disable.
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

    # Query planner (rewrite/router) used ONLY for retrieval.
    # Backend behavior: enabled whenever OPENAI_API_KEY is set.
    openai_query_planner_model: str = Field(
        default="gpt-4.1-mini",
        validation_alias=AliasChoices("OPENAI_QUERY_PLANNER_MODEL"),
    )

    hf_token: str | None = Field(default=None, validation_alias=AliasChoices("HF_TOKEN", "HUGGINGFACE_TOKEN"))
    hf_embedding_model: str = Field(
        default="Qwen/Qwen3-Embedding-0.6B",
        validation_alias=AliasChoices("HF_EMBEDDING_MODEL", "QWEN_EMBED_MODEL"),
    )
    embedding_device: str = Field(default="auto", validation_alias=AliasChoices("EMBEDDING_DEVICE"))
    embedding_max_length: int = Field(
        default=1024,
        validation_alias=AliasChoices("EMBEDDING_MAX_LENGTH", "QWEN_EMBED_MAX_TOKENS"),
    )

    @model_validator(mode="after")
    def _validate_supabase_keys(self) -> "Settings":
        if self.supabase_service_role_key:
            return self
        raise ValueError(
            "Missing Supabase credentials: set SUPABASE_SERVICE_ROLE_KEY"
        )

    @computed_field
    @property
    def supabase_key(self) -> str:
        if not self.supabase_service_role_key:
            raise ValueError("Missing Supabase credentials: set SUPABASE_SERVICE_ROLE_KEY")
        return self.supabase_service_role_key

    @field_validator("cors_allow_origins", "cors_allow_methods", "cors_allow_headers", "trusted_hosts", mode="before")
    @classmethod
    def _split_csv_or_passthrough(cls, v):
        if v is None:
            return []
        if isinstance(v, (list, tuple, set)):
            return [str(x).strip() for x in v if str(x).strip()]
        if isinstance(v, str):
            raw = v.strip()
            if not raw:
                return []
            # Accept JSON arrays (preferred) like: ["https://example.com", "https://www.example.com"]
            if raw.startswith("[") and raw.endswith("]"):
                try:
                    parsed = json.loads(raw)
                except Exception:
                    raise ValueError(
                        "Invalid JSON array for setting; expected e.g. ['https://example.com']"
                    )

                if isinstance(parsed, list):
                    return [str(x).strip() for x in parsed if str(x).strip()]
                if isinstance(parsed, str) and parsed.strip():
                    return [parsed.strip()]
                return []
            return [x.strip() for x in raw.split(",") if x.strip()]
        return v

    @property
    def effective_cors_allow_origins(self) -> list[str]:
        if self.cors_allow_origins:
            return self.cors_allow_origins
        return []


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    # BaseSettings loads required fields from environment/.env at runtime.
    return Settings()  # type: ignore[call-arg]
