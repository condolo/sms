/* ============================================================
   server/utils/rc-template-scale.js — band-only scoring helpers
   (2026-10-23): effectiveBandsForSubjectId, isBandOnlySubject,
   maxBandScore, snapToNearestBand. Pure functions, no DB.
   ============================================================ */
'use strict';

const {
  effectiveBandsForSubjectId, isBandOnlySubject, maxBandScore, snapToNearestBand,
} = require('../../utils/rc-template-scale');

const TEMPLATE_BANDS = [
  { id: 'b1', label: 'Emerging',   defaultScore: 3, grade: 'C' },
  { id: 'b2', label: 'Developing', defaultScore: 6, grade: 'B' },
  { id: 'b3', label: 'Secure',     defaultScore: 9, grade: 'A' },
];

function template(overrides = {}) {
  return {
    performanceBands: TEMPLATE_BANDS,
    bandOnlyScoring: false,
    subjects: [{ subjectId: 'sub_math', performanceBands: undefined, bandOnlyScoring: undefined }],
    ...overrides,
  };
}

describe('effectiveBandsForSubjectId', () => {
  test('a subject with no override uses the template\'s own bands', () => {
    expect(effectiveBandsForSubjectId(template(), 'sub_math')).toBe(TEMPLATE_BANDS);
  });

  test('a subject\'s own override entirely replaces the template\'s bands, never merged', () => {
    const ownBands = [{ id: 'x1', label: 'Beginning', defaultScore: 2, grade: 'D' }];
    const t = template({ subjects: [{ subjectId: 'sub_math', performanceBands: ownBands }] });
    expect(effectiveBandsForSubjectId(t, 'sub_math')).toBe(ownBands);
  });

  test('a subject not found in the template falls back to the template\'s bands', () => {
    expect(effectiveBandsForSubjectId(template(), 'sub_unknown')).toBe(TEMPLATE_BANDS);
  });
});

describe('isBandOnlySubject', () => {
  test('a subject with no override inherits the template\'s default (false)', () => {
    expect(isBandOnlySubject(template(), 'sub_math')).toBe(false);
  });

  test('a subject with no override inherits the template\'s default (true)', () => {
    const t = template({ bandOnlyScoring: true });
    expect(isBandOnlySubject(t, 'sub_math')).toBe(true);
  });

  test('a subject\'s own override wins over the template\'s default, either direction', () => {
    const offOverride = template({ bandOnlyScoring: true, subjects: [{ subjectId: 'sub_math', bandOnlyScoring: false }] });
    expect(isBandOnlySubject(offOverride, 'sub_math')).toBe(false);

    const onOverride = template({ bandOnlyScoring: false, subjects: [{ subjectId: 'sub_math', bandOnlyScoring: true }] });
    expect(isBandOnlySubject(onOverride, 'sub_math')).toBe(true);
  });
});

describe('maxBandScore', () => {
  test('the highest defaultScore among the bands', () => {
    expect(maxBandScore(TEMPLATE_BANDS)).toBe(9);
  });

  test('empty or missing bands -> 0', () => {
    expect(maxBandScore([])).toBe(0);
    expect(maxBandScore(null)).toBe(0);
  });
});

describe('snapToNearestBand', () => {
  test('snaps to the closest band by points', () => {
    expect(snapToNearestBand(8, TEMPLATE_BANDS).label).toBe('Secure');   // closer to 9 than to 6
    expect(snapToNearestBand(4, TEMPLATE_BANDS).label).toBe('Emerging'); // closer to 3 than to 6
    expect(snapToNearestBand(9, TEMPLATE_BANDS).label).toBe('Secure');   // exact match
  });

  test('an exact tie rounds UP to the higher band', () => {
    // 4.5 is exactly between Emerging(3) and Developing(6)
    expect(snapToNearestBand(4.5, TEMPLATE_BANDS).label).toBe('Developing');
  });

  test('no bands or no points value -> null', () => {
    expect(snapToNearestBand(5, [])).toBeNull();
    expect(snapToNearestBand(null, TEMPLATE_BANDS)).toBeNull();
  });
});
