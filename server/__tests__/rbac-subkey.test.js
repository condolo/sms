/* ============================================================
   Unit tests — server/middleware/rbac.js's subKey support

   First direct test coverage for rbac()'s core logic (every existing
   route test file stubs the whole module). Written for the "Settings
   is the real control panel" fix: a module-level grant (e.g. hr:read)
   used to be the ONLY granularity available, so checking "View Leave
   Requests" in Roles & Permissions silently also granted "View
   Payroll" — both derived from the same hr:read bucket. This pins the
   new behavior: an explicit sub-level grant (permissions.hr__leave_view)
   is checked INSTEAD of the module-level grant when a route opts in via
   rbac(mod, action, subKey); with no sub-level grant present (the
   default for every school that hasn't customized that specific row),
   it falls back to the exact module-level check every existing
   rbac(mod, action) call site already relies on.
   ============================================================ */

jest.mock('../utils/model', () => ({
  _model: jest.fn(),
}));

const { _model } = require('../utils/model');
const { rbac, invalidatePermCache } = require('../middleware/rbac');

function mockRolePerms(permissions) {
  const lean    = jest.fn().mockResolvedValue({ permissions });
  const findOne = jest.fn().mockReturnValue({ lean });
  _model.mockImplementation((collection) => {
    if (collection === 'role_permissions') return { findOne };
    return { findOne: jest.fn().mockReturnValue({ lean: () => Promise.resolve(null) }) };
  });
  return findOne;
}

function mockReq(schoolId, role) {
  return { jwtUser: { schoolId, role, roles: [] } };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('rbac — no subKey passed (every pre-existing call site)', () => {
  test('module-level grant works exactly as before', async () => {
    const schoolId = 'sch_no_sub_001';
    invalidatePermCache(schoolId);
    mockRolePerms({ hr: ['read', 'update'] });
    const req = mockReq(schoolId, 'hr');
    const res = mockRes();
    const next = jest.fn();

    await rbac('hr', 'read')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('module-level denial works exactly as before', async () => {
    const schoolId = 'sch_no_sub_002';
    invalidatePermCache(schoolId);
    mockRolePerms({ hr: [] });
    const req = mockReq(schoolId, 'teacher');
    const res = mockRes();
    const next = jest.fn();

    await rbac('hr', 'read')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('rbac — subKey passed, no explicit sub-grant exists (default posture)', () => {
  test('falls back to the module-level grant — a role with plain hr:read passes a sub-gated check', async () => {
    const schoolId = 'sch_fallback_001';
    invalidatePermCache(schoolId);
    // No 'hr__payroll_view' key at all — school never customized this row
    mockRolePerms({ hr: ['read'] });
    const req = mockReq(schoolId, 'hr');
    const res = mockRes();
    const next = jest.fn();

    await rbac('hr', 'read', 'payroll_view')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('falls back to the module-level DENIAL too — no free pass just because a subKey was requested', async () => {
    const schoolId = 'sch_fallback_002';
    invalidatePermCache(schoolId);
    mockRolePerms({ hr: [] });
    const req = mockReq(schoolId, 'teacher');
    const res = mockRes();
    const next = jest.fn();

    await rbac('hr', 'read', 'payroll_view')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('rbac — subKey passed AND an explicit sub-grant exists (the actual fix)', () => {
  test('granting only "leave_view" does NOT also grant "payroll_view" — the reported bug is fixed', async () => {
    const schoolId = 'sch_split_001';
    invalidatePermCache(schoolId);
    mockRolePerms({
      hr: ['read'], // coarse module-level union still present (e.g. from other subs)
      hr__leave_view: ['read'],
      hr__payroll_view: [], // explicitly NOT granted for this role
    });
    const req = mockReq(schoolId, 'some_custom_role');
    const res = mockRes();

    const leaveNext = jest.fn();
    await rbac('hr', 'read', 'leave_view')(req, res, leaveNext);
    expect(leaveNext).toHaveBeenCalledTimes(1);

    const payrollRes = mockRes();
    const payrollNext = jest.fn();
    await rbac('hr', 'read', 'payroll_view')(req, payrollRes, payrollNext);
    expect(payrollNext).not.toHaveBeenCalled();
    expect(payrollRes.status).toHaveBeenCalledWith(403);
  });

  test('a sub-grant for one action does not imply a different action on that same sub', async () => {
    const schoolId = 'sch_split_002';
    invalidatePermCache(schoolId);
    mockRolePerms({ hr: ['read', 'update'], hr__documents: ['read'] }); // view only, not create/delete
    const req = mockReq(schoolId, 'some_custom_role');

    const readNext = jest.fn();
    await rbac('hr', 'read', 'documents')(req, mockRes(), readNext);
    expect(readNext).toHaveBeenCalledTimes(1);

    const createRes = mockRes();
    const createNext = jest.fn();
    await rbac('hr', 'create', 'documents')(req, createRes, createNext);
    expect(createNext).not.toHaveBeenCalled();
    expect(createRes.status).toHaveBeenCalledWith(403);
  });
});

describe('rbac — superadmin bypass is unaffected by subKey', () => {
  test('superadmin passes regardless of subKey, without even loading permissions', async () => {
    const req = { jwtUser: { schoolId: 'sch_super_001', role: 'superadmin', roles: [] } };
    const res = mockRes();
    const next = jest.fn();

    await rbac('hr', 'read', 'payroll_view')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(_model).not.toHaveBeenCalled();
  });
});
