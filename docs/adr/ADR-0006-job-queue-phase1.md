# ADR-0006: Job Queue Infrastructure — Phase 1 of C11 (Integration Framework)

**Status:** Accepted — proposed and accepted in the same pass, matching ADR-0002/ADR-0005's precedent.
**Date:** 2026-07-18 (drafted and accepted)
**Implementation:** Complete for Phase 1 scope — `server/utils/job-queue.js` (Mongo-backed retry queue: `enqueueJob`, `registerHandler`, `processQueueOnce`, `startQueueWorker`), `queue_jobs` collection (platform-level, added to `PLATFORM_COLLECTIONS`), one real integration (`server/services/audit.js`'s security-alert webhook, previously fire-and-forget). 13 new tests (9 in `job-queue.test.js`, 4 in an extended `audit.test.js`). Full suite: 38/38 suites, 428/428 tests.
**Change class:** Major (per `PLATFORM_OPERATING_MODEL.md` §10) — new subsystem, new collection. Not Kernel — touches none of the Kernel triggers (no auth-decision-path change, no tenant-middleware change; `queue_jobs` is deliberately kept out of the tenant query surface entirely, enforced by `PLATFORM_COLLECTIONS`). Does not meet ADR-0001/ADR-0003/ADR-0004's Kernel bar — proposed and accepted in one pass, same class as ADR-0002/ADR-0005.
**Unblocks:** Partial progress on C11 in `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md` — specifically, its "queue infra that does not exist today" sub-dependency. Does **not** unblock or ratify the rest of C11 (Connector Registry, OAuth Framework, Webhook Engine, API Gateway, Sync Engine, Monitoring, Rate Limiting) — all remain deferred, unchanged.
**Related:** `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §13 (Integration Domain — the source of C11's full scope; explicitly asks this work "get its own ADR"), `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md` row R4 (corrected by this ADR — see Context), `PLATFORM_CONCURRENCY_MODEL.md` (corrected by this ADR — a stale BUG-002 claim found while grounding this work), `IMPLEMENTATION_DEPENDENCY_GRAPH_v1.md` C11 row.

---

## Context

C11 was the last item on the dependency graph classified "deferred," pending queue infrastructure the codebase never built. The user asked to implement it, clarifying that only C6 (Organization services) was ever deliberately paused as a business decision — C11's deferral was a technical-prerequisite gap, not a standing decision, and should proceed unless it genuinely contradicts another flow.

**Contradiction check, performed before any code was written:** the one governance objection on record, `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md` row R4, cited two reasons to stay deferred — a "Non-Decisions register... Integration Marketplace/Public API deferred" entry, and `PLATFORM_CONCURRENCY_MODEL.md`'s "no queue infra exists" finding. Direct inspection of the Non-Decisions register (§10) shows it has exactly four rows (org-level billing, cross-school analytics, feature flags, identity federation) — **no entry mentions Integration Marketplace or a Public API.** That half of R4's stated blocker never existed as a recorded decision. The other half — no queue infrastructure — was real and independently confirmed (`package.json` has no bull/bullmq/agenda/ioredis; `node-cron` only). No real contradiction found; R4 is corrected alongside this ADR rather than treated as still-binding.

**Full C11 scope is deliberately not attempted here.** `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §13 describes a large domain: Connector Registry, OAuth Framework, Webhook Engine, API Gateway, Sync Engine, Retry Queue, Monitoring, Rate Limiting. Building all of it in one pass, before any concrete integration needs most of it, would be premature abstraction. Research (direct code reads, cross-checked by a design pass against the actual files) found the codebase already has, bespoke and working: three OAuth flows (Google/Microsoft login in `auth.js`, Google Classroom in `elearning.js`), four webhook receivers (M-Pesa ×2, elearning ×2), and exactly two webhook *senders* — `audit.js`'s `_sendSecurityAlert()` and `monitoring.js`'s `_sendWebhook()`, both fire-and-forget with zero retry.

**A doc-accuracy correction surfaced directly by this research, not scope creep — it changed what the natural first use case should be.** M-Pesa's webhook idempotency gap (`BUG-002`) looked like an obvious first target for retry infrastructure. Direct code read shows it's already fixed: both M-Pesa callbacks use a correct atomic `findOneAndUpdate` claim, covered by `mpesa-idempotency.test.js`. `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md` already said "Fixed" — `PLATFORM_CONCURRENCY_MODEL.md` §4 still described it as broken, present tense. That's the actually-stale text, corrected alongside this ADR.

**The chosen Phase 1 target: `audit.js`'s security-alert webhook, not `monitoring.js`'s.** Both are fire-and-forget senders to the same `ALERT_WEBHOOK_URL`, but they're not equally good queue candidates. `monitoring.js`'s `_sendWebhook()` fires from `process.on('uncaughtException', ...)`, immediately before a 1-second-grace `process.exit(1)`. Queue-ifying that one would make it *worse*, not better: a `queue_jobs` write on a process that's about to die won't be picked up before the next worker tick (up to 60s later), and if the crash is itself a Mongo failure, the enqueue write is exactly the operation most likely to fail at the worst possible moment. `audit.js`'s sender fires during normal request handling — a safe, low-risk (notification, not payment/auth data), concrete case where retry-with-backoff genuinely helps.

## Decision

### 1. A MongoDB-collection-based retry queue, not Redis/BullMQ

`server/utils/job-queue.js` — `enqueueJob({type, payload, maxAttempts})` writes a `queue_jobs` doc; `registerHandler(type, fn)` maintains an in-process `Map` from job type to async handler (a small job-handler registry — explicitly *not* the full Connector Registry `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §13 describes, scoped honestly smaller); `processQueueOnce()` atomically claims due jobs (`findOneAndUpdate({status:'pending'}, {$set:{status:'processing'}}, {new:true})`, mirroring the proven-correct claim idiom already in `mpesa.js`'s callbacks) and runs the handler, with exponential backoff on failure (`min(60s × 2^(attempts-1), 30min)`) and a `dead_letter` terminal state once `maxAttempts` is exceeded; `startQueueWorker()` schedules `processQueueOnce()` every minute via the already-installed `node-cron`, with an overlap guard new cron files in this codebase haven't needed before (every existing one is daily/weekly).

No Redis. Nothing in this phase's one use case, or in the sandbox this was built in (no Redis reachable), justifies adding a new external infrastructure dependency. `PLATFORM_CONCURRENCY_MODEL.md` §6 already declined to make Redis a default answer for background jobs; this ADR doesn't reopen that.

### 2. `queue_jobs` is platform-level, not tenant-scoped

Not every job is school-scoped — a platform-operator security alert (e.g. `platform.school_deleted`) has no single owning school. `queue_jobs` is added to `tenant-model.js`'s `PLATFORM_COLLECTIONS`, joining `audit_logs`/`schools`/`organizations` — this is structurally enforced, not just conventional: `tenantModel()` throws if a platform collection is scoped, so a future stray `tenantModel('queue_jobs', ...)` call fails immediately.

### 3. One real integration: `audit.js`'s security alert, queue-ified

`_sendSecurityAlert()` is split: the pure webhook-POST logic becomes `_postSecurityAlertWebhook()`, registered as the queue's handler for `security_alert_webhook`. It now returns a real Promise that **rejects** on a non-2xx response or a request error — the previous version silently swallowed both (`req.on('error', () => {})`), which is exactly why it could never be retried. `log()`'s call site enqueues instead of firing inline, guarded by the same `ALERT_WEBHOOK_URL` check as before (no `queue_jobs` doc is written when unset), in its own nested try/catch so an enqueue failure is never misreported as a failure to write the audit log itself (which, by that point, already succeeded).

### 4. Every failure mode degrades safely, matching this codebase's established discipline

A bad job's claim, handler, or failure-write is individually try/caught inside `processQueueOnce()`'s loop — one bad job can never crash the batch or the cron tick, the same "must never break other work" contract `AuditService.log()` already holds itself to. `job-queue.js` never requires `services/audit.js` (a real circular-require risk if it ever did, given both files use plain top-level `module.exports`) — its own failures stay `console.error`-only, matching `AuditService.log()`'s own self-restraint about not trying to audit-log its own logging failures.

## What this explicitly does NOT cover (non-goals)

- **No Connector Registry** generalizing the 3 existing OAuth flows or the 4 `elearning_*` token/mapping collections — real, larger, separate future work, not started here.
- **No Webhook Engine** generalizing the 4 existing webhook *receivers* (M-Pesa ×2, elearning ×2) — they already work correctly; only the one sender in `audit.js` is queue-ified.
- **No change to `monitoring.js`'s crash-path webhook sender** — deliberately, not an oversight (see Context). Fire-and-forget is the *correct* behavior on that path.
- **No API Gateway, Sync Engine, or Rate Limiting** — no concrete driving use case exists yet for any of them.
- **No `FEATURE_PLAN`/`planGate()` gating** for the queue — internal ops infrastructure, same category as the existing cron files, none of which are plan-gated.
- **No change to `mpesa.js`'s or `elearning.js`'s existing OAuth/webhook code** — both already correct, untouched.
- **This ADR does not ratify or unblock the rest of C11.** The dependency graph's C11 row stays "deferred" for everything beyond this scoped queue slice.

## Consequences

**Easier / safer:**
- A real, durable, retried delivery path now exists for one concrete case that needed it — security alerts no longer silently vanish on a transient webhook failure.
- Future integrations (a real Connector Registry, a generalized Webhook Engine) inherit a tested, working queue primitive instead of needing to build one from scratch under pressure once a concrete integration demands it.
- Two governance-doc inaccuracies (R4's phantom citation, `PLATFORM_CONCURRENCY_MODEL.md`'s stale BUG-002 claim) are corrected as a direct byproduct of grounding this work, not as unrelated scope creep.

**Harder / newly constrained:**
- A new per-minute cron tick exists in a codebase that previously only ran daily/weekly jobs — the overlap guard is new, untested-under-real-load code (this sandbox has no live MongoDB to load-test against).
- `job-queue.js` is now infrastructure other code may come to depend on; its "never require `services/audit.js`" discipline (Decision 4) needs to hold as new job types are added later, not just today.

**Explicit non-guarantee:** this makes exactly one existing gap (audit webhook reliability) safer, and makes future integration work easier to start. It does not make the rest of C11 lower-risk to build, and does not commit to a timeline for building it.

## Adoption gate

This ADR is Major, not Kernel — proposed and accepted in the same pass, per the classification reasoning in the header. No separate acceptance step follows. Future phases of C11 (Connector Registry, Webhook Engine generalization, etc.) are separate, later work requiring their own scoping and, per `PLATFORM_ARCHITECTURE_EVOLUTION_v1.md` §13's own ask, likely their own ADR — this document does not pre-approve them.
