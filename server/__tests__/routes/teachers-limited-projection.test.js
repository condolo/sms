/* ============================================================
   server/routes/teachers.js — LIMITED_PROJECTION (2026-10-19)

   Reported directly: teachers could see a colleague's qualifications
   and specialization through the ordinary Teachers list/detail view —
   HR profile content, not the "name, classes, subjects" a colleague
   directory should show. Those two fields sat in LIMITED_PROJECTION
   by oversight (never a deliberate decision to expose them), even
   though FULL_PROJECTION-only fields like email/phone/dateOfBirth
   were already correctly excluded from the limited view.
   ============================================================ */
'use strict';

const SCHOOL = 'sch_1';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = req.jwtUser ?? global.__mockJwtUser; next(); },
}));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

let mockCanViewFull = false;
jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(),
  hasPermission: jest.fn(() => Promise.resolve(mockCanViewFull)),
}));

const mockTeacherDoc = {
  id: 'tch_1', schoolId: SCHOOL, firstName: 'Mary', lastName: 'Kariuki',
  title: 'Ms.', photo: null, role: 'coach', staffType: 'teacher', status: 'active',
  extraRoles: [], subjects: [], classes: ['cls_1'], departmentId: 'dept_pe',
  qualifications: 'BSc Physical Education, UoN', specialization: 'Athletics',
  email: 'mary.kariuki@example.test', phone: '+254700000000', dateOfBirth: '1990-01-01',
};

jest.mock('../../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({
    find: (filter) => ({
      sort: function () { return this; }, skip: function () { return this; }, limit: function () { return this; },
      select: (projection) => ({
        lean: () => {
          // Mimic a real Mongo inclusive projection string: only the
          // listed fields survive.
          if (projection === '-__v') return Promise.resolve([{ ...mockTeacherDoc }]);
          const fields = projection.trim().split(/\s+/);
          const picked = {};
          for (const f of fields) if (f in mockTeacherDoc) picked[f] = mockTeacherDoc[f];
          return Promise.resolve([picked]);
        },
      }),
    }),
    countDocuments: () => Promise.resolve(1),
    findOne: (filter) => ({
      select: (projection) => ({
        lean: () => {
          if (!filter.id || filter.id === mockTeacherDoc.id) {
            if (projection === '-__v') return Promise.resolve({ ...mockTeacherDoc });
            const fields = projection.trim().split(/\s+/);
            const picked = {};
            for (const f of fields) if (f in mockTeacherDoc) picked[f] = mockTeacherDoc[f];
            return Promise.resolve(picked);
          }
          return Promise.resolve(null);
        },
      }),
    }),
  })),
  tenantContext: jest.fn(() => ({})),
}));

const express   = require('express');
const supertest = require('supertest');
const teachersRouter = require('../../routes/teachers');

function buildApp(jwtUser) {
  global.__mockJwtUser = jwtUser;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.jwtUser = jwtUser; next(); });
  app.use('/api/teachers', teachersRouter);
  return app;
}

const PLAIN_TEACHER = { userId: 'u_mary', schoolId: SCHOOL, role: 'coach', roles: ['coach'] };

beforeEach(() => { mockCanViewFull = false; });

describe('GET /teachers — colleague view (no teachers:update permission)', () => {
  test('excludes qualifications and specialization', async () => {
    const res = await supertest(buildApp(PLAIN_TEACHER)).get('/api/teachers');
    expect(res.status).toBe(200);
    const teacher = res.body.data[0];
    expect(teacher.qualifications).toBeUndefined();
    expect(teacher.specialization).toBeUndefined();
  });

  test('still includes name, classes, subjects, and department', async () => {
    const res = await supertest(buildApp(PLAIN_TEACHER)).get('/api/teachers');
    const teacher = res.body.data[0];
    expect(teacher.firstName).toBe('Mary');
    expect(teacher.lastName).toBe('Kariuki');
    expect(teacher.classes).toEqual(['cls_1']);
    expect(teacher.departmentId).toBe('dept_pe');
  });

  test('also excludes contact details and date of birth', async () => {
    const res = await supertest(buildApp(PLAIN_TEACHER)).get('/api/teachers');
    const teacher = res.body.data[0];
    expect(teacher.email).toBeUndefined();
    expect(teacher.phone).toBeUndefined();
    expect(teacher.dateOfBirth).toBeUndefined();
  });

  test('GET /:id applies the same limited projection', async () => {
    const res = await supertest(buildApp(PLAIN_TEACHER)).get('/api/teachers/tch_1');
    expect(res.status).toBe(200);
    expect(res.body.data.qualifications).toBeUndefined();
    expect(res.body.data.specialization).toBeUndefined();
  });
});

describe('GET /teachers — a role granted teachers:update', () => {
  beforeEach(() => { mockCanViewFull = true; });

  test('sees the full profile, including qualifications', async () => {
    const res = await supertest(buildApp(PLAIN_TEACHER)).get('/api/teachers');
    const teacher = res.body.data[0];
    expect(teacher.qualifications).toBe('BSc Physical Education, UoN');
    expect(teacher.specialization).toBe('Athletics');
    expect(teacher.email).toBe('mary.kariuki@example.test');
  });
});
