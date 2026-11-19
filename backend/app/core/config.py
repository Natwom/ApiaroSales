import os

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LOCAL_DB = "postgresql+psycopg://apiaro:apiaro@localhost:5432/apiaro"
DEV_SECRET = "dev-secret-change-in-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = LOCAL_DB
    SECRET_KEY: str = DEV_SECRET
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    CORS_ORIGINS: str = "http://localhost:5173"
    UPLOAD_DIR: str = "./uploads"
    CURRENCY_CODE: str = "KES"
    CURRENCY_SYMBOL: str = "KSh"

    @field_validator("DATABASE_URL")
    @classmethod
    def normalize_database_url(cls, v: str) -> str:
        """Accept Neon/Render style URLs and make them work with psycopg v3."""
        v = v.strip().strip('"').strip("'")
        if v.startswith("postgres://"):
            v = "postgresql+psycopg://" + v[len("postgres://"):]
        elif v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://"):]
        return v


settings = Settings()

# Running on Render? (Render sets RENDER=true automatically)
IS_RENDER = bool(os.getenv("RENDER"))

if IS_RENDER:
    if "localhost" in settings.DATABASE_URL or "127.0.0.1" in settings.DATABASE_URL:
        raise RuntimeError(
            "DATABASE_URL is not set on Render (it is still pointing to localhost). "
            "Add your Neon connection string under Environment > DATABASE_URL."
        )
    if settings.SECRET_KEY == DEV_SECRET:
        raise RuntimeError(
            "SECRET_KEY is still the development default. "
            "Set a strong SECRET_KEY under Render > Environment."
        )