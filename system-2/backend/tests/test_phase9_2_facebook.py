"""
Phase 9.2: Facebook Page Publishing Integration Test Suite.
Validates:
1. TokenEncryptionService (AES-256-GCM authenticated encryption at rest).
2. Facebook OAuth Flow (secure state, CSRF prevention, code exchange, page selection).
3. ConnectedAccount Model & Tenant Isolation (zero secrets exposed).
4. FacebookPublishingProvider (multipart binary upload, media immutability, header parsing).
5. Idempotency & Crash Recovery (read-after-timeout reconciliation).
6. Error Taxonomy & Rate Limiting (RETRY, RECONCILE, REAUTHENTICATE, DO_NOT_RETRY, BLOCK).
7. Token Expiration & Reauthentication Lifecycle.
8. Creative Immutability.
9. Configuration Validation & Safe Defaults.
10. Explicit Opt-in Boundary for Live Meta API.
"""

import os
import io
import time
import json
import uuid
import secrets
import hashlib
import logging
from datetime import datetime, timezone, timedelta
import pytest
import pytest_asyncio
import httpx
from unittest.mock import patch, MagicMock
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings, Settings
from app.core.encryption import TokenEncryptionService, get_token_encryption_service
from app.models.auth import DEFAULT_TENANT_ID, DEFAULT_USER_ID, Tenant, User
from app.models.publishing import (
    ConnectedAccount,
    AccountStatus,
    PublishingRecord,
    PublishingStatus,
)
from app.schemas.publishing import (
    PublishRequest,
    ConnectedAccountResponse,
    FacebookPageSelectRequest,
)
from app.publishing.providers.base import (
    PublishingProviderResult,
    PublishingActionClass,
)
from app.publishing.providers.facebook import (
    FacebookPublishingProvider,
    GRAPH_API_BASE,
)
from app.publishing.providers.factory import get_publishing_provider
from app.publishing.capability_registry import PublishingCapabilityRegistry
from app.services.publishing_service import PublishingService
from app.workers.publishing_runner import execute_publishing_record
from app.workers.tasks import process_publishing_stage
from app.api.v1.facebook_oauth import get_oauth_http_client
from tests.test_phase9_publishing import setup_approved_final_ad


TEST_32BYTE_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
TEST_ALT_32BYTE_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210"


# ==============================================================================
# Helper to create a connected account with encrypted token
# ==============================================================================

async def create_test_facebook_account(
    session: AsyncSession,
    tenant_id: str = DEFAULT_TENANT_ID,
    page_id: str = "109876543210",
    page_name: str = "Test Brand Page",
    raw_token: str = "EAABtest_mock_page_access_token_12345",
    status: AccountStatus = AccountStatus.CONNECTED,
    token_expires_at: datetime = None,
) -> ConnectedAccount:
    enc_service = TokenEncryptionService(TEST_32BYTE_KEY)
    encrypted_token = enc_service.encrypt(raw_token)
    account = ConnectedAccount(
        tenant_id=tenant_id,
        platform="facebook",
        external_user_id=page_id,
        account_name=page_name,
        status=status.value,
        encrypted_access_token=encrypted_token,
        token_type="Bearer",
        scopes=["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
        token_expires_at=token_expires_at,
        config_metadata={"page_id": page_id, "page_name": page_name},
    )
    session.add(account)
    await session.commit()
    await session.refresh(account)
    return account


# ==============================================================================
# 1. TOKEN ENCRYPTION TESTS
# ==============================================================================

def test_token_encryption_at_rest():
    """1. plaintext token != stored ciphertext and ciphertext is valid base64 AES-GCM."""
    enc = TokenEncryptionService(TEST_32BYTE_KEY)
    raw = "EAABtest_secret_user_access_token_xyz"
    cipher = enc.encrypt(raw)
    assert cipher != raw
    assert len(cipher) > len(raw)
    # Different calls produce different ciphertexts (random nonces)
    cipher2 = enc.encrypt(raw)
    assert cipher != cipher2


def test_token_decryption_roundtrip():
    """2. decrypt(encrypt(token)) == token."""
    enc = TokenEncryptionService(TEST_32BYTE_KEY)
    raw = "EAAB_ultra_long_meta_graph_page_token_9876543210"
    cipher = enc.encrypt(raw)
    decrypted = enc.decrypt(cipher)
    assert decrypted == raw


def test_token_decryption_wrong_key_fails():
    """3. Wrong key fails to decrypt with ValueError (authentication tag mismatch)."""
    enc1 = TokenEncryptionService(TEST_32BYTE_KEY)
    enc2 = TokenEncryptionService(TEST_ALT_32BYTE_KEY)
    cipher = enc1.encrypt("super_sensitive_token")
    with pytest.raises(ValueError, match="Decryption failed"):
        enc2.decrypt(cipher)


def test_encryption_key_format_validation():
    """4. Validates key must be exactly 32 bytes."""
    with pytest.raises(ValueError, match="AUTH_TOKEN_ENCRYPTION_KEY is required"):
        TokenEncryptionService("")

    with pytest.raises(ValueError, match="Invalid AUTH_TOKEN_ENCRYPTION_KEY format"):
        TokenEncryptionService("too_short_key")


# ==============================================================================
# 2. FACEBOOK OAUTH TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_oauth_authorization_url_generation(client: httpx.AsyncClient):
    """5. OAuth authorization URL contains configured app ID, redirect URI, and secure state."""
    with patch.object(settings, "FACEBOOK_APP_ID", "test-fb-app-123"), \
         patch.object(settings, "FACEBOOK_OAUTH_REDIRECT_URI", "http://localhost:8000/api/v1/publishing/oauth/facebook/callback"):
        resp = await client.get("/api/v1/publishing/oauth/facebook/authorize")
        assert resp.status_code == 200
        data = resp.json()
        assert "authorization_url" in data
        assert "state" in data
        url = data["authorization_url"]
        assert "client_id=test-fb-app-123" in url
        assert "redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fapi%2Fv1%2Fpublishing%2Foauth%2Ffacebook%2Fcallback" in url or "redirect_uri=http://localhost:8000" in url
        assert "pages_manage_posts" in url
        assert "response_type=code" in url


@pytest.mark.asyncio
async def test_oauth_state_generation_binds_tenant(client: httpx.AsyncClient):
    """6. Generated state is encrypted and decrypts to contain tenant_id and nonce."""
    with patch.object(settings, "FACEBOOK_APP_ID", "test-fb-app-123"), \
         patch.object(settings, "FACEBOOK_OAUTH_REDIRECT_URI", "http://localhost:8000/api/v1/publishing/oauth/facebook/callback"):
        resp = await client.get("/api/v1/publishing/oauth/facebook/authorize")
        assert resp.status_code == 200
        state = resp.json()["state"]

        enc = TokenEncryptionService(TEST_32BYTE_KEY)
        state_data = json.loads(enc.decrypt(state))
        assert state_data["tenant_id"] == DEFAULT_TENANT_ID
        assert "nonce" in state_data
        assert "created_at" in state_data


@pytest.mark.asyncio
async def test_oauth_callback_rejects_invalid_state(client: httpx.AsyncClient):
    """7. Callback rejects tampered or invalid state with 403 Forbidden."""
    resp = await client.get(
        "/api/v1/publishing/oauth/facebook/callback",
        params={"code": "mock-code", "state": "invalid-tampered-state"},
    )
    assert resp.status_code == 403
    assert "Invalid or tampered OAuth state" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_oauth_callback_rejects_expired_state(client: httpx.AsyncClient):
    """8. Callback rejects expired state (> 10 minutes) with 400 Bad Request."""
    enc = TokenEncryptionService(TEST_32BYTE_KEY)
    expired_state_payload = {
        "tenant_id": DEFAULT_TENANT_ID,
        "nonce": "test-nonce",
        "created_at": time.time() - 700,  # 700 seconds ago (> 600s limit)
    }
    expired_state = enc.encrypt(json.dumps(expired_state_payload))

    resp = await client.get(
        "/api/v1/publishing/oauth/facebook/callback",
        params={"code": "mock-code", "state": expired_state},
    )
    assert resp.status_code == 400
    assert "expired" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_oauth_callback_token_exchange_single_page(
    client: httpx.AsyncClient,
    test_db_session: AsyncSession,
):

    """9. Callback exchanges code, discovers single page, and establishes ConnectedAccount."""
    enc = TokenEncryptionService(TEST_32BYTE_KEY)
    valid_state = enc.encrypt(json.dumps({"tenant_id": DEFAULT_TENANT_ID, "created_at": time.time()}))

    # Mock Meta Graph API responses
    def meta_handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "oauth/access_token" in url_str:
            return httpx.Response(200, json={"access_token": "user-mock-token-abc"})
        elif "me/accounts" in url_str:
            return httpx.Response(200, json={
                "data": [{
                    "id": "page-12345",
                    "name": "My Acme Page",
                    "access_token": "page-mock-token-xyz",
                }]
            })
        return httpx.Response(404)

    mock_transport = httpx.MockTransport(meta_handler)
    mock_meta_client = httpx.AsyncClient(transport=mock_transport)

    from app.main import app
    app.dependency_overrides[get_oauth_http_client] = lambda: mock_meta_client

    try:
        with patch.object(settings, "FACEBOOK_APP_ID", "test-fb-app"), \
             patch.object(settings, "FACEBOOK_APP_SECRET", "test-fb-secret"), \
             patch.object(settings, "FACEBOOK_OAUTH_REDIRECT_URI", "http://localhost:8000/callback"):

            resp = await client.get(
                "/api/v1/publishing/oauth/facebook/callback",
                params={"code": "valid-auth-code", "state": valid_state},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "CONNECTED"
            assert data["account"]["account_name"] == "My Acme Page"
            assert data["account"]["external_user_id"] == "page-12345"
            assert data["account"]["status"] == "CONNECTED"

            # Verify in DB: token is encrypted at rest
            stmt = select(ConnectedAccount).where(ConnectedAccount.external_user_id == "page-12345")
            db_acc = (await test_db_session.execute(stmt)).scalars().first()
            assert db_acc is not None
            assert db_acc.encrypted_access_token != "page-mock-token-xyz"
            assert enc.decrypt(db_acc.encrypted_access_token) == "page-mock-token-xyz"
    finally:
        app.dependency_overrides.pop(get_oauth_http_client, None)


@pytest.mark.asyncio
async def test_oauth_callback_multiple_pages_requires_selection(
    client: httpx.AsyncClient,
):
    """10. Callback with multiple pages prompts for selection and does not arbitrarily choose one."""
    enc = TokenEncryptionService(TEST_32BYTE_KEY)
    valid_state = enc.encrypt(json.dumps({"tenant_id": DEFAULT_TENANT_ID, "created_at": time.time()}))

    def meta_handler(request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        if "oauth/access_token" in url_str:
            return httpx.Response(200, json={"access_token": "user-mock-token-mult"})
        elif "me/accounts" in url_str:
            return httpx.Response(200, json={
                "data": [
                    {"id": "page-1", "name": "First Page", "access_token": "token-1"},
                    {"id": "page-2", "name": "Second Page", "access_token": "token-2"},
                ]
            })
        return httpx.Response(404)

    mock_transport = httpx.MockTransport(meta_handler)
    mock_meta_client = httpx.AsyncClient(transport=mock_transport)

    from app.main import app
    app.dependency_overrides[get_oauth_http_client] = lambda: mock_meta_client

    try:
        with patch.object(settings, "FACEBOOK_APP_ID", "test-fb-app"), \
             patch.object(settings, "FACEBOOK_APP_SECRET", "test-fb-secret"), \
             patch.object(settings, "FACEBOOK_OAUTH_REDIRECT_URI", "http://localhost:8000/callback"):

            resp = await client.get(
                "/api/v1/publishing/oauth/facebook/callback",
                params={"code": "code-multiple", "state": valid_state},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "PAGE_SELECTION_REQUIRED"
            assert len(data["available_pages"]) == 2
            assert data["selection_token"] is not None
    finally:
        app.dependency_overrides.pop(get_oauth_http_client, None)


@pytest.mark.asyncio
async def test_oauth_page_selection_completion(
    client: httpx.AsyncClient,
    test_db_session: AsyncSession,
):
    """11. Completes Page selection using encrypted selection token."""
    enc = TokenEncryptionService(TEST_32BYTE_KEY)
    selection_token = enc.encrypt(json.dumps({
        "tenant_id": DEFAULT_TENANT_ID,
        "user_token": "user-mock-token-mult",
        "created_at": time.time(),
    }))

    def meta_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "data": [
                {"id": "page-1", "name": "First Page", "access_token": "token-1"},
                {"id": "page-2", "name": "Second Page", "access_token": "token-2"},
            ]
        })

    mock_transport = httpx.MockTransport(meta_handler)
    mock_meta_client = httpx.AsyncClient(transport=mock_transport)

    from app.main import app
    app.dependency_overrides[get_oauth_http_client] = lambda: mock_meta_client

    try:
        resp = await client.post(
            "/api/v1/publishing/oauth/facebook/select-page",
            json={"selection_token": selection_token, "page_id": "page-2"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "CONNECTED"
        assert data["account"]["external_user_id"] == "page-2"
        assert data["account"]["account_name"] == "Second Page"

        # Verify encrypted token stored
        stmt = select(ConnectedAccount).where(ConnectedAccount.external_user_id == "page-2")
        acc = (await test_db_session.execute(stmt)).scalars().first()
        assert acc is not None
        assert enc.decrypt(acc.encrypted_access_token) == "token-2"
    finally:
        app.dependency_overrides.pop(get_oauth_http_client, None)


# ==============================================================================
# 3. CONNECTED ACCOUNT & API SECURITY TESTS
# ==============================================================================

@pytest.mark.asyncio
async def test_api_responses_never_contain_tokens(
    client: httpx.AsyncClient,
    test_db_session: AsyncSession,
):
    """12. Account listing & detail responses never contain raw or encrypted tokens."""
    account = await create_test_facebook_account(test_db_session, page_id="page-safe-123")

    # List endpoint
    resp_list = await client.get("/api/v1/publishing/accounts")
    assert resp_list.status_code == 200
    list_str = resp_list.text
    assert "access_token" not in list_str
    assert "encrypted_access_token" not in list_str
    assert "EAABtest" not in list_str

    # Detail endpoint
    resp_detail = await client.get(f"/api/v1/publishing/accounts/{account.id}")
    assert resp_detail.status_code == 200
    detail_str = resp_detail.text
    assert "access_token" not in detail_str
    assert "encrypted_access_token" not in detail_str
    assert "EAABtest" not in detail_str


@pytest.mark.asyncio
async def test_connected_account_tenant_isolation(
    client: httpx.AsyncClient,
    test_db_session: AsyncSession,
):
    """13. Tenant A cannot view or publish using Tenant B's ConnectedAccount."""
    tenant_b_id = f"tenant-{uuid.uuid4().hex[:8]}"
    tenant_b = Tenant(id=tenant_b_id, name="Tenant B", slug=f"slug-{uuid.uuid4().hex[:6]}")
    test_db_session.add(tenant_b)
    await test_db_session.commit()

    account_b = await create_test_facebook_account(test_db_session, tenant_id=tenant_b_id, page_id="page-tenant-b")

    # Accessing Tenant B account while authenticated as DEFAULT_TENANT_ID -> 404
    resp = await client.get(f"/api/v1/publishing/accounts/{account_b.id}")
    assert resp.status_code == 404


def test_token_never_logged(caplog):
    """14. Tokens never logged during encryption, decryption, or error handling."""
    enc = TokenEncryptionService(TEST_32BYTE_KEY)
    secret_token = "EAAB_super_secret_token_never_log_this_string_999"

    with caplog.at_level(logging.DEBUG):
        ciphertext = enc.encrypt(secret_token)
        _ = enc.decrypt(ciphertext)

    assert secret_token not in caplog.text


# ==============================================================================
# 4. FACEBOOK PUBLISHING PROVIDER (HTTP / MEDIA HANDLING)
# ==============================================================================

@pytest.mark.asyncio
async def test_facebook_publish_binary_upload_and_preservation(
    test_db_session: AsyncSession,
):
    """15 & 16. Multipart binary upload preserving exact approved PNG bytes."""
    account = await create_test_facebook_account(test_db_session, page_id="page-upload-1")
    setup_data = await setup_approved_final_ad(test_db_session)
    final_ad = setup_data["final_ad"]

    from app.providers.storage_provider import get_storage_provider
    storage = get_storage_provider()
    exact_bytes = await storage.get_bytes(final_ad.storage_key)
    exact_hash = hashlib.sha256(exact_bytes).hexdigest()

    captured_request = {}

    def fb_mock_handler(request: httpx.Request) -> httpx.Response:
        captured_request["url"] = str(request.url)
        captured_request["content"] = request.read()
        return httpx.Response(
            200,
            json={"id": "photo_fb_998877", "post_id": "page-upload-1_photo_fb_998877"},
            headers={"x-fb-request-id": "fb-req-test-abc", "x-page-usage": '{"call_count": 5}'},
        )

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(fb_mock_handler))
    provider = FacebookPublishingProvider(
        db=test_db_session,
        http_client=mock_client,
    )

    result = await provider.publish(
        record_id="rec-test-1",
        platform="facebook",
        asset_bytes=exact_bytes,
        caption="Check out our summer sale!",
        account_id=account.id,
    )

    assert result.success is True
    assert result.status == "PUBLISHED"
    assert result.external_post_id == "page-upload-1_photo_fb_998877"
    assert result.provider_request_id == "fb-req-test-abc"
    assert "https://www.facebook.com/page-upload-1/photos/photo_fb_998877" in result.post_url

    # Check that multipart content contains the exact bytes intact
    assert exact_bytes in captured_request["content"]


@pytest.mark.asyncio
async def test_provider_captures_rate_limiting_and_retry_after(
    test_db_session: AsyncSession,
):
    """17. Respects Retry-After header and maps rate limits to action_class=RETRY."""
    account = await create_test_facebook_account(test_db_session, page_id="page-rate-1")

    def rate_limit_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            json={"error": {"message": "Calls have exceeded the rate limit", "code": 17, "error_subcode": None}},
            headers={"retry-after": "180", "x-fb-request-id": "fb-req-rate-limit"},
        )

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(rate_limit_handler))
    provider = FacebookPublishingProvider(db=test_db_session, http_client=mock_client)

    result = await provider.publish(
        record_id="rec-rate-1",
        platform="facebook",
        asset_bytes=b"fake-bytes",
        account_id=account.id,
    )

    assert result.success is False
    assert result.action_class == PublishingActionClass.RETRY
    assert result.retry_after_seconds == 180
    assert result.provider_request_id == "fb-req-rate-limit"
    assert result.error_code == "FB_RATE_LIMITED"


@pytest.mark.asyncio
async def test_provider_token_expired_blocks_and_transitions(
    test_db_session: AsyncSession,
):
    """18. Expired token transitions account to EXPIRED and requires reauthentication without network call."""
    past_time = datetime.now(timezone.utc) - timedelta(hours=1)
    account = await create_test_facebook_account(
        test_db_session,
        page_id="page-expired-1",
        token_expires_at=past_time,
    )

    provider = FacebookPublishingProvider(db=test_db_session)
    result = await provider.publish(
        record_id="rec-exp-1",
        platform="facebook",
        asset_bytes=b"fake-bytes",
        account_id=account.id,
    )

    assert result.success is False
    assert result.error_code == "TOKEN_EXPIRED"
    assert result.action_class == PublishingActionClass.REAUTHENTICATE

    # Verify account status transitioned to EXPIRED in DB
    await test_db_session.refresh(account)
    assert account.status == AccountStatus.EXPIRED.value


@pytest.mark.asyncio
async def test_provider_token_invalidation_disconnects_account(
    test_db_session: AsyncSession,
):
    """19. Meta OAuthException (code 190) transitions account to DISCONNECTED."""
    account = await create_test_facebook_account(test_db_session, page_id="page-inval-1")

    def invalid_token_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={"error": {"message": "Error validating access token: Session has expired", "code": 190, "type": "OAuthException"}},
            headers={"x-fb-request-id": "fb-req-oauth-err"},
        )

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(invalid_token_handler))
    provider = FacebookPublishingProvider(db=test_db_session, http_client=mock_client)

    result = await provider.publish(
        record_id="rec-inval-1",
        platform="facebook",
        asset_bytes=b"fake-bytes",
        account_id=account.id,
    )

    assert result.success is False
    assert result.action_class == PublishingActionClass.REAUTHENTICATE
    assert result.error_code == "FB_AUTH_ERROR"

    # Verify account status set to DISCONNECTED
    await test_db_session.refresh(account)
    assert account.status == AccountStatus.DISCONNECTED.value


@pytest.mark.asyncio
async def test_provider_server_error_500_retries(
    test_db_session: AsyncSession,
):
    """19b. Meta 500 error maps to action_class=RETRY with safe backoff."""
    account = await create_test_facebook_account(test_db_session, page_id="page-500-1")

    def server_error_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            500,
            json={"error": {"message": "An unknown error has occurred.", "code": 1}},
            headers={"x-fb-request-id": "fb-req-500"},
        )

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(server_error_handler))
    provider = FacebookPublishingProvider(db=test_db_session, http_client=mock_client)

    result = await provider.publish(
        record_id="rec-500-1",
        platform="facebook",
        asset_bytes=b"fake-bytes",
        account_id=account.id,
    )

    assert result.success is False
    assert result.action_class == PublishingActionClass.RETRY
    assert result.error_code == "FB_SERVER_ERROR"
    assert result.provider_request_id == "fb-req-500"


@pytest.mark.asyncio
async def test_provider_invalid_media_does_not_retry(
    test_db_session: AsyncSession,
):
    """19c. Empty/invalid media returns action_class=DO_NOT_RETRY immediately."""
    account = await create_test_facebook_account(test_db_session, page_id="page-empty-1")
    provider = FacebookPublishingProvider(db=test_db_session)

    result = await provider.publish(
        record_id="rec-empty-1",
        platform="facebook",
        asset_bytes=b"",
        account_id=account.id,
    )

    assert result.success is False
    assert result.action_class == PublishingActionClass.DO_NOT_RETRY
    assert result.error_code == "EMPTY_MEDIA_BYTES"


@pytest.mark.asyncio
async def test_provider_account_restriction_blocks(
    test_db_session: AsyncSession,
):
    """19d. Meta policy/perms block (code 10/200/368) maps to action_class=BLOCK."""
    account = await create_test_facebook_account(test_db_session, page_id="page-block-1")

    def perm_error_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            403,
            json={"error": {"message": "User has restricted account", "code": 368}},
            headers={"x-fb-request-id": "fb-req-block"},
        )

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(perm_error_handler))
    provider = FacebookPublishingProvider(db=test_db_session, http_client=mock_client)

    result = await provider.publish(
        record_id="rec-block-1",
        platform="facebook",
        asset_bytes=b"fake-bytes",
        account_id=account.id,
    )

    assert result.success is False
    assert result.action_class == PublishingActionClass.BLOCK
    assert result.error_code == "FB_POLICY_OR_PERMS_ERROR"



# ==============================================================================
# 5. IDEMPOTENCY & CRASH RECOVERY (RECONCILIATION)
# ==============================================================================

@pytest.mark.asyncio
async def test_ambiguous_timeout_marks_reconcile_required(
    test_db_session: AsyncSession,
):
    """20. Network timeout during publishing is flagged as ambiguous and requires reconciliation."""
    account = await create_test_facebook_account(test_db_session, page_id="page-timeout-1")

    def timeout_handler(request: httpx.Request):
        raise httpx.ReadTimeout("Connection timed out waiting for Facebook response")

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(timeout_handler))
    provider = FacebookPublishingProvider(db=test_db_session, http_client=mock_client)

    result = await provider.publish(
        record_id="rec-timeout-1",
        platform="facebook",
        asset_bytes=b"fake-bytes",
        account_id=account.id,
    )

    assert result.success is False
    assert result.is_ambiguous is True
    assert result.action_class == PublishingActionClass.RECONCILE
    assert result.error_code == "NETWORK_TIMEOUT"


@pytest.mark.asyncio
async def test_reconciliation_finds_existing_post(
    test_db_session: AsyncSession,
):
    """21. Read-after-timeout reconciliation queries page photos and recovers existing post."""
    account = await create_test_facebook_account(test_db_session, page_id="page-rec-1")
    target_caption = "Exclusive Limited-Time Sale!"

    def reconcile_handler(request: httpx.Request) -> httpx.Response:
        now_iso = datetime.now(timezone.utc).isoformat()
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "photo_reconciled_554433",
                        "name": target_caption,
                        "created_time": now_iso,
                        "link": "https://facebook.com/photo/photo_reconciled_554433",
                    }
                ]
            },
            headers={"x-fb-request-id": "fb-rec-search"},
        )

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(reconcile_handler))
    provider = FacebookPublishingProvider(db=test_db_session, http_client=mock_client)

    reconciled = await provider.reconcile(
        idempotency_key="idemp-key-123",
        account_id=account.id,
        expected_caption=target_caption,
    )

    assert reconciled is not None
    assert reconciled.success is True
    assert reconciled.external_post_id == "photo_reconciled_554433"
    assert reconciled.post_url == "https://facebook.com/photo/photo_reconciled_554433"


@pytest.mark.asyncio
async def test_reconciliation_finds_nothing(
    test_db_session: AsyncSession,
):
    """22. Reconciliation returns None when no matching post exists on page."""
    account = await create_test_facebook_account(test_db_session, page_id="page-rec-none")

    def empty_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": []})

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(empty_handler))
    provider = FacebookPublishingProvider(db=test_db_session, http_client=mock_client)

    reconciled = await provider.reconcile(
        idempotency_key="idemp-key-xyz",
        account_id=account.id,
        expected_caption="No matching caption",
    )
    assert reconciled is None


@pytest.mark.asyncio
async def test_runner_reconciliation_prevents_duplicate_publish(
    test_db_session: AsyncSession,
):
    """23. execute_publishing_record reconciles first before calling publish, preventing duplicates."""
    account = await create_test_facebook_account(test_db_session, page_id="page-runner-rec")
    setup_data = await setup_approved_final_ad(test_db_session)
    final_ad = setup_data["final_ad"]

    # Pre-create publishing record in PUBLISH_FAILED (e.g. after ambiguous timeout)
    record = PublishingRecord(
        tenant_id=DEFAULT_TENANT_ID,
        final_ad_id=final_ad.id,
        platform="facebook",
        status=PublishingStatus.PUBLISH_FAILED.value,
        provider="facebook",
        external_account_id=account.id,
        caption="Reconcile me!",
        idempotency_key="idemp-runner-rec-1",
        provenance_chain={},
    )
    test_db_session.add(record)
    await test_db_session.commit()
    await test_db_session.refresh(record)

    publish_called = {"called": False}

    class MockReconcilingFacebookProvider(FacebookPublishingProvider):
        async def reconcile(self, idempotency_key, account_id=None, expected_caption=None):
            return PublishingProviderResult(
                success=True,
                status="PUBLISHED",
                external_post_id="post_already_on_fb",
                post_url="https://facebook.com/post_already_on_fb",
            )

        async def publish(self, *args, **kwargs):
            publish_called["called"] = True
            return PublishingProviderResult(success=True, status="PUBLISHED", external_post_id="duplicate")

    prov = MockReconcilingFacebookProvider(db=test_db_session)
    result_rec = await execute_publishing_record(record.id, db=test_db_session, provider_override=prov)

    assert result_rec.status == PublishingStatus.PUBLISHED.value
    assert result_rec.external_post_id == "post_already_on_fb"
    # publish() MUST NOT have been called!
    assert publish_called["called"] is False


# ==============================================================================
# 6. CREATIVE IMMUTABILITY REGRESSION TEST
# ==============================================================================

@pytest.mark.asyncio
async def test_publishing_cannot_modify_approved_creative(
    test_db_session: AsyncSession,
):
    """24. Proves publishing does NOT mutate final_ad hash, storage_key, status, or upstream records."""
    account = await create_test_facebook_account(test_db_session, page_id="page-immut-1")
    setup_data = await setup_approved_final_ad(test_db_session)
    final_ad = setup_data["final_ad"]
    from app.providers.storage_provider import get_storage_provider
    storage = get_storage_provider()
    orig_bytes = await storage.get_bytes(final_ad.storage_key)

    orig_hash = hashlib.sha256(orig_bytes).hexdigest()
    orig_storage_key = final_ad.storage_key
    orig_qa_status = final_ad.qa_status
    orig_job_status = setup_data["job"].status
    orig_comp_id = final_ad.composite_id
    orig_bg_id = final_ad.background_id

    # Execute publish via provider
    def ok_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "photo-immut-99", "post_id": "post-immut-99"})

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(ok_handler))
    prov = FacebookPublishingProvider(db=test_db_session, http_client=mock_client)

    payload = PublishRequest(
        final_ad_id=final_ad.id,
        platform="facebook",
        caption="Immutability check caption",
        account_id=account.id,
    )

    rec = await PublishingService.create_and_publish(
        db=test_db_session,
        user=None,
        payload=payload,
        provider_override=prov,
    )

    assert rec.status == PublishingStatus.PUBLISHED.value

    # Verify final ad in database and storage is completely untouched
    await test_db_session.refresh(final_ad)
    post_bytes = await storage.get_bytes(final_ad.storage_key)
    assert hashlib.sha256(post_bytes).hexdigest() == orig_hash
    assert final_ad.storage_key == orig_storage_key
    assert final_ad.qa_status == orig_qa_status
    assert final_ad.composite_id == orig_comp_id
    assert final_ad.background_id == orig_bg_id


    # Verify job status untouched
    job = await test_db_session.get(setup_data["job"].__class__, setup_data["job"].id)
    assert job.status == orig_job_status


# ==============================================================================
# 7. CELERY WORKER PAYLOAD SECURITY
# ==============================================================================

def test_celery_payload_contains_no_credentials():
    """25. process_publishing_stage signature and call accepts only publishing_record_id."""
    import inspect
    sig = inspect.signature(process_publishing_stage)
    params = list(sig.parameters.keys())
    assert params == ["publishing_record_id"]
    # No access_token, app_secret, image_bytes, or sensitive keys in Celery task signature
    assert "token" not in "".join(params)
    assert "secret" not in "".join(params)
    assert "bytes" not in "".join(params)


# ==============================================================================
# 8. CONFIGURATION & PROVIDER FACTORY TESTS
# ==============================================================================

def test_production_config_rejects_missing_encryption_key():
    """26. Production settings validator raises ValueError if Facebook publishing enabled without encryption key."""
    with pytest.raises(ValueError, match="AUTH_TOKEN_ENCRYPTION_KEY is missing"):
        Settings(
            ENVIRONMENT="production",
            DATABASE_URL="postgresql+asyncpg://user:pass@localhost:5432/db",
            ENABLE_DEV_AUTH=False,
            AUTH_JWT_SECRET="prod-secure-jwt-secret-very-long-and-random-12345",
            ENABLE_FACEBOOK_PUBLISHING=True,
            FACEBOOK_APP_ID="test-app-id",
            FACEBOOK_APP_SECRET="test-app-secret",
            FACEBOOK_OAUTH_REDIRECT_URI="https://example.com/callback",
            AUTH_TOKEN_ENCRYPTION_KEY=None,
        )


def test_no_mock_provider_silently_used_when_facebook_enabled():
    """27. get_publishing_provider('facebook') returns FacebookPublishingProvider, NOT MockPublishingProvider."""
    with patch.object(settings, "ENABLE_FACEBOOK_PUBLISHING", True):
        prov = get_publishing_provider("facebook", platform="facebook")
        assert isinstance(prov, FacebookPublishingProvider)
        assert not getattr(prov, "is_mock", False)


@pytest.mark.asyncio
async def test_invalid_final_ad_state_rejected(test_db_session: AsyncSession):
    """28. Unapproved creative cannot be published."""
    setup_data = await setup_approved_final_ad(test_db_session, set_approved_job_status=False)
    final_ad = setup_data["final_ad"]

    payload = PublishRequest(final_ad_id=final_ad.id, platform="facebook")
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        await PublishingService.create_and_publish(db=test_db_session, user=None, payload=payload)
    assert exc_info.value.status_code == 400
    assert "Prerequisite is FINAL_AD_APPROVED" in exc_info.value.detail


@pytest.mark.asyncio
async def test_stale_final_ad_rejected(test_db_session: AsyncSession):
    """29. Stale creative cannot be published."""
    setup_data = await setup_approved_final_ad(test_db_session, is_stale=True)
    final_ad = setup_data["final_ad"]

    payload = PublishRequest(final_ad_id=final_ad.id, platform="facebook")
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        await PublishingService.create_and_publish(db=test_db_session, user=None, payload=payload)
    assert exc_info.value.status_code == 400
    assert "Cannot publish stale creative" in exc_info.value.detail


@pytest.mark.asyncio
async def test_duplicate_publish_returns_existing_record(test_db_session: AsyncSession):
    """30. Duplicate publish request with same idempotency key deduplicates and returns existing record."""
    account = await create_test_facebook_account(test_db_session, page_id="page-dedup-1")
    setup_data = await setup_approved_final_ad(test_db_session)
    final_ad = setup_data["final_ad"]

    def ok_handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "photo-dedup-1", "post_id": "post-dedup-1"})

    mock_client = httpx.AsyncClient(transport=httpx.MockTransport(ok_handler))
    prov = FacebookPublishingProvider(db=test_db_session, http_client=mock_client)

    payload = PublishRequest(
        final_ad_id=final_ad.id,
        platform="facebook",
        caption="Unique caption for dedup",
        account_id=account.id,
        idempotency_key="fixed-idemp-dedup-key",
    )

    rec1 = await PublishingService.create_and_publish(
        db=test_db_session, user=None, payload=payload, provider_override=prov
    )
    assert rec1.status == PublishingStatus.PUBLISHED.value

    # Second call with same payload and idempotency key
    rec2 = await PublishingService.create_and_publish(
        db=test_db_session, user=None, payload=payload, provider_override=prov
    )
    assert rec2.id == rec1.id
    assert rec2.status == PublishingStatus.PUBLISHED.value


@pytest.mark.asyncio
async def test_cross_tenant_final_ad_rejected(test_db_session: AsyncSession):
    """31. Attempting to publish another tenant's approved creative is rejected with 404."""
    setup_data = await setup_approved_final_ad(test_db_session, tenant_id=DEFAULT_TENANT_ID)
    final_ad = setup_data["final_ad"]

    payload = PublishRequest(
        final_ad_id=final_ad.id,
        platform="facebook",
    )
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        await PublishingService.create_and_publish(
            db=test_db_session,
            user=None,
            payload=payload,
            target_tenant_id="completely-different-tenant-id",
        )
    assert exc_info.value.status_code == 404




# ==============================================================================
# 9. REAL META API BOUNDARY (EXPLICIT OPT-IN ONLY)
# ==============================================================================

@pytest.mark.skipif(
    os.getenv("RUN_FACEBOOK_INTEGRATION_TESTS", "").lower() != "true",
    reason="Real Facebook integration tests require explicit RUN_FACEBOOK_INTEGRATION_TESTS=true",
)
@pytest.mark.asyncio
async def test_live_facebook_integration():
    """
    30. Live Facebook Graph API smoke test.
    Strictly isolated and skipped by default. Only runs when developer explicitly opts in
    and provides LIVE_FB_PAGE_ACCESS_TOKEN and LIVE_FB_PAGE_ID in environment.
    """
    live_token = os.getenv("LIVE_FB_PAGE_ACCESS_TOKEN")
    live_page_id = os.getenv("LIVE_FB_PAGE_ID")
    if not live_token or not live_page_id:
        pytest.skip("Live Facebook credentials (LIVE_FB_PAGE_ACCESS_TOKEN, LIVE_FB_PAGE_ID) not provided.")

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{GRAPH_API_BASE}/{live_page_id}",
            params={"fields": "id,name", "access_token": live_token},
        )
        assert resp.status_code == 200
        assert "id" in resp.json()
