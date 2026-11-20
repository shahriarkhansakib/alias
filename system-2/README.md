# Alias Img-Gen: AI Advertisement Creative Automation Platform

> **"AI decides the creative direction. Deterministic code controls the final advertisement."**  
> **"Validate → Understand → Strategize → Generate → Composite → Render → Validate → Approve"**

---

## Architecture Overview (Phases 1–9)

Alias Img-Gen is a multi-tenant, enterprise advertisement generation and publishing pipeline. It combines generative AI for scenic background generation and strategy ideation with deterministic computer vision, layout engines, and claim validation gates to produce pixel-perfect, compliant marketing assets.

### Pipeline Stages

1. **Phase 1 — Foundation & Lifecycle**: FastAPI backend, asynchronous database lifecycle (SQLite for frictionless local development, PostgreSQL ready via `asyncpg`), in-process worker pool, and provider abstractions.
2. **Phase 2 — Payload Gate**: Strict Pydantic v2 Ad Brief validation, factual copy policy enforcement, and brief persistence.
3. **Phase 3 — Asset Gate**: Anti-SSRF URL validation, DNS pinning, private IP range blocking, image format verification, alpha transparency detection, and bounding box computation.
4. **Phase 4 — Creative Strategy & Claim Validation**: Concept ideation, visual direction, deterministic copy generation, template matching, and factual claim verification against trusted brief data.
5. **Phase 5 — Background Generation & QA**: AI platform background generation (Instagram, Facebook, LinkedIn) with rule-based QA scoring (dimensions, negative space, watermark detection, product safe-zones).
6. **Phase 6 — Product Cutout & Compositing**: Authentic product cutout compositing onto generated backgrounds with deterministic drop-shadow synthesis, boundary checks, and integrity hashing.
7. **Phase 7 — Final Ad Rendering & Advisory Vision QA**: Deterministic typography, CTA badge rendering, auto-scrim readability, provenance hash chain calculation, and optional advisory Vision QA inspection.
8. **Phase 8 — Multi-Tenant Creative Studio**: JWT-based tenant authentication, tenant isolation at all service and database layers, and Next.js 16 / React 19 Creative Studio workspace.
9. **Phase 9 — Social Media Publishing Infrastructure**: Multi-platform publishing dispatch (Mock & Meta Graph API for Facebook/Instagram), idempotency enforcement, state reconciliation, and retry policies.

---

## System Hardening & Tenant Isolation

- **Tenant-Scoped Caching**: Background, composite, and final ad generation caches are strictly scoped by `tenant_id`. Database composite indexes (`tenant_id`, `cache_key`) enforce query isolation, preventing cross-tenant artifact reuse or leak.
- **Offline Build Reproducibility**: Frontend builds with zero external network font dependencies using a system font stack.
- **Anti-SSRF & DNS Security**: Asset gate resolves hostnames and verifies target IPs against private/loopback/cloud metadata ranges before initiating HTTP requests.
- **Deterministic Provenance Chain**: Every final ad artifact contains an SHA-256 provenance hash chain linking source assets, cutouts, backgrounds, copy specs, and renderer versions.

---

## Project Structure

```text
Alias_Img-Gen/
├── backend/
│   ├── alembic/                 # Database migrations (0001 through 0006)
│   ├── app/
│   │   ├── api/v1/              # Versioned API routes (briefs, strategies, backgrounds, composites, final-ads, publishing)
│   │   ├── core/                # Configuration, async DB session, logging, security
│   │   ├── models/              # SQLAlchemy ORM declarative models (AdBrief, FinalAd, Tenant, etc.)
│   │   ├── providers/           # Storage, LLM, ImageGen, VisionQA, and Publishing providers
│   │   ├── schemas/             # Pydantic v2 schemas and validation models
│   │   ├── services/            # Pipeline domain services, claim validation, compositing, QA
│   │   └── main.py              # FastAPI application entrypoint
│   ├── tests/                   # Pytest async test suite (356 passing tests)
│   ├── requirements.txt
│   └── alembic.ini
├── frontend/
│   ├── src/
│   │   ├── app/                 # Next.js 16 App Router (dashboard, workspace, studio)
│   │   ├── components/          # React 19 UI components (preview panels, technical drawer, forms)
│   │   └── lib/                 # Strongly-typed API client, auth context, TypeScript definitions
│   ├── package.json
│   ├── next.config.ts
│   └── eslint.config.mjs
├── docs/                        # Architecture reports, audits, and recovery logs
├── storage/                     # Local filesystem storage repository
├── docker-compose.yml           # PostgreSQL & Redis infrastructure configuration
└── README.md
```

---

## Local Development Setup

### 1. Prerequisites
- **Python**: 3.10+ (Tested on Python 3.14.1)
- **Node.js**: 20+ (Tested on Node.js 24)
- **npm**: 10+

### 2. Backend Setup

```powershell
# 1. Activate virtual environment
.\backend\venv\Scripts\Activate.ps1

# 2. Run database migrations to head
cd backend
alembic upgrade head
cd ..

# 3. Start the FastAPI development server
uvicorn app.main:app --reload --app-dir backend --port 8000
```

- API Documentation: [http://localhost:8000/api/v1/docs](http://localhost:8000/api/v1/docs)
- Health Check: [http://localhost:8000/api/v1/health](http://localhost:8000/api/v1/health)
- System Status: [http://localhost:8000/api/v1/status](http://localhost:8000/api/v1/status)

### 3. Frontend Setup

```powershell
cd frontend
npm install
npm run dev
```

- Creative Studio Dashboard: [http://localhost:3000](http://localhost:3000)

---

## Verification & Testing

### Backend Test Suite
```powershell
cd backend
.\venv\Scripts\pytest tests/ -v
```
- **356 passed, 1 skipped** (1 external live Facebook API network test skipped in local dev).
- Full suite covers multi-tenancy, cross-tenant cache isolation, SSRF defenses, creative strategies, background QA, product compositing, deterministic rendering, and publishing lifecycles.

### Frontend Quality Checks
```powershell
cd frontend

# TypeScript check (0 errors)
npx tsc --noEmit

# ESLint check (0 errors)
npx eslint src/ --ext .ts,.tsx

# Offline production build (zero network font dependencies)
npm run build
```

---

## Environment & Production Boundaries

| Capability | Local Verification | Production Target |
|------------|-------------------|-------------------|
| **Database** | SQLite via `aiosqlite` (Verified) | PostgreSQL via `asyncpg` |
| **Worker Queue** | In-process Async Worker Pool (Verified) | Redis + Celery |
| **Asset Storage** | Local filesystem storage provider (Verified) | AWS S3 / Cloudflare R2 |
| **Vision QA** | Procedural Mock Provider (Verified) | Vertex AI / Gemini Vision API |
| **Social Publishing**| Mock Publisher & Reconciler (Verified) | Meta Graph API (Verified with Token) |

> [!NOTE]
> Local development runs fully functional without external cloud credentials or services. All pipeline stages can be tested end-to-end using procedural mock providers.
