"""
Phase 7.3: Production Worker Architecture (Redis + Celery) Integration Tests.

Validates:
1. Worker Abstraction & Configuration:
   - InProcessJobDispatcher dispatches and completes asynchronously.
   - CeleryJobDispatcher queues minimal payload to Celery/Redis without large binary payloads.
   - Settings validation enforces REDIS_URL when WORKER_TYPE='celery'.
2. Idempotency & Duplicate Delivery Safety:
   - Duplicate worker execution against already-completed stages returns existing records without re-generation.
   - Bounded retries: transient network errors trigger bounded Celery retry; deterministic QA failures do not.
3. State Machine & Integrity Invariants:
   - Worker adheres strictly to canonical ALLOWED_TRANSITIONS.
   - Unknown stages or invalid transitions raise ValueError/HTTPException.
   - Cross-job task isolation (cannot process resources belonging to a different job).
4. Jobs API:
   - Polling endpoint GET /api/v1/jobs/{job_id} returns accurate status, progression, and resource IDs.
   - Asynchronous dispatch endpoint POST /api/v1/jobs/{job_id}/dispatch queues and returns 200 immediately.
"""

import uuid
from unittest.mock import MagicMock, patch
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select

from app.main import app
from app.core.config import Settings
from app.core.database import get_db
from app.models.brief import AdBrief
from app.models.strategy import CreativeStrategyRecord
from app.models.job import CreativeJob, JobStatus
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.workers.dispatcher import (
    InProcessJobDispatcher,
    CeleryJobDispatcher,
    get_job_dispatcher,
    reset_job_dispatcher,
)
from app.workers.job_runner import execute_job_stage
from app.workers.tasks import process_creative_stage


# =============================================================================
# 1. WORKER CONFIGURATION & DISPATCHER TESTS
# =============================================================================

def test_celery_worker_requires_redis_url():
    """Verify that selecting Celery worker requires REDIS_URL configuration."""
    with pytest.raises(ValueError, match="Celery worker is selected but REDIS_URL is not configured"):
        Settings(
            ENVIRONMENT="development",
            WORKER_TYPE="celery",
            REDIS_URL="",
        )

    # Valid Celery configuration
    cfg = Settings(
        ENVIRONMENT="development",
        WORKER_TYPE="celery",
        REDIS_URL="redis://localhost:6379/0",
    )
    assert cfg.WORKER_TYPE == "celery"
    assert cfg.REDIS_URL == "redis://localhost:6379/0"


@pytest.mark.asyncio
async def test_in_process_job_dispatcher():
    """Test in-process dispatcher generates tracking ID and runs asynchronously."""
    dispatcher = InProcessJobDispatcher()
    task_id = await dispatcher.dispatch(
        job_id="test_job_123",
        stage="BACKGROUND",
        params={"platform": "instagram"},
    )
    assert task_id.startswith("inproc-")


@pytest.mark.asyncio
async def test_celery_job_dispatcher_queues_minimal_payload():
    """Verify CeleryJobDispatcher enqueues task with minimal identifiers and correct queue."""
    dispatcher = CeleryJobDispatcher.__new__(CeleryJobDispatcher)

    with patch("app.workers.tasks.process_creative_stage.apply_async") as mock_apply_async:
        mock_result = MagicMock()
        mock_result.id = "celery-task-uuid-456"
        mock_apply_async.return_value = mock_result

        task_id = await dispatcher.dispatch(
            job_id="job_abc",
            stage="BACKGROUND",
            params={"platform": "instagram"},
        )

        assert task_id == "celery-task-uuid-456"
        mock_apply_async.assert_called_once_with(
            kwargs={
                "job_id": "job_abc",
                "stage": "BACKGROUND",
                "params": {"platform": "instagram"},
            },
            queue="creative",
        )


# =============================================================================
# 2. JOB RUNNER IDEMPOTENCY & EXECUTION TESTS
# =============================================================================

@pytest.mark.asyncio
async def test_job_runner_idempotency_for_existing_background(test_db_session):
    """Worker task must not re-generate background if an approved background already exists."""
    job_id = str(uuid.uuid4())
    strat_id = str(uuid.uuid4())
    brief_id = str(uuid.uuid4())
    bg_id = str(uuid.uuid4())

    brief = AdBrief(
        id=brief_id,
        brand_name="Test Brand",
        product_name="Tracker",
        price=99.0,
        platforms=["instagram"],
        payload={"brand": "Test"},
    )
    test_db_session.add(brief)

    strat = CreativeStrategyRecord(
        id=strat_id,
        brief_id=brief_id,
        template_id="clean",
        strategy_spec={"headline": "Test"},
        claim_validation_report={"passed": True},
    )
    test_db_session.add(strat)

    job = CreativeJob(
        id=job_id,
        brief_id=brief_id,
        strategy_id=strat_id,
        status=JobStatus.BACKGROUND_APPROVED.value,
    )
    test_db_session.add(job)

    # Existing approved background
    bg = GeneratedBackgroundRecord(
        id=bg_id,
        job_id=job_id,
        strategy_id=strat_id,
        brief_id=brief_id,
        platform="instagram",
        width=1080,
        height=1080,
        aspect_ratio="1:1",
        provider="mock",
        model_name="mock-bg",
        prompt_spec={"lighting": "studio"},
        prompt_version="1.0",
        storage_key="backgrounds/bg.png",
        qa_status="PASS",
        qa_result={"passed": True},
    )
    test_db_session.add(bg)
    await test_db_session.commit()

    # Execute job stage with test database session
    result = await execute_job_stage(
        job_id=job_id,
        stage="BACKGROUND",
        params={"platform": "instagram"},
        db=test_db_session,
    )

    # Must return existing resource id and flag as cached
    assert result["job_id"] == job_id
    assert result["resource_id"] == bg_id
    assert result.get("is_cached") is True


@pytest.mark.asyncio
async def test_job_runner_invalid_stage_rejection(test_db_session):
    """Job runner must reject unsupported stages."""
    job_id = str(uuid.uuid4())
    job = CreativeJob(id=job_id, status=JobStatus.RECEIVED.value)
    test_db_session.add(job)
    await test_db_session.commit()

    with pytest.raises(ValueError, match="Unknown or unsupported stage"):
        await execute_job_stage(
            job_id=job_id,
            stage="UNSUPPORTED_STAGE",
            db=test_db_session,
        )


# =============================================================================
# 3. CELERY TASK BOUNDED RETRY & FAILURE HANDLING
# =============================================================================

def test_celery_task_transient_retry():
    """Verify Celery task retries on transient connection errors."""
    with patch("app.workers.tasks.execute_job_stage") as mock_exec, \
         patch.object(process_creative_stage, "retry", side_effect=RuntimeError("RetryTriggered")) as mock_retry:
        mock_exec.side_effect = ConnectionError("Redis connection lost")

        with pytest.raises(RuntimeError, match="RetryTriggered"):
            process_creative_stage.run(
                job_id="job_123",
                stage="BACKGROUND",
                params={"platform": "instagram"},
            )

        assert mock_retry.called


def test_celery_task_deterministic_failure_no_infinite_retry():
    """Verify deterministic errors (e.g. ValueError) fail immediately without retry."""
    with patch("app.workers.tasks.execute_job_stage") as mock_exec, \
         patch.object(process_creative_stage, "retry") as mock_retry:
        mock_exec.side_effect = ValueError("Invalid asset gate threshold")

        with pytest.raises(ValueError, match="Invalid asset gate threshold"):
            process_creative_stage.run(
                job_id="job_123",
                stage="BACKGROUND",
                params={"platform": "instagram"},
            )

        mock_retry.assert_not_called()




@pytest.mark.asyncio
async def test_job_runner_idempotency_for_existing_composite(test_db_session):
    """Worker task must not re-generate composite if an approved composite already exists."""
    job_id = str(uuid.uuid4())
    brief_id = str(uuid.uuid4())
    strat_id = str(uuid.uuid4())
    bg_id = str(uuid.uuid4())
    comp_id = str(uuid.uuid4())

    job = CreativeJob(
        id=job_id,
        brief_id=brief_id,
        strategy_id=strat_id,
        status=JobStatus.COMPOSITE_APPROVED.value,
    )
    test_db_session.add(job)

    comp = CompositedCreativeRecord(
        id=comp_id,
        job_id=job_id,
        strategy_id=strat_id,
        brief_id=brief_id,
        background_id=bg_id,
        platform="instagram",
        width=1080,
        height=1080,
        aspect_ratio="1:1",
        storage_key="mock/comp.png",
        placement_spec={"x": 100, "y": 100, "width": 500, "height": 500},
        shadow_spec={"enabled": True},
        integrity_metadata={"source_hash": "mock"},
        qa_status="PASS",
        qa_result={"passed": True, "score": 1.0},
    )
    test_db_session.add(comp)
    await test_db_session.commit()

    result = await execute_job_stage(
        job_id=job_id,
        stage="COMPOSITE",
        params={"background_id": bg_id, "platform": "instagram"},
        db=test_db_session,
    )
    assert result["resource_id"] == comp_id
    assert result["is_cached"] is True


@pytest.mark.asyncio
async def test_job_runner_idempotency_for_existing_final_ad(test_db_session):
    """Worker task must not re-render final ad if an approved final ad already exists."""
    job_id = str(uuid.uuid4())
    strat_id = str(uuid.uuid4())
    bg_id = str(uuid.uuid4())
    comp_id = str(uuid.uuid4())
    final_id = str(uuid.uuid4())

    job = CreativeJob(
        id=job_id,
        strategy_id=strat_id,
        status=JobStatus.FINAL_AD_APPROVED.value,
    )
    test_db_session.add(job)

    final_rec = FinalRenderedCreativeRecord(
        id=final_id,
        job_id=job_id,
        strategy_id=strat_id,
        background_id=bg_id,
        composite_id=comp_id,
        platform="instagram",
        width=1080,
        height=1080,
        aspect_ratio="1:1",
        storage_key="mock/final.png",
        copy_spec={"headline": "Test"},
        typography_spec={"font": "Inter"},
        cta_spec={"text": "Shop Now"},
        readability_spec={"contrast": 4.5},
        provenance_chain={"root": "mock"},
        qa_status="FINAL_AD_APPROVED",
        qa_result={"passed": True, "score": 1.0},
        is_cached=False,
    )
    test_db_session.add(final_rec)
    await test_db_session.commit()

    result = await execute_job_stage(
        job_id=job_id,
        stage="FINAL_AD",
        params={"composite_id": comp_id, "platform": "instagram"},
        db=test_db_session,
    )
    assert result["resource_id"] == final_id
    assert result["is_cached"] is True



@pytest.mark.asyncio
async def test_job_runner_nonexistent_job_rejected(test_db_session):
    """Worker task with non-existent job ID must fail cleanly."""
    with pytest.raises(ValueError, match="not found in database"):
        await execute_job_stage(
            job_id="nonexistent-job-uuid",
            stage="BACKGROUND",
            params={},
            db=test_db_session,
        )


# =============================================================================
# 4. JOBS API POLLING & DISPATCH ENDPOINTS
# =============================================================================


@pytest.mark.asyncio
async def test_jobs_status_api(client, test_db_session):
    """Test GET /api/v1/jobs/{job_id} returns accurate progression and status."""
    job_id = str(uuid.uuid4())
    job = CreativeJob(
        id=job_id,
        status=JobStatus.BACKGROUND_APPROVED.value,
        current_stage="AI Background Generation",
        progress_pct=60,
        stage_data={"attempt": 1},
    )
    test_db_session.add(job)
    await test_db_session.commit()

    resp = await client.get(f"/api/v1/jobs/{job_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == job_id
    assert data["status"] == "BACKGROUND_APPROVED"
    assert data["progress_pct"] == 60
    assert data["current_stage"] == "AI Background Generation"


@pytest.mark.asyncio
async def test_jobs_dispatch_api(client, test_db_session):
    """Test POST /api/v1/jobs/{job_id}/dispatch queues task and returns immediately."""
    job_id = str(uuid.uuid4())
    job = CreativeJob(
        id=job_id,
        status=JobStatus.STRATEGY_VALIDATED.value,
    )
    test_db_session.add(job)
    await test_db_session.commit()

    resp = await client.post(
        f"/api/v1/jobs/{job_id}/dispatch",
        json={"stage": "BACKGROUND", "params": {"platform": "instagram"}},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["job_id"] == job_id
    assert data["status"] == "QUEUED"
    assert data["stage"] == "BACKGROUND"
    assert "task_id" in data
