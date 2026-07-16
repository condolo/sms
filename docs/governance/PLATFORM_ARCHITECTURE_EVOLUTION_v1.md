# Msingi Platform Architecture Evolution

**Version:** 1.0 (Pre-ADR Foundation)
**Status:** Approved as target-state direction — governs the ADR sequence; not yet implemented
**Date recorded in repo:** 2026-07-16
**Audience:** Chief Architect, Engineering Team, Product Team

> Transcribed faithfully from the source proposal (`Msingi Platform Architecture Evolution.pdf`)
> into the governance corpus so it is version-controlled and referenced alongside the
> Constitution, Operating Model, and the governance reviews. This is the **target-state
> vision**. Where it diverges from the currently-approved `ARCHITECTURE_CONSTITUTION.md`,
> the divergence is tracked in `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md §12` and remains
> subject to the ADR process the Constitution defines. Recording this document does not
> authorize implementation — see §18 (Dependencies Before Implementation).

---

## 1. Purpose

Establishes the architectural foundation for Msingi to evolve from a school management
system into a scalable education platform supporting individual schools, multi-campus
schools, school groups, faith-based networks, foundations, franchise schools, and
international education groups — **without future architectural redesign** of Identity,
Billing, Tenant Isolation, or Authorization.

The goal is not to build a multi-school feature. The goal is an architecture that never
requires those four foundations to be rewritten.

## 2. Core Philosophy — Four Immutable Principles

1. Architecture must support future growth without exposing unnecessary complexity to customers.
2. Every business capability has exactly one owner. Ownership is never duplicated.
3. Operational independence of schools is preserved at all times.
4. Security is structural — not procedural. The architecture must prevent mistakes instead of relying on developers to remember rules.

## 3. Architectural Layers

Platform → Platform Services → Organizations → Schools → Identity → Membership → Academic Domain → Operations Domain → Integration Domain → Intelligence Domain.

Every future module belongs to one — and only one — domain.

## 4. Domain Ownership Matrix

| Domain | Owns | Never Owns |
|---|---|---|
| Platform | Infrastructure, subscriptions catalogue, plans, feature registry, billing engine, integration framework, AI engine, monitoring | Students, teachers, report cards |
| Organization | Commercial relationship, billing account, school registry, shared leadership, organization-wide services | Academic records |
| School | All operational data | Global identities |
| Identity | Authentication, MFA, profile, security credentials | Employment |
| Membership | Roles, permissions, employment, access rights | Authentication |
| Academic | Teaching & learning | Billing |
| Operations | Finance, HR, Library, Hostel, Transport | Authentication |
| Integration | External systems | School data ownership |
| Intelligence | Analytics, dashboards, AI | Operational transactions |

No domain may assume ownership outside its boundary.

## 5. Organization

Every customer automatically owns one Organization. Organizations are administrative, not
operational. They own: customer relationship, billing account, invoice history, org
administrators, school registry, shared policies, shared resources, org-level analytics,
org-level governance. They never own students, classes, report cards, attendance,
assessments, fee records, or academic calendars.

## 6. School

The operational tenant. Every academic and operational transaction belongs to exactly one
School (students, parents, classes, subjects, timetables, exams, fees, payroll, library,
hostel, medical, attendance, discipline, communication). **School deletion must never
affect another school.**

## 7. Subscription & Commercial Model

The commercial customer may be an Organization; **the subscription belongs to the School.**
Each School carries its own plan (e.g. School A: Base, School B: Student, School C: Family).
Enterprise has no fixed pricing; Organizations may receive negotiated pricing. The Platform
invoices the Organization while maintaining subscriptions independently per School.

> **Note:** this overrides the currently-approved `ARCHITECTURE_CONSTITUTION.md §12`, which
> vests the subscription in the Organization. See `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md §12`.
> The current code (`plan.js:106-107`, `mpesa.js:598`) already stores the plan per-School, so
> this direction matches implementation reality; the Constitution is the document that must
> be amended, via the Billing ADR.

## 8. Plans vs Entitlements

Plans and features must never be coupled. Plans determine the commercial package;
entitlements determine technical capability. A School on the Student plan might separately
hold entitlements for AI Reports, Payroll, an SMS bundle, or a QuickBooks integration. This
enables enterprise contracts, promotional features, grandfathering, beta features, and
custom agreements without minting new plans.

> **Net-new:** today `plan.js:33-80` is a single static `FEATURE_PLAN` map — plans and
> features are hard-coupled. This is a real architectural change (Kernel-tier), not a
> restatement; it needs its own ADR.

## 9. Identity Domain

Identity represents a person. Owns: authentication, password, MFA, profile, notification
preferences, security settings, audit identity. Never owns: role, department, salary,
employment, teaching load.

## 10. Membership Domain

Membership connects an Identity to a School. Owns: school, role, department, subjects,
permissions, employment dates, employment status, salary, reporting line. **Deleting a
Membership never deletes an Identity.**

## 11. Authorization

Every request must satisfy: Validated Identity → Validated Membership → Validated School
Context → Validated Permissions → Validated Data Scope. Every execution path operates within
one — and only one — validated school context. Cross-school operations require dedicated
Organization-level services.

## 12. Organization Services

Optional coordination services: Shared Calendar, Shared Policies, Shared Documents,
Executive Messaging, Shared Staff Directory, Org-wide Announcements, Cross-school Reporting.
These services **never bypass School boundaries.**

## 13. Integration Domain (New)

Integrations become a first-class architectural domain. Platform owns: Connector Registry,
OAuth Framework, Webhook Engine, API Gateway, Synchronization Engine, Retry Queue,
Monitoring, Audit, Rate Limiting. Schools own: OAuth authorization, API credentials, mapping
rules, sync preferences, integration activation. Organizations may optionally govern approved
integrations and org-wide connector policies. A QuickBooks integration for one School never
affects another.

> **Sequencing conflict to resolve:** `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`'s committed
> Non-Decisions register defers the Integration Marketplace and Public API to a future ADR,
> and `PLATFORM_CONCURRENCY_MODEL.md` confirms no queue infrastructure exists today (single
> Node process, node-cron only, no Redis/BullMQ). A retry queue + webhook engine + API
> gateway is a large net-new infrastructure build, not foundation-laying. This domain should
> keep its deferred position and get its own ADR, not sit on the identity critical path.

## 14. Registration Model

- **Standard:** the customer registers one School; internally Organization → School →
  Administrator, with the Organization invisible.
- **Growing customer:** a second School is added through Organization Settings — no migration, no duplicate accounts.
- **Enterprise onboarding:** Platform Administrators provision Organization, Schools, initial
  subscriptions, leadership, branding, initial integrations.

> **Over-claim to correct:** "No migration" is not accurate. The Identity/Membership split
> requires relocating the hard `{schoolId, email}` unique index on `users`
> (`indexes.js:155`). That is `MR-001` — Critical impact, touches the login path of every
> school. It must be named, shadow-migrated, and rollback-planned, not waved past.

## 15. Authentication & School Switching

Authentication verifies Identity; Authorization verifies Membership. Users with one
Membership go directly to their dashboard. Users with multiple Memberships are restored to
their last active School and can switch context from the account menu. **School switching is
a context switch — not a new login.**

> **Still unresolved:** the JWT/session mechanics of "context switch, not new login" are
> decision D-004, and depend on the identity-scope fork D-001, neither of which this plan
> resolves. See §12 of the Governance Review.

## 16. Billing Model

Platform → Organization Billing Account → Invoices → School Subscriptions → Usage.
Organizations may pay centrally; Schools remain independently licensed. (Same Constitution
§12 override as §7 above.)

## 17. Security Invariants (proposed constitutional rules)

1. Every request executes in exactly one validated School context.
2. Identity never grants permissions.
3. Membership grants permissions.
4. School owns operational data.
5. Organization owns governance — not operations.
6. Plans never determine permissions.
7. Entitlements determine capabilities.
8. Integrations execute only within validated tenant context.
9. Background jobs receive immutable tenant context at dispatch.
10. Every destructive migration must have an additive migration phase and rollback plan.
11. Cross-school APIs are explicit and never reuse School endpoints.
12. Audit records include identity, membership, organization, school, session, and correlation ID.

> Invariants 1, 9, 10 already match committed governance (`IDENTITY_DOMAIN_MODEL_v1.md`,
> `PLATFORM_CONCURRENCY_MODEL.md`, Constitution Inv 5). Invariant 12 extends the AuditService
> `MR-002` work. On Invariant 4's spirit ("security structural, not procedural"): honest
> caveat — in Node/Mongoose no wrapper makes tenant isolation *fully* structural while raw
> driver access, aggregation, and populate exist. It is defense-in-depth backed by a
> cross-tenant regression suite, not an absolute guarantee. Word it as "progressively harder
> to violate."

## 18. Dependencies Before Implementation

No implementation begins until approved:

- **Governance:** Domain Ownership Matrix; Identity ADR; Membership ADR; Organization ADR; Integration ADR; Tenant Context ADR.
- **Security:** Tenant enforcement mechanism; cross-tenant regression tests; threat model; authorization review.
- **Platform:** Identity migration strategy; billing strategy; integration framework; audit extensions.

## 19. Explicit Non-Goals (Phase 1)

Deferred: cross-organization identities; org-wide operational edits (e.g. editing another
school's marks); org-wide fee ledgers; org-wide timetable editing; global student records
across unrelated organizations; org-wide academic ownership. The architecture should support
these later, but they are not required for the first implementation.

## 20. Long-Term Capabilities Enabled

Without redesign: multi-campus institutions, school groups, central HR, central finance,
cross-school staffing, AI copilots, executive dashboards, government integrations, accounting
integrations (QuickBooks/Xero/Zoho/Sage), Google Workspace & Microsoft 365, mobile apps,
marketplace ecosystem, public APIs, enterprise SSO, white-label deployments.

## Closing recommendation — Domain Ownership Specification

Before any coding, produce a Domain Ownership Specification separate from the ADRs,
enumerating every major business entity (Student, Guardian, Invoice, Calendar, Integration,
Library Book, Fee Structure, Payroll Record, Audit Log, Notification, …) and answering five
questions for each:

1. Who owns it? (Platform, Organization, School, Identity, Membership)
2. Can it ever be shared? Under what rules?
3. What is its tenant boundary?
4. Who may create, modify, archive, and delete it?
5. Which APIs may access it?

This is the structural-engineering drawing set produced before pouring the foundation.

---

*Target-state authority for the ADR sequence. Divergences from the approved Constitution are
tracked in `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md §12` and resolved through ADRs, not by
absorption.*
