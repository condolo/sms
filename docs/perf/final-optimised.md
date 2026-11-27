# Local API load test — final-optimised

- Captured: 2026-11-26T18:58:32.842Z
- Node: v22.22.2 (win32)
- Concurrency: 10, duration: 12s per round, warmup: 2, rounds: 3
- Headline p95: median of 3 round(s)
- Database: msingi_perf (local MongoDB)

True client-side percentiles (not histogram buckets):

| Route | Requests | p50 | p90 | p95 | p99 | Max | Mean | RPS | OK% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GET auth-me | 4890 | 19.5 | 25.3 | 28.3 | 41.4 | 161.1 | 20.7 | 407.5 | 100 |
| POST login-credentials | 250 | 353.5 | 503 | 530.4 | 625.9 | 647.4 | 377.5 | 20.8 | 100 |
| GET student-dashboard | 370 | 309.3 | 385.7 | 410 | 449 | 451.3 | 319.4 | 30.8 | 100 |
| GET assessment-reminders | 1370 | 76.8 | 100.9 | 105.8 | 125.2 | 138.2 | 80.4 | 114.2 | 100 |
| GET class-students | 2060 | 50 | 61.3 | 65.1 | 79.2 | 274.9 | 52 | 171.7 | 100 |
| GET parent-report | 3740 | 25.1 | 35.5 | 40.6 | 77.6 | 102.7 | 27.4 | 311.7 | 100 |
| GET school-asset | 5660 | 11.5 | 20.4 | 23.9 | 32.3 | 66.3 | 12.1 | 471.7 | 100 |

Per-round p95 (ms):

- **auth-me**: 32.8, 28.3, 24.4
- **login-credentials**: 464.6, 530.4, 601.9
- **student-dashboard**: 410, 389.8, 815.6
- **assessment-reminders**: 279.6, 93.8, 105.8
- **class-students**: 65.1, 56.5, 69.8
- **parent-report**: 40.6, 42.6, 27.4
- **school-asset**: 34.6, 23.4, 23.9

Status counts:

- **auth-me**: {"200":4890}
- **login-credentials**: {"200":250}
- **student-dashboard**: {"200":370}
- **assessment-reminders**: {"200":1370}
- **class-students**: {"200":2060}
- **parent-report**: {"200":3740}
- **school-asset**: {"200":5660}

Raw data: `docs/perf/final-optimised.json`
