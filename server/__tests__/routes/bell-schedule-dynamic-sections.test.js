/* ============================================================
   server/routes/bell-schedule.js — dynamic section validation

   Root cause: every route in this file validated the `section`
   param/body field against a hardcoded VALID_SECTIONS enum
   ['all','kg','primary','secondary','alevel']. A school using real,
   different section names (e.g. "KS3 Section", key 'ks3_section')
   could never set — or even fetch — a per-section bell schedule for
   any of its actual sections: GET silently coerced to 'all' every
   time, PUT/DELETE rejected the section outright with a 400. The
   feature was completely unreachable for any school not using the
   exact kg/primary/secondary/alevel naming.

   Fixed to validate against the school's own `sections` collection
   (plus the always-valid 'all' school-default bucket) instead of a
   fixed list — same shape of fix as the client-side label bugs this
   was found alongside.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL_A = 'school_A';

function mockChainArr(arr) {
  const c = { sort: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  return { lean: () => Promise.resolve(obj) };
}
// A matcher with the MongoDB semantics the bell-schedule routes rely on:
// $or, $exists, $size, $in, $ne, array membership, and null matching a missing field.
function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (k === '$and') return v.every(sub => mockMatchesFilter(doc, sub));
    const val = doc[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$exists' in v) return (val !== undefined) === v.$exists;
      if ('$size' in v) return Array.isArray(val) && val.length === v.$size;
      if ('$in' in v) return Array.isArray(val) ? val.some(x => v.$in.includes(x)) : v.$in.includes(val);
      if ('$ne' in v) return val !== v.$ne;
    }
    if (Array.isArray(val)) return val.includes(v);
    if (v === null) return val == null;
    return val === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  return {
    _docs: () => docs,
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => mockMatchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) ?? null)),
    create:  jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
    updateOne: jest.fn((filter, update) => {
      const doc = docs.find(d => mockMatchesFilter(d, filter));
      if (doc) Object.assign(doc, update.$set ?? update);
      return Promise.resolve({ matchedCount: doc ? 1 : 0 });
    }),
    deleteOne: jest.fn((filter) => {
      const idx = docs.findIndex(d => mockMatchesFilter(d, filter));
      if (idx >= 0) docs.splice(idx, 1);
      return Promise.resolve({ deletedCount: idx >= 0 ? 1 : 0 });
    }),
  };
}

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));

let mockSections, mockBellSchedules;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: jest.fn((col) => {
    if (col === 'sections')        return mockSections;
    if (col === 'bell_schedules')  return mockBellSchedules;
    return mockMakeFakeCollection([]);
  }),
}));

const express = require('express');
const supertest = require('supertest');
const bellRouter = require('../../routes/bell-schedule');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/bell-schedule', bellRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  // A school using real, non-default section names — the exact scenario
  // that was completely broken.
  mockSections = mockMakeFakeCollection([
    { schoolId: SCHOOL_A, key: 'primary',      name: 'Primary',      order: 1 },
    { schoolId: SCHOOL_A, key: 'ks3_section',   name: 'KS3 Section',  order: 2 },
    { schoolId: SCHOOL_A, key: 'ks5_section',   name: 'KS5 Section',  order: 3 },
  ]);
  mockBellSchedules = mockMakeFakeCollection([]);
});

const PERIODS = [{ p: '1', start: '08:00', end: '09:00', label: 'Period 1', isBreak: false }];

describe('PUT /api/bell-schedule — a custom, non-default section name', () => {
  test('a real school section (KS3 Section) can have its own bell schedule saved — the exact reported bug', async () => {
    const res = await supertest(buildApp())
      .put('/api/bell-schedule')
      .send({ section: 'ks3_section', periods: PERIODS });

    expect(res.status).toBe(200);
    expect(res.body.data.section).toBe('ks3_section');
    expect(mockBellSchedules._docs()).toHaveLength(1);
    expect(mockBellSchedules._docs()[0].section).toBe('ks3_section');
  });

  test('a section key that does not belong to this school is rejected, not silently coerced', async () => {
    const res = await supertest(buildApp())
      .put('/api/bell-schedule')
      .send({ section: 'not_a_real_section', periods: PERIODS });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/unknown section/i);
    expect(mockBellSchedules._docs()).toHaveLength(0);
  });

  test('"all" (the school default) is always accepted, even though it is not itself a configured section', async () => {
    const res = await supertest(buildApp())
      .put('/api/bell-schedule')
      .send({ section: 'all', periods: PERIODS });

    expect(res.status).toBe(200);
    expect(res.body.data.section).toBe('all');
  });

  test('backward compatible: a school still using the original default keys is unaffected', async () => {
    mockSections = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, key: 'kg',        name: 'Kindergarten', order: 1 },
      { schoolId: SCHOOL_A, key: 'primary',   name: 'Primary',      order: 2 },
      { schoolId: SCHOOL_A, key: 'secondary', name: 'Secondary',    order: 3 },
      { schoolId: SCHOOL_A, key: 'alevel',    name: 'A-Level',      order: 4 },
    ]);
    const res = await supertest(buildApp())
      .put('/api/bell-schedule')
      .send({ section: 'secondary', periods: PERIODS });

    expect(res.status).toBe(200);
    expect(res.body.data.section).toBe('secondary');
  });
});

describe('GET /api/bell-schedule — a custom section resolves instead of silently falling back to "all"', () => {
  test('fetching a real custom section returns its own saved schedule, not the school default', async () => {
    mockBellSchedules = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, section: 'ks3_section', periods: PERIODS, id: 'bs_1' },
      { schoolId: SCHOOL_A, section: 'all',          periods: [{ p: '1', start: '07:00', end: '08:00', label: 'Default P1', isBreak: false }], id: 'bs_2' },
    ]);

    const res = await supertest(buildApp()).get('/api/bell-schedule?section=ks3_section');

    expect(res.status).toBe(200);
    expect(res.body.data.section).toBe('ks3_section');
    expect(res.body.data.periods[0].label).toBe('Period 1');
  });

  test('an unrecognized section param falls back to the school default, same as before', async () => {
    mockBellSchedules = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, section: 'all', periods: PERIODS, id: 'bs_2' },
    ]);

    const res = await supertest(buildApp()).get('/api/bell-schedule?section=bogus');

    expect(res.status).toBe(200);
    expect(res.body.data.section).toBe('all');
  });
});

describe('GET /api/bell-schedule/sections — lists this school\'s real sections, not a generic list', () => {
  test('returns exactly this school\'s configured sections plus "all", not kg/primary/secondary/alevel', async () => {
    const res = await supertest(buildApp()).get('/api/bell-schedule/sections');

    expect(res.status).toBe(200);
    const sectionKeys = res.body.data.map(s => s.section);
    expect(sectionKeys).toEqual(['all', 'primary', 'ks3_section', 'ks5_section']);
  });

  test('flags which sections actually have a custom schedule configured', async () => {
    mockBellSchedules = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, section: 'ks3_section', periods: PERIODS, id: 'bs_1' },
    ]);

    const res = await supertest(buildApp()).get('/api/bell-schedule/sections');

    const ks3 = res.body.data.find(s => s.section === 'ks3_section');
    const ks5 = res.body.data.find(s => s.section === 'ks5_section');
    expect(ks3.configured).toBe(true);
    expect(ks3.periodCount).toBe(1);
    expect(ks5.configured).toBe(false);
  });
});

describe('DELETE /api/bell-schedule — revert a custom section', () => {
  test('a real custom section can be deleted, reverting to school default', async () => {
    mockBellSchedules = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, section: 'ks3_section', periods: PERIODS, id: 'bs_1' },
    ]);

    const res = await supertest(buildApp()).delete('/api/bell-schedule?section=ks3_section');

    expect(res.status).toBe(200);
    expect(mockBellSchedules._docs()).toHaveLength(0);
  });

  // Previously blocked unconditionally ("Cannot delete the school-wide
  // 'all' schedule") — but that block was only ever reached via this one
  // query-param path; the client's own Remove button for the School
  // Default actually went through DELETE ?id=, which had no such check
  // at all. Rather than leave that inconsistency (protected one way,
  // wide open the other), deleting the School Default is now allowed
  // through both — it's a safe operation either way: classes with no
  // other schedule simply fall back to the built-in default.
  test('the School Default ("all") can now be deleted, reverting those classes to the built-in default', async () => {
    mockBellSchedules = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, section: 'all', name: 'School default', periods: PERIODS, classIds: [], id: 'bs_all' },
    ]);
    const res = await supertest(buildApp()).delete('/api/bell-schedule?section=all');
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/built-in/i);
    expect(mockBellSchedules._docs()).toHaveLength(0);
  });

  // Previously rejected with "Unknown section" — but a delete should never
  // require the section to still exist in Classes → Sections: the whole
  // point of deleting a stale section default BY KEY is that its section
  // was already removed elsewhere, which is exactly what sections.js's own
  // DELETE now also does proactively. This covers anything left over from
  // before that existed.
  test('an orphaned section default (its section no longer exists) can still be deleted, not rejected as "unknown"', async () => {
    mockBellSchedules = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, section: 'ks3_section_removed', periods: PERIODS, classIds: [], id: 'bs_orphan' },
    ]);
    const res = await supertest(buildApp()).delete('/api/bell-schedule?section=ks3_section_removed');
    expect(res.status).toBe(200);
    expect(mockBellSchedules._docs()).toHaveLength(0);
  });

  test('deleting a section with nothing saved for it is a clean 404, not a false "unknown section" rejection', async () => {
    const res = await supertest(buildApp()).delete('/api/bell-schedule?section=ks3_section');
    expect(res.status).toBe(404);
  });
});
