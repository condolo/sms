# Report Card Engine — Architectural Audit

**Date:** 2026-07-21
**Status:** Research only — no code changed as part of this document.
**Scope:** Everything that participates in generating, publishing, rendering, and
delivering a report card, server and client.
**Method:** Direct reads of every file in the pipeline (not summarized/assumed).
File:line references are given throughout so every claim below is checkable.

---

## 0. Executive Summary

The report card engine is **more production-hardened on the data/integrity side than
most modules in this codebase** (versioned snapshots, SHA-256 tamper-evidence, publish
batches, moderation gating, fee-clearance gating, guardian-scoped RBAC) — but it has
**exactly one hardcoded PDF layout and no real template system**, despite three
different-looking "template" concepts existing in the data model that are either unused
or only partially wired up. There are also **two independent, divergent renderers**
(a server PDF and a client browser-print view) that can legally show different content
for the same student.

Concretely, before any redesign conversation, the five things worth knowing going in:

1. **One PDF layout, hand-coded in absolute x/y coordinates** (`_buildPDFPage`,
   [report-cards.js:830](../../server/routes/report-cards.js#L830)). Every school gets
   the identical table-based tabular layout. There is no template selection, no
   swappable renderer, no per-school visual customization beyond a school name string,
   two signature images, and a footer note.
2. **Three unrelated "template" concepts exist in the schema, and none of them
   drive the PDF**: `academic_config.templateId` (stored, never read —
   [academic-config.js:44](../../server/routes/academic-config.js#L44)),
   `assessment_config.reportTemplate` (stored, read only by an unrelated dashboard
   calc file — [grade-calc.js:247](../../server/utils/grade-calc.js#L247)), and a
   whole standalone CRUD API + collection, `rc_templates`
   ([rc-templates.js](../../server/routes/rc-templates.js)), that **no code anywhere
   ever reads** — it's a complete, tested-looking template builder (bands, subjects,
   indicators, display toggles) that is entirely disconnected from report card
   generation.
3. **Two independent report card renderers exist and can diverge.** The server PDF
   (`GET /:id/pdf`) is the versioned, hashed, "official" document. The in-app "Print"
   button (`StudentReportCard.jsx`'s `printCard()`) builds a *completely separate*
   HTML document client-side, from *live, unpublished* `/generate` data, with
   *different content* (it includes Behaviour incident stats and term-over-term
   deviation; the server PDF includes neither). A parent could receive a PDF from one
   path and a screenshot/printout from the other showing different numbers for the
   same term.
4. **Two independently-maintained calculation engines both claim to be canonical.**
   `academic-calc.js`'s own header says *"Single source of truth... DO NOT duplicate
   these calculations."* `grade-calc.js`'s header says, nearly verbatim, *"Single
   source of truth for the weighted assessment system. DO NOT duplicate these
   calculations."* They are two different files with overlapping but not identical
   logic, used by different routes.
5. **The grading system is a fixed weighted-percentage-to-letter-grade model with no
   curriculum branching.** `gradingType` accepts `'cambridge'` and `'ib'` as valid
   enum values ([academic-config.js:69](../../server/routes/academic-config.js#L69))
   and is stored and snapshotted, but **nothing in the codebase ever reads
   `gradingType` to change behavior** — it is decorative metadata. Every school,
   regardless of declared curriculum, runs through the identical
   weight-then-threshold-band algorithm.

None of this means the engine is badly built — the calculation core and the
publish/versioning/audit layer are genuinely solid, tested, and safe. It means the
*presentation* layer (PDF, templates, curriculum variability) is a single fixed
implementation wearing configuration-shaped clothing. Section 6 and 7 return to this.

---

## 1. Current Architecture

### 1.1 Participating modules

| Module | File | Role |
|---|---|---|
| Report card routes | `server/routes/report-cards.js` (1365 lines) | Orchestrator: generate, publish, list, comments, PDF, verify |
| Academic calc engine | `server/utils/academic-calc.js` | Aggregates grades/exams/CA marks, computes weighted scores, resolves grade bands, attendance summary, class deviation |
| Ranking utility | `server/utils/ranking.js` | Class ranking (standard/dense), best-per-subject, ranking-subject-strategy filtering |
| Academic config | `server/routes/academic-config.js` | Grading schema, ranking config, report display flags, academic year lifecycle, school profile (signatures/stamps) |
| Assessment config | `server/routes/assessment.js` | Assessment-type weights (`customTypes`), grade scales (`grade_boundaries`), CA mark entry |
| Second calc engine | `server/utils/grade-calc.js` | A parallel weighted-score engine, used by `assessment.js` only (not by report-cards.js) |
| Comment banks | `server/routes/comment-banks.js` | Pre-written comment snippets (category: academic/behaviour/general/subject) — a picklist, not wired into generation |
| RC templates (orphaned) | `server/routes/rc-templates.js` | Competency-band template CRUD — never consumed by report-cards.js |
| PDF sanitiser | `server/utils/sanitisePdf.js` | Strips control chars from free-text before it reaches PDFKit |
| Notification trigger | `notifyGuardiansForStudents` (`notify-students.js`) | Fires `report_published` event to guardians on publish |
| Client tab | `client/src/pages/grades/components/ReportCardsTab.jsx` | Class/term selector, drives `/generate`, `/publish`, renders one card per student |
| Client card | `client/src/pages/grades/components/StudentReportCard.jsx` | On-screen tabs (Marks/Comments/Behaviour) **and** a second, independent HTML-string PDF-via-browser-print renderer |
| Client constants | `client/src/pages/grades/constants.js` | Client-side default assessment types + default grade scale (own copy, see §6.4) |

### 1.2 End-to-end flow (text diagram)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PREVIEW / DRAFT PATH  (not persisted — recomputed every time)              │
│                                                                               │
│  ReportCardsTab.jsx                                                         │
│     │  POST /api/report-cards/generate  {classId, termNumber}               │
│     ▼                                                                       │
│  report-cards.js  POST /generate                                            │
│     │                                                                       │
│     ├─ _loadConfig(schoolId)         ──▶ academic_config  (grading schema,  │
│     │                                     ranking rules, display flags)     │
│     ├─ _loadCaConfig(schoolId)       ──▶ assessment_config.customTypes      │
│     │                                     + grade_boundaries (isDefault)    │
│     │                                                                       │
│     ├─ aggregateGrades()             ──▶ grades  (legacy gradebook)         │
│     ├─ aggregateExamResults()        ──▶ exams + exam_results               │
│     ├─ aggregateAssessmentMarks()    ──▶ assessment_marks (CA system)       │
│     │        └─ _mergeGradeData()  (CA marks win per assessmentType)        │
│     │                                                                       │
│     ├─ computeFinalScores()  (academic-calc.js)                             │
│     │        └─ resolveGrade()  (academic-config.js)                       │
│     ├─ attachDeviations()            (class-average deviation, per subject) │
│     ├─ computeRankingScore() + rankStudents()  (ranking.js)                 │
│     │                                                                       │
│     └─ resolve class teacher: students ──▶ streams ──▶ teachers             │
│                                                                               │
│  Response: { generated, config, students[] }  — NOT stored anywhere         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  PUBLISH PATH  (persisted, versioned, hashed)                               │
│                                                                               │
│  ReportCardsTab.jsx  "Publish Report Cards" button (admin/superadmin only)  │
│     │  POST /api/report-cards/publish  {classId, termNumber}                │
│     ▼                                                                       │
│  report-cards.js  POST /publish                                             │
│     │                                                                       │
│     ├─ create publish_batches doc (status:'running') — interrupt-safe anchor│
│     ├─ block if academic year archived (isYearArchived)                     │
│     ├─ moderation guard: every exam for class/term must be                  │
│     │     approved/locked/published/archived, UNLESS skipModerationCheck    │
│     │     (requires mandatory skipReason, writes mark_audit_log)            │
│     ├─ re-run the SAME aggregate/compute/rank pipeline as /generate         │
│     ├─ load existing live snapshots (for version chaining)                  │
│     ├─ denormalise student name/admission#/photo                            │
│     ├─ batch-load unpaid invoice balances → financialBlock flag per student │
│     ├─ load school principalSignatureUrl / schoolStampUrl (snapshot them)   │
│     ├─ build one report_card_snapshots doc per student:                     │
│     │     - assigns reportId  (RC-YYYY-TN-XXXXXX, atomic counter)           │
│     │     - assigns sha256Hash over immutable fields                        │
│     │     - carries forward prior comments (subjectComments, remarks)       │
│     │     - version = prev.version+1, supersedesId = prev.id                │
│     ├─ bulkWrite inserts (transaction if replica set; falls back if not),   │
│     │     then bulkWrite supersede-flag on the previous version             │
│     ├─ mark publish_batches complete/partial                                │
│     ├─ AuditService.log('report_card.publish', ...)                        │
│     └─ notifyGuardiansForStudents(eventKey:'report_published')  (fire/forget)│
│                                                                               │
│  Persisted: report_card_snapshots (one immutable-ish doc per student per    │
│  publish, versioned, never deleted, only superseded)                        │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  RETRIEVAL / RENDER PATH  (two independent renderers — see §2 and §6.2)     │
│                                                                               │
│  GET /api/report-cards/:id            → JSON snapshot (role/ownership gated)│
│  GET /api/report-cards/:id/pdf        → server PDFKit render (§2)           │
│  GET /api/report-cards/bulk-pdf       → cursor-streamed class-wide PDF      │
│  GET /api/report-cards/verify/:reportId → public, no-auth hash-integrity    │
│                                            check (school-agnostic lookup)   │
│                                                                               │
│  StudentReportCard.jsx "Print" button → SEPARATE client-built HTML string,  │
│                                          window.print() — NOT the same      │
│                                          renderer, NOT the persisted        │
│                                          snapshot (§2, §6.2)                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Which collections are queried

| Collection | Read by | Written by |
|---|---|---|
| `grades` | `aggregateGrades()` (legacy gradebook path) | `grades.js` (not in this audit's scope) |
| `exams`, `exam_results` | `aggregateExamResults()` | `exams.js` |
| `assessment_marks` | `aggregateAssessmentMarks()` | `assessment.js` |
| `assessment_config` | `_loadCaConfig()` via `assessment.js`'s `_getConfig` | `assessment.js` |
| `grade_boundaries` | `_loadCaConfig()` (only `isDefault:true`, ignores `sectionId` — see §6.5) | `assessment.js` |
| `academic_config` | `_loadConfig()` | `academic-config.js` |
| `students`, `streams`, `teachers` | class-teacher resolution, denormalisation | `students.js` / `streams.js` / `teachers.js` |
| `invoices` | fee-clearance gating (publish-time flag + download-time live check) | `finance.js` |
| `schools` | signature/stamp URLs, report-card fee threshold, name/systemEmail | `academic-config.js` (school-profile), `platform.js` |
| `publish_batches` | audit trail of publish runs | `report-cards.js` only |
| `report_card_snapshots` | the persisted, versioned report cards | `report-cards.js` only |
| `report_card_counters` | atomic `reportId` sequence | `report-cards.js` only |
| `mark_audit_log` | moderation-bypass log, guardian-access-denied log, year-archive log | `report-cards.js`, `academic-config.js` |
| `report_card_draft_comments` | pre-publish per-student comment drafts (teachers write before publish) | `report-cards.js` |
| `attendance` | attendance summary block on the PDF (if `config.showAttendanceSummary`) | `attendance.js` |
| `comment_banks` | picklist source for teacher-typed comments (client-side only; not read by report-cards.js at all) | `comment-banks.js` |
| `rc_templates` | **nothing reads it** | `rc-templates.js` (orphaned CRUD) |

### 1.4 Which APIs are involved

```
POST   /api/report-cards/generate                 live preview, not persisted
POST   /api/report-cards/publish                   versioned batch snapshot (admin only)
GET    /api/report-cards/publish-batches            audit trail
GET    /api/report-cards/                           list snapshots
GET    /api/report-cards/verify/:reportId            public integrity check
GET    /api/report-cards/:id                         full snapshot detail
PUT    /api/report-cards/:id/comments                 save class-teacher/principal/subject comments
GET    /api/report-cards/:id/pdf                      single PDF
GET    /api/report-cards/bulk-pdf                     class-wide merged PDF (streamed)
GET    /api/report-cards/draft-comments               pre-publish comment drafts
PUT    /api/report-cards/draft-comments/:studentId    upsert a student's draft comments
PUT    /api/report-cards/draft-comments/:studentId/subject/:subjectId   per-subject merge

GET/PUT      /api/academic-config                     grading schema, ranking, display flags
GET          /api/academic-config/grade               score → grade band preview
POST         /api/academic-config/archive-year        cascades to exams/snapshots/grades
GET/POST/PUT/DELETE /api/academic-config/years         academic year CRUD
POST         /api/academic-config/transition-year      atomic year rollover
GET/PATCH    /api/academic-config/school-profile        name/logo/signature/stamp

GET/PATCH    /api/assessment/config                    assessment-type weights (customTypes)
GET/POST/PUT/DELETE /api/assessment/grade-scales        grade_boundaries CRUD

GET/POST/PUT/DELETE /api/comment-banks                 comment picklist CRUD
GET/POST/PUT/DELETE /api/rc-templates                   orphaned template CRUD
```

### 1.5 Where calculations occur

All score math lives in exactly one place that report-cards.js actually uses:
**`server/utils/academic-calc.js`** — `computeFinalScores()`. Algorithm:

1. For each student × subject, merge gradebook-type averages (`aggregateGrades`) and
   exam-type averages (`aggregateExamResults`) into one `{assessmentType: avgPct}` map.
   (CA-system marks from `aggregateAssessmentMarks` are merged in *before* this, in
   `report-cards.js`'s own `_mergeGradeData()` — CA marks win per-type conflict.)
2. For each assessment type present, look up its weight (`assessmentWeights`, sourced
   from `assessment_config.customTypes`). Types with weight 0 are skipped.
3. **Normalise to the sum of *present* weights**, not to 100 — i.e. if a student is
   missing one assessment type, the other types are re-scaled up rather than treating
   the missing type as a zero. This is a real, deliberate design choice (avoids
   punishing partial data) but means two students' "final score" for the same subject
   are not always computed against the same weight base if their data coverage differs.
4. `resolveGrade(finalScore, gradingSchema)` maps the score to a letter/points/
   descriptor/remarks band (`academic-config.js`'s `resolveGrade`, threshold-based:
   highest band whose `min ≤ score`).
5. Per-student totals: `totalScore` = sum of subject final scores; `averageScore` =
   totalScore / subjectCount; `gpa` = sum(gradeInfo.points) / subjectCount.

Ranking (`ranking.js`) is a separate, later step operating on the computed
`totalScore`/`subjects` output — not part of `academic-calc.js`.

**The second engine, `grade-calc.js`**, is not used by report-cards.js at all (confirmed
by grep — only `assessment.js` requires it). It implements an overlapping but distinct
model (half-term re-scaling, term-blending) for whatever `assessment.js`'s own summary
views use. Both files' header comments claim to be *the* single source of truth. See §6.3.

### 1.6 How comments are retrieved

Three independent comment surfaces exist:

- **`report_card_draft_comments`** — pre-publish, per-student, per-term draft store.
  Teachers write here via `PUT /draft-comments/:studentId` (whole-record merge) or
  `PUT /draft-comments/:studentId/subject/:subjectId` (subject-scoped merge, so one
  teacher editing their subject's comment never clobbers another teacher's). This is
  what `StudentReportCard.jsx`'s Comments tab reads/writes pre-publish.
- **`report_card_snapshots.comments`** — the *published* comment object
  (`{subjectComments, classTeacherRemark, principalRemark}`), edited post-publish via
  `PUT /:id/comments` (role-gated: only admin/superadmin may set `principalRemark`).
  On a new publish, `comments` is **carried forward from the previous version**
  ([report-cards.js:486](../../server/routes/report-cards.js#L486)) — draft comments
  are *not* automatically copied into a new snapshot's comments; only the prior
  *published* comment carries forward. This is a real, non-obvious behavior: a
  teacher's draft-comment edits made after publish need the separate
  `PUT /:id/comments` call to land on the snapshot, or they're lost from the
  student's perspective on next publish (the draft store itself isn't cleared, but
  it's also never read again by the publish flow).
- **`comment_banks`** — a picklist of pre-written snippets (category:
  academic/behaviour/general/subject, optional `subjectId` scoping, free-text search).
  This is a **UI convenience source only** — `report-cards.js` never reads
  `comment_banks`; nothing enforces or even suggests that a chosen comment came from
  the bank versus being freely typed. (Not confirmed wired into `StudentReportCard.jsx`'s
  comment fields either — they're plain `<textarea>`/`<input>` with no picker UI found
  in that file.)

### 1.7 How grades are determined

Score → letter grade is threshold-based (`resolveGrade`, §1.5), using whichever
grading schema is active: `grade_boundaries` (the school's `isDefault:true` scale, if
one exists) takes priority over `academic_config.gradingSchema` (the legacy inline
8-band default). Both schema formats are supported by `resolveGrade` (`min`/`max`
academic_config-style, or `min`-only threshold `grade_boundaries`-style).

### 1.8 How ranking is handled

`ranking.js`: two algorithms (`'standard'` — 1,2,2,4 gap-after-tie; `'dense'` —
1,2,2,3 no-gap), selectable per school via `academic_config.rankingMethod`. Ranking
input score (`rankingScore`) is not necessarily the same as `totalScore`/`averageScore`
shown elsewhere — it is filtered by `rankingSubjectStrategy`:

- `'all'` (default) — every subject counts.
- `'best_n'` — best N subjects by score (KCSE-style "best 7 of 8"), N configurable.
- `'compulsory_only'` — only subjects in `compulsorySubjects` count.

Only **class-level** ranking is actually computed in `report-cards.js`
(`classInput`/`classRanks`, [report-cards.js:382](../../server/routes/report-cards.js#L382)).
`academic_config`'s `rankingScope` field accepts `['class','stream','overall']` and
`mergeRankings()` (`ranking.js`) is generically written to accept multiple scopes, but
report-cards.js only ever builds and passes a `{class: classRanks}` object — **stream
and overall ranking are configurable in the settings schema but never computed or
shown anywhere in this flow.** This is a config-vs-implementation gap, not a bug (no
error occurs — `rankingScope` values other than `'class'` are simply inert).

### 1.9 How attendance, behaviour, and growth profile are incorporated

- **Attendance**: real integration. `attendanceSummary()` (`academic-calc.js`) counts
  `present`/`absent`/`total` docs from the `attendance` collection for the
  student+class+term+year, shown on the PDF only if `config.showAttendanceSummary`
  is true (default true). Computed fresh at PDF-download time unless already cached
  on the snapshot (`snap.attendanceSummary`, which is in practice always `null` —
  `report-cards.js` sets it to `null` at publish time,
  [report-cards.js:492](../../server/routes/report-cards.js#L492), and nothing ever
  populates it afterward, so it is *always* recomputed live on every PDF request; this
  field exists in the schema but is effectively dead).
- **Behaviour**: **not incorporated into the server PDF or the publish/snapshot data
  model at all.** No reference to `behaviour`/`behaviour_incidents` anywhere in
  `report-cards.js` or `academic-calc.js` (confirmed by grep). It *is* fetched and
  shown, however, in the **client-only** browser-print renderer
  (`StudentReportCard.jsx`, via `behaviourApi.summary()` in `ReportCardsTab.jsx`) —
  see §2 and §6.2 for why this is a real divergence, not just an omission.
- **Growth Profile**: **not incorporated anywhere** — server PDF, snapshot schema, or
  client renderer. No reference found in any file this audit read.

### 1.10 What's configurable vs hardcoded

| Area | Configurable? | Where |
|---|---|---|
| Grading bands (letters/thresholds/points/descriptors) | ✅ Yes | `academic_config.gradingSchema` or `grade_boundaries` |
| Assessment-type weights (CA/HW/MT/ET or custom) | ✅ Yes | `assessment_config.customTypes` |
| Pass mark | ✅ Yes | `academic_config.passMark` |
| Ranking on/off, method, subject strategy | ✅ Yes | `academic_config.ranking*` |
| Show GPA / attendance / class average / deviation | ✅ Yes (toggle only, not layout) | `academic_config.show*` |
| Signature labels, footer note | ✅ Yes (text only) | `academic_config.*SignatureLabel`, `footerNote` |
| Principal signature image / school stamp image | ✅ Yes (upload only) | `schools.principalSignatureUrl` / `schoolStampUrl` |
| **PDF layout, page size, orientation, fonts, colors, section order** | ❌ No | Hardcoded in `_buildPDFPage` — `size:'A4'`, fixed hex colors (`DARK`, `ACCENT`, `GRAY`...), fixed coordinates |
| **Which sections appear on the PDF at all** (photo, table, comments, signatures) | ❌ No | Structure is fixed; only a few booleans toggle content *within* fixed sections |
| **Curriculum-specific behavior** (`gradingType: cambridge/ib/...`) | ❌ No-op | Stored, snapshotted, never read for behavior |
| **Header/branding beyond school name text + logo-adjacent absence** | ⚠️ Partial | School name is text-only in the PDF header; the client browser-print view *does* show `school.logoUrl`, the PDF does not |
| Report card "template" (`templateId: tabular/card/custom`) | ❌ No-op | Stored, never read |
| Competency-based bands/subjects (`rc_templates`) | ❌ Orphaned | Full CRUD exists, zero consumers |

---

## 2. PDF Generation Pipeline

### 2.1 Library

**[pdfkit](https://www.npmjs.com/package/pdfkit)** (`^0.18.0`, `package.json:39`) — a
low-level, imperative, canvas-style PDF drawing library for Node. It is **not** an
HTML/CSS-to-PDF converter (no Puppeteer, no `html2canvas`, no `wkhtmltopdf`, no
`@react-pdf/renderer`). Every rectangle, text block, and coordinate is drawn by
explicit function calls (`doc.rect()`, `doc.text()`, `doc.image()`) at explicit x/y
pixel positions computed inline in `_buildPDFPage`.

### 2.2 Where and how it happens

- **Purely server-side.** `pdfkit` is required lazily inside the route handler
  ([report-cards.js:1161](../../server/routes/report-cards.js#L1161)) with a
  try/catch that 501s if the module is missing — defensive, but also means there is
  no build-time guarantee it's installed.
- **One shared page-drawing function**, `_buildPDFPage(doc, snap, config, attendance,
  isFirstPage, images)` ([report-cards.js:830](../../server/routes/report-cards.js#L830)),
  used by both the single-PDF and bulk-PDF routes — this part *is* good, DRY design:
  one renderer, two callers, not two renderers.
- **Single PDF** (`GET /:id/pdf`): loads one snapshot, fetches signature/stamp/photo
  images over HTTP (or decodes `data:` URIs) via `_fetchImageBuf`, buffers the whole
  PDF in memory (`doc.on('data', ...)` accumulating into an array), sends it as one
  response.
- **Bulk PDF** (`GET /bulk-pdf`): genuinely more sophisticated — uses a Mongoose
  cursor with `batchSize(10)`, streams pages directly to the HTTP response
  (`pdfDoc.pipe(res)`) rather than buffering the whole class in RAM, fetches each
  student's photo individually per 10-doc chunk, reuses the *first* student's
  signature/stamp images for the whole batch (reasonable, since school-level images
  are identical for every student in one school). This is real engineering care
  around memory safety for large classes — noted as a strength in §6.
- **DRAFT/SUPERSEDED watermark**: a rotated, low-opacity red text overlay drawn
  first, before the header — driven by `snap.status !== 'published' || snap.superseded`.
- **Report authenticity**: `reportId` + `sha256Hash` are generated at publish time
  (`_nextReportId`, `_hashSnapshot`) and the footer prints `Report ID: RC-...` plus a
  `/verify/:reportId` pointer; the public `GET /verify/:reportId` route recomputes the
  hash and reports `Authentic` / `INTEGRITY CHECK FAILED`. This is real,
  functioning tamper-evidence — a genuine strength, uncommon at this stage of a
  school-SaaS product.
- **Access gating before PDF generation**: role/ownership checks
  (parent/guardian/student can only fetch their own linked student's PDF, with a
  `mark_audit_log` entry on denial), plus a **fee-clearance gate**
  (`schools.portalConfig.reportCardFeeThreshold`, default 100% — blocks download,
  not viewing the JSON, if fees aren't sufficiently paid, admin/`force=1` bypass).

### 2.3 Reusability of the "template"

There is no template abstraction to reuse — `_buildPDFPage` **is** the layout. It's a
single ~250-line function with `PAGE_WIDTH`, absolute column widths (`W_SUBJECT=155,
W_SCORE=42, W_GRADE=42, W_REMARKS=80`), hardcoded hex colors, and hardcoded section
order (header → student info block → results table → summary → attendance →
class-teacher remark → principal remark → signatures → footer). To change anything
structural (add a section, reorder, change page size) requires editing this function
directly; there is no data-driven layout description a school or a future template
picker could vary.

### 2.4 Are multiple layouts currently supported?

**No.** Every school, every curriculum, every plan tier gets byte-for-byte the same
PDF structure. The only per-school variance is: school name (text), two uploaded
signature/stamp images, a passport photo, a handful of show/hide booleans for
*content within* fixed sections, and two label strings ("Principal"/"Class Teacher").
`templateId` exists in the config schema (`'tabular' | 'card' | custom`) but
`_buildPDFPage` never reads it, and no second layout function exists to switch to.

### 2.5 Known limitations, as observed directly in the code

- **Fixed page size and orientation**: `new PDFDocument({ margin: 40, size: 'A4' })` —
  hardcoded in both PDF routes. No landscape option, no Letter/Legal option, no
  per-school override.
- **Dynamic column layout has a practical ceiling.** The results table computes
  `W_TYPE` by dividing remaining width by the number of assessment types
  ([report-cards.js:922](../../server/routes/report-cards.js#L922)) with a floor of
  36px — a school with many assessment types (say 8+, easily possible since
  `assessment_config.customTypes` allows up to 20,
  [assessment.js:468](../../server/routes/assessment.js#L468)) will get a visually
  cramped or overflowing table; there is no wrapping, pagination-per-subject-block,
  or landscape fallback.
- **No image caching across requests** — `_fetchImageBuf` does a fresh HTTP GET (with
  a 5s timeout) per PDF request for every remote signature/stamp/photo URL. Bulk PDF
  at least fetches the shared school images once per batch, but repeated single-PDF
  downloads for the same student re-fetch every time.
- **`attendanceSummary` is recomputed on every PDF request** rather than using the
  value frozen at publish time (`snap.attendanceSummary` is always `null` in
  practice — see §1.9). This means a report card's displayed attendance can silently
  drift after publish if attendance records for that period are later edited —
  arguably desirable (always current) but undocumented as a deliberate choice versus
  an oversight, and inconsistent with the rest of the snapshot's "immutable record"
  design intent.
- **No accessibility/alt-text, no PDF/A archival compliance markers** — not unusual
  for a v1, but worth naming for "production-ready" scoping.
- **International-format not supported at the render layer**: even if an
  IB/Cambridge-shaped grading schema is configured (letters/points), the visual
  layout (single results table: Subject | type columns | Score | Grade | Remarks)
  cannot represent, e.g., IB's 1–7 criterion-based subject grid, Cambridge's
  component-mark breakdown, or a CBC competency/strand rubric — the table columns are
  generic "assessment type % columns," not curriculum-shaped.

---

## 3. Template System — does one exist?

**Functionally, no — despite three separate schema surfaces that look like template
infrastructure.**

| School can configure... | Reality |
|---|---|
| Different **headers**? | Only the school name (plain text) and an optional passport-style student photo box; no logo, no custom header layout, no per-report title text beyond the fixed "ACADEMIC REPORT CARD" string. |
| Different **layouts**? | No. One fixed section order and fixed coordinate math for every school. `templateId` is stored, never consulted. |
| Different **grading scales**? | **Yes, genuinely** — `grade_boundaries` / `academic_config.gradingSchema` fully drive the letter-grade computation and are the one truly configurable axis. |
| Different **signatures**? | Partially — upload a principal-signature image and a school-stamp image, plus two label strings. The signature *block position/size* is fixed. |
| Different **colours**? | No. `DARK`, `ACCENT`, `GRAY`, `LIGHT_GRAY`, `BORDER` are hardcoded hex constants inside `_buildPDFPage`. No school branding color (schools *do* have `primaryColor`/`accentColor` fields per
`academic-config.js:735`, used elsewhere in the product for portal theming) is read by the PDF renderer at all. |
| Different **subject arrangements**? | No explicit ordering config — subjects render in whatever order `Object.entries(snap.subjects)` iterates (insertion order of the computed report, not a school-chosen display order). |

**The `rc_templates` collection is the closest thing to a real template system in the
schema** — it models performance bands, subjects with ordered indicators, and display
toggles (`showScore`, `showGrade`, `showSubjectAvg`, `showOverallAvg`), clearly
designed for a competency-based/early-years report card variant. **It is fully built
(CRUD, validation, tenant-scoped, RBAC-gated) and fully disconnected** — no route in
`report-cards.js`, no client component found, references `rc_templates` or a
`templateId` pointing at one. This reads as either an abandoned feature branch or a
half-finished parallel report-card mode for a different school segment (e.g.
kindergarten) that never got wired to the generation/PDF pipeline.

**Conclusion: today, "template" in this codebase means "which grading scale and which
few booleans," not "which visual document." There is no mechanism — configuration-driven
or code-level — for one school to have a visually different report card from another.**

---

## 4. Configuration Model

| Setting | Stored where (collection.field) | Read by |
|---|---|---|
| Grading bands (legacy) | `academic_config.gradingSchema` | `resolveGrade()` fallback when no `grade_boundaries` default exists |
| Grading bands (current) | `grade_boundaries` (`isDefault:true` doc's `.bands`) | `_loadCaConfig()` → `computeFinalScores()` |
| Grading "type" label (percentage/gpa/competency/descriptors/cambridge/ib) | `academic_config.gradingType` | Stored/snapshotted only — **no behavioral effect** |
| Pass mark | `academic_config.passMark` | `_buildPDFPage` (red-highlight failing subjects), `computeFinalScores` context |
| Assessment weighting | `assessment_config.customTypes[].weight` | `_convertCustomTypesToWeights()` → `computeFinalScores` |
| Ranking enabled/method/scope/strategy/N/compulsory list | `academic_config.ranking*` | `report-cards.js` publish/generate (scope beyond `'class'` unused, §1.8) |
| Show GPA / attendance / class avg / deviation | `academic_config.show*` | `_buildPDFPage` (GPA, attendance only — class avg/deviation are computed by `attachDeviations()` and included in the JSON `/generate` response, but **not rendered anywhere on the PDF** — only the client browser-print view shows deviation) |
| Signature labels | `academic_config.principalSignatureLabel` / `classTeacherSignatureLabel` | `_buildPDFPage` |
| Footer note | `academic_config.footerNote` | `_buildPDFPage` |
| Principal signature / school stamp images | `schools.principalSignatureUrl` / `schools.schoolStampUrl` | `_buildPDFPage` via `_fetchSignatureImages`, snapshotted onto the report at publish time |
| Report card fee-clearance threshold | `schools.portalConfig.reportCardFeeThreshold` | `GET /:id/pdf` access gate |
| "Report template" (detailed/summary) | `assessment_config.reportTemplate` | Only `grade-calc.js` (the *other* calc engine) — **not read by report-cards.js at all** |
| PDF "template" id (tabular/card/custom) | `academic_config.templateId` | **Nobody** |
| Competency bands/subjects/indicators | `rc_templates.*` | **Nobody** |
| Promotion rules | **Not found anywhere in this module.** No promotion-rule schema, field, or logic exists in report-cards.js, academic-config.js, or academic-calc.js. |
| Page size / orientation | Not configurable — hardcoded `'A4'` in the PDF route | — |
| School branding colors on the PDF | `schools.primaryColor`/`accentColor` exist as fields (used elsewhere in the product) but are never read by `_buildPDFPage` | — |

**Note on promotion rules**: the audit's objective list asked where promotion rules
are stored. None were found anywhere in the report card engine or its adjacent config
files. If promotion logic exists in this product, it lives entirely outside this
module (not confirmed either way — out of this audit's file set) — but nothing in
report-cards.js/academic-config.js/academic-calc.js reads, writes, or reasons about
promotion.

---

## 5. Data Dependencies

| Report card section | Collection(s) | Service / function | API |
|---|---|---|---|
| Subjects | `grades`, `exam_results` (via `exams`), `assessment_marks` | `aggregateGrades`, `aggregateExamResults`, `aggregateAssessmentMarks` (`academic-calc.js`) | `POST /generate`, `POST /publish` |
| Marks / final score per subject | (derived, not stored raw) | `computeFinalScores` (`academic-calc.js`) | same |
| Grade letter/points/descriptor | `grade_boundaries` or `academic_config.gradingSchema` | `resolveGrade` (`academic-config.js`) | same |
| Ranking (class) | (derived from computed scores) | `computeRankingScore`, `rankStudents`, `mergeRankings` (`ranking.js`) | same |
| Teacher comments (subject/class/principal) | `report_card_draft_comments` (pre-publish) → `report_card_snapshots.comments` (published) | inline in `report-cards.js` | `PUT /draft-comments/...`, `PUT /:id/comments` |
| Comment picklist suggestions | `comment_banks` | `comment-banks.js` | `GET /api/comment-banks` (client-only convenience; not read by report-cards.js) |
| Attendance | `attendance` | `attendanceSummary` (`academic-calc.js`) | computed live inside `GET /:id/pdf`, `GET /bulk-pdf` |
| Behaviour | `behaviour_incidents` (via `/incidents/summary`) | `behaviour.js` | **only reached by the client** (`ReportCardsTab.jsx` → `behaviourApi.summary`); server PDF never queries this |
| Growth Profile | — | — | **not referenced anywhere in this module** |
| Principal comment | `report_card_snapshots.comments.principalRemark` | `report-cards.js` (admin/superadmin only) | `PUT /:id/comments` |
| Class teacher comment | `report_card_snapshots.comments.classTeacherRemark` | `report-cards.js` | `PUT /:id/comments` |
| Class teacher *name* (auto-resolved) | `students.streamId` → `streams.formTeacherId` → `teachers` | inline in `POST /generate` and `POST /publish` | same |
| School information (name, signatures, stamp, fee threshold) | `schools` | `_model('schools')` direct reads (platform-level collection, correctly bypasses `tenantModel`) | inline |
| Financial-block flag | `invoices` (balance > 0) | inline `distinct()` query at publish time; re-checked live at download time against `portalConfig.reportCardFeeThreshold` | `POST /publish`, `GET /:id/pdf` |
| Report authenticity | `report_card_snapshots.reportId` / `.sha256Hash`, `report_card_counters` | `_nextReportId`, `_hashSnapshot` | `GET /verify/:reportId` (public) |

---

## 6. Extensibility Review

### 6.1 Strengths

- **Single calculation entry point for the pipeline that matters** (`academic-calc.js`
  is genuinely used consistently by both `/generate` and `/publish` — no drift
  *between those two routes*, which is the pairing that actually needs to agree with
  each other for preview-vs-published trust).
- **Versioned, immutable-by-convention snapshots.** Nothing is ever overwritten or
  deleted — republishing supersedes, never mutates, preserving a full audit trail
  and letting parents/students be blocked from seeing anything but the current
  version while admins retain full history (`history=1` query param).
- **Interrupt-safety.** The `publish_batches` anchor document, created before any
  heavy work starts and updated to `failed`/`partial`/`completed` at every exit path
  (including the `catch` block), means a crashed publish run is diagnosable and
  doesn't leave silent partial state.
- **Real tamper-evidence.** SHA-256 hash + globally unique `reportId` + a public,
  auth-free verification endpoint is a genuinely strong feature for a school-SaaS
  product at this stage — many competitors don't have this at all.
- **Careful RBAC/ownership scoping**, including an audit-logged denial path for
  guardians attempting to access a non-linked student's report card (GDPR/POPIA-aware
  framing in the code comment itself).
- **Memory-safe bulk export** — cursor + streaming + chunked image fetch is
  correctly engineered for a school with hundreds of students, not just tested at
  small scale.
- **Fee-clearance gating is a genuine product feature**, not just an integrity
  feature — configurable threshold, admin bypass, force override, graceful fallback
  if the finance module isn't in use (`try { ... } catch (_) { non-fatal }`).
- **Moderation gate before publish** — a real safety rail (can't publish report cards
  citing unapproved exam results) with an explicit, audited, mandatory-reason bypass
  for edge cases — a good pattern (secure by default, escape hatch is loud and logged,
  not silent).

### 6.2 Weaknesses

- **Two divergent renderers producing different content for the same student** —
  the single most concrete risk in this audit. The server PDF is the "official,"
  hashed, verifiable document; the client browser-print view is not tied to a
  snapshot, includes Behaviour data the server PDF omits, and can be triggered on
  *unpublished/draft* generate data. A school that assumes "the PDF is the report
  card" is only half right — a teacher clicking "Print" produces something visually
  and substantively different, with no reportId, no hash, no version marker, no
  DRAFT watermark equivalent.
- **Configuration that doesn't do anything.** `templateId`,
  `assessment_config.reportTemplate`, and the entire `rc_templates` collection are
  dead weight from the generation pipeline's point of view. This is exactly the kind
  of drift that makes a codebase hard to trust during a stabilization phase — a
  future engineer (or this audit, on a first pass) could reasonably assume a template
  system exists and start building on top of `rc_templates` before discovering it's
  never read.
- **Two calculation engines both claiming sole authority** (`academic-calc.js` vs
  `grade-calc.js`). Even though they currently serve different call sites (report
  cards vs. assessment dashboards), if their logic is ever *supposed* to agree (e.g.
  a dashboard shows a student's "current grade" that should match what the eventual
  report card says), there is no structural guarantee they do — they are two
  hand-maintained implementations of overlapping weighted-average math.
- **Client and server disagree on default grading scale.** `academic-config.js`'s
  `DEFAULT_GRADING_SCHEMA` is an 8-band, 4.0-point scale
  (A=80–100/4.0 ... E=0–39/0.0). `client/src/pages/grades/constants.js`'s
  `DEFAULT_GRADE_SCALE` — used as the client's own fallback when
  `config.gradeScale` (i.e., `grade_boundaries`) is unset — is a *different* 10-band,
  12-point scale (A=80+/12 ... down through A-/B+/B/B-/C+/C/C-...). These are not the
  same grading philosophy. In a school that has never configured a `grade_boundaries`
  scale, the **per-subject grade letters** (computed server-side, driven by
  `academic_config.gradingSchema`) can show a different scale's letters than the
  **"Mean Grade" badge** at the top of the on-screen/print card (computed
  client-side via `_gradeFromScale(student.averageScore, DEFAULT_GRADE_SCALE)`),
  because the client's fallback constant was never reconciled with the server's.
  This is a real, currently-live inconsistency, not a hypothetical.
- **`gradingType` is decorative.** Accepting `'cambridge'`/`'ib'` as valid values
  without any code path that changes behavior for them sets an expectation the
  product doesn't meet — see §7.
- **Ranking scope config exceeds implementation.** `rankingScope` accepts
  `'stream'`/`'overall'` but only `'class'` is ever computed. Not a bug (no crash,
  no wrong data shown) but a config surface that silently does nothing for two of
  its three documented options.
- **`attendanceSummary` is snapshotted-in-name-only** — the field exists on
  `report_card_snapshots` for exactly this purpose (freeze attendance at publish
  time, matching the "immutable record" philosophy every other field on the
  snapshot follows) but is always `null` in practice and recomputed live on every
  PDF request instead, silently breaking the "the published record can't drift"
  guarantee for this one field alone.
- **Absolute-coordinate PDF layout is expensive to extend.** Adding a new section,
  reordering existing ones, or changing page geometry requires editing hand-computed
  `x`/`y`/`width` arithmetic threaded through a single 250-line function — there is
  no layout primitive (grid, flow, or even named row-height constants beyond a
  handful) to build on top of. This is the most direct blocker to "let a school pick
  a different layout" without a substantial rewrite of this function specifically.
- **No CSS/branding-color reuse.** The product already has `schools.primaryColor`/
  `accentColor` for portal theming elsewhere, but the PDF renderer maintains its own
  separate hardcoded palette — a school's brand identity does not carry through to
  its report cards at all.
- **Section-scoped grade scales aren't actually section-scoped in practice.**
  `grade_boundaries` supports a `sectionId` for e.g. "Primary" vs "Secondary" scales
  within one school, but `_loadCaConfig()` in report-cards.js queries only
  `{schoolId, isDefault:true}` — with no `sectionId` filter — so a school that
  configured different scales per section would still get one single school-wide
  scale applied to every student's report card regardless of section. The CRUD API
  supports the finer-grained model; the consumer doesn't use it.

### 6.3 Technical debt / duplication (concrete instances found)

1. `academic-calc.js` vs `grade-calc.js` — two "single source of truth" weighted-score
   engines (§6.2).
2. `academic_config.templateId` / `assessment_config.reportTemplate` / `rc_templates`
   — three unrelated "template" concepts, none integrated with each other or with
   the actual PDF renderer.
3. `DEFAULT_GRADING_SCHEMA` (server, `academic-config.js`) vs `DEFAULT_GRADE_SCALE`
   (client, `constants.js`) — divergent hardcoded fallback grading scales (§6.2).
   (By contrast, `DEFAULT_CUSTOM_TYPES`/assessment-weight defaults **are** kept in
   sync between server `assessment.js` and client `constants.js` — same CA/HW/MT/ET
   20/10/30/40 values in both places, so this particular drift discipline exists
   for one config axis but not the other.)
4. Two independent report-card renderers with no shared code (§6.2) — the server's
   `_buildPDFPage` and the client's `printCard()`'s inline HTML template are
   maintained entirely separately; a section added to one has no mechanism to
   propagate to the other.

### 6.4 Hardcoded assumptions

- Term structure: `termNumber: 1|2|3` (Zod `.max(3)`,
  [report-cards.js:152](../../server/routes/report-cards.js#L152)) — assumes a
  3-term academic year (Kenyan/East-African convention). A 2-semester or
  4-quarter school year cannot be represented by this field's own validation.
- Percentage-first mental model: `computeFinalScores` and `resolveGrade` operate on
  0–100 percentages throughout; there is no first-class notion of point-based (IB
  1–7), letter-only (no percentage), or narrative/competency-only reporting despite
  `gradingType` naming those as options.
- A4, portrait, single fixed margin — assumed everywhere a `PDFDocument` is
  constructed.
- One school = one report card visual identity — no per-class, per-section, or
  per-curriculum-track branching in the render layer (only in the grading-scale
  data, via `sectionId` on `grade_boundaries`, which — per §6.2 — isn't even
  consumed at render time).

### 6.5 What would make future customization difficult, as currently built

The single biggest structural obstacle to school-specific report card layouts is
that **the layout logic and the data-computation logic live in the same function
with no separation** — `_buildPDFPage` both decides *what a report card shows* and
*exactly how it's drawn pixel-by-pixel*. Any future "let schools pick a layout"
feature cannot be built by adding a `templateId` switch inside this function without
first extracting a layout-agnostic intermediate representation (a plain data
structure describing sections/rows/columns) that a renderer could consume — today
there is no such intermediate step; the snapshot's raw fields go directly into
`doc.rect()`/`doc.text()` calls.

---

## 7. International Readiness

**Assessment: the current architecture cannot represent Cambridge, Pearson Edexcel,
IB, or a genuinely distinct American-curriculum report card today — not because a
new architecture is needed to store the data, but because nothing downstream of the
data model branches on curriculum.**

Broken down against the existing code, not a hypothetical redesign:

- **CBC (Kenya's Competency-Based Curriculum)** is the closest fit to something
  already half-built: `rc_templates` (performance bands, subjects, indicators,
  display toggles) looks purpose-built for exactly this — but it is orphaned (§3).
  If CBC support is a near-term need, the fastest path is *finishing the wiring
  of an existing, already-designed collection*, not building new schema.
- **Cambridge / Pearson Edexcel** typically need: component-level marks (e.g.
  Paper 1/Paper 2/Coursework) rolled into a single subject grade with named
  boundaries (A*/A/B/C...), often per-syllabus rather than per-school. The current
  model can represent component marks as multiple "assessment types" with weights
  (the CA/HW/MT/ET system is structurally generic enough for this), and
  `grade_boundaries` can represent A*-style bands. What's missing is entirely in
  the render layer: the PDF has one fixed table shape (type-columns → score → grade
  → remarks) with no notion of grouping components under a subject, showing
  syllabus codes, or a Cambridge-style certificate layout. **Data model: mostly
  adequate. Render layer: not adequate.**
- **IB** needs 1–7 point-scale subject grades plus Theory of Knowledge/Extended
  Essay/CAS tracking and a distinct "total points out of 45" summary — none of
  which exist as concepts anywhere in this module (no ToK/EE/CAS fields, no
  points-out-of-45 aggregate, no criterion-based sub-scoring). This would need new
  schema, not just new rendering — closer to a genuine extension than the Cambridge
  case.
- **American curriculum** (GPA-weighted, credit-hour-based, often with
  Honors/AP-weighted GPA) — GPA is already computed (`computeFinalScores`'s `gpa`
  field) but as a **simple, unweighted average of grade points**, with no notion of
  credit hours, course weighting (Honors=+0.5, AP=+1.0, a common US convention), or
  cumulative/multi-year GPA. `gradingType: 'gpa'` is accepted but — like
  `'cambridge'`/`'ib'` — does not change the computation.
- **Custom school report cards** — same conclusion as §3: no visual customization
  mechanism exists today beyond the small config already described. A school
  wanting a genuinely different-looking report card cannot get one without a code
  change to `_buildPDFPage` (or, if extended, whatever swappable renderer replaces
  it).

**Root cause, stated plainly:** the engine was built for one curriculum's shape
(Kenyan/CBSE-adjacent percentage-and-letter-grade system with continuous assessment
weighting) and generalized *just enough* on the data-input side (configurable
weights, configurable grading bands) to make that one shape flexible — but the
`gradingType` field was added as a forward-looking placeholder that nothing ever
followed through on, and the render layer was never made to branch on it at all.
This is a very normal, very fixable state for a product at this maturity — it is not
evidence of poor engineering, it's evidence of a single-curriculum MVP that hasn't
yet needed to prove itself against a second curriculum.

---

## 8. Recommendations

Per the brief, these extend the existing architecture rather than propose a new one —
no ADR, no redesign, ranked by how directly each unblocks "production-ready for
schools" without touching things that already work well (calculation core,
versioning, audit trail, RBAC).

1. **Reconcile the two renderers before anything else.** Whatever the long-term
   template plan is, having the "Print" button in `StudentReportCard.jsx` generate
   different content than the downloadable, hashed PDF is a trust problem today, not
   a future one. The narrowest fix: either (a) make the client "Print" action fetch
   and print the *actual* published PDF when a snapshot exists, falling back to a
   clearly-labeled "DRAFT — informal preview" mode only pre-publish, or (b) bring
   Behaviour/deviation into the server PDF as optional sections gated by config, so
   the two surfaces show a strict subset/superset relationship instead of genuinely
   different data.
2. **Decide the fate of `rc_templates` explicitly, don't leave it ambiguous.**
   Either wire it into generation (it's the most "IB/CBC-shaped" piece of
   infrastructure already in the codebase) or remove it. Half-built and undiscoverable
   is worse for future maintainers than either finished or absent — someone will
   eventually build on top of it assuming it works.
3. **Un-hardcode the render layer's *structure*, not just its content, as the actual
   prerequisite for multi-curriculum or multi-template support.** Concretely: extract
   `_buildPDFPage`'s section list (header, student info, results table, summary,
   attendance, comments, signatures, footer) into an ordered, data-driven list the
   function iterates, rather than a straight-line sequence of hardcoded calls. This
   is refactoring within the existing pdfkit approach — not a new rendering
   technology — and is what makes a future `templateId` switch (or a
   Cambridge/IB-shaped variant) tractable without a rewrite.
4. **Retire or merge `grade-calc.js` into `academic-calc.js`'s authority**, given
   `academic-calc.js`'s own header explicitly warns against exactly this kind of
   duplication. At minimum, document why two engines exist if there's a real reason;
   otherwise this is exactly the "ERP collapse pattern" the comment warns about,
   just not yet triggered.
5. **Fix the client/server default-grading-scale mismatch** (§6.2) — either make the
   client fetch and use the server's actual default when no `grade_boundaries` scale
   is configured (it already receives `config.gradingSchema` in the `/generate`
   response) instead of maintaining its own separate constant, or explicitly
   document why the two are allowed to differ.
6. **Make `gradingType` either real or removed.** As currently accepted values,
   `'cambridge'` and `'ib'` imply support the product doesn't have; a school that
   selects them today gets a normal percentage report card with a label that doesn't
   match. Either gate curriculum-specific behavior behind this field going forward
   (the natural place to start branching, once §3 is decided) or narrow the enum to
   what's actually supported so the setting can't overpromise.
7. **Snapshot `attendanceSummary` for real, or remove the field.** Given the rest of
   the model's discipline around immutability, silently recomputing this one field
   live is the odd one out and worth aligning with everything else on the snapshot.
8. **Apply `sectionId` scoping in `_loadCaConfig()`** so the already-built
   per-section grade-scale feature in `grade_boundaries` actually takes effect for
   schools that use it (currently a no-op — always uses the single
   school-wide-default scale regardless of section).

None of the above require touching the parts of this module that are already
strong: the calculation core, publish/versioning model, moderation gate, audit
trail, fee-clearance gating, or RBAC. Those can be left untouched while the
presentation layer is brought up to the same standard.
