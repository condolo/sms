/* ============================================================
   Unit tests — server/scripts/migrate-staff-responsibility-rename.js's
   pure decision logic (planTeacherMigration, planSchoolMigration).

   No MongoDB required — these are pure functions, exported specifically
   so this logic is testable independent of the script's DB-connecting
   shell (which only runs when the file is executed directly, guarded
   by require.main === module).
   ============================================================ */
'use strict';

const { planTeacherMigration, planSchoolMigration, RENAME } = require('../scripts/migrate-staff-responsibility-rename');

test('RENAME maps exactly the two collision values, nothing else', () => {
  expect(RENAME).toEqual({ deputy: 'acting_deputy', principal: 'head_of_school' });
});

describe('planTeacherMigration', () => {
  test('a teacher with extraRoles containing "deputy" is renamed to "acting_deputy"', () => {
    const plan = planTeacherMigration({ id: 't_1', extraRoles: ['deputy'] });
    expect(plan.action).toBe('rename');
    expect(plan.to).toEqual(['acting_deputy']);
  });

  test('a teacher with extraRoles containing "principal" is renamed to "head_of_school"', () => {
    const plan = planTeacherMigration({ id: 't_2', extraRoles: ['principal'] });
    expect(plan.to).toEqual(['head_of_school']);
  });

  test('other extraRoles entries (e.g. "hod") are preserved untouched, only the colliding ones change', () => {
    const plan = planTeacherMigration({ id: 't_3', extraRoles: ['hod', 'deputy', 'timetabler'] });
    expect(plan.action).toBe('rename');
    expect(plan.to).toEqual(['hod', 'acting_deputy', 'timetabler']);
  });

  test('order is preserved exactly', () => {
    const plan = planTeacherMigration({ id: 't_4', extraRoles: ['principal', 'deputy'] });
    expect(plan.to).toEqual(['head_of_school', 'acting_deputy']);
  });

  test('a teacher with no colliding extraRoles is left alone', () => {
    const plan = planTeacherMigration({ id: 't_5', extraRoles: ['hod', 'timetabler'] });
    expect(plan.action).toBe('none');
  });

  test('a teacher with no extraRoles at all is left alone, not thrown on', () => {
    const plan = planTeacherMigration({ id: 't_6' });
    expect(plan.action).toBe('none');
  });

  test('the already-renamed values are left alone (idempotent — safe to re-run)', () => {
    const plan = planTeacherMigration({ id: 't_7', extraRoles: ['acting_deputy', 'head_of_school'] });
    expect(plan.action).toBe('none');
  });
});

describe('planSchoolMigration', () => {
  test('a school with a persisted staffResponsibilities entry valued "deputy" is renamed, label preserved exactly', () => {
    const plan = planSchoolMigration({
      id: 'sch_1',
      staffResponsibilities: [{ value: 'deputy', label: 'Deputy Principal' }],
    });
    expect(plan.action).toBe('rename');
    expect(plan.to).toEqual([{ value: 'acting_deputy', label: 'Deputy Principal' }]);
  });

  test('a custom label a school already typed themselves is kept as-is — only the value changes', () => {
    const plan = planSchoolMigration({
      id: 'sch_2',
      staffResponsibilities: [{ value: 'principal', label: "Head Teacher (our school's own term)" }],
    });
    expect(plan.to).toEqual([{ value: 'head_of_school', label: "Head Teacher (our school's own term)" }]);
  });

  test('non-colliding custom entries (e.g. a school-added "KS3 Academic Coordinator") are preserved untouched', () => {
    const plan = planSchoolMigration({
      id: 'sch_3',
      staffResponsibilities: [
        { value: 'hod', label: 'Head of Department' },
        { value: 'deputy', label: 'Deputy Principal' },
        { value: 'ks3_academic_coordinator', label: 'KS3 Academic Coordinator' },
      ],
    });
    expect(plan.action).toBe('rename');
    expect(plan.to).toEqual([
      { value: 'hod', label: 'Head of Department' },
      { value: 'acting_deputy', label: 'Deputy Principal' },
      { value: 'ks3_academic_coordinator', label: 'KS3 Academic Coordinator' },
    ]);
  });

  test('a school with no persisted list at all is left alone, not thrown on', () => {
    const plan = planSchoolMigration({ id: 'sch_4' });
    expect(plan.action).toBe('none');
  });

  test('a school whose list has neither colliding value is left alone', () => {
    const plan = planSchoolMigration({
      id: 'sch_5',
      staffResponsibilities: [{ value: 'hod', label: 'Head of Department' }],
    });
    expect(plan.action).toBe('none');
  });
});
