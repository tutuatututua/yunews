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
    supabase_url: str = Field(validation_alias=AliasChoices("SUPABASE_URL", "supabase_url"))

    # Optional API key auth for public deployments.
    # If set, clients must send `X-API-Key: <key>` or `Authorization: Bearer <key>`.
    api_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("API_KEY", "BACKEND_API_KEY", "api_key"),
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
            "supabase_service_role_key",
        ),
    )


    log_level: str = Field(default="INFO", validation_alias=AliasChoices("LOG_LEVEL", "log_level"))
    
    # CORS: set explicitly in production. Accepts either JSON array (preferred) or comma-separated string.
    cors_allow_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        validation_alias=AliasChoices("CORS_ALLOW_ORIGINS", "cors_allow_origins"),
    )
    cors_allow_methods: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["GET", "OPTIONS"],
        validation_alias=AliasChoices("CORS_ALLOW_METHODS", "cors_allow_methods"),
    )
    cors_allow_headers: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["*"],
        validation_alias=AliasChoices("CORS_ALLOW_HEADERS", "cors_allow_headers"),
    )

    # Optional hardening; when set, rejects requests with unknown Host headers.
    trusted_hosts: Annotated[list[str], NoDecode] = Field(
        default_factory=list,
        validation_alias=AliasChoices("TRUSTED_HOSTS", "trusted_hosts"),
    )

    # Only enable when the API is served over HTTPS (directly or via a reverse proxy).
    enable_hsts: bool = Field(default=False, validation_alias=AliasChoices("ENABLE_HSTS", "enable_hsts"))

    backend_port: int = Field(default=8080, validation_alias=AliasChoices("PORT", "BACKEND_PORT", "backend_port"))

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
