# Before / after — controlled local p95 comparison

The authoritative comparison uses the **same harness, same fresh database,
same seed, three rounds per route**, and reports the median round's p95.
Only the application code differs between the two runs.

- Before: `compare-baseline.json` (branch `perf/baseline-load-test`)
- After: `compare-optimised2.json` (branch `perf/route-optimisations`)

Configuration: concurrency 10, 12 s per round, 2 warmup requests,
3 rounds, IP rotation (so the login rate limiter does not truncate the run),
fresh `msingi_perf` database before each run. All responses were 200.

| Route | p95 before | p95 after | Change |
|---|---:|---:|---:|
| GET `/api/auth/me` | 521.6 ms | **42.8 ms** | **12.2× faster** |
| GET `/api/public/school-asset/:type` | 370.3 ms | **36.6 ms** | **10.1× faster** |
| GET `/api/parent-portal/report/:childId` | 120.9 ms | **37.6 ms** | **3.2× faster** |
| GET `/api/classes/:id/students` | 120.4 ms | 68.2 ms | **1.8× faster** |
| POST `/api/auth/login-credentials` | 865.6 ms | 787.6 ms | 1.1× faster |
| GET `/api/student-portal/dashboard` | 607.5 ms | 620.5 ms | no measured gain |
| GET `/api/assessment/reminders` | 105.1 ms | 122.0 ms | slightly slower locally |

`baseline.json` / `optimised.json` (single round, no fresh DB) are earlier,
less reliable runs kept for reference. `final-baseline.json` /
`final-optimised.json` show how misleading an accumulating database can be —
do not use them for before/after claims.

## Why two routes did not improve locally

- **Student dashboard**: the early reads were fanned out, but on a small local
  Mongo this trades sequential round trips for bursts of concurrent queries
  and does not reduce wall time. The durable win is the publish-state fix:
  `getPublishState()` and `isTimetablePublished()` previously did unprojected
  school reads that pulled the multi-megabyte logo blob twice per request.
  They are now projected to `timetableStatus`, and the reader reuses the
  resolved state. The benefit shows up on a school with a real logo upload,
  which the small seeded fixture does not fully reproduce.
- **Assessment reminders**: the N+1 loop is gone (one `$match`/`$group`
  aggregation instead of `schedules × targets` count queries). On the tiny
  seeded dataset the aggregation has fixed overhead and can be marginally
  slower. The fix targets production datasets where hundreds or thousands of
  serial counts dominated the response.

## What was changed

1. `/api/auth/me` — projected school/user reads, in parallel; secrets excluded
   at the query.
2. Public school assets — in-process decoded-buffer cache with ETags and 304,
   brief negative caching, invalidation from upload/delete routes.
3. Assessment reminders — constant-query aggregation replacing the N+1 loop.
4. MongoDB — `bufferTimeoutMS` reduced from 10 s to 2 s so reconnects fail
   fast instead of producing slow silent 200s.
5. Indexes — snapshots by student/status, student rosters, attendance by
   student/date, syllabus topics by class/order, assessment schedules,
   teaching assignments.
6. Parent report and student dashboard — independent reads parallelised.
7. Login — bounded candidate password checks and lock checks run in parallel.
8. Timetable publish state — projected and shared within a request.

## Next

Batch fetching and pagination for the slow list endpoints and their client
screens, then a fresh controlled benchmark.
