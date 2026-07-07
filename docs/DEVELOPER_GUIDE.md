# Msingi — Developer Guide

**Version 4.29.0** · Technical Reference & Architecture

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [File Structure](#2-file-structure)
3. [Architecture](#3-architecture)
4. [Routing](#4-routing)
5. [Authentication & Roles](#5-authentication--roles)
6. [Database Layer (DB)](#6-database-layer-db)
7. [Module Pattern (IIFE)](#7-module-pattern-iife)
8. [UI Conventions](#8-ui-conventions)
9. [Seed Data & Versioning](#9-seed-data--versioning)
10. [Adding a New Module](#10-adding-a-new-module)
11. [Module Reference](#11-module-reference)
12. [Behaviour Module Deep Dive](#12-behaviour-module-deep-dive)
13. [Test Layer](#13-test-layer)
14. [Deployment (Render)](#14-deployment-render)
15. [Help Centre Articles](#15-help-centre-articles)
16. [Branding & Login Page System](#16-branding--login-page-system)
17. [Known Limitations](#17-known-limitations)
18. [Production API Layer (v4.1+)](#18-production-api-layer-v41)
19. [React SPA (v4.3+)](#19-react-spa-v43)
20. [Security Layer (v4.5+)](#20-security-layer-v45)
21. [Messaging API (v4.4+)](#21-messaging-api-v44)
22. [School Registration & Credentials Flow (v4.4+)](#22-school-registration--credentials-flow-v44)
23. [Platform Admin API (v4.5+)](#23-platform-admin-api-serverroutesplatformjs--v45)
24. [Academic Configuration API (v4.6+)](#24-academic-configuration-api-v46)
25. [Academic Reporting Engine (v4.6+)](#25-academic-reporting-engine-v46)
26. [Production Hardening — Phase 3 (v4.6.1+)](#26-production-hardening--phase-3-v461)
27. [Cross-Cutting Issue Fixes (v4.6.2+)](#27-cross-cutting-issue-fixes-v462)
28. [Platform Rebrand & Dedicated School URLs (v4.7.0)](#28-platform-rebrand--dedicated-school-urls-v470)
29. [Assessment & Grading System (v4.7.0)](#29-assessment--grading-system-v470)
30. [Public Marketing Pages (v4.9.5+)](#30-public-marketing-pages-v495)
31. [Demo School System (v4.9.7+)](#31-demo-school-system-v497)
32. [Developer Workflow — Check Docs First (v4.9.9+)](#32-developer-workflow--check-docs-first-v499)
33. [Staff Self-Edit Profile API (v4.29.0+)](#33-staff-self-edit-profile-api-v4290)
34. [Admin Password Reset API (v4.29.0+)](#34-admin-password-reset-api-v4290)
35. [Security — CSPRNG Enforcement (v4.29.0+)](#35-security--csprng-enforcement-v4290)
36. [Public Site SEO & SSG (v4.42.0+)](#36-public-site-seo--ssg-v4420)

---

## 1. Project Overview

InnoLearn is a **vanilla JavaScript single-page application** (SPA) with no build step, no bundler, and no framework. It runs entirely in the browser with `localStorage` as the persistence layer.

**Stack**:
- HTML5 / CSS3 (custom design system, no CSS framework)
- Vanilla ES6+ JavaScript (IIFE module pattern)
- localStorage via a thin `DB` abstraction
- Chart.js (CDN) for analytics charts
- Font Awesome (CDN) for icons
- Google Fonts — Inter

**Design goals**:
- Zero-dependency deployability (open `index.html` — it works)
- Role-based multi-user simulation in a single browser tab
- Extensible module system where new modules follow a consistent pattern

---

## 2. File Structure

```
school-management/
├── index.html                  # Legacy app entry point — all scripts loaded here
├── onboard.html                # 4-step school self-registration wizard
├── platform.html               # Platform admin SPA (key-protected)
├── server.js                   # Entry point → delegates to server/index.js
├── render.yaml                 # Render.com deployment config
├── CHANGELOG.md                # Version history
├── .env                        # Local secrets (never committed)
├── .env.example                # Safe template for .env
├── .gitignore
│
├── client/                     # ★ React SPA (v4.3+) — Vite + React 18 + Tailwind
│   ├── index.html              # Vite HTML entry point
│   ├── package.json            # React dependencies (separate from root)
│   ├── .npmrc                  # ★ include=dev — ensures vite/tailwind installed on Render
│   ├── vite.config.js          # Dev server :5173, /api proxy → :3005, code-split
│   ├── tailwind.config.js      # InnoLearn brand palette + component tokens
│   ├── postcss.config.js
│   └── src/
│       ├── main.jsx            # QueryClient, RouterProvider, RQ Devtools
│       ├── App.jsx             # createBrowserRouter — all routes, lazy pages
│       ├── index.css           # Tailwind directives + component layer (@apply)
│       ├── api/
│       │   └── client.js       # Fetch wrapper — all 11 API modules, APIError
│       ├── store/
│       │   └── auth.js         # Zustand auth store, session persistence, can()
│       ├── components/
│       │   ├── guards/
│       │   │   └── ProtectedRoute.jsx
│       │   ├── layout/
│       │   │   ├── AppShell.jsx    # Desktop sidebar + mobile drawer
│       │   │   ├── Sidebar.jsx     # Section nav, user footer, logout
│       │   │   └── TopBar.jsx      # Breadcrumb, plan badge, avatar
│       │   └── ui/
│       │       ├── Spinner.jsx     # Spinner + PageSpinner
│       │       ├── Badge.jsx       # 7 variants + status helpers
│       │       ├── EmptyState.jsx  # EmptyState + ErrorState
│       │       └── Pagination.jsx  # Smart page window with ellipsis
│       └── pages/
│           ├── Login.jsx           # Split-panel + password-expired flow
│           ├── Dashboard.jsx       # Stat cards + recent students + quick actions
│           ├── NotFound.jsx
│           ├── students/
│           │   ├── StudentList.jsx     # Debounced search, filters, paginated table
│           │   └── StudentProfile.jsx  # 5-tab detail with inline edit
│           ├── teachers/TeacherList.jsx
│           ├── classes/ClassList.jsx
│           ├── attendance/AttendancePage.jsx   # Register editor (radio-button grid)
│           ├── finance/FinancePage.jsx         # Invoices / Payments / Summary tabs
│           ├── behaviour/BehaviourPage.jsx     # Incidents + Appeals tabs
│           ├── exams/ExamsPage.jsx             # Exams + Grade Report tabs
│           ├── admissions/AdmissionsPage.jsx   # Funnel stats + stage filter
│           ├── timetable/TimetablePage.jsx     # Day-grid per class
│           └── settings/SettingsPage.jsx       # School / Users / Account tabs
│
├── css/
│   ├── styles.css              # Main design system (app shell + all component styles)
│   ├── onboard.css             # Onboarding wizard styles
│   └── platform.css            # Platform admin dashboard styles
│
├── js/
│   ├── data.js                 # Seed data + DB bootstrap + hydration layer (v4.2+)
│   ├── cache.js                # ★ In-memory TTL cache (v4.2+)
│   ├── api.js                  # ★ Production API client — all modules (v4.1+)
│   ├── app.js                  # Router, sidebar, utilities, global functions
│   └── modules/
│       ├── auth.js             # Authentication, session, role/permission checks
│       ├── dashboard.js        # Dashboard module (+ setup wizard for new schools)
│       ├── changelog.js        # In-app changelog viewer
│       ├── students.js         # Student Information System
│       ├── classes.js          # Classes and sections
│       ├── subjects.js         # Subjects and curriculum
│       ├── timetable.js        # Timetable builder
│       ├── attendance.js       # Daily attendance registers
│       ├── academics.js        # Gradebook and report cards
│       ├── exams.js            # Exam scheduling and results
│       ├── admissions.js       # Admissions pipeline + public form
│       ├── finance.js          # Fee management, invoices, payments
│       ├── communication.js    # Internal messaging
│       ├── events.js           # Events and calendar
│       ├── reports.js          # Reports and analytics
│       ├── hr.js               # HR and staff management
│       ├── behaviour.js        # Behaviour & Pastoral
│       ├── settings.js         # School settings and permissions
│       └── help.js             # In-app help centre
│
├── server/
│   ├── index.js                # Express server bootstrap — mounts all routes
│   ├── config/
│   │   └── db.js               # MongoDB Atlas connection (Mongoose)
│   ├── middleware/
│   │   ├── auth.js             # JWT verification + platform key middleware
│   │   ├── rbac.js             # ★ Server-side RBAC: rbac(module, action) factory
│   │   ├── plan.js             # ★ Plan tier gating: planGate(feature) factory
│   │   └── tenant.js           # Resolves schoolId from slug / subdomain / JWT
│   ├── routes/
│   │   ├── auth.js             # POST /api/auth/login, /me, /change-password
│   │   ├── onboard.js          # POST /api/onboard — school self-registration
│   │   ├── platform.js         # GET/POST /api/platform/* — platform admin API
│   │   ├── collections.js      # Legacy generic CRUD (kept for backward compat.)
│   │   ├── sync.js             # GET /api/sync — bulk data download
│   │   ├── users.js            # POST /api/users/invite, /bulk-invite, /role-change
│   │   ├── backup.js           # POST /api/backup/export, /history, /preview
│   │   ├── students.js         # ★ /api/students  — RBAC + paginated + Zod
│   │   ├── teachers.js         # ★ /api/teachers  — RBAC + paginated + Zod
│   │   ├── classes.js          # ★ /api/classes   — RBAC + paginated + Zod
│   │   ├── attendance.js       # ★ /api/attendance — RBAC + paginated + bulk
│   │   ├── finance.js          # ★ /api/finance   — invoices + payments (server-side math)
│   │   ├── behaviour.js        # ★ /api/behaviour — incidents, appeals, categories
│   │   ├── exams.js            # ★ /api/exams     — results, stats, grading scale
│   │   ├── grades.js           # ★ /api/grades    — weighted average report
│   │   ├── admissions.js       # ★ /api/admissions — pipeline + stage history
│   │   ├── timetable.js        # ★ /api/timetable — slot collision detection
│   │   └── messages.js         # ★ /api/messages  — persistent inbox, email notifications
│   └── utils/
│       ├── jwt.js              # sign() / verify() helpers
│       ├── model.js            # Shared Mongoose model factory (_model)
│       ├── email.js            # ★ 13 transactional email functions (nodemailer/Gmail)
│       ├── counters.js         # ★ Atomic sequential counters (admission nos., IDs)
│       ├── response.js         # ★ Standardised ok() / fail() / paginate() helpers
│       └── seedSchool.js       # One-off seed script for Atlas demo school
│
└── docs/
    ├── USER_GUIDE.md           # End-user documentation
    ├── DEVELOPER_GUIDE.md      # This file
    ├── PLATFORM_ADMIN_GUIDE.md # Platform owner operations guide
    └── SCHOOL_ADMIN_GUIDE.md   # School Super Admin setup guide
```

**Legacy script load order in `index.html`** (matters — each module depends on `DB` and `Auth`):
```
chart.js → data.js → cache.js → api.js → auth.js → [all feature modules] → app.js
```
`app.js` is always last — it calls `App.init()` on `DOMContentLoaded`.

**React SPA** (`client/`) is an independent app with its own `package.json`. It proxies `/api` to the same Express server.

---

## 3. Architecture

### High-Level Flow

```
index.html loads all scripts
    ↓
data.js: seeds localStorage if SEED_VERSION changed
    ↓
auth.js: checks localStorage for session
    ↓
app.js App.init(): decides to show login or app shell
    ↓
User logs in → Auth.login() → App._showApp()
    ↓
Hash change → App._handleHash() → ROUTES[route](param)
    ↓
Module.render(param) → App.renderPage(html)
```

### State Management
There is no global state object. Each module manages its own state via **IIFE-private variables**. Persistent data lives in `localStorage` via the `DB` layer.

### Event Handling
- Navigation: native browser hash changes (`window.addEventListener('hashchange', ...)`)
- UI interactions: inline `onclick` attributes in rendered HTML strings (acceptable tradeoff for simplicity)
- Global clicks: `document.addEventListener('click', ...)` in `app.js` for dropdown close

---

## 4. Routing

Routes are defined in `js/app.js` as a plain object:

```js
const ROUTES = {
  dashboard:    () => Dashboard.render(),
  students:     (p) => Students.render(p),
  behaviour:    (p) => Behaviour.render(p),
  // ...
};
```

**URL format**: `index.html#route` or `index.html#route/param`

**Navigation** (programmatic):
```js
App.navigate('students');           // → #students
App.navigate('students', 'stu1');   // → #students/stu1
```

**Adding a route**:
1. Add an entry to `ROUTES` in `app.js`.
2. Add an entry to `NAV_ITEMS` if it needs a sidebar link.
3. Add a `<script>` tag in `index.html` before `app.js`.

**Param passing**: The hash segment after `/` is passed as the second argument to the route handler. Modules use this for deep-linking to a specific record (e.g., `#students/stu1` opens student stu1's profile).

---

## 5. Authentication & Roles

### Session Storage
Login state is stored in `localStorage` under `InnoLearn_session`:
```json
{
  "userId": "u_admin1",
  "schoolId": "sch1",
  "loginTime": "2026-04-26T..."
}
```

### `Auth` Module API
```js
Auth.login(event)           // Form submit handler
Auth.logout()               // Clears session, shows login
Auth.isLoggedIn()           // → boolean
Auth.currentUser            // → user object from DB
Auth.currentSchool          // → school object from DB
Auth.hasPermission(mod, action)  // → boolean (checks role_permissions)
Auth.isSuperAdmin()         // → boolean
Auth.isAdmin()              // → boolean
Auth.isTeacher()            // → boolean
Auth.visibleModules()       // → string[] of module keys this user can see
Auth.myClasses()            // → Class[] for current teacher
Auth.myTeacher()            // → Teacher record for current user
Auth.mySectionId()          // → section ID for section_head role
Auth.primaryRoleLabel()     // → human-readable role label
```

### Roles
```
superadmin           Full system access — bypasses RBAC entirely (cannot be restricted)
admin                All modules by default — goes through RBAC (superadmin can restrict)
principal            Senior leadership — same defaults as deputy_principal
deputy_principal     Behaviour, Students, HR (view), most academic modules
section_head         Own section: students, attendance, behaviour, academics
discipline_committee Behaviour, Students (view)
teacher              Own classes: attendance, marks, behaviour, communication
timetabler           Timetable (full), classes/subjects/students (read)
exams_officer        Grades + Exams (full), report_cards (read)
admissions_officer   Admissions (full), students (edit)
finance              Finance (full), Students/Reports (read)
hr                   HR (full), teachers (full)
parent               Own children only
student              Own record only
```

Custom roles can be created in Settings → Roles & Permissions. They inherit a base role's defaults and are fully enforced through the same RBAC chain as system roles. Individual users can also have per-user permission overrides set in the "Per User" tab — these override their role's permissions at the module level and are enforced at both login and API request time.

### Permission Check Pattern
```js
// In a module render function
function render() {
  if (!Auth.hasPermission('behaviour', 'view')) {
    return App.renderPage('<div class="empty-state">Access denied.</div>');
  }
  // ...
}

// Role check in UI rendering
${Auth.isAdmin() ? `<button onclick="...">Admin Action</button>` : ''}
```

### Role Permissions Table (`role_permissions` in DB)
Each row is keyed by role name and contains an object of `{ module: { view, create, edit, delete } }`. Sub-module keys use dot notation: `'behaviour.appeals'`, `'finance.invoices'`, etc.

---

## 6. Database Layer (DB)

`DB` is a thin localStorage wrapper defined in `data.js`. All data is stored as JSON-serialised arrays under namespaced keys (`InnoLearn_<collection>`).

### API
```js
// Synchronous localStorage CRUD
DB.get(collection)                    // → array of all records
DB.getById(collection, id)            // → single record or null
DB.query(collection, predicateFn)     // → filtered array
DB.insert(collection, object)         // → inserted object (id auto-generated if missing)
DB.update(collection, id, partial)    // → updated object (shallow merge)
DB.remove(collection, id)             // → void
DB.set(collection, array)             // → replaces entire collection (used in seed)

// ★ Async server-hydration (v4.2+)
await DB.hydrate(collection, params)  // → true if hydrated, false if skipped/error
                                      //   fetches all pages from production API,
                                      //   stores in localStorage, caches for 2 min
DB.invalidateHydration(collection)    // bust 2-min cache so next render re-fetches
```

Writes that hit `DB.update`, `DB.insert`, or `DB.remove` are fire-and-forget synced to the production API via `_push()` for the 13 collections listed in `PRODUCTION_ROUTES`. All other collections continue to use the legacy `/api/collections/:col` route.

### ID Generation
`DB.insert` auto-generates an ID if the object has none: `Date.now().toString(36) + Math.random().toString(36).slice(2)`.

### Collections

| Collection | Description |
|---|---|
| `schools` | School profile (one record: `sch1`) |
| `academicYears` | Academic years with nested `terms[]` array |
| `users` | All user accounts (role, email, hashed password placeholder) |
| `students` | Student records (linked to `classId`, `houseId`, `userId`) |
| `classes` | Class records (linked to `sectionId`, `homeroomTeacher`) |
| `sections` | Section records (KG, Primary, Secondary, A-Level) |
| `subjects` | Subject records |
| `timetable` | Weekly slot grids per class |
| `attendance` | Daily attendance records per class |
| `marks` | Gradebook entries per student/subject/term |
| `exams` | Exam definitions and results |
| `applications` | Admissions applications |
| `invoices` | Fee invoices per student |
| `payments` | Payment records |
| `messages` | Communication messages |
| `events` | Calendar events |
| `teachers` | Teacher profiles (linked to `userId`) |
| `detentions` | Detention sessions |
| `behaviour_settings` | Single config record for the Behaviour module |
| `behaviour_incidents` | Logged merit/demerit incidents |
| `behaviour_appeals` | Appeal records (submitted, resolved, parent-noted) |
| `role_permissions` | Per-role permission maps |
| `notifications` | System-generated alerts |

### Example Usage
```js
// Get all active students
const students = DB.query('students', s => s.status === 'active');

// Get a student by ID
const stu = DB.getById('students', 'stu1');

// Update a field
DB.update('students', 'stu1', { houseId: 'yellow' });

// Insert a new record
DB.insert('behaviour_incidents', {
  studentId: 'stu1',
  type: 'merit',
  points: 3,
  note: 'Excellent work',
  status: 'active',
  // ...
});

// Remove a record
DB.remove('behaviour_incidents', 'bi001');
```

### ENUMS

`ENUMS` (frozen object, `data.js`) defines the canonical value set for every status/type field. **Always** use these — never inline string literals for statuses.

```js
ENUMS.studentStatus     // ['active','inactive','graduated','transferred','withdrawn']
ENUMS.incidentType      // ['merit','demerit']
ENUMS.appealStatus      // ['pending','escalated','accepted','rejected']
ENUMS.invoiceStatus     // ['unpaid','partial','paid','overdue']
ENUMS.attendanceStatus  // ['present','absent','late','excused']
ENUMS.userRole          // ['superadmin','admin','teacher', ...]
ENUMS.paymentMethod     // ['cash','bank_transfer','mpesa','cheque','online','other']
// ... etc.
```

Usage in code:
```js
// ✅ Correct
if (!ENUMS.studentStatus.includes(data.status)) return showToast('Invalid status', 'warning');

// ❌ Wrong — inline string, silent if typo
if (data.status === 'Actve') { ... }
```

---

### Validators (`js/validators.js`)

Central validation layer. Loaded after `data.js`, before all modules. **Every DB write must call its entity validator first.**

```js
// Returns null (valid) or error string (invalid)
Validators.student(data, existingId)          // student profile writes
Validators.user(data, existingId)             // user account writes
Validators.cls(data, existingId)              // class writes
Validators.timetableSlot(slot, ttId, eDay, ePeriod)  // timetable slot saves
Validators.payment(amount, invoiceObj)        // payment recording
Validators.incident(data)                     // behaviour incident logging

// Delete guards — return null (safe) or error string (blocked)
Validators.canDeleteStudent(id)               // open appeals or unpaid invoices
Validators.canDeleteClass(classId)            // enrolled students or timetable entries
Validators.canDeleteYear(id)                  // current year or linked classes
Validators.canDeleteSection(sectionId)        // classes within section
Validators.canDeleteSubject(id)               // in timetable, class assignments, or grade records
Validators.canDeleteUser(id)                  // homeroom teacher, in timetable, or linked student record
```

**Room conflict detection** — `Validators.timetableSlot()` also checks whether the specified room is already booked by another class at the same day and period. An empty room string bypasses this check.

**Pattern — always use before DB writes:**
```js
const err = Validators.student(data, id);
if (err) return showToast(err, 'warning');
// — all validation passed — safe to write
const before = DB.getById('students', id);
DB.update('students', id, data);
_audit('STUDENT_UPDATED', { before, ... });
```

**Adding a new validator:**
1. Add a function in `validators.js` following the `_first(...checks)` pattern
2. Call it at every DB write site in the relevant module
3. Add test cases in `_testValidators()` in `tests.js`

---

### SchoolContext

`SchoolContext` is a lightweight IIFE defined at the end of `data.js`. It provides live accessors for the current school configuration — **always call these instead of hardcoding term/year IDs**.

```js
SchoolContext.school()          // → school record (first record in 'schools')
SchoolContext.currentTermId()   // → e.g. 'term2' (from school.currentTermId)
SchoolContext.currentAcYearId() // → e.g. 'ay2025' (from school.currentAcademicYearId)
SchoolContext.currentTerm()     // → full term object from 'terms' collection
SchoolContext.currentAcYear()   // → full academic year object from 'academicYears'
```

**Rule**: Never write `|| 'term2'` or `|| 'ay2025'` anywhere in the codebase. Use `SchoolContext.currentTermId()` and `SchoolContext.currentAcYearId()`. If the school record has no current term set, these return an empty string — which is a detectable error state, not a wrong value.

---

## 7. Module Pattern (IIFE)

Every feature module follows the same Immediately Invoked Function Expression (IIFE) pattern:

```js
const ModuleName = (() => {
  // ── Private state ──
  let _tab = 'list';
  let _filter = { search: '', status: 'all' };

  // ── Config/helpers ──
  function _helper() { /* ... */ }

  // ── View renderers ──
  function _listView() {
    return `<div>...</div>`;
  }

  // ── Main render (called by router) ──
  function render(param) {
    App.setBreadcrumb('<i class="fas fa-icon"></i> Module Name');
    if (param) { /* handle deep link */ }

    App.renderPage(`
      <div class="page-header">
        <div class="page-title"><h1>Module Name</h1></div>
        <div class="page-actions">...</div>
      </div>
      <div class="tabs">...</div>
      ${_tab === 'list' ? _listView() : _otherView()}
    `);
  }

  // ── Public API ──
  return { render, setTab, saveRecord, deleteRecord };
})();
```

### Rules
1. **Private by default** — prefix private functions with `_`.
2. **No global state** — all state lives inside the IIFE closure.
3. **All rendering returns HTML strings** — `App.renderPage(html)` does the DOM write.
4. **Inline onclick** — event handlers use `ModuleName.functionName(args)` in HTML strings. All called functions must be in the public API return object.
5. **Modals** — use `openModal(html, size)` / `_closeModal()` globals from `app.js`.
6. **Toasts** — use `showToast(message, type)` where type is `'success'|'warning'|'error'|'info'`.
7. **Assertion before writes** — use `assert(condition, message)` before every `DB.insert` / `DB.update` for required fields.
8. **Wrap handlers in `safe()`** — for complex or async action handlers, wrap the body in `safe(() => { ... }, 'handlerName')` to prevent silent crashes.

### Global Utility Functions (`app.js`)

These are available on the global scope (no import needed):

```js
// Throw if condition is falsy — use before DB writes
assert(condition, message)

// Wrap UI handlers to catch and toast unexpected errors
safe(() => myModule.doThing(), 'doThing')

// Check HH:MM time range overlap (used for clash detection)
isOverlapping('09:00', '10:00', '09:30', '10:30')  // → true
isOverlapping('09:00', '10:00', '10:00', '11:00')  // → false (touch, no overlap)

// Formatting helpers
fmtDate(isoString)      // → '26 Apr 2026'
fmtMoney(1500)          // → 'KSh 1,500'
fmtPct(87.5)            // → '87.5%'
gradeColor(pct)         // → CSS class name: 'success'|'primary'|'warning'|'danger'
statusBadge(status)     // → badge variant: 'success'|'warning'|'danger'|...
avatar(name, role)      // → <div class="avatar-circle"> HTML

// General
showToast(message, type)          // Pop a toast notification
openModal(html, size)             // Open the modal overlay
confirmAction(prompt, callbackFn) // Confirm-then-execute wrapper
```

---

## 8. UI Conventions

### CSS Classes (defined in `styles.css`)
```
.page-header          Flex container for page title + actions
.page-title           h1 + subtitle p
.page-actions         Right-aligned button group
.card                 White rounded shadow container
.card-header          Flex header row inside a card (title + action button)
.table                Styled HTML table
.badge                Inline status pill
.badge-success/danger/warning/secondary  Coloured variants
.btn                  Base button
.btn-primary/secondary/danger/warning/success  Colour variants
.btn-sm               Small variant
.btn-icon             Icon-only round button
.form-field           Label + input wrapper
.form-row             Horizontal row of form fields
.tabs                 Tab button container
.tab-btn              Individual tab button (.active for selected)
.empty-state          Centred empty state with icon + message
.stat-card            Dashboard KPI card
.stats-grid           CSS grid for stat cards
.modal-header         Modal title bar with close button
.modal-body           Modal scrollable content
.modal-footer         Modal action buttons bar
```

### Layout Patterns
```js
// Two-column grid
`<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">...</div>`

// Four-column stats row
`<div class="stats-grid" style="grid-template-columns:repeat(4,1fr)">...</div>`

// Full-width card with table
`<div class="card"><div style="overflow-x:auto"><table class="table">...</table></div></div>`
```

### Modal Sizes
```js
openModal(html)        // Default (medium ~480px)
openModal(html, 'sm')  // Small ~400px
openModal(html, 'lg')  // Large ~700px
openModal(html, 'xl')  // Extra large ~900px
```

### Breadcrumb
```js
App.setBreadcrumb('<i class="fas fa-icon"></i> Page Title');
```

### Confirmation Dialog
```js
confirmAction('Are you sure you want to delete this?', () => {
  DB.remove('collection', id);
  showToast('Deleted.', 'info');
  render();
});
```

---

## 9. Seed Data & Versioning

`data.js` runs on every page load. It checks `localStorage.getItem('ss__version')` against the hardcoded `SEED_VERSION` constant at the top of the file.

```js
const SEED_VERSION = '17';  // bump this whenever schema changes

if (!DB.isSeeded()) DB.seed();
```

**Bumping the version**: change `SEED_VERSION` to any new string (e.g. `'17'`). On the next page load, **all localStorage data is wiped and re-seeded**. All demo logins, students, settings etc. return to their seed state.

**When to bump**: any time you change the schema of an existing collection (add a required field, rename a field, change ID formats, etc.).

**Seeded demo users** (all passwords visible in `data.js`):
- `superadmin@InnoLearn.edu.ke` / `super123`
- `admin@InnoLearn.edu.ke` / `admin123`
- `sarah.smith@InnoLearn.edu.ke` / `teacher123`
- `finance@InnoLearn.edu.ke` / `finance123`
- `parent1@InnoLearn.edu.ke` / `parent123`
- `student1@InnoLearn.edu.ke` / `student123`
- `deputy@InnoLearn.edu.ke` / `deputy123`
- `discipline@InnoLearn.edu.ke` / `discipline123`

---

## 10. Adding a New Module

Follow these steps to add a new module (e.g. "Library"):

### Step 1 — Create the module file
`js/modules/library.js`
```js
const Library = (() => {
  let _tab = 'books';

  function render(param) {
    App.setBreadcrumb('<i class="fas fa-book"></i> Library');
    App.renderPage(`
      <div class="page-header">
        <div class="page-title"><h1>Library</h1><p>Book inventory and loans</p></div>
      </div>
      <p>Coming soon.</p>
    `);
  }

  return { render };
})();
```

### Step 2 — Add the script tag in `index.html`
```html
<!-- before app.js -->
<script src="js/modules/library.js"></script>
```

### Step 3 — Register the route in `app.js`
```js
const ROUTES = {
  // ...existing routes...
  library: (p) => Library.render(p),
};
```

### Step 4 — Add to `NAV_ITEMS` in `app.js`
```js
const NAV_ITEMS = {
  // ...existing items...
  library: { icon:'fas fa-book', label:'Library', route:'library' },
};
```

### Step 5 — Add to `role_permissions` in `data.js`
In the seed data, find each role's permission object and add:
```js
'library': { view: true, create: false, edit: false, delete: false }
```
Then bump `SEED_VERSION`.

### Step 6 — (Optional) Add a DB collection
In `data.js`:
```js
set('library_books', [
  { id:'book1', title:'Sample Book', author:'Author Name', copies:3 }
]);
```

---

## 11. Module Reference

| Module | File | Key Public API |
|---|---|---|
| Auth | `auth.js` | `login()`, `logout()`, `isLoggedIn()`, `hasPermission()`, `currentUser` |
| App | `app.js` | `navigate()`, `renderPage()`, `setBreadcrumb()`, `toggleSidebar()`, `applyBranding()`, `applyLoginPage()` |
| LoginFX | `app.js` (IIFE before App) | `start(effect, color)`, `stop()` |
| Dashboard | `dashboard.js` | `render()` |
| Students | `students.js` | `render()`, `renderNew()`, `save()`, `deleteStudent()` |
| Classes | `classes.js` | `render()`, `saveClass()`, `deleteClass()` |
| Subjects | `subjects.js` | `render()`, `saveSubject()` |
| Timetable | `timetable.js` | `render()`, `saveSlot()` |
| Attendance | `attendance.js` | `render()`, `saveRegister()` |
| Academics | `academics.js` | `render()`, `saveMark()`, `generateReportCard()` |
| Exams | `exams.js` | `render()`, `saveExam()`, `saveResult()` |
| Admissions | `admissions.js` | `render()`, `renderPublicForm()`, `approveApplication()`, `enrollStudent()` |
| Finance | `finance.js` | `render()`, `createInvoice()`, `recordPayment()` |
| Communication | `communication.js` | `render()`, `sendMessage()` |
| Events | `events.js` | `render()`, `saveEvent()` |
| Reports | `reports.js` | `render()` |
| HR | `hr.js` | `render()`, `saveStaff()` |
| Behaviour | `behaviour.js` | `render()`, `logModal()`, `saveIncidentNew()`, `submitAppealModal()`, `resolveAppealModal()`, `generateReport()` |
| Settings | `settings.js` | `render()` |
| Changelog | `changelog.js` | `render()` |
| Help | `help.js` | `render()` |

---

## 12. Behaviour Module Deep Dive

The Behaviour module (`behaviour.js`) is the most complex in the system. Here is a reference for its internal structure.

### State Variables
```js
let _tab    = 'dashboard';   // Current tab key
let _period = 'term';        // Period filter: 'week'|'month'|'term'|'all'
let _incFilter    = { type:'all', classId:'', search:'', status:'all' };
let _appealFilter = { status:'pending' };
let _logState     = {
  type:            'merit',  // 'merit' | 'demerit'
  catId:           '',       // Selected category ID (from behaviour_settings.categories)
  selectedId:      '',       // Selected matrix item ID, or '' for custom category
  search:          '',       // Item search query (Step 3)
  classId:         '',       // Class filter for student dropdown
  presetStudentId: '',       // Preserved student selection across refreshes
  presetDate:      '',       // Preserved date selection across refreshes
};
```

> **Note**: The old `source`, `matCat`, and `customCatId` fields were removed in v2.1.0. The category object itself (looked up via `catId`) determines whether it is matrix-backed (`selCat.matCat`) or custom (`selCat.customPoints`).

### Data Collections
- **`behaviour_settings`** (single record): matrix, categories, meritMilestones, demeritStages, houses, detentionTypes, keyStages, demeritWindow, seriousIncidentThreshold, halfTermWeeks
- **`behaviour_incidents`**: one record per logged incident
- **`behaviour_appeals`**: one record per submitted appeal
- **`detentions`**: detention sessions

### Incident Record Schema
```js
{
  id, schoolId, studentId,
  type:           'merit' | 'demerit',
  behaviourId:    string | null,   // Matrix item ID (e.g. 'ca_m3')
  categoryId:     string | null,   // Custom category ID
  categoryName:   string,          // Display name
  points:         number,          // Positive for merit, negative for demerit
  housePoints:    number,
  note:           string,
  reportedBy:     userId,
  reportedByName: string,
  date:           'YYYY-MM-DD',
  termId:         string,
  academicYearId: string,
  milestoneReached: milestoneId | null,
  stageReached:   number | null,
  status:         'active' | 'appealing' | 'overturned',
  parentNotified: boolean,
  detentionScheduled: boolean,
  createdAt:      ISO8601
}
```

### Appeal Record Schema
```js
{
  id, schoolId, incidentId, studentId,
  submittedBy, submittedByName, submittedAt,
  reason:         string,
  parentNote:     string | null,
  resolution:     string | null,
  resolvedBy:     userId | null,
  resolvedByName: string | null,
  resolvedAt:     ISO8601 | null,
  status:         'pending' | 'escalated' | 'accepted' | 'rejected'
}
```

### Appeal → Incident Status Lifecycle
```
Incident created          → status: 'active'
Student submits appeal    → incident: 'appealing',  appeal: 'pending'
Staff escalates           → incident: 'appealing',  appeal: 'escalated'
Staff accepts             → incident: 'overturned', appeal: 'accepted'
Staff rejects             → incident: 'active',     appeal: 'rejected'
```

### Matrix Structure (`cfg.matrix`)
Each item:
```js
{
  id:         'ca_m3',             // Category prefix + type + number
  cat:        'ca',                // Category code
  catName:    'Classroom & Academic',
  type:       'merit' | 'demerit',
  label:      'Outstanding academic achievement',
  points:     3,                   // Always positive in the matrix
  housePoints: 3
}
```

Category codes: `ca` (Classroom), `co` (Corridors), `sp` (Sports), `ip` (Interpersonal), `sr` (School Rules), `di` (Dining), `dt` (Digital), `lc` (Leadership).

### Key Helper Functions
```js
_cfg()                            // Returns behaviour_settings[0] with defaults
_halfTermDemeritPts(studentId)    // Rolling half-term demerit total
_getCurrentStage(studentId, termId) // Respects cfg.demeritWindow
_detectPatterns(incidents, cfg)   // Returns behaviourId combos with count ≥ 2
_housePts(houseId, period, termId) // Period-aware house cup points
_filterByPeriod(incidents, period) // Filters array by _period date range
_logBody()                        // Renders log modal inner HTML from _logState
_logRefresh()                     // Preserves student/date, re-renders modal body
```

---

## 13. Audit Log

### Overview
Every critical operation that mutates sensitive data appends an entry to the `audit_log` localStorage collection via `_audit(action, details)` (defined in `app.js`).

`_audit()` is **silent** — it never throws and never shows UI feedback. If it fails (e.g. storage full), it logs a `console.warn` and returns. This ensures the primary action never gets blocked by audit failure.

### Action Constants

| Action | Fired in | Key `details` fields |
|---|---|---|
| `STUDENT_UPDATED` | `students.js` `save()` | studentId, studentName, admissionNo, changes (classId/status/houseId diff) |
| `STUDENT_DELETED` | `students.js` `deleteStudent()` | studentId, studentName, admissionNo, class |
| `PAYMENT_RECORDED` | `finance.js` `savePayment()` | invoiceId, invoiceNo, studentId, amount, method, reference, newStatus, newBalance |
| `APPEAL_RESOLVED` | `behaviour.js` `saveResolution()` | appealId, incidentId, studentId, studentName, outcome, resolutionNote |
| `ACADEMIC_YEAR_CHANGED` | `settings.js` `setCurrentYear()` | from {id, name}, to {id, name} |
| `ACADEMIC_YEAR_DELETED` | `settings.js` `deleteYear()` | id, name, startDate, endDate |
| `PERMISSION_CHANGED` | `settings.js` `togglePerm()` | roleKey, roleName, module, action, newValue |

### Adding a New Audit Point
```js
// At the point where the critical DB write completes:
_audit('ACTION_CONSTANT', {
  entityId:   id,
  entityName: name,
  // ... any context that would help reconstruct what happened
});
```

### Querying the Log (console)
```js
// All audit entries
DB.get('audit_log');

// All payment events
DB.query('audit_log', a => a.action === 'PAYMENT_RECORDED');

// All actions by a specific user
DB.query('audit_log', a => a.performedBy === 'u_admin1');
```

### Operation Guards
Guards run before the destructive DB call and return early if the condition is not met:

| Guard | Location | Condition |
|---|---|---|
| Cannot delete student with open appeals | `students.js deleteStudent()` | Blocks if any `behaviour_appeals` for this student has status `pending` or `escalated` |
| Cannot delete current academic year | `settings.js deleteYear()` | Blocks if `ay.isCurrent === true` |
| Cannot delete class with students | `settings.js deleteClass()` | Blocks if any student has `classId === classId` |
| Cannot change superadmin permissions | `settings.js togglePerm()` | Reverts and shows warning |

---

## 14. Browser Test Layer

### Running Tests
Open the app with `?tests=1` appended to the URL — tests run automatically 800 ms after login.

Or, at any time in the browser console:
```js
InnoLearnTests.run()
```

### Test Suites

| Suite | What it checks |
|---|---|
| **DB Layer** | insert/getById/update/query/delete/set round-trips |
| **SchoolContext** | currentTermId, currentAcYearId return non-empty strings from the live school record |
| **Global Utilities** | assert() throws / doesn't throw, safe() catches errors, isOverlapping() edge cases |
| **Seed Data Integrity** | Schools count, users present for each role, students have required fields, behaviour settings are configured, 8 default categories |
| **Audit Log** | _audit() appends a record with the correct shape |
| **Behaviour Module** | Module and public API present, matrix items have the `pts` field (not `points`), categories have required fields |

### Adding New Tests
Open `js/tests.js`. Each suite is a `_testXxx()` function. Add checks using:
```js
_check('description of what should be true', boolean_expression);
```
Then call your suite from `run()`.

---

## 16. Branding & Login Page System

### Data Shape
All branding is stored on `schools[0]` in localStorage:

```js
{
  logo:    '<base64 data URL>',   // or null
  favicon: '<base64 data URL>',   // or null
  appName: 'My School System',    // or null → falls back to 'InnoLearn'
  theme: {
    primary:   '#2563EB',
    sidebarBg: '#0F172A',
  },
  loginPage: {
    effect:       'particles',    // 'none'|'particles'|'aurora'|'water'|'clouds'|'fire'
    effectColor:  '#2563EB',
    welcomeTitle: 'Welcome back 👋',
    welcomeSub:   'Sign in to your portal',
    tagline:      'A complete school management platform…',
    footerText:   '© 2025 InnoLearn · Nairobi',
    features: [
      { icon: 'fas fa-users', color: 'blue', title: '…', desc: '…' },
      // × 4
    ],
    social: {
      facebook: 'https://…', twitter: '', instagram: '',
      linkedin: '', whatsapp: '', youtube: '',
    },
  },
}
```

### `App.applyBranding()`
Called from `_showApp()` on every login. Reads `schools[0]` and:
1. Toggles sidebar logo between `<img>` and `<i class="fas fa-graduation-cap">`.
2. Updates `#sidebar-app-name` text and `document.title`.
3. Updates `<link rel="icon">` href for favicon.
4. Injects `<style id="ss-theme">` into `<head>` with `:root` CSS variable overrides. Derived variables:
   - `--primary-dark` → `_shadeColor(primary, -25)`
   - `--primary-darker` → `_shadeColor(primary, -45)`
   - `--primary-light` → `_mixWithWhite(primary, 0.88)`
   - `--primary-glass` → `rgba(r,g,b, 0.12)`

### `App.applyLoginPage(school)`
Called from `_showLogin()` on every logout / initial page load. Reads `schools[0].loginPage` and:
1. Updates `#login-brand-h1` innerHTML (splits name at last space for two-tone styling).
2. Updates `#login-tagline`, `#login-welcome-title`, `#login-welcome-sub`, `#login-footer-text`.
3. Re-renders `#login-features-list` if custom features are saved.
4. Renders `#login-social-links` bar (filters out empty URLs).
5. Calls `LoginFX.start(effect, effectColor)`.

### `LoginFX` IIFE
Defined in `app.js` before the `App` IIFE. Canvas animation engine:

```js
LoginFX.start('particles', '#2563EB');  // start animation
LoginFX.stop();                          // stop + clear canvas
```

**Internals:**
- `_canvas` / `_ctx` — refs to `#login-canvas` element and its 2D context.
- `_raf` — `requestAnimationFrame` handle; cancelled by `stop()`.
- `_resize()` — sets `canvas.width/height` from `offsetWidth/offsetHeight`; bound to `window resize`.
- Five animation functions — each runs an `rAF` loop:
  - `_fxParticles()` — 65 floating dots drifting upward
  - `_fxAurora()` — 5 sine-wave bands with radial gradient fills
  - `_fxWater()` — 6 layered wave fills using compound sine
  - `_fxClouds()` — 7 multi-circle cloud shapes drifting right
  - `_fxFire()` — 90 radial-gradient particles rising from bottom

### Immersive Login Layout
The login screen HTML structure (v2.6+):

```html
<div class="login-screen">           <!-- grid: 1fr 1fr, has the gradient bg -->
  <canvas class="login-canvas">      <!-- position:absolute, fills login-screen -->
  <div class="login-grid">           <!-- dot-grid texture, full-screen absolute -->
  <div class="login-left">           <!-- transparent overlay, z-index:2 -->
  <div class="login-right">          <!-- transparent flex container, z-index:2 -->
    <div class="login-card">         <!-- white floating card, loginCardFloat anim -->
      <div class="login-right-inner">
      <div class="login-right-footer">
```

`loginCardFloat` keyframe: 12px vertical travel over 7s, shadow deepens at peak (`0 28px 80px rgba(0,0,0,.42)`) to simulate light physics of an object rising above a surface.

---

## 17. Known Limitations

| Limitation | Impact | Workaround / Phase |
|---|---|---|
| localStorage only (~5MB) | Large schools with many incidents may approach the limit | **Phase 3**: localStorage CRUD replaced by API calls |
| Single browser tab | Two tabs can have conflicting localStorage writes | **Phase 3**: State managed via API; tabs become independent |
| No real file uploads | Document attachments in admissions are simulated | Link to external document storage (Google Drive etc.) |
| No real-time sync | Multi-user simulation is role-switching within one session | **Phase 4**: Socket.io WebSocket layer |
| SEED_VERSION wipe | Bumping resets ALL localStorage data | Export critical data before bumping; server-side data is unaffected |
| Data isolation (new schools) | New schools currently share InnoLearn demo data from localStorage seed | **Phase 3**: All reads go to server |
| Frontend reads legacy /api/collections/* | No RBAC or pagination on legacy route | **Phase 2–3**: Migrate frontend module by module to new routes |
| Messages offline sync | Offline messages in localStorage are not auto-synced on reconnect | Manual page refresh merges local + server messages |

### v4.5.1 — Hotfix: stale `adminPassword` reference (`server/routes/onboard.js`)

When removing the password field from the onboarding form (v4.4.0), a stale `if (adminPassword.length < 8)` validation block was left in `_provisionInDB`. Because `adminPassword` was no longer declared in scope, Node threw a `ReferenceError` on every `POST /api/onboard` — the school and user records were never written to MongoDB, and all downstream platform actions (approve, impersonate, emails) silently failed. The three stale lines were removed in v4.5.1.

**Lesson**: always run `node -e "require('./server/routes/<file>')"` after editing a route to catch syntax and reference errors before pushing.

---

## 23. Platform Admin API (`server/routes/platform.js`) — v4.5+

All routes require `X-Platform-Key` header (checked by `platformAdmin` middleware). Protected entirely from school-level JWT auth.

### Route Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/platform/schools` | List all schools with student/staff counts |
| `POST` | `/api/platform/schools/:id/approve` | Approve school + activate user + send welcome email |
| `POST` | `/api/platform/schools/:id/reject` | Reject school + send rejection email |
| `PATCH` | `/api/platform/schools/:id` | Update plan / addOns / isActive |
| `POST` | `/api/platform/schools/:id/impersonate` | Get a JWT for the school's superadmin |
| `DELETE` | `/api/platform/schools/:id` | Delete school + all tenant data |
| `DELETE` | `/api/platform/schools/all` | Wipe all non-demo schools + all tenant data |
| `DELETE` | `/api/platform/orphans` | Purge superadmin users with no matching school |
| `GET` | `/api/platform/stats` | MRR, ARR, plan breakdown, counts |
| `GET` | `/api/platform/test-email` | Verify SMTP config + send test email |
| `GET/POST/PATCH/DELETE` | `/api/platform/announcements[/:id]` | System announcements CRUD |

> **Route ordering**: `DELETE /schools/all` MUST be registered before `DELETE /schools/:id`. Express matches routes in order — if `:id` is first, the literal string `"all"` is treated as an ID and Mongoose tries to cast it to ObjectId, causing a 500.

### Mongoose `id` Virtual Conflict — Critical Pattern

Mongoose has a built-in `id` **virtual** that returns `_id.toString()`. This conflicts with the custom `id` field stored in school/user documents (e.g. `sch_slug_timestamp`).

**Symptoms:**
- `School.findOneAndUpdate({ id: req.params.id }, ...)` — never matches, returns `null`
- `s.id` on a lean result — may return `undefined` if Mongoose virtual shadows the stored field
- `schoolIds` array built from `.map(s => s.id)` — can be all `undefined`, causing `deleteMany` to match nothing (users remain in DB)

**Rules for this codebase:**
```js
// ✅ Always look up schools by MongoDB _id
School.findById(req.params.id)          // uses ObjectId, always reliable
School.findByIdAndUpdate(req.params.id) // same

// ✅ On lean() results, prefer _id for identity, but id field works for custom FK
const monIdStr = school._id.toString(); // always present
const customId = school.id;             // the sch_slug_xxx string (if stored correctly)

// ❌ Never use findOne({ id: someValue }) — Mongoose treats it as _id lookup
```

### Three-Strategy Tenant Deletion

The `_tenantQuery(school)` helper builds an `$or` filter using three overlapping strategies to guarantee orphaned records are never left behind:

```js
function _tenantQuery(school) {
  const clauses = [];
  // 1. Custom id field (primary FK)
  if (school.id?.startsWith('sch_')) clauses.push({ schoolId: school.id });
  // 2. ObjectId string (some older docs)
  clauses.push({ schoolId: school._id.toString() });
  return clauses.length ? { $or: clauses } : null;
}
```

Additionally, both delete routes always delete users by `school.adminEmail` regardless of `schoolId` matching — this is the guaranteed fallback.

### Dual-Identifier Pattern — students/classes/streams/users (v4.62.0)

The same root cause as the Mongoose `id` virtual conflict above shows up independently across student, class, stream, and user documents: each one references others by whichever identifier form was current when the reference was **written** — the custom UUID `id` field (what routes generate today) or the MongoDB `_id` string (pre-migration and imported records). The UUID migration never back-filled `id` onto old documents or rewrote denormalised references (e.g. a student's stored `classId`), so a collection can legitimately contain both forms side by side, referencing each other inconsistently.

**Symptom pattern:** anything that does an exact-string lookup or filter against one identifier form silently misses documents written under the other. This produced several distinct-looking bugs before the actual cause was found (v4.62.0): 500s on student deactivate/reactivate/portal-account for imported students, "No students found" on a correctly-populated class/stream/section filter (and the Export feature, which shares the same endpoint), and MongoDB ObjectIds rendering in place of class names on the analytics dashboard (v4.61.0, same root cause, independently discovered first).

**Rules for this codebase, going forward:**

```js
// Single-document lookup — try id, then _id, in that order:
let doc = await Model.findOne({ id: req.params.id, schoolId }).lean();
if (!doc) {
  try { doc = await Model.findOne({ _id: req.params.id, schoolId }).lean(); } catch (_) {}
}

// Writes always target _id — it is always present, id may not be:
await Model.updateOne({ _id: doc._id }, { $set: { ... } });

// Canonical outbound id — prefer the UUID, fall back to the ObjectId string:
const canonicalId = doc.id || String(doc._id);

// List filters — resolve every form an entity is known by, then $in-match:
// (server/routes/students.js — reusable across any collection)
async function _entityIdForms(col, schoolId, value) {
  const or = [{ id: value }];
  if (mongoose.Types.ObjectId.isValid(value) && String(value).length === 24) or.push({ _id: value });
  const doc = await _model(col).findOne({ schoolId, $or: or }).select('id').lean();
  const forms = new Set([value]);
  if (doc?.id)  forms.add(doc.id);
  if (doc?._id) forms.add(String(doc._id));
  return [...forms];
}
// filter.classId = { $in: await _entityIdForms('classes', schoolId, classId) };
```

```js
// ❌ Never do this — misses every document written under the other identifier form:
filter.classId = req.query.classId;
await Model.updateOne({ id: req.params.id, schoolId }, { $set: data }); // fails silently for _id-only docs

// ❌ Also wrong: excluding entities without a UUID instead of including both forms
const ids = classes.map(c => c.id).filter(Boolean); // drops pre-migration classes from the result entirely
```

**Client-side mirror of the same rule:** always resolve an entity's id as `entity.id ?? entity._id` when building a URL or a list key — see `StudentList.jsx`, `ClassDetail.jsx`, `StudentProfile.jsx`.

**A related, structurally different trap in the same area (v4.62.0):** `users_school_email` / `users_school_username` were **unique + sparse compound** indexes. Sparse compound indexes still index a document if it has *any one* of the compound keys — every user has `schoolId`, so every user (including students with no email, parents with no username) was indexed, permitting only one such document per school before `E11000` on the second. Fixed by converting to **partial indexes** (`partialFilterExpression: { field: { $type: 'string' } }`) in `server/utils/indexes.js` — uniqueness enforced only on real string values. Never write `email: null` / `username: null`; omit the field entirely when absent.

### Impersonate Flow (v4.5.5+)

```
POST /api/platform/schools/:id/impersonate
  ↓
School.findById(:id) → get school.name, school.id, school.adminEmail
  ↓
User.findOne({ role:'superadmin', $or:[{ schoolId }, { email: adminEmail }] })
  ↓
sign({ userId, schoolId, email, role, roles, schoolName, impersonated:true })
  ↓
res.json({ token, user: { ...admin, schoolName, schoolId } })
```

**Frontend (`doImpersonate` in `platform.html`):**
1. Clears all 17 legacy localStorage keys (InnoLearn demo data)
2. Stores `{ token, user, school }` under `innolearn_session` (the React auth store key)
3. Redirects to `/login` (React SPA) — NOT `/index.html` (legacy app)

The React SPA reads `innolearn_session` on mount. Because `session.token` is present, `isAuthenticated` is `true`, and `ProtectedRoute` immediately redirects to `/dashboard` without showing the login form.

### Sidebar Dynamic Branding (v4.5.5+)

`client/src/components/layout/Sidebar.jsx` derives school identity from `user.schoolName` in the JWT session:

```js
const schoolName     = user?.schoolName || 'My School';
const schoolInitials = schoolName.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
```

This replaces the previous hardcoded `"InnoLearn"` / `"IL"` — every school now sees their own name and initials. The secondary line shows the user's role (e.g. "Superadmin").

### Orphan Cleanup Endpoint (v4.5.7+)

`DELETE /api/platform/orphans` fixes stuck email addresses after a partial delete:

1. Fetches all active school `adminEmail`s and custom `id`s
2. Queries all `superadmin` users
3. Deletes any whose email is not in the active set OR whose `schoolId` is not in the active set
4. Returns `{ deleted: N, emails: ['...'] }`

Available in the platform UI: **Diagnostics → Purge Orphaned Users**.

---

## 18a. Phase 1 — Production Backend Architecture

> **Status: Implemented (v4.0.0).** All new routes coexist with `/api/collections/*`.

### New Middleware Stack

Every new resource route passes through this middleware chain:

```
authMiddleware → planGate(feature) → rbac(module, action) → handler
```

1. **`authMiddleware`** — Verifies JWT; attaches `req.jwtUser = { userId, schoolId, role, roles, email }`
2. **`planGate(feature)`** — Verifies the school's subscription plan includes the feature  
3. **`rbac(module, action)`** — Verifies the user's role has the required permission

### RBAC Permission Document Shape

```json
{
  "schoolId": "sch_abc123",
  "role": "teacher",
  "permissions": {
    "students":   ["read"],
    "attendance": ["read", "create", "update"],
    "finance":    []
  }
}
```

- Only `superadmin` bypasses the DB check — always granted access
- `admin` goes through RBAC so superadmin can restrict it from Settings → R&P tab
- Per-user overrides: docs keyed by `{ schoolId, userId }` (no `roleKey`) are merged on top of role permissions — user overrides win per module
- Cache TTL: 5 minutes per `schoolId::role` pair; user-specific entries cached as `schoolId::user::userId`
- Call `invalidatePermCache(schoolId)` after any `role_permissions` update

### Plan Tier Map

```
core     → students, attendance, classes, teachers, grades, subjects, events, messaging
standard → + behaviour, timetable, exams, key_stages, houses, sections
premium  → + finance, admissions, reports, report_cards, custom_roles
enterprise → + api_access, sso, advanced_analytics, multi_campus, white_label
```

Plans are cumulative — `premium` includes all `standard` and `core` features.

### Standardised Response Envelope

All new routes return one of two shapes:

```js
// Success
{ success: true, data: <any>, pagination?: { page, limit, total, pages } }

// Failure
{ success: false, error: { code: "ERROR_CODE", message: "Human message" } }
```

Use `ok(res, data, pagination?)` and `fail(res, code, message, status?)` from `server/utils/response.js`.

### Atomic Sequential IDs

Never accept admission numbers, staff IDs, or invoice numbers from the client. Always generate server-side:

```js
const { nextAdmissionNumber } = require('../utils/counters');
const admNo = await nextAdmissionNumber(schoolId); // "ADM-2026-00001"
```

Counter documents in MongoDB `counters` collection:
```json
{ "_id": "admission_sch_abc_2026", "seq": 42 }
```

### Adding a New Resource Route (v4 Pattern)

1. Create `server/routes/myresource.js`
2. Import: `authMiddleware`, `rbac`, `planGate`, `_model`, `counters` (if IDs needed), `response`
3. Add Zod schema, `_validate()` helper
4. Use middleware chain: `authMiddleware, planGate('feature'), rbac('module', 'action')`
5. Use `parsePagination(req.query)` for all list endpoints
6. Use `ok()` / `created()` / `E.*` for all responses
7. Register in `server/index.js`: `app.use('/api/myresource', require('./routes/myresource'))`

### Migration Strategy (Legacy → Production)

The `/api/collections/:col` route remains active throughout all migration phases. Frontend modules are migrated one at a time:

1. Update the JS module to call `API.students.list(params)` instead of `DB.get('students')`
2. Remove the fallback `DB.get()` call once the new route is stable
3. Delete the collection from `ALLOWED` in `collections.js` once all frontend references are gone

---

## 18. School Approval Workflow

New schools registered via `/api/onboard` go through a manual approval step before they can log in. This section describes the full lifecycle.

### School Status States

```
pending   →   active      (approved by platform admin)
pending   →   rejected    (rejected by platform admin)
active    →   inactive    (suspended via PATCH /api/platform/schools/:id)
```

### Registration (`POST /api/onboard`)

`server/routes/onboard.js` creates records in MongoDB:

```js
// School record
{ id, slug, name, shortName, plan, isActive: false, status: 'pending',
  adminName, adminEmail, currency, timezone, curriculum[], sections[] }

// Superadmin user record
{ id, schoolId, email, password: bcryptHash, role: 'superadmin',
  isActive: false }
```

Two emails are sent immediately (non-blocking):
- **`sendRegistrationPending`** → school admin ("your application is under review")
- **`sendAdminNewSchoolAlert`** → platform owner (`PLATFORM_EMAIL`) with school details

No JWT is issued — the admin cannot log in until approved.

### Approval (`POST /api/platform/schools/:id/approve`)

Protected by `X-Platform-Key` header.

```js
// Atomically updates school
{ isActive: true, status: 'active', approvedAt: ISO_DATE }

// Activates superadmin user
User.updateMany({ schoolId, role: 'superadmin' }, { isActive: true })

// Fires two emails in parallel
sendApprovalWelcome({ adminName, adminEmail, schoolName, slug, plan })
sendAdminApprovalAlert({ schoolName, adminEmail, plan })
```

### Rejection (`POST /api/platform/schools/:id/reject`)

```js
{ isActive: false, status: 'rejected', rejectionReason: reason }
sendRejectionEmail({ adminName, adminEmail, schoolName, reason })
```

### Login Gate

`server/routes/auth.js` now looks up the user **without** the `isActive` filter first. If the user is found but `isActive === false`, it inspects the school record:

| School status | HTTP status | Error key | Frontend behaviour |
|---|---|---|---|
| `pending` | 403 | `pending_approval` | "Application Under Review" screen replaces login form |
| `rejected` | 403 | `rejected` | Toast with support email |
| Other inactive | 403 | — | Generic "Account inactive" message |
| Not found / wrong password | 401 | — | Normal shake + error toast |

---

## 19. Email Utility (`server/utils/email.js`)

The platform operates a two-layer email architecture:

1. **Platform SMTP** — `innolearnnetwork@gmail.com` via Gmail App Password. Used for all platform-level emails (registration, approvals, OTP) and as the fallback sender for any school that has not configured custom SMTP.
2. **Per-school custom SMTP** — each school on the Standard plan or above can configure their own SMTP server (e.g. `noreply@greenwood.ke`). Credentials are encrypted at rest with AES-256-GCM and stored per school. Msingi automatically falls back to platform SMTP if the custom server is unreachable.

### Environment Variables Required

All must be set in **Render dashboard → Environment** (never committed to git):

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | Auto-generated by Render (via `generateValue: true` in `render.yaml`) |
| `PLATFORM_ADMIN_KEY` | Auto-generated by Render |
| `SMTP_USER` | Platform Gmail address (`innolearnnetwork@gmail.com`) — permanent, never change |
| `SMTP_PASS` | Gmail **App Password** — 16 chars (NOT the Gmail account password). myaccount.google.com → Security → 2-Step Verification → App passwords |
| `PLATFORM_EMAIL` | Recipient for platform owner alerts (can be same as `SMTP_USER`) |
| `APP_URL` | `https://school-management-ecosystem.onrender.com` |
| `SMTP_ENCRYPTION_KEY` | AES-256-GCM key for encrypting per-school SMTP passwords at rest. **See generation instructions below.** |

#### Generating `SMTP_ENCRYPTION_KEY`

Run this command in any terminal to produce the key value:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

The output will be a 44-character base64 string like:
```
3f9kXmP2nR8qLvT1yBcWdE6sHjUoI0aZ5x7K+Ng4Q==
```

**Set that output string as the env var value** — not the command itself.

> ⚠️ **Common mistake**: pasting the `node -e "..."` command text directly into Render as the value. Render will store the literal command string, which is not a valid AES key. The Settings → School Profile → Email/SMTP card will show *"SMTP_ENCRYPTION_KEY is not set on the server"* until a valid key is stored and the service redeployed.

> ⚠️ **Consistency**: once any school has saved custom SMTP credentials, **never change this key**. The ciphertext stored in MongoDB was encrypted with the original key — changing it renders all saved SMTP passwords unreadable and every school would need to re-enter their credentials.

> ℹ️ **Plan gate**: `custom_smtp` is gated to the `standard` plan. Schools on `core` see the section but cannot save. The plan gate is enforced server-side (`planGate('custom_smtp')`).

### Platform SMTP Startup Validation

On module load, `email.js` checks `SMTP_USER` and `SMTP_PASS`. If either is missing:
```
[EMAIL] ⚠️  SMTP_USER / SMTP_PASS not set — all emails will be skipped.
```
`_send()` short-circuits immediately (`return false`). Missing config never causes an API error.

### Per-school SMTP Flow (`_resolveTransporter`)

```
_sendAsSchool(to, subject, html, { schoolId })
  └─ _resolveTransporter(schoolId)
       ├─ No schoolId OR SMTP_ENCRYPTION_KEY not set  → platform transporter
       ├─ School has no smtpPassEnc field             → platform transporter
       ├─ Cache hit (< 60 min TTL)                    → cached transporter
       └─ Cache miss → decrypt smtpPassEnc → build nodemailer transporter → cache
            └─ Custom send fails → retry with platform transporter (fallback)
```

Cache is per-school with a 60-minute TTL. Call `invalidateSmtpCache(schoolId)` after saving or deleting SMTP config to force a fresh transporter on the next send.

### Exported Functions (13 total)

| Function | When sent | Recipients |
|---|---|---|
| `sendRegistrationPending(opts)` | School registers | School admin |
| `sendAdminNewSchoolAlert(opts)` | School registers | Platform owner |
| `sendApprovalWelcome(opts)` | School approved | School admin (includes password + `/login` URL) |
| `sendRejectionEmail(opts)` | School rejected | School admin |
| `sendAdminApprovalAlert(opts)` | School approved | Platform owner |
| `sendLoginOTP(opts)` | 2FA trigger | User |
| `sendTrialReminder(opts)` | Trial expiry (0/1/3 days) | School admin |
| `sendWelcomeCredentials(opts)` | User created/password set by admin | New user |
| `sendPasswordExpirySoon(opts)` | Password nearing 90-day expiry | User |
| `sendPasswordChanged(opts)` | Password changed | User |
| `sendRoleChanged(opts)` | Role updated | Affected user |
| `sendSystemUpdateNotice(opts)` | Announcement (notifyAll) | All active school admins |
| `sendMessageNotification(opts)` | In-app message sent | Recipient |

All functions return `true`/`false` (never throw). Failures are logged but do not break the API response.

> **v4.5.6**: `sendApprovalWelcome` login URL was `APP_URL?school=slug` (routes to legacy `index.html`). Fixed to `APP_URL/login` (React SPA).

### HTML Template

All emails use a shared `_wrap(body)` function: InnoLearn gradient header, content body, footer with platform URL. Status badges (`.badge.pending`, `.badge.approved`, `.badge.rejected`) are inline-styled for email client compatibility.

### Diagnosing Email Issues

Use the built-in endpoint (platform admin only):
```
GET /api/platform/test-email
X-Platform-Key: <your key>
```
Returns `{ success, config: { SMTP_USER, SMTP_PASS, APP_URL }, message }`. Sends a real test email to `PLATFORM_EMAIL`. Also accessible via **Platform dashboard → Diagnostics → Send Test Email**.

---

## 20. Mongoose Model Factory (`server/utils/model.js`)

All server routes use a single shared `_model(collectionName)` factory instead of registering named Mongoose models:

```js
function _model(col) {
  const name = col
    .replace(/_([a-z])/g, (_, c) => c.toUpperCase())  // snake_case → camelCase
    .replace(/^./, c => c.toUpperCase()) + 'Doc';       // PascalCase + Doc suffix
  if (mongoose.models[name]) return mongoose.models[name];
  const schema = new mongoose.Schema({}, { strict: false, timestamps: true });
  schema.index({ schoolId: 1 });
  schema.index({ id: 1 });
  return mongoose.model(name, schema, col);
}
```

**Why**: Mongoose throws if you call `mongoose.model('User')` more than once in the same process (e.g. when hot-reloading or across multiple route files). The factory caches the model in `mongoose.models` by a deterministic name and reuses it.

**Usage**: `const User = _model('users')` — returns a Mongoose model that maps to the `users` collection with `strict: false` (accepts any fields without a predefined schema).

---

## 21. Setup Wizard (`js/modules/dashboard.js`)

The `_setupWizard(school)` function (private to the `Dashboard` IIFE) renders a checklist card at the top of the Super Admin dashboard.

### Step Completion Detection

Each step inspects `DB.get(collection)` filtered by `school.id`:

| Step | Done when |
|---|---|
| Profile | `school.address \|\| school.phone \|\| school.logo` is truthy |
| Academic year | `academicYears` has a record with `schoolId === school.id` and `terms.length > 0` |
| Classes | `classes` has ≥ 1 record with `schoolId === school.id` |
| Staff | `teachers` has ≥ 1 record with `schoolId === school.id` |
| Students | `students` has ≥ 1 record with `schoolId === school.id` |
| Fee structures | `feeStructures` has ≥ 1 record with `schoolId === school.id` |
| Report templates | `reportTemplates` has ≥ 1 record with `schoolId === school.id` |

### Dismissal

`dismissWizard(schoolId)` is a global function (outside the IIFE) that:
1. Sets `localStorage.setItem('setup_wizard_done_<schoolId>', 'true')`
2. Smoothly collapses and removes the `#setup-wizard` element

`_setupWizard()` checks for this key at the top and returns `''` (empty string) if set, so the wizard is completely absent from the DOM on re-render.

### Demo School Behaviour

The InnoLearn International School demo seed has students, teachers, and classes pre-populated, so most steps will already show as complete for the demo school. The wizard is most visible on a newly approved, empty school.

---

## 18. Production API Layer (v4.1+)

> **Status: Implemented.** All 10 resource routes live alongside `/api/collections/*`. Zero breaking changes.

### Route Inventory

| Route | Plan gate | Key features |
|---|---|---|
| `GET/POST /api/students` | core | Paginated, search, Zod validation, server-generated `admissionNumber`, bulk import (207) |
| `GET/POST /api/teachers` | core | `staffId` auto-generated, email uniqueness per school |
| `GET/POST /api/classes` | core | `GET /api/classes/:id/students` sub-route |
| `GET/POST /api/attendance` | core | `GET /api/attendance/summary` aggregation, `POST /api/attendance/bulk` atomic upsert |
| `GET/POST /api/finance/invoices` | premium | Server-side totals (subtotal, discount, tax), `PATCH .../void` |
| `POST /api/finance/payments` | premium | Server validates amount ≤ outstanding; auto-advances invoice status |
| `GET /api/finance/summary` | premium | Aggregate by payment method |
| `GET/POST /api/behaviour/incidents` | standard | `GET .../summary` merits/demerits per student |
| `GET/POST /api/behaviour/appeals` | standard | `PATCH .../resolve` updates incident status atomically |
| `GET/POST /api/exams` | standard | `GET /api/exams/:id/results` with class stats, `POST /api/exams/:id/results` bulk-upsert |
| `GET /api/grades/report` | standard | Weighted average per student per subject via aggregation |
| `GET/POST /api/admissions` | premium | `applicationRef` auto-generated, `stageHistory` append-only, `PATCH .../stage`, `GET .../stats` funnel |
| `GET/POST /api/timetable` | standard | Slot collision detection (409), `GET /api/timetable/class/:classId`, `POST .../bulk` |
| `POST /api/elearning/sessions` | standard | Schedule online session — no external API; stores teacher's PMI link; creates `elearning_sessions` + `events` record atomically |
| `GET /api/elearning/sessions` | standard | List all sessions for the school; sorted by scheduledAt desc |
| `DELETE /api/elearning/sessions/:id` | standard | Cancel session — deletes both `elearning_sessions` and linked `events` document |
| `GET /api/student-portal/dashboard` | — | Student-scoped payload including today's timetable; when `emergencyOnlineMode` is true, enriches each slot with `meetingLink`, `meetingPasscode`, `platform` by joining `teachers` collection |

### Middleware Chain

```
authMiddleware → planGate(feature) → rbac(module, action) → handler
```

Only `superadmin` bypasses the RBAC DB check. `admin` goes through RBAC so superadmin can restrict it via Settings. Plan cache and RBAC cache both TTL at 5 minutes.

### Frontend API Client (`js/api.js`)

```js
// All modules:
API.students.list(params)           // → paginated response
API.students.get(id)
API.students.create(data)
API.students.update(id, data)
API.students.remove(id)
API.students.bulkImport(rows)

API.finance.invoices.list(params)
API.finance.payments.record(data)
API.finance.summary(params)

API.behaviour.incidents.summary(params)
API.behaviour.appeals.resolve(id, data)

API.exams.results.bulkUpsert(examId, data)
API.admissions.changeStage(id, data)
API.timetable.bulkSet(data)
```

`APIError` class exposes `.code`, `.message`, `.status`. On 401, `api:unauthorized` is dispatched on `window` and the session is cleared.

### DB Hydration Flow

```
Module.render() called
    ↓
DB.hydrate('students') — checks in-memory Cache first (2-min TTL)
    ↓ cache miss
Fetch GET /api/students?limit=1000&page=1...N  (all pages)
    ↓
DB.set('students', allDocs)  — replaces localStorage collection
Cache.set('hydrate_students', true, 120_000)
    ↓
Module renders from localStorage (synchronous, fast)
```

On write (`DB.update`, `DB.insert`, `DB.remove`), `_push()` fires to the correct REST endpoint and calls `Cache.invalidate('hydrate_students')` on success — next render fetches fresh data.

---

## 19. React SPA (v4.3+)

> **Status: Implemented.** The `client/` app runs as an independent SPA that proxies all API calls to the same Express server.

### Development Workflow

```bash
# Terminal 1 — API server (port 3005)
npm run dev

# Terminal 2 — React dev server (port 5173, /api proxied to :3005)
npm run dev:react
# Open http://localhost:5173
```

### Production Build & Serve

```bash
npm run build:react        # Vite compiles → client/dist/
npm start                  # Express detects client/dist and serves it
```

Express checks `fs.existsSync('client/dist/index.html')` at startup. If present, it:
- Serves hashed assets (`*.8f3a1c2d.js`) with `Cache-Control: immutable`
- Returns `client/dist/index.html` for all SPA routes (`/dashboard`, `/students`, `/login`, etc.)
- Continues to return `index.html` (legacy) at `/` and `/platform`, `/onboard` at their own paths

### Key Architectural Decisions

| Decision | Rationale |
|---|---|
| `staleTime: 2 * 60 * 1000` | Matches server TTL cache — consistent freshness across legacy JS and React layers |
| `keepPreviousData: true` on list queries | No flash-to-empty on page/filter change |
| `api:unauthorized` window event | Decouples auth store from every API call; single listener in `auth.js` |
| Lazy-loaded pages with `<Suspense>` | Keeps initial bundle small; each module loads on first navigation |
| `can(feature)` on `useAuthStore` | Same permission model as legacy `Auth.hasPermission()` |
| `ProtectedRoute` preserves `from` location | After login, user lands on their originally intended page |

### TanStack Query Key Conventions

```js
['students', 'count']                          // single stat
['students', { page, search, classId, ... }]   // paginated list
['students', studentId]                        // single record
['attendance', 'summary', studentId]           // derived aggregation
['finance', 'invoices', { page }]              // sub-resource list
['finance', 'summary', year]                   // aggregated summary
```

Invalidation after mutation:
```js
qc.invalidateQueries({ queryKey: ['students'] })  // bust all student queries
```

### Adding a New Page

1. Create `client/src/pages/mymodule/MyPage.jsx`
2. Import API calls from `@/api/client.js`
3. Use `useQuery` for reads, `useMutation` for writes
4. Add the route to `client/src/App.jsx` (lazy import + route entry)
5. Add a nav item to `client/src/components/layout/Sidebar.jsx` under the appropriate section

### CSS Conventions (Tailwind)

All reusable patterns are defined in `src/index.css` under `@layer components`:

```css
.card        { @apply bg-white rounded-xl shadow-card border border-surface-border p-5; }
.btn-primary { @apply btn bg-brand-600 text-white hover:bg-brand-700; }
.form-input  { @apply w-full rounded-lg border border-slate-300 px-3 py-2 text-sm ...; }
.data-table  { @apply w-full text-sm; }
```

Use these class names directly in JSX — avoid writing Tailwind utility strings for common patterns.

---

## 20. Security Layer (v4.5+)

### Global Rate Limiting (`server/index.js`)

Two limiters are applied before any route handler runs:

```
Request → apiLimiter → [authLimiter if /api/auth] → route handler
```

| Limiter | Window | Max | Scope | Dev mode |
|---------|--------|-----|-------|----------|
| `apiLimiter` | 15 min | 300 req/IP | All `/api/*` | **Disabled** (skipped when `NODE_ENV !== 'production'`) |
| `authLimiter` | 15 min | 20 req/IP | `/api/auth` only | **Always on** |

**Why skip `apiLimiter` in dev?** Running seed scripts, automated tests, or hot-reload against `localhost` easily exceeds 300 requests. The auth limiter is always active so brute-force behaviour is testable locally.

**Standard headers** — every response includes:
```
RateLimit-Limit: 300
RateLimit-Remaining: 299
RateLimit-Reset: 1746285600
```

**Client back-off pattern** (React SPA `client/src/api/client.js`):
```js
if (res.status === 429) {
  const retryAfter = res.headers.get('RateLimit-Reset');
  throw new APIError('rate_limited', 'Too many requests — please wait and try again.', 429);
}
```

### Existing Per-Route Limits (unchanged)

Individual route files add their own stricter limits on top of the global ones:

| Route | Limit | Purpose |
|-------|-------|---------|
| `POST /api/auth/login` | 10 / 15 min | Login brute-force |
| `POST /api/auth/verify-otp` | 5 / 15 min | OTP exhaustion |
| `POST /api/auth/force-change` | 10 / 15 min | Prevent password spray |
| `POST /api/onboard` | 5 / hour | Registration abuse |
| `GET /api/onboard/check-slug` | 60 / min | Slug enumeration |

### Helmet Headers

Applied at startup before all routes:
```js
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
```
Sets: `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `X-XSS-Protection`, `Referrer-Policy`.

`contentSecurityPolicy` is disabled because the legacy app uses inline `<script>` tags. Enable it for the React SPA by adding a nonce or hash-based policy when fully migrating.

### Deployment — Render (`render.yaml`)

```yaml
buildCommand: npm install && cd client && npm install --include=dev && npm run build
startCommand: node server/index.js
```

**Why `--include=dev`?** `vite` and `tailwindcss` are in `devDependencies` of `client/package.json`. Render's default npm install strips devDependencies in production environments. The `--include=dev` flag and `client/.npmrc` (`include=dev`) together ensure the build step always has the tools it needs.

**Build sequence:**
1. `npm install` — installs Express, Mongoose, bcryptjs, etc. (root)
2. `cd client && npm install --include=dev` — installs React, Vite, Tailwind (client)
3. `npm run build` — Vite compiles `client/dist/`
4. `node server/index.js` — `fs.existsSync('client/dist/index.html')` returns `true` → React SPA served

---

## 21. Messaging API (v4.4+)

### Route — `server/routes/messages.js`

Mounted at `/api/messages`. Requires `authMiddleware` + `tenantMiddleware` (all requests scoped to the logged-in school).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/messages?tab=inbox&page=1` | List messages visible to current user |
| `POST` | `/api/messages` | Create message + send notification emails |
| `PATCH` | `/api/messages/:id/read` | Mark a message as read (per-user flag) |
| `DELETE` | `/api/messages/:id` | Delete (sender, admin, or deputy principal only) |

### Inbox Visibility Rules

The inbox query matches any message where `recipients` contains:
- `'all'` — sent to everyone in the school
- A **role group** that includes the user's role (e.g. `'teachers'` matches `teacher`, `section_head`, `deputy_principal`)
- The user's own **ID** (direct message)

Role group mapping:
```js
teachers: ['teacher', 'section_head', 'deputy_principal']
parents:  ['parent']
students: ['student']
staff:    ['teacher', 'section_head', 'deputy_principal', 'hr',
           'admissions_officer', 'finance', 'exams_officer',
           'timetabler', 'discipline_committee']
```

### Email Notifications

Every `POST /api/messages` triggers `sendMessageNotification()` for each resolved recipient:

```js
await email.sendMessageNotification({
  recipientName, recipientEmail,
  senderName, subject,
  preview,        // body trimmed to 160 chars
  schoolName,
  isDirect,       // true → "New Message", false → "School Announcement"
  appUrl,
});
```

Emails are fired with `Promise.allSettled()` — individual failures are logged but do not block the API response or affect other recipients.

### Frontend Integration (`js/modules/communication.js`)

The communication module uses `API.messages.*` with a full localStorage fallback:

```js
// Load inbox
const result = await API.messages.list({ tab: 'inbox', limit: 100 });

// Send message (triggers server-side email)
await API.messages.send({ subject, body, recipients: ['teachers'], type: 'announcement' });

// Mark read
await API.messages.markRead(messageId);
```

On any network failure, the module falls back to `DB.get('messages')` / `DB.insert('messages', ...)` so offline users retain full functionality.

### MongoDB Collection — `messages`

```js
{
  _id, id,
  schoolId,
  senderId, senderName, senderRole,
  recipients: ['all'] | ['teachers'] | ['parents'] | ['students'] | ['staff'] | [userId],
  subject, body,
  type: 'direct' | 'announcement',
  isRead: { [userId]: true },   // per-user read tracking
  createdAt,
}
```

---

## 22. School Registration & Credentials Flow (v4.4+)

### Registration Form Changes

The onboarding form (`onboard.html`) no longer includes a password field. The **Step 2** admin account section now only collects `adminName` and `adminEmail`.

**Server-side temp password generation** (`server/routes/onboard.js`):
```js
function _genTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  let pwd = '';
  for (const b of bytes) pwd += chars[b % chars.length];
  return pwd;
}
```
- 12 characters from a 55-char alphabet (no ambiguous `0/O`, `1/l/I`)
- ~74 bits of entropy — unguessable
- Stored in plaintext as `user.tempPassword` alongside the bcrypt hash, **only until the approval email is sent**

### User Document at Registration

```js
{
  id, schoolId, name, email,
  password: bcryptHash,
  tempPassword: 'xK7mNpQrBvW3',   // ← cleared after approval email
  mustChangePassword: true,
  isActive: false,                  // ← activated on approval
  role: 'superadmin',
}
```

### Approval Flow (`server/routes/platform.js`)

```
Platform admin clicks Approve
  → fetch adminUser (read tempPassword before clearing)
  → User.updateMany({ isActive: true, $unset: { tempPassword } })
  → sendApprovalWelcome({ ..., tempPassword })
  → tempPassword gone from DB; only exists in the email
```

### Approval Email Contents

The school admin receives a single email with:
- **Dedicated login URL**: `https://app.innolearn.edu.ke?school={slug}`
- **Email / Username**: the email used at registration
- **Temporary Password**: styled monospace block, e.g. `xK7mNpQrBvW3`
- Security notice: "You will be asked to set a new password on first login"

### `?school=slug` URL Parameter Handling

```js
// js/app.js — DOMContentLoaded
const schoolParam = params.get('school');
if (schoolParam && /^[a-z0-9-]{2,40}$/.test(schoolParam)) {
  localStorage.setItem('ss_school_slug', schoolParam);
  window.history.replaceState({}, '', window.location.pathname);
}
```

The slug is validated against a strict regex before storing. The URL is cleaned immediately so the slug doesn't appear in browser history or shared links.

**Effect**: `_getSchoolSlug()` (called by the API client when building `X-School-Slug` headers) now returns `'greenhill'` instead of `'demo'`, routing all API calls to the correct tenant from the very first request.

### Force Password Change on First Login

`auth.js` login handler checks `user.mustChangePassword` before issuing a JWT:

```js
if (user.mustChangePassword) {
  return res.json({
    passwordExpired: true,
    reason: 'first_login',
    userId, schoolId,
    hint: 'Your administrator has set a temporary password. Please choose your own password to continue.'
  });
}
```

The frontend (`js/app.js` and `client/src/pages/Login.jsx`) catches `passwordExpired: true` and renders the inline change-password form before granting access to the dashboard.

---

## 24. Academic Configuration API (v4.6+)

**Route file**: `server/routes/academic-config.js`  
**Prefix**: `/api/academic-config`  
**Plan gate**: `grades`  
**RBAC**: `settings:read` (GET), `settings:update` (PUT), `settings:delete` (reset)

School-level configuration that governs how grades are calculated, displayed, and ranked. Exports helpers consumed by the report-cards and exams routes.

### Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/` | Fetch saved config merged with system defaults (no null fields ever returned) |
| PUT | `/` | Save config — validates band overlap + weight sum |
| POST | `/reset` | Delete saved config, revert to system defaults |
| GET | `/grade?score=N` | Resolve a score to a grade band (useful for live previews) |

### Grading Schema

An array of up to 20 grade bands:

```js
{
  grade:      'A',          // display label (max 5 chars)
  minScore:   80,
  maxScore:   100,
  points:     4.0,          // GPA points
  descriptor: 'Excellent',  // short label
  remarks:    'Outstanding performance'
}
```

**Validations**:
- `minScore` ≤ `maxScore` per band
- No two bands may overlap (sorted by `minScore`, each `minScore` must exceed previous `maxScore`)
- Bands need not cover 0–100 (gaps are valid; out-of-range scores return `grade: null`)

### Assessment Weights

```js
[
  { assessmentType: 'classwork', label: 'Classwork / CAT', weight: 20 },
  { assessmentType: 'midterm',   label: 'Mid-Term Exam',   weight: 30 },
  { assessmentType: 'final',     label: 'End-Term Exam',   weight: 50 },
]
```

**Validation**: weights must sum to 100 (±0.01 tolerance).  
Valid `assessmentType` values: `classwork | homework | project | test | midterm | final | coursework | oral | practical | other`

### Ranking Subject Strategy

Controls which subjects count toward a student's ranking score:

| Strategy | Behaviour | Use case |
|---|---|---|
| `all` | All subjects averaged (default) | Standard schools |
| `best_n` | Best N subjects by final score | KCSE Kenya (best 7 of 8) |
| `compulsory_only` | Only subjects in `compulsorySubjects[]` | Fixed-curriculum schools |

```js
// academic-config PUT body example (KCSE setup)
{
  rankingSubjectStrategy: 'best_n',
  rankingN: 7,
}
```

The `computeRankingScore()` utility in `server/utils/ranking.js` applies the strategy. Each published snapshot stores `rankingScore` (the score actually used for ranking) and `rankingSubjectsUsed[]` (which subjects were selected).

### Exported Helpers

```js
const { resolveGrade, DEFAULT_GRADING_SCHEMA, mergeConfig } = require('./routes/academic-config');

// Resolve a score to a grade band
resolveGrade(74, gradingSchema);
// → { grade: 'B', points: 3.0, descriptor: 'Good', remarks: 'Good performance' }

// Merge saved config with defaults (never returns null fields)
mergeConfig(savedDoc);  // savedDoc can be null
```

### Default Configuration

```js
// Grading: A (80-100, 4.0) → E (0-39, 0.0), 8 bands
// Weights: Classwork 20% / Midterm 30% / Final 50%
// Ranking: enabled, standard method, scope: class+stream+overall
// Report: tabular template, attendance + GPA + rank + deviation shown
// passMark: 40
// rankingSubjectStrategy: 'all'
// absentCountsAsZero: false
// subjectAssignmentEnforced: false
```

---

## 25. Academic Reporting Engine (v4.6+)

### Overview

The reporting engine aggregates grades and exam results through configured assessment weights, resolves grade bands, computes rankings, and generates immutable versioned snapshots with PDF output.

**Key files**:
- `server/routes/report-cards.js` — all report card endpoints
- `server/utils/ranking.js` — ranking calculation utilities
- `server/routes/academic-config.js` — config + `resolveGrade()` helper

### Data Flow (v4.36.0 — unified pipeline)

```
assessment_marks (isPublished:true)   grades collection (isPublished:true)   exam_results
  aggregateAssessmentMarks()            aggregateGrades()                     aggregateExamResults()
  rawScore is already 0–100 pct        score/maxScore → pct                  score/maxScore → pct
  avg across instances per type        avg within type                        avg within type
       ↓                                      ↓                                      ↓
       └────────────── _mergeGradeData() ─────┘                                      │
                  (CA marks win on per-type conflict)                                 │
                           ↓                                                          │
               computeFinalScores(mergedGrades, examData, ...)                ←───────┘
               × activeWeights   ← assessment_config.customTypes  (preferred)
                                    academic_config.assessmentWeights (fallback)
               × activeSchema    ← grade_boundaries default scale  (preferred)
                                    academic_config.gradingSchema   (fallback)
               → normalised finalScore per subject (0–100)
                           ↓
               resolveGrade(finalScore, activeSchema)
               → { grade, points, descriptor, remarks }
               ← accepts BOTH { minScore, maxScore } AND { min } band formats
                           ↓
               computeRankingScore(subjects, strategy, n)
               → rankingScore (filtered by strategy)
                           ↓
               rankStudents(classInput, method)
               → { rank, outOf } per student
                           ↓
               report_card_snapshots (immutable versioned record)
               — stores termNumber, activeWeights, activeSchema
```

#### Priority rule (weights + grade schema)

| Setting | Primary (preferred) | Fallback |
|---------|---------------------|---------|
| Assessment weights | `assessment_config.customTypes` — the school's configured CA types | `academic_config.assessmentWeights` — legacy weight config |
| Grading schema | `grade_boundaries` default scale (`.bands[]`) | `academic_config.gradingSchema` |

Both formats are normalised by `resolveGrade()` — no conversion step required.

#### `resolveGrade()` dual-format support (v4.36.0)

| Field | `academic_config` format | `grade_boundaries` format |
|-------|--------------------------|---------------------------|
| Min threshold | `minScore` | `min` |
| Max threshold | `maxScore` (range check) | _(absent — threshold check only)_ |
| Description | `descriptor` / `remarks` | `label` |

When `maxScore` is absent, the algorithm finds the highest band whose `min` ≤ score (standard threshold lookup). When `maxScore` is present, an inclusive range check is used.

#### Portal queries (v4.36.0)

Both `student-portal.js` and `parent-portal.js` now query `report_card_snapshots` (not `report_cards`) and filter `superseded: { $ne: true }`. Sorted by `publishedAt` (the snapshot's write timestamp).

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/report-cards/generate` | grades:read | Live preview — not persisted |
| POST | `/api/report-cards/publish` | grades:create + admin | Batch snapshot with versioning |
| GET | `/api/report-cards` | grades:read | List current snapshots |
| GET | `/api/report-cards/publish-batches` | grades:read | Audit trail of publish runs |
| GET | `/api/report-cards/:id` | grades:read | Full snapshot detail |
| PUT | `/api/report-cards/:id/comments` | grades:update | Save teacher/principal comments |
| GET | `/api/report-cards/:id/pdf` | grades:read | Single-student A4 PDF |
| GET | `/api/report-cards/bulk-pdf` | grades:read | Class-wide merged PDF |

### Report Card Snapshot Schema

```js
{
  id, version, supersedesId, superseded, supersededAt, supersededBy,
  schoolId, studentId, studentName, admissionNo,
  classId, className, termId, termName, academicYearId, academicYear,
  schoolName, batchId,

  // Config at publish time (immutable — config changes never corrupt old records)
  gradingSchema, assessmentWeights, passMark, gradingType,
  rankingSubjectStrategy, rankingN,

  // Results
  subjects: {
    [subjectId]: {
      finalScore, grade, points, descriptor, remarks,
      breakdown: { classwork: 72, midterm: 68, final: 74 }
    }
  },
  totalScore, averageScore, gpa, subjectCount,
  rankingScore,          // score used for ranking (per strategy)
  rankingSubjectsUsed,   // which subjects were selected by strategy

  rankings: { class: { rank, outOf } },
  subjectBest: { [subjectId]: true/false },   // is this student top in subject?

  comments: {
    subjectComments: { [subjectId]: 'text' },
    classTeacherRemark, classTeacherCommentBy, classTeacherCommentAt,
    principalRemark, principalRemarkBy, principalRemarkAt,
  },

  attendanceSummary: { daysPresent, daysAbsent, totalSchoolDays, percentage },
  financialBlock,        // if true, PDF download blocked (admin bypass: ?force=1)
  status,                // 'published'
  publishedAt, publishedBy, updatedAt, updatedBy,
}
```

### Publish Batch Record (`publish_batches`)

Created before any publish work begins. Updated on completion or failure.

```js
{
  id,           // batchId embedded in every snapshot
  schoolId, classId, termId, academicYearId,
  status,       // 'running' | 'completed' | 'failed'
  startedBy, startedAt, completedAt,
  studentCount, successCount, failedStudents,
  failureReason,              // set on failure
  unmoderatedExams,           // set when moderation guard fires
  newVersions: [{ snapshotId, studentId, version }]
}
```

**Recovery**: if a publish run is stuck in `running` after the server restarts, query `publish_batches` by `status: running` and investigate. The interrupted snapshots will be the ones pointing to that `batchId`.

### Moderation Guard

Before publishing, the engine checks that all exams for the class/term are in an approved state:

```
approved | locked | published | archived  → OK
scheduled | in_progress | completed | moderated  → BLOCKED
```

Response when blocked:
```json
{
  "error": "2 exam(s) for this class/term are not yet approved:\n  • \"End of Term Maths\" (completed)\n  • \"English Essay\" (moderated)",
  "unmoderatedExams": [...]
}
```

Override: `POST /publish` with `{ skipModerationCheck: true }` — logged in the batch record.

### Versioning

Every call to `/publish` for the same `classId + termId + academicYearId`:
1. Finds existing non-superseded snapshots
2. Creates new snapshots with `version = existing.version + 1`
3. Marks old snapshots `superseded: true`
4. Carries forward comments from the previous version

To access old versions: `GET /api/report-cards?history=1&classId=&termId=`

### PDF Generation

Uses **PDFKit** (no Puppeteer, no headless browser) — runs synchronously, ~50ms per card.

**DRAFT watermark**: any snapshot where `status !== 'published'` OR `superseded === true` gets a diagonal watermark at 6% opacity — "DRAFT" or "SUPERSEDED".

**PDF footer** contains: generation timestamp, version number, batchId.

**Bulk PDF** (`GET /bulk-pdf?classId=`): processes students in chunks of 10, each chunk fetching its attendance data independently. Financial-block students are excluded unless admin passes `?force=1`.

### Exam State Machine (exams.js)

```
scheduled → in_progress → completed → moderated → approved → locked → published → archived
         ↘                          ↘
          cancelled                  cancelled
```

Role requirements per target state:
- `in_progress / completed`: teacher, admin, superadmin
- `cancelled / moderated / approved / locked / published / archived`: admin, superadmin only

### Mark States (exam_results)

| State | Meaning | Counts in average? | Blocks approval? |
|---|---|---|---|
| `present` | Valid score entered | ✅ Yes | No |
| `ABS` | Student was absent | ❌ No (unless `absentCountsAsZero`) | No |
| `MIS` | Mark not entered yet | ❌ No | Warning |
| `EXM` | Exempted from averaging | ❌ No | No |
| `INC` | Incomplete — needs resolution | ❌ No | Warning |

**Backward compat**: `absent: true` in result payloads maps to `ABS`; `absent: false` maps to `present`. The `absent` boolean is stored alongside `markState` for clients that have not yet migrated.

### Audit Trail (`mark_audit_log`)

Every score change writes an immutable document:

```js
{
  action,           // 'RESULT_UPDATED' | 'GRADE_UPDATED' | 'EXAM_UNLOCKED'
  examId,           // for exam results
  gradeId,          // for gradebook entries
  studentId, subjectId, schoolId,
  editedBy,         // userId of person who made the change
  actingAs,         // teacherId if admin is entering on behalf of teacher
  previousValue, previousState,
  newValue,    newState,
  reason,           // from notes field or explicit reason param
  timestamp,
}
```

Exam unlock (`POST /:id/unlock`) requires a mandatory `reason` field — written to both `statusHistory` on the exam and `mark_audit_log`.

### Ranking Utility (`server/utils/ranking.js`)

```js
const { rankStudents, mergeRankings, bestPerSubject, computeRankingScore } = require('./utils/ranking');

// Rank an array of students
rankStudents([{ studentId: 'A', totalScore: 82 }, { studentId: 'B', totalScore: 82 }, { studentId: 'C', totalScore: 79 }], 'standard');
// → [{ studentId: 'A', rank: 1, outOf: 3 }, { studentId: 'B', rank: 1, outOf: 3 }, { studentId: 'C', rank: 3, outOf: 3 }]

// Dense method: same tie, next rank is 2 not 3
rankStudents([...], 'dense');
// → rank 1, 1, 2

// Apply ranking strategy (KCSE best 7)
computeRankingScore(student.subjects, 'best_n', 7, []);
// → { rankingScore: 74.3, subjectsUsed: ['math', 'eng', 'bio', 'chem', 'geo', 'hist', 'phy'] }
```

### Financial Block

`financialBlock: true` on a snapshot prevents PDF download. Set this field via a finance integration or manually via MongoDB. Admin can bypass: `GET /:id/pdf?force=1`.

### Planned Extensions (next sprint)
- **Cumulative transcript** — cross-term GPA, graduation export, signed PDF
- **Concurrent edit protection** — optimistic locking (`version` field) on exam result writes
- **Comment templates** — configurable auto-generated remarks by grade band
- **Notification retry** — DB-backed retry queue for email delivery failures

---

## 26. Production Hardening — Phase 3 (v4.6.1+)

### 26.1 Archival Write-Blocking

When an academic year is archived via `POST /api/academic-config/archive-year`, the server:

1. Runs the existing cascade (freeze exams, lock snapshots, mark grades `yearArchived: true`)
2. **Also** writes `$addToSet: { archivedAcademicYears: academicYearId }` to the school's `academic_config` document

This creates a permanent, indexed gate that other write routes check cheaply:

```js
async function _isYearArchived(schoolId, academicYearId) {
  if (!academicYearId) return false;
  const cfg = await _model('academic_config')
    .findOne({ schoolId }, { archivedAcademicYears: 1 }).lean();
  return Array.isArray(cfg?.archivedAcademicYears)
    && cfg.archivedAcademicYears.includes(academicYearId);
}
```

**Enforced on:**
| Route | Check |
|---|---|
| `POST /api/grades` | rejects if `data.academicYearId` is archived |
| `POST /api/grades/bulk` | rejects if any distinct `academicYearId` in payload is archived |
| `POST /api/exams/:id/results` | rejects if `exam.academicYearId` is archived |
| `POST /api/assessment/marks` | rejects if `d.academicYearId` is archived (v4.30.0) |
| `POST /api/assessment/marks/bulk` | rejects if any `academicYearId` in payload is archived (v4.30.0) |

All return `HTTP 403` with a human-readable message. This is additive to the existing `yearArchived` flag on individual documents — the config check is the server-enforced gate; the document flag is for query-time filtering.

**Known gaps (not protected):**
- `attendance_records` — records carry no `academicYearId` field; attendance is date-scoped only
- Lessons — reference year by string label not by ID; architectural mismatch prevents a cheap guard

---

### 26.2 MongoDB Session Transactions on Publish

`POST /api/report-cards/publish` wraps the two critical bulkWrites (insert snapshots + supersede old ones) in a session transaction:

```js
const session = await mongoose.startSession();
try {
  await session.withTransaction(async () => {
    await Snaps.bulkWrite(insertOps,    { ordered: false, session });
    await Snaps.bulkWrite(supersedeOps, { ordered: false, session });
  });
} catch (txErr) {
  if (txErr.code === 20 || txErr.message?.includes('Transaction')) {
    // Standalone MongoDB (dev/test) — fall back silently
    console.warn('[REPORT-CARDS] Transactions not available — falling back');
    await Snaps.bulkWrite(insertOps,    { ordered: false });
    await Snaps.bulkWrite(supersedeOps, { ordered: false });
  } else {
    throw txErr;
  }
} finally {
  if (session) await session.endSession().catch(() => {});
}
```

**Why this matters**: without a transaction, if the server crashes between inserting new snapshots and marking old ones superseded, both versions appear as non-superseded. With a transaction on a replica set, the two operations are atomic — either both commit or both roll back.

**Fallback**: error code 20 (`IllegalOperation`) is MongoDB's signal that the deployment is a standalone (not replica set). The server falls back to non-transactional writes automatically — no `.env` flag, no startup configuration required.

---

### 26.3 Guardian Ownership Enforcement

Users with role `parent` or `guardian` must be explicitly linked to student IDs via `guardianOf: [studentId]` stored in their JWT payload (set at login time from the users collection).

**Enforced on:**
- `GET /api/report-cards/:id` — returns `HTTP 403` if the snapshot's `studentId` is not in `req.jwtUser.guardianOf`
- `GET /api/report-cards/:id/pdf` — same check

**Implementation in auth middleware**: the `guardianOf` field must be included in the JWT payload when issuing tokens to parent/guardian users. The auth middleware makes it available on `req.jwtUser.guardianOf`.

**Schema on users collection** (add this field):
```js
{
  role:       'parent',        // or 'guardian'
  schoolId:   '...',
  guardianOf: ['stu-uuid-1', 'stu-uuid-2'],  // linked student IDs
}
```

The `guardianOf` array is empty `[]` by default — a parent with an empty array cannot access any report card, which is the safe-fail direction.

---

### 26.4 Runtime Type Validation in computeFinalScores

`server/utils/academic-calc.js → computeFinalScores()` performs input validation before touching any data:

| Check | Action |
|---|---|
| `assessmentWeights` is null / not array / empty | throws `TypeError` |
| `gradingSchema` is null / not array / empty | throws `TypeError` |
| A weight's `.weight` is non-numeric | throws `TypeError` with field name |
| A schema band's `minScore`/`maxScore` is non-numeric | throws `TypeError` with grade name |
| `gradesData` or `examData` is null / array | silently coerced to `{}` |
| An individual type average is `NaN` | skipped with `console.warn`, rest computed normally |

This ensures that a misconfigured `academic_config` document (e.g. a weight accidentally stored as a string) surfaces as a clear error at the call site rather than a silent `NaN` propagating into published report cards.

---

### 26.5 Test Suite

#### Setup
```bash
npm test              # run all tests once (CI-friendly, force-exits)
npm run test:watch    # interactive watch mode during development
```

#### Test files (all in `server/__tests__/`)

| File | Tests | What it covers |
|---|---|---|
| `academic-calc.test.js` | 42 | `computeFinalScores`, `attachDeviations` |
| `ranking.test.js` | 14 | `rankStudents`, `computeRankingScore`, `mergeRankings`, `bestPerSubject` |
| `resolve-grade.test.js` | 7 | `resolveGrade` boundary table + custom schema |
| **Total** | **63** | |

#### Mocking strategy

`_model()` is mocked in all test files so tests never need a MongoDB connection. The mock returns a minimal object with `find`, `findOne`, `countDocuments` stubs that resolve to empty arrays/null. `resolveGrade` is re-implemented inline in the `academic-calc.test.js` mock using the same band-matching logic.

This means:
- Tests run in ~6s on a laptop with no external dependencies
- CI pipelines need no MongoDB service container for the unit test stage
- Integration tests (with real MongoDB) can be added separately under `server/__tests__/integration/`

#### Key test scenarios

**`computeFinalScores`:**
- Full 3-component weighted score: `(80×20 + 70×30 + 90×50) / 100 = 82` → grade A
- Partial weight normalisation: only `final` present → normalised to its raw score
- KCSE-style: `best_n=7` out of 8 subjects, correct subject excluded
- Grade boundary table via `test.each`: score 100→A, 80→A, 79→B+, 40→D, 39→E, 0→E
- NaN score skipped, remaining types still compute correctly

**`rankStudents`:**
- Standard: 1,2,2,4 (competition ranking with gap)
- Dense: 1,2,2,3 (no gap)
- Two consecutive tied groups: 1,1,3,3,5 (standard)
- All tied: all rank 1

**`computeRankingScore`:**
- `'all'`: averages all 5 subjects
- `'best_n'` n=3: top 3 selected, others dropped
- KCSE best-7-of-8: lowest subject excluded, average of remaining 7
- `'compulsory_only'` with empty list: falls back to `'all'`

---

## 27. Cross-Cutting Issue Fixes (v4.6.2+)

### 27.1 Shared Archival Utility — `server/utils/archival.js`

Single source of truth for year-archival checks. Import this in any route that guards writes:

```js
const { isYearArchived, firstArchivedYear } = require('../utils/archival');

// Single write guard
if (await isYearArchived(schoolId, data.academicYearId)) {
  return E.badRequest(res, `Year "${data.academicYearId}" is archived.`);
}

// Bulk write guard — checks all distinct year IDs, returns first archived one
const blockedYear = await firstArchivedYear(schoolId, data.grades.map(g => g.academicYearId));
if (blockedYear) return E.badRequest(res, `Year "${blockedYear}" is archived.`);
```

**Never duplicate this logic inline.** The function handles null inputs, missing config documents, missing array fields, and deduplication internally.

---

### 27.2 JWT Guardian Link — `_buildTokenPayload` in `auth.js`

All JWT issuance flows (`/login`, `/verify-otp`, `/force-change`) use a single `_buildTokenPayload(user, schoolId)` function. The payload schema is:

```js
{
  userId:    string,
  schoolId:  string,
  email:     string,
  role:      string,
  roles:     string[],
  guardianOf?: string[]   // present ONLY for role: 'parent' | 'guardian'
}
```

**Populating `guardianOf` on user records**: when creating or updating a parent/guardian user, store `guardianOf: [studentId, ...]` on their user document. The array is read at login time and embedded in the JWT. Token refresh (re-login) is required for changes to take effect.

**Data migration for existing parent/guardian users** (run once):
```js
db.collection('users').updateMany(
  { role: { $in: ['parent', 'guardian'] } },
  { $set: { guardianOf: [] } }
);
```

---

### 27.3 Archive-Year Cascade Sequence

The `POST /archive-year` endpoint now runs in three explicit phases:

1. **Step A** (best-effort): resolve human-readable `academicYearLabel` from `academic_years` collection
2. **Step B** (parallel): the three data cascade ops — freeze exams, lock snapshots, mark grades archived
3. **Step C** (sequential, after B): write `$addToSet: { archivedAcademicYears }` to `academic_config`

The gate (Step C) is **always written after the data** (Step B). If Step C fails, `writeBlockActive: false` and `writeBlockError` appear in both the HTTP response and the audit log entry.

**Audit log entry** (`ACADEMIC_YEAR_ARCHIVED`) includes: `academicYearLabel`, `writeBlockActive`, `writeBlockError`, and cascade counts.

---

### 27.3b Academic Year CRUD API (v4.30.0)

The `academic_years` collection is now managed through a full CRUD + transition API under `/api/academic-config/years`. The old free-text `school.academicYear` label is a legacy field kept in sync by `transition-year` for backward compatibility only.

**Status derivation** (never stored — always computed):
```js
function _yearStatus(year, archivedIds = []) {
  if (archivedIds.includes(year.id || year._id.toString())) return 'locked';
  if (year.isCurrent) return 'active';
  return 'draft';
}
```

**Endpoints:**
| Method + Path | Auth | What it does |
|---|---|---|
| `GET /api/academic-config/years` | admin/deputy | List all years enriched with `status` |
| `POST /api/academic-config/years` | admin | Create draft year (`name`, `startDate`, `endDate`, `terms[]`) |
| `PUT /api/academic-config/years/:id` | admin | Update name/dates/terms — 403 on locked years |
| `DELETE /api/academic-config/years/:id` | admin | Delete draft years only |
| `POST /api/academic-config/transition-year` | admin | Atomic archive current + activate target |

**Transition-year atomicity model**: the route performs Step B (data cascade) then Step C (write-blocking gate) then Step D (activate new year) sequentially, not in a DB transaction. If the server crashes mid-way, the audit log records the partial state and the operator can manually complete the transition via the `/archive-year` or direct DB update. This is the same model as the original `/archive-year` endpoint.

**Startup migration** (`_migrateAcademicYears` in `server/index.js`):
- Assigns `uuidv4` `id` to any `academic_years` doc missing it
- Sets `isCurrent: false` on docs missing the field
- Non-blocking, idempotent — runs after `listen()` on every startup

### 27.4 Audit Action Types Reference (complete)

| Action | Written by | What it records |
|---|---|---|
| `RESULT_UPDATED` | `exams.js` | Score change on an exam result |
| `GRADE_UPDATED` | `grades.js` | Score change on a gradebook entry |
| `EXAM_UNLOCKED` | `exams.js` | Admin unlock with mandatory reason |
| `MODERATION_BYPASS` | `report-cards.js` | Bypass of moderation guard on publish |
| `ACADEMIC_YEAR_ARCHIVED` | `academic-config.js` | Year-end close with cascade counts + gate status |
| `ACADEMIC_YEAR_ACTIVATED` | `academic-config.js` | New year set as active via `transition-year` |
| `WRITE_BLOCKED_ARCHIVED_YEAR` | `grades.js`, `exams.js` | Rejected write attempt to a closed year |
| `GUARDIAN_ACCESS_DENIED` | `report-cards.js` | Parent/guardian 403 on report card or PDF |

All entries include `schoolId`, `timestamp`, and the acting user ID.

---

### 27.5 Test Suite Summary (v4.6.2 cumulative — 93 tests)

| File | Tests | What it covers |
|---|---|---|
| `academic-calc.test.js` | 42 | `computeFinalScores`, `attachDeviations` |
| `ranking.test.js` | 14 | `rankStudents`, `computeRankingScore`, `mergeRankings`, `bestPerSubject` |
| `resolve-grade.test.js` | 7 | `resolveGrade` boundary table + custom schema |
| `archival.test.js` | 18 | `isYearArchived`, `firstArchivedYear` |
| `auth-token.test.js` | 12 | `_buildTokenPayload` — all role combinations |
| **Total** | **93** | |

---

## 28. Platform Rebrand & Dedicated School URLs (v4.7.0)

### 28.1 Domain & Branding

Platform renamed from **InnoLearn** to **Msingi**, domain **msingi.io**.

- `client/src/utils/schoolDetect.js` — `MAIN_HOSTS` set updated to include `msingi.io`, `www.msingi.io`, `app.msingi.io`
- `client/src/pages/Landing.jsx` — Marketing homepage (shown when `isSchool === false`)
- `client/src/pages/Login.jsx` — Branded login with school logo/colours from public API

### 28.2 School Detection (`schoolDetect.js`)

```js
// Priority chain:
detectSchool()
// 1. Subdomain:  greenwood.msingi.io  → slug = "greenwood"
// 2. ?school=X query param            → slug = X   (dev/testing — also used to reproduce
//                                        school-context bugs on the main domain, e.g. the
//                                        favicon-leak repro in §36)
// 3. localStorage ms_school_slug      → slug = stored (returning-user shortcut; skipped
//                                        entirely on MAIN_HOSTS so it can never hijack
//                                        the landing page)
// 4. No match                         → { slug: null, isSchool: false }

schoolPortalUrl('greenwood')
// On localhost:  http://localhost:3005/?school=greenwood
// On production: https://greenwood.msingi.io
```

Every API request in `client.js` automatically sends `X-School-Slug: <slug>` via the `_req()` helper. The tenant middleware resolves school context from this header.

### 28.3 Public API (`/api/public`)

No-auth endpoints for branding the login page before authentication:

```
GET /api/public/school-info?slug=greenwood
→ { slug, name, shortName, logoUrl, primaryColor, accentColor, website, isActive, status }

GET /api/public/ping
→ { ok: true }
```

Mounted before `authMiddleware` in `index.js`.

### 28.4 School Profile PATCH

```
PATCH /api/academic-config/school-profile
Body: { name, shortName, systemEmail, logoUrl, primaryColor, accentColor, phone, address, timezone, currency }
→ Updates school document; validates systemEmail format
```

Admin/superadmin only. Returns the updated profile fields plus `slug`, `plan`, `addOns`.

### 28.5 Per-School Email Identity

All email functions accept `schoolName` and `schoolEmail`:

```js
// School-level emails (2FA, welcome, notifications):
From:     "Greenwood Academy via Msingi" <innolearnnetwork@gmail.com>
Reply-To: school.systemEmail  (falls back to PLATFORM_EMAIL)

// Platform-level emails (registration, approval):
From:     "Msingi Platform" <innolearnnetwork@gmail.com>
```

Single Gmail SMTP account. `Reply-To` lets schools receive replies at their own address.

### 28.6 DNS Configuration (Cloudflare + Render)

For wildcard school subdomains on Render:

**Cloudflare DNS** (all DNS only — grey cloud, NOT proxied):
```
A     @                   → 216.24.57.1
CNAME www                 → school-management-ecosystem.onrender.com
CNAME *                   → school-management-ecosystem.onrender.com
CNAME _acme-challenge     → <value from Render>
CNAME _cf-custom-hostname → <value from Render>
```

**Render Custom Domains:** Add `msingi.io`, `www.msingi.io`, `*.msingi.io` (triggers wildcard SSL via Cloudflare for SaaS).

**Environment variable:** `APP_URL=https://msingi.io`

---

## 29. Assessment & Grading System (v4.7.0)

### 29.1 Architecture

```
server/utils/grade-calc.js     ← Calculation engine (single source of truth)
server/routes/assessment.js    ← REST API  (/api/assessment/*)
client/src/pages/grades/       ← Frontend (GradesPage.jsx)
client/src/api/client.js       ← assessment module (12 methods)
```

Collections:
```
assessment_config    — per school/year: weights, template, instances
assessment_schedule  — date ranges per assessment per term
assessment_marks     — individual mark entries (the new system)
notifications        — in-app reminder notifications
```

### 29.2 Calculation Engine (`grade-calc.js`)

All formulas live here. Never duplicate in routes or frontend.

```js
validateWeights({ CA:20, HW:10, MT:30, ET:40 })
// → { valid: true, total: 100 }

aggregateMarks(marks)
// → { typeAvgs: { CA: 75, HW: 80 }, breakdown: { CA: [{instance:1, rawScore:72}, ...] } }

computeTermTotal(typeAvgs, weights)
// → weighted total; normalises to present types if some are missing

computeHalfTermTotal(typeAvgs, weights)
// → CA+HW+MT only, re-scaled so they sum to 100%

computeTerm1Grade(typeAvgs, weights)
// → { termTotal, finalGrade }  (finalGrade = termTotal for T1)

computeTerm2Grade(term2TypeAvgs, weights, et1Score)
// → { termTotal, etRunningAvg: avg(ET1,ET2), finalGrade: (termTotal+etRunningAvg)/2 }

computeTerm3Grade(term3TypeAvgs, weights, et1Score, et2Score)
// → { termTotal, etRunningAvg: avg(ET1,ET2,ET3), finalGrade: (termTotal+etRunningAvg)/2 }

computeSummaryAverage(t1Total, t2Total, t3Total)
// → (T1+T2+T3)/3  — Template B equal-thirds average

buildSubjectReport({ marks, weights })
// → { terms: { 1: {...}, 2: {...}, 3: {...} }, summaryAverage }
```

### 29.3 API Endpoints

| Method | Endpoint | Auth | Purpose |
|--------|---------|------|---------|
| GET | `/api/assessment/config` | settings:read | Get weights, template, instances, default grade scale |
| PATCH | `/api/assessment/config` | settings:update | Update config (validates sum=100%) |
| GET | `/api/assessment/types` | settings:read | List custom assessment types |
| POST | `/api/assessment/types` | settings:update | Add a type |
| PUT | `/api/assessment/types` | settings:update | Bulk-replace all types |
| DELETE | `/api/assessment/types/:key` | settings:update | Delete a type (409 if marks exist) |
| GET | `/api/assessment/grade-scales` | settings:read | List grading scales |
| POST | `/api/assessment/grade-scales` | settings:update | Create a grading scale |
| PUT | `/api/assessment/grade-scales/:id` | settings:update | Update name/bands/isDefault |
| DELETE | `/api/assessment/grade-scales/:id` | settings:update | Delete (cannot delete default or last) |
| GET | `/api/assessment/schedule` | settings:read | List date ranges |
| PUT | `/api/assessment/schedule` | settings:update | Upsert a schedule entry |
| DELETE | `/api/assessment/schedule/:id` | settings:update | Remove schedule entry |
| GET | `/api/assessment/marks` | grades:read | List marks with filters |
| POST | `/api/assessment/marks` | grades:create | Enter/upsert single mark |
| POST | `/api/assessment/marks/bulk` | grades:create | Bulk upsert (whole class) |
| DELETE | `/api/assessment/marks/:id` | grades:delete | Remove a mark |
| GET | `/api/assessment/marks/summary` | grades:read | Class completion grid |
| GET | `/api/assessment/report` | grades:read | Computed report card + grade scale |
| GET | `/api/assessment/reminders` | grades:read | Upcoming/open/overdue list |
| POST | `/api/assessment/reminders/notify` | settings:update | Trigger email + in-app notifications |

### 29.3a Grade Boundaries (`grade_boundaries` collection)

Each document is one named grading scale for a school:
```js
{
  id:          uuid,
  schoolId:    'sch_...',
  name:        'Standard KCSE',
  description: 'Kenya Certificate of Secondary Education grading',
  isDefault:   true,          // school-wide default; exactly one per school (or per section)
  sectionId:   null,          // null = school-wide; set to sectionId for section-specific scale
  bands: [
    { min: 80, grade: 'A',  points: 12, label: 'Excellent' },
    { min: 70, grade: 'B+', points: 10, label: 'Good' },
    // ...
    { min:  0, grade: 'E',  points:  1, label: 'Fail' },  // must have a min=0 band
  ],
  createdBy, updatedBy, createdAt, updatedAt,
}
```

**Rules:**
- `min=0` band is required — ensures every score resolves to a grade.
- Grade letters must be unique within a scale; mins must be unique.
- Exactly one scale per scope (school-wide, or per sectionId) can have `isDefault: true`.
- Cannot delete the default scale; cannot delete the last scale.
- `GET /api/assessment/report` and `GET /api/assessment/config` both include `config.gradeScale` (name + bands) so the frontend can display grade letters without an extra round-trip.
- **Frontend fallback**: `DEFAULT_GRADE_SCALE` in `grades/constants.js` is used when no school scale is configured.

### 29.4 Mark Entry Rules

- All marks entered as `rawScore: 0–100` — always out of 100 regardless of weight
- Multiple instances (CA1, CA2) → averaged → weight applied
- MT and ET: teachers blocked by default; admin enables via `config.teacherExamEntry: true`
- Upsert key: `{ schoolId, studentId, subjectId, termNumber, assessmentType, instance, academicYearId }`

### 29.5 Report Card Structure (Template A)

```js
// Per student, per subject
{
  terms: {
    1: {
      typeAvgs:      { CA: 75, HW: 82, MT: 70, ET: 68 },
      breakdown:     { CA: [{instance:1, rawScore:72}, {instance:2, rawScore:78}], ... },
      halfTermTotal: 73.5,   // CA+HW+MT re-scaled to 100%
      termTotal:     71.2,   // weighted: CA×20+HW×10+MT×30+ET×40
      etScore:       68,
      etRunningAvg:  68,     // T1: just ET1
      finalGrade:    71.2,   // T1: same as termTotal
    },
    2: {
      ...
      etRef:        { ET1: 68 },          // reference columns (read-only)
      etRunningAvg: 70.5,                 // avg(ET1=68, ET2=73)
      finalGrade:   71.85,                // (termTotal + etRunningAvg) / 2
    },
    3: {
      ...
      etRef:        { ET1: 68, ET2: 73 },
      etRunningAvg: 71.67,                // avg(ET1, ET2, ET3)
      finalGrade:   72.1,
    }
  },
  summaryAverage: 71.5,  // Template B: (T1+T2+T3 totals) / 3
}
```

### 29.6 Frontend — Module Routing (v4.35.0)

The assessment system is split across **two separate pages** at `/grades` and `/exams`:

**`/grades` — Continuous Assessment (`GradesPage.jsx`)**

| Tab | Roles | Key Features |
|-----|-------|-------------|
| ✏️ Mark Entry | teacher, admin | Class grid, score inputs, bulk save, live stats |
| 📊 Report Cards | all | Template A/B toggle, half-term toggle, colour-coded scores, grade letter column |
| ⚙️ Configuration | admin only | Assessment types CRUD, grading scales CRUD, template selector, schedule |
| 🔔 Reminders | teacher, admin | Overdue/open/upcoming cards, notify teachers button |

**`/exams` — Formal Exam Management (`ExamsPage.jsx`, v4.33.0+)**

| Tab | Roles | Key Features |
|-----|-------|-------------|
| 📄 Exams | teacher, admin | FK-connected subject/year/term, exam lifecycle (scheduled→published→archived) |
| 📋 Results | teacher, admin | Per-exam result entry with mark states (ABS, MIS, EXM, INC) |
| 📊 Grade Report | all | Cross-exam grade analysis |
| ⚙️ Configuration | admin only | Assessment weights, exam type configuration |

### 29.7 Assessment Reminders Flow

1. Admin creates schedule entries (`PUT /api/assessment/schedule`) with `dateFrom`/`dateTo`
2. `GET /api/assessment/reminders?days=14` returns assessments in window, sorted: overdue → open → upcoming
3. `POST /api/assessment/reminders/notify` (admin trigger):
   - Loads all teachers for the school
   - Creates `notifications` document per teacher per assessment (in-app)
   - Calls `email.sendAssessmentReminder()` per teacher (email)
4. Teachers see reminder cards in the Reminders tab; in-app notifications surfaced in TopBar

---

## 30. Public Marketing Pages (v4.9.5+)

### 30.1 Overview

Three public-facing React pages are served without authentication. They are accessible on the main domain (`msingi.io`) and handle marketing, contact, and plan comparison.

| Page | Route | File |
|------|-------|------|
| Landing | `/` | `client/src/pages/Landing.jsx` |
| Contact | `/contact` | `client/src/pages/Contact.jsx` |
| Plans | `/plans` | `client/src/pages/Plans.jsx` |

### 30.2 Fixed Navbar Pattern

All three public pages use `position: fixed` navbars, not `position: sticky`.

**Why**: `overflow-x-hidden` on the root layout element breaks `position: sticky` in Chrome and Safari. Using `fixed` is the reliable cross-browser solution.

**Implementation pattern**:
```jsx
{/* Navbar */}
<nav className="fixed top-0 left-0 right-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-zinc-100/80">
  {/* ... nav content ... */}
</nav>
{/* Spacer — compensates for fixed position removing element from flow */}
<div className="h-16" />
```

### 30.3 WhatsApp FAB

A permanent circular WhatsApp floating action button appears on Landing and Contact at all scroll positions.

```jsx
{/* Fixed at bottom-right, never disappears */}
<a
  href="https://wa.me/254700000000"
  className="w-12 h-12 rounded-full bg-[#25D366] shadow-lg flex items-center justify-center text-white"
  target="_blank" rel="noopener noreferrer"
>
  {/* Phone SVG icon */}
</a>
```

Contact page adds a scroll-to-top button stacked above the WhatsApp FAB in a `flex flex-col gap-3` container.

### 30.4 Social Icons

Social links are loaded from the Platform Settings API and rendered in all public page footers.

```jsx
// Fetch on mount
useEffect(() => {
  getPlatformSettings().then(s => setSocialLinks(s.socialLinks || {}));
}, []);

// Render — filters to only configured links
const SOCIAL_ICONS = [
  { key: 'x',        Icon: XIcon,         label: 'X' },
  { key: 'linkedin', Icon: LinkedInIcon,   label: 'LinkedIn' },
  { key: 'facebook', Icon: FacebookIcon,   label: 'Facebook' },
  { key: 'instagram',Icon: InstagramIcon,  label: 'Instagram' },
  { key: 'youtube',  Icon: YouTubeIcon,    label: 'YouTube' },
];
function SocialLinks({ links }) {
  return SOCIAL_ICONS
    .filter(({ key }) => links[key])
    .map(({ key, Icon, label }) => (
      <a key={key} href={links[key]} target="_blank" rel="noopener noreferrer">
        <Icon className="w-5 h-5" />
      </a>
    ));
}
```

All icon components are inline SVGs (no external icon library dependency on public pages).

### 30.5 Plans Page — Feature Comparison Table

`Plans.jsx` mirrors the `FEATURE_PLAN` map from `server/middleware/plan.js`. When adding a new plan-gated feature, update **both** files.

Feature availability per plan uses Set membership:
```js
const all  = new Set(['core','standard','premium','enterprise']);
const std  = new Set(['standard','premium','enterprise']);
const prem = new Set(['premium','enterprise']);
const ent  = new Set(['enterprise']);
```

CTA buttons call `navigate('/contact?plan=<planKey>')`. The Contact page reads `?plan=` via `useSearchParams` and pre-fills the inquiry type and message body.

---

## 31. Demo School System (v4.9.7+)

### 31.1 Architecture

The demo school (`slug: 'demo'`, `schoolId: 'sch_demo'`) is provisioned automatically on every server start by `server/scripts/seed-demo.js`, called non-blocking from `server/index.js` after the HTTP server is listening.

```
server start
  └── connect() [MongoDB]
  └── ensureIndexes()
  └── app.listen()
        └── repairPermissions()    [fire-and-forget]
        └── seedDemo()             [fire-and-forget]
              └── upsert school (plan: enterprise, always via $set)
              └── invalidatePlanCache('sch_demo')
              └── upsert 6 demo users
              └── upsert academic year
              └── upsert sections
              └── upsert role permissions
              └── seedDemoData()   [realistic content]
```

### 31.2 Plan Enforcement

The demo school **must always be on the enterprise plan**. This is enforced by:

1. Using `$set` (not `$setOnInsert`) for the `plan` field in the school upsert — overrides any pre-existing value
2. Calling `invalidatePlanCache(schoolId)` immediately after to clear the 5-minute TTL cache

```js
await School.updateOne({ slug: 'demo' }, {
  $set: { plan: 'enterprise', ... },
  $setOnInsert: { createdAt: now },
}, { upsert: true });
try {
  const { invalidatePlanCache } = require('../middleware/plan');
  invalidatePlanCache('sch_demo');
} catch { /* plan middleware not loaded yet — harmless */ }
```

### 31.3 Demo Users

| Email | Role | Badge |
|-------|------|-------|
| `admin@demo.msingi.io` | `admin` | Full access |
| `principal@demo.msingi.io` | `deputy_principal` | Academic lead |
| `teacher@demo.msingi.io` | `teacher` | Classroom |
| `finance@demo.msingi.io` | `finance` | Finance |
| `parent@demo.msingi.io` | `parent` | Guardian view |
| `student@demo.msingi.io` | `student` | Student view |

All passwords: `Demo2025!`. All users have `isActive: true`, `mustChangePassword: false`.

### 31.4 Quick Login Panel (`client/src/pages/Login.jsx`)

When `slug === 'demo'`, the login page renders a `DemoPanel` below the standard form. Clicking any role card calls `handleQuickLogin(email, password)` which fills the credential state and auto-submits the form.

The panel only renders for the demo slug — never on any real school's login page.

### 31.5 Seed Data Isolation Rule

`server/scripts/seed-demo-data.js` is the ONLY file that seeds bulk demo content. It must:

1. **Never** use a dynamic `schoolId` — always hardcode `const SCHOOL_ID = 'sch_demo'`
2. **Always** use the `upsert()` helper with `$setOnInsert` — never `$set` for data fields
3. **Never** be called from any path other than `seedDemo()`

```js
// Correct pattern — never overwrites existing demo data
function upsert(Model, id, data) {
  return Model.updateOne(
    { id },
    { $setOnInsert: { id, schoolId: SCHOOL_ID, ...data } },
    { upsert: true }
  );
}
```

### 31.6 Demo Data Inventory

| Collection | Count | Notes |
|------------|-------|-------|
| `classes` | 7 | Grade 1–4 (Primary), Form 1–3 (Secondary) |
| `subjects` | 14 | CBC and secondary subjects |
| `teachers` | 9 extra | Realistic Kenyan names, profiles |
| `students` | 20 | Full profiles, guardian contacts, class assignments |
| `behaviour_incidents` | 25 | Mix of minor/moderate/serious, open/resolved/closed |
| `timetable_slots` | 60 | Full weekly grid, Mon–Fri, 8 periods |
| `invoices` | 20 | Tuition/activity/transport, mix of statuses |
| `payments` | 14 | Linked to invoices |
| `admissions` | 8 | Spread across all pipeline stages |
| `elearning_sessions` | 0 | Created live by teachers; not seeded |

---

## 32. Developer Workflow — Check Docs First (v4.9.9+)

A Claude Code slash command `.claude/commands/check-docs.md` enforces the following mandatory protocol before any implementation:

1. **Read `CHANGELOG.md`** — confirm what version introduced the feature you are touching; never rebuild what already exists
2. **Read `docs/DEVELOPER_GUIDE.md`** — understand existing architecture, collection names, API routes
3. **Read relevant user docs** — `USER_GUIDE.md`, `SCHOOL_ADMIN_GUIDE.md`, `PLATFORM_ADMIN_GUIDE.md` as appropriate
4. **Declare status** — "feature exists / does not exist / partially exists" before writing code
5. **Implement with zero regression** — tenant isolation, plan gating, no collection renames without migration
6. **Update all docs** after every change

Invoke with `/check-docs` in Claude Code before starting any feature work.

---

## 33. Staff Self-Edit Profile API (v4.29.0+)

Staff members can edit selected fields on their own teacher record without going through HR. Only authenticated users with a matching teacher record (matched by email) can use these endpoints — no RBAC gate, no plan gate.

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/teachers/me` | Returns the caller's teacher record (sensitive fields stripped) |
| `PUT` | `/api/teachers/me` | Updates allowed fields on the caller's teacher record |

### Route placement

Both `/me` routes **must be declared before `/:id`** in `server/routes/teachers.js`. Express matches routes in declaration order — if `/:id` appears first, Express treats the literal string `"me"` as a dynamic ID parameter and the `/me` routes are never reached.

### Self-editable fields

```js
const SELF_EDITABLE = [
  'phone', 'address', 'qualifications',
  'specialization', 'dateOfBirth', 'nextOfKin'
];
```

Any field not in this allowlist is silently ignored on PUT. HR-controlled fields (`nationalId`, `nssfNo`, `shaNo`, `kraPinNo`, `contractType`, `employmentStatus`, `departmentId`, `salary`) are never returned by `GET /me` (stripped via `_stripSensitive()`).

### Record matching

Staff records in the `teachers` collection are matched to users in the `users` collection by the `email` field. There is no explicit `userId` foreign key on teacher records. If no teacher record exists for the caller's email, `GET /me` returns `{ success: true, data: null }` — the frontend hides the staff details card in this case (admin-only users, students, parents).

### API client

```js
profile.staffRecord()             // GET /teachers/me
profile.updateStaffRecord(data)   // PUT /teachers/me
```

---

## 34. Admin Password Reset API (v4.29.0+)

Admins can assign a new temporary password to any user in their school. The user is forced to change it on next login via `mustChangePwd: true`.

### Endpoint

```
POST /api/settings/users/:id/reset-password
```

**Auth**: `authMiddleware` + `_isAdmin()` check  
**Scope**: `schoolId` tenant isolation — cannot reset users from other schools  
**RBAC guard**: non-superadmin cannot reset `admin` or `superadmin` passwords

### Request

No body required — the temp password is generated server-side.

### Response

```json
{
  "success": true,
  "data": {
    "tempPassword": "Kp7mN3vR!",
    "name": "Alice Mwangi",
    "email": "alice@school.edu",
    "emailSent": true
  }
}
```

`emailSent: false` is returned (not an error) when the email transport fails — the caller shows a warning and the temp password is still in the response for manual sharing.

### Password generation

Uses `_genTempPassword()` from `settings.js`:
- 8 random alpha characters (ambiguous chars `I`, `l`, `O`, `0` excluded)
- 2 random digits (1–9, 0 excluded)
- One `!` suffix
- Fisher-Yates shuffle with `crypto.randomInt` — fully CSPRNG, no `Math.random()`

### UI flow

The `ResetPasswordModal` component in `SettingsPage.jsx` (`UsersTab`) has two states:

1. **Confirmation** — names the target user, explains the temp-password flow, warns to keep the dialog open; Cancel + Set Password buttons
2. **Result** — shows the temp password in large monospace with a copy button; email delivery status badge (green / amber); "password will not be shown again" note; Done button closes

The backdrop click is disabled once the result is shown, preventing accidental dismissal before the password is copied.

### API client

```js
settingsApi.users.resetPassword(id)   // POST /settings/users/:id/reset-password
```

---

## 35. Security — CSPRNG Enforcement (v4.29.0+)

**Rule:** `Math.random()` is banned from all production server code. Use `crypto.randomInt()` or `crypto.randomBytes()` exclusively.

### Why

`Math.random()` is not a cryptographically secure random number generator (CSPRNG). Values it produces are predictable with sufficient observations, making it unsuitable for:
- Temporary passwords (guessable → account takeover)
- Document/entity IDs (guessable → BOLA/IDOR attacks)
- OTPs and tokens (guessable → auth bypass)

### Standard patterns

```js
// Unique ID (e.g. for new documents)
const id = Date.now().toString(36) + crypto.randomBytes(4).toString('hex');

// Random integer in range [0, max)
const idx = crypto.randomInt(max);

// Random integer in range [min, max)
const day = crypto.randomInt(1, 31);

// Fisher-Yates shuffle (for password character randomisation)
for (let i = arr.length - 1; i > 0; i--) {
  const j = crypto.randomInt(i + 1);
  [arr[i], arr[j]] = [arr[j], arr[i]];
}
```

### Enforcement

All `server/routes/*.js` files and `server/scripts/*.js` files are clean as of v4.29.0. If adding a new file or helper, always `const crypto = require('crypto')` and use the patterns above. PRs containing `Math.random()` in server code should be rejected at review.

---

## 36. eLearning Module — PMI Sessions + Emergency Online Mode (v4.31.0)

### Architecture overview

The eLearning module uses **zero external API calls**. Teachers store their personal meeting links (Zoom PMI URL, Zoom passcode, Google Meet URL) directly on their `teachers` collection document. When a session is scheduled the system copies those links into the session record — it never calls Zoom or Google APIs.

### Collections

| Collection | Purpose |
|---|---|
| `elearning_sessions` | One document per scheduled session. Fields: `schoolId`, `teacherId`, `title`, `scheduledAt`, `durationMin`, `platform` (`zoom`/`meet`), `meetingLink`, `meetingPasscode`, `audience` (`{ type, id, label }`), `status` (`scheduled`/`cancelled`), `calendarEventId`, `agenda`, `createdAt`. |
| `events` | Dual-written on session create/cancel. `category: 'online_class'`, `meetingLink`, `meetingPasscode`, `platform`, `sessionId` cross-reference. |

### Session lifecycle

```
POST /api/elearning/sessions
  → validate input
  → find user → find teacher record by email
  → resolve meetingLink from teacher.zoomPMILink || teacher.meetLink
  → if no link: return { missingLink: true, error }
  → create elearning_sessions document
  → create events document (category: 'online_class', meetingLink, sessionId)
  → return { session, event }

DELETE /api/elearning/sessions/:id
  → verify ownership (schoolId match)
  → set session.status = 'cancelled'
  → delete linked events document (by session._id stored in calendarEventId)
```

### Plan gating

`server/middleware/plan.js` — `FEATURE_PLAN` entry:
```js
elearning: 'standard',   // online meetings, emergency mode, PMI-based sessions
```

### Teacher self-edit fields

`server/routes/teachers.js` — `SELF_EDITABLE` array includes:
```js
'zoomPMILink', 'zoomPasscode', 'meetLink',
```
Teachers can update these via `PUT /api/teachers/me` without admin approval.

### Emergency Online Learning Mode

Stored on `schools.emergencyOnlineMode` (boolean). When `true`:

**Staff timetable** (`TimetablePage.jsx`):
1. Reads `school.emergencyOnlineMode` from Zustand + localStorage (`_slimSchool`).
2. Fetches all active teachers (`GET /api/teachers?limit=200&status=active`) — enabled only when mode is ON.
3. Builds `teacherMap = { [teacherId]: teacherDoc }`.
4. Passes `emergencyMode={true}` and `teacherMap` to `TimetableGrid`.
5. `SlotCard` renders a "Join Zoom/Meet" button using `teacherMap[slot.teacherId].zoomPMILink || meetLink`.

**Student portal** (`GET /api/student-portal/dashboard`):
1. Selects `emergencyOnlineMode` from school document.
2. Selects `teacherId` from timetable slots.
3. When `emergencyMode`:
   - Collects unique `teacherIds` from today's slots.
   - Queries `teachers.find({ id: { $in: teacherIds } }).select('id zoomPMILink zoomPasscode meetLink')`.
   - Enriches each slot: `meetingLink = teacher.zoomPMILink || teacher.meetLink`, `platform = 'zoom'/'meet'`.
4. Returns `timetableToday` (enriched) and `school.emergencyOnlineMode` in response payload.
5. `StudentDashboard.jsx` renders a sky-blue banner + Join button per lesson.

### Frontend file map

| File | Role |
|---|---|
| `client/src/pages/elearning/ELearningPage.jsx` | `NewScheduleModal` + `OnlineSessionsTab` + dispatcher |
| `client/src/pages/profile/ProfilePage.jsx` | "Online Meeting Links" self-edit card |
| `client/src/pages/timetable/TimetablePage.jsx` | Emergency banner, teacherMap fetch, props to grid |
| `client/src/pages/timetable/components/TimetableGrid.jsx` | `SlotCard` Join button |
| `client/src/pages/student-portal/StudentDashboard.jsx` | Emergency banner + per-lesson Join button |
| `client/src/pages/events/EventsPage.jsx` | `online_class` category, Join button in event modal |
| `client/src/pages/settings/SettingsPage.jsx` | Emergency mode toggle, `patchSchool()` on save |
| `client/src/store/auth.js` | `_slimSchool()` persists `emergencyOnlineMode` |

---

## 36. Public Site SEO & SSG (v4.42.0+, activated in production v4.63.0)

### Overview

The Msingi public site is a React SPA served by Vite. Because AI bots (GPTBot, PerplexityBot, ClaudeBot) and many SEO crawlers do not execute JavaScript, a static pre-render step is run after every production build.

**Important history:** this pipeline was built in v4.42.0 but was never actually wired into the production deploy until v4.63.0 (2026-07-07). Until then, `render.yaml` ran the plain `npm run build` (no pre-render), and even when the pre-render script *was* run manually, `server/index.js`'s SPA wildcard route had no logic to serve the pre-rendered files it produced — it always served the root `dist/index.html` for every path. Both gaps are closed now; see §36 "Serving pre-rendered pages" below. If you are debugging "crawler sees nothing" again in the future, verify both halves — the file existing in `dist/` is necessary but not sufficient.

### Public routes

All 24 public marketing routes are pre-rendered (list lives in two places that must stay in sync: `client/scripts/prerender.mjs`'s `ROUTES` array, and `client/public/sitemap.xml`):

`/`, `/why`, `/about`, `/platform`, `/pricing`, `/security`, `/difference`, `/why-choose`, `/roadmap`, `/implementation`, `/solutions/principal`, `/solutions/teacher`, `/solutions/finance`, `/solutions/parent`, `/solutions/admissions`, `/plans`, `/faq`, `/contact`, `/privacy`, `/terms`, `/legal/dpa`, `/legal/sla`, `/legal/accessibility`, `/legal/responsible-ai`, `/knowledge`.

All other routes are authenticated app routes — blocked in `client/public/robots.txt`.

### Per-page metadata

`react-helmet-async` is used for per-page SEO. `HelmetProvider` wraps the app in `client/src/main.jsx`. Each public page contains a `<Helmet>` block with:
- `<title>` and `<meta name="description">`
- `<link rel="canonical">`
- Open Graph (`og:*`) and Twitter Card (`twitter:*`) tags
- One or more `<script type="application/ld+json">` blocks

### JSON-LD schemas

| Page | Schema type |
|---|---|
| Landing | `SoftwareApplication` + `Organization` |
| FAQ | `FAQPage` (one `Question`/`Answer` per FAQ item) |
| Plans | `SoftwareApplication` + `PriceSpecification` |
| Contact | `Organization` with `contactPoint` |

### SSG pre-render

**Script:** `client/scripts/prerender.mjs`  
**Command:** `npm run build:ssg` (runs `vite build` then the prerender script)

The script:
1. Starts a local HTTP server on port 4174 serving `dist/` with SPA fallback.
2. Launches headless Chromium via Puppeteer (`--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu` — required to launch in a root/CI container like Render's build image).
3. Intercepts all `/api/` requests and returns `{}` (app falls back to `CMS_DEFAULTS`).
4. Waits 900 ms per route for Framer Motion animations to settle.
5. Writes rendered HTML to `dist/index.html`, `dist/why/index.html`, `dist/solutions/principal/index.html`, etc. — nested routes get a nested directory with their own `index.html`.

### Serving pre-rendered pages (v4.63.0)

This app is **not** a static site — it's a Node/Express service (`render.yaml`: `env: node`, `startCommand: node server/index.js`). There is no CDN rewrite-rule layer. Two things must both be true for a route to actually serve pre-rendered HTML in production:

1. **`render.yaml` `buildCommand`** must run `npm run build:ssg`, not plain `build` — otherwise `dist/<route>/index.html` never gets created at all.
2. **`server/index.js`'s SPA wildcard route** (`app.get('*', ...)`) must check for a pre-rendered file before falling back to the shell:
   ```js
   const candidate = path.normalize(path.join(REACT_DIST, req.path, 'index.html'));
   if (candidate.startsWith(REACT_DIST) && fs.existsSync(candidate)) {
     return res.sendFile(candidate);
   }
   return res.sendFile(path.join(REACT_DIST, 'index.html')); // SPA shell fallback
   ```
   `express.static(REACT_DIST, { index: false })` does **not** auto-serve directory index files (that's what `index: false` disables), so without this explicit check the wildcard route always wins and always serves the root shell — this was the actual production bug even after the buildCommand fix, and both had to land together.
   The `path.normalize` + `startsWith(REACT_DIST)` guard is required — `req.path` is attacker-controlled input, and without it a crafted path could attempt to escape `REACT_DIST` via `..` segments.

Authenticated app routes (e.g. `/students`) have no pre-rendered file on disk, so `fs.existsSync` is `false` and they fall through to the normal SPA shell exactly as before — this change is additive, not a behavior change for the app itself.

### Widget components — two, not one (do not conflate)

There are **two** separate floating-widget components with overlapping purpose but different scope. This is a known duplication (a `check-docs`-flagged shadow-implementation smell), not yet consolidated:

| Component | Mounted | Scope | Auth/school-aware? |
|---|---|---|---|
| `client/src/components/landing/FloatingActions.jsx` | Imported directly into Landing.jsx, FAQ.jsx, Contact.jsx, Plans.jsx, PrivacyPolicy.jsx, TermsOfService.jsx | Only renders on those specific public pages | No — always visible where imported |
| `client/src/components/FloatingWidgets.jsx` | Once, globally, in `client/src/main.jsx` alongside `<RouterProvider>` | Renders on **every** route in the app, including school subdomains and dashboards, unless explicitly guarded | **Yes (v4.63.0)** — imports `detectSchool()`; hides when `isSchool` is true unless `slug === 'demo'`; also hides when `isAuthenticated` |

`FloatingWidgets.jsx` is the one that leaked onto real schools' `/login` pages before v4.63.0 (a real school's login page is pre-authentication, so an auth-only check never caught it). If you add a third marketing surface in the future, gate it the same way `FloatingWidgets` does, not the way `FloatingActions` does.

### Favicon reset (v4.63.0)

`AppShell.jsx` mutates the single shared `<link rel="icon">` DOM node to the active school's `faviconUrl` on mount. Because this is a global singleton element and SPA route changes don't reload the page, the mutation now has an unmount cleanup that restores `/favicon.svg` and the default title `Msingi` — without it, a school's favicon persisted in the browser tab even after navigating back to the landing page or into a different school (reproducible via `?school=demo`, the dev/testing path documented in `schoolDetect.js` §28.2).

**Known gap:** `/favicon.svg` is referenced in `client/index.html` and by this reset logic, but the file does not exist anywhere in the repo — it 404s. Not fixed as part of v4.63.0; needs an actual SVG added at `client/public/favicon.svg`.

### Crawler discovery

- `client/public/robots.txt` — allow/disallow rules + sitemap pointer
- `client/public/sitemap.xml` — 24 URLs (hand-maintained, no generation script), `lastmod` dates, `changefreq`, `priority`. Live at `https://msingi.io/sitemap.xml`. Updating a page's content should also bump its `<lastmod>` by hand — Google uses that date to prioritize re-crawling; resubmitting the same sitemap without changing `<lastmod>` does not force a faster re-crawl. For urgent single-page updates, use Search Console's "Request Indexing" instead of waiting on the sitemap cycle.

Both files are copied to `dist/` by Vite's public directory handling and require no additional build step.
