# Local API load test — baseline

- Captured: 2026-11-26T18:21:43.670Z
- Node: v22.22.2 (win32)
- Concurrency: 10, duration: 12s, warmup: 2
- Database: msingi_perf (local MongoDB)

True client-side percentiles (not histogram buckets):

| Route | Requests | p50 | p90 | p95 | p99 | Max | Mean | RPS | OK% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GET auth-me | 430 | 166.5 | 267.2 | 288.4 | 328.8 | 345.6 | 170.2 | 35.8 | 100 |
| POST login-credentials | 220 | 431.4 | 585.1 | 638.4 | 737.4 | 762.2 | 432.1 | 18.3 | 100 |
| GET student-dashboard | 330 | 304.5 | 389.4 | 581.7 | 930.4 | 972.8 | 341.7 | 27.5 | 100 |
| GET assessment-reminders | 1130 | 63.4 | 182.4 | 249.2 | 399.9 | 411.4 | 95.1 | 94.2 | 100 |
| GET class-students | 1500 | 62.5 | 98.8 | 118.4 | 188.9 | 336 | 70.1 | 125 | 100 |
| GET parent-report | 1930 | 50.7 | 73.5 | 88.1 | 151.9 | 182 | 55.8 | 160.8 | 100 |
| GET school-asset | 620 | 110.1 | 189.2 | 211.4 | 254.7 | 603.4 | 115.1 | 51.7 | 100 |

Status counts:

- **auth-me**: {"200":430}
- **login-credentials**: {"200":220}
- **student-dashboard**: {"200":330}
- **assessment-reminders**: {"200":1130}
- **class-students**: {"200":1500}
- **parent-report**: {"200":1930}
- **school-asset**: {"200":620}

Raw data: `docs/perf/baseline.json`
