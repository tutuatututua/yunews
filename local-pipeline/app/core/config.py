from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Configuration loaded from environment variables.

    This pipeline is designed for local execution (CLI/cron).
    Secrets are provided via a `.env` file in `local-pipeline/` or
    exported environment variables.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # APIs
    openai_api_key: str = Field(alias="OPENAI_API_KEY")
    hf_api_key: str = Field(alias="HF_API_KEY")
    youtube_api_key: str = Field(alias="YOUTUBE_API_KEY")

    # Supabase
    supabase_url: str = Field(alias="SUPABASE_URL")
    supabase_service_key: str = Field(alias="SUPABASE_SERVICE_KEY")

    # LLM config
    openai_chat_model: str = Field(default="gpt-4.1-mini", alias="OPENAI_CHAT_MODEL")
    llm_temperature: float = Field(default=0.1, alias="LLM_TEMPERATURE")

    # Embeddings config
    hf_embedding_model: str = Field(default="Qwen/Qwen3-0.6B", alias="HF_EMBEDDING_MODEL")
    embedding_max_length: int = Field(default=512, alias="EMBEDDING_MAX_LENGTH")
    embedding_device: str = Field(default="auto", alias="EMBEDDING_DEVICE")

    # YouTube discovery config
    discovery_lookback_hours: int = Field(default=24, alias="DISCOVERY_LOOKBACK_HOURS")
    discovery_max_videos: int = Field(default=10, alias="DISCOVERY_MAX_VIDEOS")
    discovery_language: str = Field(default="en", alias="DISCOVERY_LANGUAGE")

    # Chunking
    chunk_window_seconds: int = Field(default=300, alias="CHUNK_WINDOW_SECONDS")


def get_settings() -> Settings:
    # Environment variables are required at runtime; Pylance can't see them during analysis.
    return Settings()  # type: ignore[call-arg]
