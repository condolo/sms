/* ============================================================
   Subscription expiry enforcement (ENFORCE_PLAN_EXPIRY=true).

   Effective expiry = planExpiresAt || trialEnds. Past expiry + grace
   (default 7 days) the school is treated as the base tier: all ERP
   features keep working, student/parent portals close. The billed plan
   is never mutated — expiry is an access decision, not a billing one.
   ============================================================ */
'use strict';

process.env.ENFORCE_PLAN_EXPIRY = 'true';
process.env.PLAN_GRACE_DAYS = '7';

jest.mock('../utils/model', () => ({ _model: jest.fn() }));
jest.mock('../utils/entitlements', () => ({ hasEntitlement: jest.fn() }));

const { _model } = require('../utils/model');
const { hasEntitlement } = require('../utils/entitlements');
const { planGate, getPlanState, invalidatePlanCache } = require('../middleware/plan');

const DAY = 86400000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * DAY).toISOString();

function mockSchool(doc) {
  const lean = jest.fn().mockResolvedValue(doc && { ...doc });
  _model.mockReturnValue({ findOne: jest.fn().mockReturnValue({ lean }) });
}

function mockReq(schoolId, role = 'admin') { return { jwtUser: { schoolId, role } }; }
function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  invalidatePlanCache();
});

describe('getPlanState — expiry resolution', () => {
  test('paid expiry past the grace period → restricted, effective plan is base', async () => {
    mockSchool({ plan: 'family', planExpiresAt: daysAgo(10) });
    const state = await getPlanState('sch_exp_001');
    expect(state.restricted).toBe(true);
    expect(state.effectivePlan).toBe('core');
    expect(state.pastExpiry).toBe(true);
    expect(state.plan).toBe('family');
  });

  test('inside the grace period → not restricted', async () => {
    mockSchool({ plan: 'family', planExpiresAt: daysAgo(2) });
    const state = await getPlanState('sch_exp_002');
    expect(state.restricted).toBe(false);
    expect(state.effectivePlan).toBe('family');
    expect(state.pastExpiry).toBe(true);
  });

  test('an explicit null planExpiresAt does NOT fall back to an old trialEnds', async () => {
    mockSchool({ plan: 'enterprise', planExpiresAt: null, trialEnds: daysAgo(400) });
    const state = await getPlanState('sch_exp_003');
    expect(state.restricted).toBe(false);
    expect(state.expiresAt).toBeNull();
  });

  test('schools with no planExpiresAt at all fall back to trialEnds', async () => {
    mockSchool({ plan: 'enterprise', trialEnds: daysAgo(30) });
    const state = await getPlanState('sch_exp_004');
    expect(state.expiresAt).toBeTruthy();
    expect(state.restricted).toBe(true);
  });
});

describe('planGate — tier boundaries under expiry', () => {
  test('expired family school loses the parent portal with PLAN_EXPIRED', async () => {
    mockSchool({ plan: 'family', planExpiresAt: daysAgo(30) });
    hasEntitlement.mockResolvedValue(false);
    const res = mockRes();
    const next = jest.fn();

    await planGate('parent_portal')(mockReq('sch_exp_010'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.objectContaining({ code: 'PLAN_EXPIRED', currentPlan: 'family' }),
    }));
  });

  test('expired school keeps every core ERP feature', async () => {
    mockSchool({ plan: 'family', planExpiresAt: daysAgo(30) });
    const res = mockRes();
    const next = jest.fn();

    await planGate('students')(mockReq('sch_exp_011'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('inside grace, the same family school still has the parent portal', async () => {
    mockSchool({ plan: 'family', planExpiresAt: daysAgo(3) });
    const res = mockRes();
    const next = jest.fn();

    await planGate('parent_portal')(mockReq('sch_exp_012'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('an explicit entitlement still overrides expiry (sales grant)', async () => {
    mockSchool({ plan: 'family', planExpiresAt: daysAgo(30) });
    hasEntitlement.mockResolvedValue(true);
    const res = mockRes();
    const next = jest.fn();

    await planGate('parent_portal')(mockReq('sch_exp_013'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('a non-expired school is unaffected', async () => {
    mockSchool({ plan: 'family', planExpiresAt: daysAhead(30) });
    const res = mockRes();
    const next = jest.fn();

    await planGate('parent_portal')(mockReq('sch_exp_014'), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('planGate — portal denial wording', () => {
  test('a parent is never told the school is behind on billing', async () => {
    mockSchool({ plan: 'family', planExpiresAt: daysAgo(30) });
    hasEntitlement.mockResolvedValue(false);
    const res = mockRes();
    const next = jest.fn();

    await planGate('parent_portal')(mockReq('sch_exp_020', 'parent'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error.code).toBe('ACCOUNT_UNAVAILABLE');
    expect(payload.error.message).toBe('Unable to access this account. Please contact your school administrator.');
    expect(payload.error).not.toHaveProperty('expiresAt');
    expect(JSON.stringify(payload)).not.toMatch(/subscription|expired|billing|plan/i);
  });

  test('a student gets the same neutral message', async () => {
    mockSchool({ plan: 'family', planExpiresAt: daysAgo(30) });
    hasEntitlement.mockResolvedValue(false);
    const res = mockRes();
    const next = jest.fn();

    await planGate('student_portal')(mockReq('sch_exp_021', 'student'), res, next);

    expect(res.json.mock.calls[0][0].error.code).toBe('ACCOUNT_UNAVAILABLE');
    expect(JSON.stringify(res.json.mock.calls[0][0])).not.toMatch(/subscription|expired|billing|plan/i);
  });

  test('staff still see the actionable PLAN_EXPIRED reason', async () => {
    mockSchool({ plan: 'family', planExpiresAt: daysAgo(30) });
    hasEntitlement.mockResolvedValue(false);
    const res = mockRes();
    const next = jest.fn();

    await planGate('parent_portal')(mockReq('sch_exp_022', 'admin'), res, next);

    expect(res.json.mock.calls[0][0].error.code).toBe('PLAN_EXPIRED');
    expect(res.json.mock.calls[0][0].error.expiresAt).toBeTruthy();
  });
});
