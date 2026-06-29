# Msingi Architecture Constitution

**Version:** 1.0  
**Status:** Approved  
**Date:** 2026-06-21  
**Authors:** Msingi Engineering (Collins Ndolo), Architecture Review

> This document is the definitive engineering reference for the Msingi platform.  
> It defines core entities, their boundaries, invariants that must never be violated,  
> and the principles that govern every architectural decision going forward.  
> It is a living document. Changes require an Architecture Decision Record (ADR).

---

## 1. Purpose

Msingi has reached the stage where architectural decisions have long-term consequences. Live schools depend on this platform. Data integrity and behavioral stability are non-negotiable.

This Constitution exists to:

- Define the canonical meaning of every core entity
- Codify invariants that future engineers must not violate without an ADR
- Establish the Compatibility Principle that protects existing schools
- Document the approved migration strategy for multi-campus support
- Serve as the reference for all Architecture Reviews

---

## 2. Core Definitions

These definitions are authoritative. If code or documentation contradicts them, the code or documentation is wrong.

| Term | Definition |
|------|-----------|
| **Platform** | The Msingi SaaS infrastructure. Hosts all Organizations. Operated by the Msingi team. |
| **Organization** | A legal or operational entity that owns one or more Schools. Examples: a school group, a church mission, a single independent school. Every School belongs to exactly one Organization. |
| **School** | The primary operational tenant. All transactional data (students, teachers, finance, exams, timetable) belongs to a School. A School belongs to exactly one Organization. |
| **Campus** | An alternative term for a School within a multi-campus Organization. Architecturally identical to a School. |
| **Identity** | A single authenticated user account within an Organization. One person = one Identity per Organization. The same person at two independent Organizations has two independent Identities. |
| **Membership** | The link between an Identity and a School, carrying the Role for that School. One Identity may hold multiple Memberships within the same Organization. |
| **Role** | The permission set a Membership grants within a specific School. Examples: Director, Principal, Teacher, Finance, Parent. Defined per Membership, not per Identity. |
| **Session** | A single authenticated browser tab context. One login event may produce multiple Sessions if the user opens multiple tabs with different school contexts. |
| **Employment Record** | The record of a person's work at a specific School. Local to that School. Not shared across Schools even within the same Organization. |
| **Student Enrollment** | The record of a student's attendance at a specific School for a specific academic period. Local to that School. Transfers create new Enrollment records; they do not move existing ones. |
| **Tenant** | Synonymous with School for all transactional purposes. Every data query must resolve to exactly one tenant (School). |
| **Subscription** | The billing relationship between an Organization and Msingi. Organizations own subscriptions. Schools inherit access from their Organization's subscription. |
| **Licensing** | Module-level access within a School. An Organization may subscribe to a plan that licenses specific modules across its Schools. |

---

## 3. Architectural Hierarchy

```
Msingi Platform
│
├── Organization A  (e.g. "Green Valley Schools")
│   ├── School A1   (e.g. "Green Valley Nairobi")
│   │   ├── Students
│   │   ├── Teachers / Employment Records
│   │   ├── Finance
│   │   ├── Exams
│   │   └── ...all transactional modules
│   │
│   └── School A2   (e.g. "Green Valley Eldoret")
│       ├── Students
│       ├── Teachers / Employment Records
│       ├── Finance
│       └── ...
│
├── Organization B  (e.g. "Diocese of Nairobi Schools")
│   ├── School B1
│   ├── School B2
│   └── School B3
│
└── Organization C  (e.g. "St. Mary's Academy")   ← single-school org (default for all existing schools)
    └── School C1
```

**Every existing school on Msingi automatically belongs to its own Organization (1:1).** No UI change. No behavior change. No migration risk. The Organization simply wraps the existing School.

---

## 4. Architectural Invariants

These rules must never be violated without a formal ADR approved by the Architecture Review.

### Invariant 1 — Single Active School Context

Every transactional API request executes within exactly one active School context. No transactional endpoint may resolve data across multiple Schools in a single request.

```
req.jwtUser.schoolId  →  always present, always a single School
```

### Invariant 2 — Cross-School Data Isolation

No module may query another School's transactional data. Cross-school data access is only permitted through dedicated Organization Analytics APIs, never through transactional endpoints.

```
✓  GET /api/finance/fees          →  scoped to req.jwtUser.schoolId
✓  GET /api/org/analytics/finance →  Organization-level, read-only aggregation
✗  GET /api/finance/fees?schoolId=B  →  never permitted in a transactional module
```

### Invariant 3 — RBAC and DataScope are Separate Concerns

RBAC determines **what** a user may do (which actions, which modules).  
DataScope determines **which records** a user may access (own class, own students, own children).  
These must never be mixed in the same check.

### Invariant 4 — Identity, Employment, and Academic Records are Independent

- Identity: who the person is (authentication, name, contact)
- Employment Record: their role and work at a specific School (local to that School)
- Student Enrollment: their academic record at a specific School for a specific period (local to that School)

A teacher working at two campuses has one Identity, two Employment Records.  
A student who transfers has one Identity, two Enrollment Records.  
Never merge Employment Records or Enrollment Records across Schools.

### Invariant 5 — Every Migration Must Be Reversible

No migration may be run without a documented rollback procedure. The rollback must be executable without data loss. Migrations that cannot be reversed must be presented to the Architecture Review before execution.

### Invariant 6 — Backward Compatibility Supersedes Elegance

When architectural elegance conflicts with preserving existing school behavior, backward compatibility wins. An imperfect design that does not break existing customers is always preferred over a theoretically perfect design that requires migration.

### Invariant 7 — Auth Services Must Fail Open

SecurityService, SessionService, and all auth-adjacent services must fail open on infrastructure errors. If a DB call fails during a lockout check or session validation, the system must allow the request through. Schools cannot be locked out because a secondary service threw an exception.

```javascript
// Correct
SecurityService.checkAccountLock(...).catch(() => null);  // fail open → allow login

// Wrong
SecurityService.checkAccountLock(...);  // unhandled rejection → could block login
```

---

## 5. The Compatibility Principle

Every architectural evolution must satisfy three compatibility guarantees.

### Level 1 — No Schema Removals

Never delete an existing field from a collection until at least one full major release after it has been formally deprecated. Mark deprecated fields in code with a comment; do not silently remove them.

```javascript
// users collection
schoolId:  String,   // active — primary school context for single-school users
// orgId:  String,   // added in v2 for multi-org users
```

`users.schoolId` may become legacy when Memberships are authoritative, but it must not be removed until all schools have migrated and a deprecation window has passed.

### Level 2 — No API Breaking Changes

Existing API contracts must not change behavior silently. If a new endpoint is needed for Organization-level features, introduce it under a new path:

```
/api/organizations/:orgId/analytics/...
/api/organizations/:orgId/members/...
```

Do not modify the behavior of existing `/api/finance/...`, `/api/students/...`, or any other transactional endpoint.

### Level 3 — Feature Activation, Not Feature Replacement

New capabilities are activated; old capabilities are not removed. Multi-campus switching, Organization dashboards, and cross-school analytics are additional features — not replacements for the existing single-school flow.

A school that never joins a multi-campus Organization should experience zero difference from today's behavior indefinitely.

---

## 6. Identity Architecture

### Organization-Scoped Identity

Identity is global within an Organization. It is not global across the Msingi Platform.

```
Green Valley Schools → Collins Ndolo (one Identity)
St. Mary's Academy  → Collins Ndolo (separate Identity, independent)
```

The same person at two independent Organizations has two independent accounts. Their data, employment history, and profiles do not merge unless both Organizations explicitly request a platform-level link. That link, if ever implemented, requires an ADR and consent from both Organization admins.

### Membership Model

```
Identity
  └── Membership → School A1 → Role: Director
  └── Membership → School A2 → Role: Principal
  └── Membership → School A3 → Role: Read-Only Auditor
```

The same Identity can hold different Roles at different Schools within the same Organization. RBAC is evaluated per Membership, not per Identity.

---

## 7. Session Architecture

### Many Context Sessions (Approved Model)

One login produces one Identity verification. Each browser tab that establishes a school context gets its own Session with its own JWT.

```
Login
  └── Identity verified
        ├── Tab 1 → Session A → JWT (schoolId: nairobi) → Active context: Nairobi Campus
        └── Tab 2 → Session B → JWT (schoolId: eldoret) → Active context: Eldoret Campus
```

### Implementation: sessionStorage for Active Context

- **localStorage** — stores identity-level data: who you are, your Organization, your available Memberships. Persists across tabs and page refresh.
- **sessionStorage** — stores the active school context JWT for this tab. Isolated per tab. Does not survive tab close.

This means:
- Opening a new tab: you appear logged in (identity from localStorage) but must select a school context
- Closing and reopening a tab: identity is preserved; school context must be re-selected
- An existing single-school user: localStorage holds their JWT as today — no change to current behavior

### Revocation

Revoking all sessions via `revokeAllUserSessions()` + tokenVersion bump invalidates all tab JWTs simultaneously. The revocation mechanism works identically for single-school and multi-campus users.

### Single-School Users (Existing Behavior)

Users with exactly one Membership see no change. Their JWT is stored in localStorage exactly as today. The sessionStorage mechanism is only activated when a user has more than one active Membership.

---

## 8. JWT Specification

### Current JWT Payload (unchanged for existing users)

```json
{
  "userId": "usr_xxx",
  "schoolId": "sch_xxx",
  "role": "teacher",
  "roles": ["teacher"],
  "tv": 3,
  "sessionId": "uuid",
  "absoluteExpiry": "2026-06-22T06:00:00.000Z"
}
```

### Future JWT Payload (multi-campus users only, Phase 4+)

```json
{
  "userId": "usr_xxx",
  "orgId": "org_xxx",
  "schoolId": "sch_xxx",
  "membershipId": "mem_xxx",
  "role": "director",
  "roles": ["director"],
  "tv": 3,
  "sessionId": "uuid",
  "absoluteExpiry": "2026-06-22T06:00:00.000Z"
}
```

`schoolId` remains present and unchanged. All existing middleware and queries continue to work without modification.

---

## 9. New Data Model

### Organization

```javascript
{
  id:           String,   // "org_xxx"
  name:         String,   // "Green Valley Schools"
  slug:         String,   // "green-valley"
  createdAt:    Date,
  updatedAt:    Date,
  plan:         String,   // subscription plan (future)
  multiSchoolEnabled: Boolean,  // false until Phase 3 opt-in
  schools:      [String], // schoolIds that belong to this org
}
```

### Membership

```javascript
{
  id:           String,   // "mem_xxx"
  orgId:        String,   // which Organization
  userId:       String,   // which Identity
  schoolId:     String,   // which School
  role:         String,   // role at this School
  isActive:     Boolean,
  createdAt:    Date,
  createdBy:    String,   // userId of who granted this
}
```

### No Changes to Existing Collections

`users`, `schools`, `sessions`, and all transactional collections are unchanged in Phase 1 and Phase 2.

---

## 10. Migration Strategy

### Stage 1 — Introduce Organization (Phase 1)

Create an `organizations` collection. For every existing School, create one Organization document (1:1). Set `multiSchoolEnabled: false`. No UI change. No behavior change.

**Validation:** `organizations.count === schools.count`

**Rollback:** Drop the `organizations` collection. No other data affected.

---

### Stage 2 — Introduce Memberships (Phase 2)

Create a `memberships` collection. For every existing user, create one Membership document matching their current `schoolId` and `role`. Memberships are **not yet authoritative** — existing auth continues to use `users.schoolId` directly.

**Validation:** `memberships.count === users.count` (± inactive users). Run a diagnostic before enabling:

```
Users:       2,847
Memberships: 2,847
Status:      ✓ Safe to proceed
```

**Rollback:** Drop the `memberships` collection. Auth falls back to `users.schoolId` automatically.

---

### Stage 3 — Enable Memberships Behind Feature Flag (Phase 3)

Add `multiSchoolEnabled: true` to Organizations that opt in. For those Organizations, auth begins reading Memberships. All other Organizations continue using the existing flow unchanged.

The feature flag is a field on the Organization document — not a separate feature flag service.

**Rollback:** Set `multiSchoolEnabled: false`. That Organization reverts to single-school flow.

---

### Stage 4 — School Switcher (Phase 4)

Add a school/campus switcher visible only to users with more than one active Membership. Single-Membership users see no new UI. Switching school context issues a new JWT for that tab scoped to the selected School.

**Rollback:** Disable the switcher behind a flag. Multi-Membership users revert to their primary Membership.

---

### Stage 5 — Organization Dashboards (Phase 5)

Build Organization-level analytics and executive dashboards using dedicated `/api/organizations/` endpoints. Do not modify any transactional endpoint.

---

## 11. Component Impact Matrix

| Component | Phase 1 | Phase 2 | Phase 3+ |
|-----------|---------|---------|----------|
| Authentication / JWT | No change | No change | Additive (orgId, membershipId) |
| authMiddleware | No change | No change | Additive (membership validation) |
| SessionService | No change | No change | Additive (multi-context sessions) |
| SecurityService | No change | No change | No change |
| RBAC | No change | No change | Additive (membership-based role resolution) |
| DataScope | No change | No change | No change |
| Finance | No change | No change | No change |
| Students | No change | No change | No change |
| Teachers | No change | No change | No change |
| Exams | No change | No change | No change |
| Attendance | No change | No change | No change |
| Timetable | No change | No change | No change |
| Report Cards | No change | No change | No change |
| M-Pesa | No change | No change | No change |
| Email | No change | No change | No change |
| Notifications | No change | No change | No change |
| Imports / Exports | No change | No change | No change |
| Platform Dashboard | No change | Additive (org view) | Additive |
| Billing | No change | No change | Migration (org-level subscription) |
| users collection | No change | No change | Additive (orgId field) |
| schools collection | Additive (orgId field) | No change | No change |

---

## 12. Billing and Licensing Model

### Ownership

```
Organization  →  Subscription (plan, billing contact, invoice)
  └── School  →  Modules (which features are licensed)
```

One Organization, one invoice. The Organization admin manages the subscription. Schools inherit access from the Organization plan.

### Existing Schools

Every existing school already has its own plan (core / standard / premium). In Phase 1, this does not change — the Organization wraps the existing School and inherits its plan. Organization-level billing becomes available when a school explicitly creates a multi-school Organization and opts in.

### Module Licensing

Individual Schools within an Organization may have different module configurations. A Diocese running five schools might license the Hostel module only for the boarding school, not all five.

---

## 13. Architecture Review Process

Any change that touches the following requires an Architecture Decision Record (ADR) approved before implementation:

- Authentication or JWT payload
- Multi-tenancy or school context resolution
- RBAC or DataScope
- Data model of core entities (users, schools, organizations, memberships, sessions)
- Finance or M-Pesa integration
- Platform-level services (SecurityService, SessionService, email routing)
- Any migration that modifies existing records

**Process:**

```
1. Business requirement defined
2. Architecture proposal written
3. Architecture Review (human + AI)
4. ADR produced and approved
5. Implementation begins
6. Regression testing against existing schools
7. Phased deployment
```

Changes that do not touch any of the above may proceed through the normal development flow.

---

## 14. Open Decisions

These questions are acknowledged and deferred. They require a business decision before an ADR can be written.

| Question | Status |
|----------|--------|
| Cross-organization identity linking: who can authorize it and what audit trail is required? | Deferred |
| Organization-level billing: when does it activate and who manages the subscription? | Deferred |
| Platform admin approval required to create a multi-school Organization? | Deferred |
| Maximum number of Schools per Organization (performance boundary)? | Deferred |
| Can a student Identity be linked across Organizations (e.g. student transfers to a different school group)? | Deferred |

---

## 15. Rollback Strategy Summary

| Phase | Rollback Action | Data at Risk |
|-------|----------------|-------------|
| Phase 1 | Drop `organizations` collection | None |
| Phase 2 | Drop `memberships` collection | None |
| Phase 3 | Set `org.multiSchoolEnabled = false` | None |
| Phase 4 | Disable switcher flag | None |
| Phase 5 | Disable org dashboard routes | None |

Every phase has a clean, zero-data-loss rollback. This is by design.

---

## 16. What Must Not Change

As a reminder to future engineers: the following are load-bearing decisions in the current architecture. Do not change them without an ADR.

- `req.jwtUser.schoolId` as the active tenant context in every middleware and route
- `users.schoolId` as the fallback tenant until memberships are authoritative for a given Organization
- `tokenVersion` as the immediate session revocation mechanism
- `absoluteExpiry` in JWT as the hard 8-hour session cap
- `_touchActivity()` as the rate-limited `lastActivity` update mechanism (fail-open, fire-and-forget)
- `_sendAsSchool()` with explicit `schoolId` for all school email routing
- DataScope as a separate layer from RBAC — never inline scope checks into permission checks

---

*This document supersedes informal architectural decisions made in chat or code comments. When in doubt, this Constitution is the reference. When the Constitution is silent, raise an ADR.*
