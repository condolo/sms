'use strict';

/* Term billing bills the fare captured when the student was assigned,
   not today's route price. These are the two halves of that promise:
   the snapshot wins, and an older assignment with no snapshot still
   falls back to the route's own fare instead of being quietly skipped. */

const { buildTermLines } = require('../../utils/term-billing');

const term = { startDate: '2026-01-05', endDate: '2026-03-31' };
const route = { id: 'rte_1', name: 'Westlands Express', fares: [{ fareType: 'two_way', amount: 12000 }] };

const assignment = (over = {}) => ({
  id: 'asg_1',
  studentId: 'stu_1',
  routeId: 'rte_1',
  routeName: 'Westlands Express',
  status: 'active',
  fareType: 'two_way',
  startDate: '2026-01-10',
  endDate: null,
  ...over,
});

const linesFor = (out) => [...out.values()].flatMap(v => v.lines);

describe('transport billing uses the fare the family agreed to', () => {
  test('the assignment snapshot wins over a route that has since been repriced', () => {
    const out = buildTermLines({
      term,
      assignments: [assignment({ fareAmount: 10000 })],
      routes: [route],                      // route now says 12,000
    });
    const lines = linesFor(out);
    expect(lines).toHaveLength(1);
    expect(lines[0].unitPrice).toBe(10000);
    expect(lines[0].description).toBe('Transport — Westlands Express (two-way)');
  });

  test('an assignment written before the snapshot falls back to the route fare', () => {
    const out = buildTermLines({ term, assignments: [assignment()], routes: [route] });
    expect(linesFor(out)[0].unitPrice).toBe(12000);
  });

  test('a zero fare is a real fare, not a missing one', () => {
    const out = buildTermLines({
      term,
      assignments: [assignment({ fareAmount: 0 })],
      routes: [route],
    });
    const lines = linesFor(out);
    expect(lines).toHaveLength(1);
    expect(lines[0].unitPrice).toBe(0);
  });

  test('no fare anywhere is a warning, never a silent zero', () => {
    const out = buildTermLines({
      term,
      assignments: [assignment({ fareType: 'one_way' })],
      routes: [route],                      // route only has a two-way fare
    });
    const plan = [...out.values()];
    expect(plan.flatMap(v => v.lines)).toHaveLength(0);
    expect(plan[0].warnings[0]).toContain('no one-way fare');
  });

  test('an assignment that starts after the term is not billed', () => {
    const out = buildTermLines({
      term,
      assignments: [assignment({ startDate: '2026-05-01' })],
      routes: [route],
    });
    expect(linesFor(out)).toHaveLength(0);
  });
});
