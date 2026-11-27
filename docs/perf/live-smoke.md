# Live API smoke test — live-smoke

- Captured: 2026-11-27T06:53:20.573Z
- Base URL: https://msingi.io
- Health: ok · version 4.28.0 · db connected
- Requests: 10/read route, 5/login, concurrency 2, warmup 1

| Endpoint | p50 | p95 | Max | Avg bytes | OK% | Statuses |
|---|---:|---:|---:|---:|---:|---|
| GET health | 312 | 422.8 | 422.8 | 90 | 100 | {"200":10} |
| GET auth-me | 1662.1 | 2369.4 | 2369.4 | 495968 | 100 | {"200":10} |
| POST login-credentials | 3549.9 | 3738.7 | 3738.7 | 8411 | 100 | {"200":5} |
| GET student-dashboard | 5866.2 | 7544.8 | 7544.8 | 4472 | 100 | {"200":10} |
| GET assessment-reminders | 7518.5 | 7719.3 | 7719.3 | 8705 | 100 | {"200":10} |
| GET class-students | 1042.2 | 1067.2 | 1067.2 | 5640 | 100 | {"200":10} |
| GET parent-report | 1751.6 | 2272.7 | 2272.7 | 3470 | 100 | {"200":10} |
| GET school-asset | 875.4 | 1182 | 1182 | 21585 | 100 | {"200":10} |
| POST class-rosters-batch | 301.2 | 331.5 | 331.5 | 165 | 100 | {"404":10} |

Raw data: `docs/perf/live-smoke.json`
