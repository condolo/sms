/* ============================================================
   Integrity Rules — collection-name regression pin.

   server/services/ops/integrity/rules.js had 3 rules checking
   collections that don't exist in this app at all: 'attendance_records'
   (real: 'attendance'), 'behaviour_records' (real: 'behaviour_incidents'),
   and 'grade_entries' (real, for this check's purpose: 'assessment_marks').
   A query against a nonexistent collection returns an empty result set
   forever, not an error — so these 3 checks silently reported "0 orphans"
   regardless of actual data health. The file's own header comment
   documents this exact bug class already happened once before with
   'finance_invoices'/'finance_payments' vs the real 'invoices'/'payments'.

   This test pins the collection name each rule actually queries, so a
   future edit can't reintroduce a plausible-but-wrong name silently —
   the query itself would still "succeed" with an empty array either way,
   which is exactly why this needs a pinned assertion, not just a smoke test.
   ============================================================ */

const calls = [];

jest.mock('../utils/model', () => ({
  _model: jest.fn((col) => {
    calls.push(col);
    const chain = {
      find:       () => chain,
      select:     () => chain,
      limit:      () => chain,
      lean:       () => Promise.resolve([]),
      distinct:   () => Promise.resolve([]),
      aggregate:  () => Promise.resolve([]),
      catch:      () => chain,
    };
    return chain;
  }),
}));

const RULES = require('../services/ops/integrity/rules');

function ruleFor(id) {
  const rule = RULES.find(r => r.id === id);
  if (!rule) throw new Error(`No rule with id ${id}`);
  return rule;
}

describe('Integrity rules — correct (existing) collection names', () => {
  beforeEach(() => { calls.length = 0; });

  test('attendance.orphaned_records queries "attendance", never "attendance_records"', async () => {
    await ruleFor('attendance.orphaned_records').run();
    expect(calls).toContain('attendance');
    expect(calls).not.toContain('attendance_records');
  });

  test('behaviour.records_missing_student queries "behaviour_incidents", never "behaviour_records"', async () => {
    await ruleFor('behaviour.records_missing_student').run();
    expect(calls).toContain('behaviour_incidents');
    expect(calls).not.toContain('behaviour_records');
  });

  test('grades.entries_missing_class queries "assessment_marks", never "grade_entries"', async () => {
    await ruleFor('grades.entries_missing_class').run();
    expect(calls).toContain('assessment_marks');
    expect(calls).not.toContain('grade_entries');
  });

  test('every rule id is unique (engine dedupes/looks up by id)', () => {
    const ids = RULES.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
