# Local API load test — optimised2

- Captured: 2026-11-26T18:44:19.835Z
- Node: v22.22.2 (win32)
- Concurrency: 10, duration: 12s, warmup: 2
- Database: msingi_perf (local MongoDB)

True client-side percentiles (not histogram buckets):

| Route | Requests | p50 | p90 | p95 | p99 | Max | Mean | RPS | OK% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GET auth-me | 1620 | 55.8 | 86.2 | 101 | 131.7 | 170 | 60.2 | 135 | 100 |
| POST login-credentials | 190 | 527.8 | 722.5 | 758.3 | 818.5 | 827.8 | 520.5 | 15.8 | 100 |
| GET student-dashboard | 290 | 401 | 519.9 | 549.1 | 581 | 592.7 | 410.3 | 24.2 | 100 |
| GET assessment-reminders | 1390 | 73.9 | 106.4 | 122.5 | 157.9 | 192 | 80 | 115.8 | 100 |
| GET class-students | 2210 | 43.9 | 57.8 | 65 | 106.8 | 530.4 | 48.6 | 184.2 | 100 |
| GET parent-report | 3910 | 24.3 | 35.1 | 39.1 | 49.1 | 93 | 26 | 325.8 | 100 |
| GET school-asset | 4930 | 12.2 | 24.6 | 30.7 | 44.7 | 184.2 | 13.8 | 410.8 | 100 |

Status counts:

- **auth-me**: {"200":1620}
- **login-credentials**: {"200":190}
- **student-dashboard**: {"200":290}
- **assessment-reminders**: {"200":1390}
- **class-students**: {"200":2210}
- **parent-report**: {"200":3910}
- **school-asset**: {"200":4930}

Raw data: `docs/perf/optimised2.json`
