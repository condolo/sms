# Local API load test — optimised2-repeat

- Captured: 2026-11-26T18:46:15.830Z
- Node: v22.22.2 (win32)
- Concurrency: 10, duration: 12s, warmup: 2
- Database: msingi_perf (local MongoDB)

True client-side percentiles (not histogram buckets):

| Route | Requests | p50 | p90 | p95 | p99 | Max | Mean | RPS | OK% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GET auth-me | 3760 | 23.8 | 35 | 41 | 69.9 | 107 | 26.3 | 313.3 | 100 |
| POST login-credentials | 150 | 460.4 | 1018.9 | 1130 | 2439.3 | 2667.1 | 570.1 | 12.5 | 100 |
| GET student-dashboard | 370 | 300.7 | 400.8 | 425.5 | 458.5 | 462.7 | 318.6 | 30.8 | 100 |
| GET assessment-reminders | 1910 | 54.4 | 73.1 | 87 | 107.1 | 183.8 | 58.6 | 159.2 | 100 |
| GET class-students | 3280 | 31 | 41.5 | 46.4 | 56.1 | 66.5 | 32.8 | 273.3 | 100 |
| GET parent-report | 4361 | 21.7 | 30.7 | 35.3 | 50.1 | 98.7 | 23.5 | 363.4 | 100 |
| GET school-asset | 5120 | 12.1 | 24.1 | 29 | 38.9 | 57 | 13.3 | 426.7 | 100 |

Status counts:

- **auth-me**: {"200":3760}
- **login-credentials**: {"200":150}
- **student-dashboard**: {"200":370}
- **assessment-reminders**: {"200":1910}
- **class-students**: {"200":3280}
- **parent-report**: {"200":4361}
- **school-asset**: {"200":5120}

Raw data: `docs/perf/optimised2-repeat.json`
