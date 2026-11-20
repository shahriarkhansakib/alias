from typing import List, Union, Optional
from pydantic import AnyHttpUrl, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path



class Settings(BaseSettings):
    PROJECT_NAME: str = "Alias Img-Gen"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True

    # Database configuration
    # Defaults to local async SQLite for frictionless local reproduction/offline tests.
    # Set to postgresql+asyncpg://user:pass@localhost:5432/dbname for PostgreSQL.
    DATABASE_URL: str = "sqlite+aiosqlite:///./alias_imggen.db"

    # PostgreSQL Connection Pooling settings
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 1800  # Recycle connections after 30 minutes to prevent stale dropped conns
    DB_POOL_PRE_PING: bool = True  # Liveness probe on checkout

    # CORS configuration
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]

    # Storage configuration
    STORAGE_TYPE: str = "local"  # "local", "s3", or "r2"
    STORAGE_PROVIDER: str = "local"  # Alias for STORAGE_TYPE
    LOCAL_STORAGE_PATH: str = "./storage"
    STORAGE_PUBLIC_URL_PREFIX: str = "/api/v1/storage"

    # S3 / Cloudflare R2 object storage configuration
    S3_ENDPOINT_URL: Optional[str] = None
    S3_REGION: str = "us-east-1"
    S3_BUCKET: Optional[str] = None
    S3_ACCESS_KEY_ID: Optional[str] = None
    S3_SECRET_ACCESS_KEY: Optional[str] = None
    S3_PUBLIC_BASE_URL: Optional[str] = None

    # Worker configuration
    WORKER_TYPE: str = "async"  # "async" (in-process for dev) or "celery" (production)
    REDIS_URL: Optional[str] = None
    CELERY_TASK_DEFAULT_QUEUE: str = "creative"

    # Authentication & Multi-Tenancy configuration
    ENABLE_DEV_AUTH: bool = False  # Auto-enabled in development; strictly forbidden in production
    AUTH_JWT_SECRET: str = "alias-prod-auth-jwt-secret-key-1092837465"
    AUTH_JWT_ALGORITHM: str = "HS256"
    AUTH_JWKS_URL: Optional[str] = None
    AUTH_TOKEN_EXPIRE_MINUTES: int = 1440

    # Vision QA configuration — expensive model; OFF by default, runs only on final render
    # Set to True in staging/production to enable post-render vision verification.
    ENABLE_VISION_QA: bool = False
    # Provider class name: "mock" (default/dev), "google_gemini", or "openai"
    VISION_QA_PROVIDER: str = "mock"
    # Maximum vision QA calls per pipeline run (cost guard)
    VISION_QA_MAX_CALLS_PER_PIPELINE: int = 1
    GEMINI_API_KEY: Optional[str] = None
    OPENAI_API_KEY: Optional[str] = None

    # Publishing & Facebook OAuth configuration
    ENABLE_FACEBOOK_PUBLISHING: bool = False
    FACEBOOK_APP_ID: Optional[str] = None
    FACEBOOK_APP_SECRET: Optional[str] = None
    FACEBOOK_OAUTH_REDIRECT_URI: Optional[str] = None
    AUTH_TOKEN_ENCRYPTION_KEY: Optional[str] = None

    @model_validator(mode="after")
    def validate_production_configuration(self) -> "Settings":
        """
        Enforce strict production configuration invariants:
        1. Application startup MUST NOT silently fall back to SQLite in production.
        2. If S3 storage is selected, required bucket and credentials must be present.
        3. If Celery worker is selected, REDIS_URL must be configured.
        4. In production, development auth MUST NOT be enabled.
        5. If Facebook publishing is enabled in production, all secrets & valid encryption key must exist.
        """
        if self.ENVIRONMENT.lower() != "production":
            if "ENABLE_DEV_AUTH" not in self.model_fields_set:
                self.ENABLE_DEV_AUTH = True
        else:
            if self.DATABASE_URL.lower().startswith("sqlite"):
                raise ValueError(
                    "Production environment forbids SQLite. "
                    "DATABASE_URL must be configured with a PostgreSQL connection string (postgresql+asyncpg://...)."
                )
            if self.ENABLE_DEV_AUTH:
                raise ValueError("Development authentication is strictly forbidden in production.")
            if self.AUTH_JWT_SECRET == "dev-insecure-jwt-secret" and not self.AUTH_JWKS_URL:
                raise ValueError("Production environment forbids default/insecure AUTH_JWT_SECRET.")
            if self.ENABLE_FACEBOOK_PUBLISHING:
                if not self.FACEBOOK_APP_ID or not self.FACEBOOK_APP_SECRET:
                    raise ValueError("Facebook publishing is enabled in production but FACEBOOK_APP_ID or FACEBOOK_APP_SECRET is missing.")
                if not self.FACEBOOK_OAUTH_REDIRECT_URI:
                    raise ValueError("Facebook publishing is enabled in production but FACEBOOK_OAUTH_REDIRECT_URI is missing.")
                if not self.AUTH_TOKEN_ENCRYPTION_KEY:
                    raise ValueError("Facebook publishing is enabled in production but AUTH_TOKEN_ENCRYPTION_KEY is missing.")

        if self.AUTH_TOKEN_ENCRYPTION_KEY:
            # Validate format/length if provided
            from app.core.encryption import TokenEncryptionService
            TokenEncryptionService._parse_and_validate_key(self.AUTH_TOKEN_ENCRYPTION_KEY)

        effective_storage = (self.STORAGE_TYPE or self.STORAGE_PROVIDER).lower()
        if effective_storage in ("s3", "r2"):
            if not self.S3_BUCKET:
                raise ValueError("S3 storage is selected but S3_BUCKET is not configured.")
            if not self.S3_ACCESS_KEY_ID or not self.S3_SECRET_ACCESS_KEY:
                raise ValueError("S3 storage is selected but S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY is not configured.")

        if self.WORKER_TYPE.lower() == "celery":
            if not self.REDIS_URL:
                raise ValueError("Celery worker is selected but REDIS_URL is not configured.")

        return self



    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


settings = Settings()

