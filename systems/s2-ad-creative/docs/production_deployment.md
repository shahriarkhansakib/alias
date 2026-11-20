# Production Deployment & Real Infrastructure Guide

This guide details the production deployment, infrastructure provisioning, and security configuration for **Alias Img-Gen**.

---

## 1. System Architecture & Operational Boundary

```
[ Customer Browser ]
        ↓ (HTTPS / TLS 1.3)
[ Cloudflare / Reverse Proxy (Nginx/Caddy) ]
        ↓
[ FastAPI Backend (Uvicorn / Gunicorn) ]
        ├── PostgreSQL (Relational persistence, JSONB, foreign key cascades)
        ├── Redis (Message broker & state queue)
        │      ↓
        │   [ Celery Worker Pool ] (Thin payload: job_id, stage, publishing_record_id)
        │      ↓
        │   Storage Provider (Private S3 / Cloudflare R2 bucket)
        │      ↓
        │   Direct In-Memory Streaming Upload
        │      ↓
        └── [ Meta Graph API v22.0+ ] (Facebook Page Publishing)
```

### Core Invariant
```
FINAL_AD_APPROVED
   ↓
Publishing Gate (QA + Vision QA + Storage Verification)
   ↓
Output Hash Integrity Check (SHA-256 vs Provenance)
   ↓
Facebook Publishing Provider (Direct Multipart Binary Upload)
   ↓
PUBLISHED
```

Publishing is **strictly downstream** of the creative generation pipeline. It never triggers rendering, recompositing, or model calls, and never alters approved assets.

---

## 2. Production Environment Variables Reference

Below are the required environment variables for production. **Never commit actual secret values to source control.**

```bash
# ------------------------------------------------------------------------------
# CORE APPLICATION
# ------------------------------------------------------------------------------
PROJECT_NAME="Alias Img-Gen"
VERSION="0.1.0"
ENVIRONMENT="production"            # Enforces production safety guards
DEBUG=false                         # Disables debug endpoints and verbose tracebacks

# ------------------------------------------------------------------------------
# DATABASE (PostgreSQL with asyncpg)
# ------------------------------------------------------------------------------
# SQLite is strictly forbidden when ENVIRONMENT="production"
DATABASE_URL="postgresql+asyncpg://<db_user>:<db_password>@<db_host>:5432/<db_name>"
DB_POOL_SIZE=20
DB_MAX_OVERFLOW=10
DB_POOL_TIMEOUT=30
DB_POOL_RECYCLE=1800
DB_POOL_PRE_PING=true

# ------------------------------------------------------------------------------
# WORKER & MESSAGE BROKER (Redis + Celery)
# ------------------------------------------------------------------------------
WORKER_TYPE="celery"               # Enforces external Redis broker
REDIS_URL="redis://:<redis_password>@<redis_host>:6379/0"
CELERY_TASK_DEFAULT_QUEUE="creative"

# ------------------------------------------------------------------------------
# STORAGE (Private S3 or Cloudflare R2)
# ------------------------------------------------------------------------------
STORAGE_PROVIDER="s3"              # "s3" for AWS S3 or Cloudflare R2
STORAGE_TYPE="s3"
S3_BUCKET="<your_private_bucket_name>"
S3_REGION="us-east-1"
S3_ENDPOINT_URL=""                 # Set to https://<account_id>.r2.cloudflarestorage.com for Cloudflare R2
S3_ACCESS_KEY_ID="<your_access_key>"
S3_SECRET_ACCESS_KEY="<your_secret_key>"
# Keep S3_PUBLIC_BASE_URL empty to ensure assets remain private and proxy via /api/v1/storage
S3_PUBLIC_BASE_URL=""
STORAGE_PUBLIC_URL_PREFIX="/api/v1/storage"

# ------------------------------------------------------------------------------
# AUTHENTICATION & MULTI-TENANCY
# ------------------------------------------------------------------------------
ENABLE_DEV_AUTH=false              # Strictly forbidden in production; fails on startup
AUTH_JWT_SECRET="<generate_random_64_char_secret>"
AUTH_JWT_ALGORITHM="HS256"
AUTH_TOKEN_EXPIRE_MINUTES=1440

# ------------------------------------------------------------------------------
# TOKEN ENCRYPTION (AES-256-GCM Authenticated Encryption)
# ------------------------------------------------------------------------------
# Required for encrypting OAuth tokens at rest.
# Must be exactly 32 bytes: 64 hex characters, 44 base64 characters, or 32 raw bytes.
AUTH_TOKEN_ENCRYPTION_KEY="<generate_32_byte_hex_or_base64_key>"

# ------------------------------------------------------------------------------
# META GRAPH API / FACEBOOK OAUTH
# ------------------------------------------------------------------------------
ENABLE_FACEBOOK_PUBLISHING=true
FACEBOOK_APP_ID="<your_meta_app_id>"
FACEBOOK_APP_SECRET="<your_meta_app_secret>"
# Must match the configured OAuth redirect URI in your Meta Developer App (HTTPS required)
FACEBOOK_OAUTH_REDIRECT_URI="https://api.yourdomain.com/api/v1/publishing/oauth/facebook/callback"

# ------------------------------------------------------------------------------
# CORS & FRONTEND
# ------------------------------------------------------------------------------
CORS_ORIGINS=["https://app.yourdomain.com"]
FRONTEND_URL="https://app.yourdomain.com"
```

---

## 3. Cryptography Standards & Token Protection

All OAuth tokens and external platform credentials are encrypted at rest using **AES-256-GCM (Galois/Counter Mode)** authenticated encryption via the `cryptography` library (`AESGCM` primitive).

* **Key Length**: 256 bits (32 bytes).
* **Nonce**: 96 bits (12 bytes) cryptographically secure random bytes generated per encryption operation (`os.urandom(12)`). Nonces are never reused.
* **Authentication Tag**: 128 bits (16 bytes) appended to ciphertext to detect tampering.
* **Payload Format**: `base64(12_byte_nonce + ciphertext_with_16_byte_tag)`.
* **Zero Leakage**: Plaintext tokens are decrypted strictly in-memory during external API dispatches. Plaintext or ciphertext tokens never appear in Celery task arguments, Redis payloads, API responses, or system logs.

---

## 4. PostgreSQL Database Setup & Migrations

### 4.1 Prerequisites
- PostgreSQL 15+ or 16+ instance.
- Dedicated database and non-superuser role with `CONNECT`, `CREATE`, `SELECT`, `INSERT`, `UPDATE`, `DELETE` privileges.

### 4.2 Applying Migrations
Alembic manages all schema revisions. Run the migration command from the `backend/` directory:

```bash
# Check current migration revision
alembic current

# Upgrade database schema to head (includes Facebook publishing fields)
alembic upgrade head

# Generate offline raw SQL script for DBA review (if required)
alembic upgrade head --sql > migration_head.sql
```

Current migration head: `0005_facebook_publishing`.

---

## 5. Redis & Celery Worker Setup

### 5.1 Redis Configuration
- Enable Redis persistence (`appendonly yes`) or ensure Redis instance is configured with appropriate eviction policy.
- Configure password authentication via `REDIS_URL`.

### 5.2 Starting Celery Workers
Start worker processes dedicated to creative generation and publishing:

```bash
# From backend directory with virtual environment activated:
celery -A app.workers.celery_app worker \
  --loglevel=info \
  --queues=creative,publishing \
  --concurrency=4 \
  --prefetch-multiplier=1
```

### 5.3 Celery Payload Safety Invariants
1. `process_creative_stage(job_id, stage, params)`: Enqueues only entity UUIDs and execution flags. Zero raw image bytes or brief text enter Redis.
2. `process_publishing_stage(publishing_record_id)`: Enqueues only the `publishing_record_id` string. The worker derives all tenant state, decrypted tokens, and storage keys directly from PostgreSQL within worker process memory.

---

## 6. Private S3 / Cloudflare R2 Storage Setup

### 6.1 Bucket Policy
1. Create a private object storage bucket (e.g. `alias-creatives-prod`).
2. **Block all public access** on the bucket.
3. Grant the application IAM credentials `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, and `s3:HeadObject` permissions restricted to `tenants/*` prefixes.

### 6.2 Authenticated Storage Proxy
All media assets are served via the authenticated backend proxy endpoint:
`GET /api/v1/storage/tenants/{tenant_id}/...`

* The proxy verifies the caller's JWT token and validates tenant membership in PostgreSQL.
* Unauthorized or cross-tenant access returns HTTP `404 Not Found` to prevent asset enumeration.
* Responses enforce `Cache-Control: private, no-cache, no-store, must-revalidate`.

---

## 7. Public HTTPS Deployment & Reverse Proxy

Meta OAuth callbacks and live Graph API webhooks require a publicly reachable HTTPS domain with a valid TLS certificate.

### 7.1 Nginx Reverse Proxy Configuration Example

```nginx
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

---

## 8. Meta Developer App & OAuth Configuration

1. In the **Meta for Developers** portal (`developers.facebook.com`):
   - Create or configure a **Business** type application.
   - Add the **Facebook Login** product.
   - Configure **Valid OAuth Redirect URIs**:
     `https://api.yourdomain.com/api/v1/publishing/oauth/facebook/callback`
2. Required Permissions (Scopes):
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `pages_show_list`
3. Link a controlled **Test Facebook Page** where the developer/admin has administrative access.
4. Copy `App ID` and `App Secret` into `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`.

---

## 9. Pre-Flight Production Startup Validation

The application contains strict startup assertions in `app.core.config.Settings.validate_production_configuration`. When `ENVIRONMENT="production"`, startup will immediately abort with a descriptive error if:

1. `DATABASE_URL` starts with `sqlite` (PostgreSQL `postgresql+asyncpg://` is mandatory).
2. `ENABLE_DEV_AUTH=true` (development authentication is strictly prohibited in production).
3. `AUTH_JWT_SECRET="dev-insecure-jwt-secret"` (default or insecure JWT secret detected).
4. `WORKER_TYPE="celery"` and `REDIS_URL` is empty.
5. `STORAGE_PROVIDER="s3"` and `S3_BUCKET`, `S3_ACCESS_KEY_ID`, or `S3_SECRET_ACCESS_KEY` are missing.
6. `ENABLE_FACEBOOK_PUBLISHING=true` and `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `FACEBOOK_OAUTH_REDIRECT_URI`, or `AUTH_TOKEN_ENCRYPTION_KEY` are missing.
7. `AUTH_TOKEN_ENCRYPTION_KEY` is not a valid 32-byte key.

---

## 10. Verification Commands

```bash
# Backend test suite (all phases)
pytest -q

# Adversarial production security suite
pytest tests/test_phase9_4_production_validation.py -v

# Frontend production build
cd frontend && npm run build
```

---

## 11. Production Health Checks & Liveness Probes

The backend exposes standardized liveness and readiness endpoints:

* **Liveness Probe**: `GET /api/v1/health`
  - Returns `200 OK` with `{"status": "healthy", "version": "0.1.0"}`.
  - Used by Kubernetes or container orchestrators for process liveness.
* **Readiness / Dependency Probe**: `GET /api/v1/status`
  - Returns database connection status, storage connectivity, and worker dispatch readiness.
  - Used by load balancers before routing customer traffic.

---

## 12. Rollback Procedures

### 12.1 Application & Worker Rollback
1. Stop running Celery workers:
   ```bash
   kill -TERM $(pgrep -f "celery -A app.workers.celery_app")
   ```
2. Redeploy previous stable backend container/commit.
3. Restart Celery workers against the previous code version.

### 12.2 Database Migration Rollback
If a database rollback is required, downgrade using Alembic:
```bash
# Downgrade by 1 revision
alembic downgrade -1

# Downgrade to a specific revision (e.g. 0004_publishing)
alembic downgrade 0004_publishing
```
All Alembic migrations (`0001` through `0005`) define symmetric `upgrade()` and `downgrade()` functions to ensure safe transactional rollbacks.

