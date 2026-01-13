from __future__ import annotations

from pydantic import AliasChoices, Field
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
        )
    )

    backend_port: int = 8080


settings = Settings()  # type: ignore
