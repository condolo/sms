# Local API load test — final-batch-pagination

- Captured: 2026-11-26T20:19:33.850Z
- Node: v22.22.2 (win32)
- Concurrency: 10, duration: 12s per round, warmup: 2, rounds: 3
- Headline p95: median of 3 round(s)
- Database: msingi_perf (local MongoDB)

True client-side percentiles (not histogram buckets):

| Route | Requests | p50 | p90 | p95 | p99 | Max | Mean | RPS | OK% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GET auth-me | 5210 | 18.5 | 23.1 | 24.8 | 30.3 | 45.7 | 19 | 434.2 | 100 |
| POST login-credentials | 260 | 339.1 | 472.9 | 485.2 | 581.8 | 597 | 363.8 | 21.7 | 100 |
| GET student-dashboard | 650 | 169.3 | 208.6 | 242.3 | 258 | 264.1 | 176.3 | 54.2 | 100 |
| GET assessment-reminders | 2130 | 48.5 | 67.5 | 78 | 93 | 125.7 | 52.3 | 177.5 | 100 |
| GET class-students | 3130 | 31.3 | 46.8 | 51.7 | 58.8 | 64.8 | 33.9 | 260.8 | 100 |
| POST class-rosters-batch | 2460 | 38.1 | 66.9 | 76.6 | 97 | 119 | 43.6 | 205 | 100 |
| GET parent-report | 4210 | 22.5 | 32.1 | 35.7 | 42 | 61.2 | 24 | 350.8 | 100 |
| GET school-asset | 3061 | 18.8 | 39.6 | 49.8 | 81.6 | 608.9 | 22.7 | 255.1 | 100 |

Per-round p95 (ms):

- **auth-me**: 31.4, 24.8, 24.2
- **login-credentials**: 491.8, 446.6, 485.2
- **student-dashboard**: 263.2, 242.3, 165.5
- **assessment-reminders**: 81.8, 65.7, 78
- **class-students**: 81.8, 51.7, 50.1
- **class-rosters-batch**: 76.6, 90.3, 60.3
- **parent-report**: 30.6, 35.7, 47.2
- **school-asset**: 42.1, 49.8, 50.8

Status counts:

- **auth-me**: {"200":5210}
- **login-credentials**: {"200":260}
- **student-dashboard**: {"200":650}
- **assessment-reminders**: {"200":2130}
- **class-students**: {"200":3130}
- **class-rosters-batch**: {"200":2460}
- **parent-report**: {"200":4210}
- **school-asset**: {"200":3061}

Raw data: `docs/perf/final-batch-pagination.json`
