/* ============================================================
   server/routes/class-subjects.js — catalog-compulsory default inheritance

   Confirmed live (2026-10-15) against the production database: a school
   can mark a subject compulsory in the Catalog (subjects.isCompulsory)
   believing it applies everywhere, while every class_subjects curriculum
   link created afterwards silently defaulted isCompulsoryForClass to
   false regardless — the two flags never agreed unless an admin ALSO
   toggled the per-class flag separately. One real school (Trinitas
   International) had 120 of 134 curriculum links for its 19
   catalog-compulsory subjects sitting at isCompulsoryForClass:false.
   This is the exact reason the Markbook never asked those teachers to
   pick a stream: per the system's real operative flag, those subjects
   were electives, not compulsory, regardless of what the Catalog said.

   Fixed: POST / and POST /bulk now default a NEW link's
   isCompulsoryForClass from the subject's own catalog isCompulsory flag
   when the caller doesn't explicitly specify one. An explicit true/false
   in the request body still always wins — a class can still deliberately
   diverge from the catalog default.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'sch_1';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));

function mockChain(result) {
  return { lean: () => Promise.resolve(result), select: () => mockChain(result), sort: () => mockChain(result), limit: () => mockChain(result) };
}
function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => matches(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$exists' in v) return (doc[k] !== undefined) === v.$exists;
      if ('$in' in v) return v.$in.includes(doc[k]);
    }
    return doc[k] === v;
  });
}
let mockStores;
function mockCollFor(col) {
  const docs = () => mockStores[col] || (mockStores[col] = []);
  return {
    find:    (filter) => mockChain(docs().filter(d => matches(d, filter))),
    findOne: (filter) => mockChain(docs().find(d => matches(d, filter)) ?? null),
    create:  async (doc) => { const d = { ...doc }; docs().push(d); return { ...d, toObject: () => d }; },
    insertMany: async (newDocs) => { docs().push(...newDocs); return newDocs; },
  };
}
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (col) => mockCollFor(col),
}));

const express   = require('express');
const supertest = require('supertest');
const classSubjectsRouter = require('../../routes/class-subjects');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/class-subjects', classSubjectsRouter);
  return app;
}

beforeEach(() => {
  mockStores = {
    classes: [{ id: 'cls_1', schoolId: SCHOOL, name: 'Form 1A' }],
    subjects: [
      { id: 'sub_compulsory', schoolId: SCHOOL, name: 'Mathematics', isCompulsory: true, isActive: true },
      { id: 'sub_elective',   schoolId: SCHOOL, name: 'Art',         isCompulsory: false, isActive: true },
    ],
    class_subjects: [],
  };
});

describe('POST /api/class-subjects — inherits catalog isCompulsory when not specified', () => {
  test('a catalog-compulsory subject defaults the new link to compulsory', async () => {
    const res = await supertest(buildApp()).post('/api/class-subjects').send({ classId: 'cls_1', subjectId: 'sub_compulsory' });
    expect(res.status).toBe(201);
    expect(res.body.data.isCompulsoryForClass).toBe(true);
  });

  test('a catalog-elective subject defaults the new link to elective', async () => {
    const res = await supertest(buildApp()).post('/api/class-subjects').send({ classId: 'cls_1', subjectId: 'sub_elective' });
    expect(res.status).toBe(201);
    expect(res.body.data.isCompulsoryForClass).toBe(false);
  });

  test('an explicit false overrides a catalog-compulsory default', async () => {
    const res = await supertest(buildApp()).post('/api/class-subjects')
      .send({ classId: 'cls_1', subjectId: 'sub_compulsory', isCompulsoryForClass: false });
    expect(res.status).toBe(201);
    expect(res.body.data.isCompulsoryForClass).toBe(false);
  });

  test('an explicit true overrides a catalog-elective default', async () => {
    const res = await supertest(buildApp()).post('/api/class-subjects')
      .send({ classId: 'cls_1', subjectId: 'sub_elective', isCompulsoryForClass: true });
    expect(res.status).toBe(201);
    expect(res.body.data.isCompulsoryForClass).toBe(true);
  });
});

describe('POST /api/class-subjects/bulk — same catalog-default inheritance, per subject', () => {
  test('mixed batch: compulsory and elective subjects each inherit their own catalog flag', async () => {
    const res = await supertest(buildApp()).post('/api/class-subjects/bulk').send({
      classId: 'cls_1',
      subjects: [{ subjectId: 'sub_compulsory' }, { subjectId: 'sub_elective' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.assigned).toBe(2);
    const saved = mockStores.class_subjects;
    expect(saved.find(l => l.subjectId === 'sub_compulsory').isCompulsoryForClass).toBe(true);
    expect(saved.find(l => l.subjectId === 'sub_elective').isCompulsoryForClass).toBe(false);
  });

  test('an explicit per-subject flag in the bulk body overrides the catalog default', async () => {
    const res = await supertest(buildApp()).post('/api/class-subjects/bulk').send({
      classId: 'cls_1',
      subjects: [{ subjectId: 'sub_compulsory', isCompulsoryForClass: false }],
    });
    expect(res.status).toBe(200);
    expect(mockStores.class_subjects.find(l => l.subjectId === 'sub_compulsory').isCompulsoryForClass).toBe(false);
  });
});
