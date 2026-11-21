/* ============================================================
   Past-results import + class history (v5.278.0)

   Pins, through the real router:
     - preview reads a mark sheet (admission number, subject columns by
       name or code, optional class/stream) and writes nothing; scores are
       converted from "out of" to the stored 0–100; leavers match;
       problems are reported per row;
     - commit writes marks for the EXACT year only — a legacy mark saved
       without a year is filed under its own year first, never adopted or
       overwritten by a past year's import;
     - existing marks are kept unless overwrite is chosen; locked marks
       are never touched;
     - each student's class for the year is saved, and a different class
       already on record is kept (reported, not overwritten);
     - undo removes what the batch added and restores what it replaced;
     - archived years and roles without full exam rights are refused;
     - yearForClass: promotion files the leaving class under the year
       that class's marks belong to.
   ============================================================ */
'use strict';

let mockJwtUser;
let mockFullExamRights = false;
jest.mock('../../middleware/auth', () => ({
  authMiddleware: (req, _res, next) => { req.jwtUser = mockJwtUser; next(); },
}));
jest.mock('../../middleware/rbac', () => ({ rbac: () => (_req, _res, next) => next(), hasExplicitSubGrant: async () => !!mockFullExamRights }));
jest.mock('../../middleware/plan', () => ({ planGate: () => (_req, _res, next) => next() }));
jest.mock('../../middleware/module-gate', () => ({ moduleGate: () => (_req, _res, next) => next() }));
jest.mock('../../services/audit', () => ({ log: jest.fn() }));
jest.mock('../../routes/assessment', () => ({
  getConfig: async () => ({ customTypes: [{ key: 'CA', label: 'CAT', instances: 2, weight: 30 }, { key: 'ET', label: 'End-Term', instances: 1, weight: 70 }, { key: 'HW', label: 'Homework', instances: 1, weight: 0 }] }),
}));

const { createFakeDb } = require('../fixtures/fake-tenant-db');
let mockDb;
// The shared fixture has no bulkWrite; this file adds it without changing the fixture.
function mockModel(name) {
  const m = mockDb.model(name);
  const rows = () => mockDb.data[name];
  const apply = (doc, u) => {
    Object.assign(doc, u.$set || {});
    for (const k of Object.keys(u.$unset || {})) delete doc[k];
    for (const [k, v] of Object.entries(u.$inc || {})) doc[k] = (doc[k] || 0) + v;
  };
  return {
    ...m,
    bulkWrite: async (ops) => {
      let upsertedCount = 0, modifiedCount = 0;
      for (const op of ops) {
        if (op.updateOne) {
          const { filter, update, upsert } = op.updateOne;
          const hit = (await m.find(filter).lean())[0];
          if (hit) { apply(rows().find(r => r.id === hit.id || (hit._id && r._id === hit._id)), update); modifiedCount++; continue; }
          if (!upsert) continue;
          const plain = Object.fromEntries(Object.entries(filter).filter(([k, v]) => !k.startsWith('$') && (typeof v !== 'object' || v === null)));
          const doc = { ...plain, ...(update.$setOnInsert || {}) };
          apply(doc, update);
          rows().push(doc);
          upsertedCount++;
        } else if (op.deleteOne) {
          const hit = (await m.find(op.deleteOne.filter).lean())[0];
          if (hit) mockDb.data[name] = rows().filter(r => r.id !== hit.id);
        }
      }
      return { upsertedCount, modifiedCount };
    },
    deleteMany: async (filter) => {
      const before = rows().length;
      const keep = [];
      for (const r of rows()) if (!(await m.find({ ...filter, id: r.id }).lean()).length) keep.push(r);
      mockDb.data[name] = keep;
      return { deletedCount: before - keep.length };
    },
  };
}
jest.mock('../../utils/tenant-model', () => ({
  tenantContext: (req) => ({ schoolId: req.jwtUser.schoolId }),
  tenantModel: (name) => mockModel(name),
}));
jest.mock('../../utils/model', () => ({ _model: (name) => mockModel(name) }));

const express = require('express');
const supertest = require('supertest');

const S = 'sch_1';
const ADMIN   = { userId: 'u_admin', schoolId: S, role: 'admin', roles: ['admin'] };
const TEACHER = { userId: 'u_t', schoolId: S, role: 'teacher', roles: ['teacher'] };
const api = (user = ADMIN) => { mockJwtUser = user; const a = express(); a.use(express.json()); a.use('/api/past-results', require('../../routes/past-results')); return supertest(a); };

const Y24 = 'y2024', Y26 = 'y2026';
const BASE = { academicYearId: Y24, termNumber: 2, assessmentType: 'ET', outOf: 50 };

function seed() {
  mockDb = createFakeDb({
    academic_years: [
      { id: Y24, schoolId: S, name: '2024', startDate: '2024-01-08', endDate: '2024-11-22', terms: [{ id: 't1' }, { id: 't2' }, { id: 't3' }] },
      { id: Y26, schoolId: S, name: '2026', startDate: '2026-01-05', endDate: '2026-11-20', isCurrent: true, terms: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }] },
    ],
    academic_config: [{ schoolId: S, archivedAcademicYears: [] }],
    classes: [{ id: 'g5', schoolId: S, name: 'Grade 5' }, { id: 'g6', schoolId: S, name: 'Grade 6' }],
    streams: [{ id: 'g5e', schoolId: S, classId: 'g5', name: 'East' }],
    subjects: [
      { id: 'math', schoolId: S, name: 'Mathematics', code: 'MAT' },
      { id: 'eng', schoolId: S, name: 'English', code: 'ENG' },
    ],
    students: [
      { id: 'ann', schoolId: S, admissionNumber: 'TR-001', firstName: 'Ann', lastName: 'A', classId: 'g6', status: 'active' },
      { id: 'ben', schoolId: S, admissionNumber: 'TR-002', firstName: 'Ben', lastName: 'B', classId: 'g6', status: 'active' },
      { id: 'cal', schoolId: S, admissionNumber: 'TR-003', firstName: 'Cal', lastName: 'C', status: 'graduated' },
    ],
    assessment_marks: [],
    student_class_history: [],
    past_result_imports: [],
  });
}
const marks = () => mockDb.data.assessment_marks;

const CSV = [
  'admissionNumber,name,class,stream,Mathematics,ENG,Total,Art',
  'tr-001,Ann A,Grade 5,East,40,ABS,40,9',
  'TR-002,Ben B,Grade 5,,25,30,55,',
  'TR-003,Cal C,Grade 5,,50,45,95,',
  'TR-009,Nobody,Grade 5,,10,10,20,',
  'TR-002,Ben again,Grade 5,,1,1,2,',
].join('\n');

describe('preview', () => {
  beforeEach(seed);

  test('reads the sheet, converts scores, reports problems — and writes nothing', async () => {
    const res = await api().post('/api/past-results/preview').send({ ...BASE, csv: CSV });
    expect(res.status).toBe(200);
    const p = res.body.data;
    expect(p.columns.subjects.map(c => c.subjectId)).toEqual(['math', 'eng']);
    expect(p.columns.ignored).toEqual(expect.arrayContaining(['name', 'Total']));
    expect(p.columns.unmatched).toEqual(['Art']);
    expect(p.studentsMatched).toBe(3);                     // includes the graduate
    expect(p.marks).toMatchObject({ total: 6, toCreate: 6, states: { ABS: 1 } });
    expect(p.errors.map(e => e.row)).toEqual([5, 6]);      // unknown student, duplicate row
    expect(p.classHistory.toRecord).toBe(3);
    expect(marks()).toEqual([]);
    expect(mockDb.data.student_class_history).toEqual([]);
  });

  test('a score above "out of" is refused for that row', async () => {
    const res = await api().post('/api/past-results/preview').send({ ...BASE, classId: 'g5', csv: 'admissionNumber,Mathematics\nTR-001,51\nTR-002,20' });
    expect(res.body.data.errors).toHaveLength(1);
    expect(res.body.data.marks.toCreate).toBe(1);
  });

  test('without a class column a class must be picked; an unknown assessment is refused', async () => {
    let res = await api().post('/api/past-results/preview').send({ ...BASE, csv: 'admissionNumber,Mathematics\nTR-001,20' });
    expect(res.status).toBe(422);
    res = await api().post('/api/past-results/preview').send({ ...BASE, classId: 'g5', csv: 'admissionNumber,Mathematics\nTR-001,20' });
    expect(res.status).toBe(200);
    res = await api().post('/api/past-results/preview').send({ ...BASE, assessmentType: 'XX', classId: 'g5', csv: 'admissionNumber,Mathematics\nTR-001,20' });
    expect(res.status).toBe(422);
  });

  test('archived year → refused; a teacher without full exam rights → 403, with them → allowed', async () => {
    mockDb.data.academic_config[0].archivedAcademicYears = [Y24];
    expect((await api().post('/api/past-results/preview').send({ ...BASE, csv: CSV })).status).toBe(422);
    mockDb.data.academic_config[0].archivedAcademicYears = [];
    mockFullExamRights = false;
    expect((await api(TEACHER).post('/api/past-results/preview').send({ ...BASE, csv: CSV })).status).toBe(403);
    mockFullExamRights = true;
    expect((await api(TEACHER).post('/api/past-results/preview').send({ ...BASE, csv: CSV })).status).toBe(200);
    mockFullExamRights = false;
  });
});

describe('commit and undo', () => {
  beforeEach(seed);

  test('writes marks for the exact year, files the class for the year, and records the batch', async () => {
    const res = await api().post('/api/past-results/commit').send({ ...BASE, csv: CSV, fileName: 'g5.csv' });
    expect(res.status).toBe(200);
    expect(res.body.data.result).toMatchObject({ created: 6, replaced: 0, classHistoryRecorded: 3, rowsWithProblems: 2 });
    const ann = marks().filter(m => m.studentId === 'ann');
    expect(ann).toHaveLength(2);
    expect(ann.find(m => m.subjectId === 'math')).toMatchObject({ academicYearId: Y24, termNumber: 2, assessmentType: 'ET', instance: 1, classId: 'g5', streamId: 'g5e', rawScore: 80, markState: 'present', isPublished: true, source: 'past_import' });
    expect(ann.find(m => m.subjectId === 'eng')).toMatchObject({ markState: 'ABS', rawScore: null });
    expect(mockDb.data.student_class_history.find(h => h.studentId === 'ann')).toMatchObject({ academicYearId: Y24, classId: 'g5', className: 'Grade 5', streamId: 'g5e', streamName: 'East', source: 'past_import' });
    expect(mockDb.data.past_result_imports[0]).toMatchObject({ fileName: 'g5.csv', status: 'imported', yearName: '2024' });
  });

  test('a legacy mark with no year is filed under its own year and never overwritten by a past import', async () => {
    marks().push({ id: 'legacy', schoolId: S, studentId: 'ann', subjectId: 'math', termNumber: 2, assessmentType: 'ET', instance: 1, academicYearId: null, rawScore: 61, createdAt: '2026-06-01T08:00:00Z', classId: 'g6' });
    await api().post('/api/past-results/commit').send({ ...BASE, onExisting: 'overwrite', csv: CSV });
    expect(marks().find(m => m.id === 'legacy')).toMatchObject({ academicYearId: Y26, rawScore: 61, classId: 'g6' });
    expect(marks().find(m => m.studentId === 'ann' && m.subjectId === 'math' && m.academicYearId === Y24).rawScore).toBe(80);
  });

  test('existing marks: kept by default, replaced on request; locked ones never change', async () => {
    marks().push(
      { id: 'm1', schoolId: S, studentId: 'ben', subjectId: 'math', termNumber: 2, assessmentType: 'ET', instance: 1, academicYearId: Y24, rawScore: 10, markState: 'present', classId: 'g5' },
      { id: 'm2', schoolId: S, studentId: 'cal', subjectId: 'math', termNumber: 2, assessmentType: 'ET', instance: 1, academicYearId: Y24, rawScore: 12, markState: 'present', classId: 'g5', isLocked: true },
    );
    let res = await api().post('/api/past-results/preview').send({ ...BASE, csv: CSV });
    expect(res.body.data.marks).toMatchObject({ toCreate: 4, existingSkipped: 1, lockedSkipped: 1 });

    res = await api().post('/api/past-results/commit').send({ ...BASE, onExisting: 'overwrite', csv: CSV });
    expect(res.body.data.result).toMatchObject({ created: 4, replaced: 1 });
    expect(marks().find(m => m.id === 'm1')).toMatchObject({ rawScore: 50, importPrev: { rawScore: 10 } });
    expect(marks().find(m => m.id === 'm2').rawScore).toBe(12);

    // Undo: added marks go, the replaced one comes back, history goes
    const batchId = res.body.data.batchId;
    res = await api().post(`/api/past-results/batches/${batchId}/undo`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ removed: 4, restored: 1, lockedKept: 0, classHistoryRemoved: 3 });
    expect(marks().map(m => m.id).sort()).toEqual(['m1', 'm2']);
    const m1 = marks().find(m => m.id === 'm1');
    expect(m1.rawScore).toBe(10);
    expect(m1.importPrev).toBeUndefined();
    expect(m1.importBatchId).toBeUndefined();
    expect(mockDb.data.student_class_history).toEqual([]);
    expect((await api().post(`/api/past-results/batches/${batchId}/undo`)).status).toBe(409);
  });

  test('a different class already on record for that year stays, with a note', async () => {
    mockDb.data.student_class_history.push({ id: 'h0', schoolId: S, studentId: 'ann', academicYearId: Y24, classId: 'g6', className: 'Grade 6', source: 'promotion' });
    const res = await api().post('/api/past-results/commit').send({ ...BASE, csv: CSV });
    expect(res.body.data.warnings.some(w => /already recorded in Grade 6/.test(w.message))).toBe(true);
    expect(mockDb.data.student_class_history.filter(h => h.studentId === 'ann')).toEqual([expect.objectContaining({ id: 'h0', classId: 'g6' })]);
  });

  test('class-history lists a student\x27s classes by year', async () => {
    await api().post('/api/past-results/commit').send({ ...BASE, csv: CSV });
    const res = await api().get('/api/past-results/class-history').query({ studentId: 'cal' });
    expect(res.body.data).toEqual([expect.objectContaining({ className: 'Grade 5', yearName: '2024' })]);
  });
});

describe('audit fixes', () => {
  beforeEach(seed);

  test('two students matching one admission number is reported, not guessed', async () => {
    mockDb.data.students.push({ id: 'dup', schoolId: S, admissionNumber: 'TR 001', firstName: 'Dup', lastName: 'D', status: 'active' });
    const res = await api().post('/api/past-results/preview').send({ ...BASE, classId: 'g5', csv: 'admissionNumber,Mathematics\nTR001,20\nTR-001,30' });
    // "TR-001" matches Ann exactly; "TR001" matches both loosely → ambiguous
    expect(res.body.data.errors).toEqual([expect.objectContaining({ row: 2, message: expect.stringMatching(/More than one student/) })]);
    expect(res.body.data.marks.toCreate).toBe(1);
  });

  test('two class names that read the same are reported', async () => {
    mockDb.data.classes.push({ id: 'g5b', schoolId: S, name: 'grade 5' });
    const res = await api().post('/api/past-results/preview').send({ ...BASE, csv: 'admissionNumber,class,Mathematics\nTR-001,Grade 5,20' });
    expect(res.body.data.errors[0].message).toMatch(/More than one class/);
  });

  test('a 0%-weight assessment is imported with a warning', async () => {
    const res = await api().post('/api/past-results/preview').send({ ...BASE, assessmentType: 'HW', classId: 'g5', csv: 'admissionNumber,Mathematics\nTR-001,20' });
    expect(res.body.data.warnings.some(w => /0% weight/.test(w.message))).toBe(true);
  });

  test('undo leaves a mark that was changed after the import', async () => {
    const res = await api().post('/api/past-results/commit').send({ ...BASE, csv: CSV });
    const edited = marks().find(m => m.studentId === 'ben' && m.subjectId === 'math');
    edited.rawScore = 99; edited._v = 1;                        // a Markbook save
    const undo = await api().post(`/api/past-results/batches/${res.body.data.batchId}/undo`);
    expect(undo.body.data).toMatchObject({ removed: 5, changedKept: 1 });
    expect(marks().map(m => m.rawScore)).toEqual([99]);
    expect(mockDb.data.student_class_history.map(h => h.studentId)).toEqual(['ben']);   // ben keeps his class
  });
});

describe('portal report order', () => {
  test('by year and term, not by publish date', () => {
    const { sortReportsByPeriod } = require('../../utils/report-order');
    const years = [{ id: Y24, startDate: '2024-01-08' }, { id: Y26, startDate: '2026-01-05' }];
    const out = sortReportsByPeriod([
      { id: 'cur-t2', academicYearId: Y26, termNumber: 2, publishedAt: '2026-08-01' },
      { id: 'old-t3', academicYearId: Y24, termNumber: 3, publishedAt: '2026-11-21' },   // back-year, published today
      { id: 'cur-t3', academicYearId: Y26, termNumber: 3, publishedAt: '2026-11-15' },
      { id: 'legacy', termNumber: 1, publishedAt: '2026-04-10' },                        // no year: placed by date
    ], years);
    expect(out.map(r => r.id)).toEqual(['cur-t3', 'cur-t2', 'legacy', 'old-t3']);
  });
});

describe('yearForClass (used by promotion)', () => {
  beforeEach(seed);
  test('the latest year with marks in that class, else the current year', async () => {
    const { yearForClass } = require('../../utils/class-history');
    const years = mockDb.data.academic_years;
    expect(await yearForClass({ schoolId: S }, S, 'g5', years, Y26, ['ann'])).toBe(Y26);
    // an earlier cohort's (imported) marks in the class never decide this cohort's year
    marks().push({ id: 'x', schoolId: S, classId: 'g5', studentId: 'old', academicYearId: Y24 });
    expect(await yearForClass({ schoolId: S }, S, 'g5', years, Y26, ['ann'])).toBe(Y26);
    marks().push({ id: 'y', schoolId: S, classId: 'g5', studentId: 'ann', academicYearId: Y24 });
    expect(await yearForClass({ schoolId: S }, S, 'g5', years, Y26, ['ann'])).toBe(Y24);
  });
});
