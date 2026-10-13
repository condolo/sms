/* ============================================================
   server/routes/rc-templates.js — schema extensions (2026-10):
   per-indicator maxScore, per-subject performanceBands override,
   and section-scoped isDefault (mirroring report-card-templates.js's
   own isDefault convention). Plus server/utils/rc-template-scale.js's
   resolveRcTemplate — explicit classIds beats section default.

   rbac is mocked as a pass-through here (schema/business-logic focus,
   same split as students.test.js vs students-sensitive-permissions.test.js)
   — permission enforcement itself is covered by rc-templates-rbac.test.js.
   All DB calls are an in-memory fake with real filter matching, not a
   static stub, so isDefault-clearing and classIds-membership queries are
   actually exercised.
   ============================================================ */

const SCHOOL_A = 'school_A';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));

/* ── Tiny in-memory store with real(-ish) Mongo filter semantics ── */
let STORE = [];
function matches(doc, filter) {
  for (const [key, cond] of Object.entries(filter)) {
    const val = doc[key];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$ne' in cond && val === cond.$ne) return false;
    } else if (Array.isArray(val)) {
      // Mongoose array-field semantics: `classIds: 'x'` matches when 'x' is AN ELEMENT of the array.
      if (!val.includes(cond)) return false;
    } else if (val !== cond) {
      return false;
    }
  }
  return true;
}
const mockRcTemplatesColl = {
  find:   (filter = {}) => ({
    sort:   function () { return this; },
    select: function () { return this; },
    lean:   () => Promise.resolve(STORE.filter(d => matches(d, filter))),
  }),
  findOne: (filter = {}) => ({
    select: function () { return this; },
    lean:   () => Promise.resolve(STORE.find(d => matches(d, filter)) ?? null),
  }),
  create: (doc) => {
    STORE.push({ ...doc });
    return Promise.resolve({ ...doc, toObject: () => doc });
  },
  updateMany: (filter, update) => {
    STORE.forEach(d => { if (matches(d, filter)) Object.assign(d, update.$set); });
    return Promise.resolve({});
  },
  findOneAndUpdate: (filter, update, _opts) => {
    const doc = STORE.find(d => matches(d, filter));
    if (doc) Object.assign(doc, update);
    return { lean: () => Promise.resolve(doc ? { ...doc } : null) };
  },
  findOneAndDelete: (filter) => {
    const idx = STORE.findIndex(d => matches(d, filter));
    if (idx === -1) return Promise.resolve(null);
    const [removed] = STORE.splice(idx, 1);
    return Promise.resolve(removed);
  },
};

jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'rc_templates') return mockRcTemplatesColl;
    if (collection === 'classes') {
      return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve({ sectionKey: 'kg' }) }) }) };
    }
    if (collection === 'sections') {
      return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve({ id: 'sec_kg' }) }) }) };
    }
    return { findOne: () => ({ lean: () => Promise.resolve(null) }) };
  },
}));

const express          = require('express');
const supertest        = require('supertest');
const rcTemplatesRouter = require('../../routes/rc-templates');
const { resolveRcTemplate, effectiveBandsForSubject } = require('../../utils/rc-template-scale');

function buildApp(jwtUser) {
  global.__mockJwtUser = jwtUser;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.jwtUser = jwtUser; next(); });
  app.use('/api/rc-templates', rcTemplatesRouter);
  return app;
}

const ADMIN = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
const app = buildApp(ADMIN);

beforeEach(() => { STORE = []; });

describe('indicator maxScore', () => {
  test('defaults to 10 when omitted', async () => {
    const res = await supertest(app).post('/api/rc-templates').send({
      name: 'KG Template',
      performanceBands: [{ label: 'Good', grade: 'B' }],
      subjects: [{ subjectId: 'subj_science', name: 'Science', indicators: [{ text: 'Define collision' }] }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.subjects[0].indicators[0].maxScore).toBe(10);
  });

  test('is preserved when explicitly set (confirmed real samples go up to 18+)', async () => {
    const res = await supertest(app).post('/api/rc-templates').send({
      name: 'ICT Template',
      performanceBands: [{ label: 'Good', grade: 'B' }],
      subjects: [{ subjectId: 'subj_ict', name: 'ICT', indicators: [{ text: 'Identify computer parts', maxScore: 20 }] }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.subjects[0].indicators[0].maxScore).toBe(20);
  });
});

describe('per-subject performanceBands override', () => {
  test('a subject with no override falls back to the template bands', () => {
    const template = {
      performanceBands: [{ id: 'b1', label: 'Excellent', grade: 'A' }],
      subjects: [{ id: 's1', name: 'Literacy' }],
    };
    expect(effectiveBandsForSubject(template, 's1')).toEqual(template.performanceBands);
  });

  test('a subject WITH an override uses its own bands entirely, not merged', () => {
    const template = {
      performanceBands: [{ id: 'b1', label: 'Excellent', defaultScore: 6, grade: 'A' }],
      subjects: [{ id: 's1', name: 'Science', performanceBands: [{ id: 'b2', label: 'Excellent', defaultScore: 4, grade: 'A' }] }],
    };
    expect(effectiveBandsForSubject(template, 's1')).toEqual(template.subjects[0].performanceBands);
  });
});

describe('isDefault — section-scoped, mirrors report-card-templates.js', () => {
  test('isDefault:true without a sectionId is rejected', async () => {
    const res = await supertest(app).post('/api/rc-templates').send({
      name: 'No Section', isDefault: true,
      performanceBands: [{ label: 'Good', grade: 'B' }],
    });
    expect(res.status).toBe(422);
  });

  test('creating a new default clears the PREVIOUS default in the same section', async () => {
    await supertest(app).post('/api/rc-templates').send({
      name: 'KG Template A', sectionId: 'sec_kg', isDefault: true,
      performanceBands: [{ label: 'Good', grade: 'B' }],
    });
    await supertest(app).post('/api/rc-templates').send({
      name: 'KG Template B', sectionId: 'sec_kg', isDefault: true,
      performanceBands: [{ label: 'Good', grade: 'B' }],
    });
    const defaults = STORE.filter(t => t.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe('KG Template B');
  });

  test('a default in a DIFFERENT section is untouched', async () => {
    await supertest(app).post('/api/rc-templates').send({
      name: 'KG Default', sectionId: 'sec_kg', isDefault: true,
      performanceBands: [{ label: 'Good', grade: 'B' }],
    });
    await supertest(app).post('/api/rc-templates').send({
      name: 'Primary Default', sectionId: 'sec_primary', isDefault: true,
      performanceBands: [{ label: 'Good', grade: 'B' }],
    });
    expect(STORE.filter(t => t.isDefault)).toHaveLength(2);
  });

  test('cannot delete the default template for its section', async () => {
    const create = await supertest(app).post('/api/rc-templates').send({
      name: 'KG Default', sectionId: 'sec_kg', isDefault: true,
      performanceBands: [{ label: 'Good', grade: 'B' }],
    });
    const res = await supertest(app).delete(`/api/rc-templates/${create.body.data.id}`);
    expect(res.status).toBe(400);
    expect(STORE).toHaveLength(1);
  });
});

describe('resolveRcTemplate — explicit classIds beats section default', () => {
  test('an explicit classIds match wins even when a section default also exists', async () => {
    await supertest(app).post('/api/rc-templates').send({
      name: 'Section Default', sectionId: 'sec_kg', isDefault: true, status: 'active',
      performanceBands: [{ label: 'Good', grade: 'B' }],
    });
    await supertest(app).post('/api/rc-templates').send({
      name: 'Class-Specific', classIds: ['classKG3A'], status: 'active',
      performanceBands: [{ label: 'Good', grade: 'B' }],
    });
    const resolved = await resolveRcTemplate(SCHOOL_A, 'classKG3A');
    expect(resolved.name).toBe('Class-Specific');
  });

  test('falls back to the section default when no class is explicitly listed', async () => {
    await supertest(app).post('/api/rc-templates').send({
      name: 'Section Default', sectionId: 'sec_kg', isDefault: true, status: 'active',
      performanceBands: [{ label: 'Good', grade: 'B' }],
    });
    const resolved = await resolveRcTemplate(SCHOOL_A, 'classKG3B');
    expect(resolved.name).toBe('Section Default');
  });

  test('returns null when neither an explicit match nor a section default exists', async () => {
    const resolved = await resolveRcTemplate(SCHOOL_A, 'classUnrelated');
    expect(resolved).toBeNull();
  });
});

describe('GET /resolve — the Markbook-facing endpoint', () => {
  test('returns the resolved template for a class with a section default', async () => {
    await supertest(app).post('/api/rc-templates').send({
      name: 'KG Default', sectionId: 'sec_kg', isDefault: true, status: 'active',
      performanceBands: [{ label: 'Good', grade: 'B' }],
    });
    const res = await supertest(app).get('/api/rc-templates/resolve').query({ classId: 'classKG3A' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('KG Default');
  });

  test('returns null (not a 404) for a class with no indicator template — ordinary numeric Markbook applies', async () => {
    const res = await supertest(app).get('/api/rc-templates/resolve').query({ classId: 'classPrimary1' });
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});
