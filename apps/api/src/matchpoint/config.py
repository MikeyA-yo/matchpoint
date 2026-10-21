from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "local"
    # Comma-separated list of allowed browser origins, e.g. "https://matchpoint-web.onrender.com"
    cors_origins: str = "http://localhost:5173"
    # "sim" wires the simulators; "pilot" wires the real connectors (see docs/connectors/).
    adapter_mode: str = "sim"
    # Key for the customer_ref HMAC. The default is for the simulator only; a pilot must
    # set its own and keep it out of the repo.
    ref_hmac_key: str = "sim-only-key-not-a-secret-0001"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
