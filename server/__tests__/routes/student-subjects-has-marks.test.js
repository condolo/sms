/* ============================================================
   server/routes/student-subjects.js — unenroll warns before
   orphaning recorded marks

   Reported directly: a student was unenrolled from a subject that
   already had marks recorded against her, with zero warning —
   DELETE /:id deleted the enrollment unconditionally, never checking
   assessment_marks first. Fixed: it now counts marks for that
   studentId+subjectId and, unless the caller passes ?force=true
   (the client re-sends this once the user confirms a warning
   dialog), returns 409 HAS_MARKS instead of deleting. The marks
   themselves are never touched either way — this only gates the
   enrollment-record delete.

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
    find:           (filter) => mockChain(docs().filter(d => matches(d, filter))),
    findOne:        (filter) => mockChain(docs().find(d => matches(d, filter)) ?? null),
    countDocuments: async (filter) => docs().filter(d => matches(d, filter)).length,
    deleteOne:      async (filter) => {
      const idx = docs().findIndex(d => matches(d, filter));
      if (idx >= 0) docs().splice(idx, 1);
      return { deletedCount: idx >= 0 ? 1 : 0 };
    },
  };
}
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (col) => mockCollFor(col),
}));

const express   = require('express');
const supertest = require('supertest');
const studentSubjectsRouter = require('../../routes/student-subjects');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/student-subjects', studentSubjectsRouter);
  return app;
}

beforeEach(() => {
  mockStores = {
    student_subjects: [
      { id: 'enr_marked',   schoolId: SCHOOL, studentId: 'stu_1', subjectId: 'sub_1' },
      { id: 'enr_unmarked', schoolId: SCHOOL, studentId: 'stu_2', subjectId: 'sub_1' },
    ],
    assessment_marks: [
      { schoolId: SCHOOL, studentId: 'stu_1', subjectId: 'sub_1', rawScore: 94 },
      { schoolId: SCHOOL, studentId: 'stu_1', subjectId: 'sub_1', rawScore: 92 },
    ],
  };
});

describe('DELETE /api/student-subjects/:id — has-marks warning', () => {
  test('blocks with 409 HAS_MARKS when the student already has marks for this subject', async () => {
    const res = await supertest(buildApp()).delete('/api/student-subjects/enr_marked');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_MARKS');
    expect(res.body.error.markCount).toBe(2);
    // Not deleted.
    expect(mockStores.student_subjects.find(e => e.id === 'enr_marked')).toBeTruthy();
  });

  test('?force=true proceeds with the delete despite existing marks', async () => {
    const res = await supertest(buildApp()).delete('/api/student-subjects/enr_marked?force=true');
    expect(res.status).toBe(200);
    expect(mockStores.student_subjects.find(e => e.id === 'enr_marked')).toBeFalsy();
    // Marks themselves are left untouched.
    expect(mockStores.assessment_marks.length).toBe(2);
  });

  test('deletes immediately, no warning, when the student has no marks for this subject', async () => {
    const res = await supertest(buildApp()).delete('/api/student-subjects/enr_unmarked');
    expect(res.status).toBe(200);
    expect(mockStores.student_subjects.find(e => e.id === 'enr_unmarked')).toBeFalsy();
  });

  test('404s for an enrollment that does not exist', async () => {
    const res = await supertest(buildApp()).delete('/api/student-subjects/not_a_real_id');
    expect(res.status).toBe(404);
  });
});
