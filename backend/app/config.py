from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./dev.db"
    secret_key: str = "dev-insecure-secret-change-me"
    session_max_age_seconds: int = 60 * 60 * 24 * 14
    cookie_secure: bool = False

    # Initial admin (only used when the users table is empty)
    admin_username: str | None = None
    admin_password: str | None = None

    default_timezone: str = "Asia/Taipei"
    tile_url: str = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
    tile_attribution: str = (
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    )
    tile_max_zoom: int = 19

    enable_docs: bool = True

    # Optional: Google Places API (New) key. Without it, Google Maps links are
    # still parsed for name + coordinates; with it, address / phone / website /
    # opening hours are looked up too.
    google_maps_api_key: str | None = None
    google_places_language: str = "zh-TW"

    # Fallback geocoder for links that carry no coordinates (name/address only).
    # Public Nominatim allows ~1 request/s for user-initiated lookups; set
    # NOMINATIM_URL to a self-hosted instance for heavier use, or disable.
    enable_nominatim: bool = True
    nominatim_url: str = "https://nominatim.openstreetmap.org"
    nominatim_email: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _empty_means_default(cls, data):
        # docker compose passes unset variables as "" — treat them as not set
        if isinstance(data, dict):
            return {k: v for k, v in data.items() if not (isinstance(v, str) and v.strip() == "")}
        return data


@lru_cache
def get_settings() -> Settings:
    return Settings()
