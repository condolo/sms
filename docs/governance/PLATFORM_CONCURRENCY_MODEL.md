# Platform Concurrency Model v1.0

**Status:** Draft — pending review
**Purpose:** Documents how Msingi behaves under concurrent operations — conflicting writes, retried external events, and shared in-process state — as distinct from how it behaves under load. Correctness under concurrency and throughput under load are different problems; this document addresses only the first one. Two concrete defects surfaced during this review are tracked in `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`'s Production Defects register (BUG-002, BUG-003), not here — this document explains them; that one tracks their resolution.

**Metadata**

| Field | Value |
|---|---|
| Owner | Chief Architect |
| Review Frequency | Before every major architectural initiative |
| Related Documents | `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`, `IDENTITY_DOMAIN_MODEL_v1.md` |

---

## 1. Execution Model

- Single Node.js process today. No `maxPoolSize` set on `mongoose.connect()` (`server/config/db.js:17` — default: 100). No clustering/PM2 config found.
- Scheduled tasks run via `node-cron` (confirmed dependency) — in-process, on a timer, not dispatched to external workers.
- **No distributed queue exists** (no BullMQ/Bull/Agenda/Redis-backed job system found). "Background jobs" today means in-process `node-cron` plus, since ADR-0006 (C11 Phase 1, 2026-07-18), a single-process, MongoDB-collection-based retry queue (`server/utils/job-queue.js`) for one job type (security alert webhooks) — still not distributed, still one process, still no external worker. The requirement that a queued job must snapshot its tenant context rather than re-reading a live session remains a *future* requirement for whenever a genuinely tenant-scoped job type gets queued — the current queue's only job type is platform-level, not tenant-scoped, so there is still nothing to snapshot yet.

## 2. Consistency Model

Two different mechanisms exist for two different hazards, and they should not be conflated:

- **Optimistic locking** (`_v` field + `applyOptimisticLock`, `server/utils/optimistic-lock.js`) — protects against two people *editing the same document* concurrently. A stale write gets a 409, not a silent overwrite.
- **No idempotency-key mechanism exists anywhere** — protects against a *retried external event* (an M-Pesa callback, a webhook, a future queued job) causing the same action twice. A different hazard entirely.

Where neither mechanism applies, the default is last-write-wins, silently, with no conflict surfaced to anyone.

## 3. Conflict Resolution — Per Module (verified)

| Module | Mechanism | Evidence |
|---|---|---|
| Students, Classes, Streams, Teachers | Optimistic lock (`_v`) | Confirmed — all import and call `applyOptimisticLock` |
| Finance — invoices | Optimistic lock | Confirmed, `finance.js:206`, invoice edits specifically |
| Finance — payments | None (not applicable — see Idempotency) | Payment creation is an insert, not a concurrent-edit scenario |
| Exams — mark entry | **None — confirmed last-write-wins** | `exams.js:645`, bulk results use `upsert: true` with no version check |
| Report Cards | Different, adequate mechanism | Versioned snapshots (`supersedesId`) + `publish_batches` anchor doc — deliberately built for this case, not `applyOptimisticLock` |
| HR — leave, payroll, documents | **None** | `hr.js` — zero uses of `applyOptimisticLock` across all write endpoints |
| Settings, Admissions | **None** | Confirmed absent in both |

## 4. Idempotency — Per Endpoint

**`POST /api/mpesa/callback` and `POST /api/mpesa/subscription/callback` — fixed (BUG-002).** *Corrected 2026-07-18, discovered stale while grounding ADR-0006/C11 Phase 1.* Both callbacks now atomically claim the transaction — `findOneAndUpdate({checkoutRequestId, status:{$ne:'completed'}}, {$set:{status:'completed',...}})` — before creating/updating a Payment. A retried callback (Safaricom's own documented behavior) finds `status` already `'completed'`, matches nothing, and is skipped before a second Payment can be created. Regression test: `server/__tests__/routes/mpesa-idempotency.test.js`. See `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md` §4 for the authoritative fix record — this section previously described the pre-fix, present-tense "no guard" state and was itself the stale document.

**Email sends, report-card publish retries, other webhook paths** — not audited this pass.

## 5. Caching — Ownership and the Architecture Assumption

RBAC permission cache, DataScope cache, and token-version/revocation cache are all in-memory `Map` objects, scoped to one Node process (`rbac.js`, `scopeMiddleware.js`, `token-version.js`).

**Architecture Assumption (should be recorded explicitly, not left implicit):** *the current permission and revocation model assumes exactly one running application instance.* All three caches silently stop being consistent the moment a second instance runs without a shared store behind them.

## 6. Scaling Assumptions — Redis Candidates, Evaluated Individually

| Candidate | Recommendation | Reasoning |
|---|---|---|
| Permission/scope cache | Yes | Directly resolves the Architecture Assumption above |
| Token-version cache | Likely yes | Same single-process limitation |
| Session storage | Not yet — depends on D-004 | Don't decide ahead of the pending session/JWT architecture decision |
| Rate limiting | Needs verification | `express-rate-limit`'s default store is also in-memory per-process; not confirmed whether this codebase overrides that |
| Background jobs | Not yet | A Mongo-based queue exists since ADR-0006 (single process, one job type) — revisit Redis only if it needs to scale beyond one process or beyond low volume |

Redis is not a default answer — each candidate was reasoned about individually.

## 7. Tenant/Identity Context Under Concurrency

A session's active Membership must come only from that request's own validated token, never re-derived from anything ambient. Confirmed this already holds today: `report-cards.js`'s publish handler destructures `schoolId` once at the top and reuses that binding for its entire execution. The same discipline is the hard requirement once school-switching (D-004) exists.

## 8. Retry Strategy

- Both M-Pesa callback paths now have idempotency protection (§4, BUG-002 fixed) — a retried Safaricom callback is safely skipped, not reprocessed.
- Retries are inherently safe where sequential counters are used (`$inc` on a per-school counter document) — naturally idempotent regardless of retry count.
- The job queue (`server/utils/job-queue.js`, ADR-0006) adds a third retry mechanism: exponential backoff with a bounded attempt count, moving to `dead_letter` rather than retrying forever. Distinct from the two above — this is for *internal* jobs the platform itself schedules, not external callbacks arriving unprompted.

## 9. Failure Modes, Observability

Not audited this pass for network/Mongo/SMTP/S3 failure behavior, or for metrics/tracing/alerting coverage. Flagged as needing its own dedicated review rather than filled in with unverified findings.

---

*This document explains the concurrency hazards found. Their resolution (severity, ownership, fix status) is tracked in `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`'s Production Defects register, not here.*
