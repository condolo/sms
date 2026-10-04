/* ============================================================
   server/scripts/migrate-exam-results-to-markbook.js — pure planning
   logic (no DB). The script's dry run is the real verification against
   live data; these pin the rules it applies.
   ============================================================ */
'use strict';

const {
  toRawScore, resolveTermNumber, assignInstances, planResult, planExamStatusRemap,
} = require('../../scripts/migrate-exam-results-to-markbook');

const EXAM = {
  id: 'ex_1', classId: 'cls_1', subjectId: 'sub_bio', termId: 't1', academicYearId: 'ay_1',
  assessmentType: 'CA', assessmentLabel: 'Continuous Assessment', maxScore: 80, date: '2026-08-31',
};

describe('toRawScore — the Markbook rawScore is a 0-100 percentage', () => {
  test('converts a raw score against the exam maxScore', () => {
    expect(toRawScore(60, 80)).toBe(75);
    expect(toRawScore(90, 100)).toBe(90);
  });
  test('clamps to 0-100 and rounds to 2dp', () => {
    expect(toRawScore(120, 100)).toBe(100);
    expect(toRawScore(1, 3)).toBe(33.33);
  });
  test('returns null for a missing score or a non-positive maxScore', () => {
    expect(toRawScore(undefined, 100)).toBeNull();
    expect(toRawScore(50, 0)).toBeNull();
    expect(toRawScore(50, null)).toBeNull();
  });
});

describe('resolveTermNumber — 1-based position in the academic year terms', () => {
  const terms = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
  test('maps a termId to its position', () => {
    expect(resolveTermNumber(terms, 't2')).toBe(2);
  });
  test('an unknown or missing termId resolves to null', () => {
    expect(resolveTermNumber(terms, 'nope')).toBeNull();
    expect(resolveTermNumber(terms, undefined)).toBeNull();
  });
});

describe('assignInstances — sittings of the same type never collide', () => {
  test('a single sitting is instance 1', () => {
    const m = assignInstances([{ id: 'a', classId: 'c', subjectId: 's', termNumber: 1, assessmentType: 'CA', date: '2026-01-01' }]);
    expect(m.get('a')).toBe(1);
  });
  test('two sittings of the same type in one term are numbered by date', () => {
    const m = assignInstances([
      { id: 'late',  classId: 'c', subjectId: 's', termNumber: 1, assessmentType: 'CA', date: '2026-03-01' },
      { id: 'early', classId: 'c', subjectId: 's', termNumber: 1, assessmentType: 'CA', date: '2026-02-01' },
    ]);
    expect(m.get('early')).toBe(1);
    expect(m.get('late')).toBe(2);
  });
  test('different types or terms are separate groups', () => {
    const m = assignInstances([
      { id: 'ca',  classId: 'c', subjectId: 's', termNumber: 1, assessmentType: 'CA', date: '2026-01-01' },
      { id: 'mt',  classId: 'c', subjectId: 's', termNumber: 1, assessmentType: 'MT', date: '2026-01-01' },
      { id: 'ca2', classId: 'c', subjectId: 's', termNumber: 2, assessmentType: 'CA', date: '2026-01-01' },
    ]);
    expect(m.get('ca')).toBe(1);
    expect(m.get('mt')).toBe(1);
    expect(m.get('ca2')).toBe(1);
  });
});

describe('planResult — one exam_results row', () => {
  const base = { result: { id: 'r1', studentId: 'stu_1', score: 60, markState: 'present' }, exam: EXAM, studentStreamId: 'strm_1', termNumber: 1, instance: 1, existingMark: null, alreadyMigrated: false };

  test('a present result migrates with rawScore converted and carries its context', () => {
    const p = planResult(base);
    expect(p.action).toBe('migrate');
    expect(p.doc).toMatchObject({
      studentId: 'stu_1', subjectId: 'sub_bio', classId: 'cls_1', streamId: 'strm_1',
      termNumber: 1, assessmentType: 'CA', instance: 1, academicYearId: 'ay_1',
      markState: 'present', rawScore: 75, label: 'Continuous Assessment', isPublished: true,
    });
  });

  test('a non-present result carries no rawScore even if a score is stored', () => {
    const p = planResult({ ...base, result: { id: 'r1', studentId: 'stu_1', score: 60, markState: 'ABS' } });
    expect(p.doc.markState).toBe('ABS');
    expect(p.doc.rawScore).toBeNull();
  });

  test('a legacy absent:true with no markState maps to ABS', () => {
    const p = planResult({ ...base, result: { id: 'r1', studentId: 'stu_1', absent: true } });
    expect(p.doc.markState).toBe('ABS');
  });

  test('a present result with no usable score is skipped, not written as zero', () => {
    const p = planResult({ ...base, result: { id: 'r1', studentId: 'stu_1', score: undefined, markState: 'present' } });
    expect(p).toEqual({ action: 'skip', reason: 'invalid_score_or_max' });
  });

  test('an exam with no assessment type cannot be placed in the Markbook and is skipped', () => {
    const p = planResult({ ...base, exam: { ...EXAM, assessmentType: '' } });
    expect(p).toEqual({ action: 'skip', reason: 'exam_has_no_assessment_type' });
  });

  test('an orphaned result (no parent exam) is skipped', () => {
    expect(planResult({ ...base, exam: undefined })).toEqual({ action: 'skip', reason: 'orphan_exam' });
  });

  test('an unresolvable term is skipped', () => {
    expect(planResult({ ...base, termNumber: null })).toEqual({ action: 'skip', reason: 'term_unresolved' });
  });

  test('an existing Markbook value that differs is a conflict — the Markbook value is never overwritten', () => {
    const p = planResult({ ...base, existingMark: { markState: 'present', rawScore: 85 } });
    expect(p.action).toBe('conflict');
    expect(p.existing).toEqual({ markState: 'present', rawScore: 85 });
    expect(p.doc.rawScore).toBe(75);
  });

  test('an existing Markbook value that is identical is treated as already migrated, not a conflict', () => {
    const p = planResult({ ...base, existingMark: { markState: 'present', rawScore: 75 } });
    expect(p.action).toBe('already_migrated');
  });

  test('a row already migrated on a previous run is skipped (idempotent re-run)', () => {
    expect(planResult({ ...base, alreadyMigrated: true })).toEqual({ action: 'already_migrated' });
  });
});

describe('planExamStatusRemap — legacy exam statuses fold into completed', () => {
  test.each(['moderated', 'approved', 'locked', 'published', 'archived'])('%s is remapped to completed', (status) => {
    expect(planExamStatusRemap({ status })).toEqual({ action: 'remap', from: status, to: 'completed' });
  });
  test.each(['scheduled', 'in_progress', 'completed', 'cancelled'])('%s is left alone', (status) => {
    expect(planExamStatusRemap({ status })).toEqual({ action: 'none' });
  });
});

describe('legacyApprovalFor — only states the old system proves become an approval record', () => {
  const { legacyApprovalFor } = require('../../scripts/migrate-exam-results-to-markbook');
  test('approved carries forward as approved', () => {
    expect(legacyApprovalFor('approved')).toBe('approved');
  });
  test.each(['locked', 'published', 'archived'])('%s carries forward as locked', (status) => {
    expect(legacyApprovalFor(status)).toBe('locked');
  });
  test.each(['completed', 'moderated', 'in_progress', 'scheduled', undefined])('%s proves no approval, so nothing is invented', (status) => {
    expect(legacyApprovalFor(status)).toBeNull();
  });
});
