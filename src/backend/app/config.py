"""Application settings (pydantic-settings, loaded from .env)."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # database
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/portflow"
    db_echo: bool = False

    # api
    port: int = 8000
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # llm (Claude via Anthropic) — narrative only
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-5"

    # data pipelines
    open_meteo_base: str = "https://api.open-meteo.com"
    reference_lat: float = 33.74
    reference_lon: float = -118.20

    # simulation
    sim_seed: int = 20240817
    sim_horizon_hours: int = 72

    # ---- Phase 0 feature flags (each owner flips their flag on when the feature lands) ----
    feature_weather: bool = False       # W1 weather pipeline + W2 weather features
    feature_quality: bool = False       # W1 normalisation + completeness score
    feature_upload: bool = False        # W1 CSV schedule upload / ETA revisions
    feature_tidal: bool = False         # W3 tidal windows in CP-SAT
    feature_incremental: bool = False   # W3 CP-SAT warm-start re-optimise
    feature_scenarios_ext: bool = False # W3 berth/bunching scenarios + rollback

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
