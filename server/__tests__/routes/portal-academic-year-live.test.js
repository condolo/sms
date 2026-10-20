
/* Portal access is now tier-gated (parent → family, student → student).
   These suites test route behaviour, not billing, so the gate is a pass-through. */
jest.mock('../../middleware/plan', () => ({ planGate: () => (req, _res, next) => next() }));
/* ============================================================
   server/routes/parent-portal.js and student-portal.js —
   dashboard school.academicYear/currentTerm now LIVE-RESOLVE via
   academic_years + resolveCurrentPeriod, instead of trusting the
   schools.academicYear cached field.

   Reported directly: the academic year shown in the Parent Portal
   "seems to be hardcoded not set in the school." Root cause: that
   cached field is only ever written by academic-config.js's year-
   transition endpoint as a backward-compat sync — if that sync is
   skipped, or a year's isCurrent flag changes through migration/
   admin action, the cached field goes stale. Same staleness class
   report-cards.js's _resolveTermScope was already fixed for; these
   two dashboards had the old, unfixed version of it.

   Also covers the new school.mpesaEnabled derived boolean — the raw
   school.mpesa object (API keys) must never reach either response.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';
const CHILD_1  = 'stu_1';

jest.mock('../../utils/timetable-publish', () => ({
  isTimetablePublished: jest.fn().mockResolvedValue(false),
  publishedReader: async () => mockCollection([]),
}));
jest.mock('../../routes/weekly-snapshots', () => ({
  _helpers: { findAuthorizedStudent: jest.fn(), getWeeksForStudent: jest.fn() },
}));

function mockChain(result) {
  const c = {
    select: () => c, sort: () => c, limit: () => c, skip: () => c,
    lean: () => Promise.resolve(result),
    catch: (fn) => Promise.resolve(result).catch(fn),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return c;
}
function mockCollection(seed = []) {
  return {
    find:           jest.fn(() => mockChain(seed)),
    findOne:        jest.fn(() => mockChain(seed[0] ?? null)),
    countDocuments: jest.fn(() => Promise.resolve(seed.length)),
    distinct:       jest.fn(() => Promise.resolve([])),
  };
}

// Real filter matching (unlike mockCollection's countDocuments above,
// which ignores its filter entirely) — needed so the family-summary
// tests below actually discriminate a correct messages._inboxQuery
// filter from a wrong one, rather than passing regardless.
function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, cond]) => {
    if (k === '$or') return cond.some(sub => mockMatches(doc, sub));
    const val = k.includes('.') ? k.split('.').reduce((o, p) => o?.[p], doc) : doc[k];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('$in' in cond) return cond.$in.includes(val);
      if ('$ne' in cond) return val !== cond.$ne;
      return true;
    }
    return val === cond;
  });
}
function mockMessagesCollection(seed = []) {
  return {
    ...mockCollection(seed),
    countDocuments: jest.fn((filter) => Promise.resolve(seed.filter(d => mockMatches(d, filter)).length)),
  };
}

let mockSchoolDoc, mockStudentDoc, mockAcademicYearDocs, mockMessageDocs;

jest.mock('../../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: jest.fn(() => mockChain(mockSchoolDoc)) };
    return mockCollection([]);
  }),
}));
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req?.jwtUser?.schoolId ?? null }),
  tenantModel: (collection) => {
    if (collection === 'students')       return { findOne: jest.fn(() => mockChain(mockStudentDoc)) };
    if (collection === 'academic_years') return mockCollection(mockAcademicYearDocs);
    if (collection === 'messages')       return mockMessagesCollection(mockMessageDocs);
    return mockCollection([]);
  },
}));
// messages.js's OWN middleware chain (router.use(authMiddleware, tenantMiddleware,
// moduleGate('messages'))) never runs here — parent-portal.js only imports its
// exported _inboxQuery function, not the router — but messages.js still
// requires these at module-load time, so they need to resolve without a
// live DB/SMTP config.
jest.mock('../../middleware/tenant', () => ({ tenantMiddleware: (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../utils/email', () => ({}));
jest.mock('../../utils/notif-settings', () => ({}));
jest.mock('../../utils/email-queue', () => ({ enqueueBatch: jest.fn() }));
jest.mock('../../utils/school-url', () => ({ schoolLoginUrl: jest.fn() }));

const express   = require('express');
const supertest = require('supertest');

function buildApp(router, mountPath, jwtUser) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.jwtUser = jwtUser; next(); });
  app.use(mountPath, router);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStudentDoc = {
    id: CHILD_1, schoolId: SCHOOL_A, firstName: 'Amara', lastName: 'Osei',
    admissionNumber: 'ADM001', classId: null, className: 'Year 2', streamId: null, status: 'active',
  };
  mockMessageDocs = [];
});

describe('Parent Portal — GET /dashboard/:childId', () => {
  jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req, _res, next) => next(),
  }));
  const parentPortalRouter = require('../../routes/parent-portal');
  const PARENT_USER = { userId: 'usr_parent', schoolId: SCHOOL_A, role: 'parent', studentIds: [CHILD_1], guardianOf: [] };

  test('ignores a stale schools.academicYear cached field — live-resolves the isCurrent academic_years doc instead', async () => {
    mockSchoolDoc = { name: 'Test School', academicYear: '2019-STALE', portalConfig: {} }; // deliberately wrong/stale
    mockAcademicYearDocs = [{ id: 'ay_2026', schoolId: SCHOOL_A, name: '2025/2026', isCurrent: true, terms: [{ id: 't1', name: 'Term 1', startDate: '2025-01-01', endDate: '2025-04-01' }] }];

    const res = await supertest(buildApp(parentPortalRouter, '/api/parent-portal', PARENT_USER))
      .get(`/api/parent-portal/dashboard/${CHILD_1}`);

    expect(res.status).toBe(200);
    expect(res.body.data.school.academicYear).toBe('2025/2026');
    expect(res.body.data.school.academicYear).not.toBe('2019-STALE');
  });

  test('derives currentTerm from the resolved year, not a missing field', async () => {
    mockSchoolDoc = { name: 'Test School', portalConfig: {} };
    mockAcademicYearDocs = [{
      id: 'ay_2026', schoolId: SCHOOL_A, name: '2025/2026', isCurrent: true,
      terms: [{ id: 't1', name: 'Term 2', startDate: '2000-01-01', endDate: '2999-01-01' }],
    }];

    const res = await supertest(buildApp(parentPortalRouter, '/api/parent-portal', PARENT_USER))
      .get(`/api/parent-portal/dashboard/${CHILD_1}`);

    expect(res.body.data.school.currentTerm).toBe('Term 2');
  });

  test('mpesaEnabled is true only when every required M-Pesa field is configured', async () => {
    mockSchoolDoc = {
      name: 'Test School', portalConfig: {},
      mpesa: { consumerKey: 'k', consumerSecret: 's', shortCode: '123456', passkey: 'p' },
    };
    mockAcademicYearDocs = [];

    const res = await supertest(buildApp(parentPortalRouter, '/api/parent-portal', PARENT_USER))
      .get(`/api/parent-portal/dashboard/${CHILD_1}`);

    expect(res.body.data.school.mpesaEnabled).toBe(true);
  });

  test('mpesaEnabled is false when M-Pesa is unconfigured, and the raw config is never leaked', async () => {
    mockSchoolDoc = { name: 'Test School', portalConfig: {}, mpesa: { consumerKey: 'k' } }; // incomplete
    mockAcademicYearDocs = [];

    const res = await supertest(buildApp(parentPortalRouter, '/api/parent-portal', PARENT_USER))
      .get(`/api/parent-portal/dashboard/${CHILD_1}`);

    expect(res.body.data.school.mpesaEnabled).toBe(false);
    expect(res.body.data.school.mpesa).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/consumerKey|consumerSecret|passkey/);
  });
});

// Reported directly: the Parent Portal's notification bell showed an
// unread count, but the sidebar/Overview badge (sourced from
// GET /family-summary's unreadMessages, a SEPARATE query from the
// bell's own messages.js endpoints) never agreed with it — always 0.
// Root cause: this query filtered by recipientId/readAt, fields the
// messages collection has never actually had (real shape: `recipients`
// + `isRead: {[userId]: true}`, same as messages.js's own _inboxQuery).
// Fixed to reuse that exact exported function rather than a second,
// drifted definition of "unread."
describe('Parent Portal — GET /family-summary — unread count', () => {
  const parentPortalRouter = require('../../routes/parent-portal');
  const PARENT_USER = { userId: 'usr_parent', schoolId: SCHOOL_A, role: 'parent', studentIds: [CHILD_1], guardianOf: [] };

  test('counts a message addressed to "all", unread by this user', async () => {
    mockMessageDocs = [
      { id: 'm1', schoolId: SCHOOL_A, recipients: 'all', isRead: {} },
    ];
    const res = await supertest(buildApp(parentPortalRouter, '/api/parent-portal', PARENT_USER))
      .get('/api/parent-portal/family-summary');
    expect(res.status).toBe(200);
    expect(res.body.data.unreadMessages).toBe(1);
  });

  test('counts a message addressed to the "parents" role group', async () => {
    mockMessageDocs = [
      { id: 'm1', schoolId: SCHOOL_A, recipients: 'parents', isRead: {} },
    ];
    const res = await supertest(buildApp(parentPortalRouter, '/api/parent-portal', PARENT_USER))
      .get('/api/parent-portal/family-summary');
    expect(res.body.data.unreadMessages).toBe(1);
  });

  test('does NOT count a message already read by this user', async () => {
    mockMessageDocs = [
      { id: 'm1', schoolId: SCHOOL_A, recipients: 'all', isRead: { usr_parent: true } },
    ];
    const res = await supertest(buildApp(parentPortalRouter, '/api/parent-portal', PARENT_USER))
      .get('/api/parent-portal/family-summary');
    expect(res.body.data.unreadMessages).toBe(0);
  });

  test('does NOT count a message addressed to a different group (e.g. teachers only)', async () => {
    mockMessageDocs = [
      { id: 'm1', schoolId: SCHOOL_A, recipients: 'teachers', isRead: {} },
    ];
    const res = await supertest(buildApp(parentPortalRouter, '/api/parent-portal', PARENT_USER))
      .get('/api/parent-portal/family-summary');
    expect(res.body.data.unreadMessages).toBe(0);
  });

  test('no messages at all → 0, not an error', async () => {
    mockMessageDocs = [];
    const res = await supertest(buildApp(parentPortalRouter, '/api/parent-portal', PARENT_USER))
      .get('/api/parent-portal/family-summary');
    expect(res.status).toBe(200);
    expect(res.body.data.unreadMessages).toBe(0);
  });
});

describe('Student Portal — GET /dashboard', () => {
  jest.mock('../../middleware/auth', () => ({
    authMiddleware: (req, _res, next) => next(),
  }));
  const studentPortalRouter = require('../../routes/student-portal');
  const STUDENT_USER = { userId: 'usr_stu', schoolId: SCHOOL_A, role: 'student', studentId: CHILD_1 };

  test('ignores a stale schools.academicYear cached field — live-resolves instead', async () => {
    mockSchoolDoc = { name: 'Test School', academicYear: '2019-STALE', portalConfig: {} };
    mockAcademicYearDocs = [{ id: 'ay_2026', schoolId: SCHOOL_A, name: '2025/2026', isCurrent: true, terms: [] }];

    const res = await supertest(buildApp(studentPortalRouter, '/api/student-portal', STUDENT_USER))
      .get('/api/student-portal/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.data.school.academicYear).toBe('2025/2026');
  });

  test('mpesaEnabled reflects the configured gateway, never the raw keys', async () => {
    mockSchoolDoc = {
      name: 'Test School', portalConfig: {},
      mpesa: { consumerKey: 'k', consumerSecret: 's', shortCode: '123456', passkey: 'p' },
    };
    mockAcademicYearDocs = [];

    const res = await supertest(buildApp(studentPortalRouter, '/api/student-portal', STUDENT_USER))
      .get('/api/student-portal/dashboard');

    expect(res.body.data.school.mpesaEnabled).toBe(true);
    expect(res.body.data.school.mpesa).toBeUndefined();
  });
});
