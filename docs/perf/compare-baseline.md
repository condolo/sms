# Local API load test — compare-baseline

- Captured: 2026-11-26T19:11:56.920Z
- Node: v22.22.2 (win32)
- Concurrency: 10, duration: 12s per round, warmup: 2, rounds: 3
- Headline p95: median of 3 round(s)
- Database: msingi_perf (local MongoDB)

True client-side percentiles (not histogram buckets):

| Route | Requests | p50 | p90 | p95 | p99 | Max | Mean | RPS | OK% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GET auth-me | 240 | 303.9 | 466.5 | 521.6 | 595 | 649.4 | 303.4 | 20 | 100 |
| POST login-credentials | 180 | 503 | 751 | 865.6 | 955.5 | 1062.8 | 528 | 15 | 100 |
| GET student-dashboard | 230 | 512.3 | 590.6 | 607.5 | 653.4 | 659.8 | 521 | 19.2 | 100 |
| GET assessment-reminders | 1720 | 62.3 | 83.3 | 105.1 | 121.8 | 194.9 | 64.9 | 143.3 | 100 |
| GET class-students | 1680 | 55.6 | 87.2 | 120.4 | 194.2 | 339.6 | 63.7 | 140 | 100 |
| GET parent-report | 1590 | 58.4 | 111.7 | 120.9 | 137.1 | 154.1 | 68.3 | 132.5 | 100 |
| GET school-asset | 390 | 165.2 | 327.6 | 370.3 | 433.6 | 444.1 | 181.5 | 32.5 | 100 |

Per-round p95 (ms):

- **auth-me**: 1482.6, 521.6, 378.3
- **login-credentials**: 880.7, 770.1, 865.6
- **student-dashboard**: 607.5, 546.3, 714.3
- **assessment-reminders**: 105.1, 72.5, 120
- **class-students**: 120.4, 142.8, 88.1
- **parent-report**: 120.9, 130.4, 120.4
- **school-asset**: 411.4, 354.3, 370.3

Status counts:

- **auth-me**: {"200":240}
- **login-credentials**: {"200":180}
- **student-dashboard**: {"200":230}
- **assessment-reminders**: {"200":1720}
- **class-students**: {"200":1680}
- **parent-report**: {"200":1590}
- **school-asset**: {"200":390}

Raw data: `docs/perf/compare-baseline.json`
