# Report Card Architecture — Consolidation Plan

**Date:** 2026-07-21
**Status:** Architecture proposal only. No code, no implementation, no refactoring.
**Depends on:** [REPORT_CARD_ENGINE_AUDIT.md](REPORT_CARD_ENGINE_AUDIT.md) — every
claim below traces back to a finding in that document; this plan does not re-derive
them, it acts on them.
**Objective, as reframed:** not "produce one internationally-capable PDF," but design
the path to a **Report Card Template Engine** — the platform capability that lets
every school define its own layout, branding, and (eventually) curriculum shape,
on top of a calculation core that stays exactly as strong as it is today.
**Explicitly not in this document:** no code, no new collections built, no existing
collection dropped, no route changed. This is the design every subsequent
implementation phase will be checked against — implementation begins only after this
plan (and the functional specification that follows it) is explicitly accepted.

---

## Phase 1 — Map every duplication

Five duplications were confirmed in the audit. For each: why it likely exists,
which surface is authoritative going forward, and what gets deprecated (not
deleted — see Phase 5 on why deletion is sequenced last).

### 1.1 Calculation engines — `academic-calc.js` vs `grade-calc.js`

- **Why it exists:** `academic-calc.js` is the engine actually wired into
  `report-cards.js`'s `/generate` and `/publish` — it is the system-of-record path.
  `grade-calc.js` implements an overlapping but distinct model (half-term
  re-scaling, term-blending) and is required only by `assessment.js`, which uses it
  for CA-mark dashboard/summary views, not for anything that reaches a published
  report card. The most likely history: `grade-calc.js` was written first, for the
  CA/HW/MT/ET assessment-entry module's own in-module summaries; `academic-calc.js`
  was written later, purpose-built for the report card pipeline once that became a
  separate concern, and the two were never reconciled because they don't currently
  *look* like they conflict (different call sites, no shared caller today).
- **Authoritative going forward:** `academic-calc.js`. It is the one the highest-
  stakes surface (published, hashed, versioned report cards) already depends on.
- **Deprecated:** `grade-calc.js`'s calculation functions
  (`validateWeights`/mark-aggregation/blending). `assessment.js`'s dashboard/summary
  call sites migrate to call `academic-calc.js`'s existing aggregate + compute
  functions instead of maintaining a second implementation of the same math.
  Anything in `grade-calc.js` that is genuinely assessment-entry-specific (not a
  duplicate of scoring math — e.g. weight-sum validation UI feedback) can stay, but
  the *scoring* logic itself does not get two homes.

### 1.2 Rendering engines — server PDFKit vs client browser-print HTML

- **Why it exists:** the server PDF path was built for the "official" artifact —
  it needs to be tamper-evident, versioned, and reproducible on demand, so it was
  built once, carefully, inside the publish/snapshot pipeline. The client
  `printCard()` HTML-string generator was very likely added afterward as a fast,
  self-service "let a teacher glance at / print something today" convenience,
  built directly against the live `/generate` preview data (which was already on
  the page) rather than against the persisted, hashed snapshot — and, once built,
  it accreted its own content (Behaviour stats, term-over-term deviation) that was
  never back-ported to the server PDF, because nothing forced the two to stay in
  sync.
- **Authoritative going forward:** **neither, as they exist today.** This is the
  one duplication where the fix isn't "pick a winner," because neither renderer is
  actually the right long-term shape — see Phase 4. The *authoritative source of
  content* (the computed report object + whichever template is selected) becomes a
  single upstream artifact; both today's renderers are replaced by thin adapters
  that consume it.
- **Deprecated:** `StudentReportCard.jsx`'s `printCard()` — the entire hand-built
  HTML-string generator — is retired once the shared rendering pipeline (Phase 4)
  exists. Until then, it is not touched (see Phase 5 sequencing: this dependency is
  resolved by building the replacement first, not by deleting the fallback first).

### 1.3 Grading scales — three defaults, one legitimate

- **Why it exists:** `academic_config.gradingSchema` is the original, inline
  grading-schema field (8-band, 4.0-point). `grade_boundaries` was added later as
  the more capable system — multiple named scales, optional `sectionId` scoping,
  one flagged `isDefault`. The compute path already prefers `grade_boundaries` over
  `academic_config.gradingSchema` correctly
  ([report-cards.js:207](../../server/routes/report-cards.js#L207)) — that part of
  the fallback chain is deliberate and fine. The illegitimate third copy,
  `client/constants.js`'s `DEFAULT_GRADE_SCALE`, is a different 12-point scale that
  was, almost certainly, hand-typed once as a client-side placeholder before
  `grade_boundaries` existed or was reliably returned by the API, and never removed
  once the server started sending a real scale down.
- **Authoritative going forward:** `grade_boundaries` (the school's `isDefault`
  scale) → `academic_config.gradingSchema` (documented fallback for schools with no
  `grade_boundaries` scale configured yet) → this two-tier chain is correct and
  stays exactly as-is. Whatever scale the **server** used to compute a report's
  grades is the only scale that may ever be used to *display* a grade for that
  report, anywhere.
- **Deprecated:** `client/constants.js`'s `DEFAULT_GRADE_SCALE` as a computation
  input. The client already receives `config.gradeScale`/`config.gradingSchema` in
  the `/generate` response — every client-side grade computation
  (`_gradeFromScale`) must be driven by that server-supplied value, never by a
  locally-invented fallback. (This is flagged in the audit as a live P1 — see §4 of
  this plan for why it's sequenced first, ahead of the rest of this consolidation.)

### 1.4 Template concepts — three, none functioning, one worth keeping

- **Why it exists:** `templateId` (`academic_config`, `'tabular'|'card'|custom`)
  reads as an early placeholder — a field added in anticipation of a future
  templating feature that was never built against it. `reportTemplate`
  (`assessment_config`, `'detailed'|'summary'`) is a genuinely different, narrower
  concept — it controls how the *assessment-entry dashboard* presents a CA summary,
  not how a report card looks; it was very likely named similarly by coincidence
  (both modules independently needed a "how much detail to show" flag) rather than
  because anyone intended it to relate to report card templates. `rc_templates` is
  the most complete of the three — a real, validated, tenant-scoped CRUD API
  modeling performance bands, ordered subjects, and learning indicators, which
  strongly resembles a competency-based / early-years report format (CBC-shaped).
  It has every hallmark of a feature that was built to completion on the backend
  and then never connected to `report-cards.js`'s generation pipeline — most likely
  paused mid-integration rather than abandoned by design.
- **Authoritative going forward:** none of the three, individually — Phase 3 below
  designs the real Template Engine. But `rc_templates`' *data shape* (bands,
  ordered subjects, indicators, display toggles) is the best existing raw material
  for that engine's competency-report variant and should be **absorbed**, not
  reinvented.
- **Deprecated:** `academic_config.templateId` — removed outright once the real
  Template Engine ships (it never did anything; there is no behavior to preserve).
  `assessment_config.reportTemplate` — kept, but explicitly re-scoped in
  documentation/comments to "assessment dashboard only," so nobody mistakes it for
  a report-card setting again. `rc_templates` — its collection and route are
  superseded by the new Template Engine's schema (Phase 3); its *data* migrates in
  rather than being thrown away, for any school that already configured one.

### 1.5 Configuration sources — four collections, no unified view

- **Why it exists:** each collection was added by a different feature phase without
  a later pass to unify "everything that affects how a report card looks and
  scores": `academic_config` (grading fallback, ranking, display toggles, signature
  labels, footer note — the original, broadest bucket), `assessment_config`
  (assessment-type weights once the CA system was built), `grade_boundaries` (once
  multi-scale grading was needed), `schools` (signature/stamp images and branding
  colors, added for the platform-wide branding feature, not specifically for report
  cards — which is exactly why the PDF renderer never picked up `primaryColor`/
  `accentColor`: that field wasn't added *for* this module).
- **Authoritative going forward:** each collection keeps owning what it already
  correctly owns (no collection merge is proposed — see Phase 5's "no breaking
  changes" constraint). What's missing is a **resolved view**: one function that,
  given a `schoolId` (and optionally a `sectionId`), assembles the full effective
  report-card configuration from all four sources into one object — exactly what
  `_loadConfig` + `_loadCaConfig` already do today, just extended to also resolve
  the new Template Engine's selected template and to correctly apply `sectionId`
  scoping (a real, audit-flagged gap: `grade_boundaries.sectionId` is stored but
  never filtered on at generation time).
- **Deprecated:** nothing at the collection level. This item's fix is additive
  (a proper resolver), not corrective.

---

## Phase 2 — Unified architecture that preserves existing strengths

**Non-negotiable, per your instruction — none of the following are redesigned:**
versioned snapshots, audit logging, SHA-256 verification, the publish workflow
(batch anchor → moderation gate → compute → snapshot → supersede), moderation
gating, RBAC/ownership scoping. Everything in this phase is designed to sit
*around* that core unchanged.

### 2.1 The core insight that makes this possible

`report_card_snapshots` already practices exactly the discipline consolidation
needs: at publish time, it **snapshots the configuration that produced it**
(`gradingSchema`, `assessmentWeights`, `passMark`, `rankingSubjectStrategy`,
`principalSignatureUrl`, `schoolStampUrl` — all frozen onto the doc, not read live
from config at render time). This is *already* the right pattern for adding
template selection: **a published report card should remember which template
rendered it, the same way it already remembers which grading schema graded it.**

### 2.2 What changes, additively, on the snapshot

Two new optional fields join the existing snapshotted-config fields:
`templateId` and `templateVersion` (the specific version of that template's
definition, since templates — like grading schemas — should be editable by a
school without silently reshaping already-published history). Both are frozen at
publish time, exactly like `gradingSchema` is today.

- **Old snapshots (published before this exists) have neither field.** They render
  via one guaranteed, permanent template: **"Legacy Tabular"** — a direct,
  pixel-for-pixel port of today's exact `_buildPDFPage` layout, shipped as the
  Template Engine's first built-in template specifically so historical continuity
  requires no migration and no judgment call about "what template did this old
  report *mean* to use." This is what makes the rest of this plan additive rather
  than a breaking change (expanded on in Phase 5).

### 2.3 What does *not* change on the snapshot

- `sha256Hash` continues to cover exactly the fields it covers today
  (`studentId`, `studentName`, `admissionNo`, `classId`, `termNumber`,
  `academicYear`, `subjects`, `totalScore`, `averageScore`, `gpa`, `rankings`,
  `publishedAt`) — **content only, never presentation.** This is a deliberate
  design decision this plan is making explicitly, not an oversight: a school
  re-theming its report card templates next year must never retroactively
  invalidate the authenticity hash of a report card published last year. The
  `templateId`/`templateVersion` fields are stored on the snapshot for
  reproducibility, but are outside the hash payload — exactly parallel to how
  `principalSignatureUrl` is snapshotted-but-presentational already.
- `_nextReportId`, `publish_batches`, the moderation gate, the fee-clearance gate,
  the guardian/parent ownership checks, the `GET /verify/:reportId` public
  endpoint — none of these reference rendering at all today and none need to.
- The calculation call sequence inside `POST /publish` (aggregate → merge → compute
  → rank → denormalise → snapshot → persist) is unchanged. Template resolution is
  a new step that happens **after** the report object is fully computed, never
  before or during — reinforcing the Phase 3 boundary that templates cannot see or
  influence calculation.

### 2.4 Net effect

`report_card_snapshots` grows by two optional fields. Every route, every test,
every historical document keeps working exactly as it does today. The consolidation
work is layered *on top of* the existing model, not carved into it.

---

## Phase 3 — Report Card Template Engine (architecture, not implementation)

### 3.1 What a template is responsible for, and what it is never allowed to touch

This is the single most important boundary in this plan, because it's what keeps
Phase 2's "don't touch the calculation core" promise real rather than aspirational:

> **A template receives an already-fully-computed report object
> (subjects/scores/grades/rankings/attendance/comments — the exact same shape
> `computeFinalScores`/`attachDeviations`/`rankStudents` already produce today) and
> decides only how to lay it out.** A template has no access to raw marks, no
> ability to run its own scoring, and no code path back into
> `academic-calc.js`/`ranking.js`. It consumes output; it cannot become a second
> place calculation happens.

This mirrors a real, already-proven pattern in this exact codebase: the current
`_buildPDFPage` already takes a fully-computed `snap` and only draws it — it never
recomputes a score. The Template Engine generalizes that existing, correct
separation; it does not invent a new one.

### 3.2 What a template describes

| Capability | Description |
|---|---|
| **Layout composition** | An ordered list of section blocks (header, student-info, results-table, summary, attendance, comments, signatures, footer, and new block types as needed) — analogous to `rc_templates`' ordered `subjects`/`indicators` model, generalized beyond the competency case. |
| **Section content mapping** | Which fields of the computed report object each section pulls from, and simple presentational rules (e.g. "highlight failing subjects," which the current PDF already does) — not calculation. |
| **Branding** | School logo, `primaryColor`/`accentColor` (already exist on `schools`, currently unused by the PDF — this is the fix), header treatment. |
| **Page geometry** | Size (A4/Letter/Legal), orientation (portrait/landscape) — currently hardcoded, becomes template-level. |
| **Grading-scale reference** | A *pointer* to which `grade_boundaries` scale to *display* the way the template wants (e.g. as a legend table, inline badges, etc.) — the scale's actual values remain owned entirely by `grade_boundaries`; the template only decides presentation of that data, per the §3.1 boundary. |
| **Signature block config** | Labels, positions, how many signature lines, whether a stamp is shown — generalizing today's two-label/two-image system. |
| **Curriculum tag** | A metadata label (`kcse`/`cambridge`/`ib`/`cbc`/`american`/`custom`) for organization and template-picker filtering **only** — it does not switch code paths; see §3.4 on why this alone is not "curriculum support." |

### 3.3 Where templates live and how they're resolved

- **Schema, replacing `rc_templates` and absorbing its shape:** a new
  `report_card_templates` collection, tenant-scoped exactly like every other
  school-owned config collection in this codebase (`tenantModel`, per ADR-0001's
  established pattern — no departure from the existing tenant-isolation model).
- **Resolution chain**, mirroring the `grade_boundaries` pattern that already
  exists and already supports section-scoping (currently unused, per §1.5 — this
  plan finally uses it): `schoolId + sectionId → template marked default for that
  section` → `schoolId → template marked school-wide default` → `"Legacy Tabular"`
  (the platform built-in, always present, never deletable). This guarantees a
  template is *always* resolvable, with the same fail-safe posture the rest of
  this module already uses (`isEnabled`'s fail-open pattern, `resolveGrade`'s
  graceful null-band handling).
- **Platform-provided starter templates** (shipped, editable-by-copy, not
  editable-in-place, same convention a school would expect from any "starter"
  asset): **Legacy Tabular** (today's exact layout, for zero-regression
  continuity), **Competency Bands** (absorbing `rc_templates`' shape), **Cambridge
  Component Grid** (new — grouping multiple assessment-type columns under one
  subject heading, since the underlying weighted-CA-type data model already
  supports this per the audit's §7 finding that Cambridge is "data-model-adequate,
  render-layer-inadequate").
- **IB is explicitly out of scope for the Template Engine itself.** Per the audit's
  §7 finding, IB needs new *data* (predicted grade, HL/SL, ToK/EE/CAS, points/45)
  that doesn't exist in the computed report object today. No template, however
  well-designed, can display data that was never computed. This plan does not
  pretend otherwise: IB support is correctly scoped as a **future, separate data-
  model extension to `academic-calc.js`'s output shape**, which the Template Engine
  would then be able to render once it exists — not something this consolidation
  effort claims to deliver.

### 3.4 Why the curriculum tag alone isn't curriculum support (stated honestly)

Tagging a template `'cambridge'` or `'ib'` only helps someone *find* the right
template in a picker UI. It does not, by itself, make the underlying data correct
for that curriculum — that still depends on Phase 3's design boundary being
respected (templates never invent data) and, for IB specifically, on the
not-yet-scoped data-model extension above. This plan deliberately does **not**
repeat the mistake `academic_config.gradingType` made (accepting `'cambridge'`/
`'ib'` as valid values with zero behavior behind them) — every curriculum tag this
plan introduces is scoped to exactly what it does (template discovery), stated
plainly.

---

## Phase 4 — One rendering pipeline

### 4.1 The shape of the fix

Today: **two renderers, two data sources** (server PDF reads a persisted snapshot
and draws PDFKit calls directly; client print reads live `/generate` data and
builds an HTML string directly) — this is precisely the "two truths" problem you
identified.

Proposed: **one computation step, producing one intermediate representation (IR),
consumed by multiple thin output adapters.**

```
                     computed report object
                  (unchanged — academic-calc.js,
                   ranking.js, exactly as today)
                              │
                              ▼
                     resolved template
                (report_card_templates, Phase 3)
                              │
                              ▼
              ┌───────────────────────────────┐
              │   Render step (new, shared)    │
              │  report + template  →  IR      │
              │  IR = an ordered list of typed │
              │  section blocks — e.g.         │
              │  {type:'table', rows:[...]},   │
              │  {type:'text', ...},           │
              │  {type:'image', ...}           │
              │  — layout-described, not yet   │
              │  drawn in any specific format  │
              └───────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                                 ▼
      ┌───────────────┐                ┌────────────────┐
      │  PDF adapter   │                │  HTML adapter   │
      │  (pdfkit, same │                │  (used for       │
      │  library as    │                │  on-screen       │
      │  today — walks │                │  preview AND    │
      │  the IR instead│                │  the browser     │
      │  of hand-coding│                │  print/window.   │
      │  each section) │                │  print() path)   │
      └───────────────┘                └────────────────┘
              │                                 │
              ▼                                 ▼
      GET /:id/pdf                      ReportCardsTab.jsx
      GET /bulk-pdf                     on-screen render +
      (unchanged endpoints,             "Print" button
       unchanged access                 (now renders the
       gating, unchanged                SAME IR the PDF
       streaming/cursor                 would, whether
       behavior for bulk)               from a live preview
                                         or a published
                                         snapshot)
```

### 4.2 How this answers "Preview / PDF / Parent Portal / Printing"

- **Preview** (`POST /generate`'s live, unpublished data) and **Published PDF**
  (`report_card_snapshots`) both become "a report object" at the IR-build step —
  the *only* difference between previewing and downloading a published PDF is
  which report object feeds in (live-computed vs persisted-snapshot) and which
  adapter consumes the IR (HTML for on-screen preview, PDF for download). The
  watermarking behavior the PDF already has (`DRAFT`/`SUPERSEDED`) becomes a
  property the render step attaches to the IR based on the report object's status
  — available to *both* adapters for free, closing the exact gap flagged in the
  audit (today only the PDF shows a draft watermark; the client print view does
  not).
- **Parent Portal**: if/when a parent-facing in-browser report card view is built,
  it consumes the same HTML adapter output already built for the on-screen
  preview — no third renderer, ever.
- **Printing**: the client "Print" button stops hand-building its own document. It
  renders the HTML adapter's actual output (the same thing the on-screen preview
  already shows) and calls `window.print()` on *that* — meaning what a teacher
  prints and what's shown on screen are, by construction, the same thing, and both
  are built from the same section/data model the PDF uses.
- **Bulk PDF**'s memory-safe cursor/streaming design (a genuine strength per the
  audit) is preserved exactly: the PDF adapter is called once per student inside
  the existing chunked-cursor loop, same as `_buildPDFPage` is today — this plan
  changes *what* draws each page, not the streaming architecture around it.

### 4.3 What does not change here

The IR-and-adapters design is additive engineering discipline over the existing
pdfkit dependency — **not a new rendering technology, not a framework swap, not a
move to HTML→PDF conversion.** The PDF adapter still calls the same `pdfkit`
drawing primitives `_buildPDFPage` calls today; it just calls them by walking a
data structure instead of a hand-written sequence, which is what makes multiple
templates possible without multiple hand-written page functions.

---

## Phase 5 — Migration strategy: no breaking changes

### 5.1 Constraints this plan is designed against, stated explicitly

- Existing report cards must continue to work, unmodified, with no data migration
  required to remain functional.
- Historical report cards must remain verifiable — `GET /verify/:reportId` and its
  hash computation must produce identical results before and after this
  consolidation, for every already-published snapshot.
- Published snapshots must never be rewritten, backfilled, or reinterpreted. The
  "Legacy Tabular" template (§2.2) exists specifically so no historical snapshot
  ever needs a `templateId` assigned to it after the fact — its *absence* is itself
  the signal to use the one guaranteed-stable legacy layout.

### 5.2 Why every change in this plan satisfies those constraints

| Change | Why it's non-breaking |
|---|---|
| `templateId`/`templateVersion` added to `report_card_snapshots` | Optional fields; absent → Legacy Tabular; existing snapshots need zero backfill |
| `sha256Hash` payload unchanged | Historical hashes remain valid; `/verify` behavior is untouched |
| `academic-calc.js` becomes sole calc engine | `grade-calc.js`'s *call sites* migrate to `academic-calc.js`'s existing, already-tested functions — the report-card pipeline's calculation code path doesn't change at all, since it never used `grade-calc.js` in the first place |
| New `report_card_templates` collection | Additive; `rc_templates` keeps existing until its data is migrated in, then is retired — no window where any school's configured template disappears |
| Client grading-scale fix (§1.3) | Removes an incorrect fallback; does not change what schools *with* a configured `grade_boundaries` scale already see — only fixes schools currently hitting the divergent default |
| IR + adapters replacing hand-coded renderers | The **first** template shipped through this pipeline is a pixel-for-pixel port of today's layout, verified against golden-output fixtures before anything else changes — this is what makes "one rendering pipeline" provably behavior-preserving rather than an assumed rewrite |

### 5.3 Proposed sequencing (dependency order, not a timeline commitment)

1. **Fix the grading-scale default mismatch (§1.3).** Independent of everything
   else in this plan, already flagged as the audit's clearest live bug, and safe to
   do first without waiting on any of the larger architecture.
2. **Build the IR + PDF adapter as a direct port of `_buildPDFPage`**, shipped as
   the "Legacy Tabular" template, with output verified byte-for-byte (or
   visually-diffed, if byte-for-byte proves impractical given pdfkit's internal
   stream encoding) against today's PDF for a representative sample of existing
   snapshots. Nothing about any endpoint's behavior changes yet — this step proves
   the new pipeline is safe before it's asked to do anything new.
3. **Build the HTML adapter and cut the client "Print" path over to it.** This is
   what closes the two-renderers gap — the highest-priority architectural risk you
   named. Only after step 2 has proven the IR faithfully represents today's
   report can the client safely stop hand-building its own document.
4. **Retire `grade-calc.js`'s duplicated scoring logic**, migrating `assessment.js`'s
   dashboard call sites onto `academic-calc.js`. Independent of steps 2–3; can run
   in parallel.
5. **Build the Template Engine's CRUD + resolution (§3.3), absorbing `rc_templates`'
   data shape**, and ship the second real template ("Competency Bands") plus
   correct `sectionId`-aware resolution (closing the audit's §6.5 finding that
   section-scoped grade scales are currently ignored at generation time).
6. **Curriculum-specific data-model extensions (IB, and any further Cambridge/
   Pearson depth beyond the Component Grid template)** — scoped as their own,
   later, separately-approved effort once a concrete school/segment need makes the
   requirements concrete, per §3.4's honesty constraint.

### 5.4 What is explicitly deferred to that later scoping, not decided here

This plan deliberately does not attempt to design IB's data model, does not
attempt to fully specify every section-block type the IR will ever need, and does
not attempt to enumerate every starter template a mature version of this system
would ship. Per your own instruction, the next document — a functional
specification written from the perspective of school administrators, teachers,
parents, and students — is what should pin those specifics down before any
implementation begins. This document's job was narrower: prove that a
consolidated, template-capable, single-rendering-pipeline architecture is
achievable **without disturbing** the calculation core, the versioning model, the
audit trail, moderation, or RBAC — and show the concrete path there.
