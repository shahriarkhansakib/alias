# Database & Persistence Architecture (Phase 7.1)

## Overview

Alias Img-Gen uses an asynchronous SQLAlchemy 2 architecture with dual-dialect persistence:
1. **Production Persistence**: High-throughput, connection-pooled PostgreSQL with native `JSONB`, strict foreign key cascade enforcement, and authoritative schema tracking via Alembic migrations.
2. **Local Development / Offline Testing**: Frictionless async SQLite (`sqlite+aiosqlite`) allowing rapid onboarding and isolated in-memory test suites without external service dependencies.

---

## 1. Database Configuration & Environment Variables

The database layer is configured entirely via environment variables defined in [Settings](file:///c:/Users/annin/Desktop/Alias_Img-Gen/backend/app/core/config.py):

| Variable | Type | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | String | `sqlite+aiosqlite:///./alias_imggen.db` | SQLAlchemy async connection URI. In production, must be PostgreSQL (`postgresql+asyncpg://...`). |
| `ENVIRONMENT` | String | `development` | Deployment environment (`development`, `staging`, `production`). |
| `DB_POOL_SIZE` | Integer | `10` | Base connection pool size (PostgreSQL). |
| `DB_MAX_OVERFLOW` | Integer | `20` | Max overflow connections beyond pool size (PostgreSQL). |
| `DB_POOL_TIMEOUT` | Integer | `30` | Seconds to wait before timing out on connection checkout. |
| `DB_POOL_RECYCLE` | Integer | `1800` | Seconds after which idle connections are recycled (30 minutes). |
| `DB_POOL_PRE_PING` | Boolean | `True` | Liveness health check executed on connection checkout. |

### Production Safeguard Invariant
If `ENVIRONMENT=production` and `DATABASE_URL` begins with `sqlite`, application startup will immediately fail with a `ValueError`. Silent fallbacks to SQLite in production are strictly forbidden.

---

## 2. PostgreSQL Setup

### Docker Compose
A production-matching PostgreSQL 16 Alpine service is provided in [docker-compose.yml](file:///c:/Users/annin/Desktop/Alias_Img-Gen/docker-compose.yml):

```bash
docker compose up -d db
```

Default credentials:
- **Host**: `localhost` (or `db` within Docker network)
- **Port**: `5432`
- **Username**: `postgres`
- **Password**: `postgres`
- **Database**: `alias_imggen`
- **URL**: `postgresql+asyncpg://postgres:postgres@localhost:5432/alias_imggen`

### Managed Cloud Databases (AWS RDS / GCP Cloud SQL / Supabase)
For managed cloud deployments:
1. Provision PostgreSQL 15+ instance.
2. Provide the async connection string format:
   ```
   DATABASE_URL="postgresql+asyncpg://<username>:<password>@<db-host>:5432/<dbname>?ssl=require"
   ```
3. Set `ENVIRONMENT="production"`.

---

## 3. Alembic Migration Workflow

In production, `Base.metadata.create_all()` is strictly bypassed at startup. All schema management must be performed through Alembic migrations.

### Running Migrations

From the `backend/` directory:

```bash
# Apply all pending migrations to head
alembic upgrade head

# Rollback the last migration
alembic downgrade -1

# Rollback to clean database
alembic downgrade base

# View current revision
alembic current

# View migration history
alembic history --verbose
```

### Generating Static SQL (Offline Mode)
To inspect DDL before applying migrations in locked enterprise environments:
```bash
alembic upgrade head --sql
```

### Creating New Migrations
When modifying SQLAlchemy models:
```bash
alembic revision --autogenerate -m "describe_schema_change"
```
*Always inspect generated migration scripts to verify constraints and dialect-specific imports.*

---

## 4. Authoritative Schema & Graph Invariants

Phase 7.1 preserves the Phase 6.2 strict creative graph:

```mermaid
graph TD
    Job["CreativeJob (creative_jobs)"]
    Brief["AdBrief (ad_briefs)"]
    Strategy["CreativeStrategyRecord (creative_strategies)"]
    Background["GeneratedBackgroundRecord (generated_backgrounds)"]
    Composite["CompositedCreativeRecord (composited_creatives)"]
    FinalAd["FinalRenderedCreativeRecord (final_rendered_creatives)"]

    Job -->|ForeignKey SET NULL| Brief
    Job -->|ForeignKey SET NULL| Strategy
    Strategy -->|ForeignKey CASCADE| Brief
    Background -->|ForeignKey CASCADE| Job
    Background -->|ForeignKey CASCADE| Strategy
    Composite -->|ForeignKey CASCADE| Job
    Composite -->|ForeignKey CASCADE| Background
    FinalAd -->|ForeignKey CASCADE| Job
    FinalAd -->|ForeignKey CASCADE| Composite
```

### Dialect-Compatible Types
- **JSON / JSONB**: Models use `CompatibleJSON = JSON().with_variant(JSONB, "postgresql")`, compiling to high-performance indexed `JSONB` on PostgreSQL while remaining fully operational on SQLite.
- **Foreign Key Actions**:
  - `ondelete="CASCADE"` is defined on parent-child containment relationships (`job_id`, `strategy_id`, `background_id`, `composite_id`).
  - `ondelete="SET NULL"` is used where jobs maintain audit history even if a temporary brief is removed.
- **Indexing**: All foreign keys, primary keys (`id: UUID String(36)`), platforms, and lifecycle statuses (`validation_status`, `status`, `qa_status`, `cache_key`) are indexed for sub-millisecond retrieval.

---

## 5. Concurrency & Transaction Management

- Sessions are acquired per-request via `get_db()`.
- Unhandled exceptions trigger an explicit `await session.rollback()` prior to closing the connection and returning it to the pool.
- Session configuration uses `expire_on_commit=False, autocommit=False, autoflush=False` to prevent partial commits or race conditions during multi-step pipeline validations.
