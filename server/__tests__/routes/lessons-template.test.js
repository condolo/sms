/* ============================================================
   server/routes/lessons.js — GET/PUT /template (2026-09)

   Requested directly after the fixed-schema Lesson Plan template
   shipped: schools want to enable/disable/relabel/require each builtin
   field and add their own extra fields, configured by whoever holds the
   new lessons__template permission (Settings → Roles & Permissions →
   Lessons) — not hardcoded to admin.

   This file proves: (1) PUT is enforced with hasExplicitSubGrant, no
   coarse lessons:update fallback; (2) the real floor (admin/superadmin/
   principal/deputy_principal/deputy) bypasses unconditionally; (3) GET
   merges a saved template with BUILTIN_FIELDS' current defaults; (4) a
   saved template round-trips through GET correctly, including a custom
   field the school added.

   Uses the REAL rbac.js (hasExplicitSubGrant is not mocked) — only its
   own DB read (role_permissions) is mocked, same discipline as
   students-sensitive-permissions.test.js.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

let mockRolePerms = {};
let mockSchoolDoc = { id: SCHOOL_A };

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'role_permissions') {
      return { findOne: () => ({ lean: () => Promise.resolve({ permissions: mockRolePerms }) }) };
    }
    if (c === 'schools') {
      return {
        findOne:  () => ({ lean: () => Promise.resolve(mockSchoolDoc) }),
        updateOne: (_filter, update) => { Object.assign(mockSchoolDoc, update.$set); return Promise.resolve({ matchedCount: 1 }); },
      };
    }
    return { find: () => ({ lean: () => Promise.resolve([]) }), findOne: () => ({ lean: () => Promise.resolve(null) }) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: () => ({
    find: () => ({ sort: () => ({ lean: () => Promise.resolve([]) }), lean: () => Promise.resolve([]) }),
    findOne: () => ({ lean: () => Promise.resolve(null) }),
  }),
}));

const express       = require('express');
const supertest     = require('supertest');
const lessonsRouter = require('../../routes/lessons');
const { invalidatePermCache } = require('../../middleware/rbac');

function buildApp(jwtUser) {
  global.__mockJwtUser = jwtUser;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.jwtUser = jwtUser; next(); });
  app.use('/api/lessons', lessonsRouter);
  return app;
}

beforeEach(() => {
  invalidatePermCache(SCHOOL_A);
  mockRolePerms = {};
  mockSchoolDoc = { id: SCHOOL_A };
});

const NON_FLOOR = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
const ADMIN     = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
const DEPUTY    = { userId: 'usr_deputy', schoolId: SCHOOL_A, role: 'deputy_principal', roles: ['deputy_principal'] };

const VALID_BODY = {
  fields: [
    { key: 'objectives', label: 'Lesson Objectives', enabled: true, required: true, order: 0 },
    { key: 'activities', label: 'Learning Activities', enabled: true, required: false, order: 1 },
    { key: 'resources', label: 'Resources / References', enabled: false, required: false, order: 2 },
    { key: 'remarks', label: 'Remarks', enabled: true, required: false, order: 3 },
    { key: 'diff_low', label: 'Low Ability', enabled: true, required: false, order: 4 },
    { key: 'diff_middle', label: 'Middle Ability', enabled: true, required: false, order: 5 },
    { key: 'diff_high', label: 'High Ability', enabled: true, required: false, order: 6 },
    { key: 'assessment', label: 'Assessment & Evaluation', enabled: true, required: false, order: 7 },
    { key: 'homework', label: 'Homework', enabled: true, required: false, order: 8 }, // relabeled from default
    { key: 'reflection_went_well', label: 'What went well', enabled: true, required: false, order: 9 },
    { key: 'reflection_better_if', label: 'Even better if', enabled: true, required: false, order: 10 },
    { key: 'reflection_improvement', label: 'Areas for improvement', enabled: true, required: false, order: 11 },
    { key: 'custom_links', label: 'Cross-curricular links', enabled: true, required: false, order: 12 },
  ],
};

describe('GET /api/lessons/template', () => {
  test('with no saved template, returns BUILTIN_FIELDS defaults — all enabled, none required', async () => {
    mockRolePerms = { lessons: ['read'] };
    const res = await supertest(buildApp(NON_FLOOR)).get('/api/lessons/template');
    expect(res.status).toBe(200);
    expect(res.body.data.fields).toHaveLength(12);
    expect(res.body.data.fields.every(f => f.enabled === true)).toBe(true);
    expect(res.body.data.fields.every(f => f.required === false)).toBe(true);
  });

  test('a saved template round-trips, including a custom field the school added', async () => {
    mockRolePerms = { lessons: ['read'] };
    mockSchoolDoc.lessonPlanTemplate = VALID_BODY;
    const res = await supertest(buildApp(NON_FLOOR)).get('/api/lessons/template');
    expect(res.status).toBe(200);
    const resources = res.body.data.fields.find(f => f.key === 'resources');
    expect(resources.enabled).toBe(false);
    const custom = res.body.data.fields.find(f => f.key === 'custom_links');
    expect(custom).toBeTruthy();
    expect(custom.label).toBe('Cross-curricular links');
    expect(custom.builtin).toBe(false);
  });
});

describe('PUT /api/lessons/template — permission gating', () => {
  test('a non-floor role with plain lessons:update but NO explicit template grant is forbidden', async () => {
    mockRolePerms = { lessons: ['read', 'create', 'update'] }; // has "Edit Lesson Plan" — must not imply template config
    const res = await supertest(buildApp(NON_FLOOR)).put('/api/lessons/template').send(VALID_BODY);
    expect(res.status).toBe(403);
  });

  test('a non-floor role WITH explicit lessons__template grant succeeds', async () => {
    mockRolePerms = { lessons: ['read', 'update'], lessons__template: ['read', 'update'] };
    const res = await supertest(buildApp(NON_FLOOR)).put('/api/lessons/template').send(VALID_BODY);
    expect(res.status).toBe(200);
  });

  test('admin (floor) succeeds via the floor bypass alone — no lessons__template grant needed', async () => {
    mockRolePerms = { lessons: ['read', 'update'] }; // real coarse grant so the outer rbac() gate passes; lessons__template deliberately absent
    const res = await supertest(buildApp(ADMIN)).put('/api/lessons/template').send(VALID_BODY);
    expect(res.status).toBe(200);
  });

  test('deputy_principal (floor) succeeds via the floor bypass alone', async () => {
    mockRolePerms = { lessons: ['read', 'update'] };
    const res = await supertest(buildApp(DEPUTY)).put('/api/lessons/template').send(VALID_BODY);
    expect(res.status).toBe(200);
  });

  test('a saved template is actually persisted and re-readable', async () => {
    mockRolePerms = { lessons: ['read', 'update'] };
    await supertest(buildApp(ADMIN)).put('/api/lessons/template').send(VALID_BODY);
    const res = await supertest(buildApp(ADMIN)).get('/api/lessons/template');
    const homework = res.body.data.fields.find(f => f.key === 'homework');
    expect(homework.label).toBe('Homework'); // relabeled from default "Lesson / Week Assignment"
  });

  test('rejects a duplicate field key', async () => {
    mockRolePerms = { lessons: ['read', 'update'] };
    const dup = { fields: [...VALID_BODY.fields, { key: 'objectives', label: 'Dup', enabled: true, required: false, order: 13 }] };
    const res = await supertest(buildApp(ADMIN)).put('/api/lessons/template').send(dup);
    expect(res.status).toBe(422);
  });
});
