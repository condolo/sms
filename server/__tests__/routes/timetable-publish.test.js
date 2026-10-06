/* ============================================================
   Timetable publishing: a draft the timetabler edits, and a published
   copy that teachers, students and parents read.

   Rules under test:
     • Editors read the draft. Everyone else reads the published version only.
     • A draft edit changes nothing for non-editors until it is published.
     • After a change, Publish is available again. With no change, it is refused.
     • Publishing copies the whole draft under a new version, then points the
       school at it. The previous copy is removed. The version record stays.
     • Unpublish hides the live version from everyone. Editors still see the draft.
   ============================================================ */
'use strict';

const SCHOOL = 'school_A';

let mockSchool;
let mockDraft;      // the timetable: the editors' draft
let mockPublished;  // timetable_published: copies, one set per version
let mockVersions;   // timetable_versions: history
let mockUser;

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => matches(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
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
    insertMany: (docs) => { rowsRef().push(...docs); return Promise.resolve(docs); },
    create: (doc) => { rowsRef().push(doc); return Promise.resolve(doc); },
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
    return { find: jest.fn(() => mockChain([])), findOne: jest.fn(() => mockChain(null)) };
  }),
}));

// The store plumbing reads the module-level state through these globals, so the factories above stay valid.
beforeAll(() => {
  global.__mockUser = null;
  global.__mockSchool = () => mockSchool;
  global.__store = (name) => mockStore(() => (name === 'timetable' ? mockDraft : name === 'timetable_published' ? mockPublished : mockVersions));
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

describe('a new version replaces the copy, and history is kept', () => {
  test('publishing again removes the old copy and keeps a version record for each publish', async () => {
    await supertest(buildApp()).post('/api/timetable/publish').send({});
    await markTimetableChanged(SCHOOL);
    await supertest(buildApp()).post('/api/timetable/publish').send({});
    expect(mockPublished).toHaveLength(2);                              // only the live version's two lessons
    expect(new Set(mockPublished.map(s => s.versionId)).size).toBe(1);
    expect(mockVersions).toHaveLength(2);
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
