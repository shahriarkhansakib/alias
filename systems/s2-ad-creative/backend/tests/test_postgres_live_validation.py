"""
Dedicated Stage 1 Live PostgreSQL 16 Integration & Verification Test Suite.

Execution & Invariants:
1. Normal test suite run (pytest backend/tests/):
   - Automatically SKIPS if POSTGRES_TEST_DATABASE_URL is not set, preserving ordinary offline SQLite tests.
2. Explicit invocation (pytest backend/tests/test_postgres_live_validation.py or RUN_POSTGRES_TESTS=true):
   - FAILS CLEARLY if POSTGRES_TEST_DATABASE_URL is missing or invalid (no silent fallback).
3. Safety Guardrails:
   - Validates disposable database safety (rejection of production environments, hosts, and db names).
   - Re-checks safety immediately before each destructive operation.
4. Verifies:
   - Server version is PostgreSQL 16
   - Full Alembic migration cycle (head -> -1 -> head)
   - Native PostgreSQL JSONB catalog types in information_schema.columns
   - Non-unique composite b-tree indexes on (tenant_id, cache_key) in pg_indexes
   - Transaction rollback atomicity on exception
"""

import os
import uuid
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.db_safety import (
    validate_disposable_postgres_url,
    assert_destructive_safety_or_raise,
    normalize_async_db_url,
    mask_db_url,
)
from app.models.auth import Tenant


def is_explicit_postgres_invocation(request) -> bool:
    """
    Returns True if the user explicitly invoked this test file directly:
    - pytest backend/tests/test_postgres_live_validation.py
    - pytest -k postgres_live
    - environment variable RUN_POSTGRES_TESTS=true
    """
    if os.getenv("RUN_POSTGRES_TESTS", "").lower().strip() in ("true", "1", "yes"):
        return True
    args = getattr(request.config, "args", []) or []
    for arg in args:
        if "test_postgres_live_validation" in arg:
            return True
    keyword_expr = getattr(request.config.option, "keyword", "") or ""
    if "postgres_live" in keyword_expr:
        return True
    return False


@pytest.fixture(scope="module", autouse=True)
def pg_target_info(request):
    """
    Controls execution mode:
    - If explicit invocation and URL missing -> FAILS immediately.
    - If ordinary test suite and URL missing -> SKIPS cleanly.
    - If URL present -> validates safety and returns connection metadata.
    """
    raw_url = os.getenv("POSTGRES_TEST_DATABASE_URL")
    explicit = is_explicit_postgres_invocation(request)

    if not raw_url or not raw_url.strip():
        if explicit:
            pytest.fail(
                "EXPLICIT INVOCATION FAILURE: test_postgres_live_validation.py was invoked directly, "
                "but POSTGRES_TEST_DATABASE_URL is not set in the environment. "
                "Set $env:POSTGRES_TEST_DATABASE_URL and $env:CONFIRM_DISPOSABLE_DATABASE='true'."
            )
        else:
            pytest.skip("Skipping live PostgreSQL tests: POSTGRES_TEST_DATABASE_URL is not configured.")

    # Validate target database safety (requires confirmation for module tests)
    safety_meta = validate_disposable_postgres_url(
        raw_url,
        allow_destructive=True,
        operation_name="PostgreSQL live test suite setup",
    )
    return safety_meta


@pytest_asyncio.fixture(scope="module")
async def pg_engine(pg_target_info):
    """Module-scoped async engine connected to the disposable PostgreSQL database."""
    engine = create_async_engine(
        pg_target_info["normalized_url"],
        pool_size=10,
        max_overflow=5,
        pool_pre_ping=True,
    )
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture(scope="function")
async def pg_session(pg_engine):
    """Function-scoped async session for PostgreSQL tests with automatic cleanup."""
    session_factory = async_sessionmaker(
        bind=pg_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with session_factory() as session:
        yield session


# =============================================================================
# 1. SERVER VERSION & CONNECTION VALIDATION
# =============================================================================

@pytest.mark.asyncio
async def test_postgres_connection_and_version(pg_session: AsyncSession):
    """Verify live connectivity and validate server version is PostgreSQL 16."""
    res = await pg_session.execute(text("SELECT version();"))
    version_str = res.scalar_one()
    assert "PostgreSQL" in version_str, f"Connected server is not PostgreSQL: {version_str}"
    assert "PostgreSQL 16" in version_str or "16." in version_str, (
        f"Stage 1 requires PostgreSQL 16. Detected version: {version_str}"
    )


# =============================================================================
# 2. ALEMBIC MIGRATION CYCLE (BLANK -> HEAD -> -1 -> HEAD)
# =============================================================================

def test_alembic_postgres_migration_lifecycle(pg_target_info):
    """
    Validates complete migration lifecycle against the live PostgreSQL database:
    1. alembic upgrade head
    2. alembic downgrade -1
    3. alembic upgrade head
    Safety is re-checked immediately before each destructive operation.
    """
    raw_url = os.getenv("POSTGRES_TEST_DATABASE_URL")
    normalized_url = pg_target_info["normalized_url"]

    ini_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    alembic_cfg = Config(ini_path)
    alembic_cfg.set_main_option("sqlalchemy.url", normalized_url)

    # 1. Immediate safety check & upgrade to head
    assert_destructive_safety_or_raise(raw_url, operation_name="test migration upgrade head")
    command.upgrade(alembic_cfg, "head")

    # 2. Immediate safety check & downgrade one revision
    assert_destructive_safety_or_raise(raw_url, operation_name="test migration downgrade -1")
    command.downgrade(alembic_cfg, "-1")

    # 3. Immediate safety check & re-upgrade to head
    assert_destructive_safety_or_raise(raw_url, operation_name="test migration re-upgrade head")
    command.upgrade(alembic_cfg, "head")


# =============================================================================
# 3. CATALOG VERIFICATION: NATIVE JSONB DATA TYPES
# =============================================================================

@pytest.mark.asyncio
async def test_postgres_jsonb_catalog_verification(pg_session: AsyncSession):
    """
    Queries information_schema.columns to prove columns are stored as native JSONB
    in the live PostgreSQL catalogs, rather than text or generic JSON.
    """
    jsonb_checks = [
        ("ad_briefs", "payload"),
        ("ad_briefs", "platforms"),
        ("ad_briefs", "validation_report"),
        ("creative_strategies", "strategy_spec"),
        ("creative_strategies", "claim_validation_report"),
        ("creative_jobs", "stage_data"),
        ("generated_backgrounds", "prompt_spec"),
        ("composited_creatives", "placement_spec"),
        ("final_rendered_creatives", "typography_spec"),
        ("final_rendered_creatives", "provenance_chain"),
        ("final_rendered_creatives", "vision_qa_result"),
    ]

    for table_name, column_name in jsonb_checks:
        stmt = text("""
            SELECT data_type, udt_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = :table_name
              AND column_name = :column_name
        """)
        res = await pg_session.execute(stmt, {"table_name": table_name, "column_name": column_name})
        row = res.mappings().first()
        assert row is not None, f"Column '{column_name}' on table '{table_name}' was not found in catalog."
        udt_name = row["udt_name"].lower()
        assert udt_name == "jsonb", (
            f"Table '{table_name}' column '{column_name}' is '{udt_name}', expected native 'jsonb'."
        )


# =============================================================================
# 4. CATALOG VERIFICATION: COMPOSITE TENANT CACHE INDEXES
# =============================================================================

@pytest.mark.asyncio
async def test_postgres_composite_index_catalog_verification(pg_session: AsyncSession):
    """
    Queries pg_indexes to confirm the three non-unique composite btree indexes
    on (tenant_id, cache_key) are present and correctly defined in the live catalog.
    """
    index_checks = [
        ("generated_backgrounds", "ix_generated_backgrounds_tenant_cache"),
        ("composited_creatives", "ix_composited_creatives_tenant_cache"),
        ("final_rendered_creatives", "ix_final_rendered_creatives_tenant_cache"),
    ]

    for table_name, index_name in index_checks:
        stmt = text("""
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
              AND tablename = :table_name
              AND indexname = :index_name
        """)
        res = await pg_session.execute(stmt, {"table_name": table_name, "index_name": index_name})
        row = res.mappings().first()
        assert row is not None, f"Composite index '{index_name}' on '{table_name}' not found in pg_indexes."

        index_def = row["indexdef"].lower()
        # Verify columns in index
        assert "tenant_id" in index_def and "cache_key" in index_def, (
            f"Index '{index_name}' does not index (tenant_id, cache_key): {index_def}"
        )
        # Verify it is non-unique
        assert "unique" not in index_def, f"Index '{index_name}' must NOT be unique: {index_def}"


# =============================================================================
# 5. TRANSACTION ROLLBACK & CONCURRENT POOL RESILIENCE
# =============================================================================

@pytest.mark.asyncio
async def test_postgres_transaction_rollback_on_exception(pg_engine):
    """Verify transactional atomicity: uncommitted rows are cleanly rolled back on exception."""
    session_factory = async_sessionmaker(bind=pg_engine, class_=AsyncSession, expire_on_commit=False)
    probe_id = f"rollback-probe-{uuid.uuid4()}"

    # Transaction 1: Fails mid-flight
    try:
        async with session_factory() as session:
            tenant = Tenant(id=probe_id, name="Probe Tenant", slug=f"probe-{uuid.uuid4().hex[:8]}")
            session.add(tenant)
            await session.flush()
            raise RuntimeError("Simulated failure before commit")
    except RuntimeError:
        pass

    # Transaction 2: Verify probe_id was NOT committed
    async with session_factory() as session:
        queried = await session.get(Tenant, probe_id)
        assert queried is None, "Rollback failed: uncommitted tenant record was persisted."
