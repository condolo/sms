/* ============================================================
   DELETE /api/platform/schools/:id and DELETE /api/platform/schools/all
   — regression coverage for a real, verified gap.

   Both routes are the single most destructive operations this platform
   can perform (full cascade delete across every tenant collection) and
   used to write NO audit-log entry at all — only an ephemeral
   console.log with no correlation ID, invisible to AuditService.query().
   'platform.school_deleted' was already pre-defined in
   server/services/audit.js as a 'critical' severity action inside
   ALERT_ACTIONS (fires a webhook — "must never go unnoticed"), but that
   alert could never fire because neither route ever called
   AuditService.log() at all.

   This test pins that both routes now call AuditService.log() with the
   correct action/schoolId/target on every successful delete — once per
   school for the bulk-wipe path, so investigating any ONE school's
   disappearance finds an entry regardless of whether it was deleted
   individually or as part of a bulk wipe.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/auth', () => ({
  platformSession: (req, _res, next) => next(),
}));
jest.mock('../../middleware/plan', () => ({ invalidatePlanCache: jest.fn() }));
jest.mock('../../middleware/rbac', () => ({ invalidatePermCache: jest.fn() }));
jest.mock('../../utils/jwt', () => ({ sign: jest.fn(() => 'signed') }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/tenant-model', () => ({ tenantModel: jest.fn() }));
jest.mock('../../utils/provision-organizations', () => ({ provisionOrganizationForSchool: jest.fn() }));
jest.mock('../../utils/provision-memberships', () => ({ provisionMembershipForUser: jest.fn() }));
jest.mock('../../utils/provision-identities', () => ({ provisionIdentityForUser: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn() }));

const mockAuditLog = jest.fn();
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

let mockSchoolDoc = null;      // single-delete target
let mockPurgeList = [];        // bulk-wipe targets

jest.mock('mongoose', () => {
  const actual = jest.requireActual('mongoose');
  return {
    ...actual,
    models: {},
    model: jest.fn((_name, _schema, col) => {
      if (col === 'schools') {
        return {
          findById:      (id) => ({ lean: () => Promise.resolve(mockSchoolDoc?.mongoId === id || mockSchoolDoc?._id === id ? mockSchoolDoc : mockSchoolDoc) }),
          findByIdAndDelete: () => Promise.resolve(mockSchoolDoc),
          find:          () => ({ lean: () => Promise.resolve(mockPurgeList) }),
          deleteMany:    () => Promise.resolve({ deletedCount: mockPurgeList.length }),
        };
      }
      // Every other tenant collection (TENANT_COLS) and 'users' — generic no-op.
      return { deleteMany: () => Promise.resolve({ deletedCount: 0 }) };
    }),
  };
});

const express   = require('express');
const supertest = require('supertest');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/platform', require('../../routes/platform'));
  return a;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSchoolDoc = {
    _id: 'mongo_id_1', id: 'sch_trinitas', slug: 'trinitas-tis',
    name: 'Trinitas International School', adminEmail: 'admin@trinitas-tis.example',
  };
  mockPurgeList = [
    { _id: 'mongo_id_1', id: 'sch_a', slug: 'school-a', name: 'School A', adminEmail: 'a@x.com' },
    { _id: 'mongo_id_2', id: 'sch_b', slug: 'school-b', name: 'School B', adminEmail: 'b@x.com' },
  ];
});

describe('DELETE /api/platform/schools/:id', () => {
  test('successful delete writes an AuditService.log entry for platform.school_deleted', async () => {
    const res = await supertest(app()).delete('/api/platform/schools/mongo_id_1');
    expect(res.status).toBe(200);
    expect(mockAuditLog).toHaveBeenCalledTimes(1);
    const call = mockAuditLog.mock.calls[0][0];
    expect(call.action).toBe('platform.school_deleted');
    expect(call.schoolId).toBe('sch_trinitas');
    expect(call.target).toEqual({ type: 'school', id: 'sch_trinitas', label: 'Trinitas International School' });
    expect(call.details).toEqual({ slug: 'trinitas-tis', adminEmail: 'admin@trinitas-tis.example' });
  });

  test('the demo school guard still blocks deletion and does NOT log (nothing happened)', async () => {
    mockSchoolDoc = { _id: 'mongo_demo', id: 'sch_demo', slug: 'demo', name: 'Demo School' };
    const res = await supertest(app()).delete('/api/platform/schools/mongo_demo');
    expect(res.status).toBe(403);
    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/platform/schools/all', () => {
  test('bulk wipe writes one AuditService.log entry PER school, not a single opaque one', async () => {
    const res = await supertest(app()).delete('/api/platform/schools/all');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);

    expect(mockAuditLog).toHaveBeenCalledTimes(2);
    const actions = mockAuditLog.mock.calls.map(c => c[0].action);
    expect(actions).toEqual(['platform.school_deleted', 'platform.school_deleted']);

    const schoolIds = mockAuditLog.mock.calls.map(c => c[0].schoolId);
    expect(schoolIds).toEqual(['sch_a', 'sch_b']);

    // Each entry is individually findable/investigable per school, and
    // flagged as part of a bulk operation rather than looking like an
    // isolated single delete.
    const first = mockAuditLog.mock.calls[0][0];
    expect(first.details).toEqual({ slug: 'school-a', adminEmail: 'a@x.com', bulkWipe: true, totalWiped: 2 });
  });

  test('an empty purge list (nothing to wipe) logs nothing', async () => {
    mockPurgeList = [];
    const res = await supertest(app()).delete('/api/platform/schools/all');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(0);
    expect(mockAuditLog).not.toHaveBeenCalled();
  });
});
