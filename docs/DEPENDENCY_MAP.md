# Msingi Platform — Module Dependency Map
> Phase 0 Integration & Dependency Blueprint  
> Last updated: 2026-05-26  
> Purpose: Before any change to a module, consult this map to identify every module that will be affected.

---

## How to read this document

Each module entry lists:
- **Collections written** — MongoDB collections this module owns / writes to
- **Collections read from other modules** — foreign collections queried
- **Route-level cross-imports** — `require()` calls to other route files or utils
- **Client API calls** — frontend modules that call this route
- **Downstream blast radius** — if this module breaks, what breaks with it
- **Integrity notes** — known coupling risks

---

## Platform Topology

```
                    ┌─────────────┐
                    │  auth.js    │  JWT issuer
                    │  users.js   │  user profiles
                    │  settings.js│  school config
                    └──────┬──────┘
                           │ schoolId scoping (all modules)
          ┌────────────────┼────────────────────────────┐
          │                │                            │
   ┌──────▼──────┐  ┌──────▼──────┐           ┌────────▼───────┐
   │  students   │  │  teachers   │           │  academic-config│
   │  classes    │  │  hr.js      │           │  (mergeConfig)  │
   └──────┬──────┘  └──────┬──────┘           └────────┬───────┘
          │                │                            │
   ┌──────▼────────────────▼──────────────────────────▼─┐
   │              ACADEMIC CORE                          │
   │  grades → exams → report-cards                      │
   │  attendance                                         │
   │  timetable (+ bell-schedule + substitutions)        │
   └──────────────────────────┬──────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
  ┌─────▼──────┐      ┌───────▼──────┐    ┌────────▼──────┐
  │  finance   │      │   messages   │    │  admissions   │
  │  (invoices)│      │  events      │    │  behaviour    │
  └────────────┘      └──────────────┘    └───────────────┘
```

---

## Module Reference

---

### 1. `auth` — `/api/auth`
**Collections written:** `users`, `schools`  
**Collections read:** `users`, `schools`, `role_permissions`  
**Cross-imports:** `utils/jwt.js`, `utils/email.js`, `middleware/auth.js`  
**Client consumers:** every page (login, token refresh, OAuth)  
**Blast radius if broken:** ENTIRE PLATFORM down — all protected routes require JWT from this module  
**Integrity notes:**
- JWT encodes `{ userId, schoolId, role, roles }` — every module trusts this payload without re-querying
- If `role` or `schoolId` changes in users collection, old tokens remain valid until expiry (TTL risk)
- OAuth (Google/Microsoft) flows through this module; env vars `GOOGLE_CLIENT_ID`, `MS_CLIENT_ID` must stay set

---

### 2. `users` — `/api/users`
**Collections written:** `users`, `user_photos`  
**Collections read:** `schools`  
**Cross-imports:** `middleware/auth.js`, `utils/email.js`  
**Client consumers:** Settings → Users, Profile page  
**Blast radius if broken:** user profile edits fail; avatar uploads fail  
**Integrity notes:**
- `users.userId` is the canonical ID format used by `timetable.teacherId`
- Role changes here do NOT invalidate the RBAC in-memory cache — must call `invalidatePermCache(schoolId)` manually
- `user_photos` stores base64 or URLs; no cleanup on user deletion

---

### 3. `students` — `/api/students`
**Collections written:** `students`  
**Collections read:** `classes` (for enrollment validation)  
**Cross-imports:** none  
**Client consumers:** Students page, Classes page, Report Cards, Attendance, Finance, Platform admin  
**Blast radius if broken:** attendance records become orphaned; report-card generation fails (student name lookup); finance invoice generation fails  
**Integrity notes:**
- `students.id` (e.g. `stu_abc123`) is used as FK in: `attendance`, `grades`, `exam_results`, `report_card_snapshots`, `behaviour_incidents`, `invoices`
- Deleting a student leaves dangling FKs in all of the above — **no cascade delete implemented**
- `students.classId` must match a valid `classes.id` — not enforced at DB level

---

### 4. `classes` — `/api/classes`
**Collections written:** `classes`  
**Collections read:** `students` (count only)  
**Cross-imports:** none  
**Client consumers:** Classes page, Timetable, Attendance, Report Cards, Grades, Exams  
**Blast radius if broken:** timetable class grid shows no classes; report card generation requires `classId`; attendance session creation requires `classId`  
**Integrity notes:**
- `classes.id` (e.g. `cls_demo_4a`) is used as FK in: `timetable`, `grades`, `exam_results`, `attendance`, `report_card_snapshots`, `exams`
- **Critical:** timetable slots store `classId` as the string `id` field, NOT MongoDB `_id` — any client rendering class dropdowns must use `c.id ?? String(c._id)` as the option value
- Deleting a class leaves timetable slots orphaned — no cascade

---

### 5. `teachers` — `/api/teachers`
**Collections written:** `teachers`  
**Collections read:** none  
**Cross-imports:** none  
**Client consumers:** Teachers page, Timetable, HR, Events  
**Blast radius if broken:** timetable teacher picker shows no teachers; conflict resolution fails; workload panel fails  
**Integrity notes:**
- `teachers.userId` (e.g. `u_demo_t3`) is the FK stored in `timetable.teacherId` — NOT `teachers.id` or `teachers._id`
- Teacher names are **denormalised** into `timetable.teacherName` at slot create/update time — stale if teacher is renamed
- Deleting a teacher does NOT clean up timetable slots with that teacherId

---

### 6. `timetable` — `/api/timetable`
**Collections written:** `timetable`, `timetable_versions`, `substitutions`  
**Collections read:** `classes`, `teachers`, `students`, `schools`, `users`  
**Cross-imports:** `routes/bell-schedule.js` (resolveBellSchedule)  
**Client consumers:** TimetablePage, TimetablePortal (student/parent read-only)  
**Blast radius if broken:** class grids empty; teacher schedules unavailable; conflict detection offline; substitution management offline  
**Integrity notes:**
- Publish writes a version snapshot to `timetable_versions` + updates `schools.timetablePublished`
- Conflicts endpoint does batch teacher name + class name resolution — requires `teachers` and `classes` collections to be healthy
- `teacherId` field stores `users.userId` format — must match across all lookups
- Portal access is role-gated: non-admin roles see `TimetablePortal`, not the edit grid

---

### 7. `bell-schedule` — `/api/bell-schedule`
**Collections written:** `bell_schedules`  
**Collections read:** none  
**Cross-imports:** exported `resolveBellSchedule()` used by `timetable.js`  
**Client consumers:** TimetablePage (Bell button), BellScheduleSlideOver  
**Blast radius if broken:** timetable period rows render with default bell (fallback hardcoded in `constants.js`) — degraded but functional  
**Integrity notes:**
- `resolveBellSchedule(schoolId, section)` is the single source of truth for period times
- Changing a bell schedule does NOT retroactively update published timetable versions

---

### 8. `academic-config` — `/api/academic-config`
**Collections written:** `academic_config`, `academic_years`  
**Collections read:** `exams`, `report_card_snapshots`, `grades`, `schools`  
**Cross-imports:** exports `mergeConfig()` and `resolveGrade()` — both are critical shared utilities  
**Client consumers:** Settings → Academic Config, Report Cards (indirectly)  
**Blast radius if broken:**
- `mergeConfig()` failing → report card generation crashes (it merges school config with defaults)
- `resolveGrade()` failing → grade letters/descriptors wrong on ALL report cards
- `academic_years` corrupted → archival guards (`isYearArchived`) stop working  
**Integrity notes:**
- `mergeConfig(saved)` merges DB config with hardcoded defaults — report-cards and grades both call this
- `resolveGrade()` is imported by `utils/academic-calc.js` — a circular-ish dependency chain: `academic-calc` → `academic-config` → avoid adding `academic-config` → `academic-calc`
- Year archiving (`isYearArchived`) is enforced in report-cards and exams — must remain in sync

---

### 9. `grades` — `/api/grades`
**Collections written:** `grades`, `mark_audit_log`  
**Collections read:** `academic_config` (via mergeConfig)  
**Cross-imports:** `utils/academic-calc.js` (aggregateGrades)  
**Client consumers:** Grades page (gradebook)  
**Blast radius if broken:** continuous assessment data unavailable; report card generation uses stale/zero CA scores  
**Integrity notes:**
- `grades.isPublished` flag gates whether scores are included in `aggregateGrades()` — unpublishing a grade entry silently removes it from report cards
- `grades.studentId` references `students.id` — orphaned if student deleted
- `grades.classId` references `classes.id` — orphaned if class deleted
- `mark_audit_log` entries are append-only — never delete

---

### 10. `exams` — `/api/exams`
**Collections written:** `exams`, `exam_results`, `mark_audit_log`  
**Collections read:** `academic_config` (via isYearArchived)  
**Cross-imports:** `utils/archival.js` (isYearArchived)  
**Client consumers:** Exams page  
**Blast radius if broken:** exam results missing from report card generation; `aggregateExamResults()` returns empty  
**Integrity notes:**
- `exam_results.studentId` references `students.id`
- `exam_results.examId` references `exams.id`
- Exam results are included in report cards via `utils/academic-calc.aggregateExamResults()` — this queries `exam_results` collection directly, not through this route
- `mark_audit_log` — same append-only rule as grades

---

### 11. `report-cards` — `/api/report-cards`
**Collections written:** `report_card_snapshots`, `publish_batches`, `mark_audit_log`  
**Collections read:** `students`, `grades`, `exam_results`, `academic_config`  
**Cross-imports:**
- `routes/academic-config.js` → `mergeConfig()`
- `utils/academic-calc.js` → `aggregateGrades()`, `aggregateExamResults()`, `computeFinalScores()`, `attendanceSummary()`, `attachDeviations()`
- `utils/ranking.js` → `rankStudents()`, `mergeRankings()`, `bestPerSubject()`
- `utils/archival.js` → `isYearArchived()`  
**Client consumers:** Reports page, PDF generation  
**Blast radius if broken:** report cards unavailable; PDF generation fails; parent portal shows no results  
**Integrity notes:**
- This is the most **dependency-heavy** module — depends on grades, exams, students, config, ranking, archival all being correct simultaneously
- Snapshots are **immutable once published** — update is blocked; supersede instead
- `publish_batches` is an interrupt-safe mechanism — partial publish failures are recoverable
- PDF generation requires `pdfkit` npm package — Render must have it installed
- Bulk PDF uses MongoDB cursor streaming — memory-safe but fails silently if cursor times out

---

### 12. `attendance` — `/api/attendance`
**Collections written:** `attendance`  
**Collections read:** none (class/student context passed in request body)  
**Cross-imports:** none  
**Client consumers:** Attendance page  
**Blast radius if broken:** attendance records cannot be taken; `attendanceSummary()` in report cards returns zeros  
**Integrity notes:**
- `attendance.studentId` references `students.id` — denormalised, not enforced
- `attendance.classId` references `classes.id` — denormalised, not enforced
- `attendanceSummary()` in `academic-calc.js` queries `attendance` collection directly — bypasses this route entirely
- No validation that a student is actually enrolled in the class being marked

---

### 13. `finance` — `/api/finance`
**Collections written:** `invoices`, `payments`, `fee_structures`  
**Collections read:** `students` (for bulk invoice generation)  
**Cross-imports:** none  
**Client consumers:** Finance page  
**Blast radius if broken:** invoices unviewable; payments unrecordable; fee structure setup fails  
**Integrity notes:**
- `invoices.studentId` references `students.id` — orphaned if student deleted
- Bulk invoice generation queries `students` collection with `classId` filter
- M-Pesa integration is a SEPARATE route (`mpesa.js`) — finance module does NOT call mpesa directly
- No double-payment guard beyond status field on invoice

---

### 14. `mpesa` — `/api/mpesa`
**Collections written:** `payments` (same collection as finance)  
**Collections read:** `invoices`  
**Cross-imports:** `utils/mpesa.js`  
**Client consumers:** Finance page (payment recording), M-Pesa STK push  
**Blast radius if broken:** online payment recording fails; STK push fails  
**Integrity notes:**
- Callback URL must be publicly accessible — local dev cannot receive M-Pesa callbacks
- Shares the `payments` collection with `finance.js` — query filters must not conflict
- `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY` env vars required

---

### 15. `hr` — `/api/hr`
**Collections written:** `leave_requests`, `payroll`, `staff_documents`  
**Collections read:** `teachers` (for staff directory context)  
**Cross-imports:** none  
**Client consumers:** HR page  
**Blast radius if broken:** leave management offline; payroll records inaccessible; staff documents unavailable  
**Integrity notes:**
- `leave_requests.teacherId` and `payroll.teacherId` reference `teachers.id` — orphaned if teacher deleted
- No integration with timetable substitution system — HR leave approval does NOT auto-create substitutions

---

### 16. `admissions` — `/api/admissions`
**Collections written:** `admissions`  
**Collections read:** none  
**Cross-imports:** none  
**Client consumers:** Admissions page (kanban + list view)  
**Blast radius if broken:** admissions pipeline offline; applicant intake fails  
**Integrity notes:**
- Fully standalone — no FK to students, classes, or users
- Conversion from applicant → enrolled student is a **manual process** — no automated `admissions → students` promotion
- Stage history is stored inline on the document (`stageHistory[]`) — not a separate collection

---

### 17. `messages` — `/api/messages`
**Collections written:** `messages`  
**Collections read:** `users`  
**Cross-imports:** none  
**Client consumers:** Messages page  
**Blast radius if broken:** internal messaging offline  
**Integrity notes:**
- `messages.senderId` / `messages.recipientId` reference `users.id`
- No push notification integration — messages are pull-only (no real-time WebSocket)
- No message deletion — append-only

---

### 18. `behaviour` — `/api/behaviour`
**Collections written:** `behaviour_incidents`, `behaviour_appeals`, `behaviour_categories`  
**Collections read:** none (student/teacher context in request)  
**Cross-imports:** none  
**Client consumers:** Behaviour page  
**Blast radius if broken:** incident recording offline; categories unavailable  
**Integrity notes:**
- `behaviour_incidents.studentId` references `students.id` — orphaned if student deleted
- No integration with report cards — behaviour data is not surfaced in report card snapshots currently

---

### 19. `events` — `/api/events`
**Collections written:** `events`  
**Collections read:** `students`, `teachers` (for audience resolution)  
**Cross-imports:** none  
**Client consumers:** Events page  
**Blast radius if broken:** school calendar offline  
**Integrity notes:**
- Audience targeting queries `students` and `teachers` collections
- No reminder/notification system — events are calendar-only

---

### 20. `settings` — `/api/settings`
**Collections written:** `schools`, `users`  
**Collections read:** `schools`, `users`  
**Cross-imports:** none  
**Client consumers:** Settings page  
**Blast radius if broken:** school profile updates fail; user management broken  
**Integrity notes:**
- School logo/banner stored as URL strings — no CDN cleanup on update
- Platform SMTP identity is `support@msingi.io` (Zoho, migrated from `innolearnnetwork@gmail.com` in 2026-07) — configured via `SMTP_HOST`/`SMTP_USER`/`SMTP_PASS` Render env vars. **MUST NOT be changed via settings UI** — this is the platform's own sending identity, not a per-school setting; only the platform operator changes it, and only via Render env vars

---

### 21. `platform` — `/api/platform`
**Collections written:** `schools`, `users`, `platform_settings`, `system_announcements`, `academic_years`, `role_permissions`, `sections`  
**Collections read:** `schools`, `users`, `students`, `academic_years`, `role_permissions`, `sections`  
**Cross-imports:** none  
**Client consumers:** Platform admin panel  
**Blast radius if broken:** school provisioning fails; system announcements offline; role/permission management offline  
**Integrity notes:**
- Platform admin routes are guarded by `superadmin` role — not school-scoped
- `role_permissions` collection is read by `middleware/rbac.js` with 5-minute cache — permission changes take up to 5 min to propagate
- `academic_years` deletions can break `isYearArchived()` guard in report-cards and exams

---

### 22. `onboard` — `/api/onboard`
**Collections written:** `schools`, `users`, `academic_years`, `role_permissions`, `sections`  
**Collections read:** `schools`  
**Cross-imports:** none  
**Client consumers:** Onboarding flow (new school setup)  
**Blast radius if broken:** new school provisioning fails  
**Integrity notes:**
- Seeds `role_permissions` defaults at school creation — if schema changes, existing schools are unaffected (they keep old permissions)
- Seeds `academic_years` — if removed, `isYearArchived()` may behave incorrectly

---

### 23. `import-export` — `/api/import-export`
**Collections written:** `students`, `teachers`, `classes` (via upsert)  
**Collections read:** `students`, `teachers`, `classes`  
**Cross-imports:** none  
**Client consumers:** Import/Export page  
**Blast radius if broken:** bulk data import/export offline  
**Integrity notes:**
- Bulk student import bypasses individual route validation — malformed data can corrupt students collection
- No rollback mechanism if partial import fails

---

## Shared Utilities — Critical Infrastructure

### `utils/academic-calc.js`
- **Imported by:** `report-cards.js`, `grades.js`
- **Queries:** `grades`, `exam_results`, `attendance`, `academic_config` collections directly
- **DO NOT duplicate** any calculation logic outside this file — drift between surfaces is a critical integrity risk
- **Exports:** `aggregateGrades`, `aggregateExamResults`, `computeFinalScores`, `attendanceSummary`, `attachDeviations`
- **Circular risk:** imports `resolveGrade` from `routes/academic-config.js` — do not add reverse import

### `utils/ranking.js`
- **Imported by:** `report-cards.js`
- **Exports:** `rankStudents`, `mergeRankings`, `bestPerSubject`, `computeRankingScore`
- Pure functions — no DB access

### `utils/archival.js`
- **Imported by:** `report-cards.js`, `exams.js`
- **Queries:** `academic_years` collection directly
- If `academic_years` is deleted/corrupted, `isYearArchived()` throws — report card publish and exam lock both fail

### `utils/email.js`
- **Imported by:** `auth.js`, potentially others
- **SMTP sender is `support@msingi.io`** (Zoho; migrated from `innolearnnetwork@gmail.com` 2026-07) — host/port/credentials are env-driven (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`), not hardcoded; changed only via Render env vars, never via application code or the Settings UI
- If email fails, auth flows (password reset, invites) degrade silently

### `middleware/rbac.js`
- **Used by:** every protected route
- **Queries:** `role_permissions` collection with 5-min in-memory cache
- Only `superadmin` bypasses all permission checks. `admin` goes through RBAC (superadmin can restrict via Settings)
- Per-user overrides: also loads `role_permissions` doc keyed by `userId`; user permissions are merged on top of role permissions (user wins per module). Cache key: `schoolId::user::userId`
- Cache must be busted (`invalidatePermCache(schoolId)`) after role_permissions changes

### `middleware/plan.js`
- **Used by:** finance, report-cards, timetable, and others
- **Reads:** `schools.plan` field
- Gates features behind `starter` / `standard` / `premium` plan tiers

---

## Cross-Module FK Contracts

| FK Field | Stored In | Must Match | Risk if Broken |
|----------|-----------|------------|----------------|
| `students.id` | attendance, grades, exam_results, report_card_snapshots, behaviour_incidents, invoices | `students.id` | Orphaned records, report card failures |
| `classes.id` | timetable, grades, exam_results, attendance, report_card_snapshots | `classes.id` (string id, NOT `_id`) | Timetable grid empty, report cards fail |
| `teachers.userId` | timetable.teacherId | `users.userId` | Conflict detection wrong, workload wrong |
| `teachers.id` | leave_requests, payroll | `teachers.id` | HR records orphaned |
| `exams.id` | exam_results | `exams.id` | Results lost from report cards |
| `academic_config.schoolId` | grades, report_card_snapshots | `schools.id` | Grade calculations use wrong weights |
| `academic_years.id` | archival guard | `academic_config.academicYears[]` | Archival blocks fail/pass incorrectly |
| `role_permissions.schoolId+roleKey` | rbac middleware | `schools.id` + role string | Permission escalation or lockout |
| `role_permissions.schoolId+userId` | rbac middleware (per-user overrides) | `schools.id` + `users.id` | User-level override not applied |

---

## Change Safety Rules

1. **Renaming a collection** → update every `_model('old_name')` call across all routes + scripts
2. **Changing `students.id` format** → must migrate: attendance, grades, exam_results, report_card_snapshots, behaviour_incidents, invoices
3. **Changing `classes.id` format** → must migrate: timetable, grades, exam_results, attendance, report_card_snapshots
4. **Changing teacher ID format** → must migrate: timetable.teacherId, leave_requests, payroll
5. **Changing `academic-config` shape** → update `mergeConfig()` defaults AND audit `resolveGrade()` output
6. **Deleting an academic year** → run `isYearArchived()` audit first; check for live report_card_snapshots referencing it
7. **Adding a new plan tier** → update `middleware/plan.js` AND `client/src/pages/Plans.jsx` AND landing page
8. **Changing RBAC permission keys** → update `middleware/rbac.js` + `role_permissions` seed in `onboard.js` + `platform.js`
9. **Any change to `utils/academic-calc.js`** → re-verify ALL output surfaces: gradebook, report card PDF, student portal

---

## Audit Gaps (Phase A targets)

- [ ] No cascade delete anywhere — orphan detection needed
- [ ] `teachers.userId` vs `teachers.id` used inconsistently across modules
- [ ] `students.classId` not validated against `classes.id` at write time
- [ ] Attendance has no enrollment check (student not in class can be marked)
- [ ] Finance has no double-payment guard
- [ ] HR leave approval has no timetable substitution integration
- [ ] Behaviour incidents not surfaced in report cards
- [ ] Admissions-to-students promotion is manual — no workflow
- [ ] `timetable.teacherName` is denormalised — can become stale if teacher is renamed
- [ ] `mark_audit_log` has no archival/rotation strategy — will grow unbounded
- [ ] PDF generation has no queue/rate-limit — bulk PDF on large classes is a memory risk
- [ ] No soft-delete on any collection — hard deletes break FKs silently
