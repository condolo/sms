/* ============================================================
   GET /api/audit — route-level coverage.

   Confirms the C5/MR-002 query-param additions (correlationId/orgId/
   membershipId) actually reach AuditService.query(), and that every
   caller — including 'superadmin' — is locked to their own school.
   'superadmin' used to be able to omit/override schoolId to get a
   platform-wide view; that was a real cross-tenant leak ('superadmin'
   is a per-school RBAC role every school's own admin holds, not a
   platform credential) found via a direct report, not a scan. Fixed:
   schoolId is now always the caller's own, full stop, regardless of role
   or query param.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

let mockJwtUser;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = mockJwtUser;
    next();
  },
}));

const mockQuery = jest.fn().mockResolvedValue({ docs: [], total: 0 });
jest.mock('../../services/audit', () => ({
  query: (...args) => mockQuery(...args),
  ACTIONS: {},
}));

const express   = require('express');
const supertest = require('supertest');
const auditRouter = require('../../routes/audit');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/audit', auditRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockQuery.mockResolvedValue({ docs: [], total: 0 });
});

describe('GET /api/audit — new C5/MR-002 filter passthrough', () => {
  test('passes correlationId/orgId/membershipId query params through to AuditService.query()', async () => {
    mockJwtUser = { userId: 'usr_admin', role: 'superadmin', schoolId: 'sch_a' };

    await supertest(buildApp())
      .get('/api/audit')
      .query({ correlationId: 'corr_xyz', orgId: 'org_1', membershipId: 'mem_1' });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        correlationId: 'corr_xyz',
        orgId: 'org_1',
        membershipId: 'mem_1',
      })
    );
  });

  test('omits the new filters when not supplied, unchanged from before', async () => {
    mockJwtUser = { userId: 'usr_admin', role: 'admin', schoolId: 'sch_a' };

    await supertest(buildApp()).get('/api/audit');

    const callArg = mockQuery.mock.calls[0][0];
    expect(callArg.correlationId).toBeUndefined();
    expect(callArg.orgId).toBeUndefined();
    expect(callArg.membershipId).toBeUndefined();
  });
});

describe('GET /api/audit — always scoped to the caller\'s own school', () => {
  test('admin is locked to their own school regardless of a schoolId query param', async () => {
    mockJwtUser = { userId: 'usr_admin', role: 'admin', schoolId: 'sch_a' };

    await supertest(buildApp()).get('/api/audit').query({ schoolId: 'sch_other' });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 'sch_a' })
    );
  });

  test('non-admin roles are forbidden', async () => {
    mockJwtUser = { userId: 'usr_teacher', role: 'teacher', schoolId: 'sch_a' };

    const res = await supertest(buildApp()).get('/api/audit');

    expect(res.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('regression: superadmin can NOT cross into another school by passing schoolId explicitly', async () => {
    mockJwtUser = { userId: 'usr_super', role: 'superadmin', schoolId: 'sch_a' };

    await supertest(buildApp()).get('/api/audit').query({ schoolId: 'sch_other' });

    // Must be the caller's OWN school (sch_a), never the requested sch_other —
    // this is the exact leak: any school's own 'superadmin' could previously
    // read every other school's audit log this way.
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 'sch_a' })
    );
  });
});
