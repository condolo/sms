/* ============================================================
   server/utils/admission-requirements.js (2026-09)

   Per-school admission field requirements — dateOfBirth, gender, and
   the guardian rules become Settings toggles instead of a fixed rule,
   defaulting to the previous hardcoded behaviour (all required) so no
   existing school's admissions process changes unless they explicitly
   open Settings and relax something.

   Pure unit tests — no Express app, no DB mocks needed.
   ============================================================ */
'use strict';

const {
  DEFAULT_REQUIRED_FIELDS,
  resolveRequiredFields,
  validateRequiredAdmissionFields,
} = require('../utils/admission-requirements');

describe('resolveRequiredFields', () => {
  test('undefined admissionConfig resolves to all-required (unchanged behaviour)', () => {
    expect(resolveRequiredFields(undefined)).toEqual(DEFAULT_REQUIRED_FIELDS);
  });

  test('admissionConfig with no requiredFields key resolves to all-required', () => {
    expect(resolveRequiredFields({ prefix: 'ADM-' })).toEqual(DEFAULT_REQUIRED_FIELDS);
  });

  test('an explicit false relaxes just that one field, others stay required', () => {
    const resolved = resolveRequiredFields({ requiredFields: { dateOfBirth: false } });
    expect(resolved).toEqual({
      dateOfBirth: false,
      gender: true,
      guardianRequired: true,
      guardianEmailRequired: true,
    });
  });

  test('all four can be turned off independently', () => {
    const resolved = resolveRequiredFields({
      requiredFields: { dateOfBirth: false, gender: false, guardianRequired: false, guardianEmailRequired: false },
    });
    expect(resolved).toEqual({
      dateOfBirth: false, gender: false, guardianRequired: false, guardianEmailRequired: false,
    });
  });

  test('an explicit true is indistinguishable from absent (still required)', () => {
    expect(resolveRequiredFields({ requiredFields: { dateOfBirth: true } }).dateOfBirth).toBe(true);
  });
});

describe('validateRequiredAdmissionFields', () => {
  test('missing dateOfBirth and gender both rejected when required (default)', () => {
    const errors = validateRequiredAdmissionFields({}, DEFAULT_REQUIRED_FIELDS);
    expect(errors.map(e => e.field).sort()).toEqual(['dateOfBirth', 'gender']);
  });

  test('missing dateOfBirth is accepted when the school has turned it off', () => {
    const requiredFields = resolveRequiredFields({ requiredFields: { dateOfBirth: false } });
    const errors = validateRequiredAdmissionFields({ gender: 'male' }, requiredFields);
    expect(errors).toBeNull();
  });

  test('missing gender is accepted when the school has turned it off', () => {
    const requiredFields = resolveRequiredFields({ requiredFields: { gender: false } });
    const errors = validateRequiredAdmissionFields({ dateOfBirth: '2015-01-01' }, requiredFields);
    expect(errors).toBeNull();
  });

  test('both present passes regardless of configuration', () => {
    expect(validateRequiredAdmissionFields({ dateOfBirth: '2015-01-01', gender: 'male' }, DEFAULT_REQUIRED_FIELDS)).toBeNull();
  });

  test('both turned off — an empty row passes', () => {
    const requiredFields = resolveRequiredFields({ requiredFields: { dateOfBirth: false, gender: false } });
    expect(validateRequiredAdmissionFields({}, requiredFields)).toBeNull();
  });
});
