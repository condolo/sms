/* ============================================================
   Lesson coverage export (v5.287.0)

   GET /lessons/coverage-report, through the real router: who may export;
   rows have exactly the Overview's figures (stream rules, legacy topics,
   other years, one student's marks, other schools); by teacher, class or
   stream; topic detail with dates; CSV formula cells made plain text;
   PDF; escaped HTML; audit.
   ============================================================ */
'use strict';

let mockJwtUser;
jest.mock('../../middleware/auth', () => ({ authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); } }));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: async () => true }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/scopeMiddleware', () => ({ scopeMiddleware: (_req, _res, next) => next(), invalidateScopeCache: () => {} }));
jest.mock('../../utils/scopeEngine', () => ({ resolveLessonsScope: async () => null, isClassInScope: () => true }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../utils/resolveTeacher', () => ({ resolveTeacher: async () => ({ title: 'Ms.', firstName: 'Ann', lastName: 'Teacher' }) }));
jest.mock('../../utils/timetable-publish', () => ({
  timetableReaderFor: async () => mockModel('timetable'), publishedReader: async () => mockModel('timetable'), isTimetablePublished: async () => true,
}));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
// Upsert, deletes and $addToSet, which the shared fixture leaves out.
function mockModel(name) {
  const m = mockDb.model(name);
  const rows = () => (mockDb.data[name] = mockDb.data[name] || []);
  const hits = async (f) => { const ids = (await m.find(f).lean()).map(r => r.id); return rows().filter(r => ids.includes(r.id)); };
  return {
    ...m,
    findOneAndUpdate: (filter, update) => ({ lean: async () => {
      const r = (await hits(filter))[0];
      if (r) { Object.assign(r, update.$set || {}); return { ...r }; }
      const plain = Object.fromEntries(Object.entries(filter).filter(([, v]) => typeof v !== 'object' || v === null));
      const doc = { ...plain, ...(update.$setOnInsert || {}), ...(update.$set || {}) };
      rows().push(doc);
      return { ...doc };
    } }),
    findOneAndDelete: async (filter) => {
      const r = (await hits(filter))[0];
      if (!r) return null;
      mockDb.data[name] = rows().filter(x => x.id !== r.id);
      return r;
    },
    deleteMany: async (filter) => {
      const gone = await hits(filter);
      mockDb.data[name] = rows().filter(x => !gone.includes(x));
      return { deletedCount: gone.length };
    },
    updateMany: async (filter, update) => {
      const list = await hits(filter);
      for (const r of list) {
        Object.assign(r, update.$set || {});
        for (const [k, v] of Object.entries(update.$addToSet || {})) r[k] = [...new Set([...(r[k] || []), v])];
      }
      return { modifiedCount: list.length };
    },
  };
}
jest.mock('../../utils/tenant-model', () => ({ tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }), tenantModel: (name) => mockModel(name) }));
jest.mock('../../utils/model', () => ({ _model: (name) => mockModel(name) }));
jest.mock('../../utils/html-to-pdf', () => ({ htmlToPdfBufferOrFallback: async (html, fallback) => { mockLastHtml = html; return fallback(); } }));
let mockLastHtml = '';

const express = require('express');
const supertest = require('supertest');
const AuditService = require('../../services/audit');
const { renderCoverageHtml, csvCell } = require('../../utils/coverage-report');

const S = 'sch_1';
const asUser = (userId, role = 'teacher') => ({ userId, schoolId: S, role, roles: [role] });
const ADMIN = asUser('u_admin', 'admin');
const HOD = asUser('u_hod', 'hod');
const api = (who) => { mockJwtUser = who; const a = express(); a.use(express.json()); a.use('/api/lessons', require('../../routes/lessons')); return supertest(a); };

const asg = (id, teacherId, classId, subjectId, streamId, x = {}) => ({
  id, schoolId: S, teacherId, teacherName: `T ${teacherId}`, classId, className: classId.toUpperCase(), subjectId, subjectName: subjectId.toUpperCase(),
  streamId, streamName: streamId ? streamId[0].toUpperCase() + streamId.slice(1) : undefined, ...x,
});
const tick = (id, x) => ({ id, schoolId: S, academicYear: '2026', classId: 'f1', subjectId: 'math', teacherId: 'u_x', coveredAt: '2026-10-01T09:00:00Z', ...x });

function seed() {
  mockDb = createFakeDb({
    schools: [{ id: S, name: 'Test School', academicYear: '2026' }, { id: 'sch_2', name: 'Other', academicYear: '2026' }],
    users: [{ id: 'u_admin', schoolId: S, name: 'Head Teacher' }],
    subjects: [
      { id: 'math', schoolId: S, name: 'Mathematics', departmentId: 'sci' },
      { id: 'eng', schoolId: S, name: 'English' },                                   // no department on the subject
      { id: 'math', schoolId: 'sch_2', name: 'Maths', departmentId: 'lang' },
    ],
    departments: [
      { id: 'sci', schoolId: S, name: 'Sciences' }, { id: 'lang', schoolId: S, name: 'Languages' }, { id: 'old', schoolId: S, name: 'Old dept' },
      { id: 'sci', schoolId: 'sch_2', name: 'Wrong school' },
    ],
    syllabus_topics: [
      { id: 'm1', schoolId: S, subjectId: 'math', classId: 'f1', academicYear: '2026', title: 'Algebra', order: 1, subtopics: [{ id: 'a', title: 'Expressions' }, { id: 'b', title: 'Equations' }] },
      { id: 'm2', schoolId: S, subjectId: 'math', classId: 'f1', academicYear: '2026', title: 'Geometry', order: 2, subtopics: [] },
      { id: 'mold', schoolId: S, subjectId: 'math', academicYear: '2026', title: 'Legacy topic', order: 3, subtopics: [] },        // saved before class scoping: every class
      { id: 'm9', schoolId: S, subjectId: 'math', classId: 'f2', academicYear: '2026', title: 'Form 2 only', order: 1, subtopics: [] },
      { id: 'mlast', schoolId: S, subjectId: 'math', classId: 'f1', academicYear: '2025', title: 'Last year', order: 1, subtopics: [] },
      { id: 'e1', schoolId: S, subjectId: 'eng', classId: 'f1', academicYear: '2026', title: '=HYPERLINK("x")', order: 1, subtopics: [] },
      { id: 'x1', schoolId: 'sch_2', subjectId: 'math', classId: 'f1', academicYear: '2026', title: 'Other school', order: 1, subtopics: [] },
    ],
    lesson_coverage: [
      tick('w1', { topicId: 'm2' }),                                                       // whole class: every stream
      tick('w2', { topicId: 'm1', subtopicId: 'a', notForStreams: ['blue'] }),             // whole class, unticked by Blue
      tick('r1', { topicId: 'm1', subtopicId: 'b', streamId: 'red', coveredAt: '2026-10-05T09:00:00Z' }),
      tick('r2', { topicId: 'm2', streamId: 'red', coveredAt: '2026-10-07T09:00:00Z' }),   // Red's own tick: its date wins
      tick('s1', { topicId: 'mold', studentId: 'stu1' }),                                  // one student: not class progress
      tick('y1', { topicId: 'mlast', academicYear: '2025' }),
      tick('x1', { schoolId: 'sch_2', topicId: 'x1' }),
    ],
    teaching_assignments: [
      asg('a1', 'u_red', 'f1', 'math', 'red', { departmentId: 'old' }),   // stale copy: the subject says Sciences
      asg('a2', 'u_blue', 'f1', 'math', 'blue'),
      asg('a3', 'u_red', 'f1', 'eng', null, { departmentId: 'lang' }), // whole-class English; subject has no department, so its saved one is used
      asg('a4', 'u_red', 'f2', 'math', null),
      { ...asg('ax', 'u_red', 'f1', 'math', 'red'), id: 'ax', schoolId: 'sch_2' },
    ],
  });
}

function parseCsv(text) {
  expect(text.charCodeAt(0)).toBe(0xFEFF);
  return text.slice(1).split('\r\n').map(line => {
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  });
}
const csv = async (who, query) => {
  const r = await api(who).get('/api/lessons/coverage-report').query({ format: 'csv', ...query }).buffer(true).parse((res, cb) => { let d = ''; res.setEncoding('utf8'); res.on('data', c => { d += c; }); res.on('end', () => cb(null, d)); });
  return { status: r.status, rows: r.status === 200 ? parseCsv(r.body) : null, res: r };
};

beforeEach(() => { seed(); AuditService.log.mockClear(); mockLastHtml = ''; });

describe('who may export', () => {
  test('a teacher is refused; an HOD and an admin get it (same people as Overview)', async () => {
    expect((await csv(asUser('u_red'), { teacherId: 'u_red' })).status).toBe(403);
    expect((await csv(HOD, { teacherId: 'u_red' })).status).toBe(200);
    expect((await csv(ADMIN, { teacherId: 'u_red' })).status).toBe(200);
  });

  test('bad requests are refused before anything is read (a stream without its class, an unknown format)', async () => {
    const q = (query) => api(ADMIN).get('/api/lessons/coverage-report').query(query);
    expect((await q({ format: 'csv', teacherId: 'u_red', streamId: 'red' })).status).toBe(422);
    expect((await q({ format: 'xlsx', teacherId: 'u_red' })).status).toBe(422);
    expect(AuditService.log).not.toHaveBeenCalled();
  });

  test('nothing matching, or another school\'s ids, is a 404 and never another school\'s data', async () => {
    expect((await csv(ADMIN, { teacherId: 'u_nobody' })).status).toBe(404);
    mockJwtUser = { ...ADMIN, schoolId: 'sch_3' };
    const r = await api({ ...ADMIN, schoolId: 'sch_3' }).get('/api/lessons/coverage-report').query({ format: 'csv', teacherId: 'u_red' });
    expect(r.status).toBe(404);
  });
});

describe('figures', () => {
  test('every row has exactly the figures Lessons → Overview shows', async () => {
    const sum = (await api(ADMIN).get('/api/lessons/summary')).body.data;
    const byKey = Object.fromEntries(sum.map(r => [`${r.className}|${r.streamName ?? ''}|${r.subjectName}|${r.teacherName}`, r]));
    const { rows } = await csv(ADMIN, { classId: 'f1' });
    expect(rows[0]).toEqual(['Teacher', 'Class', 'Stream', 'Subject', 'Department', 'Items covered', 'Total items', 'Coverage %', 'Academic year']);
    const data = rows.slice(1);
    expect(data).toHaveLength(3);
    for (const [teacher, cls, stream, subject, , covered, total, pct] of data) {
      const s = byKey[`${cls}|${stream === 'Whole class' ? '' : stream}|${subject}|${teacher}`];
      expect(s).toBeDefined();
      expect([Number(covered), Number(total), Number(pct)]).toEqual([s.coveredItems, s.totalItems, s.pct]);
    }
  });

  test('stream rules: whole-class ticks count for every stream unless unticked there; a stream\'s tick only for it; one student\'s mark never', async () => {
    const { rows } = await csv(ADMIN, { classId: 'f1' });
    const get = (stream, subject) => rows.find(r => r[2] === stream && r[3] === subject).slice(5, 8);
    // Items: Expressions, Equations, Geometry, Legacy topic = 4
    expect(get('Red', 'MATH')).toEqual(['3', '4', '75']);    // a (whole) + b (own) + Geometry
    expect(get('Blue', 'MATH')).toEqual(['1', '4', '25']);   // Geometry only: Blue unticked a
    expect(get('Whole class', 'ENG')).toEqual(['0', '1', '0']);
  });

  test('by teacher: that teacher\'s classes only, every class they teach', async () => {
    const { rows } = await csv(ADMIN, { teacherId: 'u_red' });
    expect(rows.slice(1).map(r => `${r[1]}|${r[2]}|${r[3]}`)).toEqual(['F1|Whole class|ENG', 'F1|Red|MATH', 'F2|Whole class|MATH']);
    expect(rows.slice(1).every(r => r[0] === 'T u_red')).toBe(true);
    expect(rows.find(r => r[1] === 'F2').slice(5, 7)).toEqual(['0', '2']);   // Form 2 only + Legacy topic
  });

  test('one stream lists that stream and the whole-class subjects, never a sibling stream', async () => {
    const { rows } = await csv(ADMIN, { classId: 'f1', streamId: 'red' });
    expect(rows.slice(1).map(r => `${r[2]}|${r[3]}`).sort()).toEqual(['Red|MATH', 'Whole class|ENG']);
  });
});

describe('topic detail', () => {
  test('each topic and subtopic, covered or not, with the date; the stream\'s own tick date wins', async () => {
    const { rows } = await csv(ADMIN, { classId: 'f1', streamId: 'red', topics: '1' });
    expect(rows[0]).toEqual(['Teacher', 'Class', 'Stream', 'Subject', 'Department', 'Topic', 'Subtopic', 'Covered', 'Date covered', 'Subject coverage %', 'Academic year']);
    const red = rows.filter(r => r[2] === 'Red').map(r => [r[5], r[6], r[7], r[8]]);
    expect(red).toEqual([
      ['Algebra', 'Expressions', 'Yes', '01/10/2026'],
      ['Algebra', 'Equations', 'Yes', '05/10/2026'],
      ['Geometry', '', 'Yes', '07/10/2026'],
      ['Legacy topic', '', 'No', ''],
    ]);
    // Same count as the summary figure.
    expect(red.filter(r => r[2] === 'Yes')).toHaveLength(3);
  });

  test('a cell that would run as a spreadsheet formula is made plain text', async () => {
    const { rows } = await csv(ADMIN, { classId: 'f1', topics: '1' });
    expect(rows.find(r => r[3] === 'ENG')[5]).toBe('\'=HYPERLINK("x")');
    expect(csvCell('+1')).toBe('"\'+1"');
    expect(csvCell('-2')).toBe('"\'-2"');
    expect(csvCell('@a')).toBe('"\'@a"');
    expect(csvCell('Plain')).toBe('"Plain"');
  });
});

describe('PDF and audit', () => {
  test('a PDF comes back (PDFKit fallback here), from the same rows the HTML shows', async () => {
    const r = await api(ADMIN).get('/api/lessons/coverage-report').query({ format: 'pdf', teacherId: 'u_red', topics: '1' })
      .buffer(true).parse((res, cb) => { const d = []; res.on('data', c => d.push(c)); res.on('end', () => cb(null, Buffer.concat(d))); });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toBe('attachment; filename="lesson-coverage-t-u-red-2026.pdf"');
    expect(r.body.slice(0, 4).toString()).toBe('%PDF');
    expect(mockLastHtml).toContain('Teacher: T u_red');
    expect(mockLastHtml).toContain('Overall: 3 of 7 items covered (43%)');
    expect(mockLastHtml).toContain('Generated');
    expect(mockLastHtml).toContain('by Head Teacher');
    expect(mockLastHtml).toContain('=HYPERLINK(&quot;x&quot;)');
  });

  test('names and topics are escaped in the HTML', () => {
    const html = renderCoverageHtml({ school: { name: '<b>S</b>' }, scopeLabel: 'Class: X', academicYear: '2026', withTopics: true,
      rows: [{ teacherName: '<script>x</script>', className: 'X', streamName: '', wholeClass: true, subjectName: 'M', totalItems: 1, coveredItems: 0, pct: 0, topics: [{ title: '<img>', items: null, covered: false, coveredAt: null }] }] });
    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('<img>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('every export is written to the Audit Log', async () => {
    await csv(ADMIN, { classId: 'f1', streamId: 'red', topics: '1' });
    expect(AuditService.log).toHaveBeenCalledTimes(1);
    expect(AuditService.log.mock.calls[0][0]).toMatchObject({
      action: 'lessons.coverage_exported', schoolId: S,
      target: { type: 'coverage_report', id: 'f1', label: 'Class: F1 · Red' },
      details: { format: 'csv', withTopics: true, classId: 'f1', streamId: 'red', academicYear: '2026', rows: 2 },
    });
  });
});

describe('names missing on the assignment', () => {
  test('come from the staff, class, subject and stream records, in the export and the Overview; a saved name is kept', async () => {
    mockDb.data.teaching_assignments.push({ id: 'a5', schoolId: S, teacherId: 'u_new', classId: 'f3', subjectId: 'bio', streamId: 'gold' });
    mockDb.data.teachers = [
      { id: 'tch_9', userId: 'u_new', schoolId: S, title: 'Ms.', firstName: 'Agnes', lastName: 'Otieno' },
      { id: 'tch_x', userId: 'u_new', schoolId: 'sch_2', title: 'Mr.', firstName: 'Wrong', lastName: 'School' },
      { id: 'tch_r', userId: 'u_red', schoolId: S, firstName: 'Not', lastName: 'Used' },
    ];
    mockDb.data.classes = [{ id: 'f3', schoolId: S, name: 'Form 3' }, { id: 'f3', schoolId: 'sch_2', name: 'Wrong' }];
    mockDb.data.subjects = [{ id: 'bio', schoolId: S, name: 'Biology' }];
    mockDb.data.streams = [{ id: 'gold', schoolId: S, classId: 'f3', name: 'Gold' }];

    const { rows } = await csv(ADMIN, { teacherId: 'u_new' });
    expect(rows.slice(1).map(r => r.slice(0, 5))).toEqual([['Ms. Agnes Otieno', 'Form 3', 'Gold', 'Biology', '']]);

    const sum = (await api(ADMIN).get('/api/lessons/summary')).body.data;
    expect(sum.find(r => r.teacherId === 'u_new')).toMatchObject({ teacherName: 'Ms. Agnes Otieno', className: 'Form 3', streamName: 'Gold', subjectName: 'Biology' });
    expect(sum.find(r => r.teacherId === 'u_red').teacherName).toBe('T u_red');
  });
});

describe('filters (v5.288.0): any mix, none = the whole school', () => {
  const keys = (rows) => rows.slice(1).map(r => `${r[1]}|${r[2]}|${r[3]}`);

  test('no filter: every class-subject in the school, never another school\'s', async () => {
    const { rows } = await csv(ADMIN, {});
    expect(keys(rows)).toEqual(['F1|Whole class|ENG', 'F1|Blue|MATH', 'F1|Red|MATH', 'F2|Whole class|MATH']);
    const r = await api(ADMIN).get('/api/lessons/coverage-report').query({ format: 'pdf' }).buffer(true).parse((res, cb) => { res.on('data', () => {}); res.on('end', () => cb(null, null)); });
    expect(r.status).toBe(200);
    expect(mockLastHtml).toContain('Whole school');
    expect(AuditService.log.mock.calls.at(-1)[0]).toMatchObject({ target: { type: 'coverage_report', id: S, label: 'Whole school' } });
  });

  test('per subject, and combined with a class', async () => {
    expect(keys((await csv(ADMIN, { subjectId: 'math' })).rows)).toEqual(['F1|Blue|MATH', 'F1|Red|MATH', 'F2|Whole class|MATH']);
    expect(keys((await csv(ADMIN, { subjectId: 'math', classId: 'f1' })).rows)).toEqual(['F1|Blue|MATH', 'F1|Red|MATH']);
    expect(keys((await csv(ADMIN, { subjectId: 'math', teacherId: 'u_red' })).rows)).toEqual(['F1|Red|MATH', 'F2|Whole class|MATH']);
  });

  test('per department: the subject\'s current department wins over a stale copy on the assignment; the copy counts only when the subject has none', async () => {
    const sci = await csv(ADMIN, { departmentId: 'sci' });
    expect(keys(sci.rows)).toEqual(['F1|Blue|MATH', 'F1|Red|MATH', 'F2|Whole class|MATH']);
    expect(sci.rows.slice(1).every(r => r[4] === 'Sciences')).toBe(true);
    expect(keys((await csv(ADMIN, { departmentId: 'lang' })).rows)).toEqual(['F1|Whole class|ENG']);
    expect((await csv(ADMIN, { departmentId: 'old' })).status).toBe(404);
    expect(mockLastHtml).toBe('');
  });

  test('the Overview uses the same selection: department filter and names on its rows', async () => {
    const sum = (await api(ADMIN).get('/api/lessons/summary').query({ departmentId: 'sci' })).body.data;
    expect(sum.map(r => r.subjectId)).toEqual(['math', 'math', 'math']);
    expect(sum.every(r => r.departmentId === 'sci' && r.departmentName === 'Sciences')).toBe(true);
    const all = (await api(ADMIN).get('/api/lessons/summary')).body.data;
    expect(all.find(r => r.subjectId === 'eng')).toMatchObject({ departmentId: 'lang', departmentName: 'Languages' });
    // A filter that isn't a plain string is ignored, never passed to the database.
    const odd = (await api(ADMIN).get('/api/lessons/summary?classId[$in][]=f2')).body.data;
    expect(odd).toHaveLength(4);
  });

  test('a PDF listing every topic is limited to 150 class-subjects; without topics, or as CSV, it is not', async () => {
    for (let i = 0; i < 150; i++) mockDb.data.teaching_assignments.push(asg(`z${i}`, 'u_z', `c${i}`, 'math', null));
    const big = await api(ADMIN).get('/api/lessons/coverage-report').query({ format: 'pdf', topics: '1' });
    expect(big.status).toBe(422);
    expect(big.body.error.code).toBe('TOO_LARGE');
    expect(big.body.error.message).toContain('154 class-subjects');
    expect((await csv(ADMIN, { topics: '1' })).status).toBe(200);
    const plain = await api(ADMIN).get('/api/lessons/coverage-report').query({ format: 'pdf' }).buffer(true).parse((res, cb) => { res.on('data', () => {}); res.on('end', () => cb(null, null)); });
    expect(plain.status).toBe(200);
  });
});
