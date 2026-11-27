# Local API performance baselines

This directory holds repeatable, client-side load-test results for the API.

## Why these numbers differ from Live Analytics

The console's "p95" is the upper bound of a fixed histogram bucket
(`5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000` ms), not a measured
percentile. A reading of `10,000 ms` only means "some request took more than
5 seconds", and with three requests a single outlier sets the value.

The harness in `scripts/perf-load-test.js` measures actual per-request wall
time with `perf_hooks` and computes real p50/p90/p95/p99/max. Use these
artifacts to judge improvements; use the console only as a coarse signal.

## Running a test

Requirements: Node 18+ and a MongoDB listening on `127.0.0.1:27017`
(`npm run db:local` starts one if needed).

```bash
# baseline (starts its own API process against database `msingi_perf`)
npm run test:perf

# after optimisations
PERF_LABEL=optimised PERF_OUT=docs/perf/optimised.json npm run test:perf
```

On Windows PowerShell:

```powershell
$env:PERF_LABEL='optimised'; $env:PERF_OUT='docs/perf/optimised.json'; npm run test:perf
```

Useful overrides: `PERF_CONCURRENCY` (default 10), `PERF_DURATION_SEC`
(default 12), `PERF_WARMUP` (default 2), `PERF_PORT` (default 3005),
`PERF_MONGO_URI`, `PERF_DB_NAME`, `PERF_NO_SPAWN=1` (attach to an existing
server).

The harness:

1. starts the real API with a dedicated `msingi_perf` database and lets the
   normal demo seed run;
2. waits for the post-start backfills to finish by probing the protected
   routes until they return 200;
3. logs in the demo personas and discovers a class inside the teacher's own
   scope plus the linked demo student;
4. seeds a ~1 MB logo into the perf database so the asset route exercises a
   realistic read + synchronous base64 decode;
5. drives seven route families at fixed concurrency and duration and writes
   a JSON artifact plus a Markdown summary.

Credentials are never written to the artifacts.

## Current baseline

`baseline.json` / `baseline.md` — captured 2026-11-26, Node v22.22.2,
concurrency 10, 12 s per route, 2 warmup requests. All routes returned 200.
