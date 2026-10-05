'use strict';

const { buildTermLines } = require('../../utils/term-billing');

const TERM = { startDate: '2026-09-01', endDate: '2026-12-15' };
const ROUTE_A = { id: 'r_a', name: 'Zone A', fares: [{ fareType: 'one_way', amount: 29000 }, { fareType: 'two_way', amount: 35600 }] };
const ROUTE_NO_TWO_WAY = { id: 'r_b', name: 'Zone B', fares: [{ fareType: 'one_way', amount: 32000 }] };
const ACT_GUITAR = { id: 'a_guitar', name: 'Guitar', amount: 6000, status: 'active' };
const ACT_OLD = { id: 'a_old', name: 'Chess', amount: 5000, status: 'inactive' };

function run(overrides = {}) {
  return buildTermLines({
    term: TERM,
    routes: [ROUTE_A, ROUTE_NO_TWO_WAY],
    activities: [ACT_GUITAR, ACT_OLD],
    assignments: [],
    enrolments: [],
    ...overrides,
  });
}

describe('transport lines', () => {
  test('a one-way assignment is charged the route\'s one-way fare, and only that', () => {
    const out = run({ assignments: [{ id: 'as1', studentId: 'stu1', routeId: 'r_a', fareType: 'one_way', status: 'active', startDate: '2026-08-01' }] });
    expect(out.get('stu1').lines).toEqual([
      { description: 'Transport — Zone A (one-way)', quantity: 1, unitPrice: 29000, feeType: 'transport' },
    ]);
    expect(out.get('stu1').warnings).toEqual([]);
  });

  test('a two-way assignment is charged the two-way fare', () => {
    const out = run({ assignments: [{ id: 'as1', studentId: 'stu1', routeId: 'r_a', fareType: 'two_way', status: 'active', startDate: '2026-08-01' }] });
    expect(out.get('stu1').lines[0].unitPrice).toBe(35600);
  });

  test('no fare type chosen is never billed silently: it is a warning', () => {
    const out = run({ assignments: [{ id: 'as1', studentId: 'stu1', routeId: 'r_a', fareType: null, status: 'active', startDate: '2026-08-01' }] });
    expect(out.get('stu1').lines).toEqual([]);
    expect(out.get('stu1').warnings[0]).toMatch(/no one-way or two-way fare/);
  });

  test('a route with no fare for that type is a warning, not a zero charge', () => {
    const out = run({ assignments: [{ id: 'as1', studentId: 'stu2', routeId: 'r_b', fareType: 'two_way', status: 'active', startDate: '2026-08-01' }] });
    expect(out.get('stu2').lines).toEqual([]);
    expect(out.get('stu2').warnings[0]).toMatch(/no two-way fare is set on this route/);
  });

  test('an ended or not-yet-started assignment is not billed for this term', () => {
    const out = run({ assignments: [
      { id: 'old', studentId: 'stu1', routeId: 'r_a', fareType: 'one_way', status: 'active', startDate: '2025-01-01', endDate: '2025-06-30' },
      { id: 'future', studentId: 'stu1', routeId: 'r_a', fareType: 'one_way', status: 'active', startDate: '2027-01-01' },
      { id: 'cancelled', studentId: 'stu1', routeId: 'r_a', fareType: 'one_way', status: 'ended', startDate: '2026-08-01' },
    ] });
    expect(out.has('stu1')).toBe(false);
  });

  test('an assignment that ends partway through the term is still billed for it', () => {
    const out = run({ assignments: [{ id: 'as1', studentId: 'stu1', routeId: 'r_a', fareType: 'one_way', status: 'active', startDate: '2026-08-01', endDate: '2026-10-01' }] });
    expect(out.get('stu1').lines).toHaveLength(1);
  });

  test('an assignment whose route was deleted is a warning', () => {
    const out = run({ assignments: [{ id: 'as1', studentId: 'stu1', routeId: 'gone', fareType: 'one_way', status: 'active', startDate: '2026-08-01' }] });
    expect(out.get('stu1').warnings[0]).toMatch(/no longer exists/);
  });
});

describe('extra-curricular lines', () => {
  test('an enrolment in an active activity is billed at the activity amount', () => {
    const out = run({ enrolments: [{ id: 'e1', studentId: 'stu1', activityId: 'a_guitar', activityName: 'Guitar', status: 'active', startDate: '2026-09-01' }] });
    expect(out.get('stu1').lines).toEqual([
      { description: 'Extra-Curricular — Guitar', quantity: 1, unitPrice: 6000, feeType: 'extracurricular' },
    ]);
  });

  test('an enrolment in an inactive activity is a warning, not a charge', () => {
    const out = run({ enrolments: [{ id: 'e1', studentId: 'stu1', activityId: 'a_old', activityName: 'Chess', status: 'active', startDate: '2026-09-01' }] });
    expect(out.get('stu1').lines).toEqual([]);
    expect(out.get('stu1').warnings[0]).toMatch(/not active/);
  });

  test('a student with transport and two activities gets three lines', () => {
    const out = run({
      assignments: [{ id: 'as1', studentId: 'stu1', routeId: 'r_a', fareType: 'one_way', status: 'active', startDate: '2026-08-01' }],
      enrolments: [
        { id: 'e1', studentId: 'stu1', activityId: 'a_guitar', status: 'active', startDate: '2026-09-01' },
        { id: 'e2', studentId: 'stu1', activityId: 'a_guitar', status: 'active', startDate: '2026-09-01' },
      ],
    });
    expect(out.get('stu1').lines.map(l => l.feeType)).toEqual(['transport', 'extracurricular', 'extracurricular']);
  });
});
