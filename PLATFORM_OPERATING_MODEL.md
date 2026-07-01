# Msingi Platform Operating Model

**Version:** 1.0  
**Status:** Active  
**Last updated:** 2026-07-01  

This document defines the authoritative architecture of the Msingi platform. Every future capability — service, route, UI page, script, or database collection — should have a clear home here before it is built. If a feature does not fit cleanly into one of the subsystems below, the model should be updated first.

---

## 1. What Msingi is

Msingi has two distinct layers:

| Layer | Serves | Examples |
|-------|--------|---------|
| **Application** | Schools, teachers, parents, students | Students, Attendance, Finance, Report Cards, Behaviour |
| **Platform** | The application itself | Operations, Identity, Security, Governance, Deployment |

These layers are architecturally separate. School administrators interact with the Application. Platform engineers (Msingi operators) interact with the Platform. They do not share UI, routes, or mental models.

---

## 2. Platform Kernel — subsystems

The Platform Kernel has seven subsystems. Operations is one of them — not the whole platform.

```
Platform Kernel
├── Identity          Who is allowed in and what they can do
├── Security          How the platform defends itself
├── Operations        Is the platform healthy and data correct?
├── Monitoring        What is happening right now?
├── Deployment        How changes reach production safely
├── Compliance        Are we operating according to policy?
└── Governance        Audit, retention, legal, multi-tenant rules
```

### 2.1 Identity
Owns: authentication, session management, JWT signing, role assignment, multi-tenant user resolution, RBAC.

Source of truth: `users`, `sessions`, `role_permissions` collections.

Current state: implemented (`auth.js`, `rbac.js`, `tenant.js`).  
Next: AuditService instrumentation for login, role changes, impersonation.

---

### 2.2 Security
Owns: rate limiting, Helmet headers, security pattern scanning, secret rotation, penetration test findings.

Source of truth: `scripts/security-scan.js`, `scripts/.rbac-baseline`, environment secrets.

Current state: implemented (security-scan CI job, RBAC gate, express-rate-limit, Helmet).  
Next: SENTRY_DSN in production, per-tenant rate limit overrides.

---

### 2.3 Operations
Owns: platform health, data integrity, collection counts, infrastructure checks.

**Sub-components (already built):**
```
server/services/ops/
  engines/health.js       — is infrastructure alive?
  engines/integrity.js    — is data correct? (runs rule packs)
  engines/compliance.js   — are policies being followed?
  engines/release.js      — certificate storage and verification
  integrity/rules.js      — pluggable integrity rules (see Rule Packs, §4)
```

Source of truth: `release_certificates` collection; live DB checks run on demand.

Current state: implemented (Operations Engine, `/api/ops`, Platform Console at `/ops`).  
Next: health snapshots stored per-run (for trend lines without live query); Platform KPIs endpoint.

---

### 2.4 Monitoring
Owns: request metrics, error rates, slow query detection, failed job tracking, email/payment failure alerts.

Source of truth: `server/utils/monitoring.js` (local log + optional Sentry), future `platform_metrics` time-series collection.

Current state: partial — local rotating error log, Sentry stub (activates when SENTRY_DSN set).  
Next (12 months): store per-request P95 latency snapshots to `platform_metrics`; surface as Platform KPIs on the Platform Console.

**Platform KPI targets (first version):**
```
Availability          > 99.5%
Avg API response      < 400ms P95
Failed logins/day     < 5% of attempts
Failed emails/day     0 tolerated
Failed M-Pesa/day     tracked, not blocked
Failed backups/week   0 tolerated
```

---

### 2.5 Deployment
Owns: release certification, CI pipelines, migration management, rollback procedures, feature flags (future).

Source of truth: `release_certificates` collection, `.github/workflows/`, `.release-certs/`.

Current state: implemented (Release Certificate, CI test pipeline, release gate, RBAC coverage gate).  
Next: persist certs to DB via `POST /api/ops/certs` from CI; canary flag per school.

**Deployment pipeline (current):**
```
Push to main
  → CI: npm test           (unit + integration tests)
  → CI: security-scan.js   (dangerous patterns)
  → CI: verify-rbac-coverage.js  (RBAC gate ≥ baseline)
  → CI: release-cert.js    (generate + upload artifact)
  → Manual: npm run platform:release-gate  (pre-deploy readiness)
  → Staging: smoke checklist
  → Production deploy
```

---

### 2.6 Compliance
Owns: RBAC non-regression, tenant isolation verification, GDPR/data retention policy, backup verification, audit log completeness.

Source of truth: `scripts/.rbac-baseline`, `server/services/ops/engines/compliance.js`.

Current state: RBAC gate + compliance engine implemented.  
Next: AuditService (`server/services/audit.js`) — log every high-impact action (publish report card, delete student, impersonate school, change role). This is the Phase 1 primary deliverable.

---

### 2.7 Governance
Owns: audit logs, data retention schedules, multi-tenant data isolation enforcement, legal holds, terms of service versioning.

Source of truth: `audit_logs` collection (to be created with AuditService).

Current state: not yet implemented.  
Next: AuditService is the gateway to this subsystem.

---

## 3. Communication model

Today: engines call each other directly (synchronous).  
Future target: event-driven via an internal event bus.

**Current (synchronous — acceptable for now):**
```
Release cert generated → written to DB directly
Health check requested → engines run in parallel → result returned
```

**Future (event-driven — when multiple consumers exist):**
```
Event: release.published
  → Operations: store cert
  → Compliance: verify RBAC snapshot
  → Monitoring: reset uptime counter
  → Audit: log release event
  → Notifications: alert operator

Event: integrity.critical_found
  → Monitoring: increment alert count
  → Audit: log finding
  → Notifications: send operator alert
```

**Rule:** move to event-driven only when a single action has ≥ 3 consumers. Premature eventing adds complexity with no benefit.

---

## 4. Rule Packs — Integrity Engine

Integrity rules are grouped into packs. Each pack is owned by its application module. The Integrity Engine runs all packs or a named subset.

**Defined packs:**

| Pack | Module | Rules (current) | Planned |
|------|--------|-----------------|---------|
| `core` | Identity | users.missing_school_id | session orphans |
| `students` | Students | missing_school_id, duplicate_admission_numbers | promoted-but-no-class |
| `attendance` | Attendance | orphaned_records | missing term records |
| `finance` | Finance | invoices_missing_school_id, receipts_missing_invoice | unpaid invoice count drift |
| `exams` | Exams | grades.entries_missing_class | results without published exam |
| `report_cards` | Report Cards | published_missing_report_id, published_missing_hash | snapshots without PDF |
| `behaviour` | Behaviour | records_missing_student | categories no longer valid |

**Adding a new rule:**
1. Add a rule object to `server/services/ops/integrity/rules.js`
2. Set `module` to the owning pack name
3. Set `minVersion` if the rule only applies to newer deployments
4. No other file changes required

**Rule metadata standard (target format):**
```javascript
{
  id:          'attendance.orphaned_records',   // pack.check_name
  module:      'attendance',                    // pack owner
  label:       'Attendance records referencing non-existent students',
  severity:    'warn',                          // critical | warn | info
  minVersion:  null,                            // null = always run
  // future fields:
  // owner:    'Attendance Module',
  // sla:      5000,  // max ms before flagged as slow
}
```

---

## 5. Source of truth map

| Domain | Collection(s) | Authoritative service |
|--------|--------------|----------------------|
| Schools | `schools` | `server/routes/platform.js` |
| Users & Auth | `users`, `sessions` | `server/routes/auth.js` |
| Students | `students` | `server/routes/students.js` |
| Finance | `finance_invoices`, `finance_payments` | `server/routes/finance.js` |
| Exams & Grades | `exam_results`, `grade_entries` | `server/routes/exams.js`, `grades.js` |
| Report Cards | `report_card_snapshots`, `publish_batches`, `report_card_counters` | `server/routes/report-cards.js` |
| Release History | `release_certificates` | `server/services/ops/engines/release.js` |
| Audit Log | `audit_logs` (planned) | `server/services/audit.js` (planned) |
| Platform Health | live queries | `server/services/ops/engines/health.js` |
| RBAC Baseline | `scripts/.rbac-baseline` | `scripts/_rbac-scan.js` |

---

## 6. Build priority — next 24 months

Ordered by: school-facing value first, platform stability second, operator experience third.

### Tier 1 — Next 3 months (critical school value)
| Feature | Subsystem | Reason |
|---------|-----------|--------|
| AuditService | Governance | Compliance requirement; schools need to know who changed what |
| Attendance summary on report card | Application | RC-4 — requested feature |
| Behaviour/growth integration on report card | Application | RC-4 |
| Stream-level rankings | Application | RC-4 |

### Tier 2 — 3–9 months (platform reliability)
| Feature | Subsystem | Reason |
|---------|-----------|--------|
| Platform health snapshots stored per-run | Operations | Enable trend lines without live queries |
| Platform KPIs endpoint | Monitoring | First version of the CEO dashboard |
| Sentry in production | Monitoring | Know before schools report it |
| `POST /api/ops/certs` called from CI | Deployment | Close the loop — certs in DB from day 1 of each deploy |
| Per-school feature flags | Deployment | Canary deployment; RC-5 AI comments behind a flag |

### Tier 3 — 9–24 months (operational maturity)
| Feature | Subsystem | Reason |
|---------|-----------|--------|
| Event bus (internal) | Architecture | When ≥3 consumers exist for a single event |
| Load testing (k6/Playwright) | Deployment | Simulate term-end traffic before it happens |
| Digital signature on release certs | Deployment | Non-repudiation; when audit requirements grow |
| Rule Pack CLI (`npm run integrity:run -- --pack=finance`) | Operations | Targeted integrity checks per module |
| Canary deployment workflow | Deployment | Deploy to one school, observe, expand |
| Platform KPI historical dashboard | Monitoring | Trend charts for availability, API P95, failures |

### Do not build yet
- Event sourcing / CQRS — premature; add when audit log writes become a bottleneck
- Kubernetes / container orchestration — premature; add when single-server limits are hit
- AI monitoring — premature; add after AI features have shipped to production
- Microservices split — premature; monolith is appropriate at current scale

---

## 7. Platform Console (/ops) — content map

The Platform Console is the operator's single pane of glass. Every platform subsystem has a section here.

```
/ops
  Overview         — verdict banner, gate cards, last release cert
  Health           — DB, uptime, S3, SMTP, background jobs
  Integrity        — rule pack results, orphan counts, trend
  Compliance       — RBAC score, tenant isolation, audit status
  Releases         — certificate history, 30-release trend, rollback guide
  Monitoring       — error log, KPIs (when Monitoring engine is built)
  Security         — rate limit status, helmet config, scan results
  Governance       — audit log viewer (when AuditService is built)
```

---

## 8. What this model prevents

- **Feature homeless-ness**: every future feature has a named subsystem home before a line is written
- **Settings pollution**: operational features never live inside school Settings again
- **Script accumulation**: new scripts are wrappers around engine methods, not standalone tools
- **Monolith-within-monolith**: Operations stays bounded; Monitoring, Governance, and Deployment are their own subsystems
- **Premature abstraction**: event bus, microservices, digital signatures only appear when the real-world need exists

---

## 9. Definition of done for platform features

Before any platform feature (not school feature) is shipped, it must answer:

1. Which subsystem owns it?
2. Where is the source of truth?
3. Which collection(s) does it write to?
4. Which `/api/ops/*` endpoint exposes it?
5. Is it visible in the Platform Console?
6. Does it emit an event? (only if ≥3 consumers exist)
7. Is there an integrity rule or compliance check for it?

---

*This document is the architectural contract. Update it when the model changes — not after.*
