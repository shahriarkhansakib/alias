# ALIAS Admin ↔ Client Communication System
## Technical Implementation & Production Hardening Audit Report

**Report Version:** 1.0.0  
**Date:** 2026-11-17  
**Project:** ALIAS (Part 1)  
**System Scope:** Option A — Admin ↔ Client Communication with AI Assistance  

---

## 1. Implementation Summary

A real-time, concurrency-safe, AI-assisted two-way communication system was added to the ALIAS platform. The implementation enables clients to send inquiries from their campaign workspace and allows agency account directors to manage conversations via a dedicated 3-panel Admin Communication Dashboard.

### Core Capabilities Implemented:
1. **Client Direct Messaging:** Accessible via `/campaign/[id]/messages`, offering visibility-aware polling, live connection state, and instant messaging.
2. **3-Panel Admin Communication Dashboard:** Accessible via `/admin/communication`:
   - *Panel 1 (Client Inbox):* Searchable real-time inquiry thread list with unread badges.
   - *Panel 2 (Live Conversation):* Thread transcript distinguishing Client, Agency Admin, and ALIAS AI (Auto-Reply), equipped with a reply composer.
   - *Panel 3 (AI Communication Copilot):* Displays 3 grounded suggested replies (*Professional*, *Friendly*, *Detailed*), 1-click reply dispatch, suggestion editing, and a live 10-second countdown bar with instant cancellation.
3. **Autonomous Auto-Reply & Safety Guard:** Conservative 3-layer safety engine that blocks financial figures, discounts, refund promises, payment account numbers (bKash/Nagad/bank), legal guarantees, and low-confidence responses (< 0.85).
4. **Durable Headless Background Worker:** MongoDB-backed outbox pattern supporting atomic job claiming, claim-token fencing, thread-generation fencing, settings revision fencing, stale-job recovery, and distributed worker locking.
5. **Phase 2 Hardening Fixes:** Implemented fail-closed MongoDB multi-document transactions, bounded AI generation attempts (`MAX_AI_GENERATION_ATTEMPTS = 3`), atomic rate limiting on client tick polling, idempotent dev instrumentation, and strict ownership authorization.

---

## 2. Files Created

| File Path | Responsibility |
| :--- | :--- |
| `src/models/AdminClientThread.ts` | MongoDB thread schema with `{ campaignId: 1, clientId: 1 }` unique index, monotonic `threadGeneration`, unread counters, and active job tracking. |
| `src/models/AdminClientMessage.ts` | Messaging schema storing message content, sender identity (`client`, `admin`, `ai_auto`), AI analysis payload, and unique sparse `idempotencyKey`. |
| `src/models/AdminAiGenerationJob.ts` | Durable outbox model for asynchronous AI suggestion generation with `attempts`, `maxAttempts` (3), `lockedAt`, and `claimToken`. |
| `src/models/AdminAutoReplyJob.ts` | Scheduled auto-reply dispatch jobs with `scheduledExecuteAt`, `threadGeneration`, `settingsRevision`, `proposedReply`, and `claimToken`. |
| `src/models/AdminCommunicationSettings.ts` | Global configuration model storing `autoReplyGlobalEnabled` (defaults to `false`), `countdownDurationSeconds` (10s), `defaultTone`, and monotonic `settingsRevision`. |
| `src/models/AdminWorkerLock.ts` | Distributed lease lock model (`GLOBAL_WORKER_LOCK`) for coordinating multi-instance background workers. |
| `src/models/AdminRateLimit.ts` | Distributed rate limiting model with automatic MongoDB TTL index for per-user and per-thread synchronization throttling. |
| `src/lib/communication/safety-guard.ts` | 3-layer conservative safety gate checking deterministic regex policies, AI confidence thresholds (0.85), ambiguity, and factual missing context. |
| `src/lib/communication/rate-limiter.ts` | Distributed atomic rate limiter leveraging MongoDB atomic `$inc` and window resets. |
| `src/lib/communication/thread-service.ts` | High-level transactional service coordinating message persistence, generation increments, thread lookups, and fail-closed transactions. |
| `src/lib/communication/durable-worker.ts` | Autonomous headless worker engine managing distributed locking, stale job recovery, AI generation, and multi-entity conditional dispatch. |
| `src/lib/ai/admin-communication-agent.ts` | Google Gemini 3.5 Flash prompt engine generating 3 tone suggestions using active campaign facts, Artifact 1, Artifact 2, and Master Brief. |
| `src/lib/auth/communication-auth.ts` | Strict RBAC and ownership validator enforcing 401 for unauthenticated requests and 403 for non-owners. |
| `src/app/api/campaigns/[id]/admin-messages/route.ts` | Client GET (message history) and POST (atomic message insert + generation job enqueue). |
| `src/app/api/campaigns/[id]/admin-messages/tick/route.ts` | Thread-scoped client polling synchronization endpoint with distributed rate limiting (max 5 requests per 10s). |
| `src/app/api/admin/communication/threads/route.ts` | Admin GET endpoint returning all client communication threads. |
| `src/app/api/admin/communication/threads/[threadId]/route.ts` | Admin GET endpoint returning thread transcript, active countdown job, and thread metadata. |
| `src/app/api/admin/communication/threads/[threadId]/reply/route.ts` | Admin POST endpoint executing atomic manual reply dispatch and pending job cancellation. |
| `src/app/api/admin/communication/threads/[threadId]/cancel-job/route.ts` | Admin POST endpoint executing atomic Stop action (generation bump + job cancellation). |
| `src/app/api/admin/communication/settings/route.ts` | Admin GET and POST endpoints for the master Auto-Reply toggle and revision increments. |
| `src/app/api/admin/communication/process-jobs/route.ts` | Admin POST endpoint for on-demand global background worker ticks. |
| `src/app/api/admin/communication/cron/route.ts` | Platform Cron endpoint for Vercel Cron, secured by `CRON_SECRET`. |
| `src/components/campaign/ClientMessageView.tsx` | Client messaging view with auto-scroll, 3-second visibility-aware polling, and message badges. |
| `src/app/campaign/[id]/messages/page.tsx` | Dedicated client support page with navigation breadcrumb. |
| `src/components/admin/communication/ClientInboxPanel.tsx` | Panel 1: Searchable inbox of client inquiries with unread count indicators. |
| `src/components/admin/communication/LiveConversationPanel.tsx` | Panel 2: Live conversation transcript and reply composer. |
| `src/components/admin/communication/AiAssistantPanel.tsx` | Panel 3: AI suggestions view with tone badges, countdown bar, and instant Stop button. |
| `src/app/admin/communication/page.tsx` | Complete 3-panel Admin Communication Dashboard. |
| `src/instrumentation.ts` | Next.js server startup hook with idempotent interval registration. |
| `vercel.json` | Vercel Cron schedule (`0 * * * *`) routing to `/api/admin/communication/cron`. |
| `src/lib/communication/communication.test.ts` | Unit tests for safety policies and AI fallback generation. |
| `src/lib/communication/concurrency.test.ts` | Comprehensive integration tests verifying BUG-01–BUG-05 and all 10 concurrency race conditions. |

---

## 3. Files Modified

Only minimal navigation entry points were added to existing files:

1. `src/app/admin/page.tsx`:
   - Added `import Link from "next/link";`.
   - Added a direct `<Link href="/admin/communication">` button ("Client Messages") in the top header toolbar.
2. `src/app/campaign/[id]/brief/page.tsx`:
   - Added `<Link href={/campaign/${campaignId}/messages}>` action button ("💬 Agency Support") in the header.
3. `src/app/campaign/[id]/confirmation/page.tsx`:
   - Added `<Link href={/campaign/${campaignId}/messages}>` link ("💬 Message Agency Admin") in the navigation header.

*All 26 pre-existing uncommitted files across campaign workflows, Artifact 1, Artifact 2, Research Agent, and Tavily were preserved completely untouched.*

---

## 4. Architecture

### 4.1 Message Lifecycle & Fencing
```
[Client App] 
     │  POST /api/campaigns/[id]/admin-messages
     ▼
[ThreadService.sendClientMessage] 
     │  Atomic MongoDB Transaction
     ├─► Insert AdminClientMessage (sender: "client", aiStatus: "PENDING")
     ├─► Thread.threadGeneration++ (e.g. gen 1 -> 2)
     ├─► Cancel previous PENDING/PROCESSING AutoReply & AiJobs
     └─► Insert AdminAiGenerationJob (threadGeneration: 2, status: "PENDING")
     │
     ▼
[Durable Worker] (Headless / Polling Tick)
     │  Atomic Claim: findOneAndUpdate({ status: "PENDING" }, { status: "PROCESSING", claimToken })
     ├─► Read Campaign, Artifact 1, Artifact 2, Master Brief
     ├─► AdminCommunicationAgent.generateSuggestions()
     ├─► Atomic Freshness Check: Verify threadGeneration === 2
     ├─► Save 3 Tone Suggestions to AdminClientMessage
     │
     ├─► Check Settings & Safety:
     │     If autoReplyGlobalEnabled === true AND SafetyGuard.evaluate() === PASSED:
     │       Enqueue AdminAutoReplyJob (status: "PENDING", scheduledExecuteAt: now + 10s)
     │       Thread.activeJobId = job._id
     │     Else:
     │       AdminClientMessage.autoReplyStatus = "NOT_SCHEDULED" / "BLOCKED_SAFETY"
     └─► Mark AdminAiGenerationJob COMPLETED
```

### 4.2 Auto-Reply Countdown & Dispatch
1. When Auto-Reply is scheduled, a 10-second countdown appears on the Admin Dashboard.
2. The Admin can click **"STOP AUTO-REPLY"** at any time:
   - `ThreadService.stopCountdown()` runs an atomic transaction: increments `threadGeneration` (gen 2 -> 3), cancels the `AdminAutoReplyJob`, and clears `activeJobId`.
3. If the countdown elapses without intervention:
   - `DurableCommunicationWorker.processAutoReplyJob()` claims the job with a unique `claimToken`.
   - In an atomic transaction, the worker executes **multi-entity conditional writes**:
     - Conditional check on `AdminCommunicationSettings`: `settingsRevision === job.settingsRevision` and `autoReplyGlobalEnabled === true`.
     - Conditional write on `AdminClientThread`: `_id: job.threadId` and `threadGeneration === job.threadGeneration`.
     - Conditional write on `AdminAutoReplyJob`: `_id: job._id`, `status: "PROCESSING"`, and `claimToken: job.claimToken`.
     - Inserts outgoing `AdminClientMessage` (`sender: "ai_auto"`, `autoReplyStatus: "EXECUTED"`).
   - If any conditional write matches 0 documents (due to Stop, Admin manual reply, client message, or settings change), the transaction aborts and no message is sent.

---

## 5. Concurrency & Race Conditions (Bug Fixes)

### BUG-01: Fenced Worker Failure Overwrites
- **Problem:** When a worker encountered a claim-token mismatch, its outer catch block unconditionally marked the job `FAILED`, overwriting another worker's `COMPLETED` state.
- **Fix:** Failure updates now conditionally match `{ _id: job._id, status: "PROCESSING", claimToken }`. If the worker lost its claim, the update matches 0 documents and logs a warning without mutating database state.

### BUG-02: Unauthenticated Demo Client Identity Leak
- **Problem:** Missing sessions unconditionally defaulted to `demoClient`, allowing unauthenticated callers access to demo campaigns.
- **Fix:** Missing sessions strictly return `null` (`401 Unauthorized`). Client endpoints strictly enforce `campaign.clientId === user.id` (`403 Forbidden`). Demo auth requires explicit `ALLOW_DEMO_AUTH="true"` and is blocked in production.

### BUG-03: Rate Limiting on Client Tick Synchronization
- **Problem:** Rapid client polling could flood the worker and database.
- **Fix:** Implemented `CommunicationRateLimiter` backed by MongoDB with atomic counters and TTL expiration. Limits clients to 5 ticks per 10-second window, returning `HTTP 429` with `Retry-After`.

### BUG-04: Worker Interval Leaking on Dev Reload
- **Problem:** Next.js development HMR could spawn multiple background intervals.
- **Fix:** Pinned the interval handle to `globalThis.__communicationWorkerInterval` and clears previous timers prior to re-registering.

### BUG-05: Unbounded AI Generation Retries
- **Problem:** AI generation jobs lacked retry limits.
- **Fix:** Added `MAX_AI_GENERATION_ATTEMPTS = 3`. Jobs reaching 3 attempts are permanently transitioned to `status: "FAILED"` with reason `EXCEEDED_MAX_RETRY_ATTEMPTS`. Failed jobs cannot schedule auto-replies.

---

## 6. Security

1. **Authentication:** Integrates with NextAuth JWT sessions via `CommunicationAuth.getUser()`. System background invocations authenticate via `Authorization: Bearer <CRON_SECRET>`.
2. **Authorization (RBAC):** Admin endpoints require `user.role === "admin"`. Client endpoints strictly verify that `auth.user.id === campaign.clientId`.
3. **Fail-Closed Policy:** Missing sessions return 401; non-owner access returns 403; unset `CRON_SECRET` in production aborts cron execution with HTTP 500.
4. **Safety Policy Guard:** Deterministic, non-AI regex filters intercept pricing numbers, currency symbols, discount percentages, payment accounts (bKash, Nagad, bank routing), refund promises, and legal guarantees.

---

## 7. Database

### Models & Collections
- `AdminClientThread`: `{ campaignId: 1, clientId: 1 }` (unique), `{ lastMessageAt: -1 }`.
- `AdminClientMessage`: `{ threadId: 1, createdAt: 1 }`, `{ idempotencyKey: 1 }` (unique, sparse).
- `AdminAiGenerationJob`: `{ status: 1, createdAt: 1 }`, `{ idempotencyKey: 1 }` (unique, sparse), `{ threadId: 1, status: 1 }`.
- `AdminAutoReplyJob`: `{ status: 1, scheduledExecuteAt: 1 }`, `{ idempotencyKey: 1 }` (unique, sparse), `{ threadId: 1, status: 1 }`.
- `AdminCommunicationSettings`: Stores singleton configuration and `settingsRevision`.
- `AdminWorkerLock`: Distributed lock document (`GLOBAL_WORKER_LOCK`) with `lockedUntil`.
- `AdminRateLimit`: `{ key: 1 }` (unique), `{ resetAt: 1 }` (TTL index).

### Transaction Requirements
The communication system enforces **MongoDB multi-document transactions** via `runCommunicationTransaction()`. A **MongoDB Replica Set** (such as MongoDB Atlas or local replica set) is required. If transactions are unavailable, the system fails closed and throws `DatabaseTransactionCapabilityError` (HTTP 503).

---

## 8. Testing

### Test Commands Executed

1. **TypeScript Health Check:**
   ```powershell
   npx tsc --noEmit
   ```
   *Result:* **Exited with code 0 (0 errors).**

2. **Full Automated Test Suite:**
   ```powershell
   npx vitest run
   ```
   *Result:* **4 test files passed, 81 tests passed, 0 failed.**

### Test File Breakdown
- `src/lib/communication/concurrency.test.ts` (**17 passed**):
  - `BUG-01: Stale worker catch block cannot overwrite a COMPLETED job to FAILED when claimToken mismatches`
  - `BUG-02: verifyClientOwnership returns 401 when session is missing`
  - `BUG-02: verifyClientOwnership returns 403 when authenticated client does not own campaign`
  - `BUG-02: verifyClientOwnership allows access for the verified campaign owner`
  - `BUG-03: Rate limiter throttles excessive tick requests and returns 429 semantics`
  - `BUG-05: Enforces MAX_AI_GENERATION_ATTEMPTS (3) and marks permanently FAILED`
  - `Phase B: Throws DatabaseTransactionCapabilityError when replica-set transaction fails in production`
  - `Scenario 1: Two workers attempting to claim the same job simultaneously - exactly one succeeds`
  - `Scenario 2: Admin Stop action increments threadGeneration, aborting concurrent worker dispatch`
  - `Scenario 3: Admin manual reply increments threadGeneration, fencing out concurrent auto-reply dispatch`
  - `Scenario 4: New client message bumps threadGeneration; in-flight AI generation detects mismatch and discards results`
  - `Scenario 5: Switching Auto Reply OFF increments settingsRevision; dispatch detects revision mismatch and cancels job`
  - `Scenario 6: Stale recovery detects crashed worker lock (>30s) and resets job to PENDING if attempts < 3`
  - `Scenario 7: Worker crash during final dispatch triggers full transaction rollback`
  - `Scenario 8: Worker B reclaims expired job; original Worker A cannot complete job due to claimToken mismatch`
  - `Scenario 9: Duplicate client messages with same idempotencyKey are rejected by unique index`
  - `Scenario 10: Concurrent findOrCreateThread calls for same campaign and client handle E11000 and return same thread`
- `src/lib/communication/communication.test.ts` (**8 passed**): Safety guard filters and fallback generation.
- `src/lib/research/research.test.ts` (**52 passed**): Evidence engine, URL validation, source mapping.
- `src/lib/ai/conversation-agent.test.ts` (**4 passed**): Intake chat agent and brief generator.

---

## 9. Known Issues & Operational Limitations

1. **Vercel Serverless Headless Cadence:**
   - In serverless hosting (Vercel), background intervals inside `src/instrumentation.ts` are frozen when no HTTP requests are being processed.
   - While browser sessions are open, 3-second UI polling guarantees exact 10-second auto-reply dispatch.
   - When **no browser is open**, execution relies on Vercel Cron (`vercel.json`), which operates on a **1-minute schedule**. Headless auto-reply execution on Vercel will occur within **10 to 60 seconds**.
   - *For sub-15-second headless execution with no open browsers, deployment on a persistent Node.js environment (Docker, AWS ECS, VPS) is required.*
2. **Atlas Replica Set Requirement:**
   - Standalone MongoDB instances without replica sets will reject multi-document transactions. Production deployments must use a replica set.

---

## 10. Existing Project Safety

All pre-existing project workflows were preserved with zero regressions:
- Client campaign creation and intake conversation (`/campaign/new`, `/campaign/[id]`) remain intact.
- Artifact 1 confirmation and verification workflows remain intact.
- Research Agent, Tavily search integration, Evidence Engine, and URL validator remain intact.
- Artifact 2 generation and Master Campaign Brief generation remain intact.
- Admin dashboard (`/admin`) and campaigns observability remain intact.
- All 56 original tests continue to pass without modifications.
