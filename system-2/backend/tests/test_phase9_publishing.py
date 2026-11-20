"""
Phase 9: Publishing Infrastructure Architecture Test Suite.
Validates the platform-independent publishing layer strictly downstream of FINAL_AD_APPROVED.

Test Matrix:
1. valid FINAL_AD_APPROVED publish
2. stale final rejection
3. deterministic QA failure rejection
4. missing Vision verification when required
5. unapproved final rejection
6. cross-tenant publish rejection
7. platform mismatch rejection
8. unsupported platform rejection
9. missing artifact rejection
10. valid publishing state transitions
11. invalid state transitions
12. retry behavior
13. deterministic publishing idempotency key
14. duplicate publish request
15. worker retry after ambiguous external result
16. reconciliation
17. external post ID persistence
18. provider failure
19. provider timeout
20. provider unavailable
21. token/secret non-exposure
22. Celery payload contains no image bytes
23. Celery payload contains no secrets
24. publishing cannot mutate FinalRenderedCreativeRecord
25. publishing references exact approved final artifact
"""

import io
import uuid
import hashlib
import inspect
import pytest
import pytest_asyncio
from PIL import Image
from unittest.mock import patch
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.auth import DEFAULT_TENANT_ID, DEFAULT_USER_ID, Tenant, User, Membership
from app.models.brief import AdBrief
from app.models.asset import AssetValidationRecord
from app.models.strategy import CreativeStrategyRecord
from app.models.job import CreativeJob, JobStatus
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.models.publishing import (
    PublishingRecord,
    PublishingStatus,
    PUBLISHING_ALLOWED_TRANSITIONS,
)
from app.schemas.platform import TargetPlatform
from app.schemas.publishing import PublishRequest, PublishRetryRequest
from app.services.final_ad_service import FinalAdService
from app.services.publishing_service import PublishingService
from app.publishing.capability_registry import PublishingCapabilityRegistry
from app.publishing.providers.mock import MockPublishingProvider
from app.publishing.providers.not_configured import NotConfiguredPublishingProvider
from app.publishing.providers.factory import get_publishing_provider
from app.providers.storage_provider import get_storage_provider
from app.workers.publishing_runner import execute_publishing_record
from app.workers.tasks import process_publishing_stage
from tests.test_phase8_production_simulation import setup_test_pipeline


# ==============================================================================
# Helper to render and approve a final creative
# ==============================================================================

async def setup_approved_final_ad(
    session: AsyncSession,
    platform: TargetPlatform = TargetPlatform.FACEBOOK,
    tenant_id: str = DEFAULT_TENANT_ID,
    qa_status: str = "PASS",
    is_stale: bool = False,
    set_approved_job_status: bool = True,
) -> dict:
    pipeline = await setup_test_pipeline(session, platform=platform, tenant_id=tenant_id)
    comp = pipeline["composite"]
    job = pipeline["job"]

    final_ad = await FinalAdService.render_final_ad(
        db=session,
        composite_id=comp.id,
        force_regenerate=True,
    )

    if qa_status != "PASS":
        final_ad.qa_status = qa_status
    if is_stale:
        final_ad.is_stale = True

    if set_approved_job_status:
        job.status = JobStatus.FINAL_AD_APPROVED.value
    else:
        job.status = JobStatus.FINAL_RENDERING.value

    await session.commit()
    await session.refresh(final_ad)
    await session.refresh(job)

    return {
        "pipeline": pipeline,
        "final_ad": final_ad,
        "job": job,
    }


# ==============================================================================
# TESTS 1 - 9: VALIDATION GATES
# ==============================================================================

@pytest.mark.asyncio
async def test_01_valid_final_ad_approved_publish(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 1: Valid publish of an approved final creative."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]

    payload = {
        "final_ad_id": final_ad.id,
        "platform": "facebook",
        "caption": "Get the new SmartFit X1 Pro today! #fitness #smartwatch",
        "platform_metadata": {"placement": "feed"},
    }

    res = await client.post("/api/v1/publishing", json=payload)
    assert res.status_code == 201, res.text
    data = res.json()

    assert data["status"] == PublishingStatus.PUBLISHED.value
    assert data["final_ad_id"] == final_ad.id
    assert data["platform"] == "facebook"
    assert data["external_post_id"] is not None
    assert data["post_url"] is not None
    assert data["provenance_chain"]["final_ad_id"] == final_ad.id


@pytest.mark.asyncio
async def test_02_stale_final_rejection(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 2: Publishing a stale creative must be rejected with HTTP 400."""
    setup = await setup_approved_final_ad(test_db_session, is_stale=True)
    final_ad = setup["final_ad"]

    payload = {
        "final_ad_id": final_ad.id,
        "platform": "facebook",
        "caption": "Stale post test",
    }
    res = await client.post("/api/v1/publishing", json=payload)
    assert res.status_code == 400
    assert "stale" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_03_deterministic_qa_failure_rejection(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 3: Publishing a creative that failed deterministic final QA must be rejected."""
    setup = await setup_approved_final_ad(test_db_session, qa_status="FAIL")
    final_ad = setup["final_ad"]

    payload = {
        "final_ad_id": final_ad.id,
        "platform": "facebook",
        "caption": "Failed QA test",
    }
    res = await client.post("/api/v1/publishing", json=payload)
    assert res.status_code == 400
    assert "qa" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_04_missing_vision_verification_when_required(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 4: When Vision QA is enabled, unapproved vision status rejects publishing."""
    setup = await setup_approved_final_ad(test_db_session)
    final_ad = setup["final_ad"]
    final_ad.vision_qa_status = "FAIL"
    await test_db_session.commit()

    with patch("app.services.publishing_service.settings.ENABLE_VISION_QA", True):
        payload = {
            "final_ad_id": final_ad.id,
            "platform": "facebook",
            "caption": "Vision QA failed test",
        }
        res = await client.post("/api/v1/publishing", json=payload)
        assert res.status_code == 400
        assert "vision qa" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_05_unapproved_final_rejection(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 5: Creative whose upstream job is NOT FINAL_AD_APPROVED must be rejected."""
    setup = await setup_approved_final_ad(test_db_session, set_approved_job_status=False)
    final_ad = setup["final_ad"]

    payload = {
        "final_ad_id": final_ad.id,
        "platform": "facebook",
        "caption": "Unapproved job test",
    }
    res = await client.post("/api/v1/publishing", json=payload)
    assert res.status_code == 400
    assert "not approved" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_06_cross_tenant_publish_rejection(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 6: Cross-tenant creative access safely returns 404 to avoid enumeration."""
    # Create creative belonging to a different tenant
    other_tenant_id = "tenant-other-corp-999"
    other_tenant = Tenant(id=other_tenant_id, name="Other Corp", slug="other-corp")
    test_db_session.add(other_tenant)
    await test_db_session.commit()

    setup = await setup_approved_final_ad(test_db_session, tenant_id=other_tenant_id)
    final_ad = setup["final_ad"]

    # Active client is DEFAULT_TENANT_ID
    payload = {
        "final_ad_id": final_ad.id,
        "platform": "facebook",
        "caption": "Cross tenant attempt",
    }
    res = await client.post("/api/v1/publishing", json=payload)
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_07_platform_mismatch_rejection(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 7: Requesting to publish an Instagram creative to LinkedIn must be rejected."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.INSTAGRAM)
    final_ad = setup["final_ad"]

    payload = {
        "final_ad_id": final_ad.id,
        "platform": "linkedin",  # Mismatch: rendered for instagram
        "caption": "Platform mismatch test",
    }
    res = await client.post("/api/v1/publishing", json=payload)
    assert res.status_code == 400
    assert "mismatch" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_08_unsupported_platform_rejection(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 8: Requesting an unsupported platform (e.g. tiktok) must be rejected."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]

    payload = {
        "final_ad_id": final_ad.id,
        "platform": "tiktok",
        "caption": "Unsupported platform test",
    }
    res = await client.post("/api/v1/publishing", json=payload)
    assert res.status_code == 400
    assert "not supported" in res.json()["detail"].lower()


@pytest.mark.asyncio
async def test_09_missing_artifact_rejection(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 9: If creative storage artifact is missing from storage, reject with 400."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]
    final_ad.storage_key = "non_existent/path/artifact_does_not_exist.png"
    await test_db_session.commit()

    payload = {
        "final_ad_id": final_ad.id,
        "platform": "facebook",
        "caption": "Missing artifact test",
    }
    res = await client.post("/api/v1/publishing", json=payload)
    assert res.status_code == 400
    assert "storage artifact" in res.json()["detail"].lower()


# ==============================================================================
# TESTS 10 - 12: STATE MACHINE TRANSITIONS & RETRY
# ==============================================================================

def test_10_valid_publishing_state_transitions():
    """Matrix Item 10: Valid state transitions in PublishingRecord."""
    rec = PublishingRecord(
        id="pub-1",
        tenant_id=DEFAULT_TENANT_ID,
        final_ad_id="final-1",
        platform="facebook",
        status=PublishingStatus.PUBLISH_QUEUED.value,
        idempotency_key="key-1",
    )
    assert rec.status == PublishingStatus.PUBLISH_QUEUED.value

    rec.transition_to(PublishingStatus.PUBLISHING)
    assert rec.status == PublishingStatus.PUBLISHING.value
    assert rec.attempt_count == 1

    rec.transition_to(PublishingStatus.PUBLISHED)
    assert rec.status == PublishingStatus.PUBLISHED.value
    assert rec.published_at is not None


def test_11_invalid_state_transitions():
    """Matrix Item 11: Invalid transitions raise ValueError."""
    rec = PublishingRecord(
        id="pub-2",
        tenant_id=DEFAULT_TENANT_ID,
        final_ad_id="final-1",
        platform="facebook",
        status=PublishingStatus.PUBLISHED.value,
        idempotency_key="key-2",
    )
    # Published is terminal; cannot transition back to PUBLISHING or QUEUED
    with pytest.raises(ValueError, match="Invalid publishing transition"):
        rec.transition_to(PublishingStatus.PUBLISHING)

    rec_queued = PublishingRecord(
        id="pub-3",
        tenant_id=DEFAULT_TENANT_ID,
        final_ad_id="final-1",
        platform="facebook",
        status=PublishingStatus.PUBLISH_QUEUED.value,
        idempotency_key="key-3",
    )
    # Cannot jump directly from QUEUED to PUBLISHED without PUBLISHING
    with pytest.raises(ValueError, match="Invalid publishing transition"):
        rec_queued.transition_to(PublishingStatus.PUBLISHED)


@pytest.mark.asyncio
async def test_12_retry_behavior(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 12: PUBLISH_FAILED can be retried via /retry endpoint."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]

    # First attempt with failure simulation
    failing_provider = MockPublishingProvider(simulate_failure=True)
    req = PublishRequest(
        final_ad_id=final_ad.id,
        platform="facebook",
        caption="Retry test",
    )
    failed_rec = await PublishingService.create_and_publish(
        db=test_db_session,
        user=None,
        payload=req,
        target_tenant_id=DEFAULT_TENANT_ID,
        provider_override=failing_provider,
    )
    assert failed_rec.status == PublishingStatus.PUBLISH_FAILED.value
    assert failed_rec.error_code == "PLATFORM_REJECTED"

    # Now retry using client API
    res = await client.post(f"/api/v1/publishing/{failed_rec.id}/retry", json={"reason": "Retrying after fix"})
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["status"] == PublishingStatus.PUBLISHED.value
    assert data["external_post_id"] is not None


# ==============================================================================
# TESTS 13 - 17: IDEMPOTENCY & RECONCILIATION
# ==============================================================================

def test_13_deterministic_publishing_idempotency_key():
    """Matrix Item 13: Deterministic idempotency key calculation."""
    k1 = PublishingService.compute_idempotency_key(
        tenant_id="tenant-1",
        final_ad_id="ad-1",
        platform="facebook",
        caption="Hello world",
    )
    k2 = PublishingService.compute_idempotency_key(
        tenant_id="tenant-1",
        final_ad_id="ad-1",
        platform="facebook",
        caption="Hello world",
    )
    assert k1 == k2
    assert len(k1) == 64

    # Different caption produces different key
    k3 = PublishingService.compute_idempotency_key(
        tenant_id="tenant-1",
        final_ad_id="ad-1",
        platform="facebook",
        caption="Different caption",
    )
    assert k1 != k3


@pytest.mark.asyncio
async def test_14_duplicate_publish_request(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 14: Duplicate publish requests return the existing published record."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]

    payload = {
        "final_ad_id": final_ad.id,
        "platform": "facebook",
        "caption": "Duplicate publish test",
        "idempotency_key": "fixed-idempotency-key-001",
    }

    res1 = await client.post("/api/v1/publishing", json=payload)
    assert res1.status_code == 201
    data1 = res1.json()

    # Second request with identical payload/idempotency key
    res2 = await client.post("/api/v1/publishing", json=payload)
    assert res2.status_code in (200, 201)
    data2 = res2.json()

    assert data1["id"] == data2["id"]
    assert data1["external_post_id"] == data2["external_post_id"]


@pytest.mark.asyncio
async def test_15_worker_retry_after_ambiguous_external_result(test_db_session: AsyncSession):
    """Matrix Item 15: Worker recovery after ambiguous timeout where external post was created."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]

    # Provider simulates ambiguous timeout where post WAS created on external platform
    ambiguous_provider = MockPublishingProvider(
        simulate_timeout=True,
        simulate_ambiguous_post_creation=True,
    )

    req = PublishRequest(
        final_ad_id=final_ad.id,
        platform="facebook",
        caption="Ambiguous timeout test",
        idempotency_key="ambig-key-12345",
    )

    rec = await PublishingService.create_and_publish(
        db=test_db_session,
        user=None,
        payload=req,
        target_tenant_id=DEFAULT_TENANT_ID,
        provider_override=ambiguous_provider,
    )
    assert rec.status == PublishingStatus.PUBLISH_FAILED.value
    assert rec.error_code == "TIMEOUT"

    # Now runner retries: reconciliation pre-check detects post on provider registry!
    # Does NOT create a second duplicate post!
    ambiguous_provider.simulate_timeout = False
    recovered = await execute_publishing_record(rec.id, db=test_db_session, provider_override=ambiguous_provider)
    assert recovered.status == PublishingStatus.PUBLISHED.value
    assert recovered.external_post_id is not None


@pytest.mark.asyncio
async def test_16_reconciliation_endpoint(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 16: Reconciliation endpoint reconciles with provider registry."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]

    # Create a record in failed state
    idemp_key = "reconcile-test-key-555"
    mock_prov = MockPublishingProvider()
    # Seed provider registry as if external platform has the post
    mock_prov._published_registry[idemp_key] = {
        "external_post_id": "ext-facebook-seeded-post-1",
        "post_url": "https://mock.facebook.com/posts/ext-facebook-seeded-post-1",
        "platform": "facebook",
    }

    rec = PublishingRecord(
        tenant_id=DEFAULT_TENANT_ID,
        final_ad_id=final_ad.id,
        platform="facebook",
        status=PublishingStatus.PUBLISH_FAILED.value,
        idempotency_key=idemp_key,
        error_code="TIMEOUT",
    )
    test_db_session.add(rec)
    await test_db_session.commit()
    await test_db_session.refresh(rec)

    with patch("app.services.publishing_service.get_publishing_provider", return_value=mock_prov):
        res = await client.post(f"/api/v1/publishing/{rec.id}/reconcile")
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["reconciled"] is True
        assert data["current_status"] == PublishingStatus.PUBLISHED.value
        assert data["external_post_id"] == "ext-facebook-seeded-post-1"


@pytest.mark.asyncio
async def test_17_external_post_id_persistence(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 17: Verifies external post ID is safely stored in database."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]

    res = await client.post("/api/v1/publishing", json={
        "final_ad_id": final_ad.id,
        "platform": "facebook",
        "caption": "Post ID persistence check",
    })
    assert res.status_code == 201
    pub_id = res.json()["id"]

    # Directly query DB to verify persistence
    rec = await test_db_session.get(PublishingRecord, pub_id)
    assert rec is not None
    assert rec.status == PublishingStatus.PUBLISHED.value
    assert rec.external_post_id.startswith("ext-facebook-")
    assert rec.post_url.startswith("https://mock.facebook.com/posts/")


# ==============================================================================
# TESTS 18 - 21: PROVIDER ERRORS & SECURITY
# ==============================================================================

@pytest.mark.asyncio
async def test_18_provider_failure(test_db_session: AsyncSession):
    """Matrix Item 18: Provider API error sets PUBLISH_FAILED with code."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]

    failing_prov = MockPublishingProvider(simulate_failure=True)
    req = PublishRequest(
        final_ad_id=final_ad.id,
        platform="facebook",
        caption="Failing provider test",
    )
    rec = await PublishingService.create_and_publish(
        db=test_db_session,
        user=None,
        payload=req,
        target_tenant_id=DEFAULT_TENANT_ID,
        provider_override=failing_prov,
    )
    assert rec.status == PublishingStatus.PUBLISH_FAILED.value
    assert rec.error_code == "PLATFORM_REJECTED"
    assert rec.error_message is not None


@pytest.mark.asyncio
async def test_19_provider_timeout(test_db_session: AsyncSession):
    """Matrix Item 19: Provider timeout safely recorded as PUBLISH_FAILED."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]

    timeout_prov = MockPublishingProvider(simulate_timeout=True)
    req = PublishRequest(
        final_ad_id=final_ad.id,
        platform="facebook",
        caption="Timeout test",
    )
    rec = await PublishingService.create_and_publish(
        db=test_db_session,
        user=None,
        payload=req,
        target_tenant_id=DEFAULT_TENANT_ID,
        provider_override=timeout_prov,
    )
    assert rec.status == PublishingStatus.PUBLISH_FAILED.value
    assert rec.error_code == "TIMEOUT"


@pytest.mark.asyncio
async def test_20_provider_unavailable(test_db_session: AsyncSession):
    """Matrix Item 20: Provider exception safely caught without crash."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]

    unavail_prov = MockPublishingProvider(simulate_unavailable=True)
    req = PublishRequest(
        final_ad_id=final_ad.id,
        platform="facebook",
        caption="Unavailable test",
    )
    rec = await PublishingService.create_and_publish(
        db=test_db_session,
        user=None,
        payload=req,
        target_tenant_id=DEFAULT_TENANT_ID,
        provider_override=unavail_prov,
    )
    assert rec.status == PublishingStatus.PUBLISH_FAILED.value
    assert rec.error_code in ("PROVIDER_EXCEPTION", "UNEXPECTED_ERROR")


@pytest.mark.asyncio
async def test_21_token_secret_non_exposure(test_db_session: AsyncSession, client: AsyncClient):
    """Matrix Item 21: Publishing responses never expose tokens, secrets, or passwords."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]

    res = await client.post("/api/v1/publishing", json={
        "final_ad_id": final_ad.id,
        "platform": "facebook",
        "caption": "Privacy security check",
    })
    assert res.status_code == 201
    content_str = res.text.lower()

    for forbidden_key in ["access_token", "client_secret", "password", "private_key", "bearer_token"]:
        assert forbidden_key not in content_str


# ==============================================================================
# TESTS 22 - 25: WORKER PAYLOAD & CREATIVE IMMUTABILITY
# ==============================================================================

def test_22_celery_payload_contains_no_image_bytes():
    """Matrix Item 22: Celery task signature contains only IDs, zero image bytes."""
    sig = inspect.signature(process_publishing_stage)
    param_names = list(sig.parameters.keys())

    assert "publishing_record_id" in param_names
    assert "image_bytes" not in param_names
    assert "raw_bytes" not in param_names
    assert "asset_bytes" not in param_names


def test_23_celery_payload_contains_no_secrets():
    """Matrix Item 23: Celery task signature contains no access tokens or secrets."""
    sig = inspect.signature(process_publishing_stage)
    param_names = list(sig.parameters.keys())

    assert "token" not in param_names
    assert "secret" not in param_names
    assert "access_token" not in param_names


@pytest.mark.asyncio
async def test_24_publishing_cannot_mutate_final_rendered_creative_record(
    test_db_session: AsyncSession, client: AsyncClient
):
    """Matrix Item 24: Publishing must NEVER modify the approved creative."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]

    original_hash = final_ad.provenance_chain.get("output_hash")
    original_storage_key = final_ad.storage_key
    original_qa_status = final_ad.qa_status
    original_updated_at = final_ad.updated_at

    res = await client.post("/api/v1/publishing", json={
        "final_ad_id": final_ad.id,
        "platform": "facebook",
        "caption": "Immutability test",
    })
    assert res.status_code == 201

    await test_db_session.refresh(final_ad)
    assert final_ad.provenance_chain.get("output_hash") == original_hash
    assert final_ad.storage_key == original_storage_key
    assert final_ad.qa_status == original_qa_status
    assert final_ad.updated_at == original_updated_at


@pytest.mark.asyncio
async def test_25_publishing_references_exact_approved_final_artifact(
    test_db_session: AsyncSession, client: AsyncClient
):
    """Matrix Item 25: Publishing record maintains immutable provenance chain to exact approved artifact."""
    setup = await setup_approved_final_ad(test_db_session, platform=TargetPlatform.FACEBOOK)
    final_ad = setup["final_ad"]

    res = await client.post("/api/v1/publishing", json={
        "final_ad_id": final_ad.id,
        "platform": "facebook",
        "caption": "Exact artifact provenance test",
    })
    assert res.status_code == 201
    data = res.json()

    prov = data["provenance_chain"]
    assert prov["final_ad_id"] == final_ad.id
    assert prov["final_ad_storage_key"] == final_ad.storage_key
    assert prov["composite_id"] == final_ad.composite_id
    assert prov["background_id"] == final_ad.background_id
    assert prov["strategy_id"] == final_ad.strategy_id
    assert prov["brief_id"] == final_ad.brief_id
