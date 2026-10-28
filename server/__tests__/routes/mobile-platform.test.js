/* ============================================================
   Integration tests — /api/mobile (Phase 0b)

   The app's platform endpoints, deliberately separate from school data:

   - bootstrap is PUBLIC: a build that is too old must be able to learn that
     before it can authenticate, otherwise it has no way to explain itself.
   - the device registry is authenticated AND school-scoped: a leaked token
     string must not let anyone unsubscribe another school's parent.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_parent_001', schoolId: 'sch_riverside', role: 'parent' };
    next();
  },
}));

jest.mock('../../utils/push', () => ({
  registerDevice:   jest.fn().mockResolvedValue('dev_1'),
  unregisterDevice: jest.fn().mockResolvedValue(1),
  tokensForUsers:   jest.fn().mockResolvedValue([]),
  sendToTokens:     jest.fn().mockResolvedValue({ sent: 0, failed: 0, invalidTokens: [] }),
  sendToUsers:      jest.fn().mockResolvedValue({ sent: 0, failed: 0, invalidTokens: [] }),
}));

const express   = require('express');
const supertest = require('supertest');
const push      = require('../../utils/push');

function buildApp() {
  const router = require('../../routes/mobile');
  const app = express();
  app.use(express.json());
  app.use('/api/mobile', router);
  return app;
}

const DEVICE_TOKEN = 'fcm_token_abcdefghijklmnopqrstuvwxyz012345';

beforeEach(() => {
  jest.clearAllMocks();
  push.registerDevice.mockResolvedValue('dev_1');
  push.unregisterDevice.mockResolvedValue(1);
  delete process.env.MOBILE_MAINTENANCE;
  delete process.env.MOBILE_MAINTENANCE_MESSAGE;
  delete process.env.MOBILE_MIN_VERSION;
});

describe('GET /api/mobile/bootstrap', () => {
  test('answers without authentication and always carries a version + server time', async () => {
    const res = await supertest(buildApp()).get('/api/mobile/bootstrap');

    expect(res.status).toBe(200);
    expect(res.body.data.minSupportedVersion).toBe('1.0.0');
    expect(typeof res.body.data.serverTime).toBe('string');
    expect(res.body.data.maintenance.active).toBe(false);
  });

  test('a configured minimum version and maintenance window are reported verbatim', async () => {
    process.env.MOBILE_MIN_VERSION = '1.4.0';
    process.env.MOBILE_MAINTENANCE = '1';
    process.env.MOBILE_MAINTENANCE_MESSAGE = 'Back in 20 minutes.';

    const res = await supertest(buildApp()).get('/api/mobile/bootstrap');

    expect(res.body.data.minSupportedVersion).toBe('1.4.0');
    expect(res.body.data.maintenance).toEqual({ active: true, message: 'Back in 20 minutes.' });
  });
});

describe('POST /api/mobile/devices', () => {
  test('rejects a token too short to be an FCM registration', async () => {
    const res = await supertest(buildApp()).post('/api/mobile/devices').send({ token: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
    expect(push.registerDevice).not.toHaveBeenCalled();
  });

  test('registers the token against the caller and their school — never a body-supplied one', async () => {
    const res = await supertest(buildApp()).post('/api/mobile/devices').send({
      token: DEVICE_TOKEN, platform: 'android', appVersion: '1.0.3',
      userId: 'usr_someone_else', schoolId: 'sch_someone_else', // must be ignored
    });

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('dev_1');
    expect(push.registerDevice).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'usr_parent_001',
      schoolId: 'sch_riverside',
      token: DEVICE_TOKEN,
      platform: 'android',
      appVersion: '1.0.3',
    }));
  });
});

describe('DELETE /api/mobile/devices/:token', () => {
  test('removal is scoped to the caller’s own school', async () => {
    const res = await supertest(buildApp()).delete(`/api/mobile/devices/${DEVICE_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.data.removed).toBe(1);
    expect(push.unregisterDevice).toHaveBeenCalledWith({ schoolId: 'sch_riverside', token: DEVICE_TOKEN });
  });
});
