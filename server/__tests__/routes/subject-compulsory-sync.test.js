/* ============================================================
   Compulsory subjects: counts and Catalog → class sync (v5.276.4)

   Reported (2026-11-18): "a subject is marked compulsory, then you go to a
   specific class and it's not marked compulsory", and "if enrollment for
   maths is 309, it should be the same for any compulsory subject".
   Pins, through the real routes:
     - GET /student-subjects/counts counts active students the way rosters
       are built: every student of a class where the subject is compulsory,
       only enrolled students where it is an elective; leavers never count;
     - two subjects compulsory in the same classes give the same number;
     - POST /class-subjects/apply-catalog previews without writing, then
       brings classes in line with the Catalog (by subject or by class);
     - a class whose subject becomes an elective enrols its active students
       so nobody drops off that subject's roster.
   ============================================================ */
'use strict';

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { userId: 'u_admin', schoolId: 'sch_1', role: 'admin', roles: ['admin'] }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: async () => true }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockDb.model(name),
}));
jest.mock('../../utils/model', () => ({ _model: (name) => mockDb.model(name) }));

const express = require('express');
const supertest = require('supertest');
const AuditService = require('../../services/audit');

const S = 'sch_1';
const app = () => {
  const a = express(); a.use(express.json());
  a.use('/api/class-subjects', require('../../routes/class-subjects'));
  a.use('/api/student-subjects', require('../../routes/student-subjects'));
  return supertest(a);
};

function seed() {
  const st = (id, classId, status = 'active') => ({ id, schoolId: S, classId, status, firstName: id, lastName: 'X' });
  mockDb = createFakeDb({
    classes: [{ id: 'c7', schoolId: S, name: 'Year 7' }, { id: 'c8', schoolId: S, name: 'Year 8' }],
    subjects: [
      { id: 'math', schoolId: S, name: 'Maths',     isCompulsory: true },
      { id: 'eng',  schoolId: S, name: 'English',   isCompulsory: true },
      { id: 'kis',  schoolId: S, name: 'Kiswahili', isCompulsory: true },
      { id: 'fre',  schoolId: S, name: 'French',    isCompulsory: false },
    ],
    students: [st('a', 'c7'), st('b', 'c7'), st('c', 'c7'), st('d', 'c8'), st('e', 'c8'), st('gone', 'c7', 'withdrawn')],
    class_subjects: [
      { id: 'l1', schoolId: S, classId: 'c7', subjectId: 'math', isCompulsoryForClass: true },
      { id: 'l2', schoolId: S, classId: 'c8', subjectId: 'math', isCompulsoryForClass: true },
      { id: 'l3', schoolId: S, classId: 'c7', subjectId: 'eng',  isCompulsoryForClass: true },
      { id: 'l4', schoolId: S, classId: 'c8', subjectId: 'eng',  isCompulsoryForClass: true },
      { id: 'l5', schoolId: S, classId: 'c7', subjectId: 'kis',  isCompulsoryForClass: true },
      { id: 'l6', schoolId: S, classId: 'c8', subjectId: 'kis',  isCompulsoryForClass: false },  // differs from the Catalog
      { id: 'l7', schoolId: S, classId: 'c7', subjectId: 'fre',  isCompulsoryForClass: true },   // differs from the Catalog
    ],
    student_subjects: [
      { id: 'r1', schoolId: S, studentId: 'a',    subjectId: 'math' },    // rows are irrelevant for compulsory
      { id: 'r2', schoolId: S, studentId: 'gone', subjectId: 'math' },    // a leaver never counts
      { id: 'r3', schoolId: S, studentId: 'd',    subjectId: 'kis' },     // elective in Year 8: counts
      { id: 'r4', schoolId: S, studentId: 'a',    subjectId: 'kis' },     // compulsory in Year 7 anyway: once
      { id: 'r5', schoolId: S, studentId: 'd',    subjectId: 'pd' },      // enrolled directly; not on Year 8's curriculum
      { id: 'r6', schoolId: S, studentId: 'e',    subjectId: 'pd' },
      { id: 'r7', schoolId: S, studentId: 'gone', subjectId: 'pd' },      // a leaver still never counts
    ],
  });
}

describe('GET /student-subjects/counts follows rosters', () => {
  beforeEach(seed);
  test('compulsory = every active student of those classes; elective = enrolled only; leavers excluded', async () => {
    const res = await app().get('/api/student-subjects/counts');
    expect(res.status).toBe(200);
    expect(res.body.data.math).toBe(5);
    expect(res.body.data.eng).toBe(5);    // same classes, same number as Maths
    expect(res.body.data.kis).toBe(4);    // Year 7's 3 + Year 8's 1 enrolled
    expect(res.body.data.fre).toBe(3);
  });

  // v5.278.1 (Trinity, 2026-11-23): enrolled through Enroll Class but not on the
  // class curriculum showed "0 enrolled" while the panel listed the learners.
  test('learners enrolled directly count even when the subject is not on their class curriculum', async () => {
    const res = await app().get('/api/student-subjects/counts');
    expect(res.body.data.pd).toBe(2);
    expect(res.body.data.math).toBe(5);   // compulsory counts unchanged
  });
});

describe('POST /class-subjects/apply-catalog', () => {
  beforeEach(() => { seed(); AuditService.log.mockClear(); });

  test('needs a subject or a class', async () => {
    expect((await app().post('/api/class-subjects/apply-catalog').send({})).status).toBe(400);
  });

  test('dry run lists what differs and writes nothing', async () => {
    const res = await app().post('/api/class-subjects/apply-catalog').send({ subjectId: 'kis', dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ applied: false, toCompulsory: 1, toElective: 0, studentsToEnrol: 0 });
    expect(res.body.data.changes).toEqual([expect.objectContaining({ classId: 'c8', className: 'Year 8', subjectName: 'Kiswahili', compulsory: true })]);
    expect(mockDb.data.class_subjects.find(l => l.id === 'l6').isCompulsoryForClass).toBe(false);
  });

  test('by subject: every class offering it follows the Catalog, and counts then agree', async () => {
    const res = await app().post('/api/class-subjects/apply-catalog').send({ subjectId: 'kis' });
    expect(res.body.data.applied).toBe(true);
    expect(mockDb.data.class_subjects.find(l => l.id === 'l6').isCompulsoryForClass).toBe(true);
    expect(AuditService.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'curriculum.apply_catalog' }));
    const counts = (await app().get('/api/student-subjects/counts')).body.data;
    expect(counts.kis).toBe(counts.math);
  });

  test('becoming an elective enrols the class\x27s active students so nobody drops off the roster', async () => {
    const res = await app().post('/api/class-subjects/apply-catalog').send({ subjectId: 'fre' });
    expect(res.body.data).toMatchObject({ applied: true, toElective: 1, studentsToEnrol: 3 });
    expect(mockDb.data.class_subjects.find(l => l.id === 'l7').isCompulsoryForClass).toBe(false);
    const fre = mockDb.data.student_subjects.filter(r => r.subjectId === 'fre').map(r => r.studentId).sort();
    expect(fre).toEqual(['a', 'b', 'c']);                       // the withdrawn student is not enrolled
    expect((await app().get('/api/student-subjects/counts')).body.data.fre).toBe(3);
  });

  test('by class: only that class changes', async () => {
    const res = await app().post('/api/class-subjects/apply-catalog').send({ classId: 'c7' });
    expect(res.body.data.changes.map(c => c.subjectId)).toEqual(['fre']);
    expect(mockDb.data.class_subjects.find(l => l.id === 'l6').isCompulsoryForClass).toBe(false);   // Year 8 untouched
  });

  test('nothing to change: no write, no audit entry', async () => {
    const res = await app().post('/api/class-subjects/apply-catalog').send({ subjectId: 'math' });
    expect(res.body.data).toMatchObject({ applied: false, changes: [] });
    expect(AuditService.log).not.toHaveBeenCalled();
  });
});

describe('adding a subject without a flag starts from the Catalog', () => {
  beforeEach(seed);
  test('POST / with no isCompulsoryForClass uses the Catalog setting (what the Curriculum screen now sends)', async () => {
    mockDb.data.class_subjects = mockDb.data.class_subjects.filter(l => l.id !== 'l4');
    const res = await app().post('/api/class-subjects').send({ classId: 'c8', subjectId: 'eng' });
    expect(res.status).toBe(201);
    expect(res.body.data.isCompulsoryForClass).toBe(true);
  });
});
