# Before / after — controlled local p95 comparison

The authoritative comparison uses the **same harness, same fresh database,
same seed, three rounds per route**, and reports the median round's p95.
Only the application code differs between the two runs.

- Before: `compare-baseline.json` (branch `perf/baseline-load-test`)
- After: `final-batch-pagination.json` (branch `perf/batch-pagination`)

Configuration: concurrency 10, 12 s per round, 2 warmup requests,
3 rounds, IP rotation (so the login rate limiter does not truncate the run),
fresh `msingi_perf` database before each run. All responses were 200.

| Route | p95 before | p95 after | Change |
|---|---:|---:|---:|
| GET `/api/auth/me` | 521.6 ms | **24.8 ms** | **21× faster** |
| GET `/api/public/school-asset/:type` | 370.3 ms | **49.8 ms** | **7.4× faster** |
| GET `/api/parent-portal/report/:childId` | 120.9 ms | **35.7 ms** | **3.4× faster** |
| GET `/api/student-portal/dashboard` | 607.5 ms | **242.3 ms** | **2.5× faster** |
| GET `/api/classes/:id/students` | 120.4 ms | **51.7 ms** | **2.3× faster** |
| POST `/api/auth/login-credentials` | 865.6 ms | **485.2 ms** | **1.8× faster** |
| GET `/api/assessment/reminders` | 105.1 ms | **78.0 ms** | **1.35× faster** |
| POST `/api/classes/rosters/batch` | — | **76.6 ms** | new batch endpoint |

`baseline.json` / `optimised.json` (single round, no fresh DB) are earlier,
less reliable runs kept for reference. `final-baseline.json` /
`final-optimised.json` show how misleading an accumulating database can be —
do not use them for before/after claims.

## What was changed

1. `/api/auth/me` — projected school/user reads, in parallel; secrets excluded
   at the query.
2. Public school assets — LRU cache with ETags and 304, byte + entry caps,
   single-flight loads, generation-safe invalidation, invalidation from
   upload/delete routes.
3. Assessment reminders — constant-query aggregation replacing the N+1 loop,
   plus opt-in pagination.
4. MongoDB — `bufferTimeoutMS` reduced from 10 s to 2 s so reconnects fail
   fast instead of producing slow silent 200s.
5. Indexes — snapshots by student/status, student rosters, attendance by
   student/date, syllabus topics by class/order, assessment schedules,
   teaching assignments.
6. Parent report and student dashboard — independent reads parallelised;
   publish-state reads projected and shared.
7. Login — bounded candidate password checks and lock checks run in parallel.
8. Batch rosters — one endpoint for multiple class rosters, reusing the exact
   single-class handler so authorization cannot drift.
9. Outreach templates/campaigns — opt-in pagination with console UI controls.

## Next

- Re-run the controlled benchmark after the LRU/single-flight hardening.
- Consider shared cache invalidation if production runs multiple instances.
- Production verification after deployment.
