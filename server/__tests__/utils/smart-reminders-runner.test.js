'use strict';

/* The engine's own guarantees: preview and send agree, and a window
   that already went out does not send twice. The rules' wording is
   covered in smart-reminders.test.js; this file is about the runner. */

jest.mock('../../utils/model', () => ({ _model: jest.fn() }));
jest.mock('../../utils/notify-dispatch', () => ({ dispatchNotification: jest.fn(async () => {}) }));
jest.mock('../../utils/email', () => ({ sendSmartReminder: jest.fn(async () => {}) }));

const { _model } = require('../../utils/model');
const { dispatchNotification } = require('../../utils/notify-dispatch');
const { previewRule, runRule } = require('../../utils/smart-reminders');

function collection(docs = []) {
  return {
    docs,
    find: () => ({ select: () => ({ lean: async () => docs }), lean: async () => docs }),
    findOne: query => ({
      lean: async () => docs.find(d => Object.entries(query).every(([k, v]) => d[k] === v)) || null,
    }),
    create: async (doc) => { docs.push(doc); return doc; },
    updateOne: async (query, update) => {
      const row = docs.find(d => Object.entries(query).every(([k, v]) => d[k] === v));
      if (row && update?.$set) Object.assign(row, update.$set);
      return { modifiedCount: row ? 1 : 0 };
    },
  };
}

const NOW = new Date('2026-11-04T08:00:00Z');
const SCHOOL = 'sch_1';

const EXAM_ROWS = {
  exams: [{ id: 'e1', classId: 'c1', className: 'Form 1A', subjectName: 'Mathematics', title: 'Paper 1', date: '2026-11-11', startTime: '08:00', endTime: '10:00' }],
  students: [{ id: 's1', firstName: 'Amara', lastName: 'Osei', classId: 'c1' }],
  users: [{ id: 'u1', name: 'Amara Osei', email: 'a@x', studentId: 's1' }],
};

function install(rows = EXAM_ROWS) {
  const runs = [];
  _model.mockImplementation((name) => {
    if (name === 'smart_reminder_runs') return collection(runs);
    return collection(rows[name] || []);
  });
  return runs;
}

beforeEach(() => {
  dispatchNotification.mockClear();
});

test('preview lists the same people a send would reach', async () => {
  install();
  const preview = await previewRule('exam_upcoming', { schoolId: SCHOOL, now: NOW, tz: 'UTC' });
  expect(preview.total).toBe(1);
  expect(preview.recipients[0].userId).toBe('u1');

  await runRule('exam_upcoming', { schoolId: SCHOOL, now: NOW, tz: 'UTC' });
  expect(dispatchNotification).toHaveBeenCalledTimes(1);
  expect(dispatchNotification.mock.calls[0][0].recipients[0].userId).toBe('u1');
});

test('a second run inside the same window is refused, not repeated', async () => {
  const runs = install();
  const first = await runRule('exam_upcoming', { schoolId: SCHOOL, now: NOW, tz: 'UTC' });
  expect(first.sent).toBe(1);

  const second = await runRule('exam_upcoming', { schoolId: SCHOOL, now: NOW, tz: 'UTC' });
  expect(second.skipped).toBe(true);
  expect(dispatchNotification).toHaveBeenCalledTimes(1);
  expect(runs).toHaveLength(1);
});

test('force is a deliberate re-send, and records it', async () => {
  const runs = install();
  await runRule('exam_upcoming', { schoolId: SCHOOL, now: NOW, tz: 'UTC' });
  await runRule('exam_upcoming', { schoolId: SCHOOL, now: NOW, tz: 'UTC', force: true });
  expect(dispatchNotification).toHaveBeenCalledTimes(2);
  expect(runs).toHaveLength(1); // one row per window; the send count is the point
});

test('a dry run sends nothing and still reports the count', async () => {
  install();
  const out = await runRule('exam_upcoming', { schoolId: SCHOOL, now: NOW, tz: 'UTC', dryRun: true });
  expect(out.total).toBe(1);
  expect(dispatchNotification).not.toHaveBeenCalled();
});

test('the next day is a new window and sends again', async () => {
  install();
  await runRule('exam_upcoming', { schoolId: SCHOOL, now: NOW, tz: 'UTC' });
  // 2026-11-05 is "tomorrow" for an exam on the 6th, so move the exam too.
  install({ ...EXAM_ROWS, exams: [{ ...EXAM_ROWS.exams[0], date: '2026-11-06' }] });
  const next = await runRule('exam_upcoming', {
    schoolId: SCHOOL, now: new Date('2026-11-05T08:00:00Z'), tz: 'UTC',
  });
  expect(next.skipped).toBe(false);
  expect(next.sent).toBe(1);
});

test('a rule with nothing to say sends nothing', async () => {
  install({ exams: [], students: [], users: [] });
  const out = await runRule('exam_upcoming', { schoolId: SCHOOL, now: NOW, tz: 'UTC' });
  expect(out.sent).toBe(0);
  expect(dispatchNotification).not.toHaveBeenCalled();
});

test('a rule that runs elsewhere cannot be triggered from the console', async () => {
  install();
  const out = await runRule('lesson_plan_due', { schoolId: SCHOOL, now: NOW, tz: 'UTC' });
  expect(out.error).toMatch(/cannot be run/i);
  expect(dispatchNotification).not.toHaveBeenCalled();
});
