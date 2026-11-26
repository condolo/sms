# Local API load test — final-baseline

- Captured: 2026-11-26T19:04:04.052Z
- Node: v22.22.2 (win32)
- Concurrency: 10, duration: 12s per round, warmup: 2, rounds: 3
- Headline p95: median of 3 round(s)
- Database: msingi_perf (local MongoDB)

True client-side percentiles (not histogram buckets):

| Route | Requests | p50 | p90 | p95 | p99 | Max | Mean | RPS | OK% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GET auth-me | 440 | 156.4 | 272.2 | 306.2 | 398.9 | 443.2 | 165.3 | 36.7 | 100 |
| POST login-credentials | 250 | 344.3 | 509 | 642.1 | 725.9 | 795.6 | 379.8 | 20.8 | 100 |
| GET student-dashboard | 410 | 278.2 | 317.6 | 327.5 | 427.1 | 435.7 | 286.3 | 34.2 | 100 |
| GET assessment-reminders | 3170 | 32.6 | 46.7 | 50.8 | 66.9 | 74.7 | 35.6 | 264.2 | 100 |
| GET class-students | 3530 | 28.4 | 38.2 | 48.6 | 59.8 | 66.7 | 30.6 | 294.2 | 100 |
| GET parent-report | 600 | 121.9 | 322.5 | 469 | 698.4 | 919.8 | 173.7 | 50 | 100 |
| GET school-asset | 100 | 774.3 | 1438.7 | 1701.1 | 2071.6 | 2120.2 | 837.5 | 8.3 | 100 |

Per-round p95 (ms):

- **auth-me**: 279, 306.2, 307.1
- **login-credentials**: 513.6, 642.1, 780.1
- **student-dashboard**: 327.5, 363, 301.5
- **assessment-reminders**: 43.7, 50.8, 64.8
- **class-students**: 38.8, 48.6, 80.5
- **parent-report**: 169.2, 469, 945.3
- **school-asset**: 1701.1, 1797.7, 1345.1

Status counts:

- **auth-me**: {"200":440}
- **login-credentials**: {"200":250}
- **student-dashboard**: {"200":410}
- **assessment-reminders**: {"200":3170}
- **class-students**: {"200":3530}
- **parent-report**: {"200":600}
- **school-asset**: {"200":100}

Raw data: `docs/perf/final-baseline.json`
