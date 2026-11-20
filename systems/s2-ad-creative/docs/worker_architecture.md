# Production Worker Architecture: Redis + Celery (Phase 7.3)

## 1. Overview

Phase 7.3 decouples long-running creative operations (AI background synthesis, product cutout extraction, multi-layer image compositing, and typography rendering) from synchronous FastAPI request-response cycles.

```
FastAPI Application
       │
       ▼ (create/update job record, commit)
PostgreSQL (Authoritative CreativeJob)
       │
       ▼ (dispatch minimal task identifier)
JobDispatcher Interface
   ├── InProcessJobDispatcher (WORKER_TYPE=async: background asyncio task, zero external deps)
   └── CeleryJobDispatcher   (WORKER_TYPE=celery: production-grade durable queue)
            │
            ▼
       Redis Queue ("creative")
            │
            ▼
       Celery Worker Process
            │
            ▼ (load state, execute authoritative services)
       Creative Services (BackgroundService, CompositeService, FinalAdService)
            │
            ▼ (atomic results & state transitions)
       PostgreSQL + StorageProvider (S3 / R2 / Local)
```

---

## 2. Dispatcher Abstraction

All endpoints and pipeline orchestrators interact exclusively with the abstract `JobDispatcher` interface defined in [`backend/app/workers/dispatcher.py`](file:///backend/app/workers/dispatcher.py):

```python
class JobDispatcher(ABC):
    @abstractmethod
    async def dispatch(
        self,
        job_id: str,
        stage: str,
        params: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Dispatches stage execution and returns a task tracking identifier."""
```

API routes never import Celery internals or task functions directly; instead, they inject `get_job_dispatcher()`.

### Modes of Operation:
1. **Local Development (`WORKER_TYPE=async`)**:
   - Uses `InProcessJobDispatcher`.
   - Spawns background asynchronous coroutines (`asyncio.create_task`) executing the exact same `execute_job_stage` engine.
   - Zero Redis or Celery dependency required for running the complete test suite and local UI.
2. **Production (`WORKER_TYPE=celery`)**:
   - Uses `CeleryJobDispatcher`.
   - Submits task payloads to Redis queue `creative` via `process_creative_stage.apply_async(...)`.
   - Application startup validates and raises `ValueError` immediately if `WORKER_TYPE=celery` but `REDIS_URL` is empty.

---

## 3. Environment Configuration

| Variable | Development Default | Production | Description |
|---|---|---|---|
| `WORKER_TYPE` | `async` | `celery` | Selects worker dispatcher (`async` or `celery`). |
| `REDIS_URL` | *(empty)* | `redis://redis.internal:6379/0` | Connection string for Redis broker & result backend. |
| `CELERY_TASK_DEFAULT_QUEUE` | `creative` | `creative` | Dedicated queue for creative generation workloads. |

Startup validation rule:
```python
if self.WORKER_TYPE.lower() == "celery" and not self.REDIS_URL:
    raise ValueError("Celery worker is selected but REDIS_URL is not configured.")
```

---

## 4. Minimal Task Payloads & Authoritative Sources

Celery task payloads are strictly minimal. Neither large JSON brief specifications nor raw image bytes are sent through Redis:

```json
{
  "job_id": "8f86f32e-503d-4c31-97b7-58b991b5c469",
  "stage": "BACKGROUND",
  "params": {
    "platform": "instagram",
    "strategy_id": "b3e0c01a-8bb7-4f93-86b7-a365bb511dd7",
    "force_regenerate": false
  }
}
```

The worker uses `job_id` to query authoritative records from PostgreSQL and download authenticated images via the configured `StorageProvider`.

---

## 5. Idempotency & Duplicate Delivery Safety

Celery operates on an "at least once" delivery guarantee. Tasks may be re-delivered upon worker timeout or reconnection.

The execution engine in [`backend/app/workers/job_runner.py`](file:///backend/app/workers/job_runner.py) guarantees idempotency before invoking any external service:

1. **Background Generation**: Checks for existing `GeneratedBackgroundRecord` where `qa_status IN ('PASS', 'WARNING')` for the specific `(job_id, strategy_id, platform)`. If found and `force_regenerate=False`, returns the existing record immediately (`is_cached=True`).
2. **Product Cutout**: Checks storage for existing validated cutout key for `job_id`.
3. **Compositing**: Checks for existing `CompositedCreativeRecord` matching `(job_id, background_id, platform)`.
4. **Final Ad Rendering**: Checks for existing `FinalRenderedCreativeRecord` matching `(job_id, composite_id, platform)`.

Duplicate tasks never trigger duplicate asset synthesis or overwrite existing verified output.

---

## 6. Two-Tier Retry Interaction

The system coordinates two independent retry layers:

| Layer | Responsibility | Trigger | Max Retries | Policy |
|---|---|---|---|---|
| **Celery Task Layer** | Infrastructure resilience | Network disconnect, Redis broker timeout, transient storage 503 | **3** | Exponential backoff (`default_retry_delay=5s`, `backoff=True`). |
| **Service QA Layer** | Creative output compliance | AI background text/watermark artifact, alignment QA score below threshold | **3** (bounded) | Targeted prompt modulation via `attempt_number` recorded in DB. |

**Critical Invariant**: Deterministic validation errors (e.g., Gate rejections, invalid asset MIME types, relationship graph mismatches, 4xx HTTP exceptions) **never** trigger Celery retries. They fail immediately, persist error diagnostic state to `CreativeJob`, and abort execution without burning broker cycles.

---

## 7. Database Transaction Boundaries & Crash Recovery

To prevent connection starvation and database lock escalation during slow AI generation or image downloads:
1. Job status is updated to active processing state (e.g. `BACKGROUND_GENERATION`) and committed to PostgreSQL.
2. The long-running computation (AI provider call, cutout extraction, PIL rasterization) is executed **outside** of any database transaction.
3. Upon completion, a short-lived transaction writes the resulting record (`GeneratedBackgroundRecord`, `CompositedCreativeRecord`, or `FinalRenderedCreativeRecord`), updates `CreativeJob.status` (e.g. `BACKGROUND_APPROVED`), and commits atomically.
4. If a worker crashes midway, the job remains in its recorded active stage with a timestamp. The job can be safely re-dispatched; the idempotency layer resumes from the last completed stage.

---

## 8. Polling and Dispatch API

### 1. Stage Dispatch:
`POST /api/v1/jobs/{job_id}/dispatch`
```json
{
  "stage": "BACKGROUND",
  "params": {
    "platform": "instagram"
  }
}
```
**Response (200 OK - Immediate)**:
```json
{
  "job_id": "8f86f32e-503d-4c31-97b7-58b991b5c469",
  "stage": "BACKGROUND",
  "status": "QUEUED",
  "task_id": "celery-3b1bf386-8f2e-4b95-a226-eb52c7b508f7"
}
```

### 2. Job Status Polling:
`GET /api/v1/jobs/{job_id}`
**Response (200 OK)**:
```json
{
  "id": "8f86f32e-503d-4c31-97b7-58b991b5c469",
  "brief_id": "...",
  "strategy_id": "...",
  "status": "BACKGROUND_APPROVED",
  "current_stage": "AI Background Generation",
  "progress_pct": 60,
  "stage_data": {
    "resource_id": "bg-12345",
    "duration_s": 0.45
  },
  "created_at": "2026-09-28T02:20:00Z",
  "updated_at": "2026-09-28T02:20:01Z"
}
```

---

## 9. Commands & Operational Runbook

### Local Development (Default):
```bash
# Terminal 1: Backend API (in-process async dispatcher)
cd backend
.\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2: Frontend
cd frontend
npm run dev
```

### Production Deployment (Redis + Celery):
```bash
# 1. Start Redis Server
redis-server --port 6379

# 2. Start Celery Worker (dedicated creative queue)
cd backend
celery -A app.workers.celery_app.celery_app worker -Q creative --concurrency=4 --loglevel=info

# 3. Start FastAPI Server
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```
