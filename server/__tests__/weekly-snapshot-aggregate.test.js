/* ============================================================
   server/utils/weekly-snapshot-aggregate.js — buildSnapshotsForSchool()

   Covers: week-range correctness (boundary-inclusive), timezone-aware
   filtering of instant-stamped fields (createdAt/issuedAt) across two
   distinct school timezones, and the batched-query shape — each source
   collection must be queried exactly once per school regardless of
   roster size, never once per student (the N+1 pattern this session's
   own audit flagged elsewhere in the codebase).

   All DB calls are mocked at the `_model()` boundary — no MongoDB
   required. tenantModel()'s real scoping wrapper runs unmocked on top,
   same as production wiring.
   ============================================================ */
'use strict';

const SCHOOL_A = 'school_a';

function mockChain(result) {
  return {
    select: () => mockChain(result), sort: () => mockChain(result), skip: () => mockChain(result),
    limit: () => mockChain(result), lean: () => Promise.resolve(result),
  };
}
function mockMatches(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (k === '$or') return v.some(sub => mockMatches(doc, sub));
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return v.$in.includes(doc[k]);
      if ('$ne' in v) return doc[k] !== v.$ne;
      if ('$exists' in v) return v.$exists ? (k in doc) : !(k in doc);
      if ('$gte' in v || '$lte' in v) {
        const val = doc[k];
        if ('$gte' in v && !(val >= v.$gte)) return false;
        if ('$lte' in v && !(val <= v.$lte)) return false;
        return true;
      }
      return true;
    }
    return doc[k] === v;
  });
}
function mockMakeStore(seed = []) {
  const findMock = jest.fn((filter) => mockChain(seed.filter(d => mockMatches(d, filter))));
  return { find: findMock, seed };
}

let mockStores;
jest.mock('../utils/model', () => ({ _model: jest.fn((col) => mockStores[col] ?? (mockStores[col] = mockMakeStore([]))) }));

const { buildSnapshotsForSchool } = require('../utils/weekly-snapshot-aggregate');

const ROSTER = [
  { id: 'stu_1', classId: 'cls_1', className: '5A', firstName: 'A', lastName: 'One' },
  { id: 'stu_2', classId: 'cls_1', className: '5A', firstName: 'B', lastName: 'Two' },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockStores = {
    assessment_marks:  mockMakeStore([]),
    attendance:        mockMakeStore([]),
    behaviour_incidents: mockMakeStore([]),
    medical_visits:    mockMakeStore([]),
    library_loans:     mockMakeStore([]),
    lesson_coverage:   mockMakeStore([]),
    growth_leadership: mockMakeStore([]),
    growth_activities: mockMakeStore([]),
    growth_service:    mockMakeStore([]),
    growth_awards:     mockMakeStore([]),
    growth_projects:   mockMakeStore([]),
  };
});

describe('week-range correctness (plain date-string fields)', () => {
  const weekStart = '2026-08-03'; // Monday
  const weekEnd   = '2026-08-09'; // Sunday

  test('attendance on the boundary dates is included; the day before/after is excluded', async () => {
    mockStores.attendance = mockMakeStore([
      { schoolId: SCHOOL_A, studentId: 'stu_1', status: 'present', date: '2026-08-02' }, // Sat before — excluded
      { schoolId: SCHOOL_A, studentId: 'stu_1', status: 'present', date: weekStart },     // Mon — included
      { schoolId: SCHOOL_A, studentId: 'stu_1', status: 'absent',  date: weekEnd },       // Sun — included
      { schoolId: SCHOOL_A, studentId: 'stu_1', status: 'late',    date: '2026-08-10' },  // Mon after — excluded
    ]);

    const result = await buildSnapshotsForSchool({ schoolId: SCHOOL_A }, weekStart, weekEnd, 'Africa/Nairobi', ROSTER);
    const att = result.get('stu_1').attendance;
    expect(att.total).toBe(2);
    expect(att.present).toBe(1);
    expect(att.absent).toBe(1);
    expect(att.records.map(r => r.date).sort()).toEqual([weekStart, weekEnd]);
  });

  test('lesson_coverage is grouped by classId, shared across every student in that class', async () => {
    mockStores.lesson_coverage = mockMakeStore([
      { schoolId: SCHOOL_A, classId: 'cls_1', subjectId: 'sub_1', subjectName: 'Math', topicId: 't1', topicTitle: 'Fractions', coveredAt: weekStart, teacherName: 'Ms X' },
    ]);
    const result = await buildSnapshotsForSchool({ schoolId: SCHOOL_A }, weekStart, weekEnd, 'Africa/Nairobi', ROSTER);
    expect(result.get('stu_1').topics).toHaveLength(1);
    expect(result.get('stu_2').topics).toHaveLength(1);
    expect(result.get('stu_1').topics[0].topicTitle).toBe('Fractions');
  });
});

describe('timezone-aware filtering of instant-stamped fields', () => {
  const weekStart = '2026-08-03'; // Monday
  const weekEnd   = '2026-08-09'; // Sunday

  // 2026-08-09T22:30:00Z is still Sunday Aug 9 in Africa/Nairobi (UTC+3,
  // local ~01:30 Aug 10) — wait, +3h pushes it to Aug 10 already. Pick an
  // instant that is genuinely on opposite local calendar days in the two
  // timezones under test: 2026-08-09T23:30:00Z is
  //   Africa/Nairobi (UTC+3): 2026-08-10 02:30 — the NEXT day, excluded
  //   America/New_York (UTC-4, EDT in August): 2026-08-09 19:30 — still
  //     inside the week, included
  const straddlingInstant = '2026-08-09T23:30:00.000Z';

  test('an assessment mark just past midnight UTC is excluded for an East-Africa school (already next week locally)', async () => {
    mockStores.assessment_marks = mockMakeStore([
      { schoolId: SCHOOL_A, studentId: 'stu_1', subjectId: 'sub_1', assessmentType: 'quiz', instance: 1, rawScore: 80, createdAt: straddlingInstant },
    ]);
    const result = await buildSnapshotsForSchool({ schoolId: SCHOOL_A }, weekStart, weekEnd, 'Africa/Nairobi', ROSTER);
    expect(result.get('stu_1').assignments).toHaveLength(0);
  });

  test('the identical instant is included for a US-Eastern school (still same local day)', async () => {
    mockStores.assessment_marks = mockMakeStore([
      { schoolId: SCHOOL_A, studentId: 'stu_1', subjectId: 'sub_1', assessmentType: 'quiz', instance: 1, rawScore: 80, createdAt: straddlingInstant },
    ]);
    const result = await buildSnapshotsForSchool({ schoolId: SCHOOL_A }, weekStart, weekEnd, 'America/New_York', ROSTER);
    expect(result.get('stu_1').assignments).toHaveLength(1);
    expect(result.get('stu_1').assignments[0].rawScore).toBe(80);
  });
});

describe('batched-query shape (N+1 avoidance)', () => {
  test('each of the 11 source collections is queried exactly once per school, regardless of roster size', async () => {
    await buildSnapshotsForSchool({ schoolId: SCHOOL_A }, '2026-08-03', '2026-08-09', 'Africa/Nairobi', ROSTER);

    const expectedCollections = [
      'assessment_marks', 'attendance', 'behaviour_incidents', 'medical_visits',
      'library_loans', 'lesson_coverage',
      'growth_leadership', 'growth_activities', 'growth_service', 'growth_awards', 'growth_projects',
    ];
    for (const col of expectedCollections) {
      expect(mockStores[col].find).toHaveBeenCalledTimes(1);
    }
  });

  test('an empty roster short-circuits with zero queries', async () => {
    const result = await buildSnapshotsForSchool({ schoolId: SCHOOL_A }, '2026-08-03', '2026-08-09', 'Africa/Nairobi', []);
    expect(result.size).toBe(0);
    expect(mockStores.attendance.find).not.toHaveBeenCalled();
  });
});

describe('every roster student gets a result, even with zero activity', () => {
  test('a student with no records anywhere still gets an entry with empty sections', async () => {
    const result = await buildSnapshotsForSchool({ schoolId: SCHOOL_A }, '2026-08-03', '2026-08-09', 'Africa/Nairobi', ROSTER);
    expect(result.has('stu_1')).toBe(true);
    expect(result.has('stu_2')).toBe(true);
    expect(result.get('stu_2').assignments).toEqual([]);
    expect(result.get('stu_2').attendance.total).toBe(0);
  });
});
