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
  return {
    select: () => chain(result),
    sort:   (spec) => chain(Array.isArray(result) ? _sortDocs(result, spec) : result),
    limit:  (n)    => chain(Array.isArray(result) ? result.slice(0, n) : result),
    lean:   () => Promise.resolve(result),
  };
}
function _sortDocs(docs, spec) {
  const [[field, dir]] = Object.entries(spec);
  return [...docs].sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * dir);
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
    payroll_config: makeStore(),
    workflow_configs: makeStore(),
    custom_roles: makeStore(),
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

describe('POST /api/hr/payroll — Kenya statutory integration (Payroll Phase 1, Step 2/3)', () => {
  test('a school with country=KE gets statutory deductions computed automatically', async () => {
    mockStores.schools = makeStore([{ id: SCHOOL, name: 'Test School', currency: 'KES', country: 'KE' }]);
    const app = buildApp();
    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 100000, allowances: 0, deductions: 0,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.statutoryDeductions).not.toBeNull();
    expect(res.body.data.statutoryDeductions.country).toBe('KE');
    expect(res.body.data.totalDeductions).toBeCloseTo(res.body.data.statutoryDeductions.total, 2);
    expect(res.body.data.netSalary).toBeCloseTo(100000 - res.body.data.statutoryDeductions.total, 2);
  });

  test('a school with no country gets no statutory deductions (unchanged legacy behavior)', async () => {
    const app = buildApp(); // default mock school has no country
    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 100000, deductions: 5000,
    });
    expect(res.body.data.statutoryDeductions).toBeNull();
    expect(res.body.data.netSalary).toBe(95000);
  });

  test('applyStatutory:false opts a record out even for a KE school', async () => {
    mockStores.schools = makeStore([{ id: SCHOOL, name: 'Test School', currency: 'KES', country: 'KE' }]);
    const app = buildApp();
    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 100000, applyStatutory: false,
    });
    expect(res.body.data.statutoryDeductions).toBeNull();
    expect(res.body.data.netSalary).toBe(100000);
  });

  test('POST /payroll/copy recomputes statutory for the target period, not a verbatim copy', async () => {
    mockStores.schools = makeStore([{ id: SCHOOL, name: 'Test School', currency: 'KES', country: 'KE' }]);
    const app = buildApp();
    await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 100000,
    });

    const res = await supertest(app).post('/api/hr/payroll/copy').send({
      sourcePeriod: '2026-07', targetPeriod: '2026-08',
    });
    expect(res.status).toBe(200);
    const copied = mockStores.payroll._docs().find(d => d.payPeriod === '2026-08');
    expect(copied.statutoryDeductions).not.toBeNull();
    expect(copied.statutoryDeductions.country).toBe('KE');
  });
});

describe('GET/PUT /api/hr/payroll-config — school policy (Payroll Phase 1, Step 4)', () => {
  test('GET returns defaults when nothing is configured yet', async () => {
    const app = buildApp();
    const res = await supertest(app).get('/api/hr/payroll-config');
    expect(res.status).toBe(200);
    expect(res.body.data.allowanceTypes.map(t => t.key)).toContain('housing');
    expect(res.body.data.deductionTypes.map(t => t.key)).toContain('loan');
    expect(res.body.data.defaultApplyStatutory).toBe(true);
  });

  test('PUT saves a custom catalogue and GET reflects it', async () => {
    const app = buildApp();
    const putRes = await supertest(app).put('/api/hr/payroll-config').send({
      allowanceTypes: [{ key: 'lunch', label: 'Lunch Allowance' }],
      defaultApplyStatutory: false,
    });
    expect(putRes.status).toBe(200);
    expect(putRes.body.data.allowanceTypes).toEqual([{ key: 'lunch', label: 'Lunch Allowance' }]);

    const getRes = await supertest(app).get('/api/hr/payroll-config');
    expect(getRes.body.data.allowanceTypes).toEqual([{ key: 'lunch', label: 'Lunch Allowance' }]);
    expect(getRes.body.data.defaultApplyStatutory).toBe(false);
  });

  test('rejects duplicate keys within one catalogue', async () => {
    const app = buildApp();
    const res = await supertest(app).put('/api/hr/payroll-config').send({
      allowanceTypes: [{ key: 'lunch', label: 'A' }, { key: 'lunch', label: 'B' }],
    });
    expect(res.status).toBe(400);
  });

  test('a school\'s defaultApplyStatutory:false becomes the default for new records with no explicit applyStatutory', async () => {
    mockStores.schools = makeStore([{ id: SCHOOL, name: 'Test School', currency: 'KES', country: 'KE' }]);
    const app = buildApp();
    await supertest(app).put('/api/hr/payroll-config').send({ defaultApplyStatutory: false });

    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 100000,
    });
    expect(res.body.data.statutoryDeductions).toBeNull();
    expect(res.body.data.applyStatutory).toBe(false);
  });
});

describe('POST /api/hr/payroll — itemized allowances/deductions (Payroll Phase 1, Step 4)', () => {
  test('itemized allowances sum into the flat total and are validated against the catalogue', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
      allowanceItems: [{ type: 'housing', amount: 10000 }, { type: 'transport', amount: 5000 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.allowances).toBe(15000);
    expect(res.body.data.grossSalary).toBe(65000);
    expect(res.body.data.allowanceItems).toEqual([{ type: 'housing', amount: 10000 }, { type: 'transport', amount: 5000 }]);
  });

  test('an unknown allowance type is rejected with 400', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
      allowanceItems: [{ type: 'not_a_real_type', amount: 1000 }],
    });
    expect(res.status).toBe(400);
  });

  test('itemized deductions sum into the flat total and are validated', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
      deductionItems: [{ type: 'loan', amount: 2000 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.deductions).toBe(2000);
    expect(res.body.data.netSalary).toBe(48000);
  });

  test('a custom school-defined type is accepted once configured', async () => {
    const app = buildApp();
    await supertest(app).put('/api/hr/payroll-config').send({
      allowanceTypes: [{ key: 'lunch', label: 'Lunch Allowance' }],
    });
    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
      allowanceItems: [{ type: 'lunch', amount: 3000 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.allowances).toBe(3000);
  });
});

describe('POST /api/hr/payroll — basicSalary defaulting from history (Payroll Phase 1, Step 5)', () => {
  test('400s when basicSalary is omitted and this is the staff member\'s first-ever record', async () => {
    const app = buildApp();
    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07',
    });
    expect(res.status).toBe(400);
  });

  test('a later period defaults basicSalary from the most recent prior record', async () => {
    const app = buildApp();
    await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 60000,
    });

    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-08',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.basicSalary).toBe(60000);
  });

  test('an explicit basicSalary always overrides the historical default', async () => {
    const app = buildApp();
    await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 60000,
    });

    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-08', basicSalary: 65000,
    });
    expect(res.body.data.basicSalary).toBe(65000);
  });

  test('defaulting picks the MOST RECENT period, not the first one', async () => {
    const app = buildApp();
    await supertest(app).post('/api/hr/payroll').send({ staffId: 'u_staff_1', payPeriod: '2026-06', basicSalary: 50000 });
    await supertest(app).post('/api/hr/payroll').send({ staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 60000 });

    const res = await supertest(app).post('/api/hr/payroll').send({ staffId: 'u_staff_1', payPeriod: '2026-08' });
    expect(res.body.data.basicSalary).toBe(60000);
  });
});

describe('Payroll locking — editing a confirmed/paid record (Payroll Phase 1, Step 6)', () => {
  async function createAndConfirm(app) {
    const createRes = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });
    const id = createRes.body.data.id;
    mockCurrentUser = { ...mockCurrentUser, role: 'admin' };
    await supertest(app).patch(`/api/hr/payroll/${id}/status`).send({ status: 'confirmed' });
    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [], name: 'HR Person', email: 'hr@x.io' };
    return id;
  }

  test('a non-admin cannot edit a confirmed record', async () => {
    const app = buildApp();
    await createAndConfirm(app);

    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 55000,
    });
    expect(res.status).toBe(403);
  });

  test('an admin CAN edit a confirmed record, and it reverts to draft', async () => {
    const app = buildApp();
    await createAndConfirm(app);
    mockCurrentUser = { ...mockCurrentUser, role: 'admin' };

    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 55000,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.basicSalary).toBe(55000);
  });

  test('editing a still-draft record needs no special permission', async () => {
    const app = buildApp();
    await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });
    const res = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 51000,
    });
    expect(res.status).toBe(200);
  });
});

describe('Payroll approval chain (Payroll Phase 1, Step 6, reusing workflow-config.js)', () => {
  test('with no chain configured, PATCH /status confirms directly — unchanged legacy behavior', async () => {
    const app = buildApp();
    const createRes = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });
    const res = await supertest(app).patch(`/api/hr/payroll/${createRes.body.data.id}/status`).send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('confirmed');
  });

  test('with a chain configured, PATCH /status confirmed is blocked until the chain clears', async () => {
    const app = buildApp();
    mockStores.workflow_configs = makeStore([{
      schoolId: SCHOOL, workflowKey: 'payroll_approval',
      steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'principal' }],
    }]);
    mockStores.users = makeStore([
      ...mockStores.users._docs(),
      { id: 'u_principal', schoolId: SCHOOL, name: 'The Principal', role: 'principal', isActive: true },
    ]);

    const createRes = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });
    const id = createRes.body.data.id;
    expect(createRes.body.data.currentStepOrder).toBe(1);

    const res = await supertest(app).patch(`/api/hr/payroll/${id}/status`).send({ status: 'confirmed' });
    expect(res.status).toBe(400);
  });

  test('full chain: principal approves via /advance, then confirm succeeds', async () => {
    const app = buildApp();
    mockStores.workflow_configs = makeStore([{
      schoolId: SCHOOL, workflowKey: 'payroll_approval',
      steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'principal' }],
    }]);
    mockStores.users = makeStore([
      ...mockStores.users._docs(),
      { id: 'u_principal', schoolId: SCHOOL, name: 'The Principal', role: 'principal', isActive: true },
    ]);

    const createRes = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });
    const id = createRes.body.data.id;

    mockCurrentUser = { userId: 'u_principal', schoolId: SCHOOL, role: 'principal', roles: [], name: 'The Principal', email: 'p@x.io' };
    const advanceRes = await supertest(app).patch(`/api/hr/payroll/${id}/advance`).send({ status: 'approved' });
    expect(advanceRes.status).toBe(200);
    expect(advanceRes.body.data.currentStepOrder).toBe(2);

    mockCurrentUser = { userId: 'u_hr', schoolId: SCHOOL, role: 'hr', roles: [], name: 'HR Person', email: 'hr@x.io' };
    const confirmRes = await supertest(app).patch(`/api/hr/payroll/${id}/status`).send({ status: 'confirmed' });
    expect(confirmRes.status).toBe(200);
    expect(confirmRes.body.data.status).toBe('confirmed');
  });

  test('an ineligible user cannot advance the chain step', async () => {
    const app = buildApp();
    mockStores.workflow_configs = makeStore([{
      schoolId: SCHOOL, workflowKey: 'payroll_approval',
      steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'principal' }],
    }]);
    const createRes = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });
    const res = await supertest(app).patch(`/api/hr/payroll/${createRes.body.data.id}/advance`).send({ status: 'approved' });
    expect(res.status).toBe(403);
  });

  test('rejecting at a chain step sends it back to draft, restarting at step 1', async () => {
    const app = buildApp();
    mockStores.workflow_configs = makeStore([{
      schoolId: SCHOOL, workflowKey: 'payroll_approval',
      steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'principal' }],
    }]);
    mockStores.users = makeStore([
      ...mockStores.users._docs(),
      { id: 'u_principal', schoolId: SCHOOL, name: 'The Principal', role: 'principal', isActive: true },
    ]);
    const createRes = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });
    const id = createRes.body.data.id;

    mockCurrentUser = { userId: 'u_principal', schoolId: SCHOOL, role: 'principal', roles: [], name: 'The Principal', email: 'p@x.io' };
    const res = await supertest(app).patch(`/api/hr/payroll/${id}/advance`).send({ status: 'rejected', notes: 'wrong numbers' });
    expect(res.status).toBe(200);
    expect(res.body.data.currentStepOrder).toBe(1);
  });

  test('rejecting requires a reason', async () => {
    const app = buildApp();
    mockStores.workflow_configs = makeStore([{
      schoolId: SCHOOL, workflowKey: 'payroll_approval',
      steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'principal' }],
    }]);
    mockStores.users = makeStore([
      ...mockStores.users._docs(),
      { id: 'u_principal', schoolId: SCHOOL, name: 'The Principal', role: 'principal', isActive: true },
    ]);
    const createRes = await supertest(app).post('/api/hr/payroll').send({
      staffId: 'u_staff_1', payPeriod: '2026-07', basicSalary: 50000,
    });
    mockCurrentUser = { userId: 'u_principal', schoolId: SCHOOL, role: 'principal', roles: [], name: 'The Principal', email: 'p@x.io' };
    const res = await supertest(app).patch(`/api/hr/payroll/${createRes.body.data.id}/advance`).send({ status: 'rejected' });
    expect(res.status).toBe(400);
  });
});

describe('GET/PUT /api/hr/payroll/workflow-config', () => {
  test('GET returns empty steps when nothing configured', async () => {
    const app = buildApp();
    const res = await supertest(app).get('/api/hr/payroll/workflow-config');
    expect(res.status).toBe(200);
    expect(res.body.data.steps).toEqual([]);
  });

  test('PUT saves a chain (1-step floor, unlike leave\'s 2-step floor)', async () => {
    const app = buildApp();
    const res = await supertest(app).put('/api/hr/payroll/workflow-config').send({
      steps: [{ order: 1, assigneeType: 'role', assigneeValue: 'principal' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.steps).toHaveLength(1);
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
