# Identity Domain Model v1.0

**Status:** Draft — pending review
**Purpose:** Defines the entities, ownership, invariants, and boundaries of Msingi's identity system. This is a domain model, not a decision record — it does not approve D-001 (see `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`); it defines the vocabulary D-001, and every ADR that follows it, will be written in.

---

## Entities

### Human
Not a Msingi-owned record. The real person. Msingi never stores a "Human" entity — only its own representation of one. Real-world identifiers (National ID, TSC Number, passport) may exist as *fields on* Platform Identity for verification purposes, but Msingi neither issues nor owns them.

### Platform Identity
Msingi's single, global representation of one Human. Created once; persists for the entire span of that person's relationship with Msingi, across however many schools or organizations they touch over however many years.

- **Owns:** email(s), credential references, MFA configuration, profile photo, preferred language, notification preferences, optionally a verified external professional ID.
- **Owns nothing else.** No permissions, no employment data, no organizational knowledge.
- **Cannot see anything.** It is a passive record, never an actor.
- **Structural invariant:** Identity is a *target* of references, never a *container* of them. It must never embed a list of its own memberships. Every Organization Membership and School Membership points *at* an Identity by reference; Identity never points back. This is what makes "Organization A can see Organization B's data about this person just by looking at their identity" structurally impossible rather than merely discouraged.
- **Owner:** Identity Team, per `PLATFORM_OPERATING_MODEL.md §8`.

### Organization
Already defined in `ARCHITECTURE_CONSTITUTION.md` — the legal/operational entity owning one or more Schools.

- **Owns:** name, slug, plan/subscription (future), which Schools belong to it.
- **Invariant:** never references an Identity directly. Relates to Identities only through Organization Membership.

### Organization Membership
Links one Platform Identity to one Organization, at the org level — distinct from any one school.

- **Owns:** org-level role (e.g. Group HR, Group Finance Director — roles operating across every school in the group), start/end dates, status.
- **Answers:** "Are you part of this group, and in what org-wide capacity?"
- **Distinct from School Membership** — someone can hold an Organization Membership with no School Membership at all, or the reverse.

### School
Already defined in the Constitution — the operational tenant. Owns all transactional data (students, exams, finance, timetable).

- Belongs to exactly one Organization.

### School Membership
Links one Platform Identity to one specific School.

- **Owns:** school-level role (Principal, Teacher, Finance, Parent...), employment dates, department, subjects, teaching load, salary — every field already agreed to be "employment," never identity.
- **Answers:** "What do you do at this specific campus?"
- **Owner:** the School (via its Organization), per Constitution Invariant 4.

### Authorization
Not a stored entity — a *derived result*, computed at request time from whichever School Membership (or Organization Membership, for org-level actions) is currently active in the session.

- **Owns nothing persistently.** RBAC permissions, DataScope, plan-gating are all functions of "which Membership is active right now."
- **Invariant:** never cached or derived from Identity directly. Always from the specific active Membership.

### Session
One authenticated browser session for one Identity, with exactly one active Membership context at a time — Constitution Invariant 1, unchanged by everything above.

- **Owns:** which Identity, which Membership is currently active, IP/device/last-activity metadata.
- **Invariant:** the underlying Identity of a session never changes mid-session; the *active Membership* can, via the switch mechanism (D-004, still pending).

### Credential
The actual authentication factors — password hash, MFA secret, recovery codes.

- **Owned by Identity**, never by Membership. There is exactly one password and one MFA configuration per Identity, regardless of how many memberships it holds.

### External Identity (Google, Microsoft, future SSO)
A link from one Platform Identity to one external OAuth account.

- **Owns:** provider, external subject ID, linked-at timestamp.
- **Invariant:** exactly one Platform Identity per external account, never scoped per-Organization. This is the specific entity that made Platform Identity (not Org-scoped identity) the right call in the D-001 comparison — Org-scoping this would force re-linking the same Google account to a new Msingi identity every time someone joined an unrelated org.

---

## Identity Lifecycle

```
Invited → Pending Verification → Active → Dormant → Merged → Archived → Erased
```

- **Invited** — not yet a Platform Identity at all. Only an Invitation record exists (see below), owned by the inviting School/Org.
- **Pending Verification** — the person has started claiming the invite; an Identity record now exists but isn't yet usable.
- **Active** — fully claimed and usable.
- **Dormant** — no active memberships currently, but the Identity persists.
- **Merged** — consolidated into another Identity via the contact-verified merge flow; retains a forwarding pointer, never deleted outright.
- **Archived** — account closure requested or equivalent; historical references must still resolve.
- **Erased** — right-to-erasure honored: Identity fields anonymized; Membership/employment records remain, referencing the anonymized Identity, per the append-only philosophy already established for report cards and audit logs.

## Membership Lifecycle

```
Pending Invitation → Accepted → Active → Suspended → Archived → Restored
```

Applies identically to Organization Membership and School Membership.

## Resolving the pending-invitation question

An invitation never creates an Identity. It creates a separate, lightweight **Invitation** record — owned by the inviting School or Organization, holding only the target email and the intended Membership. Two schools inviting the same email are two independent, unrelated Invitation records; whichever the person actually accepts first is the one that creates (or links to an existing) Identity.

## Cross-boundary rule: what each entity must never know

| Entity | Must never know |
|---|---|
| Platform Identity | Its own list of memberships (structural — see invariant above) |
| Organization | Another Organization's existence or data, ever |
| Organization Membership | Anything about a *different* Organization's memberships for the same Identity |
| School Membership | Another School's employment data for the same person, even within the same Organization, unless explicitly surfaced through an Organization-level report |
| Authorization | Anything not derivable from the currently active Membership |
| Platform Admin | Out of scope for this model entirely — a separate system (`platformSession`, `PLATFORM_JWT_SECRET`), not a layer within it. Its own accountability gap (impersonation logged as actor `"platform"`, not a named individual — `server/routes/platform.js:365`) is a related but independent future decision. |

## Constitutional principle proposed

> *Identity establishes who a person is. Membership establishes where they belong. Authorization establishes what they may access. These concerns shall remain independent throughout the platform.*

Recommended for promotion into `ARCHITECTURE_CONSTITUTION.md` once D-001 is ratified — not decided by this document, which only defines terms.

---

*This document defines vocabulary and invariants only. It does not ratify D-001, D-002, D-003, or D-004 — see the Decision Register in `ARCHITECTURE_GOVERNANCE_REVIEW_v1.md`.*
