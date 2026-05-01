# InnoLearn — Developer Guide

**Version 3.2** · Technical Reference & Architecture

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
├── index.html                  # App entry point — all scripts loaded here
├── onboard.html                # 4-step school self-registration wizard
├── platform.html               # Platform admin SPA (key-protected)
├── server.js                   # Entry point → delegates to server/index.js
├── render.yaml                 # Render.com deployment config
├── CHANGELOG.md                # Version history
├── .env                        # Local secrets (never committed)
├── .env.example                # Safe template for .env
├── .gitignore
│
├── css/
│   ├── styles.css              # Main design system (app shell + all component styles)
│   ├── onboard.css             # Onboarding wizard styles
│   └── platform.css            # Platform admin dashboard styles
│
├── js/
│   ├── data.js                 # Seed data + DB bootstrap (loads on first run)
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
│   │   └── tenant.js           # Resolves schoolId from slug / subdomain / JWT
│   ├── routes/
│   │   ├── auth.js             # POST /api/auth/login, /me, /change-password
│   │   ├── onboard.js          # POST /api/onboard — school self-registration
│   │   ├── platform.js         # GET/POST /api/platform/* — platform admin API
│   │   ├── collections.js      # Generic CRUD for all 25+ collections
│   │   └── sync.js             # GET /api/sync — bulk data download
│   └── utils/
│       ├── jwt.js              # sign() / verify() helpers
│       ├── model.js            # Shared Mongoose model factory (_model)
│       ├── email.js            # Transactional email utility (nodemailer/Gmail)
│       └── seedSchool.js       # One-off seed script for Atlas demo school
│
└── docs/
    ├── USER_GUIDE.md           # End-user documentation
    ├── DEVELOPER_GUIDE.md      # This file
    ├── PLATFORM_ADMIN_GUIDE.md # Platform owner operations guide
    └── SCHOOL_ADMIN_GUIDE.md   # School Super Admin setup guide
```

**Script load order in `index.html`** (matters — each module depends on `DB` and `Auth`):
```
chart.js → data.js → auth.js → [all feature modules] → app.js
```
`app.js` is always last — it calls `App.init()` on `DOMContentLoaded`.

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
superadmin          Full system access
admin               All modules, no system config
deputy_principal    Behaviour, Students, HR (view)
discipline_committee Behaviour, Students (view)
section_head        Own section: students, attendance, behaviour, academics
teacher             Own classes: attendance, marks, behaviour, communication
finance             Finance (full), Students/Reports (read)
parent              Own children only
student             Own record only
```

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
DB.get(collection)                    // → array of all records
DB.getById(collection, id)            // → single record or null
DB.query(collection, predicateFn)     // → filtered array
DB.insert(collection, object)         // → inserted object (id auto-generated if missing)
DB.update(collection, id, partial)    // → updated object (shallow merge)
DB.remove(collection, id)             // → void
DB.set(collection, array)             // → replaces entire collection (used in seed)
```

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

| Limitation | Impact | Workaround |
|---|---|---|
| localStorage only (~5MB) | Large schools with many incidents may approach the limit | Periodically archive old terms' data; use MongoDB sync |
| Single browser tab | Two tabs can have conflicting localStorage writes | One active tab per session |
| No real file uploads | Document attachments in admissions are simulated | Link to external document storage (Google Drive etc.) |
| No real-time sync | Multi-user simulation is role-switching within one session | Production: WebSocket or polling for live multi-user |
| SEED_VERSION wipe | Bumping resets ALL localStorage data | Export critical data before bumping; server-side data is unaffected |
| Data isolation (new schools) | New schools currently share InnoLearn demo data from localStorage seed | Approve + login with the school's own JWT to scope data via server sync |

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

Nodemailer transport configured for Gmail SMTP using an App Password (not the account password):

```js
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com', port: 587, secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});
```

### Environment Variables Required

| Variable | Description |
|---|---|
| `SMTP_USER` | Gmail address (`innolearnnetwork@gmail.com`) |
| `SMTP_PASS` | Gmail App Password (16-char, spaces OK) |
| `PLATFORM_EMAIL` | Recipient for platform owner alerts (defaults to `SMTP_USER`) |

### Exported Functions

| Function | When sent | Recipients |
|---|---|---|
| `sendRegistrationPending(opts)` | On school registration | School admin |
| `sendAdminNewSchoolAlert(opts)` | On school registration | Platform owner |
| `sendApprovalWelcome(opts)` | On approval | School admin |
| `sendRejectionEmail(opts)` | On rejection | School admin |
| `sendAdminApprovalAlert(opts)` | On approval | Platform owner |

All functions return `true`/`false` (never throw). Email failures are logged but do not break the API response.

### HTML Template

All emails use a shared `_wrap(body)` function that injects content into a responsive branded wrapper: InnoLearn gradient header, content body, footer with platform URL. Status badges (`.badge.pending`, `.badge.approved`, `.badge.rejected`) are inline-styled for email client compatibility.

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
