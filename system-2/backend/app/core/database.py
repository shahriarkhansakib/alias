from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings
from app.core.logging import logger
from app.core.db_safety import normalize_async_db_url


class Base(DeclarativeBase):
    pass


# Configure async engine with dialect-specific connection pooling
normalized_db_url = normalize_async_db_url(settings.DATABASE_URL)
is_postgres = normalized_db_url.lower().startswith("postgresql")

if is_postgres:
    engine = create_async_engine(
        normalized_db_url,
        echo=settings.DEBUG,
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        pool_timeout=settings.DB_POOL_TIMEOUT,
        pool_recycle=settings.DB_POOL_RECYCLE,
        pool_pre_ping=settings.DB_POOL_PRE_PING,
        future=True,
    )
else:
    connect_args = {"check_same_thread": False} if normalized_db_url.lower().startswith("sqlite") else {}
    engine = create_async_engine(
        normalized_db_url,
        echo=settings.DEBUG,
        connect_args=connect_args,
        pool_pre_ping=settings.DB_POOL_PRE_PING,
        future=True,
    )

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency yielding an async database session.
    Guarantees explicit rollback on any unhandled exception before closing.
    """
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """
    Initialize database schema.
    In production: Base.metadata.create_all() is strictly disabled. Alembic migrations
    are authoritative for production PostgreSQL persistence.
    In development/testing: create_all() runs for frictionless local execution.
    """
    if settings.ENVIRONMENT.lower() == "production":
        logger.info(
            "Production environment detected: Skipping Base.metadata.create_all(). "
            "Alembic migrations are authoritative for production schema management."
        )
        return

    logger.info("Initializing database schema via Base.metadata.create_all (development/testing)...")
    import app.models  # Ensure all SQLAlchemy models are registered
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database schema initialized successfully.")

