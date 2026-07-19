/* ============================================================
   Unit tests — server/middleware/plan.js's planGate()

   First direct test coverage for this middleware (every existing
   route test file that touches planGate stubs the whole module and
   never exercises its real internals). Written for ADR-0004 (C10,
   Entitlement Activation): pins the additive-only dual-read design —
   entitlements are only ever consulted when the school's plan tier
   alone would deny a feature, never when plan already grants it, and
   an entitlement-lookup failure must resolve to the same 403 the
   route would have returned before this ADR, never a 500.
   ============================================================ */

jest.mock('../utils/model', () => ({
  _model: jest.fn(),
}));
jest.mock('../utils/entitlements', () => ({
  hasEntitlement: jest.fn(),
}));

const { _model }        = require('../utils/model');
const { hasEntitlement } = require('../utils/entitlements');
const { planGate, invalidatePlanCache } = require('../middleware/plan');

function mockSchoolsPlan(plan) {
  const lean    = jest.fn().mockResolvedValue(plan === null ? null : { plan });
  const findOne = jest.fn().mockReturnValue({ lean });
  _model.mockReturnValue({ findOne });
  return findOne;
}

function mockReq(schoolId) {
  return { jwtUser: schoolId ? { schoolId } : null };
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

describe('planGate — plan-grants fast path', () => {
  test('plan tier alone grants the feature: next() is called and hasEntitlement is never invoked', async () => {
    mockSchoolsPlan('core'); // 'students' requires only 'core'
    const req = mockReq('sch_grants_001');
    const res = mockRes();
    const next = jest.fn();

    await planGate('students')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(hasEntitlement).not.toHaveBeenCalled();
  });

  test('a higher plan tier than required also short-circuits before any entitlement lookup', async () => {
    mockSchoolsPlan('enterprise');
    const req = mockReq('sch_grants_002');
    const res = mockRes();
    const next = jest.fn();

    await planGate('finance')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(hasEntitlement).not.toHaveBeenCalled();
  });
});

describe('planGate — plan-denies path, entitlement as additive override', () => {
  test('plan denies and no entitlement exists: 403, same shape as before this ADR', async () => {
    mockSchoolsPlan('core'); // 'parent_portal' requires 'premium'
    hasEntitlement.mockResolvedValue(false);
    const req = mockReq('sch_deny_001');
    const res = mockRes();
    const next = jest.fn();

    await planGate('parent_portal')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(hasEntitlement).toHaveBeenCalledWith('sch_deny_001', 'parent_portal');
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({
        code: 'PLAN_UPGRADE_REQUIRED',
        currentPlan: 'core',
        requiredPlan: 'premium',
      }),
    }));
  });

  test('plan denies but an active entitlement overrides it: next() is called', async () => {
    mockSchoolsPlan('core');
    hasEntitlement.mockResolvedValue(true);
    const req = mockReq('sch_deny_002');
    const res = mockRes();
    const next = jest.fn();

    await planGate('parent_portal')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('plan denies and the entitlement lookup throws: resolves to 403, never a 500 (ADR-0004 Decision 2)', async () => {
    mockSchoolsPlan('core');
    hasEntitlement.mockRejectedValue(new Error('transient DB error'));
    const req = mockReq('sch_deny_003');
    const res = mockRes();
    const next = jest.fn();

    await planGate('parent_portal')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'PLAN_UPGRADE_REQUIRED' }),
    }));
  });
});

describe('planGate — unknown feature key stays fail-closed, unchanged', () => {
  test('an unregistered feature key 403s before any plan lookup or entitlement lookup', async () => {
    const req = mockReq('sch_unknown_001');
    const res = mockRes();
    const next = jest.fn();

    await planGate('totally_made_up_feature')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'PLAN_UPGRADE_REQUIRED' }),
    }));
    expect(_model).not.toHaveBeenCalled();
    expect(hasEntitlement).not.toHaveBeenCalled();
  });
});

describe('planGate — authentication guard', () => {
  test('missing schoolId on req.jwtUser: 401, no plan or entitlement lookup', async () => {
    const req = mockReq(null);
    const res = mockRes();
    const next = jest.fn();

    await planGate('students')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(_model).not.toHaveBeenCalled();
    expect(hasEntitlement).not.toHaveBeenCalled();
  });
});

describe('planGate — plan cache (pre-existing behavior, pinned for the first time)', () => {
  test('two calls for the same school within the TTL only fetch the plan once', async () => {
    const schoolId = 'sch_cache_001';
    invalidatePlanCache(schoolId); // isolate from any other test's cache entry
    const findOne = mockSchoolsPlan('core');

    await planGate('students')(mockReq(schoolId), mockRes(), jest.fn());
    await planGate('students')(mockReq(schoolId), mockRes(), jest.fn());

    expect(findOne).toHaveBeenCalledTimes(1);
  });
});
