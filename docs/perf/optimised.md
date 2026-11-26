# Local API load test — optimised

- Captured: 2026-11-26T18:32:39.980Z
- Node: v22.22.2 (win32)
- Concurrency: 10, duration: 12s, warmup: 2
- Database: msingi_perf (local MongoDB)

True client-side percentiles (not histogram buckets):

| Route | Requests | p50 | p90 | p95 | p99 | Max | Mean | RPS | OK% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GET auth-me | 3440 | 25.7 | 37.4 | 49 | 75.8 | 124.6 | 28.6 | 286.7 | 100 |
| POST login-credentials | 240 | 365.3 | 567.1 | 651.3 | 899 | 980 | 396.3 | 20 | 100 |
| GET student-dashboard | 370 | 304.5 | 374.3 | 383.9 | 448.4 | 455.2 | 315.2 | 30.8 | 100 |
| GET assessment-reminders | 914 | 116.2 | 154.8 | 206.5 | 289.9 | 322.3 | 118.5 | 76.2 | 100 |
| GET class-students | 1600 | 50.8 | 96 | 151.2 | 262.8 | 422.9 | 65.5 | 133.3 | 100 |
| GET parent-report | 2280 | 44.2 | 59.7 | 66.2 | 83.4 | 161.1 | 47.5 | 190 | 100 |
| GET school-asset | 2100 | 27.8 | 60.5 | 75.4 | 116.3 | 186.3 | 32.4 | 175 | 100 |

Status counts:

- **auth-me**: {"200":3440}
- **login-credentials**: {"200":240}
- **student-dashboard**: {"200":370}
- **assessment-reminders**: {"200":914}
- **class-students**: {"200":1600}
- **parent-report**: {"200":2280}
- **school-asset**: {"200":2100}

Raw data: `docs/perf/optimised.json`
