/* ============================================================
   server/routes/hr.js — payroll (Payroll Phase 1, Step 1: stabilize)

   Regression coverage for the gaps identified in
   docs/audits/HR_PAYROLL_ARCHITECTURAL_REVIEW.md §6/§10: payroll had
   zero audit logging, zero notification wiring, no currency field, and
   (separately, in indexes.js) no DB-level unique index backing its own
   upsert key. This file covers the first three; the index itself is
   verified by inspection, not a live-DB test (no MongoDB in this sandbox).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

function chain(result) {
  return { select: () => chain(result), lean: () => Promise.resolve(result) };
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  function matches(doc, filter) {
    return Object.entries(filter).every(([k, v]) => {
      if (k === '$or') return v.some(sub => matches(doc, sub));
      if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
      return doc[k] === v;
    });
  }
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    countDocuments: (filter) => Promise.resolve(docs.filter(d => matches(d, filter)).length),
    findOneAndUpdate: (filter, update, opts = {}) => ({
      lean: async () => {
        let doc = docs.find(d => matches(d, filter));
        if (!doc) {
          if (!opts.upsert) return null;
          doc = { ...filter }; docs.push(doc);
          if (update.$setOnInsert) Object.assign(doc, update.$setOnInsert);
        }
        if (update.$set) Object.assign(doc, update.$set);
        return { ...doc };
      },
    }),
    findOneAndDelete: (filter) => ({
      lean: async () => {
        const idx = docs.findIndex(d => matches(d, filter));
        if (idx === -1) return null;
        return docs.splice(idx, 1)[0];
      },
    }),
    create: async (doc) => { const d = { ...doc, toObject: () => d }; docs.push(d); return d; },
    _docs: () => docs,
  };
}

let mockStores;
let mockCurrentUser;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/model', () => ({ _model: jest.fn((col) => mockStores[col]) }));

const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

const mockDispatch = jest.fn().mockResolvedValue(undefined);
jest.mock('../../utils/notify-dispatch', () => ({ dispatchNotification: (...args) => mockDispatch(...args) }));

jest.mock('../../utils/email', () => ({ sendPayrollStatusEmail: jest.fn().mockResolvedValue(undefined) }));

const express   = require('express');
const supertest = require('supertest');
const hrRouter  = require('../../routes/hr');

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/hr', hrRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [], name: 'HR Person', email: 'hr@x.io' };
  mockStores = {
    payroll: makeStore(),
    schools: makeStore([{ id: SCHOOL, name: 'Test School', currency: 'KES', systemEmail: 'ops@test.school' }]),
    users: makeStore([
      { id: 'u_staff_1', schoolId: SCHOOL, name: 'Staff One', email: 'staff1@x.io', role: 'teacher', isActive: true },
    ]),
    memberships: makeStore(),
  };
});

describe('POST /api/hr/payroll — currency + audit', () => {
  test('stamps the school\'s currency onto a new record', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', staffName: 'Staff One', payPeriod: '2026-07',
      basicSalary: 50000, allowances: 5000, deductions: 3000,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.currency).toBe('KES');
    expect(res.body.data.grossSalary).toBe(55000);
    expect(res.body.data.netSalary).toBe(52000);
  });

  test('falls back to KES when the school has no currency set', async () => {
    mockStores.schools = makeStore([{ id: SCHOOL, name: 'Test School' }]);
    const app = buildApp();
    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });
    expect(res.body.data.currency).toBe('KES');
  });

  test('logs payroll.record_saved', async () => {
    const app = buildApp();
    await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'payroll.record_saved',
      schoolId: SCHOOL,
      details: expect.objectContaining({ staffId: 'u_staff_1', payPeriod: '2026-07' }),
    }));
  });

  test('an edit does NOT overwrite the currency stamped at creation', async () => {
    const app = buildApp();
    await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });
    mockStores.schools = makeStore([{ id: SCHOOL, name: 'Test School', currency: 'USD' }]);
    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 55000,
    });
    expect(res.body.data.currency).toBe('KES'); // unchanged despite school's currency now being USD
  });
});

describe('PATCH /api/hr/payroll/:id/status — audit + notification', () => {
  async function createRecord(app) {
    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000, allowances: 0, deductions: 5000,
    });
    return res.body.data.id;
  }

  test('confirming a record logs at warn severity (catalogue default) and notifies the staff member', async () => {
    const app = buildApp();
    const id = await createRecord(app);
    mockCurrentUser = { ...mockCurrentUser, role: 'admin' };

    const res = await supertest(app).patch(`/api/hr/payroll/${id}/status`).send({ status: 'confirmed' });
    expect(res.status).toBe(200);

    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'payroll.status_changed', schoolId: SCHOOL,
      details: expect.objectContaining({ status: 'confirmed' }),
    }));
    // No explicit severity override for 'confirmed' -> catalogue default applies
    expect(mockAuditLog.mock.calls[0][0].severity).toBeUndefined();

    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: 'payroll_status_changed',
      recipients: [expect.objectContaining({ userId: 'u_staff_1', email: 'staff1@x.io' })],
    }));
  });

  test('marking as paid logs at CRITICAL severity', async () => {
    const app = buildApp();
    const id = await createRecord(app);
    mockCurrentUser = { ...mockCurrentUser, role: 'admin' };

    await supertest(app).patch(`/api/hr/payroll/${id}/status`).send({ status: 'paid' });

    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'payroll.status_changed', severity: 'critical',
    }));
  });

  test('reverting to draft does NOT notify the staff member', async () => {
    const app = buildApp();
    const id = await createRecord(app);
    mockCurrentUser = { ...mockCurrentUser, role: 'admin' };
    await supertest(app).patch(`/api/hr/payroll/${id}/status`).send({ status: 'confirmed' });
    mockDispatch.mockClear();

    await supertest(app).patch(`/api/hr/payroll/${id}/status`).send({ status: 'draft' });
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  test('a notification failure does not block the status change itself', async () => {
    mockDispatch.mockRejectedValueOnce(new Error('smtp down'));
    const app = buildApp();
    const id = await createRecord(app);
    mockCurrentUser = { ...mockCurrentUser, role: 'admin' };

    const res = await supertest(app).patch(`/api/hr/payroll/${id}/status`).send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('confirmed');
  });
});

describe('DELETE /api/hr/payroll/:id — audit severity by status', () => {
  test('deleting a draft record logs without severity override', async () => {
    const app = buildApp();
    const createRes = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });
    const id = createRes.body.data.id;

    const res = await supertest(app).delete(`/api/hr/payroll/${id}`);
    expect(res.status).toBe(200);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'payroll.deleted' }));
    expect(mockAuditLog.mock.calls[0][0].severity).toBeUndefined();
  });

  test('deleting a CONFIRMED record (as admin) logs at critical severity', async () => {
    const app = buildApp();
    const createRes = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });
    const id = createRes.body.data.id;

    mockCurrentUser = { ...mockCurrentUser, role: 'admin' };
    await supertest(app).patch(`/api/hr/payroll/${id}/status`).send({ status: 'confirmed' });
    mockAuditLog.mockClear();

    const res = await supertest(app).delete(`/api/hr/payroll/${id}`);
    expect(res.status).toBe(200);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'payroll.deleted', severity: 'critical' }));
  });
});

describe('POST /api/hr/payroll/copy — audit + currency carry-forward', () => {
  test('copies currency from the source record and logs payroll.copied', async () => {
    const app = buildApp();
    await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });

    const res = await supertest(app).post('/api/hr/payroll/copy').send({
      sourcePeriod: '2026-07', targetPeriod: '2026-08',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.copied).toBe(1);

    const copied = mockStores.payroll._docs().find(d => d.payPeriod === '2026-08');
    expect(copied.currency).toBe('KES');

    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'payroll.copied',
      details: expect.objectContaining({ sourcePeriod: '2026-07', targetPeriod: '2026-08', copied: 1 }),
    }));
  });
});
