# Report Card Platform — Functional Architecture

**Date:** 2026-07-21
**Status:** Architecture only. No code, no implementation, no refactoring.
**Depends on:** [REPORT_CARD_ENGINE_AUDIT.md](REPORT_CARD_ENGINE_AUDIT.md) (technical audit) and [REPORT_CARD_ARCHITECTURE_CONSOLIDATION_PLAN.md](REPORT_CARD_ARCHITECTURE_CONSOLIDATION_PLAN.md) (rendering-pipeline consolidation). This document does not re-derive either — it answers a different question: **where does each capability belong, and why**, given Report Cards is now treated as a standalone platform module rather than a Grades sub-feature.
**Method:** Every ownership claim below was checked against the actual code — routes, client components, RBAC calls, collection references — not inferred from the earlier documents' framing. Three places where this research changed or sharpened an earlier conclusion are called out explicitly where they occur, not buried.

---

## 0. A pattern this research surfaced, load-bearing for several sections below

Before the lifecycle and ownership sections: three unrelated-looking findings turned out to be the same finding, repeated.

1. **`rc_templates`** — a full, polished admin UI at Settings → Report Templates lets a school build competency-based templates, mark them Active, assign them to classes. `report-cards.js` never reads any of it. The UI's own copy tells the admin it works.
2. **`academic_config`'s grading/ranking/display/signature-label/footer settings** — fully built server-side, real Zod validation, real defaults — and has **no client UI anywhere** to change them. Every school is permanently on the hardcoded defaults.
3. **Comment banks** — a full CRUD management screen (Grades → Config → Comment Banks) lets an admin build a picklist of reusable remarks, categorized including `'behaviour'`. The actual comment-entry fields on a report card (`StudentReportCard.jsx`) are plain `<textarea>` inputs with no picker wired to that picklist at all.

Three different collections, three different admins clicking through three different screens, all producing the identical outcome: **a screen that looks like it configures the report card, and doesn't.** This isn't three isolated bugs to fix independently — it's evidence that report-card configuration has never had one owner enforcing "if there's a settings screen for it, it must actually reach the document." That's the strongest single argument for this document's premise (a standalone module with one accountable owner), stronger than the architectural tidiness case alone.

---

## 0.5 Governing principle: Configuration is Executable

Every finding in §0 (and, per the Comment Lifecycle review, `subjectAssignmentEnforced`) is an instance of the same violation: **a configuration surface with no runtime consumer.** The principle this review now adopts as the test for every remaining design decision in this module: *if a setting cannot be traced to code that actually branches on it, either the setting shouldn't exist yet, or the feature is incomplete — never ship the appearance of a capability without the capability.*

Two scope boundaries on how this document applies that principle, stated explicitly so they aren't assumed:

- **This is adopted as the governing test for the Report Card module's design, not asserted as a verified platform-wide fact.** Every violation found so far came from auditing this one module. A platform-wide ADR making this claim for every configuration surface in Msingi (`moduleConfig`, `admissionConfig`, `staffResponsibilities`, `hiddenSystemRoles`, and everything else) would need its own audit pass across those modules before it could honestly claim compliance rather than aspiration — that audit has not been done and is out of scope here. This document commits to the principle for Report Cards' own design and to fixing the four violations already found; it does not claim the rest of the platform has been checked.
- **The principle targets silent, undocumented inertness — not staged rollout.** This session's own `identities` collection (ADR-0003 Phase 0, shipped with zero consumers for an entire phase, explicitly documented as inert-until-cutover) and `multiSchoolEnabled` (shipped inert until a platform admin deliberately activates it) are not violations — they're the same "no runtime effect yet" state as `rc_templates`, but paired with a stated reason and a stated activation trigger. The test isn't "does a consumer exist right now" — it's "if it doesn't yet, is that documented as deliberate, and is there a defined trigger for when it will." `rc_templates` and the dead `academic_config` settings fail that test; the identity migration's phases pass it. Any future report-card configuration shipped ahead of its consumer needs to pass the same test explicitly, not be assumed compliant by analogy.

---

## 1. The complete lifecycle, and who owns each stage today

| Stage | What it means | Current owner (evidenced) |
|---|---|---|
| **Configure** | Grading bands, weights, ranking rules, templates, branding, thresholds | **Fragmented — see §0.** Assessment weights/grade scales: real, in Grades→Config. Templates: real screen, zero effect. Grading/ranking/display/signature/footer: no screen exists. Fee threshold: real, in Settings→"Student & Parent Portal." |
| **Generate** | Live, unpublished computation from current marks | `report-cards.js` `POST /generate`, calling `academic-calc.js` — solid, single-sourced (Audit §1.5) |
| **Preview** | Human review before commitment | Two independent implementations: the server PDF's DRAFT watermark path, and the client's on-screen `StudentReportCard.jsx` tabs — not the same renderer (Audit §2, Consolidation Plan §1.2) |
| **Review** | Comment entry, moderation gate check | Draft comments (`report_card_draft_comments`) + the exam-moderation gate inside `POST /publish` — both inside `report-cards.js` |
| **Publish** | Commit to an immutable, versioned snapshot | `report-cards.js` `POST /publish` — genuinely strong (Audit §6.1): batch-anchored, transaction-wrapped where available, superseding not overwriting |
| **Distribute** | Make the published report reachable | **Fragmented, see §4 and §6** — Parent Portal and Student Portal each run their own independent query against `report_card_snapshots`, not a shared function `report-cards.js` exposes |
| **Verify** | Prove a document is authentic | `GET /verify/:reportId` — public, SHA-256, genuinely solid, correctly scoped inside Report Cards |
| **Archive** | Academic-year closure locks the record | `academic-config.js`'s `archive-year`/`transition-year` routes flip `yearArchived` on snapshots as part of a broader year-close cascade (also touches `exams`, `grades`) — owned by **Academic Config**, Report Cards is a downstream target, not the driver |
| **Reprint** | Re-download an already-published report | Same `GET /:id/pdf` route as first download — no separate "reprint" concept exists; nothing distinguishes a first download from a hundredth. Worth naming as a gap only if the business wants reprint-specific behavior (a watermark, a counter, an audit note) — not assumed needed here. |

**What this table shows structurally**: five of nine stages are cleanly owned by Report Cards today (Generate, Review, Publish, Verify, and — with a caveat — Preview). Configure and Distribute are the two stages actually fragmented across modules, and Archive is correctly owned elsewhere (a broader academic-year concern, not report-card-specific) but under-documented as a cross-module trigger. This matches the shape of what needs fixing much more precisely than "the whole module is a mess" would suggest.

---

## 2. Administrator workflow

The proposed canonical flow — Academic Year → Term → Section/Class/Stream → Report Card Template → Preview → Generate → Publish — is reasonable, and matches what already exists for everything except the Template step, which doesn't exist as a real decision point today (§0, finding 1). Two things worth being precise about before treating this as settled:

- **Section is not currently part of the generation flow at all.** `POST /generate`/`POST /publish` take `classId` + `termId`/`termNumber` + `academicYearId` — there is no `sectionId` parameter anywhere in this request shape. Adding Section as a real step in the canonical workflow is new scope, not a rename of an existing filter. It is, however, exactly what's needed to make Consolidation Plan §3.3's section-scoped template resolution actually reachable from the UI.
- **Template selection: automatic, manual, or both — recommend automatic-by-default with an audited manual override, not a free choice at every generation.** Reasoning: this codebase already has a precedent for exactly this shape — `POST /publish`'s `skipModerationCheck` flag requires a mandatory `skipReason` string and writes a dedicated `mark_audit_log` entry when a safety default is overridden (`report-cards.js:335-347`). Template selection should follow the identical pattern: resolve automatically via the School → Section hierarchy (§3) on every generation; allow an explicit override only for authorized roles, only with a required reason, only logged. Letting any generating user freely swap templates per run would defeat the entire point of "every Grade 5 report looks the same" that a Head Teacher actually wants (per the reviewer's own closing framing) — silent, unaudited override is the wrong default even if the underlying mechanism (a template picker) is simple to build.

---

## 3. Template assignment strategy

The proposed hierarchy — School Default → Section Default (optional) → Generation-time Override (optional) → Published Snapshot — is sound and requires no correction. Assigning authority precisely:

| Level | Authoritative for | Configurable by | Frozen at publish? |
|---|---|---|---|
| School Default | Every generation with no more specific match | School admin | No — lives at the config layer, can change for future terms |
| Section Default | Generations for that section, overriding the school default | School admin (open question — see Consolidation Plan reviewer response §2: does a section head get this, or only a school-wide admin?) | No |
| Generation-time Override | This one generation run only | Whoever has the (rare, audited) override permission — see §2 | No — it's a runtime choice, not stored config |
| **Published Snapshot's resolved `templateId`+`templateVersion`** | **The one thing that must never change once set** | Nobody, ever, post-publish | **Yes — this is the only level that should be non-negotiable** |

This resolution chain is not a new pattern this document is inventing — it's the exact shape `grade_boundaries`' `sectionId` scoping already has today (unused, per Audit §6.5) and the exact shape Consolidation Plan §3.3 already proposed for template resolution. Building the Section step into the generation workflow (§2) is what makes this hierarchy real rather than aspirational.

---

## 4. Portal behaviour — verified against the actual code, not assumed

**The claim to check: "there should only ever be one published report; everything else consumes that published snapshot."**

**Verified true in outcome, for both Parent and Student Portal**, by direct read of both routes:

- `parent-portal.js` (`~line 205`): `Reports.find({schoolId, studentId: childId, status:'published', superseded:{$ne:true}})`
- `student-portal.js` (`~line 163`): `Reports.find({schoolId, studentId, status:'published', superseded:{$ne:true}})`

Both correctly exclude drafts and superseded versions — a parent or student never sees anything but the current published snapshot. The principle holds.

**But the implementation is not "everything consumes one thing" — it's three independent re-implementations of the same filter.** `report-cards.js`'s own `GET /` list route, `parent-portal.js`'s dashboard query, and `student-portal.js`'s dashboard query each hard-code `status:'published', superseded:{$ne:true}` separately, with three separate `.select()` field lists that have already drifted from each other (the portal dashboards select a summary subset — `totalScore, averageScore, gpa, rankings` — while `report-cards.js`'s own list route selects everything except the heaviest fields). Today this is harmless (the outcome matches), but it is not the structural guarantee the reviewer is describing — it's convention, repeated three times, with nothing preventing a future edit to "what counts as current" from being made in one place and silently missed in the other two.

**Recommendation**: expose one function from Report Cards' own domain (e.g. `getCurrentPublishedReports(schoolId, studentId)`) that Parent Portal, Student Portal, and Report Cards' own list route all call, instead of each independently querying `report_card_snapshots`. This is a small, mechanical, low-risk change — not a redesign — and it's what actually makes "one published report, everything else consumes it" true as an enforced invariant rather than an currently-accurate coincidence.

**Teacher View — a finding, not a confirmation.** No reference to report cards exists anywhere in `teacher-portal.js`. There is no separate "Teacher View" of report cards today — a teacher with sufficient `grades` RBAC permission uses the identical `ReportCardsTab.jsx`/`StudentReportCard.jsx` admin-generation UI as a school admin does. The one place teacher access is actually narrower is inside `POST /publish` itself, which hard-codes `if (!['admin','superadmin'].includes(role)) return E.forbidden(...)` regardless of RBAC grants — meaning a teacher can generate, preview, and comment, but can never publish, no matter what permissions they're assigned. If a genuinely distinct Teacher View (e.g., "my own students only," "my own subject's comments only") is wanted, that's new scope, not something to document as already existing.

**Notifications — no template interaction, confirmed.** `report-cards.js`'s `_notifyReportCardsPublished` (fires the `report_published` event via `notifyGuardiansForStudents`) builds its message from `snap.studentName`/`snap.termName`/`snap.academicYear` only — no reference to template, layout, or presentation of any kind. Template selection does not and should not affect whether or how a notification fires. Worth stating explicitly since the reviewer asked; the answer is simply "no interaction, by design already."

---

## 5. Multiple templates (KG / Primary / Secondary / A-Level)

**Should parents ever see a different template for the same published report than what was generated? Should downloads and portal view ever diverge? Should every published report permanently reference one template version?**

Yes to the last question, no to the first two — and this is not a new decision this document needs to make. It's the direct, mechanical consequence of two things already designed and already agreed on:

1. Consolidation Plan §2.2: `templateId`+`templateVersion` are snapshotted onto `report_card_snapshots` at publish time, exactly like `gradingSchema` already is — frozen permanently, immune to later template edits.
2. Consolidation Plan §4: PDF download and portal view (and, per this document's §4 recommendation, both portal dashboards) become two thin adapters consuming the **same IR**, built from the **same snapshot's frozen template reference**. There is structurally no path for the PDF and the portal to disagree, because they'd have to be fed different template versions to do so, and the snapshot only carries one.

A KG report and a Secondary report legitimately use different templates — that's the point of per-section resolution (§3). What must never happen is the *same* published report rendering differently depending on which surface asked for it. The architecture already answers this; this section exists to confirm the reviewer's instinct is correct and to point at exactly which existing design decisions are the enforcement mechanism, so it isn't treated as a new open question in the eventual build.

---

## 6. Dependency review — traced, not assumed

### Assessment (Grade Scale, Assessment Weights, Pass Mark, Ranking, Moderation, Exam Results)

**Grade Scale, Assessment Weights, Pass Mark — stay in Assessment.** Checked, not assumed: `assessment_config`/`grade_boundaries` are read by `ConfigTab.jsx` (Grades module, mark-entry-adjacent) independent of report cards, and grade bands are shown inline during CA mark entry, not just on the eventual report card. These are genuinely cross-cutting academic configuration that predates and outlives any single report-card run. Report Cards should remain a **consumer**, exactly as it is today (`_loadCaConfig()` reads `assessment_config`/`grade_boundaries` read-only) — this is one of the correctly-drawn boundaries in the current system, and moving it into a Report Cards module would be a regression, not an improvement, because it would wrongly scope shared academic policy as report-card-specific.

**Moderation, Exam Results — stay in Exams.** Exams already have their own independent status lifecycle (`draft → completed → moderated → approved → locked → published → archived`) that exists for academic-integrity reasons unrelated to report cards. `report-cards.js` correctly only *reads* `examStatuses` as a publish-blocking gate (`POST /publish`'s moderation check) — it does not and should not own the moderation workflow itself.

**Ranking — a genuine reconsideration, evidence-driven.** Grepped every requirer of `server/utils/ranking.js`: exactly one production call site, `report-cards.js`, plus its own test file. Unlike grade scales, nothing else in the platform uses ranking output. The earlier framing (bundle it with Assessment because it's "academic policy") is weaker than it looks once usage is checked — ranking's *configuration* (`rankingMethod`, `rankingSubjectStrategy`, `rankingN`, `compulsorySubjects`, `showBestPerSubject`) currently lives in `academic_config` alongside the report-display settings, and its only consumer is Report Cards. **Recommend**: Ranking's configuration is a legitimate candidate to live inside Report Cards' own configuration surface, not Assessment's — the calculation utility (`ranking.js`) can stay a shared, generically-reusable function either way (pure functions, no ownership implications), but the *settings a school edits* belong with the only module that ever reads them.

### School Global Settings

**Fee clearance policy — the reviewer's stated boundary is already correct, confirmed by code, not assumed.** `reportCardFeeThreshold` lives in `schools.portalConfig` (Audit §1.9, §2.2), configured via a real UI at **Settings → "Student & Parent Portal"** (a slider control, `client/src/pages/settings/SettingsPage.jsx:1396-1406`) — a School Global Settings screen, nowhere near Grades or Report Cards. `report-cards.js`'s `GET /:id/pdf` merely reads it (`school?.portalConfig?.reportCardFeeThreshold ?? 100`) to compute a gate. **This boundary is already correctly drawn and should not change.**

**Signature images, school stamp, logo, colors — stay in School Global Settings, for the same reason as above, applied consistently.** `principalSignatureUrl`/`schoolStampUrl`/`primaryColor`/`accentColor` all live on `schools`, edited via the School Profile screen — genuinely platform-wide branding (used, or usable, by portal theming and any future output beyond report cards), not report-card-specific. Report Cards already does the right thing with them: it **snapshots the URLs at publish time** (`principalSignatureUrl`/`schoolStampUrl` frozen onto `report_card_snapshots`) rather than re-reading live values — correct, keep.

**Footer note — should move.** Unlike branding, `academic_config.footerNote` (a report-card-specific line of text, "This report card is computer-generated...") has no other consumer anywhere in the platform. It belongs in Report Cards' own configuration, not academic_config's general bucket — and per §0 finding 2, it currently has no UI to edit at all regardless of which module ends up owning it.

### Finance

**Confirmed, exactly as the reviewer framed it**: Report Cards consumes the student's live clearance status (queries `invoices` for `total`/`balance` at download time to compute `clearancePct`) while School Global Settings supplies the required threshold. Finance does not own the threshold, and Report Cards does not own or duplicate Finance's balance data — it reads it point-in-time. This three-way separation (Settings owns the policy number, Finance owns the balance fact, Report Cards owns the enforcement decision combining both) is already clean. Recommend it remain exactly as-is.

### Parent Portal / Student Portal

Covered in §4. Both already correctly show only current published snapshots; the recommendation is de-duplicating three independent query implementations into one shared function, not changing what's shown.

### Notifications

Covered in §4. `notify-dispatch.js`/`notif-settings.js` are already a proper, platform-wide shared subsystem (this session's own earlier work, not report-card-specific) — Report Cards is correctly a **trigger** (`notifyGuardiansForStudents` on publish), not an owner of delivery, channel selection, or frequency logic. This boundary is already correct. Template selection has no bearing on notification content or delivery, confirmed in §4 — worth stating as a settled non-interaction, not an open design question, when WhatsApp/SMS are eventually added: they'd be new *adapters* on the existing dispatch mechanism, exactly like a hypothetical WhatsApp render adapter would be a new *adapter* on the IR (Consolidation Plan §4) — same pattern, two different systems, not something Report Cards needs to design differently for.

### Attendance

Real, live, already correct: `attendanceSummary()` (in `academic-calc.js`) queries the `attendance` collection directly and is shown on the PDF when `config.showAttendanceSummary` is true. One design inconsistency worth naming: `academic-calc.js` (Report Cards' own calculation engine) reaches directly into `_model('attendance')` rather than calling an exported summary function *from* the Attendance module. This works today because it's read-only and the query is simple, but it's the same "one module reaching into another's raw collection" pattern that this whole document is trying to reduce elsewhere (comment banks, templates). **Recommend, not urgent**: if/when Behaviour gets an equivalent summary function built (below), build both as functions *exported by their owning modules* (`attendance.js` exports `getAttendanceSummary(...)`, `behaviour.js` exports `getBehaviourSummary(...)`), which Report Cards calls — rather than Report Cards' own calc engine directly querying two other modules' collections. Small change, better boundary, consistent with treating Attendance and Behaviour as the actual owners.

### Behaviour

**Not currently integrated server-side at all** (Audit §1.9) — only the client's separate, unofficial `printCard()` renderer shows it, sourced from a live `behaviourApi.summary()` call in `ReportCardsTab.jsx`, entirely disconnected from the persisted snapshot. If Behaviour becomes a real report-card section (the reviewer's capability-list intent), it needs a server-side `behaviourSummary()`-equivalent function, computed at publish time and snapshotted — following the exact pattern Attendance already established, not the ad hoc client-only pattern currently in use. Behaviour **data** stays owned by the Behaviour module; only a summary computation gets added, exposed for Report Cards to call and snapshot.

### Comment Banks

**Resolved in the Comment Lifecycle Review, superseding the "decide deliberately" framing this section originally used.** Comment Banks is not currently "a Report Cards dependency" in the sense of being consumed by report card comment entry at all (§0, finding 3) — it's a fully-built, entirely separate CRUD feature (Grades → Config → Comment Banks) with zero wiring into `StudentReportCard.jsx`'s actual comment fields. Its `category` enum even includes `'behaviour'`, confirming it was designed for cross-module reuse and simply never got a second consumer. **Decision: Comment Banks becomes a Shared Platform Service** (the same architectural tier `academic-calc.js`, `ranking.js`, and `notify-dispatch.js` already occupy — consumed by specific modules, owned by none of them), available to Assessment's Subject Comments, Report Cards' report-level remarks, and future Behaviour/reference-letter features. No schema change needed to make this true — only relocating ownership of the route and wiring an actual picker into each consumer's comment-entry UI, since **the one thing that must end is a management screen with no consumer**, regardless of which final ownership model was chosen.

### Academic Year

Already a coherent, self-contained lifecycle (`academic-config.js`'s year CRUD, `transition-year`, `archive-year`) that Report Cards correctly consumes via `academicYearId`/`termId`/`termNumber` — no change recommended. This is also the stage (§1) that drives the Archive lifecycle step for report cards, as a downstream cascade target, not something Report Cards should try to own or duplicate.

### Promotion

**Real, mature, and entirely disconnected from Report Cards — confirmed by code, not assumed absent.** `POST /api/students/promote` (`students.js`) is a genuine bulk year-end promotion feature: dry-run support, per-student eligibility, graduate handling, full audit trail (`promotedAt`/`promotedBy`/`promotedFrom`). It has **zero integration with report cards** — no check that a term's report cards were published before promotion runs, no reference to final grades or pass/fail status anywhere in the promotion route. **Recommend it stay owned by Students**, not move into or under Report Cards — it's a mature, independent feature with its own RBAC (`rbac('students','update')`), and Report Cards' only legitimate relationship to it would be as an optional **policy hook** ("require this term's report cards to be published before promoting this class," or "surface each student's final grade as a promotion-decision input"). Whether the business actually wants that gate is a real open product question this document is not answering on the school's behalf — flagging it as a question, not assuming yes or no.

### Audit

Already the platform-wide, correctly-shared convention — `AuditService.log({action:'report_card.publish', ...})` and equivalents. Report Cards is a **caller**, exactly like every other module in this codebase. No change recommended; do not special-case Report Cards' audit trail as something it should own independently of the platform's existing `audit_logs` mechanism.

### Verification

Correctly owned inside Report Cards (`reportId`/`sha256Hash`/`GET /verify/:reportId`) — it's intrinsic to the document type, not a generic platform service today. **QR Verification, named in the reviewer's capability list, does not currently exist** — no QR-generation library anywhere in the codebase (confirmed by dependency search); the only verification mechanism today is the text URL. Adding an actual QR image is new work (e.g., embedding a `qrcode`-generated image encoding the existing `/verify/:reportId` URL into the PDF footer) — cheap once the URL mechanism already exists, but should be named as new scope, not a rename of something already built.

---

## 7. Module ownership table

One owner per capability, as requested. "Report Cards" here means the standalone module being proposed, not the current `report-cards.js` file.

| Capability | Owner | Why |
|---|---|---|
| Report Templates (layout, sections, colors, typography, branding *application*) | **Report Cards** | Presentation-only, never touches calculation (Consolidation Plan §3.1 boundary) |
| Branding **assets** (logo, signature images, stamp, school colors) | **School Global Settings** (storage) | Platform-wide, used beyond report cards; Report Cards snapshots the URLs at publish — already correct |
| Preview | **Report Cards** | Same pipeline as Generate, pre-commitment |
| Generation | **Report Cards** | Core responsibility |
| Publishing | **Report Cards** | Core responsibility, admin-gated regardless of RBAC grant |
| Distribution (making a snapshot reachable) | **Report Cards** | Should expose the shared query (§4); Parent/Student Portal *consume* it, don't own it |
| Downloads (PDF) | **Report Cards** | Same renderer, same frozen template reference |
| Verification (hash, `reportId`, `/verify`) | **Report Cards** | Intrinsic to the document |
| QR Verification | **Report Cards** *(future, unbuilt)* | Just encodes the existing verify URL — no new owner needed when built |
| Report snapshot versioning | **Report Cards** | Already correct |
| Template versioning | **Report Cards** | Consolidation Plan §2.2 — snapshotted the same way |
| Subject Teacher Comments | **Assessment → Comments** *(superseded — see Comment Lifecycle Review)* | Already written during Mark Entry today, not report-card generation; per-subject, gathered upstream of any approval chain |
| Report-level remarks (Class Teacher, Head of Section, Principal, or whichever a school configures) | **Report Cards**, as a configurable ordered list of workflow steps | Publication-process content, not assessment evidence — no fixed roles assumed (see §11-adjacent revision below) |
| Draft Comments (report-level) | **Report Cards** | Pre-publish workspace for the configured remark steps |
| Published Comments | **Report Cards** | Part of the immutable snapshot |
| Comment Banks (the picklist) | **Shared Platform Service** *(superseded — see Comment Lifecycle Review)* | Consumed by Assessment, Report Cards, and future Behaviour/reference modules — not owned by any one of them |
| Publication Policy (moderation-required, comments-required, notify-on-publish, republish rules, etc.) | **Report Cards** | Domain-specific operational rules for the publish action itself — see §11; not a platform-wide capability toggle, so it doesn't belong in the general Settings layer |
| Grade Scale | **Assessment** | Cross-cutting — used at mark entry, not just on the eventual report card |
| Assessment Weights | **Assessment** | Same reasoning |
| Pass Mark | **Assessment** | Same reasoning |
| Ranking (configuration) | **Report Cards** *(revised — see §6)* | Sole consumer, evidenced by grep; calculation utility can stay generic/shared |
| Moderation (exam approval workflow) | **Exams** | Independent integrity workflow; Report Cards only reads status as a gate |
| Exam Results | **Exams** | Owned there; Report Cards aggregates read-only |
| Promotion Rules | **Students** | Mature, independent, zero current linkage; Report Cards is at most a future policy hook, not an owner |
| Fee Clearance Policy (threshold %) | **School Global Settings** | Confirmed already correct |
| Fee Clearance Check (point-in-time gate) | **Report Cards** | Correctly-scoped consumer-side enforcement, already correct |
| Signature Images (storage) | **School Global Settings** | Same reasoning as branding assets |
| Footer text | **Report Cards** *(should move)* | Report-card-specific, no other consumer, currently has no UI regardless |
| School Branding (global colors/logo) | **School Global Settings** | Platform-wide |
| Parent Publication | **Report Cards** | Should be one shared function (§4), not a duplicated query |
| Student Publication | **Report Cards** | Same |
| Audit History | **Platform-wide AuditService** | Established convention; Report Cards is a caller, not a special case |
| Attendance summary (for the report) | **Report Cards computes, Attendance owns the data** | Recommend exporting from `attendance.js` rather than direct cross-collection query (§6) |
| Behaviour summary (for the report) | **Report Cards computes (once built), Behaviour owns the data** | Currently missing server-side; build following the Attendance pattern |
| Notifications (trigger) | **Notifications module** | Report Cards is the trigger caller, not the owner of delivery/channel/frequency |
| Academic Year / Term | **Academic Config** | Coherent, independent lifecycle; Report Cards consumes IDs only |

---

## 8. Template vs. Configuration

The requested separation is correct and maps cleanly onto evidence already gathered — this isn't a new distinction to invent, it's the same boundary Consolidation Plan §3.1 already drew for the render layer, extended to cover the *ownership* question, not just the *code* question.

**Template (presentation, owned by Report Cards):** layout, section composition and ordering, colors, typography, branding application (how the logo/signature/stamp are placed, not the assets themselves), headers, footers as a *layout element* (the footer's position and style — the footer's *text content* is configuration, see §6/§7), graphs, section visibility toggles, signature block styling.

**Configuration (academic policy, owned per §6/§7):** grade scale and assessment weights (Assessment), pass mark (Assessment), ranking method/strategy (Report Cards, per the revised §6 finding), promotion rules (Students, not report-card configuration at all), GPA display toggle (Report Cards — it's a *display* decision about already-computed data, not a policy decision), attendance/class-average/deviation display toggles (Report Cards — same reasoning: these decide whether to *show* something Assessment/Attendance already computed, not how to compute it), footer *text* (Report Cards, per §6/§7).

The distinguishing test, consistent with the Consolidation Plan's own boundary: **if changing it could change a number on the report, it's Configuration and belongs with whichever module computes that number. If it only changes how an already-computed number is displayed or arranged, it's Template, and belongs with Report Cards.** GPA/attendance/deviation *display toggles* pass this test as Report Cards' own concern (they don't change the GPA, they decide whether to print it); the grade scale itself fails it (changing it changes the GPA) and stays with Assessment.

---

## 9. Challenging the proposal directly

Per the request not to simply validate — three places where the proposal, taken literally, would introduce debt rather than remove it, plus one place it should go further than stated.

**1. Don't let "Report Cards becomes a standalone module" imply Assessment's grading/weighting logic should move with it.** The framing throughout the reviewer's message groups Grade Scale, Assessment Weights, Pass Mark, Ranking, Moderation, and Exam Results together under "review whether these should remain inside Assessment" — treating them as one bundle. They aren't one bundle. §6 traced actual usage and found a real split: Grade Scale/Weights/Pass Mark are genuinely cross-cutting (used before any report card exists) and moving them would recreate, on the Report Cards side, exactly the kind of hidden-dependency mess this whole exercise is trying to eliminate from the Settings side. Ranking, by contrast, has no other consumer and *should* move. Treating the whole assessment bundle as one decision would get three of four items wrong.

**2. Comment Banks should not be assumed into Report Cards by default just because it's report-card-adjacent.** Its own `category` enum (`academic/behaviour/general/subject`) is evidence it may have been designed for broader reuse than report card remarks alone. Claiming it for Report Cards without checking whether Behaviour incident entry was ever meant to consume it too would repeat, at the ownership-decision level, the exact "assume the obvious owner without checking" mistake that produced the `rc_templates`/`academic_config` gaps in the first place (§0). This was left as an open question here — **now resolved in the Comment Lifecycle Review: Shared Platform Service**, not owned by either module (§6/§7 updated accordingly).

**3. The proposed hierarchy (School → Section → Generation-time Override → Published Snapshot) is right, but "Generation-time Override" needs a stated permission and audit model before it's built, not left as "optional."** An unaudited per-run template swap available to whoever generates a report undermines the very consistency guarantee (§2) the reviewer's own closing framing cares about — a Head Teacher trusting that "every report from this school looks the same" is not compatible with a quiet per-run override nobody has to justify. This document recommends mirroring the existing `skipModerationCheck` pattern (mandatory reason, mandatory audit log, restricted to specific roles) rather than treating the override as a simple picker anyone with generate access can use.

**4. Where the proposal should go further: the "one owner per capability" table (§7) surfaces that "Distribution" isn't really owned by Report Cards today — it's independently reimplemented three times (§4).** The reviewer's own framing ("everything else consumes that published snapshot") already implies this should be one function, but the request as written treats Portal Behaviour as a verification question ("does it already work this way?") rather than an ownership question. It's both: the *outcome* is correct, but *ownership* of "how do you fetch a student's current published reports" isn't actually held by any one piece of code — it's a convention three files independently follow. That should be named as a real ownership gap in its own right, not folded silently into "portal behaviour looks fine."

---

## 10. Migration strategy note

This document does not restate Consolidation Plan §5 (sequencing, no-breaking-changes constraints) — that guidance stands unchanged and applies identically here, since nothing in this document proposes touching `report_card_snapshots`' hash payload, the publish workflow, moderation, or RBAC's underlying enforcement mechanism. Two additions specific to *this* document's findings, for whenever implementation is scoped:

- **The RBAC split found in `report-cards.js`** (`rbac('grades', ...)` for most routes, `rbac('report_cards', ...)` for the draft-comments routes) needs a decision before or alongside module extraction — whichever key is chosen as canonical, existing role assignments granting only one of the two would need remapping, which is a real, if small, migration step touching live permission data, not a pure code change.
- **If `rc_templates`/comment-bank data already exists in any school's database** (plausible, since both screens are live and usable today, just silently ineffective), the eventual functional spec should state explicitly whether that data is absorbed into whatever replaces it or discarded with notice — this document doesn't resolve that, per the open question already raised to the user in the prior turn.

---

## 11. Configurable capabilities, not fixed roles

Revising every place above that named a fixed comment role: **no comment type should be modeled as a hardcoded field.** A school configures which report-level remark steps it wants — some schools run Subject Teacher → Class Teacher → Principal, others insert a Head of Department or Year Leader, others want Subject Teacher comments only. The architecture should model *configurable participants*, not assume any school's organizational structure.

This resolves cleanly into two different mechanisms, not one unified list, because the two things being configured have different shapes:

- **Report-level remarks (Class Teacher, and whatever else a school configures — Head of Section, Deputy Principal, Principal, etc.) fit `workflow-config.js`'s existing chain model directly.** Sequential, single-value-per-student, each step both writes a remark and advances the record — exactly the shape `getWorkflowConfig`/`saveWorkflowConfig`/`_resolveAssignee` already support, proven across two other workflows (`leave_approval`, `marks_unlock`) this session. A school defines its own ordered step list; Report Cards executes whatever is configured, with zero hardcoded roles anywhere in the module.
- **Subject Teacher Comments do not fit that same shape** and shouldn't be forced into it. There are N of them per student (one per subject), gathered upstream in Assessment before any report-level chain begins — not a single sequential step. This is a capability toggle owned by Assessment (`Enable Subject Teacher Comments` → the field appears or disappears in Mark Entry), and its completeness becomes an input to Publication Policy (§12) — "require subject comments before publish" — rather than another step in the same chain.

**The render-time consequence, stated precisely so it isn't built as a naive boolean**: a disabled capability must produce zero trace in the output — no section header, no "Comment not provided" placeholder, nothing. This means the IR-building step (Consolidation Plan §4.1) must check **both** the capability flag **and** actual data presence before including a section block, not the template's static toggle alone. A template saying "show subject comments" means "if the capability is enabled and content exists for this student" — never an unconditional instruction to render a block regardless of whether there's anything in it.

---

## 12. Publication Policy

A concept this document did not previously separate out: the operational rules governing *whether a specific report may be published*, distinct from both Template (presentation) and the academic Configuration owned by Assessment/Attendance/etc. (§8).

**Ownership: Report Cards, not the general platform Settings layer.** Reasoning: every rule in this category — require moderation complete, require all marks finalized, require subject comments complete, require the class-teacher-comment step done, respect the fee clearance policy, notify parents/students automatically, allow draft downloads, allow republishing — is specifically "what must be true before *this module's* publish action may proceed." Nothing outside Report Cards' own publish logic could enforce it. Placing it in a generic platform-wide configuration bucket would recreate exactly the fragmentation problem (§0) this whole review has been diagnosing, just moved one level up.

**Most of Publication Policy is not new scope — it's consolidating rules that already exist, scattered and mostly not school-configurable:**

| Rule | Exists today? | Where |
|---|---|---|
| Moderation must be complete before publish | Yes | Hardcoded inside `POST /publish` — not currently a per-school toggle; every school gets the same rule, bypassable only via the audited `skipModerationCheck` override |
| Respect fee clearance policy | Yes | Reads `schools.portalConfig.reportCardFeeThreshold` — already school-configurable, already correctly scoped (§6) |
| Notify parents/students on publish | Yes | Governed by the Notifications module's own per-event settings (`report_published`), not a Report-Cards-specific toggle today |
| Require subject/class-teacher comments complete | No | New — becomes possible once §11's capability model exists |
| Allow draft downloads | Partially | The DRAFT watermark path exists (Audit §2.2); whether a school may *disable* draft downloads entirely does not |
| Allow republishing | Implicitly yes, always | No school can currently say "no, once published, an academic year's report is final" — versioning always permits a new publish |

The work here is less "build eight new rules" and more "take three already-real, mostly-hardcoded behaviors, make them a coherent per-school-configurable object Report Cards' publish action reads as one unit, and add the genuinely new ones (comment-completeness, draft-download and republish permissions) using the same object." Consistent with §0.5: each of these needs a verified runtime consumer before it ships as a toggle — the moderation and fee-clearance rules already have one; the new ones don't yet, and shouldn't be exposed in any settings UI until they do.

**Forward-compatibility note, not a design requirement for the first version**: today's rules are all simple boolean switches ("require X: yes/no"). A later, genuinely more advanced need — conditional rules keyed on curriculum or section (e.g. *"if IGCSE, require subject comments"*, *"if Primary, hide rankings"*) — is a different, heavier mechanism (a rules engine) that should **not** be built now. The only thing worth doing today is not closing the door on it: store each policy rule as a discrete, independently-evaluated `{key, enabled}` entry rather than a single monolithic config blob, so a future `{key, condition, enabled}` shape (evaluated per-student against curriculum/section/year at generation time) can be introduced later without restructuring how Publication Policy is stored or read. No rules engine, no conditional-evaluation logic, no new schema beyond that — just don't paint the first version into a shape that would force a breaking change to add conditions later.
