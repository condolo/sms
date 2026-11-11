/* ============================================================
   server/routes/council.js — the staff read-only feed + patron guard

   Raised directly with the teacher feedback-box feature: granting a
   teacher "View Cases & Council Queue" (the council:read coarse grant)
   used to leave /admin/cases wide open — every case WITH the reporter's
   name, class, replies and events. The settings UI unions sub-row grants
   into the coarse module array (settings.js _deriveApiPerms), so any
   sub ticked for teachers leaked identities.

   This proves the new boundary:
     · GET /council/staff-feed     the teacher face — identities masked
                                   server-side, safeguarding/sensitive
                                   cases never appear, read-only.
     · GET /council/admin/cases*   patron-console only: a patron role or
                                   an explicit council__manage sub grant.
     · GET /council/me             canManage now mirrors that same rule,
                                   so the web UI's console-vs-feed branch
                                   can never disagree with the API.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';

/* ── fixtures ─────────────────────────────────────────────────── */

const CASE_NAMED = {
  id: 'case_named',
  ref: 'SC-2026-0007',
  kind: 'grievance',
  category: 'academics',
  title: 'Homework due the same day as the mock',
  body: 'Four assignments landed on one day.',
  status: 'under_review',
  anonymous: false,
  sensitive: false,
  safeguarding: false,
  reporterStudentId: 'stu_brian',
  reporterName: 'Brian Kiptoo',
  reporterClass: 'Form 3A',
  assignedStudentId: 'stu_council_1',
  assignedName: 'Achieng Otieno',
  upvotes: ['stu_2', 'stu_3'],
  replies: [
    { id: 'r_public_student', authorType: 'student', authorStudentId: 'stu_brian', authorName: 'Brian Kiptoo', anonymous: false, body: 'Adding dates', internal: false, createdAt: '2026-01-02T10:00:00Z' },
    { id: 'r_internal', authorType: 'council', authorName: 'Achieng Otieno', anonymous: false, body: 'The deputy already knows — keep this off the record', internal: true, createdAt: '2026-01-02T11:00:00Z' },
    { id: 'r_council_public', authorType: 'council', authorName: 'Achieng Otieno', anonymous: false, body: 'We have raised it with the deputy principal.', internal: false, createdAt: '2026-01-02T12:00:00Z' },
  ],
  lastActivityAt: '2026-01-03T00:00:00Z',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-03T00:00:00Z',
};

const CASE_ANON = {
  id: 'case_anon',
  ref: 'SC-2026-0002',
  kind: 'suggestion',
  category: 'welfare',
  title: 'A second water point near the dining hall',
  body: 'The queue at lunch stretches past the gate.',
  status: 'open',
  anonymous: true,
  sensitive: false,
  safeguarding: false,
  reporterStudentId: 'stu_hidden',
  reporterName: 'Real Name Nobody Should See',
  reporterClass: 'Form 2B',
  assignedStudentId: null,
  assignedName: null,
  upvotes: ['stu_5'],
  replies: [
    { id: 'r_anon_author', authorType: 'student', authorStudentId: 'stu_hidden', authorName: 'Real Name Nobody Should See', anonymous: true, body: 'Editing my suggestion', internal: false, createdAt: '2026-01-02T09:00:00Z' },
  ],
  lastActivityAt: '2026-01-04T00:00:00Z',
  createdAt: '2026-01-02T00:00:00Z',
  updatedAt: '2026-01-04T00:00:00Z',
};

const CASE_SAFEGUARDING = {
  ...CASE_NAMED,
  id: 'case_safe',
  ref: 'SC-2026-0009',
  kind: 'grievance',
  category: 'safety',
  title: 'Someone is being threatened at the gate',
  status: 'escalated',
  anonymous: true,
  safeguarding: true,
  lastActivityAt: '2026-01-05T00:00:00Z',
};

const CASE_SENSITIVE = {
  ...CASE_NAMED,
  id: 'case_sensitive',
  ref: 'SC-2026-0011',
  title: 'A private family matter',
  sensitive: true,
  status: 'under_review',
  lastActivityAt: '2026-01-06T00:00:00Z',
};

const ALL_CASES = [CASE_NAMED, CASE_ANON, CASE_SAFEGUARDING, CASE_SENSITIVE];

/* ── mocks ────────────────────────────────────────────────────── */

let mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
let mockCases = [];

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));

jest.mock('../../middleware/rbac', () => ({
  rbac: () => (_req, _res, next) => next(), // coarse council:read is assumed held — the route's own guard is what we test
  hasExplicitSubGrant: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));

jest.mock('../../utils/tenant-model', () => {
  /* A small mongo-ish filter so the route's $ne/$nin filters actually work —
     the exclusion of safeguarding/sensitive cases IS one of the behaviours
     under test, so the mock cannot ignore the query. Lives inside the
     factory: jest hoists factories above the imports they need to guard. */
  function matches(doc, query) {
    return Object.entries(query || {}).every(([key, cond]) => {
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('$ne' in cond) return doc[key] !== cond.$ne;
        if ('$in' in cond) return cond.$in.includes(doc[key]);
        if ('$nin' in cond) return !cond.$nin.includes(doc[key]);
      }
      return doc[key] === cond;
    });
  }
  return {
    tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
    tenantModel: jest.fn((_collection) => ({
      find: (query = {}) => ({
        sort: () => ({
          limit: () => ({
            lean: () => Promise.resolve(
              mockCases
                .filter((d) => matches(d, query))
                .sort((a, b) => String(b.lastActivityAt).localeCompare(String(a.lastActivityAt))),
            ),
          }),
        }),
      }),
      findOne: (query = {}) => {
        const found = () => Promise.resolve(mockCases.find((d) => matches(d, query)) || null);
        return { select: () => ({ lean: found }), lean: found };
      },
      countDocuments: (query = {}) => Promise.resolve(mockCases.filter((d) => matches(d, query)).length),
      updateOne: () => Promise.resolve({ modifiedCount: 1 }),
    })),
  };
});

jest.mock('../../utils/model', () => ({
  _model: jest.fn(() => ({
    findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }),
  })),
}));

jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/notify-dispatch', () => ({ dispatchNotification: jest.fn().mockResolvedValue({}) }));
jest.mock('../../utils/email', () => ({ sendCouncilUpdate: jest.fn().mockResolvedValue({}) }));

const express = require('express');
const supertest = require('supertest');
const councilRouter = require('../../routes/council');
const rbacMock = require('../../middleware/rbac');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/council', councilRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  rbacMock.hasExplicitSubGrant.mockResolvedValue(false);
  mockCases = ALL_CASES;
  mockJwtUser = { userId: 'usr_teacher', schoolId: SCHOOL_A, role: 'teacher', roles: ['teacher'] };
});

/* ── the teacher face ─────────────────────────────────────────── */

describe('GET /council/staff-feed — the read-only teacher feed', () => {
  test('serves a teacher and never reveals who filed a named case', async () => {
    const res = await supertest(buildApp()).get('/api/council/staff-feed');
    expect(res.status).toBe(200);
    const named = res.body.data.cases.find((c) => c.ref === 'SC-2026-0007');
    expect(named.reporter).toMatchObject({ name: 'Student', className: 'Form 3A', anonymous: false, masked: true });
    expect(JSON.stringify(res.body)).not.toContain('Brian Kiptoo');
  });

  test('an anonymous case does not even reveal the reporter’s class', async () => {
    const res = await supertest(buildApp()).get('/api/council/staff-feed');
    const anon = res.body.data.cases.find((c) => c.ref === 'SC-2026-0002');
    expect(anon.reporter).toMatchObject({ name: 'Anonymous', className: '', anonymous: true });
    expect(JSON.stringify(res.body)).not.toContain('Real Name Nobody Should See');
  });

  test('drops internal council notes and masks student reply authors', async () => {
    const res = await supertest(buildApp()).get('/api/council/staff-feed');
    const named = res.body.data.cases.find((c) => c.ref === 'SC-2026-0007');
    const bodies = named.replies.map((r) => r.body);
    expect(bodies).toContain('We have raised it with the deputy principal.');
    expect(bodies).toContain('Adding dates');
    expect(bodies).not.toContain('The deputy already knows — keep this off the record');
    const studentReply = named.replies.find((r) => r.id === 'r_public_student');
    expect(studentReply.authorName).toBe('Student');
    const anonReply = res.body.data.cases.find((c) => c.ref === 'SC-2026-0002').replies[0];
    expect(anonReply.authorName).toBe('Anonymous');
    const councilReply = named.replies.find((r) => r.id === 'r_council_public');
    expect(councilReply.authorName).toBe('Achieng Otieno'); // council names are public in-app already
  });

  test('never includes safeguarding or patron-held cases — not even their titles', async () => {
    const res = await supertest(buildApp()).get('/api/council/staff-feed');
    const refs = res.body.data.cases.map((c) => c.ref);
    expect(refs).toContain('SC-2026-0007');
    expect(refs).toContain('SC-2026-0002');
    expect(refs).not.toContain('SC-2026-0009');
    expect(refs).not.toContain('SC-2026-0011');
    expect(res.body.data.counts).toMatchObject({ total: 2, open: 2, grievances: 1, suggestions: 1 });
  });

  test('carries no write surface — upvotes/replies are counts, not collections the app can act on', async () => {
    const res = await supertest(buildApp()).get('/api/council/staff-feed');
    const named = res.body.data.cases.find((c) => c.ref === 'SC-2026-0007');
    expect(named.upvoteCount).toBe(2);
    expect(named.replyCount).toBe(2);
    expect(named).not.toHaveProperty('assignedTo');
    expect(named).not.toHaveProperty('events');
    expect(named).not.toHaveProperty('isMine');
  });

  test('403s a student account — the student face is /student-council, not this', async () => {
    mockJwtUser = { userId: 'usr_stu', schoolId: SCHOOL_A, role: 'student', studentId: 'stu_brian', roles: ['student'] };
    const res = await supertest(buildApp()).get('/api/council/staff-feed');
    expect(res.status).toBe(403);
  });
});

/* ── the patron console guard ─────────────────────────────────── */

describe('GET /council/admin/cases — identities are patron-console only', () => {
  test('a plain teacher with the coarse council:read grant is forbidden — the leak this closes', async () => {
    const res = await supertest(buildApp()).get('/api/council/admin/cases');
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/staff-feed/i);
  });

  test('the same is true of a single case', async () => {
    const res = await supertest(buildApp()).get(`/api/council/admin/cases/${CASE_NAMED.id}`);
    expect(res.status).toBe(403);
  });

  test('an admin (patron role) still sees identities', async () => {
    mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    const res = await supertest(buildApp()).get('/api/council/admin/cases');
    expect(res.status).toBe(200);
    const named = res.body.data.find((c) => c.ref === 'SC-2026-0007');
    expect(named.reporter.name).toBe('Brian Kiptoo');
    // The patron reads internal notes' bodies; the view always strips the
    // internal FLAG itself (existing _replyView behaviour, asserted here so
    // a future change is a conscious one).
    expect(named.replies.some((r) => r.body.includes('keep this off the record'))).toBe(true);
    expect(named.replies.every((r) => r.internal === false)).toBe(true);
  });

  test('a non-patron staff role with a deliberate council__manage grant gets the console (counselor case)', async () => {
    rbacMock.hasExplicitSubGrant.mockResolvedValue(true);
    mockJwtUser = { userId: 'usr_counselor', schoolId: SCHOOL_A, role: 'counselor', roles: ['counselor'] };
    const res = await supertest(buildApp()).get('/api/council/admin/cases');
    expect(res.status).toBe(200);
    expect(rbacMock.hasExplicitSubGrant).toHaveBeenCalledWith(expect.anything(), 'council', 'manage', 'read');
  });

  test('patron-held (sensitive) and safeguarding cases appear for the patron, unmasked', async () => {
    mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    const res = await supertest(buildApp()).get('/api/council/admin/cases');
    const refs = res.body.data.map((c) => c.ref);
    expect(refs).toContain('SC-2026-0009');
    expect(refs).toContain('SC-2026-0011');
  });

  test('PATCH (decide/assign) is patron-console only — a teacher cannot move a case', async () => {
    const res = await supertest(buildApp())
      .patch(`/api/council/admin/cases/${CASE_NAMED.id}`)
      .send({ status: 'resolved', note: 'done' });
    expect(res.status).toBe(403);
  });

  test('PATCH still works for the patron', async () => {
    mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    const res = await supertest(buildApp())
      .patch(`/api/council/admin/cases/${CASE_NAMED.id}`)
      .send({ status: 'resolved', note: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ updated: true });
  });
});

/* ── the student face's anonymity rule ────────────────────────── */

describe('GET /council/suggestions — anonymous means anonymous to students', () => {
  test('an anonymous suggestion hides the reporter’s class too, not just the name', async () => {
    mockJwtUser = { userId: 'usr_stu', schoolId: SCHOOL_A, role: 'student', studentId: 'stu_reader', roles: ['student'] };
    const res = await supertest(buildApp()).get('/api/council/suggestions');
    expect(res.status).toBe(200);
    const anon = res.body.data.find((c) => c.ref === 'SC-2026-0002');
    expect(anon.reporter).toMatchObject({ name: 'Anonymous', className: '', anonymous: true });
    expect(JSON.stringify(res.body)).not.toContain('Form 2B');
  });
});

/* ── the face switch ──────────────────────────────────────────── */

describe('GET /council/me — canManage mirrors the console guard', () => {
  test('a teacher gets canManage false → the web UI shows the staff feed', async () => {
    const res = await supertest(buildApp()).get('/api/council/me');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ student: false, staff: true, canManage: false });
  });

  test('an admin gets canManage true → the patron console', async () => {
    mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
    const res = await supertest(buildApp()).get('/api/council/me');
    expect(res.status).toBe(200);
    expect(res.body.data.canManage).toBe(true);
  });

  test('a counselor with the explicit manage grant gets canManage true, matching the console guard', async () => {
    rbacMock.hasExplicitSubGrant.mockResolvedValue(true);
    mockJwtUser = { userId: 'usr_counselor', schoolId: SCHOOL_A, role: 'counselor', roles: ['counselor'] };
    const res = await supertest(buildApp()).get('/api/council/me');
    expect(res.body.data.canManage).toBe(true);
  });
});
