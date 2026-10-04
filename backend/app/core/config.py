from typing import List, Optional, Union
from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Waypoint Logistics API"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"

    # Environment
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Database
    DATABASE_URL: str = "postgresql+psycopg2://postgres:postgres@localhost:5432/waypoint_logistics"
    DATABASE_URL_UNPOOLED: Optional[str] = None
    DB_HOST: Optional[str] = None
    DB_PORT: Optional[int] = None
    DB_NAME: Optional[str] = None
    DB_USER: Optional[str] = None
    DB_PASSWORD: Optional[str] = None
    DB_SSLMODE: Optional[str] = None

    @field_validator("DATABASE_URL", "DATABASE_URL_UNPOOLED", mode="before")
    @classmethod
    def assemble_db_connection(cls, v: Optional[str]) -> Optional[str]:
        if isinstance(v, str) and v.strip():
            # Check which driver is available: psycopg (v3) or psycopg2 (v2)
            try:
                import psycopg  # noqa: F401
                preferred = "postgresql+psycopg://"
            except ImportError:
                preferred = "postgresql+psycopg2://"

            if v.startswith("postgresql+psycopg://") and preferred == "postgresql+psycopg2://":
                return v.replace("postgresql+psycopg://", "postgresql+psycopg2://", 1)
            if v.startswith("postgresql+psycopg2://"):
                return v
            if v.startswith("postgresql://"):
                return v.replace("postgresql://", preferred, 1)
            if v.startswith("postgres://"):
                return v.replace("postgres://", preferred, 1)
        return v

    # Keycloak Configuration
    KEYCLOAK_URL: str = "http://localhost:8080"
    KEYCLOAK_REALM: str = "waypointlogistics"
    KEYCLOAK_CLIENT_ID: str = "waypoint-backend"
    KEYCLOAK_CLIENT_SECRET: str = "your_keycloak_client_secret_here"
    KEYCLOAK_ALGORITHM: str = "RS256"
    KEYCLOAK_AUDIENCE: str = "account"
    KEYCLOAK_DEV_MODE: bool = True  # Allows local / test bypass when Keycloak container is offline

    # Temporary operational scope while Keycloak depot claims are being wired.
    # Requests without an explicit depot scope stay in Peliyagoda, never a
    # combined cross-depot view.
    DISPATCHER_DEFAULT_DEPOT: str = "peliyagoda"

    # Loader module
    # Mounts /loader/dev/* which simulates dispatcher actions while there is no
    # dispatcher UI. Never mounted when ENVIRONMENT == "production".
    LOADER_DEV_ENDPOINTS: bool = True

    # JWT / Fallback Secret for Dev and Testing
    SECRET_KEY: str = "change-this-in-production-super-secret-key-32chars"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    ALGORITHM: str = "HS256"

    # CORS
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()
