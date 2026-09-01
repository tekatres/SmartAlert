"""Application configuration loaded from environment variables."""
from functools import lru_cache
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Smart Alerts AI"
    app_env: str = "development"
    app_port: int = 8000
    log_level: str = "info"

    data_provider: str = Field(default="mock", pattern="^(mock|coingecko|binance)$")
    coins: str = "bitcoin,ethereum,solana,binancecoin,ripple,cardano,dogecoin,polkadot"

    price_change_pct: float = 3.0
    price_window_min: int = 5
    volume_spike_multiplier: float = 2.0

    ai_provider: str = Field(default="mock", pattern="^(mock|openai)$")
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    internal_api_key: str = "change-me"
    cors_origins: str = "http://localhost:5173"

    # No-Cloud-Functions mode: the FastAPI process persists + pushes directly
    # to Firestore/FCM using a Firebase service account (free).
    firebase_credentials: str = ""   # path to service-account JSON (or GOOGLE_APPLICATION_CREDENTIALS)
    firebase_project_id: str = ""
    signal_scan_interval_s: int = 300      # generate alerts+signals every N s
    outcome_scan_interval_s: int = 1800    # evaluate signal outcomes every N s

    @property
    def coin_list(self) -> List[str]:
        return [c.strip() for c in self.coins.split(",") if c.strip()]

    @property
    def cors_origin_list(self) -> List[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
