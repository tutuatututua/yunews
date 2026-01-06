from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    supabase_url: str
    supabase_service_role_key: str

    backend_port: int = 8080


settings = Settings()  # type: ignore
