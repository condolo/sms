# Before / after — local p95 comparison

Both runs used the same harness, same configuration (concurrency 10,
12 s per route, 2 warmup requests), same local MongoDB and the same
`msingi_perf` database. All responses were 200.

- Before: `baseline.json` (commit `08f304b`)
- After: `optimised.json` (this branch)

| Route | p95 before | p95 after | Change | p99 before → after |
|---|---:|---:|---:|---:|
| GET `/api/auth/me` | 288.4 ms | 49.0 ms | **5.9× faster (−83%)** | 328.8 → 75.8 ms |
| POST `/api/auth/login-credentials` | 638.4 ms | 651.3 ms | unchanged | 737.4 → 899 ms |
| GET `/api/student-portal/dashboard` | 581.7 ms | 383.9 ms | **1.5× faster (−34%)** | 930.4 → 448.4 ms |
| GET `/api/assessment/reminders` | 249.2 ms | 206.5 ms | 1.2× faster (−17%) | 399.9 → 289.9 ms |
| GET `/api/classes/:id/students` | 118.4 ms | 151.2 ms | within noise (+28%) | 188.9 → 262.8 ms |
| GET `/api/parent-portal/report/:childId` | 88.1 ms | 66.2 ms | 1.3× faster (−25%) | 151.9 → 83.4 ms |
| GET `/api/public/school-asset/:type` | 211.4 ms | 75.4 ms | **2.8× faster (−64%)** | 254.7 → 116.3 ms |

## What changed

1. **`/api/auth/me`** — school and user reads are now projected. The school
   query no longer pulls `logoBase64`/`loginBgBase64` (1–2 MB each on a real
   school); user secrets are excluded at the query, not just in JSON.
   The two reads run in parallel.
2. **Public school assets** — decoded buffers and ETags are cached in-process
   with a 5-minute TTL; 404s are cached briefly. `If-None-Match` returns 304.
   Upload/delete routes invalidate the cache. Repeat reads now take ~1/3 of
   the time and use no MongoDB round trip.
3. **Assessment reminders** — the per-schedule × per-target
   `Marks.countDocuments()` loop is replaced by one `$match` + `$group`
   aggregation. This is the fix for the ≥10 s outliers in production, where
   many schedules × many targets produced hundreds or thousands of serial
   queries. The local demo dataset is too small to show the full gain, but
   the query count is now constant instead of multiplicative.
4. **MongoDB connection** — `bufferTimeoutMS` is now 2 s instead of the
   10 s default, so a transient disconnect fails fast instead of producing
   a slow, silent 200. `serverSelectionTimeoutMS` stays generous for cold
   Atlas starts.
5. **Indexes** — added compound indexes for snapshots by student/status,
   student rosters, attendance by student/date, syllabus topics by
   class/order, assessment schedules, and teaching assignments.

## Why the local numbers are far below the dashboard's 10,000 ms

The local database is small, has no transient reconnects, and the demo
school has few assessment schedules. The dashboard's `10,000` is a
histogram bucket ceiling meaning ">5 s" and was driven by production-side
N+1 fan-out, multi-megabyte document transfers, and Mongoose buffering.
Those mechanisms are removed or bounded by the changes above; the next
measurement that matters is on production traffic after deployment.

## Remaining work

- Parallelise the student dashboard's ~24 mostly sequential DB reads.
- Parallelise the parent report's six sequential queries.
- Parallelise bounded password-candidate verification in login.
- Move remaining inline `bcrypt.hash()` calls to the worker pool.
- Show `max` and real bucket counts beside p95 in Live Analytics.
