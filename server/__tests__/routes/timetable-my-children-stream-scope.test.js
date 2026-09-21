/* ============================================================
   server/routes/timetable.js — GET /my-children (parent portal)
   is stream-scoped (2026-09)

   Found while investigating whether a class with streams needs its
   timetable viewed/edited per stream (see AddSlotSlideOver's own
   per-stream model, and Attendance's v5.101.0 per-stream registers):
   this route fetched a child's timetable slots by classId ALONE, with
   no streamId filter at all. A parent whose child is in one stream saw
   EVERY stream's lessons for that class merged together — not just a
   display quirk, real, wrong subject/teacher/room information for that
   specific child.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A  = 'school_A';
const CHILD_1   = 'stu_1';
const CLASS_ID  = 'cls_yr2';
const DIAMOND   = 'strm_diamond';
const SAPPHIRE  = 'strm_sapphire';

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

function mockChain(result) {
  const c = { select: () => c, sort: () => c, limit: () => c, lean: () => Promise.resolve(result) };
  return c;
}
function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatches(doc, sub));
    if (k === '$in') return true; // handled by caller-level find, not per-field here
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$exists' in v) {
        const has = Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined;
        return v.$exists ? has : !has;
      }
      return true;
    }
    return doc[k] === v;
  });
}
function mockCollection(seed = []) {
  return {
    find:    jest.fn((filter) => mockChain(seed.filter(d => mockMatches(d, filter)))),
    findOne: jest.fn((filter) => mockChain(seed.find(d => mockMatches(d, filter)) ?? null)),
  };
}

let mockSchoolDoc, mockStudents, mockTimetableDocs;
jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: jest.fn(() => mockChain(mockSchoolDoc)) };
    return mockCollection([]);
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'students')  return mockCollection(mockStudents);
    if (collection === 'timetable') return mockCollection(mockTimetableDocs);
    return mockCollection([]);
  },
}));

const express         = require('express');
const supertest       = require('supertest');
const timetableRouter = require('../../routes/timetable');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/timetable', timetableRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_parent', schoolId: SCHOOL_A, role: 'parent', guardianOf: [CHILD_1] };
  mockSchoolDoc = { id: SCHOOL_A, timetableStatus: { published: true, termLabel: 'Term 2' } };
  mockStudents = [
    { id: CHILD_1, schoolId: SCHOOL_A, firstName: 'Amara', lastName: 'Osei', classId: CLASS_ID, className: 'Year 2', streamId: DIAMOND },
  ];
  mockTimetableDocs = [];
});

describe('GET /api/timetable/my-children — stream scoping', () => {
  test("a sibling stream's slot is NOT included for this child", async () => {
    mockTimetableDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, streamId: SAPPHIRE, day: 'monday', period: '1', subject: 'Science', isActive: true },
    ];
    const res = await supertest(buildApp()).get('/api/timetable/my-children');
    expect(res.status).toBe(200);
    expect(res.body.data.children[0].slots).toHaveLength(0);
  });

  test("this child's OWN stream's slot IS included", async () => {
    mockTimetableDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, streamId: DIAMOND, day: 'monday', period: '1', subject: 'Science', isActive: true },
    ];
    const res = await supertest(buildApp()).get('/api/timetable/my-children');
    expect(res.body.data.children[0].slots).toHaveLength(1);
  });

  test('a legacy whole-class slot (no streamId at all) is still included', async () => {
    mockTimetableDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, day: 'monday', period: '1', subject: 'Assembly', isActive: true },
    ];
    const res = await supertest(buildApp()).get('/api/timetable/my-children');
    expect(res.body.data.children[0].slots).toHaveLength(1);
  });

  test('a child with no streamId (no stream assigned) only sees whole-class slots', async () => {
    mockStudents = [
      { id: CHILD_1, schoolId: SCHOOL_A, firstName: 'Amara', lastName: 'Osei', classId: CLASS_ID, className: 'Year 2', streamId: null },
    ];
    mockTimetableDocs = [
      { schoolId: SCHOOL_A, classId: CLASS_ID, streamId: DIAMOND, day: 'monday', period: '1', subject: 'Science', isActive: true },
      { schoolId: SCHOOL_A, classId: CLASS_ID, day: 'monday', period: '2', subject: 'Assembly', isActive: true },
    ];
    const res = await supertest(buildApp()).get('/api/timetable/my-children');
    expect(res.body.data.children[0].slots).toHaveLength(1);
    expect(res.body.data.children[0].slots[0].subject).toBe('Assembly');
  });
});
