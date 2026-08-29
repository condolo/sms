/* ============================================================
   server/routes/students.js — DELETE /purge audit trail
   Security Baseline Register, AUD-04 (Critical).

   Bulk hard-delete (students + cascaded invoices/payments) used to be
   logged only via console.log — unlike the adjacent single-record
   DELETE /:id, which calls AuditService.log with action
   'student.deleted', registered in ALERT_ACTIONS so a deletion
   webhook fires. The bulk path bypassed both the queryable audit
   trail and that webhook entirely. Fixed by reusing the exact same
   action name so the existing ALERT_ACTIONS lookup picks it up with
   no separate wiring, as one combined audit entry for the whole
   batch (matching this codebase's existing bulk-operation
   convention) rather than one per student.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'], email: 'admin@school-a.test' };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_q, _s, n) => n() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_q, _s, n) => n() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_q, _s, n) => n() }));
jest.mock('../../utils/scopeEngine', () => ({ applyToFilter: jest.fn(), hasNoAssignments: jest.fn(() => false) }));

function mockChain(r) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(r) };
  return c;
}

const STUDENTS_SEED = [
  { id: 's1', _id: 'oid_s1', firstName: 'Amara', lastName: 'Osei' },
  { id: 's2', _id: 'oid_s2', firstName: 'Brian', lastName: 'Onyango' },
];

const mockStudents = {
  find:           jest.fn(() => mockChain(STUDENTS_SEED)),
  countDocuments: jest.fn(() => Promise.resolve(0)),
  deleteMany:     jest.fn(() => Promise.resolve({ deletedCount: STUDENTS_SEED.length })),
};
const mockInvoices = { deleteMany: jest.fn(() => Promise.resolve({ deletedCount: 0 })) };
const mockPayments = { deleteMany: jest.fn(() => Promise.resolve({ deletedCount: 0 })) };
const mockAuditLogCreate = jest.fn().mockResolvedValue({});
const mockEnqueueJob     = jest.fn().mockResolvedValue({});

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'students')    return mockStudents;
    if (c === 'invoices')    return mockInvoices;
    if (c === 'payments')    return mockPayments;
    if (c === 'audit_logs')  return { create: mockAuditLogCreate };
    if (c === 'memberships') return { findOne: jest.fn(() => mockChain(null)) };
    return { find: jest.fn(() => mockChain([])), findOne: jest.fn(() => mockChain(null)) };
  }),
}));
jest.mock('../../utils/job-queue', () => ({
  enqueueJob:      mockEnqueueJob,
  registerHandler: jest.fn(),
}));

const express   = require('express');
const supertest = require('supertest');
const studentsRouter = require('../../routes/students');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/students', studentsRouter);
  return app;
}

const ORIGINAL_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;
beforeEach(() => {
  jest.clearAllMocks();
  mockStudents.find.mockReturnValue(mockChain(STUDENTS_SEED));
});
afterAll(() => { process.env.ALERT_WEBHOOK_URL = ORIGINAL_WEBHOOK_URL; });

describe('DELETE /api/students/purge — audit trail (AUD-04)', () => {
  test('writes an audit_logs entry with action student.deleted for the batch', async () => {
    const res = await supertest(buildApp()).delete('/api/students/purge').send({ ids: ['s1', 's2'] });
    expect(res.status).toBe(200);

    expect(mockAuditLogCreate).toHaveBeenCalledTimes(1); // ONE combined entry, not one per student
    const written = mockAuditLogCreate.mock.calls[0][0];
    expect(written.action).toBe('student.deleted');
    expect(written.schoolId).toBe(SCHOOL_A);
    expect(written.actor.userId).toBe('usr_admin');
    expect(written.details.count).toBe(2);
    expect(written.details.students).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 's1', name: 'Amara Osei' }),
        expect.objectContaining({ id: 's2', name: 'Brian Onyango' }),
      ])
    );
  });

  test('the deletion alert webhook is enqueued for the batch — the exact gap this fix closes', async () => {
    process.env.ALERT_WEBHOOK_URL = 'https://example.test/webhook';
    const res = await supertest(buildApp()).delete('/api/students/purge').send({ ids: ['s1', 's2'] });
    expect(res.status).toBe(200);

    expect(mockEnqueueJob).toHaveBeenCalledTimes(1);
    const enqueued = mockEnqueueJob.mock.calls[0][0];
    expect(enqueued.type).toBe('security_alert_webhook');
    expect(enqueued.payload.action).toBe('student.deleted');
  });

  test('no webhook is enqueued when ALERT_WEBHOOK_URL is unset (existing gating behavior, unchanged)', async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    const res = await supertest(buildApp()).delete('/api/students/purge').send({ ids: ['s1', 's2'] });
    expect(res.status).toBe(200);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  test('the single-record DELETE /:id path is unaffected — still its own one-entry-per-delete audit call', async () => {
    mockStudents.find.mockReturnValue(mockChain(STUDENTS_SEED));
    const findOneAndUpdate = jest.fn(() => mockChain({ id: 's1', firstName: 'Amara', lastName: 'Osei' }));
    mockStudents.findOneAndUpdate = findOneAndUpdate;
    const res = await supertest(buildApp()).delete('/api/students/s1');
    expect(res.status).toBe(200);
    expect(mockAuditLogCreate).toHaveBeenCalledTimes(1);
    expect(mockAuditLogCreate.mock.calls[0][0].target).toEqual(
      expect.objectContaining({ type: 'student', id: 's1' })
    );
  });
});
