# Cache, batch and pagination on the slow endpoints

Three complementary techniques are now applied to the route families from
the Live Analytics slow list. Each has focused tests and each is exercised
by `scripts/perf-load-test.js`.

## 1. Cache — `/api/public/school-asset/:type`

`server/utils/school-asset-cache.js` caches the decoded image Buffer, MIME
type and a content ETag in process (5-minute TTL, 30-second negative cache,
500-entry cap). Repeat reads use no MongoDB round trip and support
`If-None-Match` → 304. Upload/delete routes in `server/routes/settings.js`
invalidate the affected type immediately.

Tests: `server/__tests__/school-asset-cache.test.js` (hit/miss, stable and
changing ETags, negative caching, per-type and per-school invalidation).

## 2. Batch — `/api/classes/rosters/batch`

`POST /api/classes/rosters/batch` accepts 1–20 class IDs and returns one
result per class. It calls the **same handler** as `GET /api/classes/:id/students`
with a capture response, so school ownership, scope narrowing, elective
rules, homeroom fallback and status filtering cannot drift between the
single and batched paths. Concurrency inside a batch is capped at four.

`TeacherStudents.jsx` now chunks its classes into batches of 20 instead of
issuing one HTTP request per class.

Tests: `POST /api/classes/rosters/batch` describe block in
`server/__tests__/routes/classes-streams-students-scope.test.js` (ordering,
same 403 as the single route for out-of-scope classes, empty/oversized batch
rejection). All pre-existing classes route tests still pass.

## 3. Pagination

### Assessment reminders

`GET /api/assessment/reminders` accepts optional `page`/`limit`. Existing
callers send neither and still get the complete flat array; paged callers
get the same array shape plus top-level `pagination: {page, limit, total,
pages}`. `RemindersTab.jsx` pages at 20 rows with the shared `Pagination`
component and resets to page 1 after a notify.

Tests: `server/__tests__/routes/assessment-reminders-targets.test.js`
(legacy shape unchanged, page slices and metadata, empty scope).

### Outreach templates and campaigns

`GET /api/platform/outreach/templates` and `/campaigns` accept optional
`page`/`pageSize`. With no params they keep the legacy flat array. With
params they return standard pagination metadata. Both console tabs have
Previous/Next controls; the campaign create dialog still reads the
unpaged template list.

Tests: `server/__tests__/routes/platform-outreach-routes.test.js` (legacy
and paged shapes for both endpoints, args forwarded to the service).

## Why these are opt-in

The React client, console scripts and existing tests all rely on flat arrays
from these endpoints. Making pagination opt-in avoids a breaking API change
while giving the slow screens bounded payloads.
