/* ============================================================
   Unit tests — server/middleware/auth.js's token-version checks

   Covers both revocation tiers authMiddleware enforces (ADR-0003
   Decision 4), previously entirely untested:
     - `tv` (users.tokenVersion, school-scoped) — pre-existing
     - `itv` (identities.tokenVersion, cross-school) — new, Phase 1

   Both follow the same "missing claim passes through" convention so
   pre-migration tokens are never broken. Uses the real sign()/verify()
   from utils/jwt (same secret across one test process) — only the DB
   lookups (_model) are mocked.
   ============================================================ */

let mockUserVersions = {};
let mockIdentityVersions = {};

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'users') {
      return { findOne: (filter) => ({ lean: () => Promise.resolve(
        filter.id in mockUserVersions ? { tokenVersion: mockUserVersions[filter.id] } : null
      ) }) };
    }
    if (collection === 'identities') {
      return {
        findOne: (filter) => ({ lean: () => Promise.resolve(
          filter.id in mockIdentityVersions ? { tokenVersion: mockIdentityVersions[filter.id] } : null
        ) }),
        updateOne: () => Promise.resolve({}),
      };
    }
    if (collection === 'sessions') {
      return { updateOne: () => Promise.resolve({}) };
    }
    return {};
  }),
}));

const { sign } = require('../../utils/jwt');
const { authMiddleware } = require('../../middleware/auth');

function makeReqRes(token) {
  const req = { cookies: { token }, headers: {} };
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  return { req, res };
}

async function run(payload) {
  const token = sign(payload);
  const { req, res } = makeReqRes(token);
  const next = jest.fn();
  await authMiddleware(req, res, next);
  return { req, res, next };
}

beforeEach(() => {
  mockUserVersions = { usr_1: 3 };
  mockIdentityVersions = { idt_1: 5 };
});

describe('authMiddleware — tv (users.tokenVersion, school-scoped)', () => {
  test('a token with no tv claim passes through (pre-v4.32 tokens)', async () => {
    const { next, res } = await run({ userId: 'usr_1', schoolId: 'sch_a' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  test('a token with tv matching the current DB version passes', async () => {
    const { next } = await run({ userId: 'usr_1', schoolId: 'sch_a', tv: 3 });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('a token with a stale tv is rejected (401), next() not called', async () => {
    const { next, res } = await run({ userId: 'usr_1', schoolId: 'sch_a', tv: 2 });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error.message).toMatch(/revoked/i);
  });
});

describe('authMiddleware — itv (identities.tokenVersion, cross-school)', () => {
  test('a token with no itv/identityId passes through unaffected (most tokens today)', async () => {
    const { next, res } = await run({ userId: 'usr_1', schoolId: 'sch_a', tv: 3 });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBeNull();
  });

  test('a token with itv but no identityId skips the identity check (malformed/legacy — never crashes)', async () => {
    const { next } = await run({ userId: 'usr_1', schoolId: 'sch_a', tv: 3, itv: 5 });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('a token with identityId but no itv skips the identity check (pre-Phase-1 token shape)', async () => {
    const { next } = await run({ userId: 'usr_1', schoolId: 'sch_a', tv: 3, identityId: 'idt_1' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('a token with itv matching the current identity version passes', async () => {
    const { next } = await run({ userId: 'usr_1', schoolId: 'sch_a', tv: 3, identityId: 'idt_1', itv: 5 });
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('a token with a stale itv is rejected (401) even when tv is valid', async () => {
    const { next, res } = await run({ userId: 'usr_1', schoolId: 'sch_a', tv: 3, identityId: 'idt_1', itv: 4 });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.error.message).toMatch(/revoked/i);
  });

  test('revoking an identity (bumped version) invalidates a previously-valid token on the next check', async () => {
    const { revokeIdentityTokens } = require('../../utils/token-version');
    const payload = { userId: 'usr_1', schoolId: 'sch_a', tv: 3, identityId: 'idt_1', itv: 5 };
    const { next: firstNext } = await run(payload);
    expect(firstNext).toHaveBeenCalledTimes(1); // valid the first time

    // Real revocation call — bumps the DB value AND invalidates token-version.js's
    // own in-process cache (a direct mock-data mutation would miss the cache and
    // give a false pass, since the cache TTL is 5 minutes).
    mockIdentityVersions.idt_1 = 6;
    await revokeIdentityTokens('idt_1');

    const { next: secondNext, res: secondRes } = await run(payload); // same token, re-checked
    expect(secondNext).not.toHaveBeenCalled();
    expect(secondRes.statusCode).toBe(401);
  });

  test('a stale tv still rejects even when itv is valid — either tier can independently revoke', async () => {
    const { next, res } = await run({ userId: 'usr_1', schoolId: 'sch_a', tv: 1, identityId: 'idt_1', itv: 5 });
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
