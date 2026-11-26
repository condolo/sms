# Local API load test — final-hardened-cache

- Captured: 2026-11-26T20:28:29.779Z
- Node: v22.22.2 (win32)
- Concurrency: 10, duration: 12s per round, warmup: 2, rounds: 3
- Headline p95: median of 3 round(s)
- Database: msingi_perf (local MongoDB)

True client-side percentiles (not histogram buckets):

| Route | Requests | p50 | p90 | p95 | p99 | Max | Mean | RPS | OK% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GET auth-me | 4480 | 20 | 28.8 | 34.3 | 53 | 146 | 22.2 | 373.3 | 100 |
| POST login-credentials | 220 | 396.7 | 560 | 624.6 | 1176.6 | 1192.3 | 427 | 18.3 | 100 |
| GET student-dashboard | 670 | 158.6 | 219.7 | 251.9 | 351.6 | 373.3 | 169.4 | 55.8 | 100 |
| GET assessment-reminders | 1920 | 52.8 | 71.1 | 77.7 | 127.4 | 379.7 | 55.9 | 160 | 100 |
| GET class-students | 2180 | 41.9 | 74.6 | 84.3 | 113.3 | 145.8 | 48.4 | 181.7 | 100 |
| POST class-rosters-batch | 2880 | 36.3 | 45.4 | 49.7 | 66.5 | 78.6 | 37.5 | 240 | 100 |
| GET parent-report | 3160 | 29.7 | 40 | 43.8 | 53.5 | 285.3 | 31 | 263.3 | 100 |
| GET school-asset | 2880 | 21.7 | 41.6 | 50.4 | 84.4 | 153.2 | 24.1 | 240 | 100 |

Per-round p95 (ms):

- **auth-me**: 46.5, 34.3, 34
- **login-credentials**: 624.6, 622.9, 625.1
- **student-dashboard**: 251.9, 199.4, 261.3
- **assessment-reminders**: 77.7, 95.5, 74.4
- **class-students**: 59, 84.3, 85.9
- **class-rosters-batch**: 76.2, 47.7, 49.7
- **parent-report**: 43.8, 40.4, 61.1
- **school-asset**: 66.3, 47.8, 50.4

Status counts:

- **auth-me**: {"200":4480}
- **login-credentials**: {"200":220}
- **student-dashboard**: {"200":670}
- **assessment-reminders**: {"200":1920}
- **class-students**: {"200":2180}
- **class-rosters-batch**: {"200":2880}
- **parent-report**: {"200":3160}
- **school-asset**: {"200":2880}

Raw data: `docs/perf/final-hardened-cache.json`
