# Msingi Platform Engineering Standards

**Version:** 1.0  
**Status:** Active  
**Last updated:** 2026-07-01  
**Owner:** Platform Team  

This document turns architectural principles into day-to-day development practices. It answers the questions a new engineer should never have to ask twice: how things are named, how changes are made, what constitutes a breaking change, and how quality is maintained.

Read the [Platform Operating Model](./PLATFORM_OPERATING_MODEL.md) first. This document assumes familiarity with the subsystem structure, principles, and change governance defined there.

---

## 1. Naming conventions

### 1.1 MongoDB collections
- Lowercase, underscored plural nouns
- Prefixed by domain when the name would otherwise be ambiguous
- **Good:** `students`, `finance_invoices`, `report_card_snapshots`, `release_certificates`
- **Bad:** `StudentRecord`, `invoices` (ambiguous — finance or proforma?), `reportCards`

| Domain | Prefix | Example collections |
|--------|--------|-------------------|
| Finance | `finance_` | `finance_invoices`, `finance_payments` |
| Report Cards | `report_card_` | `report_card_snapshots`, `report_card_counters` |
| Operations | `release_` | `release_certificates` |
| Audit | `audit_` | `audit_logs` |
| Growth Profile | `growth_` | `growth_records`, `growth_projects` |
| (core) | none | `students`, `teachers`, `classes`, `schools`, `users` |

### 1.2 API routes
- Kebab-case, noun-first, plural resource names
- **Good:** `/api/report-cards`, `/api/growth-projects`, `/api/exam-series`
- **Bad:** `/api/getReportCard`, `/api/reportcard`, `/api/Report-Cards`

Sub-resources use the parent path: `/api/report-cards/:id/pdf`, `/api/students/:id/attendance`

Platform-only routes live under `/api/ops/*` or `/api/platform/*`. They are never under a school-facing prefix.

### 1.3 Server route files
- Kebab-case: `report-cards.js`, `growth-projects.js`, `exam-series.js`
- One resource family per file
- File name matches the primary API prefix: `report-cards.js` → `/api/report-cards`

### 1.4 React pages and components
- PascalCase for components and page files: `ReportCardsTab.jsx`, `StudentList.jsx`
- Pages live in `client/src/pages/<domain>/`
- Platform-only pages live in `client/src/pages/ops/`
- Shared components live in `client/src/components/`

### 1.5 Service and utility files
- Camelcase: `academicCalc.js`, `monitoring.js`
- Located in `server/utils/` (stateless helpers) or `server/services/` (stateful, DB-aware)
- Operations Engine lives at `server/services/ops/`

### 1.6 Scripts (ops / CI)
- Kebab-case: `release-cert.js`, `release-gate.js`, `verify-rbac-coverage.js`
- Prefixed with underscore for internal/shared modules: `_rbac-scan.js`, `_risk-classify.js`
- All scripts are self-contained: they output a clear result and exit with code 0 (pass) or 1 (fail)

### 1.7 Environment variables
- Screaming snake case: `MONGO_URI`, `JWT_SECRET`, `SMTP_HOST`, `SENTRY_DSN`
- Boolean flags: `CI=true`, `NODE_ENV=production`
- Optional integrations: commented out in `.env.example`, gracefully no-op if absent

---

## 2. MongoDB collection standards

### 2.1 Every document must have
- `schoolId` (string) — unless it is a platform-level document (e.g., `schools`, `release_certificates`)
- `id` (string, UUID v4) — the stable external identifier used by APIs and cross-collection references
- `_id` (ObjectId) — internal MongoDB ID; never exposed in API responses

### 2.2 Field naming
- Camelcase: `studentId`, `admissionNumber`, `publishedAt`, `createdBy`
- Timestamps: `createdAt` (ISO string or Date), `updatedAt`
- Boolean flags: positive phrasing where possible — `isPublished`, `isArchived`, not `notDeleted`
- References: `studentId` (not `student_id`, not `studentID`)

### 2.3 Indexes — always in `server/utils/indexes.js`
- Never create indexes ad-hoc in route files or startup scripts
- Every new collection must have an entry in `INDEXES` before shipping
- Include a comment explaining the primary query pattern
- All indexes created with `background: true`
- Unique indexes on `id` field for every primary collection
- Sparse indexes on optional unique fields (e.g., `reportId`)

### 2.4 Soft deletes
- Primary records (students, teachers, users) use `isArchived: true` — never hard delete
- Transactional records (invoices, payments, attendance) are never deleted under any circumstance
- Platform records (release certs, audit logs) are append-only

---

## 3. API standards

### 3.1 Response envelope
All API responses use the standard envelope:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "Student not found" } }
```
Paginated list responses:
```json
{ "success": true, "data": [...], "pagination": { "page": 1, "limit": 20, "total": 147, "pages": 8 } }
```

Never return raw arrays or raw objects at the top level.

### 3.2 HTTP status codes
| Situation | Code |
|-----------|------|
| Success (read/update) | 200 |
| Created | 201 |
| Bad input / validation failure | 400 |
| Not authenticated | 401 |
| Authenticated but not authorised | 403 |
| Not found | 404 |
| Server error | 500 |

### 3.3 Route order in Express files
Express matches routes top to bottom. Specific routes always appear before parameterised ones:
```javascript
router.get('/verify/:reportId', ...)  // specific — must be before /:id
router.get('/bulk-pdf', ...)           // specific
router.get('/:id', ...)               // catch-all parameter — always last
```

### 3.4 Authentication and authorisation on every route
Every route that is not intentionally public must have, in order:
1. `authMiddleware` — validates JWT, sets `req.jwtUser`
2. `planGate('module')` — checks school plan tier (if module is plan-gated)
3. `rbac('resource', 'action')` — checks permission, OR use an inline role check annotated with `// rbac:`

If a route is intentionally public (no auth), add a comment: `// public: no auth — school branding lookup`.

### 3.5 Input validation
- Use Zod schemas for all POST/PUT/PATCH body validation
- Define schemas at the top of the route file, not inline
- Always call `schema.safeParse()` and return 400 on failure — never `schema.parse()` in route handlers

### 3.6 What qualifies as a breaking change
A breaking change to an API is any change that would cause existing clients (school UI, parent portal, student portal, any integration) to silently misbehave or error:

| Breaking | Not breaking |
|----------|-------------|
| Removing a field from a response | Adding a new optional field |
| Renaming a field | Adding a new endpoint |
| Changing a field's type | Making a required field optional |
| Removing an endpoint | Adding optional query params |
| Changing error codes | Changing error messages |
| Changing authentication requirements | Tightening validation (with warning period) |

Breaking changes require a Major change process (ADR + staging validation before production).

---

## 4. Migrations

### 4.1 What a migration is
Any code that modifies existing documents in a live collection. This includes: adding a field, changing a field value, filling previously-null fields, and rebuilding indexes.

### 4.2 Migration rules
1. **Migrations run at server startup** — in `server/index.js`, after DB connection, before routes are served
2. **Migrations are idempotent** — running them twice produces the same result as running once
3. **Migrations use a cursor** — never load a full collection into memory: `Model.find({...}).cursor()`
4. **Migrations are additive** — they add or fill fields; they do not remove or rename existing fields without a deprecation period
5. **Migrations are named** — each has a log prefix: `[Migration] reportId: backfilled for N snapshot(s)`
6. **Migrations check before acting** — use `{ $exists: false }` or `{ $eq: null }` filters; skip documents that already satisfy the new state

### 4.3 Migration function naming
```javascript
async function _migrateReportIds() { ... }   // verb + subject
async function _migrateSectionHeadId() { ... }
```

### 4.4 Pre-deployment verification
Before deploying a migration:
- Record collection count: `db.collection.countDocuments({})`
- Deploy
- Verify: count should be unchanged, affected documents should now have the new field

---

## 5. Integrity rules

### 5.1 Where they live
`server/services/ops/integrity/rules.js` — a single array. No other file.

### 5.2 Rule structure
```javascript
{
  id:          'module.check_name',     // e.g. 'finance.invoices_missing_school_id'
  module:      'finance',               // pack owner — matches a known module name
  label:       'Human-readable label',
  severity:    'critical',              // critical | warn | info
  minVersion:  '4.28.0',               // null if always applicable
  async run() {
    // Read-only DB queries only. Never write.
    // Return: { count: number, samples: string[] }
    // count = 0 means clean. samples = up to 10 example IDs for diagnosis.
  },
}
```

### 5.3 Rule constraints
- Rules are **read-only** — they must never write to the database
- Rules must **complete within 10 seconds** — use `.limit()` and `.distinct()` to avoid full scans
- Rules must handle errors gracefully — throw and let the engine catch; do not swallow errors silently
- Rules must be **version-gated** (`minVersion`) if they check a field introduced in a specific release

### 5.4 Adding a rule for a new module
1. Add one rule object to `rules.js`
2. Test it manually: `node -e "require('./server/services/ops/integrity/rules').find(r => r.id === 'your.rule').run().then(console.log)"`
3. No other file changes required

---

## 6. Tests

### 6.1 Where they live
`server/__tests__/` — unit and integration tests only.  
`server/__tests__/routes/` — route-level integration tests using `supertest`.

### 6.2 What must be tested
| Type | When required |
|------|--------------|
| Unit test | All pure utility functions (calc, ranking, hashing) |
| Route integration test | All new routes added to critical-tier modules (auth, students, finance, report-cards, exams) |
| Integrity rule test | Not required (rules are queries; verified by running against staging DB) |

### 6.3 What must not be tested
- MongoDB is always mocked (`jest.mock('../utils/model')`) — tests never require a running database
- Middleware is always mocked — authMiddleware, rbac, planGate — tests exercise route logic, not middleware
- Third-party services (SMTP, S3, M-Pesa) are always mocked

### 6.4 Test file conventions
```javascript
// Top of every test file:
jest.mock('../middleware/auth', ...)   // always first
jest.mock('../middleware/rbac', ...)
jest.mock('../middleware/plan', ...)
jest.mock('../utils/model', ...)       // per-collection mocks

// Describe blocks match the route or function being tested:
describe('GET /report-cards/verify/:reportId', () => {
  test('returns 404 when reportId not found', ...)
  test('returns verified=true for untampered snapshot', ...)
  test('does not require Authorization header', ...)
})
```

### 6.5 Coverage
- Coverage is tracked via `jest --coverage`
- Minimum coverage is enforced by the RBAC gate, not jest's `--coverageThreshold` (by design — RBAC gate is more meaningful than line coverage alone)
- Adding coverage to `jest.collectCoverageFrom` in `package.json` when a new critical-tier route is created

---

## 7. Release process

### 7.1 Every release answers three questions
1. **What changed?** — captured in `release-cert.js` (git diff, impacted modules)
2. **What existing functionality could this affect?** — impact matrix in `release-gate.js` (Tier 1/2/3 classification)
3. **How do we know nothing broke?** — CI test run + RBAC gate + security scan

### 7.2 Release pipeline
```
Developer pushes to main
  ↓
CI: npm test                     (all unit + integration tests)
CI: security-scan.js             (dangerous pattern check)
CI: verify-rbac-coverage.js      (RBAC non-regression gate)
CI: release-cert.js              (generate + upload artifact)
  ↓
Manual: npm run platform:release-gate   (pre-deploy readiness report)
Manual: smoke checklist on staging      (see §7.3)
  ↓
Production deploy
  ↓
Manual: npm run platform:release-cert   (persist cert to DB)
```

### 7.3 Smoke checklist (run against staging before every production deploy)
```
□  Can log in as admin, teacher, parent, and student?
□  Dashboard loads for each role with no console errors?
□  Students list opens and search returns results?
□  Attendance can be submitted for today?
□  Finance invoice can be created and receipted?
□  Exam marks can be entered and saved?
□  Report card PDF downloads with correct student data?
□  Parent portal shows attendance and results?
□  Student portal shows dashboard?
□  Logout clears session and redirects to login?
```

If any item fails → do not deploy → rollback plan below.

### 7.4 Rollback
```bash
git revert HEAD && git push    # creates a revert commit, does not force-push
```
Database migrations are idempotent and additive — they do not need rollback. If a migration produced corrupt data, fix it with a corrective migration, not by reverting DB state.

---

## 8. Security standards

### 8.1 What is never committed to git
- `.env` files of any kind
- JWT secrets, API keys, database URIs
- Private keys or certificates
- Seed passwords

### 8.2 What is always validated
- All user-supplied input at the route boundary — use Zod schemas
- File uploads — validate MIME type and size before processing
- External webhook payloads — validate signature before trusting content (e.g., M-Pesa callback)

### 8.3 What is never trusted
- `req.body.schoolId` from a client — always use `req.jwtUser.schoolId`
- `req.body.role` from a client — always use `req.jwtUser.role`
- `req.params.id` without verifying the document's `schoolId` matches the authenticated school

### 8.4 SQL/NoSQL injection prevention
- All Mongoose queries use object syntax — never string interpolation
- `$where`, `eval`, and `mapReduce` are never used
- User input used in regex must be escaped before use

---

## 9. Frontend standards

### 9.1 Data fetching
- All server data goes through `@tanstack/react-query` — no raw `fetch()` or `axios` in components
- API functions live in `client/src/api/client.js` — never inline in components
- `staleTime` defaults: list queries 2 minutes, detail queries 5 minutes, platform-ops queries 60 seconds

### 9.2 Authentication in components
```javascript
// Always use this pattern — not useContext, not props, not localStorage
const role = useAuthStore(s => s.session?.user?.role ?? '');
const schoolId = useAuthStore(s => s.session?.school?.id ?? '');
```

### 9.3 Role gates in UI
```jsx
// Conditional rendering by role
{['admin', 'superadmin'].includes(role) && <AdminWidget />}

// Never check permissions directly in components — use the role
// RBAC is enforced on the server; the UI gate is for UX only
```

### 9.4 Error handling
- `useQuery` errors are handled at the component level — show a retry button, not a blank screen
- `useMutation` errors are shown in a toast or inline error message — never silently swallowed
- Network errors show a user-facing message — never expose server error details to school users

---

## 10. The Golden School

The Golden School is a seeded demo school used for testing every release. It represents a realistic school in active operation.

**Contents:**
- 300 students across multiple classes and streams
- 30 teachers with timetables assigned
- 2 terms of attendance history
- Finance invoices and receipts for 80% of students
- Published report cards for 1 term
- Behaviour records
- Parent accounts linked to students

**Use:**
- Run the smoke checklist (§7.3) against the Golden School on staging before every production deploy
- Never use an empty or minimal database for release testing
- Never use production data for testing

**Seeding:** `npm run seed:data` (generates realistic data for the Golden School).

---

## 11. What these standards prevent

- **Naming inconsistency** — every new collection, route, file, and variable has a pattern to follow
- **Security regressions** — schoolId from JWT, not body; Zod at the boundary; secrets never in git
- **Migration accidents** — additive, idempotent, cursor-based, always logged
- **Test inconsistency** — mocks are always at the top; describe blocks match route paths
- **Release anxiety** — three-question gate, smoke checklist, and cert mean every deploy is documented
- **Orphaned features** — the Golden School surfaces broken workflows before schools do

---

*These standards are a living document. Update them when a better pattern is discovered. Outdated standards are more dangerous than no standards.*
