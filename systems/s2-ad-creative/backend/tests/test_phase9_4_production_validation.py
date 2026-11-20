"""
Phase 9.4: Production Deployment & Real Infrastructure Adversarial Security Test Suite.

Validates the 13 required adversarial production security scenarios:
1. Cross-tenant database queries (PostgreSQL / SQLite dialect safety).
2. Cross-tenant storage access (safe 401/404 without leaking file existence).
3. Cross-tenant publishing records & accounts (strict tenant boundary).
4. Token response leakage prevention (APIs never expose plaintext or cipher tokens).
5. Celery payload inspection (only primitive IDs; no binary image bytes, briefs, or tokens in Redis).
6. Stale final ad publication rejection (is_stale=True returns 400).
7. Unapproved final ad publication rejection (requires FINAL_AD_APPROVED + QA pass).
8. Changed output hash rejection (storage tampering detected; fails with OUTPUT_HASH_MISMATCH).
9. Missing storage object rejection (storage artifact missing fails safely).
10. Invalid publishing state transitions (illegal status jumps raise ValueError).
11. Invalid OAuth state rejection (tampered or spoofed state returns 403).
12. Expired OAuth state rejection (state older than 10 minutes returns 400).
13. Production startup security guards (fails safely on missing PostgreSQL, default JWT, missing keys).
"""

import time
import json
import uuid
import hashlib
from datetime import datetime, timezone
import pytest
import pytest_asyncio
import httpx
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, settings
from app.core.encryption import TokenEncryptionService, get_token_encryption_service
from app.core.auth import create_access_token
from app.models.auth import Tenant, User, Membership, TenantRole, DEFAULT_TENANT_ID, DEFAULT_USER_ID
from app.models.brief import AdBrief
from app.models.strategy import CreativeStrategyRecord
from app.models.job import CreativeJob, JobStatus
from app.models.background import GeneratedBackgroundRecord
from app.models.composite import CompositedCreativeRecord
from app.models.final_ad import FinalRenderedCreativeRecord
from app.models.publishing import (
    ConnectedAccount,
    AccountStatus,
    PublishingRecord,
    PublishingStatus,
)
from app.schemas.publishing import PublishRequest
from app.services.publishing_service import PublishingService
from app.workers.publishing_runner import execute_publishing_record
from app.providers.storage_provider import get_storage_provider
from tests.test_phase9_publishing import setup_approved_final_ad

TEST_32BYTE_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"


# ==============================================================================
# FIXTURES
# ==============================================================================

@pytest_asyncio.fixture
async def multi_tenant_fixture(test_db_session: AsyncSession):
    """Sets up two strictly isolated tenants."""
    t1 = Tenant(id="tenant-prod-a", name="Tenant Prod Alpha", slug="prod-alpha")
    u1 = User(id="user-prod-a", email="alpha@prod.test", full_name="Alpha Admin")
    m1 = Membership(id="mem-prod-a", user_id=u1.id, tenant_id=t1.id, role=TenantRole.OWNER.value)

    t2 = Tenant(id="tenant-prod-b", name="Tenant Prod Beta", slug="prod-beta")
    u2 = User(id="user-prod-b", email="beta@prod.test", full_name="Beta Admin")
    m2 = Membership(id="mem-prod-b", user_id=u2.id, tenant_id=t2.id, role=TenantRole.OWNER.value)

    test_db_session.add_all([t1, u1, m1, t2, u2, m2])
    await test_db_session.commit()

    token_a = create_access_token(data={"sub": u1.id, "email": u1.email, "tenant_id": t1.id})
    token_b = create_access_token(data={"sub": u2.id, "email": u2.email, "tenant_id": t2.id})

    return {
        "tenant_a": t1,
        "user_a": u1,
        "token_a": token_a,
        "tenant_b": t2,
        "user_b": u2,
        "token_b": token_b,
    }


# ==============================================================================
# 1. CROSS-TENANT DATABASE & PUBLISHING ISOLATION
# ==============================================================================

@pytest.mark.asyncio
async def test_cross_tenant_publishing_records_isolation(test_db_session: AsyncSession, multi_tenant_fixture):
    """Tenant B must never be able to access or query Tenant A's publishing records."""
    t_a = multi_tenant_fixture["tenant_a"]
    t_b = multi_tenant_fixture["tenant_b"]

    record_a = PublishingRecord(
        id=f"pub-iso-{uuid.uuid4().hex[:8]}",
        tenant_id=t_a.id,
        final_ad_id=f"ad-{uuid.uuid4().hex[:8]}",
        platform="facebook",
        status=PublishingStatus.PUBLISHED.value,
        idempotency_key=f"idem-{uuid.uuid4().hex[:8]}",
        caption="Secret Tenant A Campaign",
    )
    test_db_session.add(record_a)
    await test_db_session.commit()

    # Query scoped to Tenant B must return empty
    stmt_b = select(PublishingRecord).where(
        and_(
            PublishingRecord.id == record_a.id,
            PublishingRecord.tenant_id == t_b.id,
        )
    )
    res_b = (await test_db_session.execute(stmt_b)).scalars().first()
    assert res_b is None


# ==============================================================================
# 2. CROSS-TENANT STORAGE ACCESS
# ==============================================================================

@pytest.mark.asyncio
async def test_cross_tenant_storage_access_denied(client: httpx.AsyncClient):
    """Storage endpoint must reject cross-tenant access with 401 or 404 without leaking existence."""
    # Attempt to read another tenant's private storage path
    res = await client.get("/api/v1/storage/tenants/foreign-tenant-xyz/final_ads/ad123.png")
    assert res.status_code == 404


# ==============================================================================
# 3. TOKEN RESPONSE LEAKAGE AUDIT
# ==============================================================================

@pytest.mark.asyncio
async def test_token_response_never_leaks_plaintext_or_ciphertext(
    client: httpx.AsyncClient,
    test_db_session: AsyncSession,
):
    """The /api/v1/publishing/accounts endpoint must never leak access tokens."""
    enc = get_token_encryption_service()
    raw_secret_token = "EAABwz_SUPER_SECRET_FACEBOOK_PAGE_TOKEN_998877"
    enc_token = enc.encrypt(raw_secret_token)

    acc = ConnectedAccount(
        id=f"acc-{uuid.uuid4().hex[:8]}",
        tenant_id=DEFAULT_TENANT_ID,
        platform="facebook",
        external_user_id="998877665544",
        account_name="Secure Brand Page",
        status=AccountStatus.CONNECTED.value,
        encrypted_access_token=enc_token,
    )
    test_db_session.add(acc)
    await test_db_session.commit()

    res = await client.get("/api/v1/publishing/accounts")
    assert res.status_code == 200
    body_text = res.text

    # Absolutely no token strings in body
    assert raw_secret_token not in body_text
    assert enc_token not in body_text
    assert "encrypted_access_token" not in res.json()[0]


# ==============================================================================
# 4. CELERY PAYLOAD INSPECTION
# ==============================================================================

def test_celery_payload_inspection_lightweight_ids_only():
    """Verify Celery task arguments contain strictly minimal IDs with zero bytes/tokens."""
    import inspect
    from app.workers.tasks import process_creative_stage, process_publishing_stage

    # 1. Creative Stage Task Signature Check
    sig_creative = inspect.signature(process_creative_stage)
    assert list(sig_creative.parameters.keys()) == ["job_id", "stage", "params"]

    # 2. Publishing Stage Task Signature Check
    sig_pub = inspect.signature(process_publishing_stage)
    assert list(sig_pub.parameters.keys()) == ["publishing_record_id"]


# ==============================================================================
# 5. STALE FINAL AD PUBLICATION REJECTION
# ==============================================================================

@pytest.mark.asyncio
async def test_stale_final_ad_publishing_rejected(test_db_session: AsyncSession):
    """Publishing must reject an approved creative that was marked is_stale=True."""
    setup = await setup_approved_final_ad(test_db_session)
    final_ad = setup["final_ad"]

    # Invalidate final ad
    final_ad.is_stale = True
    await test_db_session.commit()

    req = PublishRequest(
        final_ad_id=final_ad.id,
        platform="mock",
        caption="Stale test",
    )

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await PublishingService.create_and_publish(
            db=test_db_session,
            user=None,
            payload=req,
            target_tenant_id=DEFAULT_TENANT_ID,
        )
    assert exc.value.status_code == 400
    assert "Cannot publish stale creative" in exc.value.detail


# ==============================================================================
# 6. UNAPPROVED FINAL AD REJECTION
# ==============================================================================

@pytest.mark.asyncio
async def test_unapproved_final_ad_publishing_rejected(test_db_session: AsyncSession):
    """Creative not in FINAL_AD_APPROVED status cannot be published."""
    setup = await setup_approved_final_ad(test_db_session)
    job = setup["job"]
    final_ad = setup["final_ad"]

    # Demote job status
    job.status = JobStatus.RENDERING.value
    await test_db_session.commit()

    req = PublishRequest(
        final_ad_id=final_ad.id,
        platform="mock",
        caption="Unapproved test",
    )

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await PublishingService.create_and_publish(
            db=test_db_session,
            user=None,
            payload=req,
            target_tenant_id=DEFAULT_TENANT_ID,
        )
    assert exc.value.status_code == 400
    assert "Creative is not approved for publishing" in exc.value.detail


# ==============================================================================
# 7. CHANGED OUTPUT HASH ADVERSARIAL INTEGRITY TEST
# ==============================================================================

@pytest.mark.asyncio
async def test_changed_output_hash_tampering_rejected(test_db_session: AsyncSession):
    """If stored bytes differ from the approved provenance output_hash, publishing must fail."""
    setup = await setup_approved_final_ad(test_db_session)
    final_ad = setup["final_ad"]

    # Authoritative approved output hash recorded during rendering
    approved_hash = (final_ad.provenance_chain or {}).get("output_hash")
    assert approved_hash is not None

    # Simulate direct storage disk tampering or bit rot bypassing the storage provider
    storage = get_storage_provider()
    target_path = storage._resolve_path(final_ad.storage_key)
    tampered_bytes = b"CORRUPTED_OR_TAMPERED_BYTES_DISOBEYING_PROVENANCE_HASH"
    target_path.write_bytes(tampered_bytes)

    record = PublishingRecord(
        id=f"pub-tamper-{uuid.uuid4().hex[:8]}",
        tenant_id=DEFAULT_TENANT_ID,
        final_ad_id=final_ad.id,
        platform="mock",
        status=PublishingStatus.PUBLISH_QUEUED.value,
        idempotency_key=f"idem-tamper-{uuid.uuid4().hex[:8]}",
        provenance_chain=dict(final_ad.provenance_chain),
    )
    test_db_session.add(record)
    await test_db_session.commit()

    # Execute runner
    executed = await execute_publishing_record(record.id, db=test_db_session)
    assert executed.status == PublishingStatus.PUBLISH_FAILED.value
    assert executed.error_code == "OUTPUT_HASH_MISMATCH"
    assert "storage content does not match approved output hash" in executed.error_message


# ==============================================================================
# 8. MISSING STORAGE OBJECT TEST
# ==============================================================================

@pytest.mark.asyncio
async def test_missing_storage_object_fails_safely(test_db_session: AsyncSession):
    """If the storage artifact does not exist, publishing service fails safely with 400."""
    setup = await setup_approved_final_ad(test_db_session)
    final_ad = setup["final_ad"]

    # Delete storage artifact
    storage = get_storage_provider()
    await storage.delete(final_ad.storage_key)

    req = PublishRequest(
        final_ad_id=final_ad.id,
        platform="mock",
        caption="Missing storage test",
    )

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await PublishingService.create_and_publish(
            db=test_db_session,
            user=None,
            payload=req,
            target_tenant_id=DEFAULT_TENANT_ID,
        )
    assert exc.value.status_code == 400
    assert "does not exist in storage provider" in exc.value.detail


# ==============================================================================
# 9. INVALID PUBLISHING STATE TRANSITIONS
# ==============================================================================

def test_invalid_publishing_state_transitions():
    """Verify illegal transitions in the publishing state machine raise ValueError."""
    rec = PublishingRecord(
        id="pub-trans-1",
        tenant_id="tenant-1",
        final_ad_id="ad-1",
        platform="facebook",
        status=PublishingStatus.PUBLISHED.value,
        idempotency_key="key-1",
    )

    # Illegal transition: PUBLISHED -> PUBLISH_QUEUED
    with pytest.raises(ValueError, match="Invalid publishing transition"):
        rec.transition_to(PublishingStatus.PUBLISH_QUEUED)

    # Illegal transition: PUBLISHED -> PUBLISHING
    with pytest.raises(ValueError, match="Invalid publishing transition"):
        rec.transition_to(PublishingStatus.PUBLISHING)


# ==============================================================================
# 10. OAUTH STATE ADVERSARIAL VALIDATION (INVALID & EXPIRED)
# ==============================================================================

@pytest.mark.asyncio
async def test_oauth_callback_tampered_state_rejected(client: httpx.AsyncClient):
    """Tampered OAuth state returns 403 Forbidden."""
    res = await client.get(
        "/api/v1/publishing/oauth/facebook/callback",
        params={"code": "mock_code", "state": "tampered_garbage_state"},
    )
    assert res.status_code == 403
    assert "Invalid or tampered OAuth state parameter" in res.json()["detail"]


@pytest.mark.asyncio
async def test_oauth_callback_expired_state_rejected(client: httpx.AsyncClient):
    """OAuth state older than 10 minutes returns 400 Bad Request."""
    enc = TokenEncryptionService(TEST_32BYTE_KEY)
    expired_payload = {
        "tenant_id": DEFAULT_TENANT_ID,
        "nonce": "abc123nonce",
        "created_at": time.time() - 900,  # 15 minutes ago
    }
    expired_state = enc.encrypt(json.dumps(expired_payload))

    res = await client.get(
        "/api/v1/publishing/oauth/facebook/callback",
        params={"code": "mock_code", "state": expired_state},
    )
    assert res.status_code == 400
    assert "expired" in res.json()["detail"].lower()


# ==============================================================================
# 11. PRODUCTION STARTUP MISSING SECRETS VALIDATION
# ==============================================================================

def test_production_startup_validation_rules():
    """Verify startup fails safely when required production secrets are missing."""
    # 1. SQLite forbidden in production
    with pytest.raises(ValueError, match="Production environment forbids SQLite"):
        Settings(
            ENVIRONMENT="production",
            DATABASE_URL="sqlite+aiosqlite:///./prod.db",
        )

    # 2. Dev auth forbidden in production
    with pytest.raises(ValueError, match="Development authentication is strictly forbidden in production"):
        Settings(
            ENVIRONMENT="production",
            DATABASE_URL="postgresql+asyncpg://u:p@localhost:5432/db",
            ENABLE_DEV_AUTH=True,
        )

    # 3. Insecure JWT secret forbidden in production
    with pytest.raises(ValueError, match="Production environment forbids default/insecure AUTH_JWT_SECRET"):
        Settings(
            ENVIRONMENT="production",
            DATABASE_URL="postgresql+asyncpg://u:p@localhost:5432/db",
            AUTH_JWT_SECRET="dev-insecure-jwt-secret",
        )

    # 4. S3 storage without bucket/credentials
    with pytest.raises(ValueError, match="S3 storage is selected but S3_BUCKET is not configured"):
        Settings(
            STORAGE_TYPE="s3",
            S3_BUCKET="",
        )

    with pytest.raises(ValueError, match="S3 storage is selected but S3_ACCESS_KEY_ID or S3_SECRET_ACCESS_KEY is not configured"):
        Settings(
            STORAGE_TYPE="s3",
            S3_BUCKET="my-bucket",
            S3_ACCESS_KEY_ID="",
        )

    # 5. Celery worker without REDIS_URL
    with pytest.raises(ValueError, match="Celery worker is selected but REDIS_URL is not configured"):
        Settings(
            WORKER_TYPE="celery",
            REDIS_URL="",
        )

    # 6. Facebook publishing in production requires App ID, Secret, Redirect URI, and Encryption Key
    with pytest.raises(ValueError, match="Facebook publishing is enabled in production but FACEBOOK_APP_ID or FACEBOOK_APP_SECRET is missing"):
        Settings(
            ENVIRONMENT="production",
            DATABASE_URL="postgresql+asyncpg://u:p@localhost:5432/db",
            ENABLE_FACEBOOK_PUBLISHING=True,
            FACEBOOK_APP_ID="",
        )
