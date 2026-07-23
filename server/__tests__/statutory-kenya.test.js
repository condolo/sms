/* ============================================================
   server/utils/statutory/kenya.js — pure function tests.

   Pins the exact math against hand-calculated expectations so any
   future rate change (a real, periodic event — see the file's own
   verification disclaimer) is a deliberate, visible diff here, not a
   silent behavior change.
   ============================================================ */
const {
  calculateNSSF, calculateSHIF, calculateHousingLevy,
  calculatePAYEGross, calculatePAYE, computeTaxableIncome,
  computeStatutoryDeductions, RATES,
} = require('../utils/statutory/kenya');

describe('calculateNSSF', () => {
  test('gross below the Lower Earnings Limit — Tier I only', () => {
    expect(calculateNSSF(5000)).toBe(300); // 5000 * 6%
  });
  test('gross at exactly the LEL', () => {
    expect(calculateNSSF(8000)).toBe(480); // 8000 * 6%
  });
  test('gross between LEL and UEL — Tier I + Tier II', () => {
    expect(calculateNSSF(50000)).toBe(3000); // tier1: 8000*6%=480, tier2: (50000-8000)*6%=2520, total 3000
  });
  test('gross at or above the UEL — capped', () => {
    expect(calculateNSSF(72000)).toBe(4320); // 8000*6% + 64000*6% = 480+3840
    expect(calculateNSSF(200000)).toBe(4320); // same cap, earnings above UEL untouched
  });
});

describe('calculateSHIF', () => {
  test('percentage of gross when above the minimum', () => {
    expect(calculateSHIF(100000)).toBe(2750); // 2.75%
  });
  test('floored at the statutory minimum for low gross', () => {
    expect(calculateSHIF(5000)).toBe(300); // 2.75% of 5000 = 137.50, minimum is 300
  });
});

describe('calculateHousingLevy', () => {
  test('1.5% of gross', () => {
    expect(calculateHousingLevy(100000)).toBe(1500);
  });
});

describe('computeTaxableIncome', () => {
  test('gross less NSSF/SHIF/Housing Levy', () => {
    const result = computeTaxableIncome(100000, { nssf: 4320, shif: 2750, housingLevy: 1500 });
    expect(result).toBe(91430);
  });
  test('never negative', () => {
    const result = computeTaxableIncome(100, { nssf: 4320, shif: 2750, housingLevy: 1500 });
    expect(result).toBe(0);
  });
});

describe('calculatePAYEGross — band walking', () => {
  test('income entirely within the first band', () => {
    expect(calculatePAYEGross(10000)).toBe(1000); // 10000 * 10%
  });
  test('income spanning multiple bands (100,000 taxable)', () => {
    // band1: 24000*10%=2400, band2: 8333*25%=2083.25, band3: 67667*30%=20300.10
    expect(calculatePAYEGross(100000)).toBeCloseTo(24783.35, 2);
  });
  test('income in the top band', () => {
    const result = calculatePAYEGross(1_000_000);
    // 24000*.10 + 8333*.25 + 467667*.30 + 300000*.325 + 200000*.35
    // = 2400 + 2083.25 + 140300.10 + 97500 + 70000 = 312283.35
    expect(result).toBeCloseTo(312283.35, 2);
  });
  test('zero taxable income produces zero tax', () => {
    expect(calculatePAYEGross(0)).toBe(0);
  });
});

describe('calculatePAYE — after personal relief', () => {
  test('relief reduces the computed tax', () => {
    expect(calculatePAYE(10000)).toBe(0); // 1000 gross tax - 2400 relief, floored at 0
  });
  test('never goes negative even for very low income', () => {
    expect(calculatePAYE(100)).toBe(0);
  });
  test('relief applied on a larger taxable income', () => {
    expect(calculatePAYE(100000)).toBeCloseTo(22383.35, 2); // 24783.35 - 2400
  });
});

describe('computeStatutoryDeductions — full breakdown, internally consistent', () => {
  test('gross of 100,000: matches the hand-calculated full chain', () => {
    const result = computeStatutoryDeductions(100000);
    expect(result.nssf).toBe(4320);
    expect(result.shif).toBe(2750);
    expect(result.housingLevy).toBe(1500);
    expect(result.taxableIncome).toBe(91430);
    expect(result.paye).toBeCloseTo(19812.35, 2);
    expect(result.total).toBeCloseTo(4320 + 2750 + 1500 + 19812.35, 2);
    expect(result.country).toBe('KE');
    expect(result.ratesEffectiveFrom).toBe(RATES.effectiveFrom);
  });

  test('zero gross produces zero everywhere, no throw', () => {
    const result = computeStatutoryDeductions(0);
    expect(result.total).toBe(0);
    expect(result.paye).toBe(0);
  });

  test('total deductions never exceed gross pay for realistic salaries', () => {
    for (const gross of [15000, 30000, 50000, 100000, 250000, 500000]) {
      const result = computeStatutoryDeductions(gross);
      expect(result.total).toBeLessThan(gross);
    }
  });
});
