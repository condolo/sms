/* ============================================================
   server/routes/teaching-assignments.js POST / — class id
   tolerance + the elective/compulsory stream rule

   Part 1: A class created before the `id` (UUID) field existed only
   has a Mongo `_id`. GET /classes normalises that into `id` for every
   frontend dropdown (see that route's own "Normalize" comment), so
   the class displays and selects fine everywhere — but this route's
   classId lookup used to match only the literal `id` field, so
   creating an assignment against one of these legacy classes always
   failed with a false "Class not found", even though the class is
   right there in the picker. class-subjects.js already handles this
   correctly via its own _classQuery helper; this brings
   teaching-assignments.js's POST route in line with that same
   pattern.

   Part 2: the stream rule. A subject compulsory for a class that
   actually has streams (e.g. 7i / 7ii with different Maths teachers)
   now REQUIRES a streamId — a plain class-wide assignment can't
   express "different teacher per stream". An elective subject, or a
   class with no streams at all, leaves streamId optional (electives
   commonly pool students from every stream into one group).

   All DB calls are mocked — no MongoDB required.
   ============================================================ */

const SCHOOL_A = 'school_A';
const LEGACY_OID = '507f1f77bcf86cd799439011'; // 24-hex — looks like a Mongo ObjectId

function mockChainObj(obj) {
  const c = { select: () => c, lean: () => Promise.resolve(obj) };
  return c;
}
function mockMatchesFilter(doc, filter) {
  if (filter?.$or) return filter.$or.some(f => mockMatchesFilter(doc, f));
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && '$in' in v) return v.$in.includes(doc[k]);
    if (v && typeof v === 'object' && !Array.isArray(v)) return true; // unhandled operator: don't filter on it
    if (v === null) return doc[k] === null || doc[k] === undefined;
    return doc[k] === v;
  });
}
function mockMakeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    find:           jest.fn((filter) => ({
      lean: () => Promise.resolve(docs.filter(d => mockMatchesFilter(d, filter))),
    })),
    findOne:        jest.fn((filter) => mockChainObj(docs.find(d => mockMatchesFilter(d, filter)) || null)),
    countDocuments: jest.fn((filter) => Promise.resolve(docs.filter(d => mockMatchesFilter(d, filter)).length)),
    create:         jest.fn(async (doc) => { docs.push(doc); return { ...doc, toObject: () => doc }; }),
    findOneAndUpdate: jest.fn((filter, update) => {
      const doc = docs.find(d => mockMatchesFilter(d, filter));
      if (!doc) return mockChainObj(null);
      Object.assign(doc, update);
      return mockChainObj(doc);
    }),
    _docs:          docs,
  };
}

let mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/scopeMiddleware', () => ({ invalidateScopeCache: jest.fn() }));

// The legacy class: only ever had a Mongo _id, never got a real `id`.
const legacyClass = { _id: LEGACY_OID, schoolId: SCHOOL_A, name: 'Year 10' };
const uuidClass    = { id: 'cls_uuid_1', schoolId: SCHOOL_A, name: 'Grade 6' };
const year7Class   = { id: 'cls_yr7', schoolId: SCHOOL_A, name: 'Year 7' };

const teacherDoc  = { id: 'teacher_1', userId: 'usr_teacher1', schoolId: SCHOOL_A, firstName: 'Agnes', lastName: 'Otieno' };
const mathSubject  = { id: 'subj_math', schoolId: SCHOOL_A, name: 'Mathematics', isActive: true };
const frenchSubject = { id: 'subj_french', schoolId: SCHOOL_A, name: 'French', isActive: true };

const stream7i  = { id: 'strm_7i',  schoolId: SCHOOL_A, classId: 'cls_yr7', name: '7i' };
const stream7ii = { id: 'strm_7ii', schoolId: SCHOOL_A, classId: 'cls_yr7', name: '7ii', status: 'active' };

// A real, normally-created room — has a proper id. Every room actually
// created via rooms.js's POST route looks like this; the bug this covers
// was the CLIENT sending r._id for one of exactly these.
const LEGACY_ROOM_OID = '607f1f77bcf86cd799439099';
const ROOM1_OID = '707f1f77bcf86cd799439055';
const room1 = { id: 'room_1', _id: ROOM1_OID, schoolId: SCHOOL_A, name: 'RM 1', isActive: true };
// A legacy room with no real id — defense-in-depth case, not the reported bug.
const legacyRoom = { _id: LEGACY_ROOM_OID, schoolId: SCHOOL_A, name: 'Legacy Lab', isActive: true };

let mockClasses, mockTeachers, mockSubjects, mockRooms, mockAssignments, mockClassSubjects, mockStreams;
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (collection) => {
    if (collection === 'classes')             return mockClasses;
    if (collection === 'teachers')             return mockTeachers;
    if (collection === 'subjects')             return mockSubjects;
    if (collection === 'rooms')                return mockRooms;
    if (collection === 'teaching_assignments') return mockAssignments;
    if (collection === 'class_subjects')       return mockClassSubjects;
    if (collection === 'streams')              return mockStreams;
    throw new Error(`unexpected collection: ${collection}`);
  },
}));

const express = require('express');
const supertest = require('supertest');
const taRouter = require('../../routes/teaching-assignments');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/teaching-assignments', taRouter);
  return app;
}

function freshCollections() {
  mockClasses     = mockMakeFakeCollection([legacyClass, uuidClass, year7Class]);
  mockTeachers    = mockMakeFakeCollection([teacherDoc]);
  mockSubjects    = mockMakeFakeCollection([mathSubject, frenchSubject]);
  mockRooms       = mockMakeFakeCollection([room1, legacyRoom]);
  mockAssignments = mockMakeFakeCollection([]);
  mockClassSubjects = mockMakeFakeCollection([
    { schoolId: SCHOOL_A, classId: legacyClass._id, subjectId: mathSubject.id, isCompulsoryForClass: false },
    { schoolId: SCHOOL_A, classId: uuidClass.id,    subjectId: mathSubject.id, isCompulsoryForClass: false },
    { schoolId: SCHOOL_A, classId: year7Class.id,   subjectId: mathSubject.id, isCompulsoryForClass: true },
    { schoolId: SCHOOL_A, classId: year7Class.id,   subjectId: frenchSubject.id, isCompulsoryForClass: false },
  ]);
  mockStreams = mockMakeFakeCollection([stream7i, stream7ii]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockJwtUser = { userId: 'usr_admin', schoolId: SCHOOL_A, role: 'admin', roles: ['admin'] };
  freshCollections();
});

describe('POST /api/teaching-assignments — legacy (Mongo _id) class id', () => {
  test('creating an assignment against a class that only has _id (no real id) succeeds, not "Class not found"', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: LEGACY_OID });

    expect(res.status).toBe(201);
    expect(res.body?.data?.classId).toBe(LEGACY_OID);
    expect(res.body?.data?.className).toBe('Year 10');
  });

  test('a classId that genuinely matches nothing still 404s as "Class not found"', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: '000000000000000000000000' });

    expect(res.status).toBe(404);
    expect(res.body?.error?.message ?? res.body?.error).toMatch(/class not found/i);
  });

  test('a normal UUID-form classId still resolves via the plain id match (no regression)', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: uuidClass.id });

    expect(res.status).toBe(201);
    expect(res.body?.data?.className).toBe('Grade 6');
  });
});

describe('POST /api/teaching-assignments — curriculum prerequisite', () => {
  test('subject not in this class\'s curriculum is rejected', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: frenchSubject.id, classId: uuidClass.id }); // no class_subjects row

    expect(res.status).toBe(400);
    expect(res.body?.error?.message ?? res.body?.error).toMatch(/curriculum/i);
  });
});

describe('POST /api/teaching-assignments — elective vs compulsory stream rule', () => {
  test('elective subject: no streamId given → succeeds, whole-class grant (streamId null)', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: frenchSubject.id, classId: year7Class.id });

    expect(res.status).toBe(201);
    expect(res.body?.data?.streamId).toBeNull();
  });

  test('compulsory subject, class HAS streams, no streamId given → rejected', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: year7Class.id });

    expect(res.status).toBe(400);
    expect(res.body?.error?.message ?? res.body?.error).toMatch(/stream/i);
  });

  test('compulsory subject, class HAS streams, valid streamId given → succeeds, stream-scoped', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: year7Class.id, streamId: stream7i.id });

    expect(res.status).toBe(201);
    expect(res.body?.data?.streamId).toBe(stream7i.id);
    expect(res.body?.data?.streamName).toBe('7i');
  });

  test('a second teacher can be assigned the same compulsory subject in the OTHER stream — no conflict', async () => {
    const app = buildApp();
    await supertest(app).post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: year7Class.id, streamId: stream7i.id });

    const res2 = await supertest(app).post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: year7Class.id, streamId: stream7ii.id });

    expect(res2.status).toBe(201);
    expect(res2.body?.data?.streamId).toBe(stream7ii.id);
  });

  test('assigning the same teacher+subject+SAME stream twice is a conflict', async () => {
    const app = buildApp();
    await supertest(app).post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: year7Class.id, streamId: stream7i.id });

    const res2 = await supertest(app).post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: year7Class.id, streamId: stream7i.id });

    expect(res2.status).toBe(409);
  });

  test('a nonexistent streamId is rejected as "Stream not found"', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: year7Class.id, streamId: 'strm_does_not_exist' });

    expect(res.status).toBe(404);
    expect(res.body?.error?.message ?? res.body?.error).toMatch(/stream not found/i);
  });

  test('compulsory subject in a class with NO streams at all does not require a stream', async () => {
    mockClassSubjects = mockMakeFakeCollection([
      { schoolId: SCHOOL_A, classId: uuidClass.id, subjectId: mathSubject.id, isCompulsoryForClass: true },
    ]);
    mockStreams = mockMakeFakeCollection([]); // uuidClass has no streams at all

    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: uuidClass.id });

    expect(res.status).toBe(201);
    expect(res.body?.data?.streamId).toBeNull();
  });
});

describe('POST/PUT /api/teaching-assignments — Preferred Room resolution', () => {
  // The reported bug: TeacherAssignmentsTab's Preferred Room dropdown sent
  // r._id ?? r.id — every room always has a Mongo _id, so that fallback
  // never actually reached r.id at all. Every save that picked a room
  // failed with "Room not found", unconditionally — not intermittent, not
  // data-dependent. Client fix is the real one; this proves the server
  // side (now dual-id-tolerant, same as class/stream) independently.
  test('a normal room (has a real id) resolves correctly — no regression', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: uuidClass.id, preferredRoomId: room1.id });

    expect(res.status).toBe(201);
    expect(res.body?.data?.preferredRoomId).toBe('room_1');
    expect(res.body?.data?.preferredRoomName).toBe('RM 1');
  });

  test('submitting the room\'s raw Mongo _id (what the buggy dropdown sent) still resolves — defense in depth', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: uuidClass.id, preferredRoomId: ROOM1_OID });

    expect(res.status).toBe(201);
    expect(res.body?.data?.preferredRoomId).toBe('room_1'); // resolved back to the real id, not stored as the raw _id
  });

  test('a legacy room with no real id at all still resolves via its _id', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: uuidClass.id, preferredRoomId: LEGACY_ROOM_OID });

    expect(res.status).toBe(201);
    expect(res.body?.data?.preferredRoomId).toBe(LEGACY_ROOM_OID);
    expect(res.body?.data?.preferredRoomName).toBe('Legacy Lab');
  });

  test('a room id matching nothing at all still 404s as "Room not found"', async () => {
    const app = buildApp();
    const res = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: uuidClass.id, preferredRoomId: 'room_does_not_exist' });

    expect(res.status).toBe(404);
    expect(res.body?.error?.message ?? res.body?.error).toMatch(/room not found/i);
  });

  test('PUT /:id also resolves a room by its raw _id, not just POST', async () => {
    const app = buildApp();
    const create = await supertest(app)
      .post('/api/teaching-assignments')
      .send({ teacherId: teacherDoc.userId, subjectId: mathSubject.id, classId: uuidClass.id });
    const assignmentId = create.body.data.id;

    const res = await supertest(app)
      .put(`/api/teaching-assignments/${assignmentId}`)
      .send({ preferredRoomId: ROOM1_OID });

    expect(res.status).toBe(200);
    expect(res.body?.data?.preferredRoomId).toBe('room_1');
  });
});
