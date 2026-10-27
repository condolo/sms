/* ============================================================
   server/routes/report-cards.js — _loadRenderExtras (RCE3c)

   Was previously inlined in GET /:id/html only; GET /:id/pdf never
   loaded school/behaviour/deviations/subjectTeacherCommentsEnabled at
   all, which was invisible while legacy_tabular's PDF renderer ignored
   all of them but became a real gap once subject_paired started
   reading them. This is the shared resolver both routes now call —
   including the new subjectTeacherNames map, resolved from
   teaching_assignments.
   ============================================================ */
'use strict';

jest.mock('../middleware/auth', () => ({ authMiddleware: (_r, _s, n) => n() }));
jest.mock('../middleware/rbac', () => ({ rbac: () => (_r, _s, n) => n() }));
jest.mock('../middleware/plan', () => ({ planGate: () => (_r, _s, n) => n() }));
jest.mock('../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

let mockSchoolDoc = null;
let mockAssignments = [];
let mockCaConfig = { subjectTeacherCommentsEnabled: true };
let mockSubjectDocs = [];

jest.mock('../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'schools') {
      return { findOne: () => ({ lean: () => Promise.resolve(mockSchoolDoc) }) };
    }
    throw new Error(`unexpected _model('${col}') call in this test`);
  }),
}));

jest.mock('../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'report_card_snapshots') {
      return { findOne: () => ({ lean: () => Promise.resolve(null) }) }; // no prior-term snapshot
    }
    if (col === 'teaching_assignments') {
      return {
        find: () => ({ select: () => ({ lean: () => Promise.resolve(mockAssignments) }) }),
      };
    }
    if (col === 'subjects') {
      return {
        find: () => ({ select: () => ({ lean: () => Promise.resolve(mockSubjectDocs) }) }),
      };
    }
    throw new Error(`unexpected tenantModel('${col}') call in this test`);
  }),
  tenantContext: jest.fn(() => ({})),
}));

jest.mock('../utils/academic-calc', () => ({
  aggregateGrades: jest.fn(), aggregateExamResults: jest.fn(), aggregateAssessmentMarks: jest.fn(),
  computeFinalScores: jest.fn(), attachDeviations: jest.fn(),
  behaviourSummary: jest.fn(() => Promise.resolve({ merits: 3, demerits: 1, points: 2, total: 2 })),
  computeTermDeviation: jest.fn(() => ({ subjects: {} })),
}));

jest.mock('../routes/assessment', () => ({
  getConfig: jest.fn(() => Promise.resolve(mockCaConfig)),
}));

// _fetchImageBuf's own test double for `http`/`https`.get — captures the
// URL actually requested (to prove a relative logoUrl gets resolved to an
// absolute one first) and feeds back a controllable response. A plain
// function declaration, not jest.fn/const, so it's fully hoisted above
// the jest.mock(...) calls below, which Babel hoists above everything else.
function mockFakeGet(url, optsOrCb, maybeCb) {
  global.__lastRequestedUrl = url;
  const callback = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
  const resp = { on: (event, cb) => {
    if (event === 'data') (global.__mockResponseChunks || [Buffer.from('fake-image-bytes')]).forEach(cb);
    if (event === 'end') cb();
    return resp;
  } };
  if (typeof callback === 'function') callback(resp);
  const req = { on: () => req, destroy: () => {} };
  return req;
}
// Only overrides `.get` — express/mongoose/etc. depend on the rest of
// these modules' real exports (IncomingMessage and friends), so a full
// replacement breaks unrelated requires elsewhere in this file.
jest.mock('http', () => ({ ...jest.requireActual('http'), get: (...args) => mockFakeGet(...args) }));
jest.mock('https', () => ({ ...jest.requireActual('https'), get: (...args) => mockFakeGet(...args) }));
jest.mock('../utils/app-url', () => ({ appUrl: (p = '') => `https://app.example.test${p.startsWith('/') ? p : `/${p}`}` }));

const reportCardsRouter = require('../routes/report-cards');

function baseSnap(overrides = {}) {
  return {
    studentId: 'stu_1', classId: 'cls_1', termNumber: 2, academicYearId: 'ay_1',
    subjects: { math: {}, english: {} },
    ...overrides,
  };
}

beforeEach(() => {
  mockSchoolDoc = { logoUrl: 'https://x/logo.png', tagline: 'Excellence', address: '123 Main St', phone: '0700', email: 'a@b.com', website: 'x.ac.ke' };
  mockAssignments = [
    { subjectId: 'math', teacherName: 'Collins Ndolo' },
    { subjectId: 'english', teacherName: 'Jane Wambui' },
  ];
  mockCaConfig = { subjectTeacherCommentsEnabled: true };
  mockSubjectDocs = [
    { id: 'math', name: 'Mathematics' },
    { id: 'english', name: 'English Language' },
  ];
});

describe('_loadRenderExtras', () => {
  test('resolves school, behaviour, deviations, and subjectTeacherCommentsEnabled', async () => {
    const extra = await reportCardsRouter._loadRenderExtras({}, 'sch_1', baseSnap());
    expect(extra.school).toEqual(mockSchoolDoc);
    expect(extra.behaviour).toEqual({ merits: 3, demerits: 1, points: 2, total: 2 });
    expect(extra.subjectTeacherCommentsEnabled).toBe(true);
    expect(extra.deviations).toEqual({ subjects: {} });
  });

  test('builds subjectTeacherNames keyed by subjectId from teaching_assignments', async () => {
    const extra = await reportCardsRouter._loadRenderExtras({}, 'sch_1', baseSnap());
    expect(extra.subjectTeacherNames).toEqual({ math: 'Collins Ndolo', english: 'Jane Wambui' });
  });

  test('a subject with no teaching_assignments doc is simply absent from the map, not an error', async () => {
    mockAssignments = [{ subjectId: 'math', teacherName: 'Collins Ndolo' }]; // english has none
    const extra = await reportCardsRouter._loadRenderExtras({}, 'sch_1', baseSnap());
    expect(extra.subjectTeacherNames).toEqual({ math: 'Collins Ndolo' });
    expect(extra.subjectTeacherNames.english).toBeUndefined();
  });

  test('the first assignment found per subject wins when more than one exists (co-teaching)', async () => {
    mockAssignments = [
      { subjectId: 'math', teacherName: 'Collins Ndolo' },
      { subjectId: 'math', teacherName: 'Second Teacher' },
    ];
    const extra = await reportCardsRouter._loadRenderExtras({}, 'sch_1', baseSnap());
    expect(extra.subjectTeacherNames.math).toBe('Collins Ndolo');
  });

  test('respects the school\'s subjectTeacherCommentsEnabled=false setting', async () => {
    mockCaConfig = { subjectTeacherCommentsEnabled: false };
    const extra = await reportCardsRouter._loadRenderExtras({}, 'sch_1', baseSnap());
    expect(extra.subjectTeacherCommentsEnabled).toBe(false);
  });

  test('builds subjectNames keyed by subjectId from subjects (reported: "just seeing their ids")', async () => {
    const extra = await reportCardsRouter._loadRenderExtras({}, 'sch_1', baseSnap());
    expect(extra.subjectNames).toEqual({ math: 'Mathematics', english: 'English Language' });
  });

  test('a subject with no matching subjects doc is simply absent from the map, not an error', async () => {
    mockSubjectDocs = [{ id: 'math', name: 'Mathematics' }]; // english has no doc
    const extra = await reportCardsRouter._loadRenderExtras({}, 'sch_1', baseSnap());
    expect(extra.subjectNames).toEqual({ math: 'Mathematics' });
    expect(extra.subjectNames.english).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════
   _fetchImageBuf — reported directly 2026-10-27, "the logo is supposed
   to be fainted watermark" / bulk PDF export. Root cause: settings.js's
   logo-upload flow always writes a RELATIVE, self-hosted path
   (`/api/public/school-asset/logo?slug=...`) to `school.logoUrl` — fine
   for a browser `<img>` tag (resolves against the page's own origin),
   but this is a server-side Node http(s).get() with no "current page"
   to resolve a relative path against. Confirmed directly against live
   production data for two different schools that this silently returned
   null for every real school's logo, in every PDF export (single and
   bulk alike) — not a bulk-specific bug, just one only noticed there.
   ══════════════════════════════════════════════════════════════ */
describe('_fetchImageBuf', () => {
  beforeEach(() => {
    global.__lastRequestedUrl = null;
    global.__mockResponseChunks = [Buffer.from('fake-image-bytes')];
  });

  test('a relative, self-hosted logoUrl is resolved against the app base URL before fetching', async () => {
    const buf = await reportCardsRouter._fetchImageBuf('/api/public/school-asset/logo?slug=sch_demo');
    expect(global.__lastRequestedUrl).toBe('https://app.example.test/api/public/school-asset/logo?slug=sch_demo');
    expect(buf.toString()).toBe('fake-image-bytes');
  });

  test('an already-absolute http(s) URL is fetched unchanged', async () => {
    await reportCardsRouter._fetchImageBuf('https://cdn.example.com/logo.png');
    expect(global.__lastRequestedUrl).toBe('https://cdn.example.com/logo.png');
  });

  test('a data: URI is decoded directly, never sent to http/https.get', async () => {
    const buf = await reportCardsRouter._fetchImageBuf(`data:image/png;base64,${Buffer.from('hi').toString('base64')}`);
    expect(buf.toString()).toBe('hi');
    expect(global.__lastRequestedUrl).toBeNull();
  });

  test('null/empty/garbage input still resolves to null, not a crash', async () => {
    expect(await reportCardsRouter._fetchImageBuf(null)).toBeNull();
    expect(await reportCardsRouter._fetchImageBuf('')).toBeNull();
    expect(await reportCardsRouter._fetchImageBuf('not a url at all')).toBeNull();
    expect(global.__lastRequestedUrl).toBeNull();
  });
});
