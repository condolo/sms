'use strict';

/* The rules' detect() halves are pure on purpose: these tests are the
   contract the console's Preview button relies on. If preview and send
   ever disagree, one of these fails. */

const {
  getRule, _daysBetween, _shiftDate, _weekday, _isoWeek, _localDate,
} = require('../../utils/smart-reminders');

describe('smart reminder helpers', () => {
  test('date math crosses month boundaries without drifting', () => {
    expect(_shiftDate('2026-01-28', 4)).toBe('2026-02-01');
    expect(_shiftDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(_daysBetween('2026-11-04', '2026-11-11')).toBe(7);
    expect(_daysBetween('2026-11-04', '2026-11-05')).toBe(1);
  });

  test('weekday and ISO week are stable', () => {
    expect(_weekday('2026-11-04')).toBe('wednesday');
    expect(_isoWeek('2026-11-04')).toBe('2026-W45');
  });

  test('a school-local date is not the server date', () => {
    // 23:30 UTC on the 4th is already the 5th in Nairobi (+3).
    const instant = new Date('2026-11-04T23:30:00Z');
    expect(_localDate(instant, 'UTC')).toBe('2026-11-04');
    expect(_localDate(instant, 'Africa/Nairobi')).toBe('2026-11-05');
  });
});

describe('exam_upcoming', () => {
  const rule = getRule('exam_upcoming');
  const today = '2026-11-04';
  const exam = (over = {}) => ({
    id: 'ex1', classId: 'c1', className: 'Form 1A', subjectName: 'Mathematics',
    title: 'Mathematics Paper 1', date: '2026-11-11', startTime: '08:00', endTime: '10:00', ...over,
  });

  const data = {
    today,
    exams: [exam()],
    students: [
      { id: 's1', firstName: 'Amara', lastName: 'Osei', classId: 'c1' },
      { id: 's2', firstName: 'Brian', lastName: 'Onyango', classId: 'c2' },
    ],
    people: [
      { id: 'u_student', name: 'Amara Osei', email: 'a@x', studentId: 's1' },
      { id: 'u_parent', name: 'Grace Osei', email: 'g@x', guardianOf: ['s1'] },
      { id: 'u_other', name: 'Other Parent', email: 'o@x', guardianOf: ['s2'] },
    ],
  };

  test('a week out, the student and their guardian both hear it', () => {
    const entries = rule.detect(data, { now: new Date(), tz: 'UTC' });
    expect(entries.map(e => e.userId).sort()).toEqual(['u_parent', 'u_student']);
    expect(entries[0].subject).toContain('in 7 days');
    expect(entries[0].body).toContain('Mathematics');
  });

  test('a guardian of a different class hears nothing', () => {
    const entries = rule.detect(data, { now: new Date(), tz: 'UTC' });
    expect(entries.find(e => e.userId === 'u_other')).toBeUndefined();
  });

  test('the day before uses a different sentence, not a second exam', () => {
    const tomorrow = { ...data, exams: [exam({ date: '2026-11-05' })] };
    const entries = rule.detect(tomorrow, { now: new Date(), tz: 'UTC' });
    expect(entries).toHaveLength(2);
    expect(entries[0].subject).toContain('tomorrow');
  });

  test('two exams on the same day arrive as one message with both lines', () => {
    const two = { ...data, exams: [exam(), exam({ id: 'ex2', subjectName: 'English' })] };
    const entries = rule.detect(two, { now: new Date(), tz: 'UTC' });
    const student = entries.find(e => e.userId === 'u_student');
    expect(student.subject).toContain('2 exams');
    expect(student.lines).toHaveLength(2);
  });

  test('an exam 3 days out is not today\'s business', () => {
    const later = { ...data, exams: [exam({ date: '2026-11-07' })] };
    expect(rule.detect(later, { now: new Date(), tz: 'UTC' })).toHaveLength(0);
  });
});

describe('class_register_missing', () => {
  const rule = getRule('class_register_missing');
  const base = {
    today: '2026-11-04',
    slots: [
      { classId: 'c1', period: '1', teacherId: 't1' },
      { classId: 'c2', period: '2', teacherId: 't1' },
      { classId: 'c3', period: '3', teacherId: 't2' },
    ],
    marked: new Set(['c3']),
    teachers: [
      { id: 't1', name: 'Mr Kimani', email: 'k@x' },
      { id: 't2', name: 'Ms Wanjiru', email: 'w@x' },
    ],
    office: [{ id: 'a1', name: 'Admin', email: 'a@x' }],
  };

  test('a teacher gets one message naming every class they left open', () => {
    const entries = rule.detect(base, { now: new Date('2026-11-04T09:00:00Z'), tz: 'UTC' });
    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe('t1');
    expect(entries[0].lines).toHaveLength(2);
    expect(entries[0].subject).toContain('2 registers');
  });

  test('a teacher whose only class was marked hears nothing', () => {
    const entries = rule.detect(base, { now: new Date('2026-11-04T09:00:00Z'), tz: 'UTC' });
    expect(entries.find(e => e.userId === 't2')).toBeUndefined();
  });

  test('after 16:00 the office gets the rollup too', () => {
    const entries = rule.detect(base, { now: new Date('2026-11-04T16:30:00Z'), tz: 'UTC' });
    const office = entries.filter(e => e.userId === 'a1');
    expect(office).toHaveLength(1);
    expect(office[0].subject).toContain('no register');
  });

  test('nothing unmarked, nobody messaged', () => {
    const clean = { ...base, marked: new Set(['c1', 'c2', 'c3']) };
    expect(rule.detect(clean, { now: new Date(), tz: 'UTC' })).toHaveLength(0);
  });
});

describe('notice_unread', () => {  const rule = getRule('notice_unread');
  const data = {
    notices: [
      { id: 'm1', subject: 'Sports day', senderId: 'staff1', recipients: ['p1', 'p2', 'staff1'], isRead: { p2: true }, createdAt: '2026-11-01T10:00:00Z' },
      { id: 'm2', subject: 'Fee deadline', senderId: 'staff1', recipients: ['p1'], isRead: {}, createdAt: '2026-11-02T10:00:00Z' },
    ],
    people: [
      { id: 'p1', name: 'Parent One', email: 'p1@x' },
      { id: 'p2', name: 'Parent Two', email: 'p2@x' },
      { id: 'staff1', name: 'Sender', email: 's@x' },
    ],
  };

  test('one nudge listing every unread notice, per person', () => {
    const entries = rule.detect(data, { now: new Date(), tz: 'UTC' });
    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe('p1');
    expect(entries[0].lines).toHaveLength(2);
  });

  test('a reader and the sender are never nudged', () => {
    const entries = rule.detect(data, { now: new Date(), tz: 'UTC' });
    expect(entries.map(e => e.userId)).not.toContain('p2');
    expect(entries.map(e => e.userId)).not.toContain('staff1');
  });
});

describe('at_risk_student', () => {
  const rule = getRule('at_risk_student');
  const base = {
    from: '2026-10-29',
    absences: [
      { studentId: 's1' }, { studentId: 's1' }, { studentId: 's1' },  // 3 — at risk
      { studentId: 's2' }, { studentId: 's2' },                        // 2 — below
    ],
    incidents: [{ studentId: 's2' }, { studentId: 's2' }],             // 2 — at risk
    students: [
      { id: 's1', firstName: 'Amara', lastName: 'Osei', classId: 'c1' },
      { id: 's2', firstName: 'Brian', lastName: 'Onyango', classId: 'c1' },
      { id: 's3', firstName: 'No', lastName: 'Teacher', classId: 'c2' },
    ],
    classes: [
      { id: 'c1', name: 'Form 1A', formTeacherId: 't1' },
      { id: 'c2', name: 'Form 2A', formTeacherId: null },
    ],
    teachers: [{ id: 't1', userId: 'u_teacher', firstName: 'Joseph', lastName: 'Kipchoge' }],
  };

  test('one message per form teacher, naming each child and why', () => {
    const entries = rule.detect(base, { now: new Date(), tz: 'UTC' });
    expect(entries).toHaveLength(1);
    expect(entries[0].userId).toBe('u_teacher');
    expect(entries[0].lines).toHaveLength(2);
    expect(entries[0].lines[0]).toContain('3 absences');
    expect(entries[0].lines[1]).toContain('2 incidents');
  });

  test('a class with no form teacher is skipped rather than spammed at nobody', () => {
    const onlyOrphan = {
      ...base,
      absences: [{ studentId: 's3' }, { studentId: 's3' }, { studentId: 's3' }],
      incidents: [],
    };
    expect(rule.detect(onlyOrphan, { now: new Date(), tz: 'UTC' })).toHaveLength(0);
  });

  test('below the threshold, nobody is messaged', () => {
    const quiet = { ...base, absences: [{ studentId: 's1' }, { studentId: 's1' }], incidents: [] };
    expect(rule.detect(quiet, { now: new Date(), tz: 'UTC' })).toHaveLength(0);
  });
});

describe('fee_deadline_staff', () => {
  const rule = getRule('fee_deadline_staff');
  const staff = [
    { id: 'f1', name: 'Bursar', email: 'f@x' },
    { id: 'a1', name: 'Admin', email: 'a@x' },
  ];

  test('the office gets the count and the total, not one message per invoice', () => {
    const entries = rule.detect({
      dueOn: '2026-11-06',
      invoices: [
        { id: 'i1', studentName: 'Amara', balance: 12000, currency: 'KES' },
        { id: 'i2', studentName: 'Brian', balance: 8000, currency: 'KES' },
      ],
      staff,
    }, { now: new Date(), tz: 'UTC' });

    expect(entries).toHaveLength(2);                       // one per person
    expect(entries[0].subject).toContain('2 invoices due in 2 days');
    expect(entries[0].body).toContain('20,000');
  });

  test('nothing due means nobody is told', () => {
    expect(rule.detect({ dueOn: '2026-11-06', invoices: [], staff }, { now: new Date(), tz: 'UTC' })).toHaveLength(0);
  });

  test('mixed currencies are totalled separately rather than added together', () => {
    const entries = rule.detect({
      dueOn: '2026-11-06',
      invoices: [
        { id: 'i1', studentName: 'A', balance: 1000, currency: 'KES' },
        { id: 'i2', studentName: 'B', balance: 20, currency: 'USD' },
      ],
      staff: [staff[0]],
    }, { now: new Date(), tz: 'UTC' });

    expect(entries[0].body).toContain('KES 1,000');
    expect(entries[0].body).toContain('USD 20');
  });
});
