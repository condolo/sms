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
- **No distributed queue exists** (no BullMQ/Bull/Agenda/Redis-backed job system found). "Background jobs" today means in-process cron only. The requirement that a queued job must snapshot its tenant context rather than re-reading a live session is a *future* requirement, for whenever a real queue gets built — not a current gap, since there is nothing to snapshot yet.

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

**`POST /api/mpesa/callback` — no idempotency guard.** The handler finds the transaction by `checkoutRequestId` and, on success, unconditionally runs `Payments.create(...)` with no check for `txn.status === 'completed'` beforehand. Safaricom's own callback behavior includes retries — the code's own comment acknowledges this. A retried successful callback creates a **second, duplicate Payment record for the same money.** Tracked as BUG-002.

**`POST /api/mpesa/subscription/callback`** — same missing guard, structurally, but performs only `$set` updates (plan expiry, paid-at), not a `$create` — idempotent by accident, not by design. Same root cause as BUG-002, lower severity; noted under the same fix.

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
| Background jobs | Not applicable yet | No queue exists to migrate |

Redis is not a default answer — each candidate was reasoned about individually.

## 7. Tenant/Identity Context Under Concurrency

A session's active Membership must come only from that request's own validated token, never re-derived from anything ambient. Confirmed this already holds today: `report-cards.js`'s publish handler destructures `schoolId` once at the top and reuses that binding for its entire execution. The same discipline is the hard requirement once school-switching (D-004) exists.

## 8. Retry Strategy

- Retries currently happen **without** idempotency protection on both M-Pesa callback paths (§4).
- Retries are inherently safe where sequential counters are used (`$inc` on a per-school counter document) — naturally idempotent regardless of retry count.

## 9. Failure Modes, Observability

Not audited this pass for network/Mongo/SMTP/S3 failure behavior, or for metrics/tracing/alerting coverage. Flagged as needing its own dedicated review rather than filled in with unverified findings.

---

*This document explains the concurrency hazards found. Their resolution (severity, ownership, fix status) is tracked in `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`'s Production Defects register, not here.*
