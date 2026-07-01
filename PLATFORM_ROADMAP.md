# Msingi — Platform Maturity Roadmap

> Every engineering decision should align with a long-term vision.
> This document is that vision. Update it as the platform evolves.

---

## Platform Integrity Scores (tracked per sprint)

| Area              | Sprint 0 |  Target |
| :---------------- | -------: | ------: |
| Identity          |     8/10 |   10/10 |
| RBAC              |   7.5/10 |   10/10 |
| API Authorization |     7/10 |   10/10 |
| Frontend          |   6.5/10 |   10/10 |
| Governance        |     7/10 |   10/10 |
| Multi-Tenant      |   8.5/10 |   10/10 |
| **Overall**       | **7.5/10** | **10/10** |

---

## The Three Pillars

Enterprise systems are built on three pillars. Each sprint moves one forward.

```
Authentication   — Who are you?         (Sprint 0: hardened)
      ↓
Authorization    — What can you do?     (Sprint 0–2: in progress)
      ↓
Accountability   — What did you do?     (Sprint 1: primary objective)
```

---

## Sprint Phases

### Phase 0 — Security Foundation  ✅ COMPLETE (v4.52–4.54)

**Objective:** Replace fragile inline role checks with a governed authorization architecture.

**Exit criteria met:**
- [x] Every high-risk endpoint protected: HR, analytics, assessment, timetable, report-cards, students, import/export
- [x] Finance permission bug fixed (`create` → `update` on fee-structures)
- [x] `teachers.userId` populated on import (identity integrity)
- [x] Permission matrix extended: `analytics` + `hr` added to PERM_MODULES, MODS, ALL_MODULES
- [x] Settings sync uses per-field `$set` (module permissions no longer wiped on save)
- [x] `scripts/repair-identity.js` — multi-entity identity repair framework (teachers + students)
- [x] `scripts/generate-endpoint-inventory.js` → Platform Architecture Manifest (schemaV2)
- [x] `scripts/verify-rbac-coverage.js` — non-regression CI ratchet (baseline: 73.48%)
- [x] `scripts/platform-health.js` — unified platform health check
- [x] RBAC coverage: 73.48% (241/328 endpoints), baseline locked

**Known gaps carried forward:**
- Library, hostel, transport: inline `MANAGE_ROLES` not yet converted (not in PERM_MODULES)
- `settings.js` routes: inline admin guards (26 endpoints)
- `elearning.js`: teacher self-service, auth-only acceptable until Phase 1
- Audit-logged: 0/450 — accountability infrastructure does not exist yet

---

### Phase 1 — Trust & Compliance Sprint  🚧 CURRENT SPRINT

**Objective:** Build accountability infrastructure. Msingi knows who is *allowed* — now it must know who *actually did it* and defend against abuse. This phase covers audit logging, rate limiting on attack surfaces, and permission tracing.

**Primary deliverable: `AuditService`**

```javascript
// Standard signature — every module uses this, nothing else
AuditService.log({
  schoolId,
  userId,
  userName,
  module,        // 'finance' | 'hr' | 'students' | ...
  action,        // 'invoice.create' | 'teacher.delete' | ...
  severity,      // 'low' | 'medium' | 'high' | 'critical'
  entityId,
  entityType,
  oldValue,      // serialized snapshot before change
  newValue,      // serialized snapshot after change
  ip,
  userAgent,
  timestamp,
})
```

**Severity matrix:**

| Level    | Examples                                           |
| :------- | :------------------------------------------------- |
| low      | Viewed report, listed students                     |
| medium   | Edited timetable, updated teacher record           |
| high     | Deleted student, bulk imported, changed grade      |
| critical | Changed permissions, changed SMTP, changed M-Pesa credentials, deleted finance records, changed grading scale |

**Deliverables:**

- [x] `server/services/audit.js` — `AuditService.log()` (non-fatal) + `query()` (paginated), `ACTIONS` catalogue with 16 action types, append-only `audit_logs` collection *(v4.59.0)*
- [x] `audit_logs` collection: 5 indexes, append-only by convention — no update/delete *(v4.59.0)*
- [x] `GET /api/audit` — paginated, filterable by action/severity/actorId/date; school-scoped for admins *(v4.59.0)*
- [x] Audit Viewer UI — Settings → Audit Log tab (admin), Platform Console → Recent Critical Events (superadmin) *(v4.59.0)*
- [x] 6 high-impact routes instrumented: `auth.login`, `student.deleted`, `student.deactivated`, `report_card.publish`, `platform.impersonate`, `user.role_changed` *(v4.59.0)*
- [ ] `auth.login_failed` instrumented (failed login path in auth.js)
- [ ] `auth.password_changed` instrumented (change-password route)
- [ ] Finance mutations instrumented: invoice create, receipt, fee-structure change
- [ ] Bulk import/export instrumented
- [ ] Permission matrix changes instrumented (`PUT /api/settings/roles`)
- [ ] `audit_log_completeness` check added to compliance engine
- [ ] `rbac()` middleware auto-logs authorization denials
- [ ] Permission Trace: denied requests include structured reason (`module`, `action`, `role`, `missingPermission`)
- [ ] 100% of `critical` actions instrumented
- [ ] Identity validation on startup: `server/startup/validateIdentity.js` reports health without blocking boot

**Rate limiting (moved from Phase 4 — attack surfaces cannot wait):**
- [ ] `express-rate-limit` applied per-route on all `critical`-risk endpoints (visible in manifest `rateLimit` field)
- [ ] Priority order (highest attack value): login, OTP, password reset, school creation, bulk import/export, payment callbacks, report generation
- [ ] `scripts/.rbac-history`-style `.rate-history` tracking as coverage grows
- [ ] `platform:health` rate-limiting check turns green for critical endpoints

**Parent identity architecture** (must be designed in Phase 1, even if built in Phase 2):
- One parent → many children → potentially multiple schools
- Parent portal account: `users` record with `role: 'parent'` + `studentIds: []`
- Cross-school parents: need a `globalParentId` linked to multiple `schoolId`-scoped records
- Account merge scenario: same email re-registered at second school must detect and link, not duplicate

---

### Phase 2 — Authorization Completion

**Objective:** Reach 100% RBAC coverage. No auth-only business endpoints remain.

**Deliverables:**

- [ ] `settings.js`: introduce `settings.*` permissions (26 endpoints converted)
- [ ] `elearning.js`: add eLearning to permission matrix (10 endpoints converted)
- [ ] `library.js`, `hostel.js`, `transport.js`: add to PERM_MODULES + MODS (defer from Phase 0)
- [ ] `rooms.js`, `sections.js`, `teaching-assignments.js`: inline guards → rbac()
- [ ] `academic-config.js`, `bell-schedule.js`: converted
- [ ] `collections.js`: audit + rbac per collection type
- [ ] Permission Simulator: admin selects role → system renders exactly what that role sees
- [ ] RBAC baseline ratcheted to 100% (all `MISSING` lines resolved)
- [ ] `--update-baseline` committed at 100%

---

### Phase 3 — Governance

**Objective:** Every platform change is versioned and reversible.

**Deliverables:**

- [ ] Permission matrix versioning: every `PUT /roles` save increments a `settingsVersion` counter
- [ ] Permission history: `permission_history` collection records who changed what and when
- [ ] Permission rollback: `POST /api/settings/roles/rollback/:version`
- [ ] `Permission Trace Engine` completed: denied requests show full trace (role → permission → matrix version → configured by → timestamp)
- [ ] Import/export audit trail: every bulk operation linked to an audit entry
- [ ] Grading scale change guard: requires `high` audit event + explicit confirmation

---

### Phase 4 — Observability

**Objective:** Platform health is visible at a glance without querying the database.

**Deliverables:**

- [ ] `Platform Health Dashboard` (Platform Admin only):
  - Identity Health (% teachers/students/parents with valid userId)
  - RBAC Coverage (live %)
  - Tenant Isolation (pass/fail)
  - Audit Infrastructure (green/red)
  - Permission Cache (hit rate, last invalidation)
  - Database Indexes (missing index detection)
  - Critical Risks (count)
  - Warnings (count)
- [ ] `npm run platform:health` reflects all of the above
- [ ] Rate limiting fully green across all risk levels (critical done in Phase 1; medium/low completed here)
- [ ] Audit log archival policy implemented

---

### Phase 5 — Enterprise Readiness

**Objective:** Architecture is defensible under SOC 2 / ISO 27001 review.

**Deliverables:**

- [ ] Immutable audit log verified: no UPDATE/DELETE path exists on `audit_logs`
- [ ] Encryption at rest documented for sensitive fields (passwords, M-Pesa keys, SMTP credentials)
- [ ] Data retention policy enforced (auto-archive or purge per region rules)
- [ ] API rate limiting: all public and auth endpoints rate-limited, limits documented in manifest
- [ ] Penetration test readiness: all OWASP Top 10 addressed and documented
- [ ] Multi-region tenant isolation verified (schoolId on every query, no cross-tenant leakage possible)
- [ ] RBAC coverage: 100% (baseline locked, regression impossible)
- [ ] Audit coverage: 100% of high/critical actions logged
- [ ] Export compliance: GDPR-compatible data export and deletion for any `studentId` or `userId`

---

## Metrics to track each sprint

| Metric                  | Sprint 0 | Sprint 1 | Sprint 2 | Sprint 3 | Sprint 4 | Sprint 5 |
| :---------------------- | -------: | -------: | -------: | -------: | -------: | -------: |
| RBAC coverage           |   73.48% |      75% |     100% |     100% |     100% |     100% |
| Audit coverage          |       0% |      60% |      80% |     100% |     100% |     100% |
| Tenant isolation        |    PASS  |    PASS  |    PASS  |    PASS  |    PASS  |    PASS  |
| Identity health (teach) |    ~70%  |     95%  |    100%  |    100%  |    100%  |    100%  |
| Rate-limited endpoints  |    ~5%   |     30%  |     60%  |     80%  |    100%  |    100%  |
| Permission versioning   |       ✗  |       ✗  |       ✓  |       ✓  |       ✓  |       ✓  |
| Audit viewer            |       ✗  |       ✓  |       ✓  |       ✓  |       ✓  |       ✓  |
| Health dashboard        |    CLI   |    CLI   |    CLI   |    CLI   |    UI ✓  |    UI ✓  |

---

---

## Eight Production-Readiness Gates

No module is considered production-ready until it satisfies all eight gates. This replaces the informal "looks good" standard with a verifiable checklist.

| Gate | Requirement | Measured by |
| :--- | :---------- | :---------- |
| 1. Functional correctness | Feature works as intended and handles edge cases | Manual QA + regression tests |
| 2. Authentication | Only authenticated users access protected functionality | `authMiddleware` present on every non-public route |
| 3. Authorization (RBAC) | Access governed by `role_permissions`, not hardcoded role lists | `rbac()` middleware; CI gate passes; coverage ≥ baseline |
| 4. Tenant isolation | All DB queries scoped to `schoolId` from JWT | `tenantScoped: true` in manifest |
| 5. Audit logging | High/critical actions immutably recorded via `AuditService` | `auditLogged: true` in manifest for `risk: high|critical` |
| 6. Rate limiting | Attack surfaces protected against abuse | `rateLimit: true` in manifest for `risk: critical` |
| 7. Regression tests | Automated tests prevent reintroducing defects | Test suite passes; coverage tracked in CI |
| 8. Platform Health | Module improves or maintains the Platform Health Index | `npm run platform:health` exits 0 or improves score |

**Risk-gate mapping** — not everything needs all gates:

| Risk level | Required gates |
| :--------- | :------------- |
| critical   | All 8 |
| high       | 1–5, 7, 8 (rate limiting optional) |
| medium     | 1–4, 7, 8 |
| low        | 1–2, 4, 8 |

---

## Release Metric Trends

Track these numbers in every release. Management sees engineering quality improving over time.

| Release | RBAC % | Audit % | Rate-limit % | Health score |
| :------ | -----: | ------: | -----------: | -----------: |
| v4.52   |  73.48 |       0 |            0 |           78 |
| v4.54   |  73.48 |       0 |            0 |           78 |
| *(Sprint 1 target)* | 75 | 60 | 30 | 84 |
| *(Sprint 2 target)* | 100 | 80 | 60 | 91 |
| *(Sprint 3 target)* | 100 | 100 | 80 | 96 |
| *(Sprint 4 target)* | 100 | 100 | 100 | 99 |

*Update this table on every versioned release.*

---

## Platform Impact format

Every CHANGELOG entry for a release that affects platform metrics should include a **Platform Impact** block:

```
### Platform Impact
| Metric       | Before  | After   | Delta  |
| :----------- | ------: | ------: | -----: |
| RBAC         | 73.48%  | 75.00%  | +1.52% |
| Audit        | 0%      | 30%     | +30%   |
| Rate-limited | 0%      | 20%     | +20%   |
| Health score | 78      | 84      | +6     |
```

This forces every developer to think about platform quality, not just functionality.

---

## Architectural Invariants

Rules that can never be violated, regardless of deadline or convenience. Any code that breaks an invariant must be fixed before merge — no exceptions, no "we'll clean it up later."

| # | Invariant | Enforcement |
| :- | :--------- | :---------- |
| 1 | Every DB query is scoped to `schoolId` from the verified JWT | Manual review; manifest `tenantScoped` field |
| 2 | Every protected endpoint carries `authMiddleware` + `rbac()` | CI RBAC coverage gate (non-regression) |
| 3 | No Mongoose-level `find({})` without a `schoolId` predicate on multi-tenant collections | Code review checklist |
| 4 | `AuditService.log()` is the only write path to `audit_logs` — no direct inserts | Module encapsulation |
| 5 | JWT secret must be set in production or the server refuses to start | `server/utils/jwt.js` enforces `process.exit(1)` |
| 6 | Rate limiting is mandatory on every `risk: critical` endpoint | CI manifest gate |
| 7 | Permissions are stored per-tenant in `role_permissions` — no hardcoded role lists in business logic | RBAC middleware; CI gate |
| **8** | **No Hidden Access — Msingi shall not contain undocumented backdoors, master passwords, hidden routes, or authentication bypasses. Every privileged action must be authenticated, authorized, audited, and explicitly documented.** | **CI security pattern scan (`scripts/security-scan.js`)** |

### Invariant 8 — Detail

What is banned:
- Hidden routes (`/debug`, `/master`, `/dev-login`, `/internal`, `/bypass`)
- Hardcoded credentials (`admin123`, `password123`, or any static secret in source)
- Bypass flags (`AUTH_DISABLED=true`, `SKIP_AUTH`, `ALLOW_ALL`)
- Auth middleware commented out (`// authMiddleware`, `// rbac(...)`)
- TODOs deferring auth (`// TODO remove auth`, `// TODO add auth later`)
- `if (NODE_ENV !== 'production') return next()` in auth paths

What is allowed (documented operator capabilities, not backdoors):
- `POST /api/platform/schools/:id/impersonate` — disabled in production by default (`ALLOW_IMPERSONATION` not set in `render.yaml`), requires `PLATFORM_ADMIN_KEY`, every use is audit-logged to `platform_audit_log` with IP + timestamp + school. This is an operator support capability, not a hidden access path.
- M-Pesa callback signature validation skipped in non-production for local testing — development convenience only, guarded by `NODE_ENV` check.

Future direction (Phase 3+): Move impersonation toward just-in-time access — support request → time-limited JWT (15 min) → auto-revoked. Until then, the `PLATFORM_ADMIN_KEY` gate + audit log is the accepted control.

---

## Decision log

| Date       | Decision                                                           | Reason                                      |
| :--------- | :----------------------------------------------------------------- | :------------------------------------------ |
| 2026-06-19 | Library/hostel/transport deferred from Phase 0                     | Not in PERM_MODULES; unsafe to add rbac() without UI |
| 2026-06-19 | `growth-records /verify` kept as intentional wide-access           | Teachers must verify at staff level by design |
| 2026-06-19 | Settings.js inline guards kept in Phase 0                          | 26 endpoints; deferred to Phase 2 `settings.*` |
| 2026-06-19 | Parent identity architecture deferred to Phase 1 design            | Multi-child / multi-school complexity needs dedicated design session |
