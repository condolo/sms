/* ============================================================
   Unit tests — server/middleware/module-gate.js's moduleGate()

   A school admin can disable a whole module from Settings → Modules
   (school.moduleConfig). Before this middleware existed, that only
   hid the Sidebar nav link — the API itself still answered every
   request for a "disabled" module. This pins the real enforcement:
   a disabled module 403s regardless of the caller's role/permissions,
   while an absent/enabled entry (the default for any school that
   never touched the Modules tab) is unaffected.
   ============================================================ */

jest.mock('../utils/model', () => ({
  _model: jest.fn(),
}));

const { _model } = require('../utils/model');
const { moduleGate, invalidateModuleConfigCache } = require('../middleware/module-gate');

function mockSchoolModuleConfig(moduleConfig) {
  const lean    = jest.fn().mockResolvedValue(moduleConfig === null ? null : { moduleConfig });
  const select  = jest.fn().mockReturnValue({ lean });
  const findOne = jest.fn().mockReturnValue({ select });
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

describe('moduleGate — disabled module', () => {
  test('an explicitly disabled module 403s with MODULE_DISABLED', async () => {
    const schoolId = 'sch_disabled_001';
    invalidateModuleConfigCache(schoolId);
    mockSchoolModuleConfig([{ key: 'hostel', enabled: false, order: 0 }]);
    const req = mockReq(schoolId);
    const res = mockRes();
    const next = jest.fn();

    await moduleGate('hostel')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      error: expect.objectContaining({ code: 'MODULE_DISABLED' }),
    }));
  });
});

describe('moduleGate — enabled / absent module (default posture)', () => {
  test('an explicitly enabled module calls next()', async () => {
    const schoolId = 'sch_enabled_001';
    invalidateModuleConfigCache(schoolId);
    mockSchoolModuleConfig([{ key: 'library', enabled: true, order: 0 }]);
    const req = mockReq(schoolId);
    const res = mockRes();
    const next = jest.fn();

    await moduleGate('library')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('a module with no entry in moduleConfig defaults to enabled (fail-open on absence)', async () => {
    const schoolId = 'sch_absent_001';
    invalidateModuleConfigCache(schoolId);
    mockSchoolModuleConfig([{ key: 'library', enabled: false, order: 0 }]); // 'transport' not listed at all
    const req = mockReq(schoolId);
    const res = mockRes();
    const next = jest.fn();

    await moduleGate('transport')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('a school that never set moduleConfig at all (null) defaults every module to enabled', async () => {
    const schoolId = 'sch_never_configured_001';
    invalidateModuleConfigCache(schoolId);
    mockSchoolModuleConfig(null);
    const req = mockReq(schoolId);
    const res = mockRes();
    const next = jest.fn();

    await moduleGate('behaviour')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('moduleGate — failure posture', () => {
  test('missing schoolId on req.jwtUser: 401, no DB lookup', async () => {
    const req = mockReq(null);
    const res = mockRes();
    const next = jest.fn();

    await moduleGate('library')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(_model).not.toHaveBeenCalled();
  });

  test('a DB lookup failure fails OPEN (next is called), never a 500 — matches planGate\'s posture of never introducing a new failure mode', async () => {
    const schoolId = 'sch_lookup_fails_001';
    invalidateModuleConfigCache(schoolId);
    const findOne = jest.fn().mockImplementation(() => { throw new Error('transient DB error'); });
    _model.mockReturnValue({ findOne });
    const req = mockReq(schoolId);
    const res = mockRes();
    const next = jest.fn();

    await moduleGate('library')(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('moduleGate — config cache', () => {
  test('two calls for the same school within the TTL only fetch moduleConfig once', async () => {
    const schoolId = 'sch_cache_001';
    invalidateModuleConfigCache(schoolId);
    const findOne = mockSchoolModuleConfig([{ key: 'library', enabled: true, order: 0 }]);

    await moduleGate('library')(mockReq(schoolId), mockRes(), jest.fn());
    await moduleGate('library')(mockReq(schoolId), mockRes(), jest.fn());

    expect(findOne).toHaveBeenCalledTimes(1);
  });

  test('invalidateModuleConfigCache forces the next call to re-fetch', async () => {
    const schoolId = 'sch_cache_002';
    invalidateModuleConfigCache(schoolId);
    const findOne = mockSchoolModuleConfig([{ key: 'library', enabled: true, order: 0 }]);

    await moduleGate('library')(mockReq(schoolId), mockRes(), jest.fn());
    invalidateModuleConfigCache(schoolId);
    await moduleGate('library')(mockReq(schoolId), mockRes(), jest.fn());

    expect(findOne).toHaveBeenCalledTimes(2);
  });
});
