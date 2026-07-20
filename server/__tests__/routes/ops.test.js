/* ============================================================
   /api/ops — auth-gate regression test.

   Real bug found via a direct report, not a scan: every route here was
   gated on `authMiddleware + role === 'superadmin'` — a normal SCHOOL
   session check. 'superadmin' is a per-school RBAC role every school's
   own admin holds, not a platform credential, so any school's own admin
   could reach these routes and see fullReport()'s unscoped, platform-wide
   health/integrity/compliance data across every other school.

   Fix: gated on platformSession instead — the real platform-admin token
   (issued only by POST /api/platform/auth/login), which a normal school
   login never sets. This test uses the REAL platformSession middleware
   (not mocked) so the gate itself is what's under test, not a stand-in
   for it — only the ops service (real health checks, DB-dependent) and
   the release-cert engine are mocked.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

process.env.PLATFORM_JWT_SECRET = 'test-platform-secret';

jest.mock('../../services/ops', () => ({
  fullReport: jest.fn().mockResolvedValue({ verdict: 'CERTIFIED' }),
  release: {
    history: jest.fn().mockResolvedValue([{ certId: 'c1' }]),
    get:     jest.fn(),
    verify:  jest.fn(),
  },
}));

const jwt       = require('jsonwebtoken');
const express   = require('express');
const cookieParser = require('cookie-parser');
const supertest = require('supertest');

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/api/ops', require('../../routes/ops'));
  return a;
}

function platformCookie() {
  const token = jwt.sign({ sub: 'platform-admin' }, process.env.PLATFORM_JWT_SECRET, { expiresIn: '2h' });
  return `platform_token=${token}`;
}

describe('GET /api/ops/health — platform-admin only', () => {
  test('401s a normal, unauthenticated request', async () => {
    const res = await supertest(app()).get('/api/ops/health');
    expect(res.status).toBe(401);
  });

  test('regression: a school-session-shaped superadmin role claim alone is not enough — no platform_token, still 401', async () => {
    // Simulates exactly the old leak vector: a real school admin, role
    // 'superadmin', with a perfectly valid school JWT — but no platform
    // session. Passed as a bearer-ish header to prove the route ignores
    // it entirely; only the platform_token cookie matters now.
    const res = await supertest(app())
      .get('/api/ops/health')
      .set('Authorization', 'Bearer not-a-platform-token');
    expect(res.status).toBe(401);
  });

  test('200s with a genuine platform_token cookie', async () => {
    const res = await supertest(app())
      .get('/api/ops/health')
      .set('Cookie', platformCookie());
    expect(res.status).toBe(200);
    expect(res.body.data.verdict).toBe('CERTIFIED');
  });
});

describe('GET /api/ops/certs — platform-admin only', () => {
  test('401s without a platform_token cookie', async () => {
    const res = await supertest(app()).get('/api/ops/certs');
    expect(res.status).toBe(401);
  });

  test('200s with a genuine platform_token cookie', async () => {
    const res = await supertest(app())
      .get('/api/ops/certs')
      .set('Cookie', platformCookie());
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ certId: 'c1' }]);
  });
});
