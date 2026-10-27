/* ============================================================
   server/routes/parent-portal.js — GET /dashboard/:childId attendance
   (reported directly 2026-10-27)

   "is the parents portal live really, pulling data as required... not
   just attendance" — a real Trinitas parent saw 0 present/0 absent/0
   late/0 total for a child with 18 real attendance records that term.
   Root cause: `attendance` documents have no `academicYear` field at all
   (confirmed directly against live production data), so this dashboard's
   filter matched zero documents, always, for every parent, every child,
   every school, since this route shipped. Fixed by scoping to the
   resolved current term's own date range instead (see this route's own
   comment above `attDateFilter`).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';
const PARENT_USER = 'usr_parent';
const CHILD_ID = 'stu_1';
const CLASS_ID = 'cls_4a';

jest.mock('../../middleware/plan', () => ({ planGate: () => (req, _res, next) => next() }));
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => {
    req.jwtUser = { userId: PARENT_USER, schoolId: SCHOOL_A, role: 'parent', studentIds: [CHILD_ID], guardianOf: [] };
    next();
  },
}));
jest.mock('../../utils/timetable-publish', () => ({
  isTimetablePublished: jest.fn(() => Promise.resolve(false)),
  publishedReader: async () => ({ find: () => mockChain([]) }),
}));
jest.mock('../../routes/mpesa', () => ({ _getMpesaConfig: () => null }));
jest.mock('../../routes/messages', () => ({ _inboxQuery: jest.fn(), createDirectMessage: jest.fn() }));
jest.mock('../../routes/weekly-snapshots', () => ({ _helpers: {} }));
jest.mock('../../utils/parent-message-recipients', () => ({
  resolveMessageCategories: jest.fn(), resolveOneCategory: jest.fn(),
}));

function mockChain(result) {
  const c = {
    select: () => c, sort: () => c, limit: () => c, skip: () => c, then: (fn) => Promise.resolve(result).then(fn),
    lean: () => Promise.resolve(result),
    catch: (fn) => Promise.resolve(result).catch(fn),
  };
  return c;
}

function mockMatchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatchesFilter(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.entries(v).every(([op, opVal]) => {
        switch (op) {
          case '$in':  return opVal.includes(doc[k]);
          case '$nin': return !opVal.includes(doc[k]);
          case '$exists': {
            const has = Object.prototype.hasOwnProperty.call(doc, k) && doc[k] !== undefined;
            return opVal ? has : !has;
          }
          case '$gt':  return doc[k] > opVal;
          case '$gte': return doc[k] >= opVal;
          case '$ne':  return doc[k] !== opVal;
          case '$lt':  return doc[k] < opVal;
          case '$lte': return doc[k] <= opVal;
          default: return true;
        }
      });
    }
    return doc[k] === v;
  });
}

function mockCollection(seed = []) {
  return {
    find:            jest.fn(filter => mockChain(filter ? seed.filter(d => mockMatchesFilter(d, filter)) : seed)),
    findOne:         jest.fn(filter => mockChain(seed.find(d => mockMatchesFilter(d, filter)) ?? null)),
    countDocuments:  jest.fn(filter => Promise.resolve(seed.filter(d => mockMatchesFilter(d, filter)).length)),
    distinct:        jest.fn((field, filter) => Promise.resolve([...new Set(seed.filter(d => mockMatchesFilter(d, filter)).map(d => d[field]).filter(v => v !== undefined))])),
  };
}

let mockSchoolDoc, mockStudentDoc, mockAttendanceDocs, mockAcademicYearDocs,
    mockInvoiceDocs, mockPaymentDocs, mockReportCardDocs;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: jest.fn(() => mockChain(mockSchoolDoc)) };
    return mockCollection([]);
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'students')               return { findOne: jest.fn(() => mockChain(mockStudentDoc)) };
    if (collection === 'attendance')              return mockCollection(mockAttendanceDocs);
    if (collection === 'academic_years')          return mockCollection(mockAcademicYearDocs);
    if (collection === 'invoices')                return mockCollection(mockInvoiceDocs);
    if (collection === 'payments')                return mockCollection(mockPaymentDocs);
    if (collection === 'report_card_snapshots')    return mockCollection(mockReportCardDocs);
    return mockCollection([]);
  },
}));

// Mirrors academic-config.js's real `_resolveCurrentPeriod` — term is
// always resolved live by date range, never stubbed to null.
jest.mock('../../routes/academic-config', () => ({
  resolveCurrentPeriod: (years, todayStr) => {
    todayStr = todayStr || new Date().toISOString().slice(0, 10);
    let year = (years || []).find(y => y.isCurrent);
    if (!year) {
      year = (years || []).find(y => y.startDate <= todayStr && y.endDate >= todayStr)
          ?? [...(years || [])].sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))[0]
          ?? null;
    }
    if (!year) return { year: null, term: null, termNumber: null };
    const terms = Array.isArray(year.terms) ? year.terms : [];
    let termIdx = terms.findIndex(t => t.startDate <= todayStr && t.endDate >= todayStr);
    if (termIdx === -1) {
      const upcoming = terms
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => t.startDate > todayStr)
        .sort((a, b) => a.t.startDate.localeCompare(b.t.startDate))[0];
      termIdx = upcoming ? upcoming.i : (terms.length ? terms.length - 1 : -1);
    }
    return {
      year,
      term:       termIdx >= 0 ? terms[termIdx] : null,
      termNumber: termIdx >= 0 ? termIdx + 1 : null,
    };
  },
}));

const express   = require('express');
const supertest = require('supertest');
const parentPortalRouter = require('../../routes/parent-portal');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parent-portal', parentPortalRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSchoolDoc = { id: SCHOOL_A, schoolId: SCHOOL_A, name: 'Trinitas', portalConfig: {}, mpesa: null };
  mockStudentDoc = {
    id: CHILD_ID, schoolId: SCHOOL_A, firstName: 'Kayden', lastName: 'Odhiambo',
    admissionNumber: 'ADM100', classId: CLASS_ID, className: 'Year 1', status: 'active',
  };
  mockAcademicYearDocs = [{
    id: 'ay_2026', schoolId: SCHOOL_A, name: '2026', isCurrent: true,
    terms: [{ startDate: '2026-09-02', endDate: '2026-12-11' }],
  }];
  // Real attendance documents carry `date`, never `academicYear`.
  mockAttendanceDocs = [];
  mockInvoiceDocs = [];
  mockPaymentDocs = [];
  mockReportCardDocs = [];
});

describe('GET /dashboard/:childId — attendance', () => {
  test('is computed from in-term attendance records, not a nonexistent academicYear field', async () => {
    mockAttendanceDocs = [
      { schoolId: SCHOOL_A, studentId: CHILD_ID, date: '2026-10-01', status: 'present' },
      { schoolId: SCHOOL_A, studentId: CHILD_ID, date: '2026-10-02', status: 'present' },
      { schoolId: SCHOOL_A, studentId: CHILD_ID, date: '2026-10-03', status: 'absent' },
      { schoolId: SCHOOL_A, studentId: CHILD_ID, date: '2026-10-06', status: 'late' },
    ];
    const res = await supertest(buildApp()).get(`/api/parent-portal/dashboard/${CHILD_ID}`);
    expect(res.status).toBe(200);
    const att = res.body.data.attendance;
    expect(att.present).toBe(2);
    expect(att.absent).toBe(1);
    expect(att.late).toBe(1);
    expect(att.total).toBe(4);
    expect(att.percentage).toBe(50);
  });

  test('a record outside the current term\'s date range is excluded', async () => {
    mockAttendanceDocs = [
      { schoolId: SCHOOL_A, studentId: CHILD_ID, date: '2026-10-16', status: 'present' },
      // Before the current term's start — excluded.
      { schoolId: SCHOOL_A, studentId: CHILD_ID, date: '2026-01-05', status: 'absent' },
      // After the current term's end — excluded.
      { schoolId: SCHOOL_A, studentId: CHILD_ID, date: '2027-02-01', status: 'absent' },
    ];
    const res = await supertest(buildApp()).get(`/api/parent-portal/dashboard/${CHILD_ID}`);
    const att = res.body.data.attendance;
    expect(att.present).toBe(1);
    expect(att.absent).toBe(0);
    expect(att.total).toBe(1);
    expect(att.percentage).toBe(100);
  });

  test('no attendance records at all gives 0%, not a crash', async () => {
    mockAttendanceDocs = [];
    const res = await supertest(buildApp()).get(`/api/parent-portal/dashboard/${CHILD_ID}`);
    expect(res.status).toBe(200);
    const att = res.body.data.attendance;
    expect(att.total).toBe(0);
    expect(att.percentage).toBe(0);
  });

  test('a parent not linked to the child is forbidden', async () => {
    const res = await supertest(buildApp()).get('/api/parent-portal/dashboard/some_other_child');
    expect(res.status).toBe(403);
  });
});
