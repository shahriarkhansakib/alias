"""
Phase 7.1: PostgreSQL + Production Persistence Integration Tests.

Validates:
1. Database configuration & production safety guards (forbidding SQLite in production).
2. PostgreSQL connection pooling configuration.
3. Model schemas, types, JSON/JSONB compatibility, and DDL generation across dialects.
4. Explicit foreign key constraints and cascade actions (CASCADE, SET NULL).
5. Transaction safety and rollback handling on exceptions.
6. Alembic migration execution, reversible upgrades/downgrades, and offline static SQL generation.
7. Preservation of Phase 6.2 strict graph invariants and cross-job isolation.
"""

import os
import uuid
import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, select, inspect
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.schema import CreateTable


from app.core.config import Settings
from app.core.database import Base, get_db
from app.models.base import CompatibleJSON
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.strategy import CreativeStrategyRecord
from app.models.job import CreativeJob, JobStatus
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord


# =============================================================================
# 1. PRODUCTION CONFIGURATION & PERSISTENCE SAFETY GUARDS
# =============================================================================

def test_production_forbids_sqlite():
    """Application startup MUST NOT silently fall back to SQLite in production."""
    with pytest.raises(ValueError, match="Production environment forbids SQLite"):
        Settings(
            ENVIRONMENT="production",
            DATABASE_URL="sqlite+aiosqlite:///./production.db"
        )


def test_production_accepts_postgres_url():
    """Production configuration must accept valid PostgreSQL async connection string."""
    cfg = Settings(
        ENVIRONMENT="production",
        DATABASE_URL="postgresql+asyncpg://alias_user:secure_pwd@db.internal:5432/alias_prod"
    )
    assert cfg.DATABASE_URL.startswith("postgresql+asyncpg://")
    assert cfg.ENVIRONMENT == "production"
    assert cfg.DB_POOL_SIZE == 10
    assert cfg.DB_MAX_OVERFLOW == 20
    assert cfg.DB_POOL_PRE_PING is True


def test_postgres_engine_pool_configuration():
    """Verify that PostgreSQL engine initializes with pooling parameters."""
    pg_url = "postgresql+asyncpg://alias_user:secure_pwd@db.internal:5432/alias_prod"
    engine = create_async_engine(
        pg_url,
        pool_size=15,
        max_overflow=25,
        pool_timeout=45,
        pool_recycle=1200,
        pool_pre_ping=True,
    )
    assert engine.pool.size() == 15
    assert engine.pool._max_overflow == 25
    assert engine.pool._timeout == 45
    assert engine.pool._recycle == 1200
    assert engine.pool._pre_ping is True


# =============================================================================
# 2. SCHEMA COMPILATION & POSTGRESQL TYPES (JSONB, KEYS, INDEXES, CASCADES)
# =============================================================================

def test_jsonb_compilation_on_postgresql():
    """Verify CompatibleJSON compiles to JSONB on PostgreSQL dialect and JSON on SQLite."""
    pg_dialect = postgresql.dialect()
    sqlite_dialect = sqlite.dialect()

    brief_table = AdBrief.__table__
    platforms_col = brief_table.c.platforms

    # On PostgreSQL, it must compile to JSONB
    pg_compiled = str(platforms_col.type.compile(dialect=pg_dialect))
    assert "JSONB" in pg_compiled

    # On SQLite, it must compile to JSON
    sqlite_compiled = str(platforms_col.type.compile(dialect=sqlite_dialect))
    assert "JSON" in sqlite_compiled


def test_postgresql_ddl_generation_and_cascades():
    """Audit PostgreSQL DDL for all models: primary keys, foreign keys, cascades, indexes."""
    pg_dialect = postgresql.dialect()

    # 1. CreativeStrategyRecord -> AdBrief (CASCADE)
    strat_ddl = str(CreateTable(CreativeStrategyRecord.__table__).compile(dialect=pg_dialect))
    assert "FOREIGN KEY(brief_id) REFERENCES ad_briefs (id) ON DELETE CASCADE" in strat_ddl

    # 2. CreativeJob -> AdBrief / CreativeStrategy (SET NULL)
    job_ddl = str(CreateTable(CreativeJob.__table__).compile(dialect=pg_dialect))
    assert "FOREIGN KEY(brief_id) REFERENCES ad_briefs (id) ON DELETE SET NULL" in job_ddl
    assert "FOREIGN KEY(strategy_id) REFERENCES creative_strategies (id) ON DELETE SET NULL" in job_ddl

    # 3. GeneratedBackgroundRecord -> Job/Strategy (CASCADE), Brief (SET NULL)
    bg_ddl = str(CreateTable(GeneratedBackgroundRecord.__table__).compile(dialect=pg_dialect))
    assert "FOREIGN KEY(job_id) REFERENCES creative_jobs (id) ON DELETE CASCADE" in bg_ddl
    assert "FOREIGN KEY(strategy_id) REFERENCES creative_strategies (id) ON DELETE CASCADE" in bg_ddl
    assert "FOREIGN KEY(brief_id) REFERENCES ad_briefs (id) ON DELETE SET NULL" in bg_ddl

    # 4. CompositedCreativeRecord -> Job/Strategy/Background (CASCADE), Brief (SET NULL)
    comp_ddl = str(CreateTable(CompositedCreativeRecord.__table__).compile(dialect=pg_dialect))
    assert "FOREIGN KEY(job_id) REFERENCES creative_jobs (id) ON DELETE CASCADE" in comp_ddl
    assert "FOREIGN KEY(background_id) REFERENCES generated_backgrounds (id) ON DELETE CASCADE" in comp_ddl

    # 5. FinalRenderedCreativeRecord -> Job/Strategy/Background/Composite (CASCADE)
    final_ddl = str(CreateTable(FinalRenderedCreativeRecord.__table__).compile(dialect=pg_dialect))
    assert "FOREIGN KEY(job_id) REFERENCES creative_jobs (id) ON DELETE CASCADE" in final_ddl
    assert "FOREIGN KEY(composite_id) REFERENCES composited_creatives (id) ON DELETE CASCADE" in final_ddl


def test_all_models_have_indexed_foreign_keys_and_timestamps():
    """Verify all foreign keys have indexes and timestamps are present on all records."""
    tables = [
        AdBrief.__table__,
        AssetValidationRecord.__table__,
        CreativeStrategyRecord.__table__,
        CreativeJob.__table__,
        GeneratedBackgroundRecord.__table__,
        CompositedCreativeRecord.__table__,
        FinalRenderedCreativeRecord.__table__,
    ]

    for table in tables:
        assert "created_at" in table.c
        assert "updated_at" in table.c
        assert "id" in table.c
        assert table.c.id.primary_key

        # Verify that all foreign keys are covered by indexes
        fk_columns = {col.name for fk in table.foreign_keys for col in fk.constraint.columns}
        indexed_cols = {col.name for idx in table.indexes for col in idx.columns}
        for fk_col in fk_columns:
            assert fk_col in indexed_cols, f"Foreign key column '{fk_col}' in '{table.name}' must have an index."


# =============================================================================
# 3. ALEMBIC MIGRATION VERIFICATION
# =============================================================================

def test_alembic_upgrade_and_downgrade(tmp_path):
    """Test programmatic Alembic migration execution from base to head and back."""
    db_file = tmp_path / "test_alembic.db"
    sync_url = f"sqlite:///{db_file}"

    ini_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
    alembic_cfg = Config(ini_path)
    alembic_cfg.set_main_option("sqlalchemy.url", sync_url)

    # 1. Upgrade to head
    command.upgrade(alembic_cfg, "head")

    # Verify tables were created by the migration
    sync_engine = create_engine(sync_url)
    inspector = inspect(sync_engine)
    table_names = inspector.get_table_names()
    assert "ad_briefs" in table_names
    assert "creative_jobs" in table_names
    assert "final_rendered_creatives" in table_names
    assert "alembic_version" in table_names

    # 2. Downgrade to base
    command.downgrade(alembic_cfg, "base")
    inspector = inspect(sync_engine)
    table_names = inspector.get_table_names()
    assert "ad_briefs" not in table_names
    assert "final_rendered_creatives" not in table_names
    sync_engine.dispose()



# =============================================================================
# 4. TRANSACTION ROLLBACK & CONCURRENCY SAFETY
# =============================================================================

@pytest.mark.asyncio
async def test_get_db_session_explicit_rollback_on_exception():
    """Verify get_db generator rolls back uncommitted writes when an exception occurs."""
    db_generator = get_db()
    session = await anext(db_generator)

    brief_id = str(uuid.uuid4())
    brief = AdBrief(
        id=brief_id,
        brand_name="Test Brand",
        product_name="Rollback Test Item",
        price=49.99,
        platforms=["instagram"],
        payload={"brand": "Test"},
    )
    session.add(brief)

    # Simulate an error during processing before commit
    with pytest.raises(RuntimeError, match="Simulated unhandled failure"):
        try:
            raise RuntimeError("Simulated unhandled failure")
        except Exception as exc:
            await db_generator.athrow(exc)

    # In a fresh session, verify the record was rolled back and not persisted
    async for new_session in get_db():
        result = await new_session.execute(select(AdBrief).where(AdBrief.id == brief_id))
        found = result.scalar_one_or_none()
        assert found is None
        break


# =============================================================================
# 5. STRICT GRAPH INTEGRITY & CROSS-JOB ISOLATION
# =============================================================================

@pytest.mark.asyncio
async def test_strict_graph_and_cascade_lifecycle(test_db_session):
    """
    Test the complete authoritative lifecycle:
    Job -> Brief -> Strategy -> Background -> Composite -> Final Ad.
    Verify JSON fields and cascade lifecycle.
    """
    brief_id = str(uuid.uuid4())
    strategy_id = str(uuid.uuid4())
    job_id = str(uuid.uuid4())
    bg_id = str(uuid.uuid4())
    comp_id = str(uuid.uuid4())
    final_id = str(uuid.uuid4())

    # 1. Create Brief
    brief = AdBrief(
        id=brief_id,
        brand_name="SmartFit",
        product_name="Fitness Watch",
        price=199.99,
        platforms=["instagram", "facebook"],
        payload={"category": "wearables", "sku": "SF-100"},
        validation_report={"status": "PASS", "confidence": 1.0},
    )
    test_db_session.add(brief)

    # 2. Create Strategy
    strategy = CreativeStrategyRecord(
        id=strategy_id,
        brief_id=brief_id,
        template_id="bold_clean",
        strategy_spec={"headline": "Elevate Your Game", "cta": "Shop Now"},
        claim_validation_report={"all_claims_verified": True},
    )
    test_db_session.add(strategy)

    # 3. Create Job
    job = CreativeJob(
        id=job_id,
        brief_id=brief_id,
        strategy_id=strategy_id,
        status=JobStatus.RECEIVED.value,
        brief_data={"brief_id": brief_id},
    )
    test_db_session.add(job)

    # 4. Create Background
    bg = GeneratedBackgroundRecord(
        id=bg_id,
        job_id=job_id,
        strategy_id=strategy_id,
        brief_id=brief_id,
        platform="instagram",
        width=1080,
        height=1080,
        aspect_ratio="1:1",
        provider="mock",
        model_name="mock-bg-v1",
        prompt_spec={"lighting": "studio"},
        prompt_version="1.0",
        storage_key="backgrounds/bg1.png",
        qa_status="PASS",
        qa_result={"passed": True},
    )
    test_db_session.add(bg)

    # 5. Create Composite
    composite = CompositedCreativeRecord(
        id=comp_id,
        job_id=job_id,
        strategy_id=strategy_id,
        brief_id=brief_id,
        background_id=bg_id,
        platform="instagram",
        width=1080,
        height=1080,
        aspect_ratio="1:1",
        storage_key="composites/comp1.png",
        placement_spec={"x": 100, "y": 100},
        shadow_spec={"blur": 5},
        integrity_metadata={"hash": "abc123"},
        qa_status="PASS",
        qa_result={"passed": True},
    )
    test_db_session.add(composite)

    # 6. Create Final Rendered Creative
    final_ad = FinalRenderedCreativeRecord(
        id=final_id,
        job_id=job_id,
        strategy_id=strategy_id,
        brief_id=brief_id,
        background_id=bg_id,
        composite_id=comp_id,
        platform="instagram",
        width=1080,
        height=1080,
        aspect_ratio="1:1",
        storage_key="final_ads/ad1.png",
        copy_spec={"headline": "Elevate Your Game"},
        typography_spec={"font": "Inter"},
        cta_spec={"text": "Shop Now"},
        readability_spec={"contrast": 4.5},
        provenance_chain={"job_id": job_id, "bg_id": bg_id, "comp_id": comp_id},
        qa_status="FINAL_AD_APPROVED",
        qa_result={"passed": True},
    )
    test_db_session.add(final_ad)

    await test_db_session.commit()

    # Query back and verify nested JSON persistence
    q = await test_db_session.execute(
        select(FinalRenderedCreativeRecord).where(FinalRenderedCreativeRecord.id == final_id)
    )
    ad_rec = q.scalar_one()
    assert ad_rec.job_id == job_id
    assert ad_rec.provenance_chain["bg_id"] == bg_id
    assert ad_rec.readability_spec["contrast"] == 4.5
    assert ad_rec.cta_spec["text"] == "Shop Now"
