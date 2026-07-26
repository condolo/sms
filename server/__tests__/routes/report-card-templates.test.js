/* ============================================================
   server/routes/report-card-templates.js (RC11)

   Registry + resolution chain only — no rendering-engine content
   (see the route file's own header for why that's deliberately
   out of scope for this phase). Covers CRUD (isDefault scoping,
   revision bump on update, delete-blocked-while-default) and the
   resolveTemplate() chain: section default → school default →
   Legacy Tabular (the platform built-in, never a real document).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

function chain(result) {
  return { select: () => chain(result), sort: () => chain(result), lean: () => Promise.resolve(result) };
}

function matches(doc, filter) {
  return Object.entries(filter).every(([k, v]) => {
    if (k === '$or') return v.some(sub => matches(doc, sub));
    if (v && typeof v === 'object' && '$ne' in v) return doc[k] !== v.$ne;
    if (v && typeof v === 'object' && '$exists' in v) return v.$exists ? (k in doc) : !(k in doc);
    return doc[k] === v;
  });
}

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  return {
    findOne: (filter) => chain(docs.find(d => matches(d, filter)) || null),
    find:    (filter) => chain(docs.filter(d => matches(d, filter))),
    updateMany: async (filter, update) => {
      docs.filter(d => matches(d, filter)).forEach(d => Object.assign(d, update.$set));
    },
    findOneAndUpdate: (filter, update) => ({
      lean: async () => {
        const doc = docs.find(d => matches(d, filter));
        if (!doc) return null;
        if (update.$set) Object.assign(doc, update.$set);
        if (update.$inc) for (const [k, n] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + n;
        return { ...doc };
      },
    }),
    deleteOne: async (filter) => {
      const i = docs.findIndex(d => matches(d, filter));
      if (i >= 0) docs.splice(i, 1);
    },
    create: async (doc) => { const d = { ...doc }; d.toObject = () => ({ ...d }); docs.push(d); return d; },
    _docs: () => docs,
  };
}

let mockStore;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: 'u_admin', schoolId: 'school_test_001', role: 'admin', roles: [] };
    next();
  },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => mockStore),
  tenantContext: jest.fn(() => ({})),
}));

const express         = require('express');
const supertest       = require('supertest');
const templatesRouter = require('../../routes/report-card-templates');
const { resolveTemplate, LEGACY_TABULAR } = templatesRouter;

const SCHOOL = 'school_test_001';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/report-card-templates', templatesRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore = makeStore();
});

describe('resolveTemplate — the resolution chain', () => {
  test('nothing configured at all → Legacy Tabular', async () => {
    const result = await resolveTemplate({}, SCHOOL, null);
    expect(result).toEqual(LEGACY_TABULAR);
  });

  test('school-wide default exists, no sectionId requested → resolves to it', async () => {
    mockStore = makeStore([
      { id: 'tpl_school', schoolId: SCHOOL, sectionId: null, isDefault: true, revision: 3 },
    ]);
    const result = await resolveTemplate({}, SCHOOL, null);
    expect(result).toEqual({ templateId: 'tpl_school', templateVersion: 3, builtIn: false });
  });

  test('section-scoped default takes priority over the school-wide default for that section', async () => {
    mockStore = makeStore([
      { id: 'tpl_school',  schoolId: SCHOOL, sectionId: null,    isDefault: true, revision: 1 },
      { id: 'tpl_section', schoolId: SCHOOL, sectionId: 'sec_a', isDefault: true, revision: 5 },
    ]);
    const result = await resolveTemplate({}, SCHOOL, 'sec_a');
    expect(result).toEqual({ templateId: 'tpl_section', templateVersion: 5, builtIn: false });
  });

  test('a section with no section-specific default falls back to the school-wide default', async () => {
    mockStore = makeStore([
      { id: 'tpl_school',  schoolId: SCHOOL, sectionId: null,    isDefault: true, revision: 1 },
      { id: 'tpl_section', schoolId: SCHOOL, sectionId: 'sec_a', isDefault: true, revision: 5 },
    ]);
    const result = await resolveTemplate({}, SCHOOL, 'sec_b'); // different section
    expect(result).toEqual({ templateId: 'tpl_school', templateVersion: 1, builtIn: false });
  });

  test('templates exist but none is marked default → Legacy Tabular, not an error', async () => {
    mockStore = makeStore([
      { id: 'tpl_x', schoolId: SCHOOL, sectionId: null, isDefault: false, revision: 1 },
    ]);
    const result = await resolveTemplate({}, SCHOOL, null);
    expect(result).toEqual(LEGACY_TABULAR);
  });

  test('builtIn flag is true only for the Legacy Tabular fallback, false for a real template', async () => {
    mockStore = makeStore([
      { id: 'tpl_school', schoolId: SCHOOL, sectionId: null, isDefault: true, revision: 1 },
    ]);
    const resolved = await resolveTemplate({}, SCHOOL, null);
    expect(resolved.builtIn).toBe(false);
    const fallback = await resolveTemplate({}, 'school_other', null);
    expect(fallback.builtIn).toBe(true);
  });
});

describe('GET /api/report-card-templates', () => {
  test('lists templates for the school', async () => {
    mockStore = makeStore([{ id: 'tpl_1', schoolId: SCHOOL, name: 'A', isDefault: false, revision: 1 }]);
    const res = await supertest(buildApp()).get('/api/report-card-templates');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe('POST /api/report-card-templates', () => {
  test('creates with revision 1', async () => {
    const res = await supertest(buildApp()).post('/api/report-card-templates').send({ name: 'Cambridge Layout', curriculumTag: 'cambridge' });
    expect(res.status).toBe(201);
    expect(res.body.data.revision).toBe(1);
    expect(res.body.data.isDefault).toBe(false);
  });

  test('rejects an invalid curriculumTag', async () => {
    const res = await supertest(buildApp()).post('/api/report-card-templates').send({ name: 'X', curriculumTag: 'not_a_real_tag' });
    expect(res.status).toBe(422);
  });

  test('setting isDefault:true clears other defaults in the same (school-wide) scope', async () => {
    mockStore = makeStore([
      { id: 'tpl_old', schoolId: SCHOOL, sectionId: null, isDefault: true, revision: 1 },
    ]);
    const res = await supertest(buildApp()).post('/api/report-card-templates').send({ name: 'New Default', isDefault: true });
    expect(res.status).toBe(201);
    const old = mockStore._docs().find(d => d.id === 'tpl_old');
    expect(old.isDefault).toBe(false);
  });

  test('setting isDefault:true for a sectionId does not clear the school-wide default', async () => {
    mockStore = makeStore([
      { id: 'tpl_school', schoolId: SCHOOL, sectionId: null, isDefault: true, revision: 1 },
    ]);
    const res = await supertest(buildApp()).post('/api/report-card-templates').send({ name: 'Section Default', sectionId: 'sec_a', isDefault: true });
    expect(res.status).toBe(201);
    const school = mockStore._docs().find(d => d.id === 'tpl_school');
    expect(school.isDefault).toBe(true);
  });
});

describe('PUT /api/report-card-templates/:id', () => {
  test('bumps revision on every update', async () => {
    mockStore = makeStore([
      { id: 'tpl_1', schoolId: SCHOOL, sectionId: null, isDefault: false, revision: 1, name: 'Old Name' },
    ]);
    const res = await supertest(buildApp()).put('/api/report-card-templates/tpl_1').send({ name: 'New Name' });
    expect(res.status).toBe(200);
    expect(res.body.data.revision).toBe(2);
    expect(res.body.data.name).toBe('New Name');
  });

  test('404s for an unknown id', async () => {
    const res = await supertest(buildApp()).put('/api/report-card-templates/nope').send({ name: 'x' });
    expect(res.status).toBe(404);
  });

  test('re-scopes isDefault clearing when sectionId changes in the same request', async () => {
    mockStore = makeStore([
      { id: 'tpl_1', schoolId: SCHOOL, sectionId: 'sec_a', isDefault: false, revision: 1, name: 'Moving' },
      { id: 'tpl_2', schoolId: SCHOOL, sectionId: 'sec_b', isDefault: true,  revision: 1, name: 'Existing sec_b default' },
    ]);
    const res = await supertest(buildApp()).put('/api/report-card-templates/tpl_1').send({ sectionId: 'sec_b', isDefault: true });
    expect(res.status).toBe(200);
    const other = mockStore._docs().find(d => d.id === 'tpl_2');
    expect(other.isDefault).toBe(false);
  });
});

describe('DELETE /api/report-card-templates/:id', () => {
  test('blocked while the template is the default for its scope', async () => {
    mockStore = makeStore([
      { id: 'tpl_1', schoolId: SCHOOL, sectionId: null, isDefault: true, revision: 1 },
    ]);
    const res = await supertest(buildApp()).delete('/api/report-card-templates/tpl_1');
    expect(res.status).toBe(400);
    expect(mockStore._docs()).toHaveLength(1);
  });

  test('succeeds for a non-default template', async () => {
    mockStore = makeStore([
      { id: 'tpl_1', schoolId: SCHOOL, sectionId: null, isDefault: false, revision: 1 },
    ]);
    const res = await supertest(buildApp()).delete('/api/report-card-templates/tpl_1');
    expect(res.status).toBe(200);
    expect(mockStore._docs()).toHaveLength(0);
  });

  test('404s for an unknown id', async () => {
    const res = await supertest(buildApp()).delete('/api/report-card-templates/nope');
    expect(res.status).toBe(404);
  });
});
