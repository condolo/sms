# Msingi — Changelog

All notable changes to Msingi (formerly InnoLearn) are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [v4.42.0] — 2026-06-14 — Public Site: SEO, SSG Pre-render, WhatsApp FAB, Mobile Nav, African Branding

### Added

- **`client/public/robots.txt`** — Allows 6 public routes; disallows all 20+ authenticated app routes; points to sitemap.
- **`client/public/sitemap.xml`** — 6 URLs with priority weights (/ = 1.0, /plans = 0.9, /faq = 0.8, /contact = 0.7, legal = 0.3).
- **`react-helmet-async`** — Per-page `<title>`, `<meta description>`, canonical, OG, Twitter Card tags on all 6 public pages.
- **JSON-LD structured data** — `SoftwareApplication` + `Organization` on Landing; `FAQPage` on /faq; `PriceSpecification` on /plans.
- **`client/scripts/prerender.mjs`** — Puppeteer SSG post-build script: renders all 6 public routes with headless Chromium and writes pre-rendered HTML to `dist/` so AI bots (GPTBot, PerplexityBot, ClaudeBot) see real content without JS.
- **`build:ssg` script** in `client/package.json` — runs `vite build && node scripts/prerender.mjs`.
- **WhatsApp FAB** (`FloatingActions` component) added to FAQ, Plans, Contact, PrivacyPolicy, TermsOfService (Landing already had it).
- **Mobile hamburger menu** on Landing navbar — animated `AnimatePresence` dropdown with all nav links, Login, Book Demo, and Platform Live status. Closes on scroll.

### Changed

- All public-facing "Kenyan schools / administrators / leaders" copy updated to "African" across Landing.jsx, FAQ.jsx, and index.html. Legal references ("Kenyan law", "Kenyan Shilling") left unchanged.
- `index.html` base `<title>` and `<meta description>` updated to serve as non-JS fallbacks for crawlers.
- PrivacyPolicy and TermsOfService duplicate scroll-to-top logic removed; replaced with `FloatingActions`.

---

## [v4.41.0] — Landing Refactor + FAQ Page

### Added

- **`/faq` route** — Full FAQ page with categorized accordion UI, desktop sticky category nav, `FAQPage` JSON-LD schema, WhatsApp CTA, and footer.
- **FAQ teaser section** on Landing page between Trust section and Final CTA.
- **FAQ link** added to footer Company column.

### Changed

- **Landing.jsx** split from a 2100-line monolith into modular components (`client/src/components/landing/`) and data files (`client/src/data/landingData.js`, `faqData.js`). All imports and routes preserved.

---

## [v4.40.0] — Configurable Admission Numbers

### Added

- **Admission number prefix, padding, and counter** configurable per school via Settings → Admissions.
- Admission numbers auto-generated on student creation using `{prefix}/{year}/{padded-counter}` format.
- `schoolEmail` field added to student records.

### Changed

- Bulk import/export updated to include `admissionNumber` and `schoolEmail` columns.
- Import tests updated to cover the new fields.

---

## [v4.39.0] — Student Portal Features + RBAC Wiring

### Added

- **`hideFeeFromStudents`** school setting — fee balance hidden from student dashboard when enabled.
- **`studentCanViewReportCards`** school setting — report card access gated in student portal.
- **School email field** (`schoolEmail`) on student profiles.
- **Profile photo upload** on student profiles; photo rendered on report card PDFs.

### Fixed

- RBAC role permissions wired to sidebar — staff only see menu items their role grants access to.
- Portal role bleed fixed — student/parent portal roles no longer inherit staff permissions.
- Demo-student login alias (`demo-student`) preserved — no longer overwritten by admission number on seed.

---

## [v4.38.0] — Cloud Backup, Security, Legal Pages, Pricing Update

### Added

- **Cloud S3 backup** with AES-256-GCM encryption at rest (KDPA Section 41 compliance). Nightly cron via `backup-cron.js`.
- **Privacy Policy** at `/privacy` and **Terms of Service** at `/terms` — full legal pages with sticky nav and mobile layout.

### Changed

- Pricing updated: Base = KES 150/student/term, Student portal = KES 200, Family portal = KES 250. Setup fee minimum KES 45,000.
- All ERP modules enabled on all plan tiers (no module gating below enterprise).

### Fixed

- CSP headers enabled; `.git` directory access blocked.
- Backup cron collection list synced with `backup.js`.
- Demo school exempted from 2FA (demo accounts have no real email inboxes).
- Student login fixed; plans-page tier labels corrected.

---

## [v4.37.0] — Comment Banks, Grid Mark Entry, Exam Series, Approval Workflow, Mark Locking, Signatures/Stamp

### Added

#### 1. Comment Banks (`/api/comment-banks`)
- New `comment_banks` collection — pre-written remark templates for class teachers and principals.
- Full CRUD: `GET` (with `category` / `q` filters), `POST`, `PUT /:id`, `DELETE /:id`.
- Categories: `academic`, `behaviour`, `general`, `subject`.
- Plan-gated under `grades` (core). RBAC: `grades:{read,create,update,delete}`.
- **ConfigTab** gets a new "Comment Bank" section at the bottom: search, filter by category, add/delete entries.

#### 2. Spreadsheet/Grid Mark Entry (`MarkEntryTab.jsx`)
- Replaced the one-subject-at-a-time list with an **Excel-like grid**.
- Rows = students; columns = all assessment types × instances (e.g. CA 1, CA 2, HW 1, HW 2, MT, ET) for the selected class/subject/term.
- All existing marks loaded in a single query across all types.
- **Keyboard navigation**: Tab moves right, Enter/Arrow-Down moves down, Arrow-Up moves up, Arrow-Left/Right move horizontally.
- **Clipboard paste**: paste TSV from Excel or Google Sheets starting from the focused cell.
- **Column stats footer**: per-column average, entry count, and pass rate.
- **Submit for review**: one-click "Submit for review" button sends all types to the approval workflow simultaneously.
- Locked columns (post-approval) shown in amber with a Lock icon — inputs disabled.

#### 3. Exam Series (`/api/exam-series`)
- New `exam_series` collection grouping formal exams for a named exam period.
- Status machine: `draft → open → moderation → closed`.
- CRUD: list, get, create, update, delete (draft only).
- Sub-routes: `POST /:id/exams` (add exam to series), `DELETE /:id/exams/:examId` (remove).
- Plan-gated under `exam_series` (standard). RBAC: `exams:{read,create,update,delete}`.

#### 4. Approval Workflow (`/api/mark-submissions`)
- New `mark_submissions` collection — one document per class/subject/term/type/instance combination.
- **Teacher** calls `POST /` to submit marks for review; a snapshot of current marks is stored for audit.
- **Teacher** can `POST /:id/recall` while status is `submitted`.
- **Admin / section head / principal** calls `POST /:id/review` with `action: approve | reject`.
- Rejection returns to `draft` with a `rejectionReason`.
- `POST /:id/lock` / `POST /:id/unlock` (admin only) handle post-publish locking.
- Plan-gated under `mark_submissions` (standard). RBAC: `grades:{read,create,update}`.

#### 5. Mark Locking (guard on `POST /api/assessment/marks/bulk`)
- Before processing any bulk mark upsert, the endpoint now checks if any targeted `assessment_marks` records have `isLocked: true`.
- If locked marks are detected, the whole batch is rejected with HTTP 403 and a message directing the teacher to submit an unlock request.
- Unlock via `POST /api/mark-submissions/:id/unlock` (admin only, requires `reason`).
- When a submission is locked (`POST /api/mark-submissions/:id/lock`), all corresponding `assessment_marks` documents get `isLocked: true`.
- Unlocking clears `isLocked` on the underlying marks.

#### 6. Signatures and School Stamp on PDFs
- `principalSignatureUrl` and `schoolStampUrl` added to `SCHOOL_PROFILE_FIELDS` in `academic-config.js` — admins can store these via `PATCH /api/academic-config/school-profile`.
- At publish time, both URLs are snapshotted into every `report_card_snapshots` document alongside other school fields.
- At PDF generation time, `_fetchSignatureImages()` fetches both URLs as `Buffer`s (supports `https://`, `http://`, and `data:` URIs; 5 s timeout per image, non-fatal on failure).
- Signature image renders above the principal's signature line at 28 pt height.
- School stamp renders at top-right of the signature section at 36 pt height.
- Both the single-student PDF (`GET /:id/pdf`) and bulk-class PDF (`GET /bulk-pdf`) benefit from this change.

---

## [v4.36.1] — Fix portal fee collection names

### Fixed
- **`server/routes/student-portal.js`** — Fee balance query was reading `fee_invoices` (a collection that does not exist). Changed to `invoices` (the canonical collection written by `finance.js`). Field selector updated from `totalAmount paidAmount` → `balance status`; balance now reads `inv.balance` directly instead of recomputing from component fields. Unused `FeePayments` model reference removed.
- **`server/routes/parent-portal.js`** — Same `fee_invoices` → `invoices` fix for the balance query; same `fee_payments` → `payments` fix for the recent-payments query. Field selector updated: `totalAmount paidAmount dueDate termNumber` → `balance status dueDate termId` (invoices schema stores `termId`, not `termNumber`).

Both portals previously returned `feeBalance: 0` for all students because no documents existed in the non-existent collections. They now correctly read from the finance module's actual collections.

---

## [v4.36.0] — Unified Assessment Pipeline (single source of truth)

### What was fixed

Two parallel assessment systems existed and never talked to each other:

| System | Input | Config | Publisher |
|--------|-------|--------|-----------|
| **Old** | `grades` collection | `academic_config.assessmentWeights` + `.gradingSchema` | `academic-calc.js` → `report_card_snapshots` |
| **New** | `assessment_marks` collection | `assessment_config.customTypes` + `grade_boundaries` | (preview only — never published) |

Published report cards therefore showed old `grades` data, not the marks entered via MarkEntryTab. Portals could not see any published report cards at all (wrong collection name).

### Fixes

#### 1. `server/utils/academic-calc.js` — new `aggregateAssessmentMarks()`
- Reads from `assessment_marks` (published only), produces the same `{ [studentId]: { [subjectId]: { [assessmentType]: avgPct } } }` shape as `aggregateGrades()`.
- `rawScore` is already a percentage — no conversion needed.
- Multiple instances of the same type are averaged (e.g. HW1 + HW2 = avg HW).
- Exported alongside the other aggregators.
- `computeFinalScores` validator updated: now accepts both `{ minScore }` (academic_config) and `{ min }` (grade_boundaries) band format — no more throw for the new format.

#### 2. `server/routes/academic-config.js` — `resolveGrade()` dual-format support
- Now accepts **both** band formats in the same call.
- Old format `{ minScore, maxScore }`: range check (unchanged).
- New format `{ min }` (grade_boundaries): threshold check — find the highest band whose `min` ≤ score. `descriptor` / `remarks` fall back to `label`.
- Both formats return identical `{ grade, points, descriptor, remarks }` output.

#### 3. `server/routes/report-cards.js` — unified data pipeline
- New `termNumber` field added to both `GenerateSchema` and `PublishSchema` (optional `int 1–3`). Passed to `aggregateAssessmentMarks` so the right term's CA marks are included.
- New helper `_loadCaConfig(schoolId)` — loads `assessment_config.customTypes` + `grade_boundaries` default scale in parallel.
- New helper `_convertCustomTypesToWeights(customTypes)` — converts `[{ key, weight }]` → `[{ assessmentType, weight }]`.
- New helper `_mergeGradeData(gradesData, caData)` — merges old `grades` data with new `assessment_marks` data; CA marks win on per-type conflict within the same student + subject.
- **Priority rule** (both generate and publish):
  - Weights: `assessment_config.customTypes` → fall back to `academic_config.assessmentWeights`.
  - Grade schema: `grade_boundaries` default scale → fall back to `academic_config.gradingSchema`.
- Published snapshots now include `termNumber` and use `activeWeights` / `activeSchema` (not the old `config.*` fields).

#### 4. `server/routes/student-portal.js` — portal collection fix
- Changed `_model('report_cards')` → `_model('report_card_snapshots')`.
- Query now filters `superseded: { $ne: true }` and sorts by `publishedAt` (snapshots have no `termNumber` sort field).
- `.select()` updated to real snapshot fields: `academicYear termName termNumber totalScore averageScore gpa rankings status publishedAt version termId academicYearId`.

#### 5. `server/routes/parent-portal.js` — same portal fix
- Same changes as student-portal above.

#### 6. `server/routes/report-cards.js` — dynamic PDF columns
- The PDF report card table previously had hardcoded column headers ("Classwork (%)", "Mid-Term (%)", "End-Term (%)") mapping to hardcoded assessment type groupings.
- Now derives one column per entry in `snap.assessmentWeights` using the type's `label` field. A school that configures HW / CA / MT / ET will see exactly those four columns in the PDF, labelled from their own configuration.
- Column widths are computed dynamically: Subject + Score + Grade + Remarks take fixed widths; the remaining horizontal space is divided equally among the type columns (minimum 36pt each).

#### 7. `server/routes/report-cards.js` — `financialBlock` wired to fee balance
- `financialBlock` was hardcoded `false` on every published snapshot.
- **At publish time**: a single batch query (`invoices.distinct('studentId', { balance: { $gt: 0 } })`) now marks each student with an outstanding invoice balance as `financialBlock: true`. Best-effort — if the finance module is not in use, the query returns an empty set and all flags remain `false`.
- **At PDF download time**: the flag is re-verified in real-time against `invoices.exists({ studentId, balance: { $gt: 0 } })`. This means a student who pays their fees after the report card was published can download immediately — no re-publish required. Falls back to `snap.financialBlock` on DB error.
- Admin role and `?force=1` query param continue to bypass the block (unchanged).

### Net effect
Marks entered via MarkEntryTab → published via report-cards.js → visible in student and parent portals. PDF matches the school's custom assessment types. Financial block is live, not stale. One unified path, no forks.

---

## [v4.35.0] — Grade Boundaries + ExamsPage routing (Option B)

### Added
- **Grading Scales — full CRUD** (`grade_boundaries` collection, `/api/assessment/grade-scales`):
  - Each school can define one or more named grading scales (e.g. "Standard KCSE", "Primary", "Cambridge").
  - Each scale has an array of **bands**: `{ min%, grade, points, label }` — e.g. `{ min: 80, grade: 'A', points: 12, label: 'Excellent' }`.
  - **Per-section scoping**: a scale can be scoped to a specific `sectionId`, allowing different grading scales for different school divisions (CBC lower primary vs. secondary, etc.).
  - Exactly one scale per scope is `isDefault`; the default is attached to every report card response automatically.
  - **Validation guards**: duplicate grade letters rejected, duplicate min% rejected, at least one band must start at 0% (covers all scores), cannot delete the last scale, cannot delete the default without re-assigning first.
  - New API methods in `api/client.js`: `getGradeScales`, `createGradeScale`, `updateGradeScale`, `deleteGradeScale`.
- **Grade letter column on Report Cards** — `StudentReportCard` now shows a "Grade" column (e.g. A, B+, C) next to the "Final grade %" column, computed from the school's default grading scale. Falls back to a built-in Kenya 8-4-4 reference scale when no custom scale is configured.
- **`GradeScalesSection`** — new section in ConfigTab (Continuous Assessment → Configuration tab):
  - Lists all scales with band preview pills (A ≥80%, B ≥70%, …)
  - Inline band editor: expand any scale to edit all bands in a table (min%, grade, points, label)
  - "Set as default" button for non-default scales
  - "New scale" form with auto-seeded bands from the built-in reference
- **`DEFAULT_GRADE_SCALE`** constant added to `grades/constants.js` — 12-band Kenya reference scale.
- **`_gradeFromScale(score, bands)`** pure helper added to `grades/constants.js`.
- **`GET /api/assessment/config`** — now includes `gradeScale: { id, name, bands }` for the school's default scale (null if none configured).
- **`GET /api/assessment/report`** — now includes `config.gradeScale` so report cards receive the active scale in a single request.

### Changed (Option B — ExamsPage routing)
- **`/exams` route** — now mounts `ExamsPage.jsx` (formal exam scheduling, results, grade reports) instead of redirecting to `/grades`. ExamsPage was built in v4.33.0 but was orphaned until now.
- **`/grades` route** — now exclusively serves the Continuous Assessment module (Mark Entry, Report Cards, Configuration, Reminders). The old "Exams" and "Results" tabs have been removed from `GradesPage`.
- **Sidebar** — "Exams" entry added (FileText icon, `/exams`). "Exams & Assessment" renamed to "Assessment" (`/grades`).
- **Breadcrumbs** (TopBar) — `/exams` → "Exams", `/grades` → "Assessment".
- `GradesPage.jsx` — default tab changed from `'exams'` to `'entry'`; `ExamsListTab` and `ExamResultsTab` imports removed.
- `grades/constants.js` TABS array — `exams` and `results` entries removed; unused `BookOpen` and `ClipboardList` imports removed.

---

## [v4.34.0] — Assessment Types full CRUD (deep DB)

### Added
- **Assessment Types are now fully configurable per school** — examiners can add, rename, reweight, and delete the assessment components (previously hardcoded to CA/HW/MT/ET).
- **New DB endpoints** in `/api/assessment/types`:
  - `GET    /types` — returns the school's configured type definitions
  - `POST   /types` — adds a new type (key, label, weight%, instances/term, color)
  - `PUT    /types` — bulk-replaces the full array (for label/weight/color edits)
  - `DELETE /types/:key` — removes a type; **guarded by mark count** — returns HTTP 409 if marks exist for that type, protecting data integrity
- **`assessment_config.customTypes`** — new array field on the config document. Each entry: `{ key, label, weight, instances, color }`. Auto-migrated from legacy `weights`/`instances` fields for existing schools.
- **Legacy field sync** — after any type change, `weights` and `instances` maps are re-synced from `customTypes` for backward compat with the report engine.
- **`VALID_COLORS`** — 12 named pill colors (violet, purple, amber, red, blue, emerald, sky, orange, rose, teal, indigo, cyan) available for each type.

### Changed
- `MarkSchema.assessmentType` — changed from `z.enum(['CA','HW','MT','ET'])` to `z.string()` with runtime validation against the school's configured types. Custom types are now accepted.
- `ScheduleEntrySchema.assessmentType` — same change; schedule entries can use custom types.
- `_label()` helper — now uses instance number threshold (`instance <= 1 ? key : key + instance`) instead of hardcoded MT/ET check.
- `GET /report` — derives `weights` map from `customTypes` (falling back to legacy `weights` field).
- **ConfigTab** (`grades/components/ConfigTab.jsx`) — complete overhaul:
  - Replaces the fixed 4-input grid with a full CRUD table (key chip | label | weight% | /term instances | color picker | delete)
  - "Add new assessment type" inline form at the bottom
  - Merge of the old "Instances per Term" card into the type rows
  - Delete is immediate (goes to DB); add is immediate; label/weight/color changes batch-saved with "Save configuration"
  - Schedule type dropdown now reads from the school's configured types, not hardcoded constants
- **`TypePill`** (`GradesPrimitives.jsx`) — accepts optional `color` prop (color name → Tailwind classes) for dynamic types; falls back to static TYPE_PILL map for legacy CA/HW/MT/ET.
- **`constants.js`** — added `DEFAULT_CUSTOM_TYPES`, `VALID_TYPE_COLORS`, `COLOR_PILL` exports.
- **`api/client.js`** — added `assessment.addType`, `assessment.saveTypes`, `assessment.deleteType` methods.

---

## [v4.33.1] — Assessment Config relocated into Exams module

### Changed
- **Assessment Types & Weightings editor moved** from Settings → Academic tab into a new **"Configuration" tab** inside the Exams & Assessment page. Admin-only tab; hidden from teachers. This removes the friction of leaving the Exams module to configure exam types.
- Removed the Settings → Academic tab entirely (wrong home for exam-specific config).
- Removed the "Assessment Config" shortcut link from the Exams page header (the Configuration tab is now the direct path).
- `ExamPage.jsx` now has 4 tabs: Exams · Results · Grade Report · Configuration.

---

## [v4.33.0] — Exam & Assessment Module Overhaul

### Added
- **Assessment type dropdown** in Create Exam slide-over — types come from the academic-config `assessmentWeights` (configurable per school). Stores both `assessmentType` key and `assessmentLabel` display name on each exam.
- **Academic Year → Term cascade** in Create Exam and in all exam filters. Year selection auto-populates the current term based on today's date.
- **Subject dropdown** (connected to the Subjects module FK) replaces the broken free-text subject field. Subject name is denormalized onto the exam for fast list display. Old free-text `subject` field was silently stripped by Zod — now fixed.
- **Weight % auto-fill** — selecting an assessment type auto-fills the `weightPercent` field from the configured weight.
- **Title auto-suggest** — "{Assessment Type} — {Subject}" suggested when both are selected, with a one-click apply button.
- **Cascading filter panel** in Exams tab — Year → Term → Assessment Type → Search text. "Clear all" resets all filters.
- **ResultsTab enhanced** — Year + Term dropdowns narrow the exam selector; exam picker uses `<optgroup>` when multiple assessment types are present.
- **Grade Report tab** — Subject filter now uses the Subjects dropdown (FK) instead of free-text.
- **Warm gradient header** on Exams page (blue-indigo-violet, matching timetable design language). Includes "Assessment Config" shortcut link to Settings.
- **Academic tab in Settings** — new "Academic" tab with an Assessment Types & Weightings editor. Admins can add, rename, reorder and set weights for each assessment type. Sum-to-100% validation with visual indicator. Saves to `academic-config` via `PUT /api/academic-config`.
- **`assessmentType`, `assessmentLabel`, `termLabel`, `subjectName`** added to `ExamSchema` in `server/routes/exams.js` (all optional, backward-compatible).
- **Exam list enrichment** — `GET /api/exams` now resolves `subjectName` (from subjects collection) and `className` (from classes collection) via FK lookup before returning docs.
- **`assessmentType` + `termLabel` query filters** added to `GET /api/exams` for server-side filtering.
- **`academicConfig.get()` and `academicConfig.update()`** added to `client/src/api/client.js` for the main academic-config endpoint.
- **Academic years now readable by all authenticated users** — removed admin-only role check from `GET /api/academic-config/years`. Write endpoints remain admin-only. This allows teachers to see year/term options when entering results.

### Changed
- `ExamsPage.jsx` fully overhauled — all components rewritten for connectivity and consistency.
- Status badge config expanded to include all statuses in the state machine (`in_progress`, `moderated`, `approved`, `locked`, `published`, `archived`).

### Fixed
- **Subject field data loss** — the previous free-text `subject` field in Create Exam was stripped by Zod before saving (the `ExamSchema` never had a `subject` field). Exam list was always showing "—" for subject. Now properly uses `subjectId` FK.

---

## [Upcoming] — Dashboard Widget Customisation (drag-and-drop)

> **Status:** Planned — not yet implemented. Design agreed; implementation queued.

### Planned — `client/src/pages/Dashboard.jsx` + new `dashboard/` sub-folder

Full per-user drag-and-drop dashboard customisation for admin and teacher roles.

#### Widget catalogue

| Widget ID | Label | Roles |
|---|---|---|
| `kpi_students` | Student count KPI cards | All |
| `kpi_finance` | Fee collection KPI | Admin, Finance |
| `kpi_admissions` | Admissions pipeline KPI | Admin |
| `kpi_attendance` | Attendance rate KPI | All |
| `chart_finance` | Fees collected/outstanding bar chart | Admin, Finance |
| `chart_admissions` | Admissions funnel | Admin |
| `chart_gender` | Gender breakdown pie | Admin |
| `birthdays` | Today's & upcoming birthdays | All |
| `events` | Upcoming events | All |
| `recent_students` | Recently enrolled students | Admin |
| `announcements` | System announcements banner | All |
| `leadership_analytics` | Attendance risk, fee exposure, behaviour heatmap, academic health | Admin, Deputy |
| `quick_actions` | Quick action buttons | Teacher |
| `setup_checklist` | New-school setup checklist (not draggable, always first) | Admin |

#### New files
- `client/src/pages/dashboard/WidgetRegistry.js` — widget catalogue; role/plan visibility rules
- `client/src/pages/dashboard/useDashboardLayout.js` — layout state; localStorage read/write; DB sync for school-wide defaults
- `client/src/pages/dashboard/DragGrid.jsx` — `@dnd-kit/sortable` wrapper
- `client/src/pages/dashboard/DashboardEditBar.jsx` — edit-mode toolbar (pen icon, Save / Reset / Cancel)
- `client/src/pages/dashboard/widgets/*.jsx` — one file per widget (extracted from Dashboard.jsx)

#### Changes to existing files
- `client/src/pages/Dashboard.jsx` — refactored: each block extracted into a named widget component; `DragGrid` + `DashboardEditBar` wired in
- `server/routes/settings.js` — new `GET /api/settings/dashboard-layout` + `POST /api/settings/dashboard-layout` (admin sets school-wide default layout; stored in `schools` collection under `defaultDashboardLayout`)
- `client/src/api/client.js` — `settingsApi.dashboardLayout.get()` / `.save(layout)`
- `client/package.json` — add `@dnd-kit/core` + `@dnd-kit/sortable`

#### UX behaviour
- All authenticated users see a **pen (✏) icon** top-right of the dashboard to enter edit mode
- Edit mode shows drag handles (⠿) on each widget and an eye toggle (show/hide)
- **Admin only** — "Set as school default for all staff" checkbox on Save; saves layout to DB
- **Teachers** — personal layout persists in `localStorage`; "Reset to default" reverts to the school admin's saved default (or built-in default if none set)
- `setup_checklist` widget is always pinned at top and cannot be reordered or hidden

---

## [4.32.4] — 2026-06-11  Section Tab "all highlighted" Bug Fix

### Fixed — `server/routes/sections.js` + `client/src/hooks/useSections.js`

**Root cause:** Schools whose sections were auto-seeded by an older version of the route (before `key`/`color` were added to `DEFAULT_SECTIONS`) had section documents in the DB without a `key` field.  
`useSections` mapped `id: s.key` → `id: undefined` for every tab.  
Clicking any tab called `setSection(undefined)`, after which `undefined === undefined` is `true` for all tabs simultaneously → every section tab appeared "active" at once.

**Server fix (`server/routes/sections.js`):**
- Added `_inferKey(name)` helper that maps a section's display name to a `key` string using regex patterns (kg, primary, secondary, alevel) with a slugify fallback
- `GET /api/sections` now detects sections with missing `key` or `color`, patches them via `$set`, and reloads before responding — a silent one-time migration that runs on the next page load

**Client fix (`client/src/hooks/useSections.js`):**
- `sectionTabs` now filters out sections without a `key` before mapping (`.filter(s => s.key)`) so a missing-key section can never enter the tabs array
- Added `color` fallback: `s.color || '#6366f1'` so even unpatched data shows distinct fallback colour

---

## [4.32.3] — 2026-06-11  Timetable Dashboard Visual Redesign

### Changed — `client/src/pages/timetable/TimetablePage.jsx`

**Timetable page header redesigned — warmer, more engaging UI:**

- Replaced the flat `bg-white border-b` header with a rich `bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700` banner matching Msingi brand palette
- Added subtle decorative circles (white/5 opacity) for visual depth
- Calendar icon now lives in a frosted-glass tile (`bg-white/15 border border-white/20`)
- Title promoted from `text-base font-semibold text-slate-900` to `text-lg font-bold text-white`
- Added a pill chip showing live class count (`{classList.length} classes`) when classes are loaded
- View tabs redesigned: active tab = `bg-white text-indigo-700` (bridges into the white content below), inactive tabs = `text-white/65` on the gradient
- All action buttons (Bell, Import, Workload, Conflict badge) restyled to `bg-white/10 text-white border-white/25` on gradient; "Add slot" CTA = `bg-white text-indigo-700` for strong contrast
- Conflict badge on gradient: red variant = `bg-red-400/25 text-red-100`, green = `bg-emerald-400/20 text-emerald-100`
- "Workload" toggle active state: `bg-white text-indigo-700 shadow-sm` (clear visual distinction)

**Empty state panels warmed up:**
- "Select a class" placeholder: replaced flat icon with `bg-indigo-50` rounded tile + icon + two-line copy
- "Select a teacher" placeholder: replaced flat icon with `bg-violet-50` rounded tile + icon + two-line copy

---

## [4.32.2] — 2026-06-11  Monitoring, Nightly Backup Cron, Email Batching, Exchange Rate-Limit

### Added — Error monitoring utility (`server/utils/monitoring.js`)

Lightweight, zero-new-dependency error tracking with three optional channels:

| Channel | Activation |
|---|---|
| **Disk log** | Always active. Writes rotating `logs/errors-YYYY-MM-DD.log` JSON files. |
| **Sentry** | Active when `SENTRY_DSN` env var is set **and** `@sentry/node` is installed (`npm install @sentry/node`). |
| **Alert webhook** | Active when `ALERT_WEBHOOK_URL` env var is set. Sends a POST to any webhook endpoint (Discord, Slack, custom). |

Global `uncaughtException` and `unhandledRejection` handlers registered at startup. `captureException(err, ctx)` called from the Express error handler with `route`, `method`, `userId`, `schoolId` context.

**`server/index.js`** wired at three points:
- `monitoring.init()` — before any middleware
- `app.use(monitoring.requestHandler())` — after CORS (Sentry request context)
- `app.use(monitoring.errorHandler())` — before the final error handler (Sentry error context)

### Added — Nightly backup cron (`server/utils/backup-cron.js`)

Auto-exports a full JSON backup for every active school once per day and saves it to disk.

- Schedule: `BACKUP_CRON_EXPR` env var, default `"0 23 * * *"` (02:00 Kenya / 23:00 UTC)
- Storage: `BACKUP_DIR` env var, default `<project_root>/backups/`
- Retention: `BACKUP_KEEP_DAYS` env var, default `7` — older files auto-pruned per school
- Same credential-stripping rules as the manual export (`password`, `passwordHash`, `twoFactorSecret`, `mfaOtp`, `mfaExpiry` from users; `smtpPassEnc`, `mpesa` from schools)
- Writes a `backup_logs` row per school with `source: 'cron'` (distinguishable from manual exports in the Backup History UI)
- Registered in `server/index.js` `app.listen` callback alongside existing crons

### Fixed — School-wide announcements batch emails to avoid SMTP rate limits

`server/routes/messages.js` previously fired all notification emails concurrently via `Promise.allSettled`, risking hitting Gmail's sending limits on large schools.

**New:** `server/utils/email-queue.js` — `enqueueBatch(thunks)` sends in batches of `EMAIL_BATCH_SIZE` (default 20) with `EMAIL_BATCH_DELAY_MS` (default 1 500 ms) between batches. Email jobs are stored as **thunks** (lazy functions) to prevent SMTP calls from starting before batching can control them.

### Fixed — Rate-limit `POST /api/auth/exchange` (B from security audit)

`server/routes/auth.js` — added `exchangeLimiter`: 10 requests / 5 min per IP. Prevents brute-forcing exchange codes even though each code is single-use and expires in 30 seconds.

---

## [4.32.0] — 2026-06-11  OAuth Exchange-Code Flow + JWT Token-Version Revocation

### Security — OAuth token no longer exposed in redirect URL (F4)

The Google and Microsoft OAuth callbacks previously embedded the full JWT in the redirect URL (`?token=...`), leaking it into browser history, server access logs, and third-party `Referer` headers.

**New flow:**
1. OAuth callback generates a 30-second single-use **exchange code** (`crypto.randomBytes(32)` — 64-char hex) and stores `{ token, expiresAt }` in an in-process Map.
2. Redirect URL carries `?code=<hex>` only — no JWT.
3. New **`POST /api/auth/exchange`** endpoint: validates code (deletes on first read), re-reads `user + photo + school` from DB, returns `{ token, user, school }` identical in shape to the login endpoint.
4. `client/src/pages/Login.jsx` updated: reads `?code=` instead of `?token=`, calls `/api/auth/exchange` via POST, eliminates the secondary `/api/auth/me` call.

**Files changed:** `server/routes/auth.js`, `client/src/pages/Login.jsx`

### Security — JWT revocation via per-user token version (F11)

Previously, a role change (e.g. demoting an admin) took up to 24 hours to take effect because existing JWTs were stateless.

**New mechanism:**
- `server/utils/token-version.js` — new utility: `getTokenVersion(userId)` with 5-minute in-process cache; `revokeUserTokens(userId)` increments `tokenVersion` in DB and busts the cache entry.
- Every JWT payload now includes `tv: user.tokenVersion ?? 0`.
- `authMiddleware` is now async; after signature verification it checks `payload.tv` against the cached DB version — a lower version returns 401 immediately.
- `server/routes/settings.js` — `PUT /users/:id` calls `revokeUserTokens()` when a role change is applied; takes effect on the user's next request.
- **Backward compat:** tokens issued before this version carry no `tv` claim and pass through unchanged until they expire naturally (max 24 h).

**Files changed:** `server/utils/token-version.js` *(new)*, `server/middleware/auth.js`, `server/routes/auth.js`, `server/routes/settings.js`

---

## [4.31.3] — 2026-06-11  Multi-Tenant Security Hardening (Findings F1–F10)

Full audit of all 47 backend routes, middleware, and utilities against an 11-area security checklist. Ten findings fixed; one informational note closed.

### Fixed — Missing `schoolId` scope on user queries (F1, F6, F7)

| File | Location | Fix |
|---|---|---|
| `server/routes/auth.js` | `change-password` `findOne` + `updateOne` | Added `schoolId: req.jwtUser.schoolId` |
| `server/routes/users.js` | `PUT /me` post-update `findOne` | Added `schoolId: req.jwtUser.schoolId` |
| `server/routes/settings.js` | `GET /` and `PUT /` `findOne` | Added `schoolId: req.jwtUser.schoolId` |

### Fixed — `verify-otp` client-controlled `schoolId` stripped (F3)

`server/routes/auth.js` — `schoolId` removed from body destructure; all three DB calls (`findOne`, two `updateOne`) now use the server-resolved `req.school.id` exclusively.

### Fixed — Photo endpoint: unauthenticated cross-tenant access blocked (F2)

`GET /api/users/:id/photo` now requires a `?schoolId=` query parameter and filters `user_photos` by `schoolId`. Returns 400 if the parameter is absent.

All server-side `photoUrl` response fields updated to include `?schoolId=encodeURIComponent(...)`. Frontend updated in three locations (`TopBar.jsx`, `ProfilePage.jsx` ×2, `client.js` helper).

### Fixed — M-Pesa STK callback scoped to transaction's school (F5)

`server/routes/mpesa.js` — both `updateOne` calls and the invoice `findOne` inside the STK callback now include `schoolId: txn.schoolId` (available from the already-found transaction document).

### Added — `mpesa_transactions` DB indexes (F10)

`server/utils/indexes.js` — new collection entry with four indexes: unique on `checkoutRequestId`, compound `schoolId + status + createdAt`, `schoolId + invoiceId`, and unique on `id`.

### Fixed — Backup export strips credential fields (F8)

`server/routes/backup.js` — users collection export strips `password`, `passwordHash`, `twoFactorSecret`, `mfaOtp`, `mfaExpiry` before serialisation; schools collection strips `smtpPassEnc` and `mpesa` (API keys).

### Fixed — School-wide message broadcast restricted to staff (F9)

`server/routes/messages.js` — `POST /` now enforces a `BROADCAST_ROLES` set (`superadmin`, `admin`, `deputy_principal`, `deputy`, `section_head`, `teacher`, `hr`). Students and parents receive 403 when attempting `recipients: 'all'`.

### Confirmed secure (no change needed)

Login rate limiting (10/15 min), bcrypt hash guard, OTP CSPRNG + timing-safe comparison, platform admin key, finance route isolation, server-side financial totals, parent/student portal ownership checks, analytics role gate, report-card publish admin-only gate, public endpoint field whitelist.

---

## [4.31.2] — 2026-06-11  Centralise Auth Token Reads

### Refactored — Token access pattern (8 files)

All client-side pages that were reading `JSON.parse(localStorage.getItem('msingi_session'))?.token` directly have been migrated to the proper centrally-managed patterns. This means a future key-name or schema change needs updating in exactly one place (`auth.js`/`client.js`), not scattered across the codebase.

#### Changes per file

| File | Was | Now |
|---|---|---|
| `StudentDashboard.jsx` | `_token()` read localStorage | `useAuthStore.getState().session?.token` |
| `ParentDashboard.jsx` | `_token()` read localStorage | `useAuthStore.getState().session?.token` |
| `LibraryPage.jsx` | `useRole()` read localStorage for role | `useAuthStore(s => s.session?.user?.role)` selector |
| `TransportPage.jsx` | `useRole()` read localStorage for role | `useAuthStore(s => s.session?.user?.role)` selector |
| `HostelPage.jsx` | `useRole()` read localStorage for role | `useAuthStore(s => s.session?.user?.role)` selector |
| `ProfilePage.jsx` | Raw `fetch('/api/users/me')` with manual token | `profileApi.update()` from `client.js` |
| `SettingsPage.jsx` | Raw fetches for 4 billing/mpesa endpoints | New `billingApi.*` / `mpesaApi.*` from `client.js` |
| `ELearningPage.jsx` | `apiFetch` + 4 raw `useQuery` fetches | `useAuthStore.getState()` in `apiFetch`; client helpers for subjects/classes/students/teacher |

#### Added — `client/src/api/client.js`

```js
export const billing = {
  current:  () => _get('/billing/current'),
  generate: (data) => _post('/billing/generate', data),
  history:  () => _get('/billing/history'),
};

export const mpesa = {
  subscription: (data) => _post('/mpesa/subscription', data),
};
```

Both are also included in the default `api` export object.

---

## [4.31.0] — 2026-06-11  eLearning Redesign — PMI Sessions, Calendar Integration, Emergency Online Mode, Student Portal Join Buttons

### Added — eLearning module (8 phases)

#### Phase 1 — Google Classroom moved to "Upcoming"
- Sidebar item `Google Classroom` is now shown as a non-clickable chip with a "Soon" badge.
- All existing Classroom OAuth and course-listing code is preserved behind the route guard; it is hidden, not deleted.
- Default redirect `/elearning` now goes to `/elearning/sessions`.

#### Phase 2 — No more Zoom / Meet API calls
- Removed `/elearning/zoom` and `/elearning/meet` route cases.
- All meeting links are now plain URLs stored by teachers on their own profiles — no OAuth sign-in, no API call to Zoom or Google.

#### Phase 3 — Teacher profile: Online Meeting Links section
- **`client/src/pages/profile/ProfilePage.jsx`** — new "Online Meeting Links" card for staff only.
  - Fields: Zoom PMI URL, Zoom Passcode, Google Meet URL.
  - URL validation (`https://` required), separate save button, external preview links.
- **`server/routes/teachers.js`** — `SELF_EDITABLE` array extended with `zoomPMILink`, `zoomPasscode`, `meetLink` so teachers can save their own links via `PUT /api/teachers/me`.

#### Phase 4 — Schedule Online Class / Session
- **`server/routes/elearning.js`** — new `POST /api/elearning/sessions` endpoint.
  - Plan-gated: `planGate('elearning')` — requires standard plan.
  - Validates audience type (`class` / `student` / `parent`) and audience ID.
  - Resolves the teacher's stored Zoom PMI or Meet link; returns `{ missingLink: true }` if none saved.
  - Creates `elearning_sessions` document (no external API call).
  - Creates `events` document simultaneously with `category: 'online_class'`, `meetingLink`, `sessionId` reference.
  - Returns `{ session, event }`.
- **`server/middleware/plan.js`** — `elearning: 'standard'` added to `FEATURE_PLAN` map.

#### Phase 5 — Online Sessions tab (replaces Zoom / Meet tabs)
- **`client/src/pages/elearning/ELearningPage.jsx`** — major rework.
  - `NewScheduleModal`: audience picker (class / student / parent), platform toggle (Zoom / Meet), link preview, date/time/duration, agenda.
  - `OnlineSessionsTab`: fetches teacher's own link status, lists upcoming and past sessions, shows `SessionCard` per session with Join / Cancel buttons.
  - Missing-link warning banner with link to Profile page.
  - React Query invalidates `['elearning-sessions-all']` and `['events']` after scheduling.

#### Phase 6 — Calendar: Online Class events show Join button
- **`client/src/pages/events/EventsPage.jsx`** — `online_class` added to `CATEGORIES`.
  - Event form shows platform/link/passcode fields when category is `online_class`.
  - View mode shows a "Join Meeting" button and passcode when `event.meetingLink` is set.
- **`server/routes/events.js`** — POST/PUT handlers accept and store `meetingLink`, `meetingPasscode`, `platform`.

#### Phase 7 — Emergency Online Learning Mode
- **`client/src/pages/settings/SettingsPage.jsx`** — new toggle under School Settings.
  - Sky-blue UI indicator, amber warning reminding admins to ensure teachers have links saved.
  - `patchSchool()` called on save so timetable reacts immediately without refresh.
- **`client/src/store/auth.js`** — `_slimSchool()` persists `emergencyOnlineMode` to localStorage.
- **`client/src/pages/timetable/TimetablePage.jsx`** — emergency banner above grid; fetches teacher meeting links when mode is ON; passes `emergencyMode` and `teacherMap` to `TimetableGrid`.
- **`client/src/pages/timetable/components/TimetableGrid.jsx`** — `SlotCard` shows per-slot "Join Zoom / Meet" button in emergency mode.

#### Phase 8 — Student Portal: per-lesson Join buttons
- **`server/routes/student-portal.js`** — `GET /api/student-portal/dashboard`:
  - Selects `teacherId` on timetable slots.
  - Reads `emergencyOnlineMode` from school document.
  - When mode is ON, queries `teachers` collection for `zoomPMILink`, `zoomPasscode`, `meetLink` and attaches `meetingLink`, `meetingPasscode`, `platform` to each slot.
  - Includes `emergencyOnlineMode` in the `school` key of the response.
- **`client/src/pages/student-portal/StudentDashboard.jsx`** — "Today" widget:
  - Sky-blue "Emergency Online Learning" banner when `school.emergencyOnlineMode`.
  - Each lesson row now shows `startTime / endTime` (already present) plus a sky-blue "Join" button when `slot.meetingLink` is set.
  - Passcode row displayed below each slot when `slot.meetingPasscode` is present.

### Changed — eLearning sidebar
- `ELEARNING_ITEMS` now has 2 items only: `Online Sessions` (active) and `Google Classroom` (upcoming / non-clickable).

---

## [4.31.1] — 2026-06-11  Help Centre — Role-Based Section Filtering + Content Expansion

### Added — Help Centre (`client/src/pages/help/HelpPage.jsx`)

- **Role-based section filtering** — the Help Centre now shows only the sections that match the modules a user has access to.
  - Each FAQ section has a `moduleKey` property that maps to the same module permission keys used by the sidebar (`classes`, `students`, `admissions`, `attendance`, `timetable`, `elearning`, `finance`, `behaviour`, `grades`, `lessons`, `events`, `hr`, `messages`).
  - Sections with `moduleKey: null` (Getting Started, Settings, Roles & Permissions, Data & Import/Export) are always visible to every role.
  - Filtering uses `useAuthStore`'s `can(moduleKey)` method — the same gate that controls sidebar visibility. `superadmin` and `admin` bypass the check and see all sections.
  - Both the sidebar navigation list and the article panel grid respect the filtered set; the search query also runs only over the visible sections.

- **Content expansion** — 18 sections, 80+ articles covering every module:
  - New sections added: Classes & Subjects, Admissions, Timetable, eLearning & Online Sessions, Exams, Report Cards, Lessons & Coverage, HR & Staff, Events & Calendar.
  - All hardcoded `violet-*` colour references replaced with `useSchoolTheme` primary/accent colours.

---

## [4.30.1] — 2026-06-09  Security & Bug Fixes

### Fixed — Security hardening

- **`server/routes/settings.js` `PUT /`** — self-service password change was missing `passwordChangedAt` update, meaning the 90-day rotation clock was never reset after a manual change. Clock now resets correctly. Also raised bcrypt cost 10→12 and minimum password length 6→8 to match the rest of the codebase.
- **`server/routes/settings.js` `/users/invite`** — bcrypt cost raised 10→12 (consistent with `users.js` invite route).
- **`server/routes/students.js`** — student portal account and parent portal account creation both used bcrypt cost 10. Raised to 12.
- **`server/routes/platform.js`** — new-school superadmin password was hashed at cost 10. Raised to 12.

### Fixed — `_mapSchoolDoc()` missing fields (`server/middleware/tenant.js`)

- `moduleConfig` and `faviconUrl` were not included in the object returned by `_mapSchoolDoc()`. On every fresh login these fields were `undefined` in `session.school`, causing the sidebar to ignore saved module visibility configuration and the browser tab to show no custom favicon. Both fields are now forwarded.

### Fixed — Invoice currency defaulting to GBP (`server/routes/finance.js`)

- Zod schema had `currency: z.string().length(3).default('GBP')`. Since the frontend `CreateInvoiceSlideOver` never sends a `currency` field, every invoice was silently stored with `GBP`. The default is removed. The POST `/invoices` route now reads the school's own `currency` field as the fallback, with `'KES'` as the hard-coded last resort.

### Fixed — Dead code: `mustChangePassword: true` in user invite (`server/routes/users.js`)

- `POST /invite` and `POST /bulk-invite` both set `mustChangePassword: true` on new user documents. `auth.js` no longer reads or acts on this flag (it was replaced by the `passwordChangedAt` 90-day rotation mechanism). The dead field is removed from both code paths to avoid confusion.

---

## [4.30.0] — 2026-06-09  Academic Year Lifecycle Management

### New — Academic Year CRUD + Transition (`server/routes/academic-config.js`)

Full year lifecycle — draft → active → locked — replacing the old free-text academic year label.

- **`GET /api/academic-config/years`** — list all academic years for the school, enriched with computed `status` (`draft` | `active` | `locked`). Status is derived at query time from `isCurrent` + `archivedAcademicYears` array — no duplicate state stored.
- **`POST /api/academic-config/years`** — create a draft year with `name`, `startDate`, `endDate`, and optional `terms[]`. Validates uniqueness of name per school.
- **`PUT /api/academic-config/years/:id`** — update name, dates, or term dates on any non-locked year. Returns 403 on locked years.
- **`DELETE /api/academic-config/years/:id`** — delete draft years only. Active and locked years cannot be deleted.
- **`POST /api/academic-config/transition-year`** — atomic, irreversible transition:
  1. Runs the same cascade as `/archive-year` on the currently active year (freeze exams, lock report card snapshots, mark grades `yearArchived`, activate write-blocking gate via `archivedAcademicYears`)
  2. Sets `isCurrent: true` on the target draft year
  3. Syncs `school.academicYear` label and `school.termDates` for backward compatibility with attendance, billing, and display
  4. Writes audit log entries for both the archive and activation
- `_yearStatus(year, archivedIds)` helper — single source of truth for derived status
- `uuidv4` used for new year `id` fields; `v4` imported at route level

### New — Assessment Year-Lock Guard (`server/routes/assessment.js`)

- **`POST /api/assessment/marks`** — now checks `isYearArchived(schoolId, d.academicYearId)` before the upsert. Returns `403 "This academic year is locked"` if archived.
- **`POST /api/assessment/marks/bulk`** — checks `firstArchivedYear(schoolId, yearIds)` across all distinct `academicYearId` values in the payload. Returns `403` naming the locked year if any is found.
- Both checks use the existing `server/utils/archival.js` helpers — no new logic introduced.
- **Scope**: assessment marks (`assessment_marks` collection) are now fully protected. Attendance (`attendance_records`) and Lessons are not protected — attendance records carry no `academicYearId` field and lessons reference year by string label rather than ID; this is documented as a known limitation.

### New — `academicConfig` API client (`client/src/api/client.js`)

```js
export const academicConfig = {
  years: {
    list:      ()           => _get('/academic-config/years'),
    create:    (data)       => _post('/academic-config/years', data),
    update:    (id, data)   => _put(`/academic-config/years/${id}`, data),
    remove:    (id)         => _delete(`/academic-config/years/${id}`),
  },
  transition:  (data)       => _post('/academic-config/transition-year', data),
  archiveYear: (data)       => _post('/academic-config/archive-year', data),
};
```

### New — `AcademicYearsSection` component (`client/src/pages/settings/SettingsPage.jsx`)

Replaces the old free-text "Academic year label" input + manual term dates table in the School settings tab.

- Year list with status badges (`Active` pulse dot, `Locked` padlock icon, `Draft` muted)
- Years sorted: active first, drafts next, locked last
- **Create form** — inline animated form for creating draft years with name, start/end dates, and term count
- **Inline term editor** — per-year edit mode with date pickers for each term's start/end date; save/cancel controls
- **Delete** — trash icon on draft rows only; confirmation via `window.confirm`
- **Activate button** — "Start this academic year" button on each draft row
- **Transition dialog** — full confirmation modal with:
  - Summary of what will be locked (current active year name + cascade effects)
  - Summary of what will be activated (target year name)
  - Optional reason field
  - Amber "Lock current & activate new year" CTA
  - Error display on failure
- Old free-text `academicYear` input and manual `termDates` rows removed
- `academicYearStartMonth` and `termsPerYear` fields retained (control billing roll-over, not year lifecycle)

### New — Startup migration: `_migrateAcademicYears` (`server/index.js`)

Non-blocking post-startup migration:
- Assigns `uuidv4` `id` field to any `academic_years` document missing it (legacy docs from before this version)
- Sets `isCurrent: false` on any document with the field absent
- Idempotent — safe to run on every startup; becomes a no-op once all docs are migrated

---

## [4.29.0] — 2026-06-08  Staff Profile Self-Edit · Admin Password Reset · CSPRNG Sweep

### New — Staff self-edit profile page (`client/src/pages/profile/ProfilePage.jsx`, `server/routes/teachers.js`)

- **`/profile` route** accessible from the top-nav avatar dropdown — every authenticated user can view and edit their own profile without admin involvement
- **Photo upload / remove** — base64 resize + crop before upload; MIME + 10 MB size validation; immediate preview
- **Password change** — current password verified server-side, new password bcrypt-hashed; show/hide toggles on all fields
- **Staff details card** — conditionally rendered only when a `teachers` record exists for the logged-in email:
  - Self-editable: address (textarea), date of birth, qualifications, specialization
  - Next of kin: name, phone, relationship (3-column grid)
  - Read-only note: HR-managed fields (department, contract, employment status) can only be changed by HR team
- **Backend — `GET /api/teachers/me`** — finds staff record by matching `user.email` → `teacher.email`; strips sensitive fields (`nationalId`, `nssfNo`, `shaNo`, `kraPinNo`) via `_stripSensitive()` before responding; returns `{ data: null }` when no record exists (admin-only users)
- **Backend — `PUT /api/teachers/me`** — updates only the `SELF_EDITABLE` allowlist: `['phone', 'address', 'qualifications', 'specialization', 'dateOfBirth', 'nextOfKin']`; no RBAC gate, no plan gate — available to all authenticated staff
- Both `/me` routes placed **before** `GET /:id` in `teachers.js` to prevent Express treating the literal string "me" as a dynamic ID parameter
- **API client** — `profile.staffRecord()` → `GET /teachers/me`; `profile.updateStaffRecord(data)` → `PUT /teachers/me`

### New — Admin temporary password reset (`server/routes/settings.js`, `client/src/pages/settings/SettingsPage.jsx`)

- **`POST /api/settings/users/:id/reset-password`** — admin/superadmin only
  - Non-superadmin blocked from resetting another `admin` or `superadmin`'s password
  - Generates a new temp password via `_genTempPassword()` (CSPRNG, 11 chars: alpha + 2 digits + `!`, shuffled)
  - Stores bcrypt hash, sets `mustChangePwd: true` → user forced to change on next login
  - Attempts `sendWelcomeCredentials` email — non-fatal; `emailSent: false` returned when it fails
  - Response: `{ tempPassword, name, email, emailSent }`
- **`ResetPasswordModal`** — two-state modal rendered in `UsersTab` (Settings → Users):
  - **Confirmation state** — explains temp password flow, names target user and email; Cancel + "Set Password" button
  - **Result state** — temp password in large violet monospace + one-click copy button; green/amber banner showing email delivery status; "This password will not be shown again" note; Done button
  - Overlay click dismissed only in confirmation state (result must be explicitly closed — prevents accidental dismissal before copying)
- **User row action cell** upgraded — KeyRound icon button (amber hover) + Trash2 icon button (red hover) in a flex container; both reveal on row hover
- **API client** — `settingsApi.users.resetPassword(id)` → `POST /settings/users/:id/reset-password`

### Fixed — Welcome email not sent on user invite (`server/routes/settings.js`)

- Invite route called `emailUtil.sendWelcome(...)` which does not exist — the correct export is `sendWelcomeCredentials`
- All argument keys corrected: `to:` → `email:`, field names aligned with the email template's parameter signature
- Effect: newly invited users now receive their welcome email with login URL and temporary password

### Fixed — ProfilePage photo actions on wrong API namespace (`client/src/pages/profile/ProfilePage.jsx`)

- `authApi.uploadPhoto` / `authApi.removePhoto` do not exist on the `auth` export — methods live on `profile`
- Fixed import: `import { auth as authApi, profile as profileApi }` — both call sites updated to `profileApi.*`

### Security — Global `Math.random()` elimination

All production server code now uses Node.js built-in `crypto` (CSPRNG). `Math.random()` is fully banned:

| File | What changed |
|---|---|
| `server/routes/users.js` | `_genTempPassword()` → `crypto.randomInt` + Fisher-Yates; `_uid()` → `crypto.randomBytes(4).toString('hex')` |
| `server/routes/students.js` | `_genTempPassword()` → `crypto.randomInt` + Fisher-Yates |
| `server/routes/admissions.js` | Application ref → `crypto.randomBytes(3).toString('hex').toUpperCase()` |
| `server/routes/backup.js` | `_uid()` → `crypto.randomBytes(4).toString('hex')` |
| `server/routes/bell-schedule.js` | `_uid()` → `crypto.randomBytes(4).toString('hex')` |
| `server/routes/billing.js` | `_uid()` → `crypto.randomBytes(4).toString('hex')` |
| `server/routes/collections.js` | `_uid()` → `crypto.randomBytes(4).toString('hex')` |
| `server/routes/elearning.js` | Session ID → `crypto.randomBytes(3).toString('hex')` |
| `server/routes/mpesa.js` | `_uid()` → `crypto.randomBytes(4).toString('hex')` |
| `server/routes/platform.js` | `_annId()` → `crypto.randomBytes(4).toString('hex')` |
| `server/scripts/seed-demo-data.js` | Fake payment dates → `crypto.randomInt(1, 31)` |

### Removed — `three.js` unused dependency (`client/package.json`)

- `"three": "^0.184.0"` removed from client dependencies — the package was never imported anywhere in the source tree (~900 KB bundle bloat)

---

## [4.28.0] — 2026-06-08  Security Hardening — 2FA, OTP Hashing, JWT Expiry, CSPRNG, Slim Session

### Security — Authentication (`server/routes/auth.js`)

- **2FA scope expanded** — `MFA_ROLES` set extended from `['superadmin']` to `['superadmin', 'admin', 'deputy', 'finance']`; all privileged roles now require OTP on login
- **OTP hashed at rest** — `_hashOTP(otp)` computes SHA-256 before storing in `mfaOtp` field; `_verifyOTP(input, hash)` uses `crypto.timingSafeEqual` to prevent timing-side-channel attacks; plain-text OTP never written to database
- **CSPRNG for OTP generation** — replaced `Math.random()` with `crypto.randomInt(0, 9)` inside `_genOTP()`; Fisher-Yates shuffle in `_genTempPassword()` also uses `crypto.randomInt`
- **Demo school 2FA exemption** — `const isDemo = req.school?.slug === 'demo'`; demo accounts are exempt from 2FA requirement so demo quick-login works without real email delivery
- **Login rate limit tightened** — `loginLimiter` reduced from 20 → 10 attempts per 15-minute window

### Security — JWT (`server/utils/jwt.js`)

- **Token lifetime reduced** — `EXPIRES` default changed from `'7d'` → `'24h'` (`JWT_EXPIRES_IN` env var override still honoured); stolen-token attack window halved

### Security — Platform Key (`server/middleware/auth.js`)

- `X-Platform-Key` header now compared via `crypto.timingSafeEqual` — prevents timing attacks on the operator key

### Security — Settings CSPRNG (`server/routes/settings.js`)

- `_uid()` — switched from `Math.random().toString(36)` to `crypto.randomBytes(4).toString('hex')`
- `_genTempPassword()` — Fisher-Yates shuffle now uses `crypto.randomInt` (same as auth.js)

### Security — Client localStorage Slim-Session (`client/src/store/auth.js`)

- `_slimUser(user)` strips `email`, `permissions` before localStorage persist; keeps `id, name, role, schoolId, studentId, guardianOf`
- `_slimSchool(school)` strips `address`, `mpesa*`, `tagline`; keeps `id, name, slug, plan, logoUrl, faviconUrl, primaryColor, moduleConfig`
- XSS can still steal the JWT but cannot read email / permissions from `localStorage`

---

## [4.27.0] — 2026-06-08  Reliability Fixes — Stale Chunk Crash + Login Session Error

### Fixed — Stale-chunk auto-reload (`client/src/main.jsx`, `client/src/components/guards/ErrorBoundary.jsx`, `server/index.js`)

- **`window.unhandledrejection` listener** in `main.jsx` — catches dynamic-import `TypeError: Failed to fetch dynamically imported module` and calls `window.location.reload()` automatically; users land on a fresh build instead of a blank error screen
- **`ErrorBoundary.getDerivedStateFromError`** — detects `"Failed to fetch dynamically imported module"` (Vite's `vite:preloadError` string), sets `needsReload = true`, renders a "Loading update…" screen and reloads after 300 ms
- **`index.html Cache-Control: no-cache, no-store, must-revalidate`** — `server/index.js` serves the SPA shell with no caching; browsers always fetch a fresh HTML document referencing the latest hashed JS chunks after a deploy

### Fixed — Login shows "Session expired" for wrong-password error (`client/src/api/client.js`)

- **Root cause**: all 401 responses were treated as session expiry, dispatching `api:unauthorized` and clearing the session — including 401s from wrong-password attempts before any token existed
- **Fix**: 401 only triggers `api:unauthorized` if the request had a `Bearer` token; unauthenticated requests pass the actual server error message through to the UI; supports both `{ error: string }` and `{ error: { code, message } }` response shapes

### Fixed — Demo admin 2FA blocked (`server/routes/auth.js`)

- Security hardening in v4.28 extended 2FA to the `admin` role, but demo admin accounts have no real email for OTP delivery
- Added `isDemo` guard: `const isDemo = req.school?.slug === 'demo'; if (!isDemo && MFA_ROLES.has(userRole) && user.mfaEnabled !== false)`

---

## [4.26.0] — 2026-06-08  eLearning Module — Google Classroom + Google Meet + Zoom

### New — `server/routes/elearning.js` (~900 lines)

**Google OAuth (per teacher)**
- `GET  /api/elearning/auth/connect` — generates OAuth URL with `classroom.*`, `drive.file`, `calendar.events` scopes
- `GET  /api/elearning/auth/callback` — exchanges code, stores encrypted tokens per `(schoolId, userId)`
- `GET  /api/elearning/auth/status` — returns `{ connected, email }` for the current user
- `DELETE /api/elearning/auth/disconnect` — revokes and removes stored tokens

**Google Classroom — Courses & Coursework**
- `GET  /api/elearning/courses` — lists linked Classroom courses with local metadata
- `POST /api/elearning/courses/link` — links a Google Classroom course to a Msingi class
- `DELETE /api/elearning/courses/:id` — unlinks course
- `GET/POST/DELETE /api/elearning/courses/:id/coursework` — create assignments (title, description, due date, PDF attachment via Drive); Google Drive stores the file — Msingi only stores the `fileId` reference

**Google Drive Upload**
- `POST /api/elearning/drive/upload` — base64 payload → multipart upload to teacher's Google Drive → returns `fileId`; file is never stored in Msingi's database

**Grade Auto-Sync (Google Pub/Sub webhook)**
- `POST /api/elearning/gc-webhook` — validates Pub/Sub push signature; resolves student by `googleId`; writes returned grade to Grades module

**Zoom Live Sessions (Server-to-Server OAuth)**
- `_getZoomToken()` — cached Server-to-Server OAuth token (`ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`)
- `_zoomFetch()` — thin wrapper with token injection and error normalisation
- Zoom webhook: `POST /api/elearning/zoom-webhook` — handles `participant_joined`, `participant_left`, `meeting.ended`, `recording.completed`; marks attendance in Attendance module; HMAC-SHA256 challenge response for setup

**Google Meet Live Sessions (Calendar API)**
- `_createMeetSession()` — creates a Google Calendar event with `conferenceDataVersion: 1`; returns `hangoutLink`
- `_deleteMeetSession()` — removes the calendar event when session is cancelled
- `POST /api/elearning/sessions/:sessionId/attend` — records a student's Meet join-click as an attendance record (Meet doesn't fire webhooks; join-click is the proxy signal)

**Sessions API (Zoom + Meet unified)**
- `GET  /api/elearning/sessions?platform=zoom|meet` — lists sessions for a course
- `POST /api/elearning/courses/:id/sessions` — schedule session (platform: `zoom` | `meet`); title, date/time, duration; creates Zoom meeting or Google Calendar event accordingly
- `PATCH /api/elearning/sessions/:id` — update title / scheduled time
- `DELETE /api/elearning/sessions/:id` — cancel and delete upstream meeting

### New — `server/index.js`

- `app.use('/api/elearning', require('./routes/elearning'))` mounted

### New — `client/src/pages/elearning/ELearningPage.jsx` (~1600 lines)

- **Route dispatcher** — `/elearning/classroom` → `ClassroomView`; `/elearning/meet` → `SessionsView({ platform: 'meet' })`; `/elearning/zoom` → `SessionsView({ platform: 'zoom' })`; Zoom path skips Google auth check entirely
- **`ConnectCard`** — shown when teacher has not connected Google account; distinct icon/text for Classroom vs. Meet
- **`ClassroomView`** — course sidebar + **Classwork / People / Grades** tabs (green Google Classroom accent); course picker; create coursework slide-over with title, instructions, due date, PDF upload
- **`SessionsView`** — Meet or Zoom session list; **Schedule Session** modal: course picker, title, date, duration; Join link rendered for upcoming sessions
- **`ScheduleSessionModalFull`** — full-featured scheduling modal used from both Meet and Zoom views

### New — `client/src/components/layout/Sidebar.jsx` — eLearning section

- `ELEARNING_ITEMS` — Google Classroom, Google Meet, Zoom sub-links with inline SVG brand icons
- Accordion with `eLearningOpen` state; auto-opens when on any `/elearning/*` path
- Regular `NavLink` for all other module links; accordion only for eLearning

---

## [4.25.0] — 2026-06-08  Profile Photo — Auth Fix, Error Handling, Size Validation

### Fixed — `GET /api/users/:id/photo` no longer requires auth (`server/routes/users.js`)

- **Root cause**: `authMiddleware` was required on the photo endpoint, but browser `<img src="...">` tags cannot send `Authorization: Bearer` headers — photos always returned 401 for all users
- **Fix**: `authMiddleware` removed from `GET /:id/photo`; school tenant header still resolved from `X-School-Slug` for multi-tenancy

### Fixed — Profile photo upload silent failure (`client/src/pages/profile/ProfilePage.jsx`)

- `resizeImageToBase64` — `img.onerror` was passing the raw DOM `Event` object to `reject()` instead of an `Error`; unhandled rejection was swallowed silently; now wraps in `new Error('Image failed to load: ' + src)`
- Uses `authApi.uploadPhoto()` / `authApi.removePhoto()` from the API client (handles multi-tenant slug) instead of raw `fetch()`

### Changed — Pre-upload validation + UX

- MIME type check before resize: only `image/jpeg`, `image/png`, `image/webp`, `image/gif` accepted; others rejected with an inline error message
- File size limit: 10 MB max enforced on the client before any upload attempt
- `fmtBytes(bytes)` helper — converts raw bytes to human-readable string (e.g. `3.2 MB`)
- Success banner shows original file size (e.g. "Photo updated · 1.4 MB")

---

## [4.24.0] — 2026-06-08  School Logo in Sidebar + Dynamic Favicon

### Changed — `client/src/components/layout/Sidebar.jsx`

- **School logo in sidebar header** — if `school.logoUrl` is set in session, renders `<img src={logoUrl} alt={schoolName} />` (40×40 rounded, object-cover); falls back to a `<div>` with two-letter initials and `primaryColor` background when no logo is uploaded
- Logo and initials transition smoothly via shared CSS class; no layout shift

### Changed — `client/src/components/layout/AppShell.jsx`

- **Dynamic favicon** — `useEffect` watches `session.school.faviconUrl` + `session.school.name`; on change, updates `<link rel="icon" href=...>` in `document.head`; falls back to the platform default favicon when `faviconUrl` is absent
- **Dynamic page title** — `document.title` set to `"Msingi — <School Name>"` when school name is available

---

## [4.23.0] — 2026-06-08  Settings: School Logo + Favicon Upload

### New — `PUT/DELETE /api/settings/school/logo` and `PUT/DELETE /api/settings/school/favicon` (`server/routes/settings.js`)

- `PUT /school/logo` — accepts base64 data URI; validates MIME (`image/*`); stores in `schools.logoUrl`; returns updated URL
- `DELETE /school/logo` — clears `logoUrl` from school document
- `PUT /school/favicon` — same flow; stores in `schools.faviconUrl`
- `DELETE /school/favicon` — clears `faviconUrl`
- RBAC: admin or superadmin only; `_uid()` uses `crypto.randomBytes` (see v4.28.0)

### New — `AssetUploader` component (`client/src/pages/settings/SettingsPage.jsx`)

- File picker with image preview (drag-and-drop not required — standard `<input type="file">`)
- Shows current asset if already uploaded; **Replace** and **Remove** actions
- Instant save on selection — no separate submit needed; toast on success/error
- `useRef` imported and used for the hidden file input

### New — `BrandingCard` in SettingsPage School tab

- Two side-by-side `AssetUploader` instances: **School Logo** (appears in sidebar, login page) and **Favicon** (browser tab icon)
- Recommended sizes displayed as helper text (logo: 200×200 px, favicon: 32×32 px)
- On save, dispatches `patchSchool({ logoUrl, faviconUrl })` to update Zustand session so sidebar and favicon refresh instantly without re-login

---

## [4.22.0] — 2026-06-08  School Finder — Public School Search + Generic Login Guard

### New — `GET /api/public/schools/search?q=` (`server/routes/public.js`)

- Case-insensitive regex search against both `name` and `slug` fields; returns up to 10 matching schools
- Response shape: `[{ slug, name, shortName, logoUrl }]` — minimal branding info for the autocomplete list
- No authentication required (public endpoint); rate-limited by global limiter

### New — `GET /api/public/school-asset/:type?slug=` (`server/routes/public.js`)

- `type` ∈ `logo | favicon`; looks up school by `slug` query param; streams the stored data URI as binary with correct `Content-Type` header
- Allows the login page and School Finder to render school branding without any auth token

### Changed — `GET /api/public/school-info` (`server/routes/public.js`)

- Response now includes `faviconUrl` alongside the existing branding fields

### New — `SchoolFinderPage.jsx` (`client/src/pages/SchoolFinderPage.jsx`)

- Shown on the main domain (no school context) before the login form
- Search input with 300 ms debounce → `GET /api/public/schools/search?q=` → autocomplete dropdown
- Each result shows school logo (or initials), name, and slug
- Clicking a result stores the slug in `localStorage` (`ms_school_slug`) and navigates to `/login?school=<slug>`
- Empty state with friendly "Start typing a school name…" hint; no results state with "School not found? Contact your administrator."

### Changed — `client/src/pages/Login.jsx`

- **Generic domain guard**: `if (!isSchool) return <SchoolFinderPage />;` inserted before the `loadingBranding` check — users who land on `msingi.io/login` without a school context see the finder instead of a broken login form

---

## [4.21.0] — 2026-05-26  Sections as a Managed School Resource

### New — `/api/sections` resource

- Sections (Kindergarten, Primary, Secondary, A-Level) are no longer hardcoded in frontend constants
- New `server/routes/sections.js` — full CRUD per school: `GET`, `POST`, `PUT /:id`, `DELETE /:id`
- Auto-seeds the 4 standard sections on first GET per school — no migration script needed
- `DELETE` is blocked if active classes are assigned to the section (referential integrity)
- **Key is immutable** after creation (it's the foreign key used by classes and bell schedule); name and colour can always be changed
- Route registered at `app.use('/api/sections', ...)` in `server/index.js`

### Changed — Classes route

- `sectionKey` validation relaxed from `z.enum(['kg','primary','secondary','alevel'])` to `z.string().max(50)` so any admin-created section key is accepted

### New — Settings → School → Sections panel

- `SectionsPanel` component added to SchoolTab between Houses and M-Pesa
- Lists all school sections with colour dot, display name, and immutable key badge
- Inline edit row: change name and colour without leaving the page
- Add Section form with auto-derived key from name (editable), colour palette + custom picker, live badge preview
- Delete with confirmation dialog; blocked server-side if classes are in use

### New — `client/src/hooks/useSections.js`

- `useSections()` hook — fetches from `/api/sections` with React Query, `staleTime: 10m`
- Returns `{ sections, sectionMap, sectionTabs, isLoading }` where:
  - `sectionMap[key]` → `{ name, color, id }`
  - `sectionTabs` → `[{ id:'all', label:'All Sections' }, ...]` ready for filter tabs

### Changed — Classes page (`ClassList.jsx`)

- Removed hardcoded `SECTION_LABELS` and `SECTION_BADGE` constants
- Section filter tabs now built from `sectionTabs` — show school's actual configured sections
- Active filter tab colour matches the section's configured colour (inline style)
- Section badge on each class card uses inline hex colour (background tint + border), no Tailwind purge risk
- **Add Class form** Section dropdown now populated dynamically from `sectionTabs`

### Changed — Timetable page (`TimetablePage.jsx`)

- Removed `SECTIONS` import from constants; replaced with `useSections()` hook
- Section filter tabs (All Sections | Primary | Secondary …) now reflect school's configured sections
- Active tab styled with section colour
- `filteredClasses` now prefers `c.sectionKey` (stored field) over `inferSection(c.name)` (name inference)
- Bell schedule section lookup also upgraded to use stored `sectionKey` first

### New — `client/src/api/client.js`

- Added `sections` export with `list`, `create`, `update`, `remove` methods

---

## [4.20.0] — 2026-05-26  Settings RBAC Matrix Expansion + Landing Page Refresh

### Changed — Roles & Permissions sub-module matrix expanded

- **Students**: added `Import Students (CSV)` permission sub
- **Teachers**: added `Import Teachers (CSV)` permission sub
- **Classes**: added `Export Classes (CSV)`, `Import Classes (CSV)`, and `Manage Sections & Streams` subs
- **Timetable**: expanded from 2 subs to 7 — added `Manage Rooms`, `Configure Bell Schedule`, `Manage Teaching Assignments`, `Import Timetable (CSV)`, `Export Timetable (CSV)`
- **Finance**: added `Manage Fee Structures`, `Import Finance Data (CSV)`, and `Configure M-Pesa Integration` subs

### Changed — Default role permission rules updated

- `deputy`: can manage fee structures (edit); blocked from M-Pesa config (sensitive)
- `teacher`: blocked from all `import` actions across every module; blocked from `classes.section`, `classes.delete`; timetable admin subs (rooms, bell schedule, assignments) granted as view-only
- `parent`: can view invoices and payments; explicitly denied fee structure management, M-Pesa config, import, and invoice creation/voiding

### Changed — System tab version corrected

- Hardcoded version string updated from `v4.9.13` → `v4.19.0`

### Changed — Landing page updated to reflect current feature set

- `PLAN_FEATURES` expanded from 14 → 17 features:
  - Added **Subjects & Curriculum Management** (Core tier)
  - Added **Class Sections & Streams** (Core tier)
  - Added **CSV Bulk Import / Export** (Standard tier)
- Plan `included` arrays updated to match — Core now covers 8 features (up from 6)
- Dashboard mockup sidebar updated: added Timetable and Subjects nav items
- Ecosystem flow chain updated: **Classes** node inserted between Student Record and Timetable to reflect sections & streams milestone in student journey

---

## [4.19.0] — 2026-05-26  Collapsible Sidebar + Class Sections & Streams

### New — Collapsible sidebar (desktop)

- Sidebar spring-animates between 256 px (expanded) and 64 px (collapsed) via Framer Motion
- Collapse state persisted to `localStorage` — survives page refresh and navigation
- **Collapsed mode**: icons only, perfectly centred in 64 px; native `title` tooltip on hover for every nav item
- Text labels fade out (0.1 s) before the sidebar width contracts; fade in after a 0.14 s delay on expansion so the width spring leads and text follows
- Section group labels animate `maxHeight + opacity + margin` to zero simultaneously when collapsing
- Collapse/expand toggle button lives at the bottom of the nav (above user footer): `ChevronLeft` when expanded, `ChevronRight` when collapsed
- Footer: stacked avatar + logout icon when collapsed; full name/role/logout row when expanded
- Mobile overlay drawer is completely unaffected (no `collapsed` prop passed)
- `AppShell` uses `motion.aside` with `initial={false}` — no animation flash on first load

### New — Class sections & streams

- `sectionKey` field added to `ClassSchema` (Zod validation on POST and PUT): `kg | primary | secondary | alevel`
- **Add Class form** restructured: Section + Year/Level side-by-side (row 1), Room + Capacity (row 2), Status standalone, then Form Tutor and Description
- **ClassList** now groups classes by `year` field — classes sharing the same `year` are streams (e.g. Year 7A, 7B, 7C appear under a "Year 7 · 3 streams" header)
- **Section filter tabs** above the grid: All | Kindergarten | Primary | Secondary | A-Level — tabs only render for sections that have at least one class; counts shown inline
- **Section colour badge** on each card: blue = Primary, violet = Secondary, amber = A-Level, emerald = Kindergarten
- Empty-section state when filtering: friendly message + "Show all sections" link instead of blank grid
- All filtering is client-side (no extra network round-trips — 200 classes already loaded)

---

## [4.18.0] — 2026-05-26  Import/Export Dissolution — Bulk import embedded in each module

### Changed — Removed standalone Import & Export page

The `/import-export` route, sidebar link, and `ImportExportPage.jsx` have been dissolved.
Import and export functionality now lives directly inside each relevant module.

### New — Bulk import in Students module

- Import button added to the Students list toolbar
- Opens `BulkImportSlideOver` with `type="students"`, template download, and export
- Server handler `_importStudents` already existed; wired to the new slide-over

### New — Bulk import in Teachers (HR) module

- Import button added to the Teachers list toolbar alongside the existing Export button
- Opens `BulkImportSlideOver` with `type="teachers"`, template download, and export

### New — Import + Export in Classes module

- Import and Export buttons added to the Classes header toolbar
- `_importClasses`: inserts new classes; skips duplicates by name silently
- CSV fields: `name`, `sectionKey`, `year`, `capacity`
- Export added to `/api/import-export/export/classes`

### New — Timetable CSV import

- Import button added to the Timetable page toolbar (admin/timetabler only)
- `_importTimetable`: upsert by `schoolId + classId + day + period` — existing slots updated, new slots created
- Resolves `className → classId` and `teacherName → teacherId` automatically
- Export added to `/api/import-export/export/timetable`

### New — Finance bulk invoice import

- Import button added to the Invoices tab toolbar (finance admins only)
- `_importFinance`: one CSV row → one invoice with one line item
- Resolves `admissionNumber → studentId` automatically
- Each invoice generated with a sequential `invoiceNumber`
- Export added to `/api/import-export/export/finance`

### New — Shared `BulkImportSlideOver` component

`client/src/components/import/BulkImportSlideOver.jsx`

- Motion slide-over panel (backdrop + right-panel)
- Drag-and-drop upload zone + file picker; parses and previews row count
- Template download + optional Export button
- Import result summary: created count, skip count, per-row error table
- Type-specific tips section (timetable upsert note, classes skip note, finance note)

### Backend additions (`server/routes/import-export.js`)

- `_buildTeacherMap(schoolId)` — name → `{ teacherId, teacherName }` lookup
- `_importClasses`, `_importTimetable`, `_importFinance` handler functions
- POST dispatcher extended to route all 5 types
- Export handler extended for `timetable` and `finance`

### Navigation cleanup

- Sidebar: removed `Import & Export` link
- TopBar breadcrumb map: removed `/import-export` entry
- App.jsx: removed lazy import and route for `ImportExportPage`
- SettingsPage: updated import/export note to point users to respective modules
- HelpPage: updated 3 answers to reflect new locations

---

## [4.17.0] — 2026-05-26  Rooms Registry + Teaching Assignments + Timetable Auto-fill

### New — Room Registry (`/api/rooms`)

- `GET /` — list registered rooms for the school
- `GET /:id` — single room detail
- `POST /` — create room (name, code, type, capacity, notes); duplicate name guard per school
- `PUT /:id` — update room details
- `DELETE /:id` — soft-delete (`isActive: false`); timetable slots that reference the room are NOT deleted
- Room types: `classroom`, `lab`, `hall`, `sports`, `library`, `other`
- RBAC: admin / superadmin / deputy / principal / timetabler may write; all authenticated users may read
- Double-booking: allowed (timetable warns but never blocks)

### New — Teaching Assignments (`/api/teaching-assignments`)

One record = "Teacher X delivers Subject Y to Class Z in preferred Room R"

- `GET /` — filterable by `teacherId`, `classId`, `subjectId`, `roomId` — teachers see only own assignments
- `POST /` — creates assignment; denormalises `teacherName`, `subjectName`, `className`, `preferredRoomName` at write time
- `PUT /:id` — update `preferredRoomId` and/or `periodsPerWeek` only
- `DELETE /:id` — hard delete
- RBAC: admin / principal / deputy — any subject/class; HOD — only subjects in their `departmentId`; timetabler — read-only; teacher — own assignments only
- Duplicate guard: same `teacherId + subjectId + classId` → 409 Conflict

### New — Teacher Module: Assignments Tab

- Teacher detail slide-over now has two tabs: **Profile** and **Assignments**
- Assignments tab lists all `teaching_assignments` for the selected teacher
- Shows: Subject · Class · Preferred Room · Periods/week
- Add assignment form: class picker → subject picker (filtered from class curriculum) → room picker (from registry) → optional periods/week
- Subjects are populated from the class's curriculum (`/api/class-subjects?classId=X`) — only subjects already assigned to that class appear
- Admin / principal / HOD can add/remove assignments; teachers see read-only

### New — Timetable: Rooms Tab

- New **Rooms** view in the Timetable page (admin/timetabler only)
- Left panel: Room Registry CRUD (via `RoomsTab` component)
- Right panel: Room occupancy grid — shows Subject · Teacher · Class per cell for the selected room across the full week
- Double-bookings highlighted in red with conflict count badge
- Handles unregistered rooms (free-text rooms stored in old slots)

### Enhanced — Slot Editor Auto-fill

- **Subject field**: now a dropdown populated from the class's curriculum; falls back to free text if no curriculum is configured
- **Room field**: now a dropdown populated from the registered rooms registry; falls back to free text if no rooms registered; shows "unregistered" hint for legacy free-text room values
- **Auto-fill**: selecting a subject triggers a lookup against `teaching_assignments` for that class+subject combination; if found, teacher and preferred room are automatically populated
- Status banner: green "Auto-filled" confirmation, amber "No assignment found — fill manually" hint, or loading spinner while lookup is in progress
- All auto-fill is non-blocking — user can override any field after auto-fill

### Architecture

- `server/routes/rooms.js` — new route module
- `server/routes/teaching-assignments.js` — new route module
- `client/src/pages/timetable/components/RoomsTab.jsx` — new component
- `client/src/pages/timetable/components/RoomView.jsx` — new component
- `client/src/api/client.js` — `rooms` and `teachingAssignments` API objects added

---

## [4.11.5] — 2026-05-25  Phase 3 — Subject Enrollment Warnings Engine

### New — `GET /api/class-subjects/enrollment-warnings`

Rule resolution per class (most specific wins):
- **classPattern** match: regex tested against `classId` — e.g. `f[34]` catches Form 3A and Form 4A before the general secondary rule fires
- **section** match: fallback using `class.sectionKey` (primary / secondary / alevel)
- **No rule**: student rows get `status: 'no_rule'`; class excluded from school-wide warning list

Modes:
- `?classId=X` — full per-student breakdown for one class
- *(no params)* — school-wide: only classes with ≥1 `below_min` or `above_max` student are returned, keeping the timetabler dashboard noise-free

Per-student fields: `id`, `firstName`, `lastName`, `admissionNumber`, `subjectCount`, `status`  
Per-class summary: `ok`, `belowMin`, `aboveMax`, `noRule`, `total`

---

## [4.11.4] — 2026-05-25  Phase 2 — Class Curriculum & Subject Rules APIs

### New — `/api/class-subjects`

- `GET ?classId=X` — full curriculum for a class with subject + department details
- `GET ?subjectId=X` — all classes that offer a given subject
- `GET /counts` — `{ classId: subjectCount }` for class cards
- `POST /` — assign a single subject to a class (validates both entities exist)
- `POST /bulk` — assign multiple subjects at once; idempotent, skips already-assigned
- `PUT /:id` — toggle `isCompulsoryForClass` flag
- `DELETE /:id` — guarded: blocked if students are still enrolled in the subject for that class

### New — `/api/subject-rules`

Full CRUD for min/max subject count rules.  
Gated to `timetable:update` (same permission as bell schedule editing).

### Updated — `GET /api/subjects`

New `?withClassCurriculum=classId` param: attaches `inCurriculum`, `isCompulsoryForClass`, `classSubjectId` to each subject row — one request powers the entire curriculum editor list.

---

## [4.11.3] — 2026-05-25  Phase 1 Seed Foundation — A-Level Classes, Subject Curriculum & Enrollment

### New — A-Level support

- Added Form 5A and Form 6A classes with `sectionKey: 'alevel'` and their own section record (`sec_alevel_sch_demo`).
- Added 4 new A-Level-only subjects: **Pure Mathematics** (PMATH), **Mechanics** (MECH), **Statistics & Probability** (STAT), **Economics** (ECO) — all under their respective departments (Mathematics / TBS).
- Subjects that span secondary and A-Level (Physics, Chemistry, Biology, History, Geography, Business Studies) now have `sections: ['secondary', 'alevel']`; always patched on re-seed.

### New — Class curriculum assignments (`class_subjects` collection)

- 96 class-subject links seeded across all 9 classes:
  - Primary (Std 4A–6A): 7 compulsory subjects + ICT elective.
  - Form 1A–2A: 8 compulsory core + 4 electives.
  - Form 3A–4A: 3 compulsory + 9 electives (KCSE model).
  - Form 5A–6A: 12 all-elective A-Level subjects.

### New — Student subject enrollments (`student_subjects` collection)

- 163 individual enrollment records generated from ENROLLMENTS groups for all 20 demo students.
- Enrollment reflects realistic curriculum choices: science track, humanities track, KCSE subjects, full primary curriculum.

### New — Subject enrollment rules (`subject_rules` collection)

- 4 rules seeded (min/max subjects per section, like bell schedule settings):
  - Primary: min 6, max 8.
  - Secondary Form 1-2: min 7, max 10.
  - KCSE Form 3-4: min 7, max 9 (pattern `f[34]`).
  - A-Level: min 3, max 4.

### New — Teacher profiles enriched

- All 10 teacher profiles now include `staffType: 'teacher'`, `departmentId`, `subjects[]`, `extraRoles[]`, and `formClassId` where applicable.
- Extra academic roles seeded: `hod` (6 teachers), `class_teacher` (1), `exam_officer` (1), `timetabler` (1).

### Fixed — Department HOD foreign-key links

- Departments now store `hodId` (teacher profile ID) and `hodUserId` (user ID) alongside `hodName`.
  Patched on every re-seed via `$set` so legacy docs are upgraded automatically.

---

## [4.11.2] — 2026-05-25  Timetable Seed Fix + Substitution Engine Bug Fixes

### Fixed — Seed data collection mismatch (Critical)

- `seed-demo-data.js` was writing timetable slots to the wrong MongoDB collection (`timetable_slots`) while all API routes read from `timetable`.  
  All 60 seeded timetable slots were completely invisible to the API — this caused "No lessons found" on every mark-absent request and empty class grids.  
  Fixed: seed now writes to the correct `timetable` collection.

### Fixed — Teacher ID format mismatch in substitution engine

- `POST /substitutions/absent`: Teacher profile IDs (`tch_demo_2`) and user IDs (`u_demo_t2`) are two different formats stored across collections.  
  The frontend sends the teacher profile's `id` field, but timetable slots store `teacherId` as user IDs.  
  Fixed: route now resolves the teacher profile via `$or: [{ id }, { userId }]`, builds a `slotIds` array with both formats, and queries timetable slots using `$in`.  
  `originalTeacherId` is now stored as the canonical `userId` so exclusions match slot format downstream.

- `GET /available-teachers`: `busyIds`, `absentIds`, `coveredIds` sets are built from user IDs (`u_demo_t2`) in timetable slot data.  
  The teacher filter was comparing against teacher profile IDs (`tch_demo_2`) — no teacher was ever excluded.  
  Fixed: now checks both `t.userId` and `t.id` against each exclusion set; weekly load uses `userId` as the primary key.

- `POST /substitutions/auto-assign`: Same dual-ID fix applied; load calculation and exclusion filter both use `userId` as the canonical identifier.

### New — Full timetable seed for all 7 classes

- Added weekly timetable data for the 5 previously empty classes:  
  Standard 5A (25 slots), Standard 6A (25 slots), Form 2A (30 slots), Form 3A (30 slots), Form 4A (30 slots).  
  Total seeded slots increased from 60 to **205** (all 7 classes, full week, Mon–Fri).
- All timetable slots now include `subject` (display string) and `className` fields so substitution records show meaningful data in the Cover Sheet.

---

## [4.11.1] — 2026-05-24  Timetable: Smart Cover Sheet & Substitution Engine

### New — Available-teachers API (`server/routes/timetable.js`)

- `GET /api/timetable/available-teachers?date=YYYY-MM-DD&period=5&subject=MAT`  
  Returns active teachers who are **free** at the given period on the date's weekday.  
  Excludes: teachers with a lesson at that period (master timetable), teachers already marked absent today, substitutes already covering another lesson at the same period.  
  Sorted: **same-department first** (matched on subject prefix), then **fewest weekly lessons** (most available teacher rises to top).  
  First result flagged `suggested: true`.

### New — Auto-assign endpoint (`server/routes/timetable.js`)

- `POST /api/timetable/substitutions/auto-assign` — body: `{ date }`  
  For every uncovered substitution record on a given date, finds the best available teacher and assigns them in one call.  
  Processes records in period order; tracks assignments made within the call so no teacher is double-booked at the same period.  
  Returns `{ assigned, total }`.

### Changed — Substitution update accepts `type` field

- `PUT /api/timetable/substitutions/:id` now accepts `type: 'supervision' | 'cover' | 'teaching'` (independent of substitute assignment — can be updated separately).

### New — `SubstituteCell` component (`TimetablePage.jsx`)

Per-row React component that fires its own `useQuery(['tt-avail', date, period, subject])` to fetch the available-teacher list for that specific period. React Query deduplicates — two absent teachers with lessons at the same period share one HTTP request.

- Dropdown shows: `⭐ Ms. Sylvia (dept) · 12 lessons` (top suggestion), then other available teachers ranked by load.
- Teachers who are busy, absent, or already covering at that period are excluded automatically.
- Print mode: dropdown hidden, assigned name shown inline.

### Changed — Cover / Subs tab complete redesign (`TimetablePage.jsx`)

Cover sheet now matches the **aSc Substitutions** format exactly:

| Absent | Lesson | Reason | Subject | Class | Type | Substitutes | Signature |
|--------|--------|--------|---------|-------|------|-------------|-----------|

- **Absent teacher column** uses `rowSpan` across all their lessons — same visual grouping as aSc output.
- **Type column** — per-row dropdown: Supervision / Cover / Teaching (screen only; hidden in print).
- **Substitutes column** — `SubstituteCell` with smart ranked picker per period.
- **Signature column** — shown only in print view.
- **Summary header** — `"Unfortunately, the following teachers will not teach today: Mr. Godfrey (5, 7) and Ms. Beatrice (2)"` — generated dynamically from the day's absent records.
- **Auto-assign all** button — fills every uncovered row in one click using the best available teacher; shows result count in toast.
- **Print footer** — timestamp and page marker matching aSc style.

### Changed — Client API (`client/src/api/client.js`)

```js
timetable.availableTeachers(params)           // GET /timetable/available-teachers
timetable.substitutions.autoAssign(data)      // POST /timetable/substitutions/auto-assign
```

---

## [4.11.0] — 2026-05-24  Events Birthdays · HR Document Links · Settings Users Filter

### New — Birthdays view in Events (`server/routes/events.js`, `EventsPage.jsx`)

- `GET /api/events/birthdays?month=5&year=2026`  
  Queries both `students` and `teachers` collections using a regex on the `dateOfBirth` field (format `YYYY-MM-DD`).  
  Returns sorted list of birthdays for the selected month with `{ id, name, type, day, dateOfBirth, meta, photoUrl }`.  
  Route placed **before** `GET /:id` to prevent Express matching "birthdays" as an ID param.

- **Events page** (`EventsPage.jsx`) — three-view toggle: **Month** (calendar grid) | **List** (upcoming events) | **Birthdays** (🎂 cake icon).
  - `BirthdayCard` — avatar with initials fallback, Student / Staff badge, class or "Teacher" meta, date display.
  - Calendar cells show birthday count overlay; clicking switches to the birthdays view for that month.
  - Stats row in birthdays view: total / students / staff counts.
  - Today's birthday banner in month and list views (rose/pink highlight).
  - Month navigator shared across all three views.
  - `birthday` added to `CATEGORIES` constant with rose colour.

### Changed — HR Documents — document link field (`HRPage.jsx`)

- Added `fileUrl` field to the document creation form.
- URL input with placeholder `https://drive.google.com/… or OneDrive / Dropbox link` and helper text explaining external storage.
- Document cards: **View Document** external link appears when `fileUrl` is set (opens in new tab).
- No server-side file storage required — links to Google Drive / OneDrive / Dropbox are stored as a URL string.

### Changed — Settings Users — role filter + search (`SettingsPage.jsx`)

- Added `roleFilter` state and `search` state to the `UsersTab` component.
- **Filter bar**: text search (name or email) + role dropdown covering all 13 system roles.
- **Clear** button resets both filters.
- Counter shows `X of Y users` when a filter is active.
- All filtering is client-side on the already-fetched user list — no additional API calls.

---

## [4.10.1] — 2026-05-24  Global Cleanup — Dead Legacy App Removed

### Removed — Legacy vanilla-JS application (29,000+ lines deleted)

The original vanilla-JS frontend that predated the React SPA has been fully deleted. It had no active users — the React build at `client/dist/` is the only served frontend — but its presence created version-switching risk.

**Deleted files:**
- `index.html` — legacy app shell
- `css/styles.css` — legacy stylesheet
- `js/api.js`, `js/app.js`, `js/cache.js`, `js/data.js`, `js/tests.js`, `js/validators.js`
- `js/modules/` — 21 module files (academics, admissions, attendance, auth, behaviour, birthday, changelog, classes, communication, dashboard, events, exams, finance, help, hr, plans, reports, settings, students, subjects, timetable)
- `server/utils/seedSchool.js` — superseded by `scripts/seed-demo.js`

**`server/index.js`**
- Legacy catch-all that served the deleted `index.html` replaced with a `503` response instructing developers to run the React build. Prevents silent fallback to a non-existent file.

### Fixed — Stale InnoLearn / legacy references

**`onboard.html`**
- Demo login link: `/?demo=innolearn` → `/login?school=demo` (correct school slug).
- "Go to My Portal" button: `href="index.html"` → `href="/login"`.

**`server/routes/onboard.js`**
- `loginUrl` in welcome email: `/index.html` → `/login`.

**`platform.html`**
- Demo school label: `slug: innolearn` → `slug: demo`.
- Subscription pricing corrected: Core KES 5,000 · Standard KES 12,000 · Premium KES 25,000 (was 15K / 35K / 65K).

**`server/routes/auth.js`**
- Internal comment example header updated: `X-School-Slug: InnoLearn` → `X-School-Slug: demo`.

### Fixed — Database name safety (`server/config/db.js`)
- Added prominent warning comment: `dbName: 'innolearn'` is the **live Atlas database name** — changing this fallback without a migration would silently point to an empty database.
- `MONGODB_DB_NAME` env var now the override path.

### Fixed — Scripts use env var for DB name
- `scripts/fix-provisioned-users.js`, `fix-school-ids.js`, `list-users.js`, `seed-role-permissions.js` — all now read `process.env.MONGODB_DB_NAME || 'innolearn'` instead of the hardcoded string.
- `scripts/list-users.js` — removed hardcoded `schoolId: 'sch_innolearn_001'` filter (was silently returning 0 results for all other schools).

---

## [4.10.0] — 2026-05-24  Security Hardening + Google/Microsoft OAuth + M-Pesa Subscription

### Security — Critical fixes

**`server/routes/auth.js`**
- Removed plain-text password fallback (`password === user.password`). All accounts must have a bcrypt hash — legacy plaintext accounts can no longer sign in.
- Replaced `Math.random()` OTP generation with `crypto.randomInt` (Node.js CSPRNG).

**`server/middleware/auth.js`**
- Platform admin key now compared using `crypto.timingSafeEqual` — prevents timing-side-channel attacks on the `X-Platform-Key` header.

**`server/routes/mpesa.js`**
- All Safaricom callback endpoints now enforce an IP allowlist (`SAFARICOM_IPS`) in production. Requests from unknown IPs receive `403 Forbidden` — blocks fake payment injection attacks.
- Set `MPESA_SKIP_IP_CHECK=true` in sandbox/dev environments to bypass.

### New — Google OAuth 2.0 (`server/routes/auth.js`)
- `GET /api/auth/google?slug=<school>` — redirects to Google OAuth consent screen.
- `GET /api/auth/google/callback` — exchanges code, fetches profile, finds or creates user, issues JWT. New users provisioned as `teacher` role; admin upgrades role.
- State parameter carries school slug for tenant resolution.
- Required env vars: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_URL`.

### New — Microsoft OAuth 2.0 (`server/routes/auth.js`)
- `GET /api/auth/microsoft?slug=<school>` — redirects to Microsoft identity platform.
- `GET /api/auth/microsoft/callback` — same flow as Google.
- Required env vars: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `PUBLIC_URL`.

### New — Social login buttons (`client/src/pages/Login.jsx`)
- Google and Microsoft sign-in buttons below the password form.
- OAuth token read-back on redirect return — reads `?token=` from URL, calls `/api/auth/me`, sets session.
- Error handling for all failure cases (denied, not configured, school not found, account inactive).

### New — M-Pesa subscription payments (`server/routes/mpesa.js`)
- `POST /api/mpesa/subscription` — admin/principal only; initiates STK Push to pay Msingi platform subscription. Uses platform Daraja credentials (`MSINGI_MPESA_*` env vars), not school's own credentials.
- `POST /api/mpesa/subscription/callback` — Safaricom callback; activates school plan for 30 days on successful payment.
- `GET /api/mpesa/subscription/plans` — public pricing endpoint.
- Subscription prices: Core KES 5,000 · Standard KES 12,000 · Premium KES 25,000.

### New — Subscription tab (`client/src/pages/settings/SettingsPage.jsx`)
- New **Subscription** tab in Settings (admin-only) between School and Users.
- Shows current plan + expiry, plan selector grid, STK Push payment form.
- Enterprise plan routes to `sales@msingi.io`.

### Changed — Plan tier alignment
**`server/middleware/plan.js`**
- `finance`: `premium` → `standard` (fee management is a core East African school need; aligns with landing page).
- `report_cards`: `premium` → `standard` (aligns with landing page promise).
- `hr`: new entry at `premium`.

**`client/src/pages/Landing.jsx`**
- Plans feature matrix updated to match backend — Finance & Fee Ledger now shown starting at Standard (not Core); all 14 features correctly gated per tier.
- Finance moved after core communication features in the table order.

---

## [4.9.19] — 2026-05-20  Subjects & Departments Registry

### New — `server/routes/departments.js`

Full CRUD API for the school's **department registry**.

- `GET /api/departments` — lists all active departments with embedded subject count per department.
- `GET /api/departments/:id` — single department.
- `POST /api/departments` — create; validates unique code within school.
- `PUT /api/departments/:id` — update; code uniqueness check excludes self.
- `DELETE /api/departments/:id` — soft-delete (`isActive: false`); **blocked** if active subjects still exist in that department.
- Schema: `{name, code, color (#hex), hodName, description, order, isActive}`.
- RBAC: write routes gated by `rbac('departments', 'create'|'update'|'delete')`.

### New — `server/routes/subjects.js`

Full CRUD API for the school's **subject registry**.

- `GET /api/subjects` — list active subjects; filterable by `departmentId`, `section`, `isCompulsory`.
- `GET /api/subjects/:id` — single subject.
- `POST /api/subjects` — create; validates `departmentId` belongs to this school; enforces code uniqueness.
- `PUT /api/subjects/:id` — update with same guards.
- `DELETE /api/subjects/:id` — soft-delete only.
- Schema: `{name, code, shortName, departmentId, sections['kg'|'primary'|'secondary'|'alevel'|'all'], isCompulsory, color, order, description}`.
- RBAC: write routes gated by `rbac('subjects', 'create'|'update'|'delete')`.

### New — `client/src/pages/subjects/SubjectsPage.jsx`

Premium **Subjects & Departments** page accessible at `/subjects`.

- **Department cards** — each department rendered as a collapsible card showing name, code, HoD name, subject count, and colour badge. Expand/collapse the subject list per department.
- **Subject rows** — within each card, subjects listed with colour dot, code, short name, compulsory badge, and section pills (KG / Primary / Secondary / A-Level / All).
- **Add/Edit Department slide-over** — full form: name, code, sort order, colour picker (10 presets + custom), HoD name field, description.
- **Add/Edit Subject slide-over** — full form: name, code, short name, department selector, section multi-toggle buttons, compulsory toggle, colour picker, sort order, description.
- **Deactivate dialogs** — confirm before soft-deleting; department deletion warns about active subjects first.
- **Search** — filters both department names/codes and subject names/codes simultaneously.
- **Stats strip** — Departments / Subjects / Compulsory counts at a glance.
- **RBAC guard** — edit controls (add/edit/delete buttons) shown only to `admin`, `deputy`, `superadmin`.
- Toasts for save success / errors.

### Updated — Demo seed (`server/utils/seedSchool.js`)

- **9 departments** seeded with HoD names, colours, descriptions:  
  Mathematics, English Language & Literature, Sciences, Humanities & Social Sciences, Modern Foreign Languages, ICT & Computing, Creatives, Physical Education, Religious Studies.
- **24 subjects** seeded across all departments with correct `departmentId`, `sections`, `isCompulsory`, `color`:  
  Maths, Pure Maths, Statistics, Mechanics — English Language, English Literature — Science (general), Biology, Chemistry, Physics — Social Studies, History, Geography, Economics — Kiswahili, French, Spanish — ICT, Computer Science — Art & Design, Music, Drama — PE — CRE.
- Original 6 subject IDs preserved (grades, exams, timetable references unbroken).

### Updated — Route mounting, API client, Sidebar, Router, Indexes

- `server/index.js` — mounts `/api/departments` and `/api/subjects`.
- `client/src/api/client.js` — exports `departments` and `subjects` API modules.
- `client/src/components/layout/Sidebar.jsx` — **Subjects** link (Library icon) added under Academic section.
- `client/src/App.jsx` — lazy route `/subjects → SubjectsPage`.
- `server/utils/indexes.js` — compound indexes for `departments` (`schoolId+code` unique, `schoolId+order`) and `subjects` (`schoolId+code` unique, `schoolId+departmentId+order`, `schoolId+sections`).

---

## [4.9.18] — 2026-05-20  Role-Contextual Help Guide

### New — `client/src/components/RoleGuide.jsx`

A collapsible **"What can I see?"** help panel that appears at the bottom of every portal page. It reads the current user's role from the auth store and displays role-specific guidance — teachers, parents, section heads, admins, timetablers, and students each get a distinct card explaining exactly what they can access and do.

- **Role detection** — inspects `role` + `roles[]` from JWT; priority order: parent/guardian → section_head → teacher → timetabler → deputy → admin → student.
- **Collapsed by default** — a thin strip ("What can I see? [Role badge]") with a chevron toggle; expands with a smooth animation.
- **Per-role content**:
  - *Teacher* — weekly schedule, period times, class assignments, print instructions.
  - *Parent/Guardian* — child-switcher tabs, each child's subjects/teacher/room, per-child PDF print, linking help.
  - *Section Head* — section-wide overview, class filter, teacher/room visibility, print options.
  - *Admin/Deputy/Timetabler* — full build/edit access, bell schedule config, conflict detection, publish/unpublish workflow.
  - *Student* — guidance that parent/guardian holds their view; how to request a printed copy.
- **Print-hidden** — the guide is excluded from timetable print output via `print:hidden`.
- **Footer nudge** — "Seeing something unexpected? Contact your school administrator to review your account role."
- Reusable across all portal pages; add `<RoleGuide />` to any page.

### Updated — `client/src/pages/timetable/TimetablePortal.jsx`

`<RoleGuide />` added at the bottom of every portal view (teacher, parent, section head).

---

## [4.9.17] — 2026-05-20  Timetable Publishing Portal — Per-Role Views, Print Support

### Feature — Publish/Unpublish Workflow

Admins and timetablers now control timetable visibility with a **Draft → Published** workflow. Until published, portal users (teachers, parents, section heads) see a "not yet published" message.

- **`POST /api/timetable/publish`** — marks the school's timetable as published; accepts optional `termLabel` (e.g. "Term 1, 2026") shown on the portal and print headers.
- **`POST /api/timetable/unpublish`** — reverts to draft.
- **`GET /api/timetable/status`** — returns `{ published, publishedAt, publishedBy, termLabel }`.
- Publish state stored on the `schools` document under `timetableStatus` — no new collection required.
- Admin/timetabler/deputy bypass the published gate; all other roles only see data when published.

### Feature — Per-Role Timetable Portal

**`GET /api/timetable/my`** (teacher / section head):
- Teacher → resolves teacher record by email match, returns their assigned slots.
- Section head → reads `sectionAssigned` from user document; returns all slots in that section (or all sections if not set).

**`GET /api/timetable/my-children`** (parent / guardian):
- Reads `guardianOf: [studentId...]` from JWT; fetches each linked student and their class timetable.
- Returns `{ children: [{ student, slots }], termLabel }`.

### New — `client/src/pages/timetable/TimetablePortal.jsx`

Role-dispatched read-only portal:
- **Teacher view** — weekly grid of their lessons; per-day lesson count chips; linked teacher name header.
- **Parent view** — child-switcher tabs (one per `guardianOf` child); each child's class timetable with class name shown. Seamlessly switch between children from the same account.
- **Section head view** — class filter tabs + summary stats (classes, lessons, teachers, rooms); full grid of all slots in their section.
- All views: deterministic subject colour palette, `startTime`/`endTime` shown on each period row.
- **Print button** — calls `window.print()`. Print-safe layout: nav/sidebar hidden, grid rendered cleanly in A4 landscape.
- "Not yet published" lock screen shown when timetable is still draft.

### Updated — `client/src/pages/timetable/TimetablePage.jsx`

- **Role gate at top** — non-admin roles (`teacher`, `parent`, `guardian`, `section_head`, `student`) are immediately redirected to `<TimetablePortal />`.
- **Publish banner** — amber strip (Draft) or green strip (Published) below the page header; "Publish Timetable" opens a modal to enter a term label; "Unpublish" button with confirm dialog.
- `timetabler` role added to `canEdit` set.

### Updated — `server/routes/settings.js` — User Management

- `PUT /api/settings/users/:id` now accepts:
  - `sectionAssigned` — which section (`kg|primary|secondary|alevel|all`) a section head oversees.
  - `guardianOf` — array of student IDs for parent/guardian accounts.
  - `timetabler` and `section_head` added to the allowed roles list.

### Updated — `client/src/api/client.js`

Added to `timetable`: `status()`, `publish(data)`, `unpublish()`, `my()`, `myChildren()`.

### Updated — `client/src/index.css`

Print stylesheet (`@media print`): hides shell chrome (nav, sidebar, buttons with `print:hidden`), sets A4 landscape page, enables colour printing for timetable cells.

---

## [4.9.16] — 2026-05-20  Per-Section Bell Schedules + Cross-Section Conflict Detection

### Architecture — Multi-Section Bell Schedule Support

Schools running KG through A-Level on the same system now maintain **independent bell schedules per section** while remaining fully connected for teacher assignments and conflict detection.

**Problem solved:** Period key "1" in KG (07:30–08:00) and Period "1" in Secondary (08:00–09:20) are entirely different time windows. A teacher assigned to both would not be caught by naive `day + period` key matching. Msingi now stores and compares actual clock times, so a double-booking across sections is caught regardless of period numbering.

### New — `server/routes/bell-schedule.js` (rewritten)

- **Per-section documents:** one `bell_schedules` record per `(schoolId, section)` where section ∈ `all | kg | primary | secondary | alevel`.
- **Fallback chain:** section-specific → school `all` default → hardcoded `DEFAULT_BELL` constant. Never breaks a school that hasn't configured anything.
- **New endpoint `GET /api/bell-schedule/sections`** — returns all VALID_SECTIONS with `configured` flag, `periodCount`, and `lessonCount` for the admin overview tab badges.
- **`DELETE /api/bell-schedule?section=`** — reverts a section-specific schedule back to the school default (cannot delete `all`).
- **Named exports:** `router.resolveBellSchedule` and `router.DEFAULT_BELL` — used by `server/routes/timetable.js` to resolve times during slot creation.

### Updated — `server/routes/timetable.js`

**Time denormalisation at write time:**
- New helper `_inferSection(className)` — infers `kg | primary | secondary | alevel | all` from class name (regex patterns mirror frontend `inferSection()`).
- New helper `_resolveSlotTimes(schoolId, section, periodKey)` — fetches the correct bell schedule for the class's section and returns `{ startTime, endTime }` in HH:MM.
- On `POST /timetable` and `PUT /timetable/:id`: `section` and `startTime`/`endTime` are resolved and stored on every slot. Explicit caller-supplied times are honoured (future API flexibility).

**Time-overlap conflict detection:**
- New helper `_timesOverlap(start1, end1, start2, end2)` — HH:MM string comparison (no Date parsing needed). Returns true when two intervals overlap by any amount.
- `_checkConflicts` upgraded: teacher double-booking and room double-booking now use time-overlap when both slots have `startTime`, falling back to period-key equality for legacy slots without times.
- `GET /timetable/conflicts` upgraded to pairwise time-overlap within `teacherId|day` and `room|day` groups — catches cross-section double-bookings.

### Updated — `server/utils/indexes.js`

- `bell_schedules`: changed `bs_school_default` index to `bs_school_section` with `unique: true` — one schedule per `(schoolId, section)`.
- `timetable`: replaced period-based teacher/room indexes (`tt_teacher_day_period`, `tt_room_day_period`) with time-based ones (`tt_teacher_day_time`, `tt_room_day_time`). Added `tt_school_section` sparse index for section-filtered queries.

### Updated — `client/src/api/client.js`

- `bellSchedule` extended: `sections()` → `GET /bell-schedule/sections`; `remove(section)` → `DELETE /bell-schedule?section=`.

### Updated — `client/src/pages/timetable/TimetablePage.jsx`

**Section-aware bell fetch:**
- Bell schedule query is now keyed by the selected class's inferred section (`classSection`), not a static `'all'` key. When the class changes, the grid automatically re-renders with the correct period rows and times.
- `lessonPeriods` derived from the active bell and passed into `AddSlotSlideOver` — period dropdown reflects real section times.

**`BellScheduleSlideOver` — full rewrite:**
- Five section tabs: School Default | KG | Primary | Secondary | A-Level.
- Active tab fetches its own schedule (`GET /api/bell-schedule?section=`); amber banner shown when a section inherits from school default.
- Green dot badge on tabs that have a custom schedule configured (`GET /api/bell-schedule/sections`).
- `dirty` flag: Save button only enabled after the user edits something.
- "Revert to default" button: appears only when the active section has a custom schedule; calls `DELETE` to remove it.
- No longer receives `periods` or `onSaved` props — component is self-contained.

---

## [4.9.15] — 2026-05-20  Settings API + Bell Schedule Configuration + Platform Audit Fixes

### New — `server/routes/settings.js`

**School Settings (`GET/PUT /api/settings/school`):**
- Returns and updates school profile: name, tagline, email, phone, address, website, country, currency, timezone, academicYear, termsPerYear, houses, logoUrl, primaryColor.
- RBAC: admin or superadmin role required for PUT.
- Allowlist of updatable fields prevents accidental overwrite of system fields (plan, slug, isActive, etc.).

**User Management (`GET/POST/PUT/DELETE /api/settings/users`):**
- `GET /api/settings/users` — lists all active users for the school (admin-only; strips passwordHash).
- `POST /api/settings/users/invite` — creates user with temp password, sends welcome email (non-fatal if email fails). Returns `{ user, tempPassword }` shown once to admin.
- `PUT /api/settings/users/:id` — updates name or role; superadmin guard on admin role assignment.
- `DELETE /api/settings/users/:id` — soft-delete (sets `isActive: false`); blocks self-deletion.

**Account Settings (`GET/PUT /api/settings`):**
- `GET /api/settings` — returns current user's profile (no passwordHash).
- `PUT /api/settings` — handles two distinct operations: name update or password change (requires currentPassword verification via bcrypt).

### New — `server/routes/bell-schedule.js`

- `GET /api/bell-schedule` — returns school's bell schedule; seeds the default 8-period schedule (07:30–17:00) on first access.
- `PUT /api/bell-schedule` — saves custom bell schedule; validated with Zod (period key, HH:MM times, label, isBreak).
- Plan gate: `bell_schedule` → `standard` plan or higher.
- Admin check on PUT.
- Default schedule: P1–P3, Short Break, P4–P5, Lunch, P6–P8 (10 rows, 8 lessons + 2 breaks).

### Updated — `server/index.js`
- Mounted `/api/settings` and `/api/bell-schedule` routes.

### Updated — `client/src/api/client.js`
- Added `bellSchedule` export: `get()` and `update(data)`.

### Updated — `client/src/pages/timetable/TimetablePage.jsx`
- **Bell schedule now served from DB** — `DEFAULT_BELL` constant is the fallback; on mount the page fetches `/api/bell-schedule` and uses the saved schedule instead.
- `TimetableGrid` accepts a `bell` prop (defaults to `DEFAULT_BELL`) — the live schedule is passed through.
- `AddSlotSlideOver` accepts `lessonPeriods` prop — period dropdown reflects the actual configured schedule.
- **Bell Schedule slide-over** — admins can open it via the new "Bell" button in the header; inline editor to set start time, end time, label for each row; add lesson or break rows; remove rows; save back to DB.

### Fixed — Platform Audit items (applied in v4.9.14, documented here)
- `package.json` version bumped from `4.2.0` to `4.9.14`.
- `server/middleware/auth.js` — standardised to `{ success: false, error: { code, message } }` envelope (was inconsistent bare `{ error: '...' }`).
- `server/utils/indexes.js` — fixed timetable indexes from nonexistent `dayOfWeek` field to correct `day` field; added bell_schedules indexes.
- `server/middleware/plan.js` — registered `bell_schedule`, `rooms`, `assessment` features; fail-closed gate for unknown feature keys (was fail-open, silent privilege escalation risk).
- `server/index.js` — health check version now reads from `package.json` (was hardcoded); SPA fallback replaced explicit 15-route allowlist with universal wildcard.

---

## [4.9.14] — 2026-05-20  Institutional Scheduling Engine — Timetable Phase 1

### Rebuilt — `server/routes/timetable.js`

**Global Conflict Detection Engine (institution-wide, not per-class):**
- **Teacher double-booking prevention** — POST and PUT now reject any slot where the assigned `teacherId` is already scheduled in another class at the same `day + period`. Cross-class enforcement, not just same-class.
- **Room double-booking prevention** — POST and PUT reject any slot where `room` is already occupied (case-insensitive match) at the same `day + period`.
- **Class collision check** preserved — same class + day + period still blocked as before.
- Conflict check extracted into `_checkConflicts(schoolId, data, excludeId)` helper — `excludeId` ensures PUT doesn't block updating a slot against itself.

**New endpoint — `GET /api/timetable/workload`:**
- Returns teacher workload summary: `teacherId`, `teacherName`, `total` lessons/week, `byDay` breakdown, `classCount`.
- Filtered by `academicYearId` / `termId` when provided. Capped at 10,000 slot scan. Sorted by total descending.

**New endpoint — `GET /api/timetable/conflicts`:**
- Scans all active slots institution-wide for teacher double-bookings and room double-bookings.
- Returns `{ conflicts: [...], count }` — each conflict includes type, affected resource, day, period, and slotIds.

**New endpoint — `GET /api/timetable/overview`:**
- Returns per-class lesson counts grouped by day for the master grid.
- Returns `{ classes: [{ classId, total, byDay }], totalSlots }`.

**Bug fixes:**
- `GET /class/:classId` and `GET /teacher/:teacherId` now return a plain slots array (was returning `{ slots, byDay }` object — caused frontend `forEach` TypeError).
- Route ordering fixed: `/workload`, `/conflicts`, `/overview` placed before `/:id` wildcard to prevent mis-routing.
- Added `teacherName` to `SlotSchema` (denormalised display string stored alongside `teacherId`).
- `subject` field added to schema as optional string (previously only `subjectId` existed).

### Rebuilt — `client/src/pages/timetable/TimetablePage.jsx`

**Three views replacing the single class grid:**
- **Class Grid** (default) — true period-row × day-column layout with a 88px time label column, period times (`P1 07:30–08:30`), break rows, and 5 day columns.
- **Teacher Schedule** — same grid filtered to a selected teacher's assignments; shows weekly lesson count + per-day distribution in the toolbar.
- **Institution Overview** — compact table: all classes as rows, Mon–Fri + Total as columns; shows lesson count per day per class.

**True timetable grid (Class Grid + Teacher View):**
- Period times hardcoded from default bell schedule (P1–P8 + Short Break + Lunch).
- Each cell shows subject, teacher name, and room; hover reveals Trash2 delete (admin/deputy only).
- Empty cells show a dashed Add button on hover (RBAC-gated) — pre-fills the slide-over with that day + period.

**Teacher Workload Panel:**
- Collapsible right sidebar (framer-motion slide-in) triggered by `Workload` button in header.
- Bar chart per teacher: green (normal 11–29), amber (light ≤10), red (heavy ≥30).
- Legend at panel footer; skeleton loaders while fetching.

**Global Conflicts Badge:**
- Always-on badge in header: green "No conflicts" or red "N conflicts".
- Clicking the red badge opens a conflicts panel listing each issue (type, teacher/room, day, period).
- Resolves automatically as slots are fixed.

**Add Slot Slide-over (upgraded):**
- Teacher field is now a **dropdown** populated from the real teachers list (sends `teacherId` + `teacherName` to API — enables conflict detection).
- Day/period pre-filled when clicking an empty cell.
- Server-side conflict errors (409) surfaced inline with `AlertTriangle`.
- Slot type selector (lesson / assembly / registration / free period).

**Section filtering:**
- Section pills in toolbar (All Sections / Kindergarten / Primary / Secondary / A-Level / Other).
- Class names inferred into sections via `inferSection()` regex — no DB change needed.
- Selecting a section filters the class picker; switching section resets class selection.

**Bug fixes:**
- Frontend now sends lowercase day values (`'monday'`) matching the backend `z.enum` — Add Slot was broken in v4.9.13.
- Slot data accessed as `data?.data` array (fixed the object/array mismatch from `byClass` response change above).
- `teachers as teachersApi` import added for dropdown.

### Updated — `client/src/api/client.js`
- Added `byTeacher(id, params)`, `workload(params)`, `conflicts(params)`, `overview(params)` to the `timetable` export.

---

## [4.9.13] — 2026-05-19  Premium UI Overhaul: Settings + Timetable

### Rebuilt — `client/src/pages/settings/SettingsPage.jsx`
- **Tabs** — replaced plain text with lucide icons (Building2 / Users / User); RBAC hides Users tab for non-admin roles
- **Removed old dependencies** — PageSpinner, Spinner, ErrorState, clsx, card/btn-primary/form-input/form-label/data-table classes
- **School tab additions** — currency dropdown (10 currencies), timezone selector (10 zones), academic year label, terms per year, tagline field, country field; all saved to `PUT /settings/school`
- **Houses section** — built into School tab: add houses with name + colour picker (8 swatches + `<input type="color">`), remove with X; saves to `school.houses` array (same key used by Behaviour leaderboard and Student Profile dropdown — completes the full houses data flow)
- **Users tab** — role pills per user (colour-coded by role), invite slide-over (name/email/role, `POST /settings/users/invite`), RBAC-gated Trash2 remove with hover-reveal, skeleton loaders
- **Account tab** — `alert()` removed → inline password mismatch/length error; show/hide password toggle (Eye/EyeOff); save button disabled when name is unchanged; toast on all mutation outcomes

### Rebuilt — `client/src/pages/timetable/TimetablePage.jsx`
- **Removed old dependencies** — PageSpinner, EmptyState, ErrorState, emoji `🗓`, card/form-select/bg-brand-* classes
- **Premium 5-day grid** — deterministic subject colour coding (8 colour pairs), period number + room in each slot card, teacher name truncated
- **Add Slot slide-over** — day/period/subject/teacher/room fields, `POST /timetable` on submit; RBAC-gated (admin/deputy/can('timetable'))
- **Inline remove** — Trash2 button hover-reveals on each slot (admin/deputy only); `DELETE /timetable/:id`
- **Quick-add button** — dashed "Add" row at the bottom of each day column
- **Page header** — shows lesson count + active days when class is selected
- **framer-motion** slot entry animations, toast feedback on add/remove errors

---

## [4.9.12] — 2026-05-19  Premium UI Overhaul: Grades & Assessment

### Rebuilt — `client/src/pages/grades/GradesPage.jsx`
- **Replaced emoji tabs** with lucide-react icons (PenLine / FileText / Settings2 / Bell)
- **Removed all old dependencies** — PageSpinner, Spinner, EmptyState, ErrorState, Badge, clsx all eliminated; inline Tailwind patterns throughout
- **React Query v5 compatibility fixes**:
  - `onSuccess` callback in `useQuery` (deprecated v5) → `useEffect` with data dependency
  - `isLoading` on `useMutation` → `isPending`
  - `qc.invalidateQueries(['key'])` array form → `{ queryKey: ['key'] }` object form
- **Mark Entry tab** — live class stats bar (avg / pass rate / highest / lowest), animated toast replaces `alert()`; marks only submitted for students with entered scores
- **Report Cards tab** — student names resolved from `studentsList` (no longer shows raw MongoDB IDs); weight legend as inline TypePill chips; half-term toggle preserved
- **Configuration tab** — lucide icons in template selector cards; schedule rows use Trash2 icon; animated toast on save/error
- **Reminders tab** — lucide status icons per reminder type (AlertTriangle / CheckCircle2 / Calendar), overdue/open/upcoming summary counts in header
- **All tabs** — framer-motion AnimatePresence tab transitions, skeleton loaders instead of spinners
- **Tab visibility guard** — `useEffect` resets active tab when user's role loses access to it

---

## [4.9.11] — 2026-05-19  Premium UI Overhaul: Behaviour BPS + Student Profile

### Added — Behaviour Point System (`client/src/pages/behaviour/BehaviourPage.jsx`, `bpsConstants.js`)
- **BPS matrix** — 8 categories, 80+ behaviour items with locked point values; staff cannot override points
- **4-step award wizard** — Student search → Merit/Demerit toggle → Category + item select → Confirm
- **Serious infraction enforcement** — mandatory note (min 10 chars) when |pts| ≥ 5
- **Stage preview** — shows intervention stage trigger before submission
- **Milestone preview** — shows merit milestone unlock before submission
- **Intervention stages** — 5 thresholds (5/10/20/35/50 demerit pts, 90-day rolling window): Monitor → Caution → Intervention → Formal Support → Senior Review
- **Merit milestones** — Bronze(25) → Silver(50) → Gold(100) → Principal's Award(200) → Platinum(300), all-time cumulative
- **Appeals tab** — list pending appeals, resolve with outcome and note; admin-only
- **Houses tab** — settings-based house configuration (name + color picker), house leaderboard computed from student incident data (merits, demerits, net, member count), medal ranking

### Added — `bpsConstants.js`
- `MATRIX`, `STAGES`, `MILESTONES` constants (locked, school-agnostic)
- Helpers: `meritTotal`, `demeritTotal`, `studentStage`, `studentMilestone`, `isSerious`
- Exported for reuse in StudentProfile and future report cards

### Rebuilt — Student Profile (`client/src/pages/students/StudentProfile.jsx`)
- **Replaced emoji tabs** with lucide-react icons (User/CalendarCheck/Receipt/Scale/GraduationCap)
- **Removed old dependencies** — PageSpinner, ErrorState, Badge, clsx all removed; inline patterns
- **Attendance tab** — rate progress bar with colour coding, per-status count cards, threshold warning (<75% pastoral flag)
- **Finance tab** — outstanding/total-billed/total-paid summary strip; currency from `session.school.currency` (not hardcoded)
- **Behaviour tab** — full BPS integration: demerit stage card, merit milestone card, progress bars to next stage/milestone, full incident log with type icons
- **Grades tab** — overall average card with progress bar, subject table with % colours
- **Overview edit mode** — house dropdown populated from school settings houses array (completes houses end-to-end: configure in Behaviour → assign in Student Profile → leaderboard in Behaviour Houses tab)
- No `alert()`, no hardcoded currency, RBAC-gated Edit button, framer-motion tab transitions

---

## [4.9.10] — 2026-05-19  Stability Hardening: Login Plan Bug, Query Limits, Session Fix

### Fixed — Critical: Plan badge always showing "core" in UI (`client/src/pages/Login.jsx`, `store/auth.js`, `components/layout/TopBar.jsx`)
- Root cause: all four login paths (`handleLogin`, `handleQuickLogin`, `handleOtp`, `handleChangePassword`) called `setSession({ token, user })` without including `school: res.school`. The `auth.js` store getter read `session?.user?.plan` — plan is on the school doc, not the user doc, so it always returned `undefined` and fell back to `'core'`
- Fix: all four `setSession` calls now pass `school: res.school`
- Fix: `auth.js` plan getter now reads `session?.school?.plan ?? session?.user?.plan ?? 'core'` (school first)
- Fix: `TopBar.jsx` plan display updated with same dual-source pattern

### Fixed — UI: Login page left panel too wide
- Changed from `lg:w-1/2 xl:w-3/5` (up to 60% at xl) to `lg:w-5/12` (41.7% fixed)
- Also reduced padding from `p-12` to `p-10` to give the form panel more breathing room

### Fixed — Stability: Unbounded database queries (memory safety)
- **`server/routes/platform.js`** — `School.find({})` for dashboard list now uses field projection (only loads slug, name, plan, status, etc. — not logoUrl, email templates, branding blobs). `School.find({})` for stats now projects only `plan, isActive`. Announcements list capped at 200.
- **`server/routes/assessment.js`** — All `assessment_marks.find()` queries capped (5,000 for marks list, 10,000 for report generation). `assessment_schedule.find()` capped at 200. `users.find({ role: 'teacher' })` capped at 200.
- **`server/routes/behaviour.js`** — `behaviour_categories.find()` capped at 200.
- **`server/routes/timetable.js`** — Class timetable and teacher timetable views capped at 200 slots (5 days × 10 periods = 50 slots max in practice).
- **Context**: `parsePagination()` in `server/utils/response.js` already enforced `Math.min(200, ...)` on all main list endpoints (students, teachers, finance, attendance, etc.). These fixes close the remaining unbounded paths in lookup and aggregation routes.

### Fixed — Visibility: Unhandled Promise rejections in startup (v4.9.9 carry-forward)
- `repairPermissions()` and `seedDemo()` in `server/index.js` now have `.catch(err => console.error(...))` — previously silent failures were invisible in Render logs

---

## [4.9.9] — 2026-05-19  Demo School Enterprise Plan + Realistic Seed Data

### Changed — Demo School Always Forced to Enterprise Plan (`server/scripts/seed-demo.js`)
- Demo school plan field set via `$set` (not `$setOnInsert`) — guarantees `plan: 'enterprise'` is applied on every server restart, even if the school document pre-existed with a lower plan
- `invalidatePlanCache(schoolId)` called immediately after upsert to clear the 5-minute TTL in-memory cache, so the enterprise plan takes effect the moment the server starts
- Wrapped in `try/catch` — `plan` middleware may not be loaded yet on very first boot; harmless

### Added — Student Role in Demo User Set (`server/scripts/seed-demo.js`)
- Added `u_demo_student` user (`student@demo.msingi.io` / `Demo2025!`, role: `student`)
- Student permissions seeded in `role_permissions`: read-only access to students, classes, attendance, finance, behaviour, exams, grades, timetable, assessment, report_cards; messaging with read+create+update

### Added — Comprehensive Realistic Demo Seed Data (`server/scripts/seed-demo-data.js`)
- New script called by `seed-demo.js` after core provisioning
- **Isolation guarantee**: all records hardcoded to `schoolId: 'sch_demo'` — no other school is ever touched
- **Idempotent pattern**: every record uses `$setOnInsert` — safe to run on every server restart, never overwrites manually edited demo data
- Data seeded:
  - **7 classes**: Grade 1–4 (Primary), Form 1–3 (Secondary)
  - **14 subjects**: Mathematics, English, Science, Kiswahili, Social Studies, CRE, Art, PE (Primary); additional secondary subjects
  - **9 additional teachers** with realistic Kenyan names, profiles, and subject assignments
  - **20 students** with full profiles: names, DOB, gender, guardian contacts, class assignments, enrolment dates, medical notes
  - **25 behaviour incidents**: mix of minor/moderate/serious with statuses (open, resolved, closed), school-appropriate descriptions
  - **60 timetable slots**: complete weekly grid across all 7 classes, Mon–Fri, periods 1–8
  - **20 invoices + 14 payments**: tuition/activity/transport fees, mix of paid/partial/pending/overdue
  - **8 admissions records**: spread across enquiry → applied → shortlisted → offered → enrolled stages

### Changed — `server/index.js`
- Version bumped to `4.9.9`
- `seedDemo()` fires non-blocking after HTTP server starts listening (fire-and-forget)

### Added — Developer Tooling: Pre-Implementation Documentation Skill
- `.claude/commands/check-docs.md` — Claude Code slash command (`/check-docs`) that mandates a 6-step protocol before any implementation: read CHANGELOG, read DEVELOPER_GUIDE, read relevant user docs, declare what exists vs. what's missing, implement with zero regression, update all docs after changes
- Includes collection name reference table for all 20+ known collections

---

## [4.9.8] — 2026-05-19  Plans Comparison Page + Contact Pre-Fill

### Added — Plans Comparison Page (`client/src/pages/Plans.jsx`)
- New public-facing `/plans` route — no authentication required
- Fixed navbar (same pattern as Landing/Contact) with Plans link highlighted
- **4 plan cards**: Core, Standard, Premium (highlighted as "Most popular"), Enterprise
- **Full feature comparison table** with 5 feature groups sourced directly from `server/middleware/plan.js` FEATURE_PLAN map:
  - Core Features (attendance, students, classes, timetable, messages)
  - Academic (exams, grades/assessment, report cards)
  - Admissions & HR (admissions pipeline, teacher management)
  - Finance (invoicing, payments, reports)
  - Enterprise (analytics, API access, custom branding, priority support)
- `Cell` component renders check (✓) or dash (–) per plan
- CTA buttons at bottom of each plan column: `navigate('/contact?plan=<planKey>')`
- "Not sure?" bottom section with contact link

### Changed — Contact Page (`client/src/pages/Contact.jsx`)
- `useSearchParams` reads `?plan=` query parameter from URL
- `PLAN_INQUIRY_MAP` maps `core/standard/premium/enterprise` → inquiry type string
- Form pre-fills `inquiry` dropdown and `message` field when plan is specified in URL
- Enables one-click plan selection from the Plans page directly into the contact form

### Changed — `client/src/App.jsx`
- Added `import Plans from '@/pages/Plans.jsx'`
- Added route `{ path: '/plans', element: <Plans /> }`

### Changed — Landing.jsx + Contact.jsx navbars
- Added `Plans` link in fixed navbar on both Landing and Contact pages

---

## [4.9.7] — 2026-05-19  Demo School URL + Quick Login Panel

### Changed — "Explore the Platform" CTA targets `demo.msingi.io` (`client/src/pages/Landing.jsx`)
- Hero CTA and final section CTA both now call `goToSchool('demo')` — previously pointed to `innolearn` slug
- Demo school is the canonical hands-on trial environment for all visitors

### Added — Quick Login Panel on Demo Login Page (`client/src/pages/Login.jsx`)
- `DEMO_ACCOUNTS` array defines all 6 roles with email, display color, background color, and badge text
- `DemoPanel` component renders colored role cards — one per role (Admin, Deputy Principal, Teacher, Finance Officer, Parent, Student)
- Click any card calls `handleQuickLogin(email, password)` which auto-fills credentials and submits the login form
- Panel only renders when `slug === 'demo'`
- Left panel of login page shows role list for demo slug instead of generic tagline
- All demo credentials: `Demo2025!` password, `isActive: true`, `mustChangePassword: false`

---

## [4.9.6] — 2026-05-19  Public Page UI Polish (Fixed Navbar, WhatsApp FAB, Hash Fix)

### Fixed — Navbar scrolls away on Landing and Contact pages
- Root cause: `overflow-x-hidden` on parent element breaks `position: sticky` in Chrome/Safari
- Fix: both navbars changed from `sticky top-0` to `fixed top-0 left-0 right-0 w-full z-50`
- `<div className="h-16" />` spacer added immediately after each navbar to compensate for the fixed position removing the element from document flow

### Fixed — WhatsApp FAB shape and persistence
- Previously: expanding pill on hover (`rounded-full` with hover-expand text label)
- Now: permanent `w-12 h-12 rounded-full bg-[#25D366]` circle with phone icon — never changes shape
- FAB is fixed at `bottom-6 right-6` on every public page scroll position — never disappears

### Fixed — `#modules` hash appearing in URL bar when clicking Modules nav link
- Root cause: `<a href="#modules">` adds the hash to the URL on click
- Fix: replaced with `<button onClick={() => document.getElementById('modules')?.scrollIntoView({ behavior: 'smooth' })}>`  — smooth scrolls without touching URL

### Changed — Contact page (`client/src/pages/Contact.jsx`)
- Removed "Direct Contact" card section (Email us / WhatsApp us cards)
- Removed "Or chat on WhatsApp" inline link from form submission row
- Added scroll-to-top button (appears after scrolling 200px) alongside WhatsApp FAB
- Both FABs rendered in a `fixed bottom-6 right-6 flex flex-col gap-3` container

---

## [4.9.5] — 2026-05-19  Social Icons + Landing Navbar Cleanup

### Added — Social Icons in Public Page Footers
- Inline SVG components added to `Landing.jsx` and `Contact.jsx`: `XIcon`, `LinkedInIcon`, `FacebookIcon`, `InstagramIcon`, `YouTubeIcon`
- `SocialLinks` component renders only links the platform admin has configured (filters empty/null URLs)
- `getPlatformSettings()` API call in `useEffect` populates `socialLinks` state on both pages
- `<SocialLinks links={socialLinks} />` rendered in footer of both Landing and Contact pages

### Removed — "Sign In" button from Landing page navbar
- Button removed from `Landing.jsx` navbar entirely — schools sign in via their dedicated `{slug}.msingi.io` URL
- Prevents confusion between marketing site navigation and school portal authentication

---

## [4.9.1] — 2026-05-19  Critical Security & Integrity Fixes (Platform Audit)

### Fixed — Critical: RBAC Permission Format Mismatch (`server/routes/onboard.js`)
- `_defaultPerms()` was seeding the legacy object format `{ view: true, edit: true }` but `middleware/rbac.js` expects the array format `{ students: ['read', 'create', 'update'] }`. This caused **100% of non-admin role users on every onboarded school to get 403 on every route**.
- All role permission maps rewritten to array format matching the RBAC middleware contract
- `superadmin` permissions now use `ALL_MODULES` array instead of `{ _all: { view: true } }`
- Added `scripts/repair-permissions.js` — run once to fix all existing schools: `node scripts/repair-permissions.js`

### Fixed — Critical: PDF Endpoint `ReferenceError: userId is not defined` (`server/routes/report-cards.js`)
- `GET /:id/pdf` destructured `{ schoolId, role, guardianOf }` from `req.jwtUser` but used `userId` in the guardian audit log write — `ReferenceError` on every PDF request from a parent/guardian
- Added `userId` to destructured fields

### Fixed — Critical: `sync.js` Security Hardening
- `GET /api/sync` restricted to `superadmin`/`admin` roles only (previously open to any authenticated role — teachers, students, parents could download the full school DB including password hashes)
- Sensitive fields (`password`, `mfaOtp`, `mfaExpiry`, `tempPassword`) stripped from all sync output
- `users` and `audit_log` collections excluded from export
- `POST /api/sync` disabled (returns `HTTP 410 Gone`) — the write path accepted arbitrary unvalidated data to any collection including `users`, enabling role escalation
- Now redirects to `/api/import-export` for structured validated imports

### Added — High: 9 Missing Database Indexes (`server/utils/indexes.js`)
- `users(schoolId, email)` — **critical**: login hot path queried on every authentication
- `teachers(schoolId, status)`
- `messages(schoolId, recipientId, createdAt)`, `messages(schoolId, senderId, createdAt)`
- `behaviour_incidents(schoolId, studentId, date)`
- `admissions(schoolId, stage, createdAt)`
- `timetable(schoolId, classId, dayOfWeek, period)`
- `invoices(schoolId, studentId, status)`, `invoices(schoolId, status, dueDate)`
- `payments(schoolId, invoiceId)`

### Fixed — Medium: Behaviour Appeal Outcome Logic (`server/routes/behaviour.js`)
- Both `'overturned'` and `'upheld'` outcomes mapped to `'resolved'` (dead ternary — both branches returned the same value)
- Now correctly: `'overturned'` → incident status `'overturned'`; `'upheld'` → `'closed'`
- Also writes `appealOutcome` field to incident for full audit trail

---

## [4.9.0] — 2026-05-19  Plan Gating Fix + Bulk Import/Export

### Fixed — Plan Gating (`server/middleware/plan.js`)
- **`admissions` moved from `premium` → `core`**: Every school on any plan can now use the full Admissions pipeline (enquiry → interview → offer → enrolled). Previously core/standard schools were locked out, preventing basic student intake.
- Comment header updated: InnoLearn → Msingi

### Added — Bulk Import & Export (`server/routes/import-export.js`)
- New route mounted at `/api/import-export` (no new npm packages — zero-dependency CSV parser)
- `GET /api/import-export/template/:type` — Download a demo CSV template with example rows and column instructions (opens directly in Excel/Google Sheets)
- `POST /api/import-export/:type` — Import from CSV (`Content-Type: text/csv`) or JSON (`{ rows: [...] }`). Row-level validation with per-row error reporting. Class names resolved to IDs automatically. Max 500 rows per batch.
- `GET /api/import-export/export/:type` — Export all school records as a timestamped downloadable CSV

**Supported types:**
- `students` — firstName, lastName, dateOfBirth, gender, className (resolved), parentName/Email/Phone, address, enrollmentDate, status, medicalNotes
- `teachers` — firstName, lastName, email, phone, dateOfBirth, gender, title, qualifications, joinDate, contractType, status
- `classes` — export only (name, section, keyStage, capacity, status)

**Import features:**
- Admission/staff numbers auto-generated (not required in CSV)
- Comment rows starting with `#` skipped
- Class name → classId resolution with clear error if class not found
- Duplicate email detection for teachers (within-batch and against existing records)
- Partial success (HTTP 207) with row/field-level error table
- BOM prefix on all CSV output for Excel compatibility

### Added — Import/Export UI (`client/src/pages/import-export/ImportExportPage.jsx`)
- New `/import-export` route in App.jsx
- Sidebar: `🔄 Import & Export` link added under System section
- Per-entity card with: download template button, export button, drag-and-drop CSV upload zone, row preview, import button, results summary with error table
- Classes export-only card (class creation is done in-app, but list can be exported for reference in student CSV)
- `client/src/api/client.js` — `importExport` module added: `importCSV()`, `exportCSV()`, `downloadTemplate()`

### Fixed — `server/index.js`
- `/api/import-export` route registered

---

## [4.8.2] — 2026-05-18  Hotfix: DB name regression + onboard.html rebrand

---

## [4.7.0] — 2026-05-18  Platform Rebrand + Dedicated School URLs + Full Assessment System

### Platform Rebrand — InnoLearn → Msingi
- Platform renamed to **Msingi** with domain **msingi.io**
- Updated all frontend branding: logo initials `MS`, nav header, footer copyright
- `schoolDetect.js` MAIN_HOSTS updated to `msingi.io`, `www.msingi.io`, `app.msingi.io`
- Landing page URL example updated: `your-school.msingi.io`
- Demo school slug buttons updated to `.msingi.io`

### Dedicated School URLs — `{slug}.msingi.io`
- Each school gets its own branded subdomain (e.g. `greenwood.msingi.io`)
- **`client/src/utils/schoolDetect.js`** (new) — Priority chain: subdomain → `?school=` param → localStorage → main domain. Exports `detectSchool()`, `schoolPortalUrl()`, `storeSchoolSlug()`, `clearStoredSchoolSlug()`
- **`client/src/pages/Landing.jsx`** (new) — Marketing page shown on main domain: hero, "Find your school" search, features grid, demo role cards, URL example
- **`client/src/pages/Login.jsx`** — Complete rewrite: dynamically branded with school logo, colours and name fetched from public API. Three modes: LOGIN → OTP → CHANGE_PASSWORD
- **`server/routes/public.js`** (new) — No-auth `GET /api/public/school-info` returns school branding for login page; `GET /api/public/ping` health check
- **`server/middleware/tenant.js`** — `_findSchool()` now returns `name`, `shortName`, `logoUrl`, `primaryColor`, `accentColor`, `systemEmail`
- `server/index.js` — Mounts `/api/public` before auth middleware
- Approval welcome email now includes the school's dedicated URL with bookmark callout
- Cloudflare DNS: `A @→216.24.57.1`, `CNAME www→render`, `CNAME *→render` (all DNS only)
- Render custom domains: `msingi.io`, `www.msingi.io`, `*.msingi.io` for wildcard SSL

### Per-School System Email
- Platform SMTP: `innolearnnetwork@gmail.com` (fixed, single account)
- Each school configures `systemEmail` — used as `Reply-To` on all school-level emails
- School emails sent as `"SchoolName via Msingi" <innolearnnetwork@gmail.com>`
- Platform emails sent as `"Msingi Platform" <innolearnnetwork@gmail.com>`
- **`server/utils/email.js`** refactored: `_send()`, `_sendAsSchool()`, `_wrap(schoolName)` helpers
- All school-level functions now accept `schoolEmail` param: `sendLoginOTP`, `sendWelcomeCredentials`, `sendPasswordExpirySoon`, `sendPasswordChanged`, `sendRoleChanged`, `sendMessageNotification`
- New: `sendAssessmentReminder()` — email + in-app notification for upcoming/open/overdue assessments
- `PATCH /api/academic-config/school-profile` — admin can set `systemEmail`, `primaryColor`, `accentColor`, `logoUrl` etc.

### RBAC & Messages Bug Fixes
- **`server/routes/messages.js`** — Fixed `req.user` → `req.jwtUser` in 4 places (was crashing with 500)
- **`server/middleware/rbac.js`** — Fixed field name mismatch: `{ schoolId, role }` → `{ schoolId, roleKey: role }` (was returning 403 for all non-admin roles)
- **`scripts/seed-role-permissions.js`** (new) — One-off migration seeds default permissions for all 11 roles across all existing schools
- `server/routes/platform.js` — `_seedBaseData` expanded to seed all 11 roles with `upsert: true` for new schools

### Assessment & Grading System (CA / HW / MT / ET)
#### Backend
- **`server/utils/grade-calc.js`** (new) — Single source of truth for all assessment calculations:
  - `validateWeights(weights)` — enforces sum = 100%
  - `aggregateMarks(marks)` — averages multiple instances (CA1+CA2→avg)
  - `computeTermTotal(typeAvgs, weights)` — weighted total; normalises to present types
  - `computeHalfTermTotal(typeAvgs, weights)` — CA+HW+MT only, re-scaled to 100%
  - `computeTerm1Grade()`, `computeTerm2Grade()`, `computeTerm3Grade()` — term final grades with ET running average blending
  - `computeSummaryAverage()` — Template B equal-thirds annual average
  - `buildSubjectReport()` — full multi-term report for one student/subject
- **`server/routes/assessment.js`** (new) — Full REST API:
  - `GET/PATCH /api/assessment/config` — weights (validated ≠ 100% blocked), template, instances
  - `GET/PUT/DELETE /api/assessment/schedule` — date ranges per assessment per term
  - `GET /api/assessment/marks` — list marks with filters
  - `POST /api/assessment/marks` — enter/upsert single mark (teacher permission check for MT/ET)
  - `POST /api/assessment/marks/bulk` — class-wide bulk entry
  - `DELETE /api/assessment/marks/:id`
  - `GET /api/assessment/marks/summary` — class completion grid
  - `GET /api/assessment/report` — full computed report card (single student or whole class)
  - `GET /api/assessment/reminders` — upcoming/open/overdue assessments (14-day window)
  - `POST /api/assessment/reminders/notify` — trigger email + in-app notifications to all teachers

#### Assessment Logic
- Default weights: CA=20%, HW=10%, MT=30%, ET=40% (must total 100%)
- All marks entered out of 100 — system handles weighting entirely in background
- Multiple CA/HW instances averaged before weight applied (CA1+CA2÷2 → ×20%)
- **Half-term report**: CA+HW+MT re-scaled to 100% (CA→33.3%, HW→16.7%, MT→50%)
- **Term 1 Final** = weighted total (CA×20 + HW×10 + MT×30 + ET×40)
- **Term 2 Final** = (Term2Total + avg(ET1,ET2)) / 2
- **Term 3 Final** = (Term3Total + avg(ET1,ET2,ET3)) / 2
- Teachers restricted from entering MT/ET unless admin enables `teacherExamEntry` on config
- Two report templates: **A (Detailed)** per-term with ET reference columns; **B (Summary)** equal-weight term averages

#### Frontend
- **`client/src/pages/grades/GradesPage.jsx`** (new) — 4-tab interface:
  - **Mark Entry** — filter by class/subject/term/type/instance → student grid with score inputs → bulk save with live class stats (avg, pass rate, high/low)
  - **Report Cards** — Template A (detailed) or B (summary), half-term toggle, colour-coded scores
  - **Configuration** — weight inputs with live 100% validator, instance count, template selector, assessment schedule date ranges
  - **Reminders** — colour-coded overdue/open/upcoming cards; "Notify Teachers" button
- `client/src/api/client.js` — `assessment` module added (12 methods)
- `client/src/App.jsx` — `/grades` and `/grades/:tab` routes added
- `client/src/components/layout/Sidebar.jsx` — `📊 Grades & Assessment` nav item added
- `server/index.js` — `/platform-audit` added to SPA fallback

---

## [4.6.2] — 2026-05-17  Academic Reporting Engine — cross-cutting issue fixes

### Fixed — Shared utility: `server/utils/archival.js` (new)
- Extracted `_isYearArchived` into a shared utility, eliminating the DRY violation where identical code existed in both `grades.js` and `exams.js`
- `isYearArchived(schoolId, academicYearId)` — returns false on null/missing inputs without a DB call; queries with projection so only the `archivedAcademicYears` field is loaded
- `firstArchivedYear(schoolId, yearIds[])` — deduplicates and filters nulls before checking; short-circuits on first match; used by bulk endpoints

### Fixed — `server/routes/auth.js`: guardian link broken in JWT (critical)
- All parent and guardian users were receiving HTTP 403 on every report card access because `guardianOf` was never included in the JWT payload
- Introduced `_buildTokenPayload(user, schoolId)` — a single source of truth for JWT construction used by all three token issuance paths (password login, OTP verify, force-change)
- For `parent` and `guardian` roles, `guardianOf: user.guardianOf || []` is now included in the payload; absent for all other roles to keep tokens lean
- Non-array `guardianOf` values on the user document are safely coerced to `[]`
- `server/middleware/auth.js` comment updated to document the new field

### Fixed — `server/routes/academic-config.js`: `archivedAcademicYears` not visible to frontend
- `_mergeConfig()` now includes `archivedAcademicYears: []` in its output — `GET /api/academic-config` returns the full list of archived year IDs
- Frontend can now disable year-scoped UI controls (grade entry, exam results, new publish) for closed years without needing a separate API call
- `ConfigSchema` (Zod) explicitly excludes `archivedAcademicYears` from PUT body — the field is read-only via PUT; only `POST /archive-year` can write it

### Fixed — `server/routes/report-cards.js`: publish not blocked for archived years
- `POST /api/report-cards/publish` now checks `isYearArchived()` immediately after creating the batch anchor (Step 1b)
- If the year is archived, batch is marked `failed` with a descriptive reason and HTTP 400 is returned — no further work is done
- Closes the gap where `skipModerationCheck: true` could still publish new snapshots into a closed year

### Fixed — `server/routes/academic-config.js`: archive-year cascade atomicity
- The config write-blocking gate (`$addToSet: { archivedAcademicYears }`) is now sequenced **after** the three data cascade ops (exams, snapshots, grades) rather than running in parallel with them
- Guarantees the gate is never active without the underlying data being archived first
- Gate write failure is caught and surfaced separately — `writeBlockActive: false` + `writeBlockError` in both the response and the audit log entry, plus `console.error` — cascade data is preserved even if the gate fails
- Year label resolved from `academic_years` collection (best-effort, non-blocking) and embedded in the audit entry as `academicYearLabel` for human-readable audit trails

### Fixed — Audit trail gaps
- `WRITE_BLOCKED_ARCHIVED_YEAR` entries now written to `mark_audit_log` whenever a grade write (`POST /api/grades`, `POST /api/grades/bulk`) or exam result write (`POST /api/exams/:id/results`) is rejected due to an archived year — captures `route`, `attemptedBy`, `payload` summary, `timestamp`
- `GUARDIAN_ACCESS_DENIED` entries now written to `mark_audit_log` whenever a parent/guardian is denied access to `GET /api/report-cards/:id` or `GET /:id/pdf` — captures `requestedBy`, `requestedRole`, `targetStudentId`, `snapshotId`, `route` for GDPR/POPIA compliance

### Tests — `server/__tests__/` (30 new tests, 93 total)
- **`archival.test.js`** (18 tests) — covers `isYearArchived` and `firstArchivedYear`:
  - Early returns on null/empty schoolId or academicYearId (no DB call made)
  - Config doc absent, field missing, empty array, yearId not in list, yearId present
  - Case sensitivity, projection correctness
  - `firstArchivedYear`: empty array, all-null array, no match, first match found, deduplication, null filtering
- **`auth-token.test.js`** (12 tests) — covers `_buildTokenPayload` logic:
  - Parent/guardian with linked students, empty list, missing field, non-array field
  - Guardian role, `primaryRole` takes precedence over `role`
  - All non-guardian roles (`admin`, `superadmin`, `teacher`, `student`, `accountant`) — `guardianOf` absent
  - Core fields always present, `roles` array vs fallback

---

## [4.6.1] — 2026-05-17  Academic Reporting Engine — production hardening (Phase 3)

### Security & Data Integrity

#### Archival write-blocking (prevents data corruption after year-end close)
- `POST /api/academic-config/archive-year` now also writes `$addToSet: { archivedAcademicYears }` on the school's `academic_config` document. This creates a cheap, permanent server-side gate other routes can check without extra queries.
- **`POST /api/grades`** — rejects any grade entry whose `academicYearId` is in `archivedAcademicYears` with HTTP 400.
- **`POST /api/grades/bulk`** — checks all distinct `academicYearId` values in the payload; rejects if any is archived.
- **`POST /api/exams/:id/results`** — checks `exam.academicYearId` against `archivedAcademicYears` before accepting results; archived years are permanently read-only regardless of exam status.
- Both routes use a shared `_isYearArchived(schoolId, academicYearId)` helper that hits a single indexed document.

#### MongoDB session transactions on publish
- `POST /api/report-cards/publish` now wraps both bulkWrites (insert new snapshots + mark old snapshots superseded) inside `session.withTransaction()`.
- **Graceful fallback**: if MongoDB error code 20 (`IllegalOperation — transactions only available on replica set`) is thrown, the server logs a warning and falls back to non-transactional writes automatically. No configuration required — development on standalone MongoDB works unchanged; replica sets in production get full atomicity.

#### Guardian ownership enforcement on report card access
- `GET /api/report-cards/:id` and `GET /api/report-cards/:id/pdf` now verify that users with role `parent` or `guardian` are linked to the requested student via `req.jwtUser.guardianOf[]` (an array of studentIds stored on the user's JWT).
- Unauthorised access returns HTTP 403. This closes the cross-family data-leak vector where any authenticated parent could access any student's report card by guessing a snapshot ID.

### Reliability

#### Runtime type validation in `computeFinalScores`
- `server/utils/academic-calc.js → computeFinalScores()` now validates inputs at runtime before computation:
  - `assessmentWeights` must be a non-empty array with numeric `weight` values — throws `TypeError` with a descriptive message if not.
  - `gradingSchema` must be a non-empty array with numeric `minScore`/`maxScore` — throws `TypeError`.
  - `gradesData` / `examData` are coerced to `{}` if null/undefined/array rather than throwing.
  - Individual score averages are coerced with `Number()` — non-numeric values (e.g. stale string from DB) are skipped with a `console.warn` rather than silently NaN-poisoning the final score.

### Test Coverage

#### New test suite — `server/__tests__/` (63 tests, all passing)
- **`academic-calc.test.js`** (42 tests) — covers `computeFinalScores` and `attachDeviations`:
  - Full three-component weighted score accuracy
  - Partial weight normalisation (only a subset of types present)
  - Single-subject averageScore and subjectCount
  - Multi-student independence
  - Unknown/unweighted assessment types are ignored
  - Tied scores handled correctly
  - Grade boundary table (`score 100 → A` through `score 0 → E`) via `test.each`
  - Non-numeric score skipped with `console.warn` still computes remaining types
  - GPA accumulation
  - `attachDeviations`: class average per subject, deviation sign, single-student (zero deviation), null finalScore, multiple subjects independently, mutation in-place
  - Input validation: empty weights throws, empty schema throws, non-numeric weight throws, null inputs coerced safely
- **`ranking.test.js`** (14 tests) — covers `rankStudents`, `computeRankingScore`, `mergeRankings`, `bestPerSubject`:
  - Standard vs dense tie-breaking (1,2,2,4 vs 1,2,2,3)
  - All-tied cohort: all rank 1
  - Two consecutive tied groups (1,1,3,3,5 standard)
  - KCSE best-7-of-8 real-world scenario: correct subject exclusion
  - `compulsory_only` with empty list falls back to `all`
  - `mergeRankings` omits scopes where student is absent
  - `bestPerSubject` skips null scores, handles single student
- **`resolve-grade.test.js`** (7 tests) — covers `resolveGrade` from `academic-config.js`:
  - Exact upper and lower boundaries for every grade band
  - Decimal scores, custom schemas, default schema fallback
- **Infrastructure**: Jest added as `devDependency`; `npm test` script added to `package.json`; test pattern `server/__tests__/**/*.test.js`; `_model()` and `resolveGrade` mocked in calc tests to keep tests fully offline (no MongoDB connection required).

---

## [4.6.0] — 2026-05-17  Academic Reporting Engine — complete backend

### New — `server/routes/academic-config.js` (school-level academic configuration)
- `GET  /api/academic-config` — returns saved config merged with system defaults (no null fields)
- `PUT  /api/academic-config` — saves config with two hard validations: grade bands must not overlap; assessment weights must sum to 100 (±0.01 tolerance)
- `POST /api/academic-config/reset` — wipes saved config and reverts to system defaults (requires `settings:delete`)
- `GET  /api/academic-config/grade?score=N` — resolves any numeric score to its grade band; useful for frontend previews and server-side grade assignment
- Configurable grading schema: up to 20 grade bands with `minScore/maxScore/points/descriptor/remarks`
- Configurable assessment weights: `classwork / homework / project / test / midterm / final / coursework / oral / practical / other`
- Ranking settings: `enabled`, `scope` (class/stream/overall), `method` (standard 1,2,2,4 or dense 1,2,2,3), `showBestPerSubject`
- **Ranking subject strategy** (v4.6.0): `rankingSubjectStrategy: 'all' | 'best_n' | 'compulsory_only'` + `rankingN` + `compulsorySubjects[]` — supports KCSE best-7-of-8 and compulsory-only models
- Report card settings: `templateId`, `showAttendanceSummary`, `showGPA`, `showDeviation`, `showClassAverage`, signature labels, `footerNote`
- Flag: `subjectAssignmentEnforced` — if true, only the assigned subject teacher can enter marks (gradual rollout)
- Flag: `absentCountsAsZero` — default false; correct behaviour preserves absent marks out of averaging
- Exports `resolveGrade()`, `DEFAULT_GRADING_SCHEMA`, `mergeConfig()` — shared by exams, report-cards routes
- Default schema: A (80–100, 4.0pts) → E (0–39, 0.0pts), 8 bands

### New — `server/utils/ranking.js`
- `rankStudents(students, method)` — pure function, standard (1,2,2,4) or dense (1,2,2,3) ranking, input `[{studentId, totalScore}]`
- `mergeRankings(studentId, scopeRanks)` — builds `{ class: {rank, outOf}, overall: {rank, outOf} }` from multiple ranked arrays
- `bestPerSubject(studentReports)` — returns `{ [subjectId]: winnerStudentId }` across a class
- `computeRankingScore(subjects, strategy, n, compulsorySubjects)` — filters subjects by ranking strategy before computing the score used for ranking; returns `{ rankingScore, subjectsUsed[] }`

### New — `server/routes/report-cards.js` (full academic report card engine)
- `POST /generate` — live preview: aggregates published grades + approved exam results through configured assessment weights → finalScore per subject → resolveGrade() → provisional class rankings. Not persisted.
- `POST /publish` — admin-only batch publish with data integrity guarantees (see below)
- `GET  /` — paginated list of current (non-superseded) snapshots; `?history=1` includes superseded
- `GET  /publish-batches` — paginated audit trail of every publish run
- `GET  /:id` — full snapshot detail (includes embedded grading schema, weights at publish time)
- `PUT  /:id/comments` — role-gated comments: subject teacher → `subjectComments`, class teacher → `classTeacherRemark`, admin → `principalRemark`. Blocked on superseded snapshots.
- `GET  /:id/pdf` — single-student A4 PDFKit report card. Checks financial block (admin bypass `?force=1`). DRAFT watermark on non-published snapshots.
- `GET  /bulk-pdf` — class-wide merged PDF. Chunked in batches of 10 to limit memory use. Financial block filtering. Streamed as `Content-Disposition: attachment`.

#### Data integrity guarantees (v4.6.0)
- **Immutable version chain**: every publish creates a new snapshot with `version++`; old snapshot is marked `superseded:true, supersededAt, supersededBy`. Old versions are never deleted — they remain queryable via `?history=1`.
- **Interrupt-safe batch**: a `publish_batches` document is created with `status: running` before any work begins. Updated to `completed` on success, `failed` on error (with `failureReason`). `batchId` is embedded in every snapshot for traceability.
- **Moderation guard**: publish rejects if any exam for the class/term is not in `approved/locked/published/archived` state. Returns a list of the specific unmoderated exams. Admin can override with `skipModerationCheck: true`.
- **Config snapshot in every record**: `gradingSchema`, `assessmentWeights`, `passMark`, `rankingSubjectStrategy` are copied into each snapshot at publish time. Config changes after publishing never corrupt historical records.
- **DRAFT watermark**: diagonal 45° text on PDF if `status !== 'published'` or `superseded: true`. Shows "DRAFT" or "SUPERSEDED" at 6% opacity.
- **Version badge + batchId in PDF footer**: every printed report card shows its version number and batch ID for audit trail purposes.
- **Comments preserved across republish**: comments from the current version are carried forward to the new version; not reset on republish.

### Extended — `server/routes/exams.js` (exam state machine + mark states + audit trail)
- **State machine**: `scheduled → in_progress → completed → moderated → approved → locked → published → archived` — server enforces transition order; clients cannot skip states
- **Role-gated transitions**: teachers can only drive `in_progress` / `completed`; admin-only for `moderated` / `approved` / `locked` / `published` / `archived`
- **Mark states**: `present / ABS / MIS / EXM / INC` replace the old `absent: boolean`. Backward-compatible — `absent: true` still accepted and maps to `ABS`
  - `ABS` = absent (excluded from averages unless `absentCountsAsZero: true`)
  - `MIS` = mark not entered yet (flags for teacher action)
  - `EXM` = exempted from averaging entirely
  - `INC` = incomplete — warnings surfaced in response; intended to block approval
- `POST /:id/lock` — admin only; enforces approved→locked transition; writes to `statusHistory`
- `POST /:id/unlock` — admin only; requires mandatory `reason`; writes to `mark_audit_log`; locked→approved transition
- `GET  /:id/status-history` — full audit trail of every status change (who, when, why)
- Results `POST /:id/results`: blocked on `locked/published/archived`; teacher-ownership check against `exam.ownerId`; resolves mark states; writes `RESULT_UPDATED` audit entries to `mark_audit_log`; warns on `INC/MIS` marks; auto-advances exam to `completed` on first result entry

### Extended — `server/routes/grades.js` (audit trail on score edits)
- `PUT /:id` now fetches the existing record before update, writes a `GRADE_UPDATED` entry to `mark_audit_log` whenever `score` changes — captures `previousValue`, `newValue`, `editedBy`, `actingAs`, `reason`

### Infrastructure
- `server/index.js`: registered `/api/academic-config` and `/api/report-cards` routes; bumped health version to `4.5.8`; added `/reports` and `/report-cards` to SPA fallback whitelist
- `package.json`: added `pdfkit` dependency (A4 PDF generation without Puppeteer)

---

## [4.5.7] — 2026-05-05  Fix — deleted schools still "remembered" email address

### Fixed — `server/routes/platform.js` + `platform.html`
- **Root cause**: Wipe-All and Delete-School routes matched tenant data by `school.id` (the custom string field), but Mongoose's built-in `id` virtual can shadow the stored field, leaving `schoolIds` empty. User documents were never deleted → the admin email remained "in use" in the database.
- **Three-strategy tenant deletion**: Both delete routes now match using `school.id` (custom FK), `school._id.toString()` (MongoDB ObjectId as string), AND `school.adminEmail` directly on the users collection. All three run simultaneously via `Promise.all` — at least one will always hit.
- **New `DELETE /api/platform/orphans` endpoint**: Scans for `superadmin` user documents whose email or `schoolId` no longer matches any school in the database, and deletes them. Fixes any emails already stuck from previous wipes.
- **"Purge Orphaned Users" button** added to the Diagnostics tab — one click clears all stuck email addresses and shows which ones were removed.

---

## [4.5.6] — 2026-05-05  Diagnostic — full email + impersonate + branding root-cause fix

### Fixed — `server/utils/email.js` + `server/routes/platform.js` + `platform.html` + `render.yaml`
- **Root cause of no emails**: `SMTP_USER`, `SMTP_PASS`, and `PLATFORM_EMAIL` were not declared in `render.yaml` at all — Render had zero email credentials. Added all three as `sync: false` keys (must be set manually in Render dashboard → Environment). Added a clear `[EMAIL] ⚠️ SMTP_USER / SMTP_PASS not set` warning to server logs on startup.
- **Approval email linked to wrong URL**: `sendApprovalWelcome` was building `APP_URL?school=slug` which goes to the server root (`index.html`, the legacy app). Changed to `APP_URL/login` (the React SPA).
- **`APP_URL` was wrong in `render.yaml`**: Was `innolearn-ecosystem.onrender.com`, corrected to `school-management-ecosystem.onrender.com`.
- **Impersonate missing `schoolName` in JWT + response**: The sidebar's `user.schoolName` was `undefined` after impersonation because the impersonate endpoint never included it. Now `schoolName: school.name` is in both the JWT payload and the returned user object.
- **Legacy localStorage not cleared on impersonate**: Old InnoLearn demo keys lingered and contaminated new school sessions. `doImpersonate` now wipes all legacy app keys before storing the new React SPA session.
- **`_send()` no longer throws when SMTP not configured**: Added early-return guard so unconfigured email never causes approval/registration to fail.
- **Diagnostics view added** to platform admin: "🩺 Diagnostics" tab with one-click email test (shows SMTP config state + sends a test email to `PLATFORM_EMAIL`), DB connection check, and a table of all required Render environment variables with setup instructions.

---

## [4.5.5] — 2026-05-05  Fix — new schools see correct branding & clean dashboard (no demo data)

### Fixed — `platform.html` + `client/src/components/layout/Sidebar.jsx`
- **Impersonate now redirects to React SPA** (`/login`) instead of the legacy vanilla-JS app (`/index.html`). Previously, clicking "Log In as Admin" sent the operator into the old InnoLearn demo app which seeds fake data (20 students, 8 staff, 29 classes, InnoLearn branding) into `localStorage` regardless of the school. The React SPA is fully tenant-scoped and shows empty/correct data for new schools.
- **Session correctly written for React SPA** — `doImpersonate` now stores `{ token, user, school }` under the `innolearn_session` key that the React auth store reads, so the operator lands on the SPA already authenticated.
- **Sidebar shows school name, not "InnoLearn"** — replaced the hardcoded `"InnoLearn"` platform title and `"IL"` badge with dynamic values derived from `user.schoolName` in the JWT session. The two-letter initials badge is also computed from the school name.
- **Sidebar subtext shows user role** — the secondary line under the school name now shows the user's role (e.g. "Superadmin") instead of the static school name fallback.

---

## [4.5.4] — 2026-05-04  Platform — delete school, wipe all, no more browser confirm() dialogs

### Platform Admin (`platform.html` + `server/routes/platform.js`)
- **Removed all `confirm()` calls** — the Suspend / Reinstate confirmation now uses the platform's existing `showModal()` system with proper action buttons
- **Delete School button** added to every row in the All Schools table (red trash icon) — triggers a modal with a permanent-warning banner before deleting
- **Wipe All button** added to the Schools table header — purges every non-demo school and all their tenant data (users, students, classes, attendance, finance, behaviour, timetable, messages, academic years, sections, role permissions, subjects, events, HR records) in one operation; the InnoLearn demo school (`slug: innolearn`) is always preserved
- **`DELETE /api/platform/schools/:id`** — new server route; deletes the school document and all data in every tenant collection that shares the same `schoolId`
- **`DELETE /api/platform/schools/all`** — new server route; bulk-deletes all non-`innolearn` schools and their tenant data; returns `{ deleted: N }`
- Route order: `/schools/all` registered before `/schools/:id` so Express matches the literal path correctly

---

## [4.5.3] — 2026-05-04  UX — inline form validation on onboarding form (no more browser popups)

### Changed — `onboard.html` + `css/onboard.css`
- Removed all seven `alert()` calls from the `validate()` function — browser native popups were jarring and blocked the UI
- Added `.ob-step-error` inline error banner below the panel heading on each step — appears with a slide-in animation, styled red with a left accent border
- Red field highlights (`.ob-field-invalid`) appear on individual empty/invalid inputs and selects when Continue is clicked — border turns red with a soft red glow
- Error banner auto-dismisses as soon as the user starts editing any highlighted field (`input` / `change` listeners on all required fields)
- Step 1 errors now individually identify which field caused the issue (empty required fields vs. bad slug format vs. no curriculum vs. no sections)
- Step 2 errors distinguish "missing name/email" from "invalid email format" with field-specific highlighting
- Step 3 shows a friendly "select a plan" prompt directly on the plan grid instead of an alert
- Added `apiFetch()` helper in `platform.html` — announcement management was calling it but it was undefined

---

## [4.5.2] — 2026-05-04  Hotfix — platform approve/impersonate always returned "School not found"

### Fix — `server/routes/platform.js` + `platform.html`
- **Root cause**: Mongoose has a built-in `id` virtual (an alias for `_id.toString()`) which conflicts with the custom `id` field stored on school documents. When `School.find({}).lean()` is called, the serialised JSON may not carry the custom `id` field, so `s.id` in the frontend evaluates to `undefined`. Every Approve / Reject / Impersonate / Plan-change action then called e.g. `POST /api/platform/schools/undefined/approve`, and the server-side `findOneAndUpdate({ id: 'undefined' })` query found nothing → 404 "School not found".
- **Frontend fix** (`platform.html`): all platform action buttons now use `s._id` (MongoDB's native ObjectId string, always present in `.lean()` output) instead of `s.id`. Same fix applied to announcement action buttons (`ann._id`).
- **Backend fix** (`platform.js`): all school lookup queries changed from `findOneAndUpdate({ id: ... })` to `findByIdAndUpdate(id, ...)` — Mongoose auto-casts the string to ObjectId. Announcement patch/delete routes updated identically.
- **Impersonate robustness**: route now first fetches the school by `_id`, then locates the superadmin user via `{ schoolId: school.id }` with an email-address fallback (`{ email: school.adminEmail }`) for any school where the custom `id` field was not stored. JWT `schoolId` is taken from the found user document rather than the URL param.
- **Missing `apiFetch` helper defined**: announcement management functions called `apiFetch()` which was never defined; added a thin wrapper that mirrors the platform key header behaviour of the existing `api()` helper.

---

## [4.5.1] — 2026-05-04  Hotfix — school registration 500 error (stale `adminPassword` reference)

### Fix — `server/routes/onboard.js`
- **Root cause of three reported platform bugs**: a stale `if (adminPassword.length < 8)` validation line was left in `_provisionInDB` after the password field was removed from the registration form in v4.4.0. `adminPassword` was never declared, so every `POST /api/onboard` call threw a `ReferenceError` and crashed with a 500 response — the school and user documents were never written to MongoDB.
- **Consequence**: (1) no "pending" email sent to the registrant, (2) Approve → "School not found" (school never existed in DB), (3) Impersonate → "School has no super admin" (user never existed in DB).
- **Fix**: removed the three stale lines; the rest of the provisioning flow (slug generation, DB writes, email dispatch) was already correct.
- No other logic changed; the fix is a pure removal of dead code.

---

## [4.5.0] — 2026-05-03  Security hardening — rate limiting + Render deploy fix

### Security — Global Rate Limiting (`server/index.js`) · commit `503e51f`
- Added two limiters at the server level — `express-rate-limit` was already a dependency (used in route files) but never applied globally
- **General limiter**: 300 req / 15 min / IP across all `/api/*` — skipped in development so local workflows are unaffected
- **Auth limiter**: 20 req / 15 min / IP on `/api/auth` — stacked on top of the general limiter, always enforced including in dev
- Standard `RateLimit-*` headers returned on every response so API clients can back off gracefully before hitting the wall

### Fix — Render Deployment (`render.yaml` + `client/.npmrc`) · commit `16f725c`
- `buildCommand` was `npm install` only — React `client/dist/` was never compiled; `fs.existsSync` returned `false`; Express fell back to the legacy `index.html` on every Render deploy
- Fixed: `npm install && cd client && npm install --include=dev && npm run build`
- `--include=dev` required because `vite` and `tailwindcss` live in `devDependencies`; Render strips them by default in production
- Added `client/.npmrc` with `include=dev` as a second-line safety net for any CI environment that ignores the CLI flag

---

## [4.4.0] — 2026-05-03  Persistent messaging, auto-credential registration, dedicated school URLs

### School Registration — Password Removed, System-Generated Credentials
- Removed password fields from the onboarding form — schools no longer set their own password during registration
- Server generates a cryptographically secure 12-character temp password using `crypto.randomBytes` (no ambiguous characters)
- Temp password stored alongside the hashed version in the user document; cleared from DB once the approval email is sent
- `mustChangePassword: true` set on all newly registered school admins — forced password change on first login
- Offline (localStorage) mode also generates a local temp password and displays it in the success screen with a prominent "save this now" warning

### School Approval — Full Credentials Email
- Approval email now includes the school's **dedicated login URL** (`APP_URL?school={slug}`), their email, and the auto-generated temp password
- Email styled with a highlighted monospace password block and a security warning about first-login password change
- Temp password cleared from DB after the approval email is dispatched
- `sendApprovalWelcome` updated to accept `tempPassword` parameter

### Dedicated School Login URL (`?school=slug`)
- `js/app.js` reads `?school=` query param on page load and stores it in `localStorage` as `ss_school_slug`
- URL is cleaned with `history.replaceState` after storing — slug does not remain visible in browser history
- Enables school-specific links like `https://app.innolearn.edu.ke?school=greenhill` to route users to their tenant automatically

### Communication Hub — MongoDB-Persistent Messages
- Messages and announcements now stored in MongoDB via `POST /api/messages`; no longer ephemeral in localStorage
- Messages load from server on every tab open; fall back to localStorage DB when offline
- Loading skeleton shown while fetching from server
- `GET /api/messages?tab=inbox|sent` — scoped to the user's school; inbox shows `all`, role-group, and direct messages
- `PATCH /api/messages/:id/read` — persists read status per user
- `DELETE /api/messages/:id` — sender, admin, and deputy principal can delete

### Email Notifications for In-App Messages
- Every sent message and announcement triggers real email delivery to all recipients (`sendMessageNotification`)
- Direct messages: personal notification email to the recipient with subject preview
- Announcements (`all` / `teachers` / `parents` / `students` / `staff`): notification email sent to every matching active user in the school
- Group emails sent in parallel (non-blocking `Promise.allSettled`) — failed sends logged, do not block the response
- New email template: `sendMessageNotification` — branded InnoLearn header, sender name, subject, 160-char preview, "Open InnoLearn" CTA

### New Server Route — `server/routes/messages.js`
- `GET /` — list messages (inbox/sent) with pagination; role-group filtering
- `POST /` — create message, resolve recipients, send notification emails
- `PATCH /:id/read` — mark as read
- `DELETE /:id` — delete with role check
- Registered in `server/index.js` at `/api/messages`

### Frontend API Client — `js/api.js`
- Added `API.messages` namespace: `list()`, `send()`, `markRead()`, `remove()`

---

## [4.3.0] — 2026-05-03  Phase 4 — React SPA (Vite + React 18 + TanStack Query + Tailwind CSS)

### Architecture — Modern React SPA

Phase 4 introduces a production-ready React front-end (`client/`) that runs alongside the legacy vanilla-JS app. **Zero breaking changes** — the legacy app continues to be served untouched. Once `npm run build:react` is run, the compiled SPA is served automatically by the Express server at all SPA routes.

### New — `client/` React App

**Configuration**
- `client/package.json` — React 18, React Router v6, TanStack Query v5, Zustand, clsx, date-fns, Tailwind CSS 3, Vite 5
- `client/vite.config.js` — dev server on port 5173, proxy `/api` → Express port 3005, code-split chunks (react, router, query)
- `client/tailwind.config.js` — InnoLearn brand palette (sidebar indigo, `brand-*` spectrum), card shadows, fade/slide animations
- `client/postcss.config.js`, `client/index.html` — Inter font, `h-full` body

**Entry & Routing**
- `client/src/main.jsx` — `QueryClient` (staleTime 2 min matching server TTL), `RouterProvider`, React Query Devtools in dev
- `client/src/App.jsx` — `createBrowserRouter` with all 12 module routes; lazy-loaded pages wrapped in `<Suspense>`; `ProtectedRoute` guard

**API Client** (`client/src/api/client.js`)
- Full port of `js/api.js` — same modules (students, teachers, classes, attendance, finance, behaviour, exams, grades, admissions, timetable, auth, settings)
- `APIError` class with `code`, `message`, `status`
- Dispatches `api:unauthorized` event on 401; `useAuthStore` listens and auto-logs out

**Auth Store** (`client/src/store/auth.js`)
- Zustand store persisting `innolearn_session` to localStorage
- `setSession`, `logout`, `patchUser`, `can(feature)` helpers
- Listens to `api:unauthorized` window event for server-side session expiry

**Layout**
- `AppShell.jsx` — desktop sidebar always visible (lg+), mobile drawer with backdrop overlay, auto-close on navigation
- `Sidebar.jsx` — section-grouped nav, active link highlight, user footer with logout
- `TopBar.jsx` — breadcrumb derived from current route, plan badge, user avatar

**Guards & UI Primitives**
- `ProtectedRoute.jsx` — redirects to `/login` if no session token; preserves `from` location for post-login redirect
- `Spinner.jsx` — `Spinner` (5 sizes) + `PageSpinner` (centred loading block)
- `Badge.jsx` — 7 variants, dot indicator; `studentStatusBadge`, `invoiceStatusBadge`, `admissionStageBadge` helpers
- `EmptyState.jsx` — `EmptyState` (icon + CTA) and `ErrorState` (message + retry)
- `Pagination.jsx` — smart page window (first, last, ±1 around current with ellipsis)

**Pages**
- `Login.jsx` — split-panel layout (brand left, form right), handles `passwordExpired` server flag with inline change-password flow
- `Dashboard.jsx` — 4 stat cards (students, attendance, finance, admissions) + recent-students list + quick-action links; all data from TanStack Query
- `StudentList.jsx` — debounced search (400 ms), class/status/gender filters, paginated table with avatar initials, soft-delete confirm
- `StudentProfile.jsx` — tabbed detail (Overview, Attendance, Finance, Behaviour, Grades); inline edit mode with controlled form; each tab lazy-fetches its data on first activation
- `TeacherList.jsx`, `ClassList.jsx`, `AttendancePage.jsx`, `FinancePage.jsx`, `BehaviourPage.jsx`, `ExamsPage.jsx`, `AdmissionsPage.jsx`, `TimetablePage.jsx`, `SettingsPage.jsx` — fully functional with TanStack Query, pagination, and table/card UIs
- `NotFound.jsx` — friendly 404 page

### Upgraded — Server (`server/index.js`)
- Serves `client/dist` as a primary static directory when `NODE_ENV=production` and the React build exists
- Long-lived cache headers (`immutable`) on hashed asset filenames
- React SPA routes (`/dashboard`, `/students`, `/login`, etc.) served React's `index.html`; legacy routes fall back to legacy `index.html`
- `/onboard` and `/platform` continue to serve their dedicated HTML pages
- Version bumped to `4.2.0` in health endpoint

### Upgraded — Root `package.json`
- Version bumped to `4.2.0`
- `dev:react` — run Vite dev server (`cd client && npm run dev`)
- `build:react` — install client deps + Vite build
- `build` — alias for `build:react`

### How to run

```bash
# Start API (existing)
npm run dev

# Start React dev server (in a second terminal — proxies /api to port 3005)
npm run dev:react

# Build React for production
npm run build:react

# After build, npm start serves the React app automatically
npm start
```

---

## [4.2.0] — 2026-05-03  Phase 3 — API-First Data Layer · Cache · Production Writes · Module Hydration

### Architecture — localStorage → API-First

Phase 3 replaces the localStorage-as-primary-database pattern with a server-first data layer. All writes now go to the production API first; localStorage acts as a fast synchronous cache between server fetches. **Zero breaking changes** — all existing modules continue to work.

### New — In-Memory TTL Cache (`js/cache.js`)
- `Cache.set(key, data, ttl)` — store with TTL (default 2 minutes)
- `Cache.get(key)` — returns null if missing or expired
- `Cache.has(key)` — live check without returning data
- `Cache.invalidate(key?)` — bust one key or clear everything
- `Cache.invalidatePrefix('behaviour_')` — bust all keys matching a prefix
- `Cache.debug()` — log all live keys with TTL remaining to console

### Upgraded — DB Module (`js/data.js`)
- **`PRODUCTION_ROUTES` map** — 13 collections mapped to their resource API routes (students, teachers, classes, attendance, invoices, payments, behaviour_*, grades, admissions, timetable)
- **`_push()` upgraded** — for collections in PRODUCTION_ROUTES, writes now route to the correct REST endpoint (`PUT /api/students/:id`, `DELETE /api/teachers/:id`, etc.) instead of the legacy `/api/collections/:col` generic route. The backend RBAC middleware now validates all writes.
- **`DB.hydrate(col, params)`** — new async function; fetches all pages from the production API (up to 1000 records), stores in localStorage, marks in 2-minute cache. Concurrent hydration of the same collection is deduplicated.
- **`DB.invalidateHydration(col)`** — busts the hydration cache so the next `render()` fetches fresh data from the server
- Both `hydrate` and `invalidateHydration` exported from the DB module

### New — App Loading & Pagination Helpers (`js/app.js`)
- `App.loadingHtml(message, subtext)` — returns a full-page loading spinner HTML
- `App.renderLoading(message, subtext)` — calls `renderPage()` with the loading spinner
- `App.renderError(message, retryFn?)` — renders a full-page error state with optional retry button
- `App.pagerHtml(page, totalPages, callbackFn, totalRecords?)` — returns pagination control HTML for any table

### Upgraded — Students Module (`js/modules/students.js`)
- `render()` is now `async` — shows loading spinner on first visit (no cached data), then hydrates from `/api/students` and re-renders
- Subsequent navigation reuses 2-minute cache — no spinner on repeat visits
- `save()` calls `DB.invalidateHydration('students')` after update — next render gets fresh server data
- `deleteStudent()` calls `DB.invalidateHydration('students')` and triggers a clean re-render

### Upgraded — Attendance Module (`js/modules/attendance.js`)
- `render()` is now `async` — hydrates attendance records (filtered to current class + date) and students before rendering
- `submit()` — fires `API.attendance.bulkMark()` to the production endpoint for the whole class in one atomic request, alongside the localStorage write. Cache invalidated on success.

### Upgraded — Finance Module (`js/modules/finance.js`)
- `render()` is now `async` — hydrates invoices and payments from production API before rendering
- `savePayment()` is now `async` — calls `API.finance.payments.record()` first; server recalculates balance and status; localStorage updated to match. Graceful fallback to localStorage-only if plan doesn't include the finance API.
- `doGenerateInvoices()` is now `async` — calls `API.finance.invoices.create()` for each student; server assigns `INV-{year}-{000001}` format invoice numbers. Graceful fallback to legacy client-side numbering on lower plans.

### Upgraded — Behaviour Module (`js/modules/behaviour.js`)
- `render()` is now `async` — hydrates incidents, appeals, and categories in parallel before rendering
- `DB.invalidateHydration('behaviour_incidents')` called after every incident log

### Script Load Order (`index.html`)
```
data.js → cache.js → api.js → validators.js → modules → app.js
```

---

## [4.1.0] — 2026-05-03  Phase 2 — Remaining Resource Routes · Frontend API Client

### New — Resource Route: Behaviour (`server/routes/behaviour.js`)
- `GET /api/behaviour/incidents` — paginated log with student/class/type/severity/category/date-range filters
- `GET /api/behaviour/incidents/summary` — MongoDB aggregation: merits, demerits, points total per student
- Full CRUD for incidents with soft-delete (sets `status: resolved`)
- `GET /api/behaviour/appeals` — paginated; `POST` creates appeal and marks incident as `appealed`; `PUT` records outcome and auto-resolves incident
- Full CRUD for `GET/POST/PUT/DELETE /api/behaviour/categories` — school-defined category definitions

### New — Resource Route: Exams (`server/routes/exams.js`)
- Full CRUD for exam schedules (test, mock, terminal, internal, external, coursework)
- `GET /api/exams/:id/results` — paginated; includes server-computed class stats (highest, lowest, average, pass count)
- `POST /api/exams/:id/results` — bulk upsert results for all students; validates scores ≤ maxScore; computes grade letter from school grading scale; auto-marks exam as `completed`
- `GET /api/exams/results/all` — cross-exam results query with student/class/subject filters

### New — Resource Route: Grades (`server/routes/grades.js`)
- Full CRUD for gradebook entries (classwork, homework, project, test, midterm, final, coursework)
- Percentage auto-calculated server-side; client values ignored
- Score > maxScore rejected at API layer
- `POST /api/grades/bulk` — bulk upsert via MongoDB `bulkWrite`; validates all scores before insert
- `GET /api/grades/report` — weighted average per student per subject using MongoDB aggregation (accounts for assessment weight field)

### New — Resource Route: Admissions (`server/routes/admissions.js`)
- Full pipeline CRUD from enquiry → enrolled/withdrawn
- Auto-generated `applicationRef` (`APP-{year}-{6char}`)
- `stageHistory` array appended on every stage change — full audit trail
- `GET /api/admissions/stats` — aggregated pipeline counts per stage, ordered by funnel position
- `PATCH /api/admissions/:id/stage` — quick stage-change endpoint with optional notes

### New — Resource Route: Timetable (`server/routes/timetable.js`)
- Full CRUD for timetable slots (class + day + period + subject + teacher + room)
- Slot collision detection: duplicate class + day + period rejected with 409
- `GET /api/timetable/class/:classId` — full class timetable grouped by day for easy rendering
- `GET /api/timetable/teacher/:teacherId` — teacher's full schedule grouped by day
- `POST /api/timetable/bulk` — populate whole timetable at once; optional `replaceClass` / `replaceDay` to clear and rebuild

### New — Frontend API Client (`js/api.js`)
- Centralised fetch wrapper: attaches JWT, handles the `{ success, data, pagination }` envelope, throws `APIError` on failure
- Dispatches `api:unauthorized` event on 401 — auto-redirects to login when session expires
- Module namespaces: `API.students`, `API.teachers`, `API.classes`, `API.attendance`, `API.finance.invoices`, `API.finance.payments`, `API.behaviour.incidents`, `API.behaviour.appeals`, `API.behaviour.categories`, `API.exams`, `API.exams.results`, `API.grades`, `API.admissions`, `API.timetable`, `API.auth`, `API.announcements`, `API.backup`
- `API.collections.*` — legacy wrapper for `/api/collections/:col` (kept for backward compat. during migration)
- Loaded in `index.html` before all feature modules

### New API Endpoints (v4.1.0)
| Method | Route | Auth | Plan | Description |
|---|---|---|---|---|
| `GET` | `/api/behaviour/incidents` | JWT | standard | Paginated incident log |
| `POST` | `/api/behaviour/incidents` | JWT | standard | Log incident |
| `GET` | `/api/behaviour/incidents/summary` | JWT | standard | Per-student merit/demerit totals |
| `PUT` | `/api/behaviour/incidents/:id` | JWT | standard | Update incident |
| `DELETE` | `/api/behaviour/incidents/:id` | JWT | standard | Soft-close incident |
| `GET/POST/PUT` | `/api/behaviour/appeals` | JWT | standard | Appeal lifecycle |
| `GET/POST/PUT/DELETE` | `/api/behaviour/categories` | JWT | standard | Category management |
| `GET` | `/api/exams` | JWT | standard | Paginated exams |
| `POST` | `/api/exams` | JWT | standard | Schedule exam |
| `GET` | `/api/exams/:id/results` | JWT | standard | Results + class stats |
| `POST` | `/api/exams/:id/results` | JWT | standard | Bulk enter results |
| `GET` | `/api/exams/results/all` | JWT | standard | Cross-exam results query |
| `GET` | `/api/grades` | JWT | core | Paginated gradebook |
| `POST` | `/api/grades` | JWT | core | Create grade entry |
| `POST` | `/api/grades/bulk` | JWT | core | Bulk upsert grades |
| `GET` | `/api/grades/report` | JWT | core | Weighted average report |
| `GET` | `/api/admissions` | JWT | premium | Paginated pipeline |
| `POST` | `/api/admissions` | JWT | premium | Create application |
| `GET` | `/api/admissions/stats` | JWT | premium | Pipeline funnel stats |
| `PATCH` | `/api/admissions/:id/stage` | JWT | premium | Quick stage change |
| `GET` | `/api/timetable` | JWT | standard | Filtered timetable slots |
| `GET` | `/api/timetable/class/:classId` | JWT | standard | Class timetable (grouped by day) |
| `GET` | `/api/timetable/teacher/:teacherId` | JWT | standard | Teacher schedule |
| `POST` | `/api/timetable` | JWT | standard | Create slot (collision check) |
| `POST` | `/api/timetable/bulk` | JWT | standard | Bulk populate/replace timetable |

---

## [4.0.0] — 2026-05-01  Phase 1 Architecture — Server-Side RBAC · Plan Gating · Paginated Resource APIs · Atomic IDs

### Architecture — Zero-Trust Backend Security (Phase 1)
This release begins the production architecture migration. All changes are **backward-compatible** — the existing `/api/collections/*` route is untouched. New resource routes co-exist alongside the legacy route allowing a gradual frontend migration.

### New — Server-Side RBAC Middleware (`server/middleware/rbac.js`)
- `rbac(module, action)` — Express middleware factory; checks the requesting user's role permissions before any handler runs
- Permissions loaded from the `role_permissions` MongoDB collection, scoped per `schoolId + role`
- **5-minute in-memory cache** per `schoolId::role` pair — avoids a DB round-trip on every request
- `invalidatePermCache(schoolId)` — exported for cache-busting when permissions change
- `superadmin` and `admin` roles bypass all permission checks automatically
- Standardised 403 response: `{ success: false, error: { code: 'FORBIDDEN', message: '...' } }`

### New — Plan Tier Gating Middleware (`server/middleware/plan.js`)
- `planGate(feature)` — Express middleware factory; gates access by the school's subscription plan
- Cumulative plan hierarchy: **core ⊂ standard ⊂ premium ⊂ enterprise**
- Feature → minimum plan map:
  - **Core**: students, attendance, classes, teachers, grades, subjects, events, messaging
  - **Standard**: behaviour, timetable, exams, key stages, houses, sections
  - **Premium**: finance, admissions, reports, report cards, custom roles
  - **Enterprise**: API access, SSO, advanced analytics, multi-campus, white-label
- School plan cached per schoolId (5-min TTL, `invalidatePlanCache(schoolId)` exported)
- Standardised 403 response includes `currentPlan` and `requiredPlan` fields

### New — Atomic Counter Utility (`server/utils/counters.js`)
- `nextId(name)` — race-safe atomic increment using MongoDB `$inc + upsert` on `counters` collection
- `nextAdmissionNumber(schoolId)` → `ADM-{year}-{00001}` (5-digit zero-padded)
- `nextStaffId(schoolId)` → `STF-{year}-{00001}`
- `nextInvoiceNumber(schoolId)` → `INV-{year}-{000001}` (6-digit)
- `nextReceiptNumber(schoolId)` → `RCP-{year}-{000001}`
- All counters are per-school, per-year — reset naturally each academic year

### New — Standardised Response Helpers (`server/utils/response.js`)
- `ok(res, data, pagination?)` — `{ success: true, data, pagination }`
- `created(res, data)` — 201 Created with same envelope
- `fail(res, code, message, status?, extra?)` — `{ success: false, error: { code, message } }`
- `paginate(page, limit, total)` — builds `{ page, limit, total, pages }` meta object
- `parsePagination(query)` — parses `?page=1&limit=50` with safe defaults (max 200/page)
- `E.*` — shortcut error helpers: `E.notFound`, `E.forbidden`, `E.validation`, `E.conflict`, etc.

### New — Resource Route: Students (`server/routes/students.js`)
- Full CRUD + bulk import for student records
- **Zod validation** on all inputs; unknown fields and type coercion handled safely
- Admission numbers generated **server-side** via atomic counter — never accepted from client
- Soft delete: sets `status: 'inactive'` with `deletedAt` + `deletedBy` (record preserved)
- Filters: `status`, `classId`, `houseId`, `keyStageId`, `gender`, free-text `search`
- `POST /api/students/bulk` — up to 500 students, per-row validation errors, 207 Multi-Status on partial success

### New — Resource Route: Teachers (`server/routes/teachers.js`)
- Full CRUD for teaching/staff records
- Staff IDs generated **server-side** (`STF-{year}-{00001}`)
- Email uniqueness enforced per school at API layer
- Soft delete with audit trail

### New — Resource Route: Classes (`server/routes/classes.js`)
- Full CRUD for class management
- `GET /api/classes/:id/students` — paginated list of students enrolled in a class (requires `students:read` permission)
- Duplicate class name check within same school + academic year

### New — Resource Route: Attendance (`server/routes/attendance.js`)
- `GET /api/attendance` — paginated with date, dateFrom/dateTo range, classId, studentId, period, status filters
- `GET /api/attendance/summary` — server-side MongoDB aggregation of attendance rates per student
- `POST /api/attendance/bulk` — mark all students in a class in one request using MongoDB `bulkWrite` upserts
- Upsert behaviour: same student + date + period combination is updated, not duplicated
- Attendance statuses: `present`, `absent`, `late`, `authorised_absence`, `excluded`, `holiday`

### New — Resource Route: Finance (`server/routes/finance.js`)
- **All financial totals calculated server-side** — client-supplied totals are ignored
- Invoice creation: `subtotal`, `discountAmount`, `taxAmount`, `total` derived from line items
- Payment recording: validates against outstanding balance, rejects overpayments
- Invoice status auto-updated on every payment: `unpaid` → `partial` → `paid`
- `GET /api/finance/summary` — aggregate overview: total invoiced, collected, outstanding, breakdown by payment method
- Void protection: paid invoices cannot be edited or voided
- `INV-{year}-{000001}` invoice numbers and `RCP-{year}-{000001}` receipt numbers, server-generated

### New API Endpoints (v4.0.0)
| Method | Route | Auth | RBAC | Plan | Description |
|---|---|---|---|---|---|
| `GET` | `/api/students` | JWT | `students:read` | core | Paginated student list |
| `POST` | `/api/students` | JWT | `students:create` | core | Create student (server admission no.) |
| `POST` | `/api/students/bulk` | JWT | `students:create` | core | Bulk import up to 500 |
| `GET` | `/api/students/:id` | JWT | `students:read` | core | Single student |
| `PUT` | `/api/students/:id` | JWT | `students:update` | core | Update student |
| `DELETE` | `/api/students/:id` | JWT | `students:delete` | core | Soft-delete student |
| `GET` | `/api/teachers` | JWT | `teachers:read` | core | Paginated teacher list |
| `POST` | `/api/teachers` | JWT | `teachers:create` | core | Create teacher (server staff ID) |
| `GET` | `/api/teachers/:id` | JWT | `teachers:read` | core | Single teacher |
| `PUT` | `/api/teachers/:id` | JWT | `teachers:update` | core | Update teacher |
| `DELETE` | `/api/teachers/:id` | JWT | `teachers:delete` | core | Soft-delete teacher |
| `GET` | `/api/classes` | JWT | `classes:read` | core | Paginated class list |
| `POST` | `/api/classes` | JWT | `classes:create` | core | Create class |
| `GET` | `/api/classes/:id` | JWT | `classes:read` | core | Single class |
| `GET` | `/api/classes/:id/students` | JWT | `students:read` | core | Students in class |
| `PUT` | `/api/classes/:id` | JWT | `classes:update` | core | Update class |
| `DELETE` | `/api/classes/:id` | JWT | `classes:delete` | core | Soft-delete class |
| `GET` | `/api/attendance` | JWT | `attendance:read` | core | Paginated attendance |
| `POST` | `/api/attendance` | JWT | `attendance:create` | core | Single attendance record (upsert) |
| `POST` | `/api/attendance/bulk` | JWT | `attendance:create` | core | Bulk-mark whole class |
| `GET` | `/api/attendance/summary` | JWT | `attendance:read` | core | Aggregated rates per student |
| `PUT` | `/api/attendance/:id` | JWT | `attendance:update` | core | Update record |
| `DELETE` | `/api/attendance/:id` | JWT | `attendance:delete` | core | Delete record |
| `GET` | `/api/finance/invoices` | JWT | `finance:read` | premium | Paginated invoices |
| `POST` | `/api/finance/invoices` | JWT | `finance:create` | premium | Create invoice (server totals) |
| `PUT` | `/api/finance/invoices/:id` | JWT | `finance:update` | premium | Update invoice + recalc |
| `DELETE` | `/api/finance/invoices/:id` | JWT | `finance:delete` | premium | Void invoice |
| `GET` | `/api/finance/payments` | JWT | `finance:read` | premium | Paginated payments |
| `POST` | `/api/finance/payments` | JWT | `finance:create` | premium | Record payment + auto-update invoice |
| `GET` | `/api/finance/summary` | JWT | `finance:read` | premium | Financial summary/overview |

### Dependencies Added
- `zod@^3.23.8` — runtime schema validation and input parsing
- `uuid@^9.0.1` — RFC-4122 UUID generation for document IDs

### Notes
- All new routes coexist with `/api/collections/*` — **zero breaking changes** to the current frontend
- The legacy route remains available during frontend migration (Phase 2–3)
- `uuid` was already used in some prior code but was not listed in `package.json`

---

## [3.5.0] — 2026-05-03  Global Update Announcements · Data Backup & Export · Zero-Interruption Updates

### New — System Announcement Platform (Platform Admin)
- Platform admin has a new **"Announcements"** tab in the Platform dashboard
- Create notices with four types: **🔧 Scheduled Maintenance**, **🚀 Platform Update**, **🔒 Security Notice**, **ℹ️ General Info**
- Each announcement has a title, description, scheduled date/time, and optional expiry timestamp
- **"Notify all schools"** checkbox — instantly emails every active school admin with a branded notice, including a direct "Back Up My Data Now" call-to-action for maintenance and security notices
- Cancel, reactivate, or delete announcements at any time
- Dashboard shows notified school count and how many schools have dismissed the notice

### New — Announcement Banners on Every School Dashboard
- When a system announcement is active, a **colour-coded banner** appears at the top of every user's dashboard:
  - 🔧 Maintenance / 🔒 Security → amber/red banner with inline **"Back Up My Data Now"** button
  - 🚀 Update / ℹ️ Info → blue/purple banner with Dismiss link
- Banners load asynchronously on login — do not block or delay the dashboard
- Each school can dismiss a banner independently (stored server-side per school)
- Dismissed banners never reappear; expired banners (past `expiresAt`) are hidden automatically

### New — Data Backup & Export (Superadmin)
- Superadmin dashboard now shows a **"Data Backup & Export"** card and a **"Backup Data"** quick-action tile
- One click exports **all school data** across every collection (students, staff, classes, finance, attendance, behaviour, reports, and more) as a single structured **JSON file**
- File is downloaded directly to the browser — nothing is stored on InnoLearn servers
- Backup is version-stamped, timestamped, and labelled with the school name
- **Backup history log** — every export is logged with date, who triggered it, record count, and version; viewable via "View backup history" expander on the dashboard
- `GET /api/backup/preview` — shows record counts per collection before committing to a download
- Rate-limited: maximum 10 exports per hour per school

### New — Update Safety Protocol
- Before any major platform update, platform admin creates an announcement with `notifyAll: true`
- All school superadmins receive an email **and** a dashboard banner — both prompt them to back up their data first
- The update proceeds only after schools have had time to export — no school data is touched by the update process
- The backup file is a complete, self-contained JSON snapshot that can be used to verify data integrity after any change

### New API Endpoints
| Method | Route | Auth | Description |
|---|---|---|---|
| `GET` | `/api/announcements` | JWT | Active notices for this school |
| `POST` | `/api/announcements/:id/dismiss` | JWT | Per-school dismiss |
| `GET` | `/api/platform/announcements` | Platform Key | List all announcements |
| `POST` | `/api/platform/announcements` | Platform Key | Create + optionally email all schools |
| `PATCH` | `/api/platform/announcements/:id` | Platform Key | Update status/content |
| `DELETE` | `/api/platform/announcements/:id` | Platform Key | Remove announcement |
| `POST` | `/api/backup/export` | JWT (superadmin) | Full JSON export download |
| `GET` | `/api/backup/history` | JWT (superadmin) | List backup log entries |
| `GET` | `/api/backup/preview` | JWT (superadmin) | Record counts per collection |

### Email
- `sendSystemUpdateNotice` — branded maintenance/update email with urgency block; links directly to dashboard for backup action

---

## [3.4.0] — 2026-05-01  Password Rotation · User Invites · Role Notifications · Security Hardening

### Security — Critical Fixes
- `GET /api/collections/users` no longer returns password hashes or MFA fields — all bcrypt and OTP data is stripped from every response
- Any authenticated user (teacher, parent, student) could previously write to the `users` collection — now only `admin` and `superadmin` roles can create, update, or delete users and role permissions
- Non-superadmin users can no longer assign the `superadmin` role or modify their own role
- Password field cannot be overwritten via the generic PUT endpoint — role updates never touch credentials
- Added **`helmet`** HTTP security headers: X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security, Referrer-Policy, and more
- CORS now restricted to known origins in production (Render URL + localhost); unknown origins are blocked and logged
- Server warns at startup if `JWT_SECRET` environment variable is not set
- bcrypt cost factor raised from 10 → 12 for all new password hashing

### New — 60-Day Password Rotation Policy
- All user passwords expire after **60 days** — enforced server-side at login
- If expired: server returns `passwordExpired: true` (no JWT issued) → frontend shows a "Password expired" force-change screen
- If `mustChangePassword` flag set: shows "Set your password" screen for first-login users
- Password change screen includes real-time hints (length ✓, match ✓) and blocks submission until both pass
- After successful forced change: JWT is issued, session starts normally
- Security email sent after every password change
- **Dashboard banner** visible to all users when password expires in ≤ 7 days (blue → amber → red urgency)
- Email reminders at 7 / 3 / 1 / 0 days before expiry (deduplicated — one per milestone per day)

### New — User Invite System (Bulk & Individual)
- `POST /api/users/invite` — admin/superadmin creates a single user with a system-generated temp password
  - User is created in MongoDB immediately; `mustChangePassword: true` is set
  - Welcome email sent with branded credentials and login link
  - Returns `{ user, tempPassword }` — password shown once to the admin
- `POST /api/users/bulk-invite` — accepts up to 200 users as a JSON array
  - Processes each independently: per-user welcome email, skips existing emails, records errors
  - Returns `{ created: [], skipped: [], errors: [] }` summary
- Users who are invited must set their own password on first login — their temp password never persists

### New — Email Notifications for All User Events
- **Welcome email** — sent to every new user with their temporary credentials and role
- **Password changed** — security confirmation email after any password update (forced or voluntary)
- **Password expiry reminder** — urgency-coded email at 7, 3, 1 days before and on expiry day
- **Role change notification** — automatic email to user whenever their role is updated via the dashboard; triggered by any PUT to the users collection that changes the `role` field
- All emails use the branded InnoLearn HTML template with action CTAs

### New API Endpoints
| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/api/users/invite` | JWT (admin+) | Create user + send welcome email |
| `POST` | `/api/users/bulk-invite` | JWT (admin+) | Bulk create users, individual emails |
| `POST` | `/api/users/:id/role-change` | JWT (admin+) | Manual role-change notification |
| `POST` | `/api/auth/force-change` | Rate limited | Change expired/temp password → issues JWT |

---

## [3.3.0] — 2026-05-01  Security · Real-time Slug Check · 2FA · Trial Reminders

### New — Real-time URL Slug Availability Check
- As the admin types their school URL slug during registration, a **live availability indicator** appears instantly (500 ms debounce)
- **Green tick** = available; **Red warning** = already taken or reserved word
- Spinner shows while the check is in flight; indicator clears gracefully when offline
- Reserved words (`admin`, `api`, `platform`, `innolearn`, `www`, etc.) are blocked immediately without a server round-trip
- Slug also auto-checked when it is filled in automatically from the school name
- Server endpoint: `GET /api/onboard/check-slug` with a 60-request/minute rate limiter

### New — Auto-Logout After 10 Minutes of Inactivity
- Any authenticated session is silently **signed out after 10 minutes** of no keyboard, mouse, scroll, or touch activity
- At **9 minutes** an amber persistent toast appears with a "Stay signed in" button — clicking it resets the timer
- At **10 minutes** the session is destroyed and a "Signed out for security" toast is shown before returning to the login screen
- Idle timer resets on any of: `mousemove`, `mousedown`, `keydown`, `touchstart`, `scroll`, `click`
- Timer is checked every 30 seconds via `setInterval` (low CPU cost)

### New — Two-Factor Authentication (2FA) for Super Admin via Email
- When a **superadmin** signs in with a valid password, login is paused and a **6-digit OTP** is sent to their email address
- OTP is valid for **5 minutes**; a separate rate limiter (10 attempts / 5 min) prevents brute-force
- The login form is replaced by an OTP entry screen; a "Back to login" link cancels the attempt
- Expired OTP is cleared automatically; user is prompted to restart login to get a fresh code
- OTP stored as `mfaOtp` + `mfaExpiry` on the user document; cleared immediately on successful verify
- Future per-user opt-out supported via `mfaEnabled: false` flag on user record (superadmin only for now)

### New — Trial Expiry Reminders (Dashboard + Email)
- All school plans include a **30-day free trial** tracked by `school.trialEnds`
- **Dashboard banner** appears for superadmin and school admin when the trial has ≤ 7 days left:
  - 7 days left → blue info banner ℹ️
  - 2–3 days left → amber warning banner ⏰
  - 1 day left → red warning banner ⚠️
  - Expiry day → red critical banner 🚨
  - Banner disappears automatically once the trial period has passed
- **Email reminders** sent automatically at 7, 3, 1 days before and on the expiry day itself
- Deduplication: each milestone email is sent **at most once per day** using a date-keyed flag on the school record (`trialReminderSent_N`)
- Reminders triggered on login — no background job required

### Security
- `GET /api/onboard/check-slug` protected with rate limiter (60 req/min per IP)
- `POST /api/auth/verify-otp` protected with OTP-specific rate limiter (10 req / 5 min)
- Login now returns `mfaRequired: true` (no JWT issued) for superadmin until OTP is verified — token is never exposed before 2FA completion
- Auto-logout ensures sessions are never left open on shared or unattended devices

---

## [3.2.0] — 2026-05-01  School Approval Workflow · Email Notifications · Setup Wizard

### New — School Approval Workflow
- New schools registered via `/onboard` are created with **`status: 'pending'`** and **`isActive: false`** — they are **not** automatically activated
- Platform admin must **approve or reject** each registration from the Platform dashboard
- On approval: school + superadmin user are activated, welcome email sent to school admin, confirmation alert sent to platform owner
- On rejection: optional reason captured, rejection email sent to school admin
- Schools remain fully registered in the database during the pending period; no data is lost if rejected and re-applied

### New — Email Notifications (`server/utils/email.js`)
- Gmail SMTP transactional email via **nodemailer** (`innolearnnetwork@gmail.com`)
- **Registration received** → school admin gets "under review" confirmation with 24-hour timeline
- **New registration alert** → platform owner gets full school details + link to Platform dashboard
- **Approval welcome** → school admin gets login URL, credentials reminder, plan info
- **Rejection notice** → school admin gets reason (if provided) + re-application instructions
- **Approval self-alert** → platform owner copy of every approval action
- All emails use a branded HTML template with InnoLearn colours, responsive layout, and status badges

### New — Platform Dashboard: Pending Approvals Tab
- New **"Pending"** sidebar item with a **live red badge count** showing pending school registrations
- Each pending school displays: name, slug, admin name + email, city, country, curriculum, sections, plan, registration timestamp
- **Approve** button — one click activates the school and triggers welcome emails
- **Reject** button — opens a modal for optional rejection reason before sending notification
- Badge auto-updates after each action; "All clear" empty state when queue is empty
- Badge count loads automatically on platform admin login

### New — Login: Demo Role Selector Panel
- Replaced flat pill buttons with a **role card grid** (6 cards: Super Admin, Teacher, Parent, Finance, Student, Deputy)
- Each card shows role icon, name, and a one-line description of that role's scope
- Clicking a card fills credentials, highlights the card, and shows a green confirmation strip
- Panel is visible on `localhost`, `?demo=1`, and `?demo=innolearn` (case-insensitive)
- Super Admin role pre-selected when landing via `?demo=innolearn`

### New — Setup Wizard for New Schools
- Super Admin dashboard shows a **setup checklist card** on first login
- 7 steps with live **% completion progress bar**: Complete school profile · Set academic year & terms · Create classes · Add teaching staff · Enroll students · Configure fee structures · Set up report templates
- Each incomplete step is clickable and navigates directly to the relevant module
- Completed steps show a green tick and strikethrough label
- "Hide for now" link dismisses the wizard (stored per school in `localStorage`); reappears if reopened
- Wizard disappears automatically when all 7 steps are complete

### Changed — Curriculum Options
- Registration wizard curriculum chips updated to **Kenya-focused list**: CBE (Competency Based Education), IB, British (Cambridge / Edexcel), American Curriculum
- Chips redesigned from inline pills to **card layout** with bold name + subtitle description
- `CURRICULUM_META` resource links updated to match: KICD (CBE), IBO (IB), Cambridge International (British), College Board AP Central (American)

### Changed — T&C Checkbox → Launch Button Gate
- **Launch My School** button starts **disabled** with 50% opacity and a hint label
- Ticking the Terms of Service checkbox **enables** the button with smooth transition
- Cannot submit the registration form without explicitly agreeing — removes the old `alert()` fallback

### Changed — Registration Success Screen
- Two distinct states after submitting registration:
  - **Server mode (normal)**: shows amber "Application Submitted ⏳" with pending review message and email confirmation note
  - **Offline/fallback mode**: shows green "You're all set! 🎉" with portal link (unchanged behaviour)

### Changed — Pending School Login Block
- When a pending school admin tries to log in, the server returns `403 { error: 'pending_approval' }`
- Frontend replaces the login form with a friendly **"Application Under Review"** screen (amber icon, clear message, check-your-email prompt)
- Rejected schools see a toast with support email contact

### Security
- `server/routes/auth.js`: login now looks up user first **without** `isActive` filter, then checks school status before returning the appropriate error — gives specific feedback for pending vs rejected vs inactive accounts rather than a generic "wrong password" message

---

## [3.1.5] — 2026-04-30  Brand Rename: SchoolSync → InnoLearn

### Changed
- **Platform rebranded from SchoolSync to InnoLearn** across all 46 source files
- Demo school renamed from "Meridian International School" to **InnoLearn International School**
- All email domains updated: `@meridian.ac.ke` / `@schoolsync.edu.ke` → `@innolearn.edu.ke`
- All slugs, DB names, package names, and internal identifiers updated to lowercase `innolearn`
- `package.json` version bumped to `3.1.5`, name set to `innolearn`
- `render.yaml` service name and APP_URL updated to `innolearn-ecosystem`
- `.env.example`, seed utility, and all documentation updated to reflect new brand

---

## [3.1.4] — 2026-04-30  Platform Admin Dashboard & Demo Pill Security

### Added
- **`/platform` — Private Platform Admin SPA** (`platform.html` + `css/platform.css`)
  - Key-based lock screen — platform owner enters their `PLATFORM_ADMIN_KEY`; key verified against `/api/platform/stats`; stored in `sessionStorage` (clears on browser close)
  - Offline mode — accepts key ≥ 8 chars when server is unreachable; shows live data when connected
  - **Overview** — 4 stat cards (Total Schools, Total Students, KES MRR, ARR); plan breakdown grid
  - **Schools table** — name, slug, plan pill, status dot, student count, staff count, trial end date
  - **Actions per school**: Log In (impersonate → injects JWT → redirects to main app), Change Plan (dropdown modal), Suspend / Reinstate
  - **Provision School** form — create a new school directly from the platform dashboard
  - All API calls carry `X-Platform-Key` header; no cookies, no JWT for platform admin layer
- **Explicit `/platform` route** in `server/index.js` — serves `platform.html` cleanly (not just via `express.static`)
- Server health version bumped to `3.1.4`

### Changed
- **Demo pills hidden from production** — `id="demo-section"` div is `display:none` by default; only revealed on `localhost`, `127.0.0.1`, or when `?demo=1` is in the URL
- `js/app.js` boot logic updated: checks hostname + URL param before showing demo section; auto-fills InnoLearn credentials if `?demo=InnoLearn`

---

## [3.1.3] — 2026-04-30  School Registration Entry Points on Login Page

### Added
- **"New to InnoLearn? Get Started" CTA** on the login page — purple/indigo gradient card between the Sign In button and the demo pills; links directly to `onboard.html`
- **"Register your school →"** link in the login page left panel footer — subtle secondary entry point for schools that land on the main page
- Both entry points ensure any school visiting the login URL has a clear, unmissable path to self-register without needing to know the `/onboard` URL directly

---

## [3.1.2] — 2026-04-30  Curriculum & Section Selection in Onboarding

### New — Curriculum Selection
- Multi-select chip UI in Step 1: Cambridge, IB, CBC (Kenya), KCSE/KCPE, CAPS (S. Africa), WAEC/NECO, Uganda (UCE/UACE), Montessori, Custom/Mixed
- **Quick resource links** appear dynamically for each selected curriculum — direct links to Cambridge International, IBO, KICD, KNEC, DBE, WAEC, UNEB, AMI
- Curriculum stored on the school record (`curriculum[]`) and shown in the Review step and Success screen
- At least one curriculum required before advancing

### New — School Sections Picker
- 4 section cards in Step 1: **KG/Pre-Primary**, **Primary**, **Secondary**, **Sixth Form/A-Level**
- Each card shows the applicable levels (e.g. "Form 1–4 · Grade 7–12 · Year 7–11")
- At least one section required — clear inline error message if skipped
- Sections stored on the school record (`sections[]`)
- Shown in Review step summary

### System Integration — Section-aware Seeding
- `server/routes/onboard.js` — `_seedBaseData(schoolId, selectedSections)` now seeds **only the sections the school selected** (not all 4 by default)
- Each seeded section stores a `sectionKey` for reliable lookups
- App's Classes, Students, Timetable, Attendance modules naturally filter to the school's sections because every class references a `sectionId` — no further changes needed downstream
- A KG-only school sees only KG in dropdowns; a Secondary-only school sees no KG or Primary

---

## [3.1.1] — 2026-04-30  Onboarding Security Hardening & Documentation Expansion

### Changed
- **School Type dropdown**: removed "Charter", added "Tuition Centre"
- **"Try the InnoLearn demo →"** link added to the onboarding page left panel

### Security — Anti-bot Measures (onboarding)
- **Honeypot field**: hidden `ob-trap` field — if filled by a bot, registration is silently rejected server-side
- **Timing check**: server rejects submissions that arrive in under 4 seconds (bots fill forms instantly)
- **Institutional email warning**: UI advisory shown if user enters a free personal email (gmail, yahoo, hotmail, etc.) — not a block, just a nudge
- **Disposable email blocklist**: 25+ known disposable/temporary email domains blocked server-side at registration
- **Rate limiting** (pre-existing): 5 registrations per IP per hour — unchanged

### Deferred (documented, not yet built)
- **reCAPTCHA v3** — invisible challenge for onboarding form
- **2FA / TOTP** — authenticator app support for Super Admin accounts
- **Email OTP verification** — verify email ownership before school is provisioned (requires SMTP config)

### Documentation — New & Updated
- **`docs/PLATFORM_ADMIN_GUIDE.md`** (NEW) — Full guide for the InnoLearn platform owner: architecture, environment setup, Render deployment, provisioning schools via API, plan management, impersonation, MRR monitoring, security hardening checklist, backup/recovery, troubleshooting
- **`docs/SCHOOL_ADMIN_GUIDE.md`** (NEW) — Full guide for each school's Super Admin / IT admin: first-time setup checklist, academic years & terms, sections, classes, subjects, staff & roles, enrollment, permissions, billing, branding, data export, demo school access
- **`docs/USER_GUIDE.md`** updated to v3.1 with cross-links to both new admin guides

---

## [3.1.0] — 2026-04-30  School Onboarding / Self-registration Flow

### New — Onboarding Wizard (`onboard.html`)
- 4-step wizard: **School Details → Admin Account → Choose Plan → Review & Launch**
- Auto-generates URL slug from school name; user can edit; real-time sanitisation
- Password strength meter (very weak → strong)
- Auto-fills short name from school name initials
- Plan selector with 4 cards (Core / Standard / Popular-badged Standard / Premium / Enterprise); pre-selects Standard
- Review page summarises all entered data with a plan badge before submission
- Terms of Service checkbox gate before launch
- Animated step progress bar + left-panel step indicator with checkmarks
- Success screen shows school name, admin email, plan, and trial end date with auto-login link
- Fully responsive — left panel collapses on mobile

### New — Server Route (`server/routes/onboard.js`)
- `POST /api/onboard` — public, rate-limited (5 registrations/IP/hour)
- Validates required fields, email format, password length (≥ 8 chars)
- Checks slug uniqueness and email uniqueness in MongoDB
- Auto-generates slug from school name if not provided
- Creates school record with country-aware currency, currency symbol, and timezone
- Creates Super Admin user with bcrypt-hashed password (12 rounds)
- Seeds base data: academic year + 3 terms, 4 default sections (KG/Primary/Secondary/A-Level), full role_permissions for all 13 roles
- Issues JWT on success; also returns a `session` payload for localStorage-mode
- **Offline mode**: if MongoDB not connected, provisions offline (localStorage-only) — no JWT issued, plain-text password (demo environments only)
- `server/index.js` updated: mounts `/api/onboard`; SPA fallback serves `onboard.html` for `/onboard` route

### New — Styles (`css/onboard.css`)
- Fully custom styles for the onboarding wizard
- Left gradient panel with active/done step indicators and connecting lines
- Plan selection cards with hover, selected, and "Most Popular" badge states
- Password strength bar with colour transitions
- Slug preview with prefix label inside the input border

---

## [3.0.0] — 2026-04-28  SaaS Backend · Multi-tenancy · Subscription Plans

### New — Node.js/Express Backend API
- `server/index.js` — Express server; serves both the API (`/api/*`) and the static frontend from a single Render web service
- `server/config/db.js` — MongoDB Atlas connection via Mongoose; graceful no-op when `MONGODB_URI` is not set (localStorage-only mode)
- `render.yaml` updated — `buildCommand: npm install`, `startCommand: node server/index.js`, health check at `/api/health`
- `package.json` — added `express`, `mongoose`, `jsonwebtoken`, `bcryptjs`, `cors`, `express-rate-limit`

### New — Authentication (JWT)
- `POST /api/auth/login` — school-aware login with rate limiting (20 attempts/15 min); supports bcrypt hashed passwords with plain-text fallback during migration
- `GET /api/auth/me` — verify token and return current user
- `POST /api/auth/change-password` — bcrypt password update
- Frontend `Auth.login()` now tries server login first, falls back to localStorage if server unreachable
- JWT token stored in `localStorage`/`sessionStorage` via `DB.setToken()`/`DB.clearToken()`

### New — Multi-tenancy
- `server/middleware/tenant.js` — resolves school from JWT `schoolId`, `X-School-Slug` header, subdomain (`InnoLearn.InnoLearn.com`), or custom domain (`portal.theirschool.com`)
- Every API route auto-scopes data to the authenticated school's `schoolId`
- `server/middleware/auth.js` — JWT verification middleware + platform admin key middleware

### New — Generic CRUD API
- `server/routes/collections.js` — single router handles all collections: `GET/POST /api/collections/:col`, `PUT/DELETE /api/collections/:col/:id`, `POST /api/collections/:col/bulk`
- 25+ collections supported; all auto-filtered by `schoolId`

### New — Data Sync (Hybrid localStorage + Server)
- `GET /api/sync` — downloads all school data in one request; called on login to populate localStorage
- `POST /api/sync` — pushes entire localStorage to MongoDB (data migration tool)
- `data.js` updated: all writes mirror to server async (`_push()`); `syncFromServer()` and `pushToServer()` public API added
- Zero changes to any module — all DB calls remain synchronous via localStorage

### New — Platform Admin API
- `server/routes/platform.js` — protected by `X-Platform-Key` header
- `GET /api/platform/schools` — list all schools with student/staff counts
- `POST /api/platform/schools` — provision new school + superadmin account + base seed data
- `PATCH /api/platform/schools/:id` — change plan, addOns, status, expiry
- `POST /api/platform/schools/:id/impersonate` — get JWT for any school's superadmin (support tool)
- `GET /api/platform/stats` — MRR by plan, total schools, total students

### New — Subscription Plans & Feature Gating
- `js/modules/plans.js` — `Plans.can(module)` checks school plan against module access map
- **Core** (KES 15K/month): dashboard, students, admissions, classes, subjects, attendance, academics, exams, communication, events, reports, settings, help
- **Standard** (KES 35K/month): + timetable, behaviour
- **Premium** (KES 65K/month): + finance, hr
- **Enterprise** (custom): + lms, mobile, white-label
- Sidebar shows locked modules with 🔒 icon for non-subscribed features
- Navigating to a locked module renders a full **Upgrade Wall** with plan comparison and "Contact Sales" CTA
- Plan badge shown at the bottom of the sidebar (Core / Standard / Premium / Enterprise)
- `ROUTE_PLAN_GATE` map in `app.js` intercepts navigation to gated routes

---

## [2.7.1] — 2026-04-28  Birthday Calendar Popup

### Improved — Clickable Birthday Dots on Calendar
- **🎂 dot is now clickable** — clicking a birthday emoji on any calendar day opens a modal listing everyone who has a birthday on that date
- Modal shows: date header, each person's avatar (initials), name, role/class, and age; "Turns N! 🎉" gradient badge for today's birthdays; "Age N" for other dates
- Summary line at the bottom: "X celebrates their birthday on this day" (1 person) or "X people share this birthday" (multiple)
- Dot animates on hover (scales up) to hint interactivity; uses `event.stopPropagation()` so the day cell click does not interfere
- `Events.viewBirthdays(year, month, day)` — new public function; called inline from the calendar cell

---

## [2.7.0] — 2026-04-28  Birthday System

### New — Birthday Detection & Greetings
- **`js/modules/birthday.js`** — new `Birthday` IIFE module; automatically detects birthdays for all active students and staff
- **Own birthday modal** — when the logged-in user's birthday is today, a celebratory full-screen modal appears ~1 second after login (name, turning age with ordinal, gradient button)
- **Staff toast notifications** — admin, teacher, deputy, discipline, section_sec, and hr roles receive a toast for each other person whose birthday is today
- **Notification bell injection** — today's birthdays are prepended to the notification dropdown with a pink left-border and 🎂 icon; badge count increments
- **Dashboard birthday card** — a `Birthdays` card appears on the admin dashboard (between stats and charts) showing:
  - Today's celebrants: pink gradient avatar, name, "Turns N!" badge, role/class
  - Upcoming birthdays (next 7 days): grey avatar, countdown in days, formatted date
  - Card is hidden entirely if no birthdays today or within 7 days
- **Calendar birthday indicators** — every day cell in the Events calendar that has a birthday shows a 🎂 emoji next to the date number; hovering reveals all names

### Technical
- `Birthday.todaysBirthdays()` — returns all people whose MM-DD matches today
- `Birthday.upcomingBirthdays(days=7)` — returns people with birthdays in the next N days, sorted ascending
- `Birthday.birthdaysOnDate(year, month, day)` — used by the calendar for per-cell birthday lookup
- `Birthday.dashboardCard()` — returns full HTML string or `''` if nothing to show
- Birthday comparison uses `MM-DD` only (annual recurrence; birth year ignored)
- `_daysUntil()` handles year rollover correctly
- `Birthday.init()` called from `App._showApp()` after `_buildNotifications()`
- `SEED_VERSION` bumped to `'18'`; demo DOBs updated: Emily Johnson + Grace Kamau → Apr 27 (today); Brian Omondi → Apr 29; James Ochieng → May 1

---

## [2.6.0] — 2026-04-27  Dynamic Branding · Login Page Personalization · Immersive Login Layout

### New — Dynamic Branding (Settings → Branding, Super Admin only)
- **Logo upload** — upload PNG/SVG/JPG (max 2 MB); logo replaces the graduation-cap icon in the sidebar header; stored as base64 in `localStorage`
- **Favicon upload** — upload square image (max 512 KB); updates the browser tab icon live; stored as base64
- **App Name** — rename "InnoLearn" everywhere: sidebar header, browser title, login page brand
- **6 Quick Preset Themes** — Ocean Blue, Emerald, Violet, Rose, Amber, Cyan; one click applies primary + sidebar color pair
- **Custom Color Pickers** — independent hex + native color-picker for Primary accent and Sidebar background; live mini-preview sidebar updates in real time
- `App.applyBranding()` — called on every login; injects `<style id="ss-theme">` with derived CSS variable overrides (`--primary`, `--primary-dark`, `--primary-darker`, `--primary-light`, `--primary-glass`, `--sidebar-bg`, `--sidebar-active`)
- Color derivation: `_shadeColor(hex, amt)`, `_mixWithWhite(hex, ratio)`, `_hexToRgb(hex)` helpers in `app.js`
- Branding stored in `schools[0]`: `{ logo, favicon, appName, theme: { primary, sidebarBg } }`
- `BRANDING_UPDATED` and `BRANDING_RESET` audit entries

### New — Login Page Personalization (Settings → Branding, Super Admin only)
- **5 Canvas Animation Effects** — `Particles`, `Aurora`, `Water`, `Clouds`, `Fire`; select via visual picker; effect + color saved and applied on login screen show
- **Effect Color Picker** — custom color applied to particles / aurora waves / water layers
- **Editable Login Content**:
  - Welcome title and subtitle (right panel form header)
  - Tagline under the logo (left panel)
  - Footer copyright text (left panel)
  - All 4 feature highlight cards — title and description editable
- **Social Media Links** — Facebook, X/Twitter, Instagram, LinkedIn, WhatsApp, YouTube; blank = hidden; rendered as circular icon buttons on the left panel
- `LoginFX` IIFE (`app.js`) — canvas animation engine with `start(effect, color)` / `stop()` API; 5 independent animation loops using `requestAnimationFrame`; auto-resizes canvas on window resize
- `_applyLoginPage(school)` — called from `_showLogin()`; reads `schools[0].loginPage`; updates all DOM elements and starts `LoginFX`
- `LoginFX.stop()` called from `_showApp()` to clean up animation on login
- Stored in `schools[0].loginPage`: `{ effect, effectColor, welcomeTitle, welcomeSub, tagline, footerText, features[], social{} }`
- `LOGIN_PAGE_UPDATED` and `LOGIN_PAGE_RESET` audit entries

### Changed — Immersive Login Layout (Option B)
- **Canvas is now full-screen** — animation covers the entire login screen (both left and right halves), not just the left panel
- **Left panel is a transparent overlay** — branding content floats above the canvas; old decorative pseudo-element orbs removed
- **Sign-in form is a floating card** — white `rgba(255,255,255,0.97)` card with 22px border-radius, deep shadow, and `loginCardFloat` keyframe animation (12px vertical travel, shadow deepens as card rises to simulate real light physics)
- **Dot-grid texture** (`login-grid`) moved to full-screen direct child of `login-screen`
- Mobile (≤1024px): float animation disabled, card fills screen normally

---

## [2.5.0] — 2026-04-27  Data Integrity II · Events Bug Fix · Delete Guards · Permission Guards

### Fixed — Events Calendar
- **Events do not appear on calendar after save/update** — after saving or updating an event, the calendar now navigates to the event's month automatically (parses `startDate` string to avoid UTC timezone shift)
- **Seed events invisible** — all 10 seed event dates shifted from 2025 to 2026 to match the current academic year; `SEED_VERSION` bumped to `17`
- **Empty calendar months** — calendar view now shows a "No events in [Month]" message when a month has no events

### New — Validators: Subject & User Delete Guards
- **`Validators.canDeleteSubject(id)`** — blocks if subject is referenced in timetable slots, class–subject assignments, or grade records
- **`Validators.canDeleteUser(id)`** — blocks if user is a homeroom teacher, assigned to timetable slots, or has a linked student record; also prevents self-deletion

### New — Room Conflict Check (Timetable)
- **`Validators.timetableSlot()`** now checks room conflicts: same room, same day, same period across all classes is blocked with the name of the conflicting class

### Changed — Subject Catalogue
- **Delete subject** — admins can now delete subjects directly from the catalogue; `canDeleteSubject` guard applied; `SUBJECT_DELETED` audited
- **Hardcoded `ay2025`** in `saveAssignments()` replaced with `SchoolContext.currentAcYearId()`

### Changed — Settings: User Management
- **Delete user** — admins can delete user accounts; `canDeleteUser` guard blocks destructive deletes; self-deletion prevented; `USER_DELETED` audited

### Changed — Admissions Enrollment (Validate-First)
- `enrollStudent()` now runs three pre-flight checks **before** any DB write: class still exists, email unique, admission number unique
- `STUDENT_ENROLLED` audit entry added (applicationId, studentId, userId, admissionNo, classId)

### Changed — Permission Guards (Remaining Write Operations)
- `exams.js saveExam()` — `exams.create` permission required; hardcoded `ay2025` replaced with `SchoolContext.currentAcYearId()`; `EXAM_CREATED` / `EXAM_UPDATED` audited
- `exams.js deleteExam()` — `exams.delete` permission required; uses `confirmAction()` instead of native confirm; `EXAM_DELETED` audited
- `classes.js save()` — `isAdmin()` check enforced in logic; `CLASS_CREATED` / `CLASS_UPDATED` audited; null guard on optional homeroomTeacherId

---

## [2.4.0] — 2026-04-27  Data Integrity — Validators · ENUMS · Guards · Timetable Integrity

### New — ENUMS Constant (`data.js`)
- `ENUMS` object (frozen) defines the canonical value set for every status/type field in the system
- Covers: `studentStatus`, `incidentType`, `appealStatus`, `invoiceStatus`, `attendanceStatus`, `applicationStatus`, `gender`, `paymentMethod`, `userRole`, `examStatus`, `leaveStatus`, `payrollStatus`
- Single source of truth — no more inline string literals for statuses

### New — Central Validators (`js/validators.js`)
- New file loaded immediately after `data.js`, before all modules
- Every validator returns `null` (valid) or a human-readable error string (invalid) — never throws
- **`Validators.student(data, id)`** — required fields, status enum, classId FK, unique admissionNo
- **`Validators.user(data, id)`** — required fields, role enum, unique email
- **`Validators.cls(data, id)`** — required fields, sectionId FK, homeroomTeacherId FK, unique class name per section
- **`Validators.timetableSlot(slot, ttId, editDay, editPeriod)`** — subjectId FK, teacherId FK, teacher double-booking (BLOCKS, not just warns)
- **`Validators.payment(amount, invoice)`** — amount positive, invoice exists, invoice not already fully paid
- **`Validators.incident(data)`** — studentId FK, type enum
- **`Validators.canDeleteStudent(id)`** — blocks if open appeals or unpaid invoices
- **`Validators.canDeleteClass(classId)`** — blocks if students enrolled or timetable entries exist
- **`Validators.canDeleteYear(id)`** — blocks if current year or classes linked to it
- **`Validators.canDeleteSection(sectionId)`** — blocks if classes exist in section

### Changed — Write Sites (Referential Integrity + Validation)
- `students.js save()` — now calls `Validators.student()` before DB write; replaces old ad-hoc checks
- `students.js deleteStudent()` — now calls `Validators.canDeleteStudent()`: blocks on open appeals **and** unpaid invoices
- `settings.js saveUser()` — now calls `Validators.user()` before DB write; catches duplicate emails
- `settings.js saveGradeClass()` — now calls `Validators.cls()` before DB write; catches duplicate class names per section
- `settings.js deleteYear()` — now calls `Validators.canDeleteYear()`: also blocks if classes are linked
- `settings.js deleteSection()` — now calls `Validators.canDeleteSection()`
- `settings.js deleteClass()` — now calls `Validators.canDeleteClass()`: also blocks if timetable entries exist; cascades timetable cleanup on confirmed delete
- `finance.js savePayment()` — now calls `Validators.payment()` before DB write; blocks recording on already-paid invoices
- `behaviour.js saveIncidentNew()` — now calls `Validators.incident()` to verify student exists before logging
- `timetable.js saveSlot()` — teacher double-booking now **blocks** save (previously only warned); subject and teacher FK integrity verified; uses `SchoolContext` for new timetable records

### Changed — Permission Enforcement on Writes
- `finance.js savePayment()` — permission check: `finance.create` required
- `behaviour.js saveIncidentNew()` — permission check: `behaviour.create` required
- `settings.js setCurrentYear()` — restricted to admin/superadmin roles in logic (not just UI)

### Changed — Audit Before/After
- `PAYMENT_RECORDED` now includes `before: { paidAmount, balance, status }` and `after: { paidAmount, balance, status }`
- `APPEAL_RESOLVED` now includes `before: { appealStatus, incidentStatus }` and `after: { appealStatus, incidentStatus }`

### Changed — Test Layer (8 new suites)
- `_testENUMS()` — verifies ENUMS exists, is frozen, and contains expected values
- `_testValidators()` — 20+ checks: rejection of invalid data, acceptance of valid data, FK checks, duplicate detection, delete guard checks

---

## [2.3.0] — 2026-04-27  Architecture Phase B · Audit Log · Guards · Tests

### New — Audit Log System
- Global `_audit(action, details)` function added to `app.js`
- Writes immutable entries to the `audit_log` localStorage collection
- **Never blocks** the primary action — errors are swallowed with a `console.warn`
- Five critical operations now produce audit entries:
  - `STUDENT_UPDATED` — student profile edit (includes changed field diff for classId, status, houseId)
  - `STUDENT_DELETED` — student removal (preserves name, admissionNo, classId)
  - `PAYMENT_RECORDED` — finance payment (amount, method, reference, new balance, new status)
  - `APPEAL_RESOLVED` — behaviour appeal accepted/rejected/escalated (includes student name, outcome, resolution note)
  - `ACADEMIC_YEAR_CHANGED` — when admin sets the current academic year
  - `ACADEMIC_YEAR_DELETED` — when an academic year is deleted
  - `PERMISSION_CHANGED` — each individual role permission checkbox toggle

### New — Critical Operation Guards
- **Delete Student**: now blocked if the student has any open appeals (pending or escalated) — must resolve appeals first
- **Delete Academic Year**: already guarded (cannot delete current year) — unchanged; audit log now also fires on deletion
- **Delete Class**: already guarded (cannot delete if students enrolled) — unchanged

### New — Browser Test Layer (`js/tests.js`)
- `InnoLearnTests.run()` — callable from browser console at any time
- Auto-activates when the URL includes `?tests=1`
- Six test suites: DB Layer · SchoolContext · Global Utilities · Seed Data Integrity · Audit Log · Behaviour Module
- Uses `console.assert` — failures print to console without crashing the app
- Summary toast at the end: `✓ N passed` or `✗ N failed — see console`
- Test file loaded after `app.js` in `index.html`

---

## [2.2.0] — 2026-04-27  Architecture Phase A · Core Utilities

### New — SchoolContext Helper (`data.js`)
- `SchoolContext` IIFE added immediately after DB initialisation
- API: `school()` · `currentTermId()` · `currentAcYearId()` · `currentTerm()` · `currentAcYear()`
- Single source of truth for the live school record, active term, and active academic year
- Replaces all hardcoded `|| 'term2'` and `|| 'ay2025'` fallbacks across every module

### New — Global Utility Functions (`app.js`)
- **`assert(condition, message)`** — throws a descriptive `Error` if `condition` is falsy; logs to console. Use before `DB.insert` / `DB.update` to surface bad data immediately.
- **`safe(fn, label)`** — wraps any UI action handler; catches unexpected errors and shows a user-friendly toast instead of silent failures or crashes.
- **`isOverlapping(aStart, aEnd, bStart, bEnd)`** — returns `true` when two HH:MM time ranges overlap (exclusive boundary: ranges that touch but don't overlap return `false`). Used for clash detection in timetable and scheduling logic.

### Changed — Dynamic Export (`settings.js`)
- `exportData()` no longer maintains a hardcoded list of collection names
- Now dynamically scans localStorage for all `ss_` prefixed keys and exports every collection automatically — new collections added in future versions are included without requiring a code change

### Removed — Dead Code
- `js/modules/teachers.js` deleted — this file was never loaded (`teachers` route was already redirected to `HR.render()` in `app.js`); `Teachers` object was unused

### Fixed — Hardcoded Fallbacks
- All `Auth.currentSchool?.currentTermId || 'term2'` and `Auth.currentSchool?.currentAcademicYearId || 'ay2025'` fallbacks replaced with `SchoolContext.currentTermId()` / `SchoolContext.currentAcYearId()` in:
  - `behaviour.js` — `_dashboardView`, `_registerView`, `_appealsView`, `saveIncident`, `saveIncidentNew`, `generateReport`
  - `academics.js` — state initialisation (`_selectedTerm`, `_selectedAcYear`, `_lpTerm`, `_lpYear`, `_rptTerm`, `_rptYear`)
  - `classes.js` — `saveClass`
  - `settings.js` — `saveGradeClass`

---

## [2.1.1] — 2026-04-27  Log Modal Class Filter

### Changed — Log Incident Modal
- Added **Filter by Class** dropdown above the Student field in the log modal
- Student list automatically narrows to only students in the selected class; selecting a different class resets the student selection
- A live count label shows how many students are in the selected class (e.g. "12 students in Grade 9B")
- Choosing "All Classes" restores the full role-scoped student list
- Class and date selections are both preserved across type/category/behaviour changes in the same modal session

### Confirmed — House Points Flow
- Logging any incident automatically updates the House Cup: merit incidents add `+pts` to the student's house total; demerit incidents subtract `−pts`
- The `housePoints` field is saved per incident and summed by `_housePts()` across all students in each house for the selected period
- House Cup standings on the dashboard reflect the change immediately on the next render

---

## [2.1.0] — 2026-04-27  Behaviour Category System · Guided Log Modal

### New — Pre-seeded Default Behaviour Categories
- Eight SAA BPS v2 matrix groups are now pre-seeded as **default categories** in `behaviour_settings.categories` (SEED_VERSION 15 → 16):
  - Classroom & Academic · Corridors & Common Areas · Sports, PE & Extracurricular
  - Interpersonal Relationships · School Rules, Safety & Property · Dining Hall & Shared Spaces
  - Digital Citizenship & Technology · Leadership & Community Service
- Each category carries an `icon`, `color`, `matCat` (links to matrix items), and `isDefault` flag
- Admin can **rename, recolour, or delete** any category from **Settings → Behaviour → Categories**
- Admin can **add custom categories** with a fixed point value (applied as +pts for merit / −pts for demerit)

### Changed — Log Incident Modal (Guided 3-Step Flow)
- **Removed**: Source toggle (Standard Matrix / Custom Category) — category selection now replaces it
- **New flow**: `Step 1 — Type (Merit / Demerit)` → `Step 2 — Category` → `Step 3 — Behaviour`
- Step 2 shows all categories as a visual 2-column grid with icons, colours, and live item counts for the selected type
- Step 3 automatically shows **only the behaviours matching the selected type** within the chosen category
  - Matrix-backed categories: scrollable item list with search, locked point values, selected item preview card
  - Custom categories: fixed point value display only (no item list needed)
- Selecting a different type (Step 1) or category (Step 2) resets the behaviour selection without losing the student/date
- `Leadership & Community Service` shows "No demerit behaviours" when Demerit is selected (correct — matrix has no demerits for this group)

### Changed — Settings → Categories Panel
- Categories panel redesigned: single unified table (no longer split into Merit / Demerit columns)
- Columns: Category (icon + name + default badge) · Linked To (Standard Matrix or Custom) · Merits (item count or fixed pts) · Demerits (item count or fixed pts) · Actions
- Edit modal for matrix-backed categories shows an informational note and excludes the "fixed points" field (points are set per item in the matrix)
- Edit modal for custom categories includes a "Fixed Points" field

### Technical
- `_logState` simplified: `source`, `matCat`, `customCatId` removed; replaced by single `catId` field
- New public function `Behaviour._logSetCat(catId)` — replaces `_logSetSource` and `_logSetGroup`
- `_logSetSource`, `_logSetGroup`, `_logSetCustomCat` converted to legacy no-ops for backward compat
- `saveIncidentNew()` path detection now uses `selCat.matCat` (matrix) vs `selCat.customPoints` (custom)
- Fixed: matrix item `pts` field now correctly read as `item.pts || item.points` throughout modal

---

## [2.0.0] — 2026-04-26  Behaviour System v2 · Extended Roles · House Overhaul

### New — Roles
- Added `deputy_principal` role with full behaviour oversight and appeal escalation rights
- Added `discipline_committee` role for disciplinary panel membership
- Added demo login pills for both new roles on the login screen

### New — House System Overhaul
- Four official houses: **Impala** (Yellow), **Simba** (Red), **Twiga** (Green), **Chui** (Blue)
- House IDs changed from `h1–h4` to semantic IDs (`yellow`, `red`, `green`, `blue`)
- Houses carry `bg`, `border`, and `badge` fields for consistent UI theming
- House assignment added to the **Admissions approval** workflow
- House shield badge, avatar tint, and info panel added to **Student profiles**
- House column added to **Students list** table
- House dropdown added to **Student edit modal**

### New — Behaviour Module v2 (Phase 1: Foundation)
- Period filter pills on Dashboard and Register: **Weekly / Monthly / Termly / All Time**
- **Register** tab replaces old "Incidents" tab; legacy `#incidents` hash redirects automatically
- **Appeals** tab added (placeholder with live pending-count badge in tab header)
- Incident `status` field introduced: `active` | `appealing` | `overturned`
- Status column added to Register table with filter (All / Active / Under Appeal / Overturned)
- All incident display updated to use `note` field (with `description` fallback for legacy data)
- `saveIncident()` now saves `status: 'active'` and `createdAt` timestamp

### New — Behaviour Module v2 (Phase 2: Log Modal)
- Old simple dropdown log modal replaced with dual-source modal
- **Standard Matrix** source: browse 120+ locked SAA BPS v2 behaviours across 8 categories
  - Categories: Classroom & Academic, Corridors & Common Areas, Sports/PE/ECA, Interpersonal, School Rules, Dining Hall, Digital Citizenship, Leadership & Community Service
  - Group tabs on left, scrollable item list on right, live search across all categories
  - Points auto-fill and lock on selection; preview card shows selected behaviour
- **Custom Category** source: admin-created categories with free-point entry (unchanged)
- **Serious Incident Note**: any incident with `|points| ≥ seriousIncidentThreshold` (default 5) blocks submission until a detailed note is typed
- Modal state persists across inner refreshes (student/date selections survive type/source/group changes)

### New — Behaviour Module v2 (Phase 3: Appeals System)
- Full 3-layer appeals workflow:
  1. **Student** submits appeal against any active demerit (one appeal per incident)
  2. **Staff** (teacher / section_head / deputy / discipline) reviews and accepts, rejects, or escalates
  3. **Parent** can add a supporting note to any pending appeal for their child
- Incident status lifecycle: `active` → `appealing` (on submit) → `overturned` / `active` (on resolution)
- `behaviour_appeals` DB collection stores full audit trail (reason, parent note, resolution, resolved-by, timestamp)
- Escalation restricted to `deputy_principal`, `discipline_committee`, `admin`, `superadmin`
- Student view: "My Appeals" table + "Eligible to Appeal" list with Appeal buttons on each active demerit
- Parent view: child's appeals with Add/Edit Note buttons + resolved appeals history

### New — Behaviour Module v2 (Phase 4: Dashboard Enhancements)
- **Stage Alerts panel**: all students currently at a demerit stage (half-term window), sorted by stage descending
- **Persistent Behaviour Patterns panel**: same `behaviourId` logged ≥ 2 times in the selected period; shows student, behaviour label, count badge, last date
- `_getCurrentStage()` updated to respect `cfg.demeritWindow`: uses rolling half-term window (`halfTermWeeks`, default 7) when set to `'halfterm'`
- At-risk student list on dashboard now uses half-term demerit window (consistent with stage thresholds)

### New — Behaviour Module v2 (Phase 5: PDF Report + Settings)
- **Generate Report** button in page header (visible to staff with `_canSeeAll()` permission)
- Printable PDF report opens in new window; auto-triggers `window.print()`. Sections:
  - Summary stats (5 KPI boxes)
  - House Cup standings with colour bars
  - Stage Alerts table
  - Persistent Patterns table (up to 20 rows)
  - Full Student Behaviour Summary (new print page)
  - Staff Activity log
- **Settings → Behaviour Matrix** tab: read-only browser of all 120 standard items, grouped by category, with live type filter + search. Locked items cannot be edited or deleted.

### Updated — Seed Data (SEED_VERSION 14 → 15)
- `behaviour_settings` completely replaced:
  - `demeritWindow: 'halfterm'`
  - `seriousIncidentThreshold: 5`
  - `matrix`: 120+ items with locked SAA BPS v2 point values
  - Milestones: Bronze (25), Silver (50), Gold (100), Principal's Award (200), Platinum KS5-only (300)
  - Stages: 5 levels at 5 / 10 / 20 / 35 / 50 cumulative demerit pts
  - Houses: Impala / Simba / Twiga / Chui with semantic colour IDs
- `behaviour_incidents` seed updated: uses `behaviourId`, `note`, `status: 'active'`
- `behaviour_appeals` collection added (empty seed)
- Student house assignments applied via `_houseMap` post-seed

---

## [1.8.0] — Behaviour Module v1

### New
- **Behaviour & Pastoral** module added to sidebar
- Merit and demerit incident logging with admin-configurable categories
- **House Cup**: school houses compete for points; standings shown on dashboard
- **Merit Milestones**: threshold-based achievement badges awarded automatically on logging
- **Demerit Intervention Stages**: escalating response levels triggered by cumulative points
- **Detention scheduling**: create, track, complete, and cancel detention sessions
- Automated parent notifications on milestone achievement and stage crossing
- At-risk students panel and top merit earners leaderboard on dashboard
- Settings sub-tabs: Categories, Merit Milestones, Demerit Stages, Houses, Key Stages, Detention Types

---

## [1.7.0] — Settings & Permissions

### New
- **Settings** module with school-wide configuration
- Granular role-based permission system (`role_permissions` DB table)
  - Per-module, per-action controls (view / create / edit / delete)
  - Sub-module granularity (e.g. `behaviour.appeals`, `finance.invoices`)
- Multi-section school support: KG, Primary, Secondary, A-Level sections configurable
- Academic Year and Term management (dates, current term pointer)
- Key Stages configuration (grade groupings for analytics)
- Role management and user permission overrides

---

## [1.6.0] — HR & Staff Management

### New
- **HR & Staff** module replacing the earlier standalone Teachers page
- Staff profiles: personal details, employment type, subject assignments, homeroom class
- Contract and employment date tracking
- Department and role assignment
- Teachers route (`#teachers`) redirected to HR module for backward compatibility

---

## [1.5.0] — Communication & Events

### New
- **Communication Hub**: internal messaging between staff, parents, and students
- Role-scoped message visibility (teachers see class-related messages; parents see their children's)
- Notification system wired to topbar bell icon with unread badge
- **Events & Calendar** module: school-wide and class-specific events
- Calendar grid view with event creation and detail modals

---

## [1.4.0] — Financial Management

### New
- **Finance** module: fee structures, invoice generation, payment recording
- Per-student invoice tracking (paid / partial / overdue status)
- Payment history and receipt generation
- Financial dashboard: outstanding balances, collection rate, recent transactions
- Overdue alerts with automated notification hooks

---

## [1.3.0] — Admissions Pipeline

### New
- **Admissions** module: application intake, stage-based pipeline management
- **Public application form** accessible at `#apply/<token>` without login — shareable URL
- Admissions stages: Inquiry → Application → Review → Interview → Decision → Enrolled
- Approval workflow: approve application → auto-create student record with class and year group
- Application detail view with document checklist and status history

---

## [1.2.0] — Academic Progress & Assessment

### New
- **Academics / Gradebook**: marks entry per subject per student, weighted grade computation
- Cambridge and IB grade boundary support alongside custom percentage grading
- **Exams** module: exam creation, scheduling, invigilator assignment, result recording
- **Reports & Analytics**: term report generation, class performance breakdowns, subject analysis

---

## [1.1.0] — Academic Infrastructure

### New
- **Subjects & Curriculum**: subject creation with Cambridge/IB/custom curriculum tagging
- Subject assignment to classes and key stages
- **Timetable**: period-based weekly schedule builder
  - Drag-and-drop slot assignment (subject, teacher, room)
  - Clash detection across teachers and rooms
- **Attendance**: daily class registers
  - Present / Absent / Late / Excused status per student
  - Attendance percentage calculation and trend tracking
  - Bulk mark-present functionality

---

## [1.0.0] — Foundation Release

### New
- **App shell**: responsive sidebar, collapsible on mobile, topbar with search and notifications
- **Authentication**: email/password login, remember-me, demo credential pills (8 roles)
  - Roles: superadmin, admin, teacher, parent, student, finance, section_head
  - JWT-style session stored in localStorage
- **Hash-based routing**: `#route/param` pattern; back-button aware
- **Modal system**: stacked modals with overlay, size variants (sm / md / lg)
- **Toast notifications**: success / warning / error / info with auto-dismiss
- **Dashboard**: school KPI cards, recent activity feeds, quick-action buttons
- **Students**: full student profiles (personal, academic, guardian, medical), enrollment management, admission number generation
- **Classes & Sections**: class creation, section grouping (KG / Primary / Secondary / A-Level), homeroom teacher assignment
- Seeded demo data: 20 students, 6 teachers, 4 sections, sample academic year and terms
- Global search (students by name or admission number)
- Role-filtered sidebar navigation (modules visible based on permissions)
