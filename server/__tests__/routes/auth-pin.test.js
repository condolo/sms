/* ============================================================
   server/routes/pin.js — the app-lock PIN on the account

   What these pin, because each is a decision that is easy to lose:

   - A WRONG PIN IS 400, NOT 401. The app's HTTP client signs the user
     out on any 401; answering 401 here would eject a parent from the
     app for mistyping their lock code.
   - FIVE WRONG ATTEMPTS LOCK THE PIN FOR 15 MINUTES, server-side. The
     space is 10,000 values; without the lock a stolen session could
     walk it in minutes.
   - CHANGING OR REMOVING REQUIRES THE CURRENT PIN. Turning the lock
     off is exactly what a handed-over phone would try first.
   - THE HASH IS BCRYPT. The document never holds the PIN itself.
   - EVERY QUERY IS TENANT-SCOPED to the session's school.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const bcrypt = require('bcryptjs');

let mockUserDoc = null;

function _applyUpdate(doc, update) {
  if (!doc) return;
  if (update.$set) for (const [k, v] of Object.entries(update.$set)) doc[k] = v;
  if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
}

const mockFindOne = jest.fn(() => ({
  lean: () => Promise.resolve(mockUserDoc ? { ...mockUserDoc } : null),
}));
const mockUpdateOne = jest.fn((filter, update) => {
  if (filter.id === mockUserDoc?.id && filter.schoolId === mockUserDoc?.schoolId) {
    _applyUpdate(mockUserDoc, update);
  }
  return Promise.resolve({ modifiedCount: 1 });
});

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'usr_1', schoolId: 'sch_A', role: 'parent' };
    next();
  },
}));

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: () => ({ findOne: (...a) => mockFindOne(...a), updateOne: (...a) => mockUpdateOne(...a) }),
}));

const express = require('express');
const supertest = require('supertest');
const pinRouter = require('../../routes/pin');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth/pin', pinRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserDoc = { id: 'usr_1', schoolId: 'sch_A', name: 'Mrs. Kamau', email: 'kamau@example.com' };
});

/* ── Status ────────────────────────────────────────────────────── */

describe('GET /api/auth/pin', () => {
  test('reports no PIN before one is set', async () => {
    const res = await supertest(buildApp()).get('/api/auth/pin');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ enabled: false, lockedForMinutes: 0, attemptsRemaining: 5 });
  });

  test('reports enabled once a hash exists', async () => {
    mockUserDoc.pinHash = await bcrypt.hash('2468', 10);
    const res = await supertest(buildApp()).get('/api/auth/pin');
    expect(res.body.data.enabled).toBe(true);
  });
});

/* ── Setting and changing ─────────────────────────────────────── */

describe('POST /api/auth/pin', () => {
  test('a weak PIN is refused and nothing is stored', async () => {
    const res = await supertest(buildApp()).post('/api/auth/pin').send({ pin: '1234' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PIN_WEAK');
    expect(mockUserDoc.pinHash).toBeUndefined();
  });

  test('a PIN that is not four digits is refused', async () => {
    const res = await supertest(buildApp()).post('/api/auth/pin').send({ pin: '24680' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PIN_WEAK');
  });

  test('stores a bcrypt hash, never the PIN itself, and resets attempts', async () => {
    mockUserDoc.pinFailedAttempts = 3;
    const res = await supertest(buildApp()).post('/api/auth/pin').send({ pin: '2468' });

    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(mockUserDoc.pinHash).toMatch(/^\$2/);
    expect(mockUserDoc.pinHash).not.toContain('2468');
    expect(JSON.stringify(mockUserDoc)).not.toContain('2468');
    expect(mockUserDoc.pinFailedAttempts).toBe(0);
    expect(mockUserDoc.pinSetAt).toBeTruthy();
    expect(await bcrypt.compare('2468', mockUserDoc.pinHash)).toBe(true);
  });

  test('changing an existing PIN requires the current one', async () => {
    mockUserDoc.pinHash = await bcrypt.hash('2468', 10);

    const missing = await supertest(buildApp()).post('/api/auth/pin').send({ pin: '1357' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('PIN_CURRENT_REQUIRED');

    const wrong = await supertest(buildApp()).post('/api/auth/pin').send({ pin: '1357', currentPin: '9999' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe('PIN_WRONG');
    expect(mockUserDoc.pinFailedAttempts).toBe(1);
    // the old PIN is still the live one
    expect(await bcrypt.compare('2468', mockUserDoc.pinHash)).toBe(true);

    const right = await supertest(buildApp()).post('/api/auth/pin').send({ pin: '1357', currentPin: '2468' });
    expect(right.status).toBe(200);
    expect(await bcrypt.compare('1357', mockUserDoc.pinHash)).toBe(true);
  });

  test('the update is scoped to this school and user', async () => {
    await supertest(buildApp()).post('/api/auth/pin').send({ pin: '2468' });
    expect(mockUpdateOne).toHaveBeenCalledWith(
      { id: 'usr_1', schoolId: 'sch_A' },
      expect.objectContaining({ $set: expect.objectContaining({ pinHash: expect.any(String) }) })
    );
  });
});

/* ── Verify ───────────────────────────────────────────────────── */

describe('POST /api/auth/pin/verify', () => {
  beforeEach(async () => {
    mockUserDoc.pinHash = await bcrypt.hash('2468', 10);
  });

  test('a correct PIN answers ok and clears the failure count', async () => {
    mockUserDoc.pinFailedAttempts = 2;
    const res = await supertest(buildApp()).post('/api/auth/pin/verify').send({ pin: '2468' });
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);
    expect(mockUserDoc.pinFailedAttempts).toBe(0);
  });

  test('a wrong PIN is 400 — never 401, which the app treats as a dead session', async () => {
    const res = await supertest(buildApp()).post('/api/auth/pin/verify').send({ pin: '0000' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PIN_WRONG');
    expect(res.body.error.attemptsRemaining).toBe(4);
  });

  test('five wrong attempts lock it, and the right PIN is refused while locked', async () => {
    for (let i = 0; i < 4; i += 1) {
      const res = await supertest(buildApp()).post('/api/auth/pin/verify').send({ pin: '0000' });
      expect(res.status).toBe(400);
    }
    const fifth = await supertest(buildApp()).post('/api/auth/pin/verify').send({ pin: '0000' });
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe('PIN_LOCKED');
    expect(new Date(mockUserDoc.pinLockedUntil).getTime()).toBeGreaterThan(Date.now());

    const correctWhileLocked = await supertest(buildApp()).post('/api/auth/pin/verify').send({ pin: '2468' });
    expect(correctWhileLocked.status).toBe(423);
  });

  test('an account with no PIN answers 409, not "wrong"', async () => {
    delete mockUserDoc.pinHash;
    const res = await supertest(buildApp()).post('/api/auth/pin/verify').send({ pin: '2468' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PIN_NOT_SET');
  });
});

/* ── Removing ─────────────────────────────────────────────────── */

describe('POST /api/auth/pin/forgot', () => {
  test('clears a forgotten PIN (even while locked) for the signed-in account', async () => {
    mockUserDoc.pinHash = await bcrypt.hash('2468', 10);
    mockUserDoc.pinSetAt = new Date().toISOString();
    mockUserDoc.pinLockedUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const res = await supertest(buildApp()).post('/api/auth/pin/forgot');
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(false);
    expect(mockUserDoc.pinHash).toBeUndefined();
    expect(mockUserDoc.pinLockedUntil).toBeNull();
  });
});

describe('DELETE /api/auth/pin', () => {
  beforeEach(async () => {
    mockUserDoc.pinHash = await bcrypt.hash('2468', 10);
    mockUserDoc.pinSetAt = new Date().toISOString();
  });

  test('requires the current PIN', async () => {
    const wrong = await supertest(buildApp()).delete('/api/auth/pin').send({ pin: '0000' });
    expect(wrong.status).toBe(400);
    expect(mockUserDoc.pinHash).toBeTruthy();

    const right = await supertest(buildApp()).delete('/api/auth/pin').send({ pin: '2468' });
    expect(right.status).toBe(200);
    expect(right.body.data.enabled).toBe(false);
    expect(mockUserDoc.pinHash).toBeUndefined();
    expect(mockUserDoc.pinSetAt).toBeUndefined();
  });
});
