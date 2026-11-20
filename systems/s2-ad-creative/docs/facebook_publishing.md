# Phase 9.2: Facebook Page Publishing Integration

This document details the Facebook Page publishing architecture for Alias Img-Gen, strictly adhering to the core invariant:

```
FINAL_AD_APPROVED
   ↓
Publishing Gate (QA + Vision QA + Storage Verification)
   ↓
Facebook Publishing Provider (Direct Binary Upload)
   ↓
PUBLISHED
```

---

## 1. Status Overview

| Capability | Status | Description |
|---|---|---|
| **Token Encryption Service** | `IMPLEMENTED` | Authenticated AES-256-GCM encryption at rest with 96-bit random nonces. |
| **ConnectedAccount Model** | `IMPLEMENTED` | Tenant-scoped account persistence with encrypted access/refresh tokens. |
| **Alembic Database Migration** | `IMPLEMENTED` | `0005_facebook_publishing` adds credential columns to `connected_accounts`. |
| **Facebook OAuth Endpoints** | `IMPLEMENTED` | Cryptographic state generation, CSRF validation, code exchange, page discovery. |
| **Facebook Page Selection** | `IMPLEMENTED` | Deterministic single page or encrypted multi-page selection tokens. |
| **Facebook Publishing Provider** | `IMPLEMENTED` | `FacebookPublishingProvider` supporting direct multipart binary photo uploads. |
| **Creative Immutability** | `IMPLEMENTED` | Proved zero modifications to approved creative bytes, hash, or DB records. |
| **Reconciliation & Idempotency** | `IMPLEMENTED` | Read-after-timeout verification against Page photos before re-publishing. |
| **Error Taxonomy & Backoff** | `IMPLEMENTED` | Maps Meta errors to `RETRY`, `RECONCILE`, `REAUTHENTICATE`, `DO_NOT_RETRY`, `BLOCK`. |
| **Mock Unit & Integration Suite** | `TESTED WITH MOCKS` | 30 tests in `test_phase9_2_facebook.py` pass cleanly. |
| **Live Facebook Integration** | `REQUIRES LIVE FACEBOOK CREDENTIALS` | Opt-in via `RUN_FACEBOOK_INTEGRATION_TESTS=true` with Meta Page credentials. |
| **Production Deployment** | `REQUIRES DEPLOYMENT` | Production requires verified Meta App ID, secret, and 32-byte encryption key. |

---

## 2. Meta Configuration & Prerequisites

To enable live Facebook Page publishing, the following environment variables must be configured:

```bash
# Feature Flag
ENABLE_FACEBOOK_PUBLISHING=true

# Meta App Credentials (from Meta Developer Portal)
FACEBOOK_APP_ID="your_meta_app_id"
FACEBOOK_APP_SECRET="your_meta_app_secret"
FACEBOOK_OAUTH_REDIRECT_URI="https://yourdomain.com/api/v1/publishing/oauth/facebook/callback"

# Authenticated Token Encryption Key
# Exactly 32 bytes (64 hex characters or 44 base64 characters)
AUTH_TOKEN_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

### Required Meta App Permissions
- `pages_manage_posts`: Required to upload and publish photos to managed Facebook Pages.
- `pages_read_engagement`: Required to read page engagements and reconcile post statuses.
- `pages_show_list`: Required to list and discover pages managed by the authenticated user.

---

## 3. Token Encryption Architecture

All platform OAuth access tokens, page tokens, and refresh tokens are encrypted at rest using **AES-256-GCM** authenticated encryption:

1. **Service**: `app.core.encryption.TokenEncryptionService`
2. **Key**: Sourced from `AUTH_TOKEN_ENCRYPTION_KEY`. Validated strictly at application startup.
3. **Payload Structure**:
   ```
   Base64( Nonce [12 bytes] + Ciphertext + Authentication Tag [16 bytes] )
   ```
4. **Security Invariants**:
   - Every encryption operation generates a cryptographically random 12-byte nonce (`os.urandom(12)`).
   - Tampered ciphertexts or incorrect keys fail immediately with authentication tag verification errors.
   - Plaintext credentials are **never** logged, **never** returned in API responses, and **never** passed inside Celery/Redis task messages.

---

## 4. Facebook OAuth Flow

### Step 1: Authorization URL Generation
- **Endpoint**: `GET /api/v1/publishing/oauth/facebook/authorize`
- **Query Params**: `page_id` (optional target Facebook Page ID for automatic selection).
- **Behavior**:
  - Encrypts a state object containing: `tenant_id`, `user_id`, `target_page_id`, a random 16-byte nonce, and creation timestamp.
  - Builds the Meta OAuth dialog URL:
    ```
    https://www.facebook.com/v22.0/dialog/oauth?client_id=...&redirect_uri=...&state=...&scope=pages_manage_posts,pages_read_engagement,pages_show_list&response_type=code
    ```

### Step 2: Callback & Token Exchange
- **Endpoint**: `GET /api/v1/publishing/oauth/facebook/callback`
- **Validation**:
  - Decrypts state and verifies:
    1. Tenant matches the caller's active tenant (`tenant_id == tenant.id`).
    2. State is not expired (TTL: 10 minutes / 600 seconds).
  - Exchanges authorization code with Meta Graph API for a user access token:
    `GET https://graph.facebook.com/v22.0/oauth/access_token`
  - Fetches the user's managed Facebook Pages:
    `GET https://graph.facebook.com/v22.0/me/accounts?fields=id,name,access_token,tasks,perms`

### Step 3: Page Selection
- **Single Page or Pre-selected Page**: Automatically encrypts the Page Access Token and establishes a `ConnectedAccount` in `status="CONNECTED"`.
- **Multiple Pages Available**: Returns `status="PAGE_SELECTION_REQUIRED"` with a list of available pages and an encrypted temporary `selection_token` (10-minute TTL).
- **Completion**: The client calls `POST /api/v1/publishing/oauth/facebook/select-page` with the chosen `page_id` and `selection_token` to finalize the connection.

---

## 5. Connected Account Model & Security

Social accounts are isolated strictly within tenant boundaries:

- **Platform**: `facebook`
- **External User ID**: Facebook Page ID (e.g. `109876543210`)
- **Account Name**: Facebook Page display name
- **Status**: `CONNECTED`, `ACTIVE`, `DISCONNECTED`, `EXPIRED`, `NOT_CONFIGURED`
- **Scopes**: Stored as JSON array (e.g. `["pages_manage_posts", "pages_read_engagement", "pages_show_list"]`)

### Safe API Surface
Endpoints:
- `GET /api/v1/publishing/accounts`
- `GET /api/v1/publishing/accounts/{id}`

Response Model (`ConnectedAccountResponse`):
```json
{
  "id": "acc-uuid",
  "tenant_id": "tenant-uuid",
  "platform": "facebook",
  "account_name": "My Brand Page",
  "external_user_id": "109876543210",
  "status": "CONNECTED",
  "expires_at": null,
  "scopes": ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
  "created_at": "2026-10-04T10:00:00Z",
  "updated_at": "2026-10-04T10:00:00Z"
}
```
**Strict Invariant**: Zero raw tokens, refresh tokens, app secrets, or encrypted ciphertext values are ever serialized into API responses.

---

## 6. Facebook Publishing Provider

The `FacebookPublishingProvider` implements `PublishingProvider`:

### Media Delivery: Direct Multipart Binary Upload
- **Endpoint**: `POST https://graph.facebook.com/v22.0/{page-id}/photos`
- **Content-Type**: `multipart/form-data`
- **Payload**:
  - `source`: Raw image bytes (`image/png`) streamed directly from tenant storage.
  - `caption`: Post caption text.
  - `access_token`: Page Access Token passed in POST body (avoiding query string logging).
- **Immutability Guarantee**: Approved creative artifacts are uploaded exactly as stored. The publishing layer does not resize, transcode, or re-render creative assets.

### Diagnostics Captured:
- `x-fb-request-id` / `fb-request-id`: Saved as `provider_request_id`.
- `x-page-usage` / `x-app-usage`: Persisted in diagnostic metadata.
- `retry-after`: Extracted and respected for backoff scheduling.

---

## 7. Idempotency & Crash Recovery (Reconciliation)

Facebook Graph API does not support client-generated idempotency tokens for photo publishing. To prevent duplicate posts across worker timeouts, retries, and network ambiguity:

1. **Pre-Flight Reconciliation**:
   Before issuing a `POST /{page-id}/photos`, `execute_publishing_record` calls `provider.reconcile(...)`.
2. **Read-After-Timeout Verification**:
   If a previous attempt timed out (`is_ambiguous=True`), the provider queries recent photos on the target Page:
   `GET https://graph.facebook.com/v22.0/{page-id}/photos?fields=id,name,created_time,link&limit=25`
3. **Multi-Signal Matching**:
   - Matches caption/name against the expected post caption.
   - Verifies the post was created within the recent execution window (last 2 hours).
   - Confirms target page identity.
4. **Duplicate Prevention**:
   If an existing post matches, the record transitions directly to `PUBLISHED` with the discovered external post ID. No second publish call is made.

---

## 8. Error Taxonomy & Action Classes

Facebook Graph API errors are deterministically mapped into structured action classes:

| Meta Error Code / Type | Action Class | Behavior |
|---|---|---|
| **Code 190, 102 (`OAuthException`)** | `REAUTHENTICATE` | Marks account as `DISCONNECTED`. Halts retries. Re-auth required. |
| **Token Expired (`token_expires_at <= now`)** | `REAUTHENTICATE` | Marks account as `EXPIRED`. Blocks network call. |
| **Code 4, 17, 32, 613 (Rate Limits) / HTTP 429** | `RETRY` | Respects `Retry-After` header or applies 60s backoff. |
| **HTTP 5xx, Code 1, 2 (Temporary Server Errors)** | `RETRY` | Transient retry with backoff. |
| **HTTP Timeout / Network Error** | `RECONCILE` | Flags `is_ambiguous=True`. Queries page before attempting retry. |
| **Code 10, 200, 368 (Permission / Policy Block)** | `BLOCK` | Marks record `PUBLISH_FAILED`. Operator intervention required. |
| **Code 100 (Validation / Bad Request)** | `DO_NOT_RETRY` | Non-retryable error. Record fails immediately. |

---

## 9. Live Meta API Smoke Test Boundary

Real Facebook API interactions are strictly isolated from normal CI and local test runs:

- All 30 standard Phase 9.2 tests run against mock transports and in-memory test databases.
- Real API calls are gated behind the explicit opt-in environment flag:
  ```bash
  RUN_FACEBOOK_INTEGRATION_TESTS=true
  LIVE_FB_PAGE_ACCESS_TOKEN="your_token"
  LIVE_FB_PAGE_ID="your_page_id"
  ```
- Normal test suites skip live API tests automatically.
