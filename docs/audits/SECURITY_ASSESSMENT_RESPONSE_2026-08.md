# Response to External Security Assessment (2026-08-28)

**Assessment reviewed:** *Msingi (msingi.io) — Security · Functional · Load Assessment*, dated 2026-08-28, prepared by an external third party against production (`msingi.io`) and the demo tenant (`demo.msingi.io`), platform v4.28.0.

**This document's purpose:** state, item by item, what the external assessment found, what we independently verified (not simply accepted), and what has actually been fixed as of this writing — including where we found the report's own conclusion wrong, and where a finding is still genuinely open.

**Status as of this report:** all fixes below are committed to `main` (`github.com/condolo/sms`) and covered by the existing Jest suite (158 suites / 1508 tests passing). This document does not claim a production deployment has been verified post-fix — that is a separate step.

---

## 1. How we responded, in outline

We did not treat the external report as a checklist to implement against. Each finding was independently re-derived from the actual code, and where reachable, re-tested live against the running system, before any fix was written. This surfaced three outcomes the external report itself did not distinguish:

- Findings the report got **right**, confirmed independently (most of them).
- One finding the report got **wrong** — S-9, "the platform is read-only," did not reproduce under direct testing.
- A **broader set of the same defect pattern** than the report scoped — e.g. S-13's two named endpoints (payroll, invoices) turned out to be two instances of a pattern repeated across roughly 30 route files, not two isolated bugs.

The fuller internal audit (four passes: HR/Finance/portals, academic modules, platform-admin/audit trail, secrets exposure, plus a configuration→enforcement sweep) produced 74 findings in total, most outside this report's original scope. That full register is tracked separately; this document stays scoped to **the external report's own findings**, stating plainly which of *those specific items* are fixed, which are open, and which did not hold up.

---

## 2. The three headline issues, in the order the report ranked them

### S-1 — Full source code publicly downloadable — **FIXED**

**What the report found:** production's static-file server exposed the entire backend source tree — every route file, the JWT/RBAC/tenant-isolation middleware, database indexes, seed scripts (including demo credentials), internal scripts, and `package.json`.

**Independent verification:** confirmed by direct HTTP request against production — `GET https://msingi.io/server/index.js` returned HTTP 200 with real source and the correct `application/javascript` content type. The report's characterization was accurate.

**Fix:** `server/index.js` mounted `express.static()` at the entire repository root, with only `.git`/`.env`/`.htaccess`/`backups` explicitly blocked. That mount was replaced with a narrow one scoped to the single real public-assets directory the legacy `onboard.html`/`platform.html` pages actually need (`/css`). Nothing else under the repository root is reachable through this route now. The dead `STATIC_DIR` variable and an unreachable duplicate JWT-secret warning that lived downstream of the old mount were removed in the same pass.

**Commit:** `3e311fe`. **Test:** full suite passing; a live re-check that `/server/*`, `/scripts/*`, and `/package.json` return 404 in production is a post-deploy step, not something verifiable from this environment.

**One thing found in the same sweep the report didn't call out separately:** the same demo password this exposure made public (`Demo2025!`) is *also* hardcoded directly into the React login page's bundled JS (`client/src/pages/Login.jsx`), reachable from browser devtools independent of S-1. That is tracked as its own item (EXP-04) and is **not yet fixed** — see §4.

---

### S-9 — "All data-creation operations return errors; the platform is effectively read-only" — **NOT REPRODUCED**

**What the report found:** creating students, events, classes, and messages all failed server-side; the platform behaved as read-only.

**Independent verification:** this is the one headline finding we could not confirm, and we tested it directly rather than taking either the report's word or our own assumption. A full create→read→update→delete cycle was run live against production for events, classes, students, and messages. All four succeeded cleanly on a correctly-formed request.

The likely origin of the report's finding: the *first* attempt we made to create an event returned a genuine HTTP 400 — but because the payload sent `date` where the API requires `startDate`, not because writes are broken. A validation error on a malformed request, if not retried with a corrected payload, would present exactly like "creation fails" without actually being a platform-wide outage.

**Disposition:** logged as **Not Reproduced**, held distinct from both "Unconfirmed" (not independently tested) and "False Positive" (actively disproven) — this one was actively tested and the claimed failure mode did not occur. No fix was needed or applied. If data-creation failures are still being observed in a specific workflow, that is a different, narrower bug than what this report described, and would need its own reproduction steps.

---

### S-13 — Horizontal privilege escalation (payroll & invoices) — **STILL OPEN**

**What the report found:** any teacher could retrieve full payroll records (salary, allowances, deductions) for every staff member, not just their own; any parent could retrieve invoice/payment history for every family in the school, not just their own children.

**Independent verification:** confirmed, and confirmed live — a demo parent account with one linked child retrieved a different family's real invoice and payment data via a single query-parameter swap. The root cause is real: both the payroll list (`server/routes/hr.js`) and the invoice list (`server/routes/finance.js`) filter by a client-supplied `staffId`/`studentId` with no check that it belongs to the requesting user — the permission model gates *whether* a role can see the module at all, but nothing then restricts *whose* records within it.

**What we found beyond the report's scope:** this is not two isolated bugs. The same exact pattern — a route that authorizes module access but never checks record ownership — recurs across roughly 30 files: exam results, grades, assessment marks, report cards, medical visit records, behaviour/disciplinary records, and three "growth profile" modules that leak cross-family **by default**, with no misconfiguration required. We also live-confirmed one of these beyond the report's own two: the same demo parent account retrieved another family's child's real disciplinary record.

**What has actually shipped so far — and what has not:** during this remediation program we prioritized and fixed two same-pattern findings from our own broader sweep (class-roster and stream-roster endpoints exposing full student/parent PII with zero scope check — commit `9abb06d`) and a related fee-clearance bypass (commit `9abb06d`). **We have not yet fixed the two endpoints this report specifically named** — the payroll list and the invoice list. Being direct about that rather than letting the roster fix stand in for it: **S-13, as the report describes it, remains an open, exploitable finding today.**

This is scheduled as the next priority. Given the pattern's breadth, the honest scope is larger than "fix two endpoints" — the ~30 same-pattern instances share one root cause and should be fixed under one consistent mechanism (the codebase already has the right primitive, `ScopeEngine`, correctly used in some files and simply never wired into these), not patched endpoint-by-endpoint.

---

## 3. High-severity findings

| ID | Finding | Status | What was done |
|---|---|---|---|
| S-3 | Demo credentials disclosed in public source; demo tenant live | **Confirmed, not yet fixed** | Verified live — the disclosed password authenticates against production today. Rotation/isolation of the demo tenant is a deployment action, not yet performed. |
| S-8 | Social login (Google/Microsoft) non-functional | **Unconfirmed** | Not independently re-tested this pass (requires live OAuth provider credentials we don't hold in this environment); report's account not disputed, just not re-verified. Not fixed. |
| S-10 | Google Classroom integration always errors | **Confirmed, root cause identified, not yet fixed** | Traced to source: `server/routes/elearning.js`'s `_getToken()` references `req` outside its own scope, throwing on every call — 10 call sites, all currently dead. Root cause matches the report's diagnosis exactly. Fix is a small, well-understood one-parameter correction; not yet applied. |
| S-13 | Horizontal privilege escalation (payroll, invoices) | **Confirmed live, still open** | See §2 above — not yet fixed at the exact endpoints named. |

---

## 4. Medium-severity findings

| ID | Finding | Status | What was done |
|---|---|---|---|
| S-4 | System info disclosure via public endpoints | **Unconfirmed; likely resolved as a side effect of S-1's fix** | Not independently re-verified; the same static-mount fix that closed S-1 also removes public reachability of the dependency manifest the report cited. Health-check output itself hasn't been separately audited. |
| S-5 | Wildcard DNS enables lookalike branded login pages | **Unconfirmed, not fixed** | Infrastructure/DNS-level change (explicit per-tenant records), outside a code fix; not actioned this pass. |
| S-6 | Auth token-exchange endpoint behaves inconsistently | **Unconfirmed, not fixed** | Not independently re-tested; tied to the same OAuth configuration gap as S-8. |
| S-11 | School-settings update over-submits (mass-assignment risk on the permission matrix) | **Partially confirmed, not fully fixed** | The report's core claim was more accurate than a first read suggests, but not the whole story: `PUT /school` already allowlists fields server-side (a mitigation the original report didn't credit), so an attacker cannot inject arbitrary new fields. The real exposure is narrower but still real — the allowlist itself bundles the full permission matrix and M-Pesa payment credentials into the same list as cosmetic fields like theme color, all behind one `settings:update` check. If the settings form ever round-trips its full loaded state on a routine save (a common pattern), a theme change carries the permission matrix and payment credentials over the wire with it. Splitting those into a separately, more tightly gated endpoint has not yet been done. |
| P-1 | Throughput ceiling ~150–200 req/s, single origin | **Unconfirmed, not actioned** | Requires load-testing tooling not available in this environment. Direction (horizontal scaling) not disputed. |
| P-2 | Dashboard permission look-up performs repeated uncached queries | **Unconfirmed, not actioned** | Not independently re-verified. Separately, we did confirm during a related pass that permission/role *changes* propagate immediately rather than waiting on a cache — a different question from this finding's read-path caching claim. |

---

## 5. What we would push back on in the report itself

Being asked for an objective read, not agreement, three things are worth flagging:

1. **S-9 was wrong.** Presented as a Critical, platform-wide, "the product is read-only" finding, it did not reproduce under direct live testing of the exact operations named. The likely cause was a single malformed test request, not a system-wide fault. This is the kind of claim that, left unchallenged, would have sent remediation effort at a problem that doesn't exist while the real Criticals waited.

2. **S-13 understated its own scope.** Framed as two endpoints, it is a single missing-authorization-layer pattern repeated across roughly 30 files, including modules the report never tested (medical records, disciplinary records, family "growth" data). Fixing only the two named endpoints would have left the same exploitable gap in place everywhere else it occurs.

3. **S-1's blast radius includes something the report didn't separately flag**: the demo password it exposed via the source tree is *also* independently embedded in the client-side login bundle, so fixing the static-file mount alone does not fully remove public exposure of that credential.

None of this changes the report's core value — S-1 and S-13 in particular were real, serious, and correctly prioritized as the two most urgent categories. The corrections above are about scope and one factual claim, not about the report's overall judgment.

---

## 6. Summary table — every finding in the external report

| ID | Report's severity | Independently confirmed? | Status today |
|---|---|---|---|
| S-1 | Critical | Yes | **Fixed** (`3e311fe`) |
| S-9 | Critical | **No — not reproduced** | Closed, no fix needed |
| S-13 | High | Yes, live | **Open** — not yet fixed at the named endpoints |
| S-3 | High | Yes, live | Open — credential rotation not yet performed |
| S-8 | High | Not re-tested | Open |
| S-10 | High | Yes, root cause identified | Open — fix understood, not yet applied |
| S-4 | Medium | Not re-tested | Likely resolved as a side effect of S-1's fix |
| S-5 | Medium | Not re-tested | Open |
| S-6 | Medium | Not re-tested | Open |
| S-11 | Medium | Yes, partially | Open — partial mitigation already existed; bundling issue remains |
| P-1 | Medium | Not re-tested | Open |
| P-2 | Medium | Not re-tested | Open |

**Net position:** of the report's two Criticals, one is fixed and one did not hold up under testing. Of its four High findings, one (S-13) is confirmed and still open, one (S-10) has a known, unapplied fix, and two (S-3, S-8) are confirmed-or-unconfirmed and open. None of the six Medium findings have been actioned yet.

This report's own two Criticals are resolved (one fixed, one refuted). The next priority, by the report's own ranking, is S-13 — and the honest scope of that fix is larger than the two endpoints named, per §2 and §5 above.
