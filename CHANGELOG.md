# InnoLearn — Changelog

All notable changes to InnoLearn are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Versioning follows [Semantic Versioning](https://semver.org/).

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
