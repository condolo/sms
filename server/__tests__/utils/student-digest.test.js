'use strict';

/* The digest is the sentence a parent reads. These tests pin the two
   promises its header makes: a day counts once (worst status wins), and
   an empty window says so instead of reporting 0%. */

const { buildStudentDigest } = require('../../utils/student-digest');

const NOW = new Date('2026-11-04T09:00:00Z');
const student = { id: 's1', firstName: 'Amara', lastName: 'Osei', className: 'Form 1A' };

describe('buildStudentDigest', () => {
  test('a day with two records counts once, as its worst status', () => {
    const digest = buildStudentDigest({
      student,
      attendance: [
        { date: '2026-11-02', status: 'present' },
        { date: '2026-11-02', status: 'absent' },   // same day, second period
        { date: '2026-11-03', status: 'present' },
      ],
    }, { now: NOW, days: 30 });

    expect(digest.attendance.total).toBe(2);
    expect(digest.attendance.absent).toBe(1);
    expect(digest.attendance.percentage).toBe(50);
  });

  test('an empty window says so rather than claiming 0%', () => {
    const digest = buildStudentDigest({ student }, { now: NOW, days: 30 });
    expect(digest.attendance.percentage).toBeNull();
    expect(digest.lines[0]).toContain('no register entries');
    expect(digest.hasData).toBe(false);
  });

  test('merits and demerits are counted separately, points are net', () => {
    const digest = buildStudentDigest({
      student,
      incidents: [
        { type: 'merit', points: 5, label: 'Helped a classmate', date: '2026-11-01' },
        { type: 'demerit', points: -3, label: 'Late homework', date: '2026-11-02' },
      ],
    }, { now: NOW, days: 30 });

    expect(digest.behaviour.merits).toBe(1);
    expect(digest.behaviour.demerits).toBe(1);
    expect(digest.behaviour.points).toBe(2);
    expect(digest.behaviour.recent[0].label).toBe('Late homework'); // newest first
  });

  test('the academic average ignores unpublished and absent marks upstream, and reports a range', () => {
    const digest = buildStudentDigest({
      student,
      marks: [{ rawScore: 80 }, { rawScore: 40 }, { rawScore: 60 }],
    }, { now: NOW, days: 30 });

    expect(digest.academic.average).toBe(60);
    expect(digest.academic.weakest).toBe(40);
    expect(digest.academic.best).toBe(80);
    expect(digest.lines.join(' ')).toContain('60% average');
  });

  test('flags are for the teacher, not the guardian message', () => {
    const digest = buildStudentDigest({
      student,
      attendance: [
        { date: '2026-11-02', status: 'absent' },
        { date: '2026-11-03', status: 'present' },
      ],
      incidents: [{ type: 'demerit', points: -5, date: '2026-11-02' }],
      marks: [{ rawScore: 30 }],
    }, { now: NOW, days: 30 });

    expect(digest.flags).toEqual(
      expect.arrayContaining(['attendance below 85%', 'more demerits than merits', 'average below 50%'])
    );
    expect(digest.lines.join(' ')).not.toContain('average below 50%');
  });

  test('the window is inclusive of today and the calculated from-date', () => {
    const digest = buildStudentDigest({ student }, { now: NOW, days: 30 });
    expect(digest.window.to).toBe('2026-11-04');
    expect(digest.window.from).toBe('2026-10-06');
  });
});
