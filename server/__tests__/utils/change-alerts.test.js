'use strict';

/* Change alerts are event-driven, so the interesting questions are:
   does an unchanged row stay quiet, and does a changed one name the
   change in words a parent understands ("07:00 → 07:15")? */

jest.mock('../../utils/tenant-model', () => ({ tenantModel: jest.fn() }));
jest.mock('../../utils/notify-students', () => ({ notifyGuardiansForStudents: jest.fn(async () => {}) }));
jest.mock('../../utils/notify-dispatch', () => ({ dispatchNotification: jest.fn(async () => {}) }));

const { tenantModel } = require('../../utils/tenant-model');
const { notifyGuardiansForStudents } = require('../../utils/notify-students');
const { notifyTimetableChange, notifyRouteChange, _changedFields, _describe } = require('../../utils/change-alerts');

const ctx = { schoolId: 'sch_1' };

function rows(list) {
  return { select: () => ({ lean: async () => list }) };
}

function install(data = {}) {
  tenantModel.mockImplementation((name) => ({
    findOne: () => ({ select: () => ({ lean: async () => data[name] ?? null }) }),
    find: () => rows(Array.isArray(data[name]) ? data[name] : []),
  }));
}

beforeEach(() => {
  notifyGuardiansForStudents.mockClear();
});

describe('field diffing', () => {
  test('an untouched field is not a change', () => {
    expect(_changedFields({ a: 1, b: 2 }, { a: 1, b: 3 }, ['a', 'b'])).toEqual(['b']);
  });

  test('arrays are compared as values, not as "object Object"', () => {
    const before = { stops: [{ name: 'Gate' }] };
    const after = { stops: [{ name: 'Gate' }] };
    expect(_changedFields(before, after, ['stops'])).toEqual([]);
    expect(_changedFields(before, { stops: [{ name: 'Junction' }] }, ['stops'])).toEqual(['stops']);
  });

  test('a description reads before → after', () => {
    expect(_describe('departureTime', { departureTime: '07:00' }, { departureTime: '07:15' }, { departureTime: 'Departure' }))
      .toBe('Departure: 07:00 → 07:15');
  });
});

describe('notifyRouteChange', () => {
  test('a changed departure reaches every rider on that route', async () => {
    install({
      transport_assignments: [{ studentId: 's1' }, { studentId: 's2' }],
    });

    const out = await notifyRouteChange({
      ctx, schoolId: 'sch_1',
      before: { id: 'r1', name: 'Westlands Express', departureTime: '07:00' },
      after:  { id: 'r1', name: 'Westlands Express', departureTime: '07:15' },
    });

    expect(out.sent).toBe(2);
    expect(notifyGuardiansForStudents).toHaveBeenCalledTimes(1);
    const items = notifyGuardiansForStudents.mock.calls[0][0].items;
    expect(items).toHaveLength(2);
    expect(items[0].inAppSubject).toContain('Westlands Express');
    expect(items[0].inAppBody).toContain('07:00 → 07:15');
  });

  test('an edit that changes nothing sends nothing', async () => {
    install({ transport_assignments: [{ studentId: 's1' }] });

    const out = await notifyRouteChange({
      ctx, schoolId: 'sch_1',
      before: { id: 'r1', name: 'Route', departureTime: '07:00', stops: [{ name: 'A' }] },
      after:  { id: 'r1', name: 'Route', departureTime: '07:00', stops: [{ name: 'A' }] },
    });

    expect(out.skipped).toBe(true);
    expect(notifyGuardiansForStudents).not.toHaveBeenCalled();
  });

  test('a route nobody rides sends nothing', async () => {
    install({ transport_assignments: [] });
    const out = await notifyRouteChange({
      ctx, schoolId: 'sch_1',
      before: { id: 'r1', name: 'Route', departureTime: '07:00' },
      after:  { id: 'r1', name: 'Route', departureTime: '07:20' },
    });
    expect(out.sent).toBe(0);
    expect(notifyGuardiansForStudents).not.toHaveBeenCalled();
  });
});

describe('notifyTimetableChange', () => {
  test('a moved period reaches the class and names what moved', async () => {
    install({
      classes: { name: 'Form 1A' },
      subjects: { name: 'Mathematics' },
      students: [{ id: 's1' }, { id: 's2' }],
    });

    const out = await notifyTimetableChange({
      ctx, schoolId: 'sch_1',
      before: { classId: 'c1', subjectId: 'sub1', period: '2', day: 'monday' },
      after:  { classId: 'c1', subjectId: 'sub1', period: '3', day: 'monday' },
    });

    expect(out.sent).toBe(2);
    const items = notifyGuardiansForStudents.mock.calls[0][0].items;
    expect(items[0].inAppSubject).toContain('Mathematics');
    expect(items[0].inAppBody).toContain('Period: 2 → 3');
    expect(items[0].inAppBody).not.toContain('Day:');     // day did not change
  });

  test('a note-only edit stays silent', async () => {
    install({ classes: { name: 'Form 1A' }, students: [{ id: 's1' }] });
    const out = await notifyTimetableChange({
      ctx, schoolId: 'sch_1',
      before: { classId: 'c1', period: '2', notes: 'old' },
      after:  { classId: 'c1', period: '2', notes: 'new' },
    });
    expect(out.skipped).toBe(true);
    expect(notifyGuardiansForStudents).not.toHaveBeenCalled();
  });
});
