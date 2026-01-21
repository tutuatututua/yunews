from __future__ import annotations

from pathlib import Path

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"  # local-pipeline/.env


class Settings(BaseSettings):
    """Configuration loaded from environment variables.

    This pipeline is designed for local execution (CLI/cron).
    Secrets are provided via a `.env` file in `local-pipeline/` or
    exported environment variables.
    """

    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # APIs
    openai_api_key: str = Field(alias="OPENAI_API_KEY")
    hf_api_key: str = Field(alias="HF_TOKEN")
    youtube_api_key: str = Field(alias="YOUTUBE_API_KEY")

    # Supabase
    supabase_url: str = Field(alias="SUPABASE_URL")
    supabase_service_key: str | None = Field(
        default=None,
        validation_alias=AliasChoices("SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    )

    @model_validator(mode="after")
    def _validate_supabase_keys(self) -> "Settings":
        if not (self.supabase_service_key and self.supabase_service_key.strip()):
            raise ValueError(
                "Missing Supabase service key. Set SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_SERVICE_KEY."
            )
        return self

    @property
    def supabase_key(self) -> str:
        """Compatibility alias used by other components (e.g., backend-api).

        For local pipeline runs we always use the service role key.
        """

        # Validator ensures this is present.
        return str(self.supabase_service_key)

    # LLM config
    openai_chat_model: str = Field(
        default="gpt-4.1-mini",
        validation_alias=AliasChoices("OPENAI_CHAT_MODEL", "OPENAI_SUMMARY_MODEL"),
    )
    llm_temperature: float = Field(default=0.1, alias="LLM_TEMPERATURE")

    # Embeddings config
    hf_embedding_model: str = Field(
        default="Qwen/Qwen3-0.6B",
        validation_alias=AliasChoices("HF_EMBEDDING_MODEL", "QWEN_EMBED_MODEL"),
    )
    embedding_max_length: int = Field(
        default=512,
        validation_alias=AliasChoices("EMBEDDING_MAX_LENGTH", "QWEN_EMBED_MAX_TOKENS"),
    )
    embedding_device: str = Field(default="auto", alias="EMBEDDING_DEVICE")

    # YouTube discovery config
    discovery_lookback_hours: int = Field(default=36, alias="DISCOVERY_LOOKBACK_HOURS")
    discovery_max_videos: int = Field(default=10, alias="DISCOVERY_MAX_VIDEOS")
    discovery_language: str = Field(default="en", alias="DISCOVERY_LANGUAGE")

    # Chunking
    chunk_window_seconds: int = Field(default=300, alias="CHUNK_WINDOW_SECONDS")


def get_settings() -> Settings:
    # Environment variables are required at runtime; Pylance can't see them during analysis.
    return Settings()  # type: ignore[call-arg]
