/* ============================================================
   Token revocation must use the CANONICAL app `id` — never the raw
   route param.

   PUT/DELETE /api/settings/users/:id deliberately accept BOTH the app
   `id` and a Mongo `_id` (seed-script / direct-DB accounts have no app
   id). revokeUserTokens(), however, increments `{ id: userId }` and
   keys its 5-minute cache by that same value. Passing an `_id` matched
   no document and deleted the wrong cache entry, so the old JWT kept
   its old role claim for its full 7-day life.

   These tests pin the fix at both call sites: the route still accepts
   either identifier form, but revocation always fires with the document's
   real `id`.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  invalidatePermCache: jest.fn(),
  hasExplicitSubGrant: jest.fn(),
  _mergeUserOverrides: jest.fn(),
  _loadPerms: jest.fn(),
  _loadUserPerms: jest.fn(),
}));
jest.mock('../../middleware/module-gate', () => ({
  invalidateModuleConfigCache: jest.fn(),
}));
jest.mock('../../utils/email', () => ({
  invalidateSmtpCache: jest.fn(),
  sendWelcomeCredentials: jest.fn().mockResolvedValue(undefined),
}));
const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));
const mockRevokeUserTokens = jest.fn().mockResolvedValue(undefined);
jest.mock('../../utils/token-version', () => ({
  revokeUserTokens: (...args) => mockRevokeUserTokens(...args),
  revokeIdentityTokens: jest.fn().mockResolvedValue(undefined),
  getTokenVersion: jest.fn().mockResolvedValue(0),
  getIdentityTokenVersion: jest.fn().mockResolvedValue(0),
}));

let mockUsers;
let mockTeachers;

function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatches(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return doc[k] !== v.$ne;
      return true;
    }
    return doc[k] === v;
  });
}
function mockChainObj(obj) { return { lean: () => Promise.resolve(obj) }; }
function mockChainArr(arr) { return { sort: () => ({ lean: () => Promise.resolve(arr) }) }; }

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'users') {
      return {
        find:     (filter) => mockChainArr(mockUsers.filter(d => mockMatches(d, filter))),
        findOne:  (filter) => mockChainObj(mockUsers.find(d => mockMatches(d, filter)) ?? null),
        updateOne: jest.fn((filter, update) => {
          const doc = mockUsers.find(d => mockMatches(d, filter));
          if (doc && update.$set) Object.assign(doc, update.$set);
          return Promise.resolve({ matchedCount: doc ? 1 : 0 });
        }),
      };
    }
    if (collection === 'teachers') {
      return {
        updateOne: jest.fn((filter, update) => {
          for (const d of mockTeachers) {
            if (mockMatches(d, filter) && update.$set) Object.assign(d, update.$set);
          }
          return Promise.resolve({ matchedCount: 1 });
        }),
      };
    }
    if (collection === 'schools') {
      return { findOne: () => mockChainObj({ id: 'sch_demo_001', name: 'Demo School' }) };
    }
    return { findOne: () => mockChainObj(null), find: () => mockChainArr([]) };
  }),
}));

const express   = require('express');
const supertest = require('supertest');
const { sign }  = require('../../utils/jwt');

const SCHOOL_ID = 'sch_demo_001';
const OID       = 'aaaaaaaaaaaaaaaaaaaaaaaa';

function buildApp() {
  const settingsRouter = require('../../routes/settings');
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/settings', settingsRouter);
  return app;
}
function authCookie() {
  return `token=${sign({ userId: 'usr_admin_001', schoolId: SCHOOL_ID, role: 'admin' })}`;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUsers = [
    { id: 'usr_admin_001', email: 'admin@demo.school', role: 'admin', schoolId: SCHOOL_ID, isActive: true },
    { id: 'usr_target', _id: OID, email: 'target@demo.school', role: 'teacher', schoolId: SCHOOL_ID, isActive: true },
  ];
  mockTeachers = [];
});

describe('PUT /api/settings/users/:id — role change revocation', () => {
  test('reached via a Mongo _id: revokes the canonical id, not the _id', async () => {
    const res = await supertest(buildApp())
      .put(`/api/settings/users/${OID}`)
      .set('Cookie', authCookie())
      .send({ role: 'teacher' });

    expect(res.status).toBe(200);
    expect(mockRevokeUserTokens).toHaveBeenCalledWith('usr_target');
    expect(mockRevokeUserTokens).not.toHaveBeenCalledWith(OID);
  });

  test('reached via the app id: unchanged behavior', async () => {
    const res = await supertest(buildApp())
      .put('/api/settings/users/usr_target')
      .set('Cookie', authCookie())
      .send({ role: 'teacher' });

    expect(res.status).toBe(200);
    expect(mockRevokeUserTokens).toHaveBeenCalledWith('usr_target');
  });

  test('a name-only edit performs no revocation at all', async () => {
    const res = await supertest(buildApp())
      .put(`/api/settings/users/${OID}`)
      .set('Cookie', authCookie())
      .send({ name: 'Renamed Teacher' });

    expect(res.status).toBe(200);
    expect(mockRevokeUserTokens).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/settings/users/:id — deactivation revocation', () => {
  test('reached via a Mongo _id: revokes the canonical id, not the _id', async () => {
    const res = await supertest(buildApp())
      .delete(`/api/settings/users/${OID}`)
      .set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(mockUsers.find(u => u.id === 'usr_target').isActive).toBe(false);
    expect(mockRevokeUserTokens).toHaveBeenCalledWith('usr_target');
    expect(mockRevokeUserTokens).not.toHaveBeenCalledWith(OID);
  });

  test('reached via the app id: unchanged behavior', async () => {
    const res = await supertest(buildApp())
      .delete('/api/settings/users/usr_target')
      .set('Cookie', authCookie());

    expect(res.status).toBe(200);
    expect(mockRevokeUserTokens).toHaveBeenCalledWith('usr_target');
  });
});
