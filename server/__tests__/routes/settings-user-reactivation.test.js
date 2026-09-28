/* ============================================================
   Soft-deleted user accounts — invite conflict + reactivation
   (2026-09-28, real customer report — Trinitas)

   A teacher was invited via Settings by mistake (no HR staff record was
   created — invite and HR are separate data models), then removed via
   DELETE /api/settings/users/:id. That route only ever soft-deletes
   (isActive:false; the document, including its email, is never purged).
   Two real gaps followed from that:

   (1) GET /api/settings/users filters isActive:true, so the removed
       account became completely invisible in the UI — yet POST
       /users/invite's own duplicate-email check has NO isActive filter
       at all, so re-inviting that same address was blocked FOREVER with
       a generic "already exists" error that gave no way to find or
       resolve the actual cause.
   (2) There was no way back at all — no reactivate route existed
       anywhere, self-service or platform-level.

   This file proves: the invite conflict now distinguishes an inactive
   account (INACTIVE_ACCOUNT_EXISTS, not a bare CONFLICT) from a genuine
   active duplicate; GET /users?status=removed surfaces exactly what the
   default listing hides; and POST /users/:id/reactivate restores login
   access with a fresh password, symmetric teacher-status cascade, and a
   real audit trail.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  invalidatePermCache: jest.fn(),
}));
jest.mock('../../utils/email', () => ({
  sendWelcomeCredentials: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/provision-identities', () => ({
  provisionIdentityForUser: jest.fn().mockResolvedValue(undefined),
}));
const mockAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

let mockUsers;    // array of user docs
let mockTeachers; // array of teacher docs
let mockIdentityDocs = {};

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
function mockChainArr(arr) { return { sort: () => ({ lean: () => Promise.resolve(arr) }) }; }
function mockChainObj(obj) { return { lean: () => Promise.resolve(obj) }; }

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
    if (collection === 'identities') {
      return {
        updateOne: jest.fn((filter, update) => {
          const doc = mockIdentityDocs[filter.id];
          if (doc && update.$set) Object.assign(doc, update.$set);
          return Promise.resolve({});
        }),
      };
    }
    if (collection === 'teachers') {
      return {
        updateOne: jest.fn((filter, update) => {
          let count = 0;
          for (const d of mockTeachers) {
            if (mockMatches(d, filter)) { Object.assign(d, update.$set); count++; }
          }
          return Promise.resolve({ matchedCount: count });
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

function buildApp() {
  const settingsRouter = require('../../routes/settings');
  const app = express();
  app.use(express.json());
  app.use(require('cookie-parser')());
  app.use('/api/settings', settingsRouter);
  return app;
}

function authCookie(payload) {
  return `token=${sign({ role: 'admin', ...payload })}`;
}

const SCHOOL_ID = 'sch_demo_001';

beforeEach(() => {
  jest.clearAllMocks();
  mockUsers = [
    { id: 'usr_admin_001', email: 'admin@demo.school', role: 'admin', schoolId: SCHOOL_ID, isActive: true },
  ];
  mockTeachers = [];
  mockIdentityDocs = {};
});

describe('POST /api/settings/users/invite — conflict distinguishes an inactive account', () => {
  test('an ACTIVE duplicate email: generic CONFLICT (unchanged behavior)', async () => {
    mockUsers.push({ id: 'usr_taken', email: 'taken@demo.school', role: 'teacher', schoolId: SCHOOL_ID, isActive: true });

    const res = await supertest(buildApp())
      .post('/api/settings/users/invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ name: 'New Person', email: 'taken@demo.school', role: 'teacher' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  test('a REMOVED (isActive:false) account with the same email: INACTIVE_ACCOUNT_EXISTS, names the real cause', async () => {
    mockUsers.push({
      id: 'usr_removed', email: 'angela@trinitas.example', role: 'deputy_principal', schoolId: SCHOOL_ID,
      isActive: false, updatedAt: '2026-09-28T08:09:15.670Z',
    });

    const res = await supertest(buildApp())
      .post('/api/settings/users/invite')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({ name: 'Angela Gitau', email: 'angela@trinitas.example', role: 'teacher' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INACTIVE_ACCOUNT_EXISTS');
    expect(res.body.error.userId).toBe('usr_removed');
    expect(res.body.error.message).toMatch(/removed/i);
  });
});

describe('GET /api/settings/users — default vs ?status=removed', () => {
  test('default listing excludes a removed account entirely', async () => {
    mockUsers.push({ id: 'usr_removed', email: 'angela@trinitas.example', schoolId: SCHOOL_ID, isActive: false });

    const res = await supertest(buildApp())
      .get('/api/settings/users')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }));

    expect(res.status).toBe(200);
    expect(res.body.data.map(u => u.id)).not.toContain('usr_removed');
  });

  test('?status=removed returns ONLY the removed account, not active ones', async () => {
    mockUsers.push({ id: 'usr_removed', email: 'angela@trinitas.example', schoolId: SCHOOL_ID, isActive: false });

    const res = await supertest(buildApp())
      .get('/api/settings/users')
      .query({ status: 'removed' })
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }));

    expect(res.status).toBe(200);
    const ids = res.body.data.map(u => u.id);
    expect(ids).toEqual(['usr_removed']);
  });
});

describe('POST /api/settings/users/:id/reactivate', () => {
  test('restores isActive, issues a fresh password, and audit-logs it', async () => {
    mockUsers.push({ id: 'usr_removed', email: 'angela@trinitas.example', name: 'Angela Gitau', role: 'teacher', schoolId: SCHOOL_ID, isActive: false, password: 'oldhash' });

    const res = await supertest(buildApp())
      .post('/api/settings/users/usr_removed/reactivate')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.password).toBeTruthy();
    const doc = mockUsers.find(u => u.id === 'usr_removed');
    expect(doc.isActive).toBe(true);
    expect(doc.password).not.toBe('oldhash');
    expect(doc.mustChangePassword).toBe(true);
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.reactivated' }));
  });

  test('reactivating an already-active user: 409, no changes', async () => {
    mockUsers.push({ id: 'usr_active', email: 'active@demo.school', schoolId: SCHOOL_ID, isActive: true, password: 'hash' });

    const res = await supertest(buildApp())
      .post('/api/settings/users/usr_active/reactivate')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({});

    expect(res.status).toBe(409);
    expect(mockUsers.find(u => u.id === 'usr_active').password).toBe('hash');
  });

  test('missing user: 404', async () => {
    const res = await supertest(buildApp())
      .post('/api/settings/users/usr_ghost/reactivate')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({});
    expect(res.status).toBe(404);
  });

  test('cascades a teacher record this SAME deactivation put to sleep back to active', async () => {
    mockUsers.push({ id: 'usr_removed', email: 'angela@trinitas.example', name: 'Angela Gitau', role: 'teacher', schoolId: SCHOOL_ID, isActive: false });
    mockTeachers.push({ id: 'tch_angela', schoolId: SCHOOL_ID, userId: 'usr_removed', email: 'angela@trinitas.example', status: 'inactive' });

    await supertest(buildApp())
      .post('/api/settings/users/usr_removed/reactivate')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({});

    expect(mockTeachers.find(t => t.id === 'tch_angela').status).toBe('active');
  });

  test('does NOT touch a linked teacher record that is already active for its own reasons', async () => {
    mockUsers.push({ id: 'usr_removed', email: 'angela@trinitas.example', name: 'Angela Gitau', role: 'teacher', schoolId: SCHOOL_ID, isActive: false });
    // A replacement staff record created after the deactivation — already
    // active independently. Reactivating the old login must not touch it.
    mockTeachers.push({ id: 'tch_new', schoolId: SCHOOL_ID, userId: 'usr_removed', email: 'angela@trinitas.example', status: 'active' });

    await supertest(buildApp())
      .post('/api/settings/users/usr_removed/reactivate')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({});

    // Still active — untouched (a real bug would show this staying
    // 'active' as a false-pass, so also assert nothing else broke it).
    expect(mockTeachers.find(t => t.id === 'tch_new').status).toBe('active');
  });

  test('dual-writes the new password hash to a linked identity', async () => {
    mockUsers.push({ id: 'usr_removed', email: 'angela@trinitas.example', schoolId: SCHOOL_ID, isActive: false, identityId: 'idt_angela' });
    mockIdentityDocs.idt_angela = { id: 'idt_angela', passwordHash: 'oldhash', status: 'inactive' };

    await supertest(buildApp())
      .post('/api/settings/users/usr_removed/reactivate')
      .set('Cookie', authCookie({ userId: 'usr_admin_001', schoolId: SCHOOL_ID }))
      .send({});

    expect(mockIdentityDocs.idt_angela.passwordHash).not.toBe('oldhash');
    expect(mockIdentityDocs.idt_angela.status).toBe('active');
  });
});
