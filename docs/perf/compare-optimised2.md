# Local API load test — compare-optimised2

- Captured: 2026-11-26T19:56:01.378Z
- Node: v22.22.2 (win32)
- Concurrency: 10, duration: 12s per round, warmup: 2, rounds: 3
- Headline p95: median of 3 round(s)
- Database: msingi_perf (local MongoDB)

True client-side percentiles (not histogram buckets):

| Route | Requests | p50 | p90 | p95 | p99 | Max | Mean | RPS | OK% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GET auth-me | 3940 | 21.6 | 36.8 | 42.8 | 69.4 | 219.7 | 25.2 | 328.3 | 100 |
| POST login-credentials | 190 | 478.5 | 733.4 | 787.6 | 1028.8 | 1030.4 | 503.1 | 15.8 | 100 |
| GET student-dashboard | 270 | 389.3 | 529.2 | 620.5 | 1324.6 | 1366.1 | 430 | 22.5 | 100 |
| GET assessment-reminders | 1260 | 87.9 | 113.6 | 122 | 137.7 | 241.5 | 84.6 | 105 | 100 |
| GET class-students | 2090 | 48.8 | 63.7 | 68.2 | 85.9 | 97.2 | 50.5 | 174.2 | 100 |
| GET parent-report | 3680 | 26.4 | 34.8 | 37.6 | 42.9 | 64.5 | 27.5 | 306.7 | 100 |
| GET school-asset | 4099 | 14.2 | 29.4 | 36.6 | 69.2 | 278.1 | 16.7 | 341.6 | 100 |

Per-round p95 (ms):

- **auth-me**: 57.5, 42.8, 22.7
- **login-credentials**: 536.5, 787.6, 891.3
- **student-dashboard**: 620.5, 1033.8, 270.1
- **assessment-reminders**: 84.6, 122, 130.9
- **class-students**: 68.2, 71.3, 67.7
- **parent-report**: 37.6, 43.1, 37.1
- **school-asset**: 34.6, 36.6, 37.3

Status counts:

- **auth-me**: {"200":3940}
- **login-credentials**: {"200":190}
- **student-dashboard**: {"200":270}
- **assessment-reminders**: {"200":1260}
- **class-students**: {"200":2090}
- **parent-report**: {"200":3680}
- **school-asset**: {"200":4099}

Raw data: `docs/perf/compare-optimised2.json`
