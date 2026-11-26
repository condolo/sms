# Local API load test — compare-optimised

- Captured: 2026-11-26T19:17:10.374Z
- Node: v22.22.2 (win32)
- Concurrency: 10, duration: 12s per round, warmup: 2, rounds: 3
- Headline p95: median of 3 round(s)
- Database: msingi_perf (local MongoDB)

True client-side percentiles (not histogram buckets):

| Route | Requests | p50 | p90 | p95 | p99 | Max | Mean | RPS | OK% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GET auth-me | 1450 | 68.3 | 91.3 | 96.4 | 111.2 | 132.3 | 67.7 | 120.8 | 100 |
| POST login-credentials | 190 | 452.3 | 666.5 | 705.1 | 743.5 | 752.2 | 503.2 | 15.8 | 100 |
| GET student-dashboard | 110 | 1056.3 | 1190 | 1201.7 | 1216.3 | 1234.2 | 1055.8 | 9.2 | 100 |
| GET assessment-reminders | 950 | 109.1 | 159.2 | 174 | 195.5 | 215 | 118.1 | 79.2 | 100 |
| GET class-students | 1130 | 73.1 | 145 | 151.9 | 165.8 | 190.3 | 94.6 | 94.2 | 100 |
| GET parent-report | 1760 | 50.6 | 88.3 | 99.4 | 117.6 | 144.5 | 57.4 | 146.7 | 100 |
| GET school-asset | 1460 | 38.7 | 84.6 | 98.1 | 138.7 | 228 | 45.4 | 121.7 | 100 |

Per-round p95 (ms):

- **auth-me**: 138.7, 96.4, 96.3
- **login-credentials**: 705.1, 712.2, 642.5
- **student-dashboard**: 1201.7, 1251.6, 1111.4
- **assessment-reminders**: 188.4, 174, 172.2
- **class-students**: 136, 151.9, 152
- **parent-report**: 98.6, 99.4, 104.8
- **school-asset**: 114.4, 98.1, 92

Status counts:

- **auth-me**: {"200":1450}
- **login-credentials**: {"200":190}
- **student-dashboard**: {"200":110}
- **assessment-reminders**: {"200":950}
- **class-students**: {"200":1130}
- **parent-report**: {"200":1760}
- **school-asset**: {"200":1460}

Raw data: `docs/perf/compare-optimised.json`
