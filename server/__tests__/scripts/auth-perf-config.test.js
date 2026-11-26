'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const script = path.join(__dirname, '../../../scripts/auth-perf-test.js');

function run(extraEnv) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      AUTH_PERF_BASE_URL: 'http://localhost:9',
      AUTH_PERF_PATH: '/api/auth/login-credentials',
      AUTH_PERF_PAYLOAD: '{"identifier":"x","password":"y"}',
      AUTH_PERF_CONCURRENCY: '1',
      AUTH_PERF_WARMUP: '0',
      AUTH_PERF_EXPECT_STATUS: '200',
      AUTH_PERF_EXPECT_STATUSES: '',
      ...extraEnv,
    },
  });
}

describe('auth perf configuration', () => {
  test('an invalid expected status exits 2 instead of disabling assertions', () => {
    const result = run({ AUTH_PERF_EXPECT_STATUS: 'abc' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('AUTH_PERF_EXPECT_STATUS');
  });

  test('malformed status counts exit 2', () => {
    const result = run({ AUTH_PERF_EXPECT_STATUSES: '200' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('AUTH_PERF_EXPECT_STATUSES');
  });

  test('status counts must total concurrency', () => {
    const result = run({ AUTH_PERF_EXPECT_STATUSES: '200:2' });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('totaling AUTH_PERF_CONCURRENCY');
  });
});
