# Alias Img-Gen: Controlled Recovery & Hardening Phase Report

**Date**: November 14, 2026  
**Auditor & Recovery Lead**: DeepMind Antigravity  
**Repository Branch**: `recovery-phase8-9-cache-hardening`  
**Base Commit**: `c758123` (Phase 7.1)  
**Safety Checkpoint Commit**: `c3e010b`  
**Hardening Commit**: `d35158a`  
**Contract Hardening Commit**: `17b2cba`  
**Target File**: `docs/RECOVERY_AND_HARDENING_REPORT_2026-11.md`  

---

## 1. Executive Summary

Following the comprehensive project health audit conducted on November 13, 2026 (`PROJECT_HEALTH_AUDIT_2026-11.md`), a controlled recovery and hardening phase was executed. The objective was to resolve the verified defects (four bugs, one deprecation warning, and the tenant cache contract vulnerability) without destabilizing the existing 9-phase architecture, compromising tenant isolation, or regressing existing test coverage.

Both defined acceptance gates and the final tenant cache contract hardening have been conclusively satisfied:
- **Gate 1 (Tenant Isolation & Mandatory Contract Hardening)**: **PASSED**. Two distinct tenants submitting identical creative briefs, assets, and generation parameters produce strictly isolated artifacts. Cross-tenant lookup, retrieval, and approval attempts return HTTP 404. All three domain services strictly mandate `tenant_id: str` without defaults or `"global"` fallbacks, explicitly rejecting missing, empty, or whitespace-only tenant IDs with `ValueError` and HTTP 400 at the service gate.
- **Gate 2 (Regression Safety)**: **PASSED**. The backend pytest suite passes with **358 passed, 1 skipped** (target was 356+ passed, 1 skipped). Frontend TypeScript type-checking passes with **0 errors**. Frontend ESLint passes with **0 errors, 5 warnings** (all 5 warnings are benign advisory `@next/next/no-img-element` for procedural preview PNGs). The Next.js production build succeeds completely offline with **zero network dependencies**.

---

## 2. Acceptance Gate Evaluation

### Gate 1: Cross-Tenant Isolation & Mandatory Tenant Contract (PASS)

| Evaluation Criteria | Target Behavior | Observed Behavior | Status |
|---------------------|-----------------|-------------------|--------|
| **Independent Artifact Generation** | Tenant A & Tenant B with identical inputs receive unique IDs | Verified: `bg_a.id != bg_b.id`, `comp_a.id != comp_b.id`, `ad_a.id != ad_b.id` | **PASS** |
| **Cache Key Tenant Scoping** | Cache keys differ between tenants for identical inputs | Verified: `cache_key_a != cache_key_b` (`tenant:tenant-a:...` vs `tenant:tenant-b:...`) | **PASS** |
| **Mandatory Tenant Identity Contract** | `_compute_cache_key` rejects missing, empty, or whitespace-only `tenant_id` | Verified: `ValueError` raised on `None`, `""`, `"   "`; `TypeError` on omitted arg | **PASS** |
| **Service Layer Tenant Enforcement** | Service methods reject jobs with missing/empty `tenant_id` before computing cache | Verified: HTTP 400 Bad Request raised in `BackgroundService`, `CompositeService`, `FinalAdService` | **PASS** |
| **Cross-Tenant API Retrieval** | Tenant A querying Tenant B's artifact ID via API receives 404 | Verified: HTTP 404 on `GET /api/v1/final-ads/{final_ad_b_id}` with Tenant A JWT | **PASS** |
| **Cross-Tenant Approval Block** | Tenant A attempting to approve Tenant B's artifact receives 404 | Verified: HTTP 404 on `POST /api/v1/final-ads/{final_ad_b_id}/approve` with Tenant A JWT | **PASS** |
| **Same-Tenant Cache Hit** | Tenant A submitting identical inputs a second time reuses their own artifact | Verified: `is_cached == True`, artifact ID matches Tenant A's existing record | **PASS** |

### Gate 2: Regression Safety (PASS)

| Verification Dimension | Pre-Recovery Baseline | Post-Hardening State | Margin / Delta | Status |
|------------------------|-----------------------|----------------------|----------------|--------|
| **Backend Test Suite** | 354 passed, 1 skipped | **358 passed, 1 skipped** | +4 new tests passing | **PASS** |
| **TypeScript Compilation** | 0 errors | **0 errors** (`npx tsc --noEmit`) | 0 errors maintained | **PASS** |
| **ESLint Static Analysis** | 76 errors, 78 warnings | **0 errors, 5 warnings** | -76 errors, -73 warnings | **PASS** |
| **Frontend Production Build** | Failing without Internet | **100% Offline Build Success** (Next.js Turbopack) | Zero network calls | **PASS** |
| **Database Migrations** | Head at `0005_facebook_publishing` | **Head at `0006_tenant_cache_indexes`** (Upgrade & Downgrade verified) | +1 clean migration | **PASS** |

---

## 3. Detailed Audit Finding Remediation

### BUG-AUDIT-01: Cross-Tenant Cache Reuse & Cache Key Contract Hardening (Critical)

- **Root Cause**: The caching logic in `BackgroundService`, `CompositeService`, and `FinalAdService` previously computed cache keys without tenant scoping, and SQL queries filtered only by `cache_key == key`. Under identical inputs, Tenant B would hit Tenant A's cached artifact. Furthermore, initial remediation used an optional `tenant_id: Optional[str] = None` parameter falling back to `"global"`, which left an open risk of accidental un-scoped cache key generation.
- **Resolution**:
  1. **Strict Mandatory Parameter**: Removed `tenant_id: Optional[str] = None` default and removed the fallback string `"global"`. Made `tenant_id: str` strictly mandatory.
  2. **Defensive Validation**: Added explicit validation raising `ValueError(f"tenant_id is required and cannot be empty (got {tenant_id!r})")` if `not tenant_id or not str(tenant_id).strip()`.
  3. **Service Layer Gate**: Added explicit validation in `generate_background()`, `composite_product()`, and `render_final_ad()` requiring non-empty `job.tenant_id`, raising `HTTPException(status_code=400, detail="CreativeJob missing tenant_id...")`.
  4. **Scoped Lookups & Idempotency**: All cache lookup queries (`stmt_cache`) and idempotency checks require `Record.tenant_id == job.tenant_id`.
  5. **Composite Non-Unique Indexes**: Added composite indexes `(tenant_id, cache_key)` across `generated_backgrounds`, `composited_creatives`, and `final_rendered_creatives` tables. Verified non-uniqueness so independent tenant records do not trigger uniqueness constraint collisions.
  6. **Alembic Migration**: Authored Alembic migration `0006_tenant_cache_indexes.py` (`0005_facebook_publishing` -> `0006_tenant_cache_indexes`). Verified bidirectional lifecycle: `alembic upgrade head` -> `alembic downgrade -1` -> `alembic upgrade head`.

#### Exact Signature Transformations

##### `BackgroundService._compute_cache_key`
```python
# PREVIOUS SIGNATURE
@classmethod
def _compute_cache_key(
    cls,
    strategy_id: str,
    strategy_version: int,
    platform: str,
    template_id: str,
    prompt_version: str,
    provider_name: str,
    model_name: str,
    width: int,
    height: int,
    generation_params: Optional[Dict[str, Any]] = None,
    prompt_hash: Optional[str] = None,
    tenant_id: Optional[str] = None,
) -> str:
    ...
    parts = [f"tenant:{tenant_id}" if tenant_id else "global", ...]

# NEW HARDENED SIGNATURE
@classmethod
def _compute_cache_key(
    cls,
    strategy_id: str,
    strategy_version: int,
    platform: str,
    template_id: str,
    prompt_version: str,
    provider_name: str,
    model_name: str,
    width: int,
    height: int,
    tenant_id: str,
    generation_params: Optional[Dict[str, Any]] = None,
    prompt_hash: Optional[str] = None,
) -> str:
    if not tenant_id or not str(tenant_id).strip():
        raise ValueError(f"tenant_id is required and cannot be empty (got {tenant_id!r})")
    clean_tenant = str(tenant_id).strip()
    parts = [f"tenant:{clean_tenant}", ...]
```

##### `CompositeService._compute_cache_key`
```python
# PREVIOUS SIGNATURE
@classmethod
def _compute_cache_key(
    cls,
    source_asset_hash: str,
    cutout_hash: str,
    background_id: str,
    platform: str,
    template_id: str,
    placement_dict: Dict[str, Any],
    shadow_dict: Dict[str, Any],
    tenant_id: Optional[str] = None,
) -> str:
    ...
    parts = [f"tenant:{tenant_id}" if tenant_id else "global", ...]

# NEW HARDENED SIGNATURE
@classmethod
def _compute_cache_key(
    cls,
    source_asset_hash: str,
    cutout_hash: str,
    background_id: str,
    platform: str,
    template_id: str,
    placement_dict: Dict[str, Any],
    shadow_dict: Dict[str, Any],
    tenant_id: str,
) -> str:
    if not tenant_id or not str(tenant_id).strip():
        raise ValueError(f"tenant_id is required and cannot be empty (got {tenant_id!r})")
    clean_tenant = str(tenant_id).strip()
    parts = [f"tenant:{clean_tenant}", ...]
```

##### `FinalAdService._compute_cache_key`
```python
# PREVIOUS SIGNATURE
@classmethod
def _compute_cache_key(
    cls,
    composite_output_hash: str,
    copy_hash: str,
    platform: str,
    template_id: str,
    typography_dict: Dict[str, Any],
    cta_dict: Dict[str, Any],
    price_badge_dict: Dict[str, Any],
    readability_dict: Dict[str, Any],
    font_hashes: Dict[str, str],
    logo_dict: Optional[Dict[str, Any]] = None,
    tenant_id: Optional[str] = None,
) -> str:
    ...
    tenant_prefix = f"tenant:{tenant_id}" if tenant_id else "global"

# NEW HARDENED SIGNATURE
@classmethod
def _compute_cache_key(
    cls,
    composite_output_hash: str,
    copy_hash: str,
    platform: str,
    template_id: str,
    typography_dict: Dict[str, Any],
    cta_dict: Dict[str, Any],
    price_badge_dict: Dict[str, Any],
    readability_dict: Dict[str, Any],
    font_hashes: Dict[str, str],
    tenant_id: str,
    logo_dict: Optional[Dict[str, Any]] = None,
) -> str:
    if not tenant_id or not str(tenant_id).strip():
        raise ValueError(f"tenant_id is required and cannot be empty (got {tenant_id!r})")
    clean_tenant = str(tenant_id).strip()
    parts = [f"tenant:{clean_tenant}", ...]
```

#### Production Call Sites & Tests Updated
- `backend/app/services/background_service.py` (`generate_background` at initial prompt cache lookup and attempt success commit).
- `backend/app/services/composite_service.py` (`composite_product` cache lookup).
- `backend/app/services/final_ad_service.py` (`render_final_ad` cache lookup and concurrency guard).
- `backend/tests/test_phase4_1_hardening.py` (updated 4 test functions to pass `tenant_id="tenant-test"`).
- `backend/tests/test_phase5_compositing.py` (updated `base_kwargs` in `test_composite_cache_key_determinism`).
- `backend/tests/test_phase6_final_ad.py` (updated all 16 invalidation tests in `test_phase6_1_exhaustive_cache_key_invalidation_matrix`).
- `backend/tests/test_cross_tenant_cache_isolation.py` (added `test_mandatory_tenant_id_rejection_all_services` and `test_service_layer_rejects_job_missing_tenant_id`).

---

### BUG-AUDIT-02: Google Fonts Build-Time Dependency (High)

- **Root Cause**: `frontend/src/app/layout.tsx` imported `Geist` and `Geist_Mono` from `next/font/google`. During production builds (`next build`), Next.js attempted to download Google Font files from `fonts.googleapis.com`. In isolated, air-gapped, or sandboxed environments, this build step failed.
- **Resolution**:
  1. Removed `next/font/google` import and font declarations from `frontend/src/app/layout.tsx`.
  2. Retained the clean, deterministic system font stack defined in `frontend/src/app/globals.css`:
     ```css
     font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
     ```
  3. Verified offline compilation with `npm run build` using Turbopack: 5/5 static routes compiled cleanly with zero network activity.

---

### BUG-AUDIT-03: ESLint Violations & React 19 Hook Diagnostics (Medium)

- **Root Cause**: The frontend accumulated 76 errors and 78 warnings primarily comprising `@typescript-eslint/no-explicit-any`, React 19 experimental `react-hooks/set-state-in-effect` errors, unescaped quote entities in JSX, and unused imports.
- **Resolution**:
  1. **Zero Global Suppressions**: No rules were disabled globally in `eslint.config.mjs`.
  2. **Contract-Aligned Types**: Added explicit schemas to `frontend/src/lib/types.ts` (`BriefPayload`, `BriefResponse`, `BriefListItem`, `SaveBriefResponse`, `StrategyRecordResponse`, `VisionQAResultSpec`, `JobStatusResponse`, `JobDispatchResponse`). Replaced untyped `any` signatures in `frontend/src/lib/api.ts` with these strongly-typed contracts.
  3. **React 19 Lifecycle Alignment**: Refactored synchronous `setState` calls inside effects. Synchronous storage initialization (`getAuthSession()`) was converted to lazy `useState` initializers. Prop-to-state synchronization in preview panels was transitioned to React-recommended state-during-render patterns (`if (prop !== prevProp) { setPrev(prop); setState(prop); }`), eliminating cascading render warnings.
  4. **JSX Entity Escaping**: Replaced raw quote characters `"` with standard HTML entities `&quot;` in `BackgroundPreviewPanel.tsx` and `StrategyPreviewPanel.tsx`.
  5. **Unused Dead Code**: Removed unused imports across `BriefForm.tsx`, `StudioHeader.tsx`, `HealthDashboard.tsx`, `LoginView.tsx`, `ProductStagePanel.tsx`, and `TechnicalDrawer.tsx`.
  6. **Hook Exhaustive Dependencies**: Refactored `BriefForm.tsx` mount effect to use explicit targeted inline suppression for one-shot mount initialization.
  7. **Result**: **0 errors, 5 warnings** (all 5 remaining warnings are advisory `@next/next/no-img-element` for procedural preview PNGs).

---

### BUG-AUDIT-04: Outdated Documentation (Low)

- **Root Cause**: `README.md` previously reflected only the initial Phase 1 foundation state (referencing 9 foundation tests and incomplete architecture).
- **Resolution**:
  1. Rewrote `README.md` to document the full 9-phase architecture (Phases 1 through 9).
  2. Documented tenant cache isolation, anti-SSRF protections, provenance hash chains, and the 358+ test suite.
  3. Added an explicit table distinguishing local verified simulations from cloud production targets.

---

### BUG-AUDIT-05: Starlette Deprecation Warning (Low)

- **Root Cause**: `backend/app/api/v1/briefs.py` referenced `status.HTTP_422_UNPROCESSABLE_ENTITY`, deprecated by Starlette/FastAPI in favor of RFC 9110 naming.
- **Resolution**: Replaced both occurrences in `briefs.py` with `status.HTTP_422_UNPROCESSABLE_CONTENT`.

---

## 4. Verification Evidence

### 1. Adversarial Tenant Isolation Test Execution
```text
backend/tests/test_cross_tenant_cache_isolation.py::test_cache_key_strict_tenant_scoping PASSED
backend/tests/test_cross_tenant_cache_isolation.py::test_cross_tenant_pipeline_cache_isolation PASSED
backend/tests/test_cross_tenant_cache_isolation.py::test_mandatory_tenant_id_rejection_all_services PASSED
backend/tests/test_cross_tenant_cache_isolation.py::test_service_layer_rejects_job_missing_tenant_id PASSED
============================== 4 passed in 3.00s ==============================
```

### 2. Full Backend Pytest Suite
```text
============================== 358 passed, 1 skipped in 39.15s ==============================
```

### 3. Frontend Static Type Check & Linting
```text
> frontend@0.1.0 npx tsc --noEmit
Exit code: 0 (0 errors)

> frontend@0.1.0 npx eslint src/ --ext .ts,.tsx
✖ 5 problems (0 errors, 5 warnings - all @next/next/no-img-element)
Exit code: 0
```

### 4. Next.js Offline Production Build
```text
▲ Next.js 16.3.6 (Turbopack)
✓ Running next.config.ts took 49ms
  Creating an optimized production build ...
✓ Compiled successfully in 867ms
  Running TypeScript ...
  Finished TypeScript in 2.0s ...
  Collecting page data using 6 workers ...
  Generating static pages using 6 workers (5/5) in 1017ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
└ ○ /dashboard/new
○  (Static)  prerendered as static content
Exit code: 0
```

### 5. Alembic Database Migration Status
```text
INFO  [alembic.runtime.migration] Context impl SQLiteImpl.
INFO  [alembic.runtime.migration] Will assume non-transactional DDL.
0006_tenant_cache_indexes (head)
```

---

## 5. Production Readiness & Environmental Boundaries

To avoid conflating verified local simulation with cloud infrastructure readiness, the operational boundaries are classified below:

| System Layer | Local Verification (Verified in Test Suite) | Production Deployment Requirement (Pending) |
|--------------|---------------------------------------------|--------------------------------------------|
| **Database** | SQLite with `aiosqlite` via SQLAlchemy async engine | Real PostgreSQL cluster with connection pool tuning |
| **Worker Queue** | In-process Async Worker Pool with bounded queue | Distributed Redis instance with Celery worker nodes |
| **File Storage** | `LocalStorageProvider` on local filesystem | AWS S3 / Cloudflare R2 bucket with IAM roles |
| **Vision QA** | Procedural Mock Provider (Deterministic rules) | Google Cloud Vertex AI / Gemini Vision API |
| **Publishing** | Mock Social Publisher & Local Reconciler | Meta Graph API (Requires business verification & live token) |
| **Security** | JWT HS256 with local signing secret | RS256 / OIDC Provider with HSM / KMS secret rotation |

---

## 6. Git Status & Checkpoint Record

- **Safety Checkpoint Commit**: `c3e010b` (`checkpoint: protect pre-recovery working tree (Phase 8-9)`)
- **Hardening Commit**: `d35158a` (`fix(hardening): resolve audit findings BUG-AUDIT-01 to BUG-AUDIT-05`)
- **Docs Checkpoint Commit**: `cfd83c8` (`docs: add comprehensive recovery and hardening phase report`)
- **Frontend Refactor Commit**: `eb29737` (`refactor(frontend): resolve react-hooks/exhaustive-deps in BriefForm and clean unused icons`)
- **Contract Hardening Commit**: `17b2cba` (`fix(hardening): make tenant_id strictly mandatory in cache-key helpers and reject invalid tenant callers`)
- **Active Working Branch**: `recovery-phase8-9-cache-hardening`
- **Working Tree Cleanliness**: Zero untracked files, zero secret exposure, fully reproducible offline builds.
