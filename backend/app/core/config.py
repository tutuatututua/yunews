from __future__ import annotations

"""Configuration (env vars / .env) for the FastAPI app.

This module exists to provide a stable, conventional import path: `app.core.config`.
"""

from functools import lru_cache
import json
from typing import Annotated

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    supabase_url: str = Field(validation_alias=AliasChoices("SUPABASE_URL"))

    api_key: str | None = Field(default=None, validation_alias=AliasChoices("API_KEY"))

    supabase_service_role_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_SERVICE_ROLE_KEY"),
    )

    log_level: str = Field(default="INFO", validation_alias=AliasChoices("LOG_LEVEL"))

    backend_port: int = Field(default=8080, validation_alias=AliasChoices("BACKEND_PORT"))

    openai_api_key: str | None = Field(default=None, validation_alias=AliasChoices("OPENAI_API_KEY"))
    openai_chat_model: str = Field(default="gpt-4.1-mini", validation_alias=AliasChoices("OPENAI_CHAT_MODEL"))

    chat_tokens_per_ip_per_window: int = Field(
        default=0,
        validation_alias=AliasChoices("CHAT_TOKENS_PER_IP_PER_WINDOW"),
    )
    chat_token_window_seconds: int = Field(
        default=60 * 60 * 24,
        validation_alias=AliasChoices("CHAT_TOKEN_WINDOW_SECONDS"),
    )

    openai_query_planner_model: str = Field(
        default="gpt-4.1-mini",
        validation_alias=AliasChoices("OPENAI_QUERY_PLANNER_MODEL"),
    )

    openai_embedding_model: str = Field(
        default="text-embedding-3-small",
        validation_alias=AliasChoices("OPENAI_EMBEDDING_MODEL"),
    )

    log_visit_ips: bool = Field(default=True, validation_alias=AliasChoices("LOG_VISIT_IPS"))
    log_chat_history: bool = Field(default=True, validation_alias=AliasChoices("LOG_CHAT_HISTORY"))

    @model_validator(mode="after")
    def _validate_supabase_keys(self):
        if self.supabase_service_role_key:
            return self
        raise ValueError("Missing Supabase credentials: set SUPABASE_SERVICE_ROLE_KEY")

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

            if raw[:1] in ("[", "{"):
                try:
                    loaded = json.loads(raw)
                except json.JSONDecodeError:
                    loaded = None

                if isinstance(loaded, list):
                    return [s for s in (str(x).strip() for x in loaded) if s]

            return [s for s in (part.strip() for part in raw.split(",")) if s]

        return v


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
