"""
Phase 7.4 Adversarial Multi-Tenant Security & Isolation Test Suite.

Verifies:
1. Authentication: token validation, unauthenticated rejection, expired token rejection.
2. Tenant Membership: tenant header validation, member role checks, forbidden foreign tenants.
3. Strict Isolation: Tenant B receives safe 404 on Tenant A's briefs, strategies, backgrounds,
   composites, final ads, jobs, dispatch, and regeneration.
4. Storage Isolation: cross-tenant object access returns safe 404 without leaking existence.
5. Graph Consistency: cross-tenant resource linkages are strictly rejected.
6. Celery / Worker Security: authoritative DB tenant verification, rejection of spoofed payload tenant.
7. Production Security: failure of startup if development auth is enabled in production.
"""

import uuid
import pytest
import pytest_asyncio
from datetime import datetime, timezone, timedelta
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
import jwt

from app.core.config import settings
from app.core.auth import create_access_token
from app.models.auth import User, Tenant, Membership, TenantRole
from app.models.brief import AdBrief
from app.models.strategy import CreativeStrategyRecord
from app.models.job import CreativeJob, JobStatus
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.workers.job_runner import execute_job_stage
from app.providers.storage_keys import build_background_key, extract_tenant_from_storage_key
from app.providers.storage_provider import get_storage_provider


@pytest_asyncio.fixture
async def tenant_a_and_b(test_db_session: AsyncSession):
    """
    Sets up two isolated tenants:
    Tenant A: User A (Owner)
    Tenant B: User B (Member)
    """
    # Tenant A
    t_a = Tenant(id="tenant-alpha-001", name="Alpha Corp", slug="alpha-corp")
    u_a = User(id="user-alpha-001", email="alice@alpha.test", full_name="Alice Alpha")
    m_a = Membership(id="mem-alpha-001", user_id=u_a.id, tenant_id=t_a.id, role=TenantRole.OWNER.value)

    # Tenant B
    t_b = Tenant(id="tenant-beta-002", name="Beta LLC", slug="beta-llc")
    u_b = User(id="user-beta-002", email="bob@beta.test", full_name="Bob Beta")
    m_b = Membership(id="mem-beta-002", user_id=u_b.id, tenant_id=t_b.id, role=TenantRole.MEMBER.value)

    test_db_session.add_all([t_a, u_a, m_a, t_b, u_b, m_b])
    await test_db_session.commit()

    token_a = create_access_token(data={"sub": u_a.id, "email": u_a.email, "tenant_id": t_a.id})
    token_b = create_access_token(data={"sub": u_b.id, "email": u_b.email, "tenant_id": t_b.id})

    return {
        "tenant_a": t_a,
        "user_a": u_a,
        "token_a": token_a,
        "tenant_b": t_b,
        "user_b": u_b,
        "token_b": token_b,
    }


# =============================================================================
# 1. AUTHENTICATION TESTS
# =============================================================================

@pytest.mark.asyncio
async def test_unauthenticated_request_rejected(unauth_client: AsyncClient):
    """Unauthenticated requests to protected endpoints must be rejected with 401."""
    resp = await unauth_client.get("/api/v1/briefs")
    assert resp.status_code == 401
    assert "Authentication required" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_invalid_token_rejected(unauth_client: AsyncClient):
    """Requests with a forged or invalid JWT must return 401."""
    resp = await unauth_client.get(
        "/api/v1/briefs",
        headers={"Authorization": "Bearer invalid.jwt.token"},
    )
    assert resp.status_code == 401
    assert "Invalid authentication token" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_expired_token_rejected(unauth_client: AsyncClient):
    """Requests with an expired JWT must be rejected with 401."""
    expired_payload = {
        "sub": "user_expired",
        "email": "expired@test.local",
        "exp": datetime.now(timezone.utc) - timedelta(hours=1),
        "iat": datetime.now(timezone.utc) - timedelta(hours=2),
    }
    expired_token = jwt.encode(expired_payload, settings.AUTH_JWT_SECRET, algorithm="HS256")
    resp = await unauth_client.get(
        "/api/v1/briefs",
        headers={"Authorization": f"Bearer {expired_token}"},
    )
    assert resp.status_code == 401
    assert "expired" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_dev_login_returns_valid_token_and_tenant(unauth_client: AsyncClient, tenant_a_and_b):
    """Dev login returns a valid token with tenant memberships."""
    resp = await unauth_client.post(
        "/api/v1/auth/dev-login",
        json={"email": "alice@alpha.test"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["user"]["email"] == "alice@alpha.test"
    assert "tenant" in data
    assert data["role"] in ["OWNER", "MEMBER"]


# =============================================================================
# 2. TENANT AUTHORIZATION TESTS
# =============================================================================

@pytest.mark.asyncio
async def test_tenant_membership_required(unauth_client: AsyncClient, tenant_a_and_b):
    """User cannot spoof X-Tenant-ID header for an organization they don't belong to."""
    # Alice attempts to access Tenant B's namespace
    token_a = tenant_a_and_b["token_a"]
    resp = await unauth_client.get(
        "/api/v1/briefs",
        headers={
            "Authorization": f"Bearer {token_a}",
            "X-Tenant-ID": "tenant-beta-002",
        },
    )
    assert resp.status_code == 403
    assert "not authorized" in resp.json()["detail"].lower()


@pytest_asyncio.fixture
async def tenant_a_pipeline(test_db_session: AsyncSession, tenant_a_and_b):
    """Creates a full valid creative pipeline owned by Tenant A."""
    t_a = tenant_a_and_b["tenant_a"]

    brief_a = AdBrief(
        id="brief-alpha-001",
        tenant_id=t_a.id,
        brand_name="AlphaBrand",
        product_name="AlphaWatch",
        price=199.99,
        platforms=["instagram"],
        validation_status="PASS",
        payload={"brand": {"name": "AlphaBrand"}, "product": {"name": "AlphaWatch"}},
    )
    strat_a = CreativeStrategyRecord(
        id="strat-alpha-001",
        tenant_id=t_a.id,
        brief_id=brief_a.id,
        version_number=1,
        status="APPROVED",
        template_id="bold_commercial",
        strategy_spec={"template_id": "bold_commercial"},
        claim_validation_report={"status": "PASS", "claims": []},
    )
    job_a = CreativeJob(
        id="job-alpha-001",
        tenant_id=t_a.id,
        brief_id=brief_a.id,
        strategy_id=strat_a.id,
        status=JobStatus.STRATEGY_VALIDATED.value,
        current_stage="Strategy Validated",
        progress_pct=40,
    )
    bg_a = GeneratedBackgroundRecord(
        id="bg-alpha-001",
        tenant_id=t_a.id,
        job_id=job_a.id,
        strategy_id=strat_a.id,
        brief_id=brief_a.id,
        platform="instagram",
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        provider="mock",
        model_name="mock-model",
        prompt_spec={"scene": "tabletop"},
        prompt_version="v1.0",
        storage_key=f"tenants/{t_a.id}/backgrounds/{job_a.id}/instagram_attempt_1.png",
        qa_status="PASS",
        qa_result={"status": "PASS", "score": 1.0, "issues": [], "warnings": []},
        attempt_number=1,
    )
    comp_a = CompositedCreativeRecord(
        id="comp-alpha-001",
        tenant_id=t_a.id,
        job_id=job_a.id,
        strategy_id=strat_a.id,
        brief_id=brief_a.id,
        background_id=bg_a.id,
        platform="instagram",
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key=f"tenants/{t_a.id}/composites/{job_a.id}/instagram/composite_attempt_1.png",
        placement_spec={"product_x": 0.5, "product_y": 0.5},
        shadow_spec={"enabled": True},
        integrity_metadata={"hash": "mock"},
        qa_status="PASS",
        qa_result={"status": "PASS", "overall_score": 1.0, "issues": [], "warnings": []},
        attempt_number=1,
    )
    final_a = FinalRenderedCreativeRecord(
        id="final-alpha-001",
        tenant_id=t_a.id,
        job_id=job_a.id,
        strategy_id=strat_a.id,
        brief_id=brief_a.id,
        background_id=bg_a.id,
        composite_id=comp_a.id,
        platform="instagram",
        width=1080,
        height=1350,
        aspect_ratio="4:5",
        storage_key=f"tenants/{t_a.id}/final_ads/{job_a.id}/instagram/final_ad_attempt_1.png",
        copy_spec={"headline": "Alpha Smartwatch"},
        typography_spec={"headline_font": "Inter"},
        cta_spec={"style": {}},
        readability_spec={"contrast_ratio": 4.5},
        provenance_chain={},
        qa_status="FINAL_AD_APPROVED",
        qa_result={"status": "FINAL_AD_APPROVED", "overall_score": 1.0, "issues": [], "warnings": []},
        attempt_number=1,
    )

    test_db_session.add_all([brief_a, strat_a, job_a, bg_a, comp_a, final_a])
    await test_db_session.commit()

    return {
        "brief": brief_a,
        "strategy": strat_a,
        "job": job_a,
        "background": bg_a,
        "composite": comp_a,
        "final_ad": final_a,
    }


# =============================================================================
# 3. CROSS-TENANT ISOLATION TESTS (ADVERSARIAL SUITE)
# =============================================================================

@pytest.mark.asyncio
async def test_cross_tenant_brief_isolation(unauth_client: AsyncClient, tenant_a_and_b, tenant_a_pipeline):
    """Tenant B cannot read or list Tenant A's briefs."""
    token_b = tenant_a_and_b["token_b"]
    brief_a = tenant_a_pipeline["brief"]

    # Tenant B tries to get Tenant A's brief by ID
    resp = await unauth_client.get(
        f"/api/v1/briefs/{brief_a.id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert resp.status_code == 404

    # Tenant B lists briefs: must not see Tenant A's brief
    list_resp = await unauth_client.get(
        "/api/v1/briefs",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert list_resp.status_code == 200
    brief_ids = [b["id"] for b in list_resp.json()]
    assert brief_a.id not in brief_ids


@pytest.mark.asyncio
async def test_cross_tenant_strategy_isolation(unauth_client: AsyncClient, tenant_a_and_b, tenant_a_pipeline):
    """Tenant B cannot read Tenant A's creative strategy."""
    token_b = tenant_a_and_b["token_b"]
    strat_a = tenant_a_pipeline["strategy"]

    resp = await unauth_client.get(
        f"/api/v1/strategies/{strat_a.id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_cross_tenant_job_status_and_dispatch_isolation(unauth_client: AsyncClient, tenant_a_and_b, tenant_a_pipeline):
    """Tenant B cannot inspect or dispatch Tenant A's creative jobs."""
    token_b = tenant_a_and_b["token_b"]
    job_a = tenant_a_pipeline["job"]

    # Status check
    status_resp = await unauth_client.get(
        f"/api/v1/jobs/{job_a.id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert status_resp.status_code == 404

    # Dispatch attempt
    dispatch_resp = await unauth_client.post(
        f"/api/v1/jobs/{job_a.id}/dispatch",
        json={"stage": "BACKGROUND"},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert dispatch_resp.status_code == 404


@pytest.mark.asyncio
async def test_cross_tenant_background_isolation(unauth_client: AsyncClient, tenant_a_and_b, tenant_a_pipeline):
    """Tenant B cannot read or regenerate Tenant A's background."""
    token_b = tenant_a_and_b["token_b"]
    bg_a = tenant_a_pipeline["background"]

    # Read
    get_resp = await unauth_client.get(
        f"/api/v1/backgrounds/{bg_a.id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert get_resp.status_code == 404

    # Regenerate
    regen_resp = await unauth_client.post(
        f"/api/v1/backgrounds/{bg_a.id}/regenerate",
        json={"custom_feedback": "Warmer tones"},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert regen_resp.status_code == 404


@pytest.mark.asyncio
async def test_cross_tenant_composite_isolation(unauth_client: AsyncClient, tenant_a_and_b, tenant_a_pipeline):
    """Tenant B cannot read or regenerate Tenant A's composite."""
    token_b = tenant_a_and_b["token_b"]
    comp_a = tenant_a_pipeline["composite"]

    # Read
    get_resp = await unauth_client.get(
        f"/api/v1/composites/{comp_a.id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert get_resp.status_code == 404

    # Regenerate
    regen_resp = await unauth_client.post(
        f"/api/v1/composites/{comp_a.id}/regenerate",
        json={},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert regen_resp.status_code == 404


@pytest.mark.asyncio
async def test_cross_tenant_final_ad_isolation(unauth_client: AsyncClient, tenant_a_and_b, tenant_a_pipeline):
    """Tenant B cannot read or regenerate Tenant A's final ad."""
    token_b = tenant_a_and_b["token_b"]
    final_a = tenant_a_pipeline["final_ad"]

    # Read
    get_resp = await unauth_client.get(
        f"/api/v1/final-ads/{final_a.id}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert get_resp.status_code == 404

    # Regenerate
    regen_resp = await unauth_client.post(
        f"/api/v1/final-ads/{final_a.id}/regenerate",
        json={},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert regen_resp.status_code == 404


# =============================================================================
# 4. STORAGE ISOLATION TESTS
# =============================================================================

@pytest.mark.asyncio
async def test_storage_object_tenant_isolation(unauth_client: AsyncClient, tenant_a_and_b):
    """Tenant B cannot download Tenant A's storage objects."""
    t_a = tenant_a_and_b["tenant_a"]
    token_b = tenant_a_and_b["token_b"]
    token_a = tenant_a_and_b["token_a"]

    storage = get_storage_provider()
    alpha_key = f"tenants/{t_a.id}/backgrounds/job-alpha-001/instagram_attempt_1.png"
    await storage.save_bytes(b"\x89PNG\r\n\x1a\nfakeimagebytes", alpha_key, content_type="image/png")

    # Tenant A can access its own storage object
    resp_a = await unauth_client.get(
        f"/api/v1/storage/{alpha_key}",
        headers={"Authorization": f"Bearer {token_a}"},
    )
    assert resp_a.status_code == 200

    # Tenant B is rejected with safe 404
    resp_b = await unauth_client.get(
        f"/api/v1/storage/{alpha_key}",
        headers={"Authorization": f"Bearer {token_b}"},
    )
    assert resp_b.status_code == 404
    assert "not found" in resp_b.json()["detail"].lower()


def test_storage_key_builders_include_tenant_namespace():
    """Verify storage key builder functions strictly isolate by tenant."""
    key = build_background_key(job_id="job_99", platform="instagram", attempt=1, tenant_id="tenant-xyz")
    assert key.startswith("tenants/tenant-xyz/backgrounds/job_99/")
    assert extract_tenant_from_storage_key(key) == "tenant-xyz"


# =============================================================================
# 5. GRAPH INTEGRITY & CROSS-TENANT DEFENSE
# =============================================================================

@pytest.mark.asyncio
async def test_cross_tenant_job_brief_rejected(test_db_session: AsyncSession, tenant_a_and_b):
    """Creative pipeline rejects inconsistent cross-tenant graphs."""
    t_a = tenant_a_and_b["tenant_a"]
    t_b = tenant_a_and_b["tenant_b"]

    brief_a = AdBrief(
        id=str(uuid.uuid4()),
        tenant_id=t_a.id,
        brand_name="Brand A",
        product_name="Product A",
        price=199.99,
        platforms=["instagram"],
        validation_status="PASS",
        payload={"brand": {"name": "Brand A"}},
    )
    test_db_session.add(brief_a)
    await test_db_session.commit()

    # Attempt to create job for Tenant B referencing Tenant A's brief
    job_b = CreativeJob(
        id=str(uuid.uuid4()),
        tenant_id=t_b.id,
        brief_id=brief_a.id,
        status=JobStatus.RECEIVED.value,
    )
    test_db_session.add(job_b)
    await test_db_session.commit()

    # Dispatching or processing this invalid graph must fail
    with pytest.raises(Exception):
        await execute_job_stage(job_id=job_b.id, stage="BACKGROUND", db=test_db_session)


# =============================================================================
# 6. CELERY & WORKER TENANT SECURITY
# =============================================================================

@pytest.mark.asyncio
async def test_worker_rejects_spoofed_tenant_in_payload(test_db_session: AsyncSession, tenant_a_and_b, tenant_a_pipeline):
    """Worker derives tenant from authoritative DB record and rejects forged payload tenant."""
    job_a = tenant_a_pipeline["job"]

    # Forged tenant in params
    with pytest.raises(ValueError, match="Tenant spoofing detected"):
        await execute_job_stage(
            job_id=job_a.id,
            stage="BACKGROUND",
            params={"tenant_id": "forged-tenant-666"},
            db=test_db_session,
        )


@pytest.mark.asyncio
async def test_worker_rejects_cross_tenant_intermediate_resource(test_db_session: AsyncSession, tenant_a_and_b, tenant_a_pipeline):
    """Worker rejects processing when composite references a background from another tenant."""
    t_b = tenant_a_and_b["tenant_b"]
    job_a = tenant_a_pipeline["job"]

    # Valid Tenant B hierarchy
    brief_b = AdBrief(
        id=str(uuid.uuid4()),
        tenant_id=t_b.id,
        brand_name="Brand B",
        product_name="Product B",
        price=99.99,
        platforms=["instagram"],
        validation_status="PASS",
        payload={"brand": {"name": "Brand B"}},
    )
    strat_b = CreativeStrategyRecord(
        id=str(uuid.uuid4()),
        tenant_id=t_b.id,
        brief_id=brief_b.id,
        version_number=1,
        status="APPROVED",
        template_id="bold_commercial",
        strategy_spec={"template_id": "bold_commercial"},
        claim_validation_report={"status": "PASS", "claims": []},
    )
    job_b = CreativeJob(
        id=str(uuid.uuid4()),
        tenant_id=t_b.id,
        brief_id=brief_b.id,
        strategy_id=strat_b.id,
        status=JobStatus.STRATEGY_VALIDATED.value,
    )
    bg_b = GeneratedBackgroundRecord(
        id=str(uuid.uuid4()),
        tenant_id=t_b.id,
        job_id=job_b.id,
        strategy_id=strat_b.id,
        brief_id=brief_b.id,
        platform="instagram",
        width=1080,
        height=1080,
        aspect_ratio="1:1",
        provider="mock",
        model_name="mock-model",
        prompt_spec={"scene": "tabletop"},
        prompt_version="v1.0",
        storage_key="mock.png",
        qa_status="PASS",
        qa_result={"status": "PASS", "score": 1.0, "issues": [], "warnings": []},
    )
    test_db_session.add_all([brief_b, strat_b, job_b, bg_b])
    await test_db_session.commit()

    # Stage execution for Job A attempting to use Tenant B's background
    with pytest.raises(ValueError, match="Referenced background belongs to another tenant"):
        await execute_job_stage(
            job_id=job_a.id,
            stage="COMPOSITE",
            params={"background_id": bg_b.id},
            db=test_db_session,
        )


# =============================================================================
# 7. PRODUCTION SECURITY CONFIGURATION
# =============================================================================

def test_production_forbids_dev_auth():
    """In production environment, ENABLE_DEV_AUTH=True must raise a validation error."""
    from app.core.config import Settings

    with pytest.raises(ValueError, match="Development authentication is strictly forbidden in production"):
        Settings(
            ENVIRONMENT="production",
            DATABASE_URL="postgresql+asyncpg://prod_user:prod_pass@prod.db:5432/prod_db",
            POSTGRES_USER="prod_user",
            POSTGRES_PASSWORD="prod_password",
            POSTGRES_SERVER="prod.db.internal",
            POSTGRES_DB="prod_db",
            STORAGE_TYPE="s3",
            S3_BUCKET="prod-bucket",
            S3_ACCESS_KEY_ID="prod-key",
            S3_SECRET_ACCESS_KEY="prod-secret",
            REDIS_URL="redis://prod.redis.internal:6379/0",
            WORKER_TYPE="celery",
            AUTH_JWT_SECRET="super-secure-production-jwt-secret-minimum-32-chars",
            ENABLE_DEV_AUTH=True,  # VIOLATION!
        )
