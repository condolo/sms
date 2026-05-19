# Msingi — Changelog

All notable changes to Msingi (formerly InnoLearn) are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

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
