/* ============================================================
   server/routes/behaviour.js — GET /incidents/export-pdf (2026-10-29)

   Requested directly: a filterable (whole-school/class/stream) PDF
   export of the incident log, with the name of the staff member who
   recorded each incident — "we need to know how each staff is using
   the system." Covers: the management-only gate (not the Behaviour
   Officer bypass every other behaviour:* route gets — auditing OTHER
   staff's usage is a leadership action, a different scope), class/
   stream/date filtering, and the per-staff activity tally that is the
   actual point of the report.

   html-to-pdf.js is mocked (same convention as report-cards.js's own
   PDF-route tests) — rendering correctness is covered by a manual
   end-to-end Puppeteer render against real data; what this file checks
   is that the route resolves the right filter, the right names, and
   the right tally, and gates correctly by role.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_001';

function mockChainArr(arr) {
  const c = { sort: () => c, skip: () => c, limit: () => c, select: () => c, lean: () => Promise.resolve(arr) };
  return c;
}
function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$gte' in v || '$lte' in v) {
        if ('$gte' in v && doc[k] < v.$gte) return false;
        if ('$lte' in v && doc[k] > v.$lte) return false;
        return true;
      }
      return true;
    }
    return doc[k] === v;
  });
}

let mockIncidents, mockUsers, mockClasses, mockStreams, mockStudents, mockSchool;
let mockCurrentUser;
let lastHtmlArgs = null;

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockCurrentUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/html-to-pdf', () => ({
  htmlToPdfBuffer: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake pdf for tests')),
  htmlToPdfBufferOrFallback: jest.fn((html, fallbackFn) => Promise.resolve(Buffer.from('%PDF-1.4 fake pdf for tests'))),
}));
jest.mock('../../utils/behaviour-report', () => ({
  renderIncidentsReportHtml: jest.fn((args) => { lastHtmlArgs = args; return '<html>fake</html>'; }),
  renderIncidentsReportPdf: jest.fn(() => Promise.resolve(Buffer.from('%PDF-1.4 fake pdf for tests'))),
}));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: jest.fn(() => mockChainObj(mockSchool)) };
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser?.schoolId }),
  tenantModel: (collection) => {
    const stores = {
      behaviour_incidents: mockIncidents,
      users:   mockUsers,
      classes: mockClasses,
      streams: mockStreams,
      students: mockStudents,
    };
    return stores[collection] ?? { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)), distinct: jest.fn(() => Promise.resolve([])) };
  },
}));

function makeStore(seed = []) {
  const docs = seed.map(d => ({ ...d }));
  return {
    find:     jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne:  jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    distinct: jest.fn((field, filter) => Promise.resolve(docs.filter(d => matchesFilter(d, filter)).map(d => d[field]))),
    countDocuments: jest.fn((filter) => Promise.resolve(docs.filter(d => matchesFilter(d, filter)).length)),
  };
}

const express   = require('express');
const supertest = require('supertest');
const behaviourRouter = require('../../routes/behaviour');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/behaviour', behaviourRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  lastHtmlArgs = null;
  mockSchool = { id: SCHOOL, name: 'Test School' };

  mockClasses  = makeStore([{ id: 'cls_y5', schoolId: SCHOOL, name: 'Year 5' }]);
  mockStreams  = makeStore([{ id: 'strm_diamond', schoolId: SCHOOL, name: 'Diamond' }]);
  mockStudents = makeStore([
    { id: 'stu_1', schoolId: SCHOOL, streamId: 'strm_diamond' },
    { id: 'stu_2', schoolId: SCHOOL, streamId: 'strm_sapphire' },
  ]);
  mockUsers = makeStore([
    { id: 'usr_teacher_a', schoolId: SCHOOL, name: 'Ms. Faith Ondiek', role: 'teacher' },
    { id: 'usr_teacher_b', schoolId: SCHOOL, name: 'Mr. Sammy Otiende', role: 'teacher' },
  ]);
  mockIncidents = makeStore([
    { id: 'inc_1', schoolId: SCHOOL, studentId: 'stu_1', studentName: 'Kisha Bidali', classId: 'cls_y5', type: 'demerit', points: -5, category: 'Uniform', date: '2026-10-01', reportedBy: 'usr_teacher_a' },
    { id: 'inc_2', schoolId: SCHOOL, studentId: 'stu_1', studentName: 'Kisha Bidali', classId: 'cls_y5', type: 'merit', points: 3, category: 'Participation', date: '2026-10-05', reportedBy: 'usr_teacher_a' },
    { id: 'inc_3', schoolId: SCHOOL, studentId: 'stu_2', studentName: 'James Mwangi', classId: 'cls_y5', type: 'demerit', points: -2, category: 'Lateness', date: '2026-09-15', reportedBy: 'usr_teacher_b' },
  ]);

  mockCurrentUser = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: [] };
});

describe('GET /api/behaviour/incidents/export-pdf — management-only gate', () => {
  test('a plain teacher is forbidden', async () => {
    mockCurrentUser = { userId: 'usr_teacher_a', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };
    const res = await supertest(buildApp()).get('/api/behaviour/incidents/export-pdf');
    expect(res.status).toBe(403);
  });

  test('admin, principal, deputy_principal, hod, and discipline_committee all pass the gate', async () => {
    for (const role of ['admin', 'superadmin', 'principal', 'deputy_principal', 'hod', 'discipline_committee']) {
      mockCurrentUser = { userId: 'usr_x', schoolId: SCHOOL, role, roles: [role] };
      const res = await supertest(buildApp()).get('/api/behaviour/incidents/export-pdf');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
    }
  });
});

describe('GET /api/behaviour/incidents/export-pdf — filtering and scope label', () => {
  test('no filters — whole school, every incident included', async () => {
    const res = await supertest(buildApp()).get('/api/behaviour/incidents/export-pdf');
    expect(res.status).toBe(200);
    expect(lastHtmlArgs.incidents).toHaveLength(3);
    expect(lastHtmlArgs.scopeLabel).toBe('Whole School');
  });

  test('classId narrows the incident set and labels the scope by class name', async () => {
    const res = await supertest(buildApp()).get('/api/behaviour/incidents/export-pdf').query({ classId: 'cls_y5' });
    expect(res.status).toBe(200);
    expect(lastHtmlArgs.incidents).toHaveLength(3); // all 3 seeded incidents are classId cls_y5
    expect(lastHtmlArgs.scopeLabel).toBe('Year 5');
  });

  test('classId + streamId together (the real UI always pairs them, cascading like every other class/stream picker) resolves the current roster and narrows to that stream only', async () => {
    const res = await supertest(buildApp()).get('/api/behaviour/incidents/export-pdf').query({ classId: 'cls_y5', streamId: 'strm_diamond' });
    expect(res.status).toBe(200);
    // Only stu_1 is in strm_diamond — inc_1 and inc_2, not inc_3 (stu_2, strm_sapphire)
    expect(lastHtmlArgs.incidents.map(i => i.id).sort()).toEqual(['inc_1', 'inc_2']);
    expect(lastHtmlArgs.scopeLabel).toBe('Year 5 · Diamond');
  });

  test('dateFrom/dateTo narrows by date range', async () => {
    const res = await supertest(buildApp()).get('/api/behaviour/incidents/export-pdf').query({ dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    expect(res.status).toBe(200);
    expect(lastHtmlArgs.incidents.map(i => i.id).sort()).toEqual(['inc_1', 'inc_2']);
  });
});

describe('GET /api/behaviour/incidents/export-pdf — staff activity tally (the actual point of the report)', () => {
  test('tallies incidents, merits, demerits, and net points per reporting staff member, resolved to their real name', async () => {
    const res = await supertest(buildApp()).get('/api/behaviour/incidents/export-pdf');
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(lastHtmlArgs.staffRows.map(r => [r.name, r]));
    expect(byName['Ms. Faith Ondiek']).toEqual(expect.objectContaining({ total: 2, merits: 1, demerits: 1, points: -2 }));
    expect(byName['Mr. Sammy Otiende']).toEqual(expect.objectContaining({ total: 1, merits: 0, demerits: 1, points: -2 }));
  });

  test('an incident with no reportedBy is tallied as Unattributed, not dropped', async () => {
    mockIncidents = makeStore([
      { id: 'inc_orphan', schoolId: SCHOOL, studentId: 'stu_1', studentName: 'Kisha Bidali', classId: 'cls_y5', type: 'demerit', points: -1, date: '2026-10-01' },
    ]);
    const res = await supertest(buildApp()).get('/api/behaviour/incidents/export-pdf');
    expect(res.status).toBe(200);
    expect(lastHtmlArgs.staffRows).toHaveLength(1);
    expect(lastHtmlArgs.staffRows[0].name).toBe('Unattributed');
    expect(lastHtmlArgs.staffRows[0].total).toBe(1);
  });
});

describe('GET /api/behaviour/incidents — reportedByName resolution (on-screen list)', () => {
  test('each incident row carries the recording staff member\'s resolved name', async () => {
    const res = await supertest(buildApp()).get('/api/behaviour/incidents');
    expect(res.status).toBe(200);
    const inc1 = res.body.data.find(d => d.id === 'inc_1');
    expect(inc1.reportedByName).toBe('Ms. Faith Ondiek');
    expect(inc1.reportedByRole).toBe('teacher');
  });

  test('streamId filters the on-screen list the same way the PDF export does', async () => {
    const res = await supertest(buildApp()).get('/api/behaviour/incidents').query({ streamId: 'strm_diamond' });
    expect(res.status).toBe(200);
    expect(res.body.data.map(d => d.id).sort()).toEqual(['inc_1', 'inc_2']);
  });
});
