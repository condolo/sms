/* ============================================================
   Timetable publishing: a draft the timetabler edits, and a published
   copy that teachers, students and parents read.

   Rules under test:
     • Editors read the draft. Everyone else reads the published version only.
     • A draft edit changes nothing for non-editors until it is published.
     • After a change, Publish is available again. With no change, it is refused.
     • Publishing copies the draft under a new version, then points the school
       at it. Copies of the last 10 versions are kept so one can be restored
       into the draft (v5.272.0); older copies go, their history rows stay.
     • The admin can leave out lessons from other academic years (v5.272.0).
     • Unpublish hides the live version from everyone. Editors still see the draft.
   ============================================================ */
'use strict';

const SCHOOL = 'school_A';

let mockSchool;
let mockDraft;      // the timetable: the editors' draft
let mockPublished;  // timetable_published: copies, one set per version
let mockVersions;   // timetable_versions: history
let mockYears;      // academic_years
let mockUser;

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => matches(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$nin' in v) return !v.$nin.includes(doc[k]);
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$exists' in v) return (doc[k] !== undefined) === v.$exists;
    }
    // Mongo: null matches a missing field too.
    if (v === null) return doc[k] == null;
    return doc[k] === v;
  });
}

function mockChain(result) {
  const c = { sort: () => c, select: () => c, limit: () => c, skip: () => c, lean: () => Promise.resolve(result) };
  return c;
}

function mockStore(rowsRef) {
  return {
    find: (f) => mockChain(rowsRef().filter(d => matches(d, f))),
    findOne: (f) => mockChain(rowsRef().find(d => matches(d, f)) ?? null),
    countDocuments: (f) => Promise.resolve(rowsRef().filter(d => matches(d, f)).length),
    distinct: (field, f) => Promise.resolve([...new Set(rowsRef().filter(d => matches(d, f)).map(d => d[field]))]),
    insertMany: (docs) => { rowsRef().push(...docs); return Promise.resolve(docs); },
    create: (doc) => { rowsRef().push(doc); return Promise.resolve(doc); },
    updateOne: (f, u) => { const d = rowsRef().find(x => matches(x, f)); if (d) Object.assign(d, u.$set || {}); return Promise.resolve({ modifiedCount: d ? 1 : 0 }); },
    updateMany: (f, u) => { let n = 0; for (const d of rowsRef()) if (matches(d, f)) { Object.assign(d, u.$set || {}); n++; } return Promise.resolve({ modifiedCount: n }); },
    findOneAndDelete: (f) => {
      const i = rowsRef().findIndex(d => matches(d, f));
      if (i < 0) return Promise.resolve(null);
      return Promise.resolve(rowsRef().splice(i, 1)[0]);
    },
    deleteMany: (f) => {
      const keep = rowsRef().filter(d => !matches(d, f));
      const removed = rowsRef().length - keep.length;
      rowsRef().splice(0, rowsRef().length, ...keep);
      return Promise.resolve({ deletedCount: removed });
    },
  };
}

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = { ...global.__mockUser }; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../routes/bell-schedule', () => ({ resolveBellSchedule: jest.fn() }));
jest.mock('../../utils/archival', () => ({ isYearArchived: async () => false, firstArchivedYear: async () => null }));

jest.mock('../../utils/model', () => ({
  _model: jest.fn((col) => {
    if (col === 'schools') {
      return {
        findOne: jest.fn(() => mockChain(global.__mockSchool())),
        updateOne: jest.fn((filter, update) => {
          const school = global.__mockSchool();
          for (const [path, value] of Object.entries(update.$set || {})) {
            const [top, key] = path.split('.');
            if (key) school[top] = { ...(school[top] || {}), [key]: value };
            else school[top] = value;
          }
          for (const [path, value] of Object.entries(update.$inc || {})) {
            const [top, key] = path.split('.');
            school[top] = { ...(school[top] || {}), [key]: ((school[top] || {})[key] ?? 0) + value };
          }
          return Promise.resolve({ matchedCount: 1 });
        }),
      };
    }
    if (col === 'timetable') return global.__store('timetable');
    if (col === 'timetable_published') return global.__store('timetable_published');
    if (col === 'timetable_versions') return global.__store('timetable_versions');
    if (col === 'academic_years') return global.__store('academic_years');
    return { find: jest.fn(() => mockChain([])), findOne: jest.fn(() => mockChain(null)) };
  }),
}));

// The store plumbing reads the module-level state through these globals, so the factories above stay valid.
beforeAll(() => {
  global.__mockUser = null;
  global.__mockSchool = () => mockSchool;
  global.__store = (name) => mockStore(() => (name === 'timetable' ? mockDraft : name === 'timetable_published' ? mockPublished : name === 'academic_years' ? mockYears : mockVersions));
});

const express = require('express');
const supertest = require('supertest');
const timetableRouter = require('../../routes/timetable');
const { isTimetablePublished, getPublishState, timetableReaderFor, markTimetableChanged } = require('../../utils/timetable-publish');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/timetable', timetableRouter);
  return app;
}

const ADMIN = { userId: 'usr_admin', schoolId: SCHOOL, role: 'admin', roles: ['admin'] };
const TEACHER = { userId: 'usr_teacher', schoolId: SCHOOL, role: 'teacher', roles: ['teacher'] };

// A draft slot. Editing it means changing `subject` on the draft row.
const slot = (id, subject) => ({ id, schoolId: SCHOOL, classId: 'c1', day: 'monday', period: '1', subject, startTime: '08:00', endTime: '09:00', isActive: true });

beforeEach(() => {
  mockSchool = { id: SCHOOL, name: 'Test School' };
  mockDraft = [slot('s1', 'Maths'), slot('s2', 'English')];
  mockPublished = [];
  mockVersions = [];
  mockYears = [];
  global.__mockUser = { ...ADMIN };
});

async function readAs(user) {
  global.__mockUser = user;
  const reader = await timetableReaderFor({ jwtUser: user });
  return reader.find({ schoolId: SCHOOL, isActive: true }).lean ? (await reader.find({ schoolId: SCHOOL, isActive: true }).lean()) : [];
}

describe('before anything is published', () => {
  test('nothing is live, so teachers read nothing; the editor reads the draft', async () => {
    expect(await isTimetablePublished(SCHOOL)).toBe(false);
    expect(await readAs(TEACHER)).toEqual([]);
    expect((await readAs(ADMIN)).map(s => s.subject).sort()).toEqual(['English', 'Maths']);
  });

  test('a first publish is always offered', async () => {
    const st = await getPublishState(SCHOOL);
    expect(st.canPublish).toBe(true);
  });
});

describe('publish copies the draft and makes it the live version', () => {
  test('publish returns the new version, and teachers now read the published copy', async () => {
    const res = await supertest(buildApp()).post('/api/timetable/publish').send({ termLabel: ' Term 1 ' });
    expect(res.status).toBe(200);
    expect(res.body.data.slotCount).toBe(2);
    expect(res.body.data.termLabel).toBe('Term 1');
    expect((await readAs(TEACHER)).map(s => s.subject).sort()).toEqual(['English', 'Maths']);
    expect(mockVersions).toHaveLength(1);
    expect(mockVersions[0].slotCount).toBe(2);
  });
});

describe('a draft edit is invisible to teachers until it is published', () => {
  test('after an edit and no publish, teachers still read the old version; the editor reads the edit', async () => {
    await supertest(buildApp()).post('/api/timetable/publish').send({});
    mockDraft.find(s => s.id === 's1').subject = 'Physics';
    await markTimetableChanged(SCHOOL);

    expect((await readAs(TEACHER)).map(s => s.subject).sort()).toEqual(['English', 'Maths']);
    expect((await readAs(ADMIN)).map(s => s.subject).sort()).toEqual(['English', 'Physics']);
  });

  test('a change makes Publish available; publishing shows it to teachers and clears the pending state', async () => {
    await supertest(buildApp()).post('/api/timetable/publish').send({});
    expect((await getPublishState(SCHOOL)).hasChanges).toBe(false);

    await markTimetableChanged(SCHOOL);
    const pending = await getPublishState(SCHOOL);
    expect(pending.hasChanges).toBe(true);
    expect(pending.canPublish).toBe(true);

    mockDraft.find(s => s.id === 's1').subject = 'Physics';
    await supertest(buildApp()).post('/api/timetable/publish').send({});
    expect((await readAs(TEACHER)).map(s => s.subject).sort()).toEqual(['English', 'Physics']);
    expect((await getPublishState(SCHOOL)).hasChanges).toBe(false);
  });

  test('publishing with no change since the last publish is refused', async () => {
    await supertest(buildApp()).post('/api/timetable/publish').send({});
    const res = await supertest(buildApp()).post('/api/timetable/publish').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Nothing has changed/);
  });
});

describe('a new version goes live, and recent copies are kept as restore points', () => {
  test('publishing again keeps both copies and a version record for each; teachers read only the live one', async () => {
    await supertest(buildApp()).post('/api/timetable/publish').send({});
    await markTimetableChanged(SCHOOL);
    const second = await supertest(buildApp()).post('/api/timetable/publish').send({});
    expect(mockPublished).toHaveLength(4);
    expect(new Set(mockPublished.map(s => s.versionId)).size).toBe(2);
    expect(mockVersions).toHaveLength(2);
    const seen = await readAs(TEACHER);
    expect(seen).toHaveLength(2);
    expect(new Set(seen.map(s => s.versionId))).toEqual(new Set([second.body.data.versionId]));
  });
});

describe('unpublish hides the live version from everyone', () => {
  test('after unpublish, teachers read nothing; the editor still reads the draft; publish brings it back', async () => {
    await supertest(buildApp()).post('/api/timetable/publish').send({});
    const un = await supertest(buildApp()).post('/api/timetable/unpublish').send({});
    expect(un.status).toBe(200);
    expect(un.body.data.published).toBe(false);
    expect(await isTimetablePublished(SCHOOL)).toBe(false);
    expect(await readAs(TEACHER)).toEqual([]);
    expect((await readAs(ADMIN)).length).toBe(2);

    await supertest(buildApp()).post('/api/timetable/publish').send({});
    expect((await readAs(TEACHER)).length).toBe(2);
    expect(mockVersions).toHaveLength(2);
  });
});

describe('an edit to the draft marks it changed', () => {
  test('a successful change marks the draft changed, so Publish is offered', async () => {
    await supertest(buildApp()).post('/api/timetable/publish').send({});
    expect((await getPublishState(SCHOOL)).hasChanges).toBe(false);

    const res = await supertest(buildApp()).delete('/api/timetable/s2');
    expect(res.status).toBe(200);
    await new Promise(r => setImmediate(r)); // the mark is written once the response has finished
    expect((await getPublishState(SCHOOL)).hasChanges).toBe(true);
    expect(mockDraft.map(x => x.id)).toEqual(['s1']);
    expect(mockPublished).toHaveLength(2); // teachers still have the lesson until the next publish
  });

  test('a change that fails marks nothing', async () => {
    await supertest(buildApp()).post('/api/timetable/publish').send({});
    const res = await supertest(buildApp()).delete('/api/timetable/no-such-lesson');
    expect(res.status).toBe(404);
    await new Promise(r => setImmediate(r));
    expect((await getPublishState(SCHOOL)).hasChanges).toBe(false);
  });
});

describe('publish is refused while a lesson has no time', () => {
  test('a lesson with no time blocks publish, and the status says how many', async () => {
    mockDraft.push({ id: 's3', schoolId: SCHOOL, classId: 'c1', day: 'tuesday', period: '2', subject: 'Art', isActive: true });
    const status = await supertest(buildApp()).get('/api/timetable/status');
    expect(status.body.data.untimedLessons).toBe(1);
    const res = await supertest(buildApp()).post('/api/timetable/publish').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/1 lesson has no time/);
    expect(await isTimetablePublished(SCHOOL)).toBe(false);
  });

  test('once the lesson has a time, publish goes through', async () => {
    mockDraft.push({ id: 's3', schoolId: SCHOOL, classId: 'c1', day: 'tuesday', period: '2', subject: 'Art', isActive: true });
    mockDraft.find(x => x.id === 's3').startTime = '09:00';
    mockDraft.find(x => x.id === 's3').endTime = '10:00';
    const res = await supertest(buildApp()).post('/api/timetable/publish').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.slotCount).toBe(3);
  });
});

describe('a double booking is a warning, and does not block publish', () => {
  // The base fixture has two class-c1 lessons at the same time, which is a real double booking. These tests start clean.
  beforeEach(() => { mockDraft = []; });

  test('two overlapping lessons with the same teacher are reported, and publish still goes ahead', async () => {
    mockDraft.push(
      { id: 'w1', schoolId: SCHOOL, classId: 'c1', teacherId: 't9', day: 'monday', period: '5', subject: 'Chemistry', startTime: '10:00', endTime: '11:00', isActive: true },
      { id: 'w2', schoolId: SCHOOL, classId: 'c2', teacherId: 't9', day: 'monday', period: '5', subject: 'Physics', startTime: '10:30', endTime: '11:30', isActive: true },
    );
    const status = await supertest(buildApp()).get('/api/timetable/status');
    expect(status.body.data.doubleBookings).toBe(1);
    expect(status.body.data.warnings[0]).toMatch(/the same teacher/);

    const res = await supertest(buildApp()).post('/api/timetable/publish').send({});
    expect(res.status).toBe(200);
    expect(res.body.data.warnings).toHaveLength(1);
    expect(await isTimetablePublished(SCHOOL)).toBe(true);
  });

  test('lessons that do not overlap are not reported', async () => {
    mockDraft.push(
      { id: 'n1', schoolId: SCHOOL, classId: 'c1', teacherId: 't8', day: 'monday', period: '6', subject: 'Music', startTime: '11:00', endTime: '12:00', isActive: true },
      { id: 'n2', schoolId: SCHOOL, classId: 'c2', teacherId: 't8', day: 'monday', period: '7', subject: 'Drama', startTime: '12:00', endTime: '13:00', isActive: true },
    );
    const status = await supertest(buildApp()).get('/api/timetable/status');
    expect(status.body.data.doubleBookings).toBe(0);
  });
});

describe('status reports what the timetabler needs to know', () => {
  test('status shows whether changes are waiting to be published', async () => {
    await supertest(buildApp()).post('/api/timetable/publish').send({});
    await markTimetableChanged(SCHOOL);
    const res = await supertest(buildApp()).get('/api/timetable/status');
    expect(res.body.data.published).toBe(true);
    expect(res.body.data.hasChanges).toBe(true);
    expect(res.body.data.canPublish).toBe(true);
  });
});

/* v5.272.0 — raised in a school admin's review of the timetable guide:
   "the term label doesn't limit what gets published" and "publishing
   history isn't a full restore point". */
describe('what gets published (v5.272.0)', () => {
  const Y_NOW = 'ay_2026', Y_OLD = 'ay_2025';
  beforeEach(() => {
    mockYears = [
      { id: Y_OLD, schoolId: SCHOOL, name: '2025', isCurrent: false, startDate: '2025-01-01', endDate: '2025-12-31', terms: [] },
      { id: Y_NOW, schoolId: SCHOOL, name: '2026', isCurrent: true, startDate: '2026-01-01', endDate: '2026-12-31', terms: [{ id: 't2', name: 'Term 2', startDate: '2026-01-01', endDate: '2026-12-31' }] },
    ];
    mockDraft = [
      { ...slot('n1', 'Maths'), academicYearId: Y_NOW, termId: 't2' },
      { ...slot('n2', 'English'), academicYearId: Y_NOW, termId: 't2' },
      { ...slot('o1', 'Old Maths'), academicYearId: Y_OLD },
      { ...slot('u1', 'Untagged PE') },                       // saved before lessons carried a year
    ];
  });

  test('status says how many lessons the draft holds per academic year, and suggests a label', async () => {
    const res = await supertest(buildApp()).get('/api/timetable/status');
    const sc = res.body.data.publishScope;
    expect(sc).toMatchObject({ total: 4, thisYearScope: 3, otherYears: 1, currentYearId: Y_NOW, suggestedLabel: 'Term 2 2026' });
    expect(sc.byYear.find(y => y.isCurrent)).toMatchObject({ name: '2026', count: 2 });
  });

  test('"this year only" leaves out other years\x27 lessons but keeps untagged ones', async () => {
    const res = await supertest(buildApp()).post('/api/timetable/publish').send({ termLabel: 'Term 2', scope: 'current_year' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ scope: 'current_year', slotCount: 3 });
    expect(mockPublished.map(s => s.id).sort()).toEqual(['n1', 'n2', 'u1']);
    expect(mockSchool.timetableStatus).toMatchObject({ publishedScope: 'current_year', publishedYearId: Y_NOW });
    expect(mockVersions[0]).toMatchObject({ scope: 'current_year', academicYearId: Y_NOW, slotCount: 3 });
  });

  test('without a scope the whole draft is published, as before', async () => {
    const res = await supertest(buildApp()).post('/api/timetable/publish').send({ termLabel: 'Term 2' });
    expect(res.body.data).toMatchObject({ scope: 'all', slotCount: 4 });
  });

  test('the term label never selects lessons', async () => {
    await supertest(buildApp()).post('/api/timetable/publish').send({ termLabel: 'Term 1 2025' });
    expect(mockPublished).toHaveLength(4);
  });

  test('"this year only" is refused when no current academic year is set', async () => {
    mockYears = [];
    const res = await supertest(buildApp()).post('/api/timetable/publish').send({ scope: 'current_year' });
    expect(res.status).toBe(400);
    expect(mockPublished).toHaveLength(0);
  });
});

describe('restore points (v5.272.0)', () => {
  async function publish(label) {
    await markTimetableChanged(SCHOOL);
    return (await supertest(buildApp()).post('/api/timetable/publish').send({ termLabel: label })).body.data;
  }

  test('only the last 10 versions keep their lessons; older ones stay as history', async () => {
    const ids = [];
    for (let i = 1; i <= 12; i++) {
      mockDraft[0].subject = `Maths v${i}`;
      ids.push((await publish(`v${i}`)).versionId);
      await new Promise(r => setTimeout(r, 2));             // distinct publishedAt
    }
    expect(new Set(mockPublished.map(s => s.versionId)).size).toBe(10);
    expect(mockVersions.filter(v => v.copyKept === false).map(v => v.termLabel).sort()).toEqual(['v1', 'v2']);
    const list = await supertest(buildApp()).get('/api/timetable/versions');
    expect(list.body.data.liveVersionId).toBe(ids[11]);
    expect(list.body.data.versions.find(v => v.termLabel === 'v1').canRestore).toBe(false);
    expect((await readAs(TEACHER)).map(s => s.subject)).toContain('Maths v12');
  });

  test('restoring copies a version into the draft, saves the current draft first, and changes nothing for teachers until published', async () => {
    const v1 = await publish('Term 1');                      // Maths, English
    mockDraft = [slot('s1', 'Physics'), slot('s3', 'Art')];  // big edit
    const v2 = await publish('Term 2');
    mockDraft.push(slot('s4', 'Music'));                     // unpublished edit

    global.__mockUser = { ...ADMIN };
    const res = await supertest(buildApp()).post(`/api/timetable/versions/${v1.versionId}/restore`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ restored: 2, replaced: 3 });
    expect(mockDraft.map(s => s.subject).sort()).toEqual(['English', 'Maths']);

    // The draft before the restore is in the history and can be restored back.
    const backup = mockVersions.find(v => v.kind === 'draft_backup');
    expect(backup).toMatchObject({ slotCount: 3, restoredFrom: v1.versionId });
    expect(backup.termLabel).toMatch(/Draft saved before restoring Term 1/);

    // Teachers still see Term 2 until the restored draft is published.
    expect((await readAs(TEACHER)).map(s => s.subject).sort()).toEqual(['Art', 'Physics']);
    global.__mockUser = { ...ADMIN };
    expect((await supertest(buildApp()).get('/api/timetable/status')).body.data.hasChanges).toBe(true);

    const back = await supertest(buildApp()).post(`/api/timetable/versions/${backup.id}/restore`).send({});
    expect(back.status).toBe(200);
    expect(mockDraft.map(s => s.subject).sort()).toEqual(['Art', 'Music', 'Physics']);
    expect(v2.versionId).toBeTruthy();
  });

  test('a version whose lessons are no longer kept, or another school\x27s, cannot be restored', async () => {
    const v1 = await publish('Old');
    mockVersions.find(v => v.id === v1.versionId).copyKept = false;
    const old = await supertest(buildApp()).post(`/api/timetable/versions/${v1.versionId}/restore`).send({});
    expect(old.status).toBe(409);
    mockVersions.push({ id: 'v_other', schoolId: 'school_B', termLabel: 'Other', slotCount: 1 });
    const other = await supertest(buildApp()).post('/api/timetable/versions/v_other/restore').send({});
    expect(other.status).toBe(404);
    expect(mockDraft.map(s => s.id).sort()).toEqual(['s1', 's2']);
  });
});

describe('untimed lessons block only when they are being published (v5.272.0)', () => {
  beforeEach(() => {
    mockYears = [{ id: 'ay_2026', schoolId: SCHOOL, name: '2026', isCurrent: true, startDate: '2026-01-01', endDate: '2026-12-31', terms: [] }];
    mockDraft = [
      { ...slot('n1', 'Maths'), academicYearId: 'ay_2026' },
      { ...slot('o1', 'Old untimed'), academicYearId: 'ay_2025', startTime: null, endTime: null },
    ];
  });
  test('an untimed lesson from another year that is left out does not block "this year only"', async () => {
    const res = await supertest(buildApp()).post('/api/timetable/publish').send({ scope: 'current_year' });
    expect(res.status).toBe(200);
    expect(res.body.data.slotCount).toBe(1);
  });
  test('the same lesson blocks a whole-draft publish', async () => {
    const res = await supertest(buildApp()).post('/api/timetable/publish').send({ scope: 'all' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/1 lesson has no time/);
  });
});

describe('restoring a "this year only" version leaves other years alone (v5.272.0)', () => {
  test('only that year\x27s lessons are replaced; the whole draft is saved first', async () => {
    mockYears = [{ id: 'ay_2026', schoolId: SCHOOL, name: '2026', isCurrent: true, startDate: '2026-01-01', endDate: '2026-12-31', terms: [] }];
    mockDraft = [
      { ...slot('n1', 'Maths'), academicYearId: 'ay_2026' },
      { ...slot('o1', 'Old year'), academicYearId: 'ay_2025' },
    ];
    const v1 = (await supertest(buildApp()).post('/api/timetable/publish').send({ scope: 'current_year', termLabel: 'T1' })).body.data;
    mockDraft = [
      { ...slot('n2', 'Physics'), academicYearId: 'ay_2026' },
      { ...slot('o1', 'Old year'), academicYearId: 'ay_2025' },
    ];
    const res = await supertest(buildApp()).post(`/api/timetable/versions/${v1.versionId}/restore`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ restored: 1, replaced: 1 });
    expect(mockDraft.map(s => s.subject).sort()).toEqual(['Maths', 'Old year']);
    expect(mockVersions.find(v => v.kind === 'draft_backup').slotCount).toBe(2);
  });
});

describe('history only offers a restore that can work (v5.272.0)', () => {
  test('a version whose stored lessons were removed is not offered for restore', async () => {
    await supertest(buildApp()).post('/api/timetable/publish').send({ termLabel: 'A' });
    await markTimetableChanged(SCHOOL);
    const b = (await supertest(buildApp()).post('/api/timetable/publish').send({ termLabel: 'B' })).body.data;
    // Something outside the publish flow removed version A's copy (e.g. the demo seed).
    mockPublished.splice(0, mockPublished.length, ...mockPublished.filter(r => r.versionId === b.versionId));
    const list = await supertest(buildApp()).get('/api/timetable/versions');
    const byLabel = Object.fromEntries(list.body.data.versions.map(v => [v.termLabel, v]));
    expect(byLabel.A.canRestore).toBe(false);
    expect(byLabel.B.canRestore).toBe(true);
    expect(list.body.data.liveVersionId).toBe(b.versionId);
  });
});
