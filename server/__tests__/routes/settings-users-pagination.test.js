/* ============================================================
   GET /api/settings/users — server-side filtering, pagination and
   the stats block behind the Settings → Users KPI row.

   The route grew optional ?page/&limit/&role/&q support for the
   redesigned Users tab. Two properties matter and are proven here:

   1. It is OPT-IN. A caller that passes none of those params still
      gets the full, unpaginated list exactly as before, so the
      route's other consumers (HR's staff picker, Inventory's
      requisitions) are untouched.

   2. When it IS paginated, the response carries a `pagination` block
      and a `stats` block (per-role breakdown + the removed count),
      and the listing itself is filtered and sliced server-side.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  invalidatePermCache: jest.fn(),
}));

let mockUsers;

function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatches(doc, sub));
    if (v instanceof RegExp) return v.test(String(doc[k] ?? ''));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$regex' in v) {
        const rx = v.$regex instanceof RegExp ? v.$regex : new RegExp(v.$regex, v.$options || '');
        return rx.test(String(doc[k] ?? ''));
      }
      return true;
    }
    return doc[k] === v;
  });
}

function mockChain(docs) {
  const chain = {
    _docs: docs,
    sort:    () => chain,
    skip:    (n) => { chain._docs = chain._docs.slice(n); return chain; },
    limit:   (n) => { chain._docs = chain._docs.slice(0, n); return chain; },
    lean:    () => Promise.resolve(chain._docs),
  };
  return chain;
}

jest.mock('../../utils/model', () => ({
  _model: jest.fn((collection) => {
    if (collection === 'users') {
      return {
        find: (filter) => mockChain(mockUsers.filter(d => mockMatches(d, filter))),
        countDocuments: (filter) => Promise.resolve(mockUsers.filter(d => mockMatches(d, filter)).length),
        aggregate: (pipeline) => {
          // Every $match stage applies (tenantModel prepends a schoolId
          // one, the route adds the isActive one).
          const match = Object.assign({}, ...pipeline.filter(s => s.$match).map(s => s.$match));
          const group = pipeline.find(s => s.$group)?.$group;
          const rows = mockUsers.filter(d => mockMatches(d, match));
          if (!group) return Promise.resolve([]);
          const buckets = new Map();
          for (const d of rows) {
            const key = d[group._id.replace('$', '')];
            buckets.set(key, (buckets.get(key) || 0) + 1);
          }
          return Promise.resolve([...buckets.entries()].map(([k, count]) => ({ _id: k, count })));
        },
      };
    }
    return { findOne: () => ({ lean: () => Promise.resolve(null) }), find: () => mockChain([]) };
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
    { id: 'usr_admin',  email: 'admin@demo.school',  name: 'Demo Admin',   role: 'admin',   schoolId: SCHOOL_ID, isActive: true },
    { id: 'usr_teach1', email: 'collins@demo.school', name: 'Collins Waweru', role: 'teacher', schoolId: SCHOOL_ID, isActive: true },
    { id: 'usr_teach2', email: 'fidel@demo.school',  name: 'Fidel Ochieng',  role: 'teacher', schoolId: SCHOOL_ID, isActive: true },
    { id: 'usr_teach3', email: 'jane@demo.school',   name: 'Jane Achieng',   role: 'teacher', schoolId: SCHOOL_ID, isActive: true },
    { id: 'usr_stud',   email: 'student@demo.school', name: 'Demo Student',  role: 'student', schoolId: SCHOOL_ID, isActive: true },
    { id: 'usr_gone',   email: 'gone@demo.school',   name: 'Gone Account',   role: 'teacher', schoolId: SCHOOL_ID, isActive: false },
  ];
});

describe('GET /api/settings/users — unpaginated (unchanged behaviour)', () => {
  test('returns the full list and NO pagination block when no params are given', async () => {
    const res = await supertest(buildApp())
      .get('/api/settings/users')
      .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(5);            // the removed one is excluded
    expect(res.body.pagination).toBeUndefined();      // legacy shape preserved
    expect(res.body.stats).toBeUndefined();
  });
});

describe('GET /api/settings/users — pagination', () => {
  test('slices the list server-side and reports the real total', async () => {
    const res = await supertest(buildApp())
      .get('/api/settings/users')
      .query({ page: 2, limit: 2 })
      .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }));

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.pagination).toMatchObject({ page: 2, limit: 2, total: 5, pages: 3 });
  });

  test('reports a per-role breakdown and the removed count for the KPI row', async () => {
    const res = await supertest(buildApp())
      .get('/api/settings/users')
      .query({ page: 1, limit: 25 })
      .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }));

    expect(res.body.stats.activeTotal).toBe(5);
    expect(res.body.stats.removedTotal).toBe(1);
    expect(res.body.stats.byRole).toMatchObject({ admin: 1, teacher: 3, student: 1 });
  });
});

describe('GET /api/settings/users — filtering', () => {
  test('?role= narrows the list and the total', async () => {
    const res = await supertest(buildApp())
      .get('/api/settings/users')
      .query({ role: 'teacher', page: 1, limit: 25 })
      .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }));

    expect(res.body.data.length).toBe(3);
    expect(res.body.pagination.total).toBe(3);
  });

  test('?q= matches name or email', async () => {
    const byName = await supertest(buildApp())
      .get('/api/settings/users')
      .query({ q: 'collins', page: 1, limit: 25 })
      .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }));
    expect(byName.body.data.map(u => u.id)).toEqual(['usr_teach1']);

    const byEmail = await supertest(buildApp())
      .get('/api/settings/users')
      .query({ q: 'jane@demo', page: 1, limit: 25 })
      .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }));
    expect(byEmail.body.data.map(u => u.id)).toEqual(['usr_teach3']);
  });

  test('a regex metacharacter in ?q= is matched literally, not interpreted', async () => {
    const res = await supertest(buildApp())
      .get('/api/settings/users')
      .query({ q: '.*', page: 1, limit: 25 })
      .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);   // no name literally contains ".*"
  });

  test('another school\'s accounts are never returned', async () => {
    mockUsers.push({ id: 'usr_other', email: 'other@other.school', name: 'Other', role: 'teacher', schoolId: 'sch_other', isActive: true });

    const res = await supertest(buildApp())
      .get('/api/settings/users')
      .query({ page: 1, limit: 25 })
      .set('Cookie', authCookie({ userId: 'usr_admin', schoolId: SCHOOL_ID }));

    expect(res.body.data.map(u => u.id)).not.toContain('usr_other');
  });
});
