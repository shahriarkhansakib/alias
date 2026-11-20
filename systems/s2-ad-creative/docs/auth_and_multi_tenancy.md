# Authentication & Multi-Tenant Isolation Architecture (Phase 7.4)

## Overview
Phase 7.4 converts the application from single-tenant execution into a secure, multi-tenant architecture with strict customer data isolation across all resources, database records, background task queues, and object storage.

```
                      +-----------------------+
                      |   Authenticated User   |
                      +-----------+-----------+
                                  |
                                  v
                      +-----------------------+
                      | Tenant / Organization  |
                      | (Authoritative Member) |
                      +-----------+-----------+
                                  |
            +---------------------+---------------------+
            |                     |                     |
            v                     v                     v
    +---------------+     +---------------+     +---------------+
    | Briefs/Assets |     | Creative Jobs |     | Object Storage|
    | (tenant_id)   |     | (tenant_id)   |     | (tenants/.../)|
    +---------------+     +---------------+     +---------------+
```

---

## 1. Authentication Architecture

- **Token Mechanism**: Standard JSON Web Tokens (JWT, HS256) carrying stable user identity (`sub`, `email`, `name`).
- **Identity Provider Compatibility**: Decoupled from provider-specific logic. Compatible with external identity providers (Auth0, Clerk, Firebase, Supabase, Google Cloud Identity) via Bearer token extraction and claim decoding.
- **Session Resolution**: Handled via FastAPI dependencies:
  - `get_current_user`: Extracts Bearer token (or query token for browser media requests), validates signature, expiration, and required subject claims, and loads or verifies the active user record.
  - `get_current_tenant`: Extracts authenticated user and checks the requested or default tenant against database memberships.
- **Frontend Token Management**: Token and active session are stored securely in `localStorage` in the Next.js client and sent via `Authorization: Bearer <token>` and `X-Tenant-ID` headers with all API calls.

---

## 2. Tenant and Membership Data Models

The entities are defined in `app/models/auth.py`:

```
User (id: UUID, email: str UNIQUE, full_name: str, is_active: bool)
  │
  ├── Membership (id: UUID, user_id: FK, tenant_id: FK, role: OWNER | MEMBER)
  │
Tenant (id: UUID, name: str, slug: str UNIQUE)
```

### Roles:
- **`OWNER`**: Organization administrator. Has full access to tenant resources and member management.
- **`MEMBER`**: Creative user. Has full access to creative pipelines and tenant resources according to standard tenant boundaries.

### Top-Level Resource Ownership:
All persistent pipeline entities have a foreign key to `tenants.id`:
- `ad_briefs.tenant_id`
- `creative_strategies.tenant_id`
- `creative_jobs.tenant_id`
- `generated_backgrounds.tenant_id`
- `composited_creatives.tenant_id`
- `final_rendered_creatives.tenant_id`
- `asset_validation_records.tenant_id`

Indexes are created on `(tenant_id)` across all tables to optimize tenant-scoped queries.

---

## 3. Authorization Rules & Scoped Queries

Authorization answers: *"Can this user access this specific resource?"*

### Invariants:
1. **Never Trust Client-Supplied `tenant_id`**:
   The frontend `X-Tenant-ID` header is treated purely as a *preference* (which tenant workspace the user wishes to view). The backend `get_current_tenant` dependency performs a database lookup to ensure the user has an authoritative `Membership` for that tenant. If the user does not belong to the requested tenant, HTTP 403 Forbidden is returned.
2. **Strict Query Scoping**:
   All resource queries filter by `tenant_id == tenant.id`.
   ```python
   # Authoritative query pattern:
   stmt = select(AdBrief).where(AdBrief.id == brief_id, AdBrief.tenant_id == tenant.id)
   ```
3. **Safe HTTP 404 (No Existence Leaking / IDOR Defense)**:
   Attempting to fetch, update, dispatch, or regenerate another tenant's resource returns `HTTP 404 Not Found`, identical to an invalid or deleted ID. This prevents cross-tenant enumeration attacks.

---

## 4. Object Storage Isolation

- **Namespace Partitioning**: Object storage keys are server-generated and partitioned by tenant ID:
  ```
  tenants/{tenant_id}/backgrounds/{job_id}/...
  tenants/{tenant_id}/composites/{job_id}/...
  tenants/{tenant_id}/final_ads/{job_id}/...
  ```
- **Access Verification**:
  Requests to `/api/v1/storage/{file_path:path}` inspect the key for a `tenants/{tenant_id}` prefix.
  If present, the endpoint verifies that the authenticated user possesses an authoritative membership in that exact `tenant_id`. If unauthorized, a safe `HTTP 404 Not Found` is returned.

---

## 5. Celery & Worker Tenant Security

1. **Authoritative DB Lookup**:
   When a Celery or in-process background worker receives `job_id`, it loads `CreativeJob` from PostgreSQL/database and determines `job.tenant_id` from the authoritative database record.
2. **Payload Spoofing Defense**:
   Workers never trust a `tenant_id` passed in task payloads. If a task payload includes an inconsistent `tenant_id`, the worker raises a validation error immediately.
3. **Graph Integrity Checks**:
   Before executing stages (e.g. background, composite, final ad), workers verify that all referenced parent resources (`brief`, `strategy`, `background`, `composite`) belong to the exact same `tenant_id` as the `job`. Any cross-tenant resource linkages trigger an immediate rejection.

---

## 6. Local Development Auth & Production Safety

- **Development Mode**:
  - `ENABLE_DEV_AUTH=True` enables `/api/v1/auth/dev-login` and `/api/v1/auth/dev-token` for local test setups and developer workflows.
  - A default organization (`Default Organization`, ID `default-tenant-001`) and user (`developer@example.com`, ID `default-user-001`) are automatically seeded.
- **Production Guardrails**:
  - `ENABLE_DEV_AUTH` must be `False` in production.
  - Application startup (`Settings.validate_production_invariants`) **fails immediately with a fatal ValueError** if `ENABLE_DEV_AUTH=True` when `ENVIRONMENT="production"`.
  - In production, real JWT secrets (`AUTH_JWT_SECRET`) must be provided with at least 32 characters, and default development secrets are rejected.

---

## 7. Production Environment Variables

| Variable | Type | Description | Production Requirement |
| :--- | :--- | :--- | :--- |
| `ENVIRONMENT` | string | `production`, `staging`, `development` | `production` |
| `ENABLE_DEV_AUTH` | boolean | Enables dev-login endpoints | Must be `False` |
| `AUTH_JWT_SECRET` | string | HMAC-SHA256 secret for signing/verifying JWTs | Minimum 32 random characters |
| `AUTH_ACCESS_TOKEN_EXPIRE_MINUTES` | int | Token lifespan in minutes | Default 1440 (24h) |
| `DATABASE_URL` | string | Async PostgreSQL connection string | `postgresql+asyncpg://...` |
| `STORAGE_TYPE` | string | `s3` or `local` | `s3` |
| `S3_BUCKET` | string | S3/R2 Bucket name | Required if `STORAGE_TYPE=s3` |
| `WORKER_TYPE` | string | `celery` or `inline` | `celery` |
| `REDIS_URL` | string | Redis broker URL | Required if `WORKER_TYPE=celery` |

---

## 8. Database Migration Process

Alembic manages all schema revisions:
- **Migration `0002_multi_tenant.py`**:
  - Creates `users`, `tenants`, and `memberships` tables.
  - Adds `tenant_id` foreign keys and indexes to `ad_briefs`, `asset_validation_records`, `creative_strategies`, `creative_jobs`, `generated_backgrounds`, `composited_creatives`, and `final_rendered_creatives`.
  - Seeds `DEFAULT_TENANT_ID` and `DEFAULT_USER_ID` with `OWNER` membership so existing data remains accessible.
- **To apply migrations in production**:
  ```bash
  alembic upgrade head
  ```
