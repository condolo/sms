/* ============================================================
   server/utils/payroll-engine.js — the single computation layer.
   ============================================================ */
const { computePayrollForPeriod } = require('../utils/payroll-engine');
const { getStatutoryCalculator, supportedCountries } = require('../utils/statutory');

describe('computePayrollForPeriod — legacy behavior (no country / statutory disabled)', () => {
  test('matches the pre-engine flat calculation exactly when country is omitted', () => {
    const result = computePayrollForPeriod({ basicSalary: 50000, allowances: 5000, manualDeductions: 3000 });
    expect(result.grossPay).toBe(55000);
    expect(result.statutory).toBeNull();
    expect(result.totalDeductions).toBe(3000);
    expect(result.netPay).toBe(52000);
  });

  test('applyStatutory:false skips statutory even when a country IS given', () => {
    const result = computePayrollForPeriod({
      basicSalary: 100000, allowances: 0, manualDeductions: 0,
      applyStatutory: false, country: 'KE',
    });
    expect(result.statutory).toBeNull();
    expect(result.netPay).toBe(100000);
  });

  test('an unregistered country degrades to no statutory deductions, does not throw', () => {
    const result = computePayrollForPeriod({ basicSalary: 50000, country: 'ZZ' });
    expect(result.statutory).toBeNull();
    expect(result.netPay).toBe(50000);
  });

  test('defaults: basicSalary/allowances/manualDeductions default to 0', () => {
    const result = computePayrollForPeriod({});
    expect(result.grossPay).toBe(0);
    expect(result.netPay).toBe(0);
  });
});

describe('computePayrollForPeriod — Kenya statutory applied', () => {
  test('folds statutory total into net pay alongside manual deductions', () => {
    const result = computePayrollForPeriod({
      basicSalary: 100000, allowances: 0, manualDeductions: 2000, country: 'KE',
    });
    expect(result.statutory).not.toBeNull();
    expect(result.statutory.country).toBe('KE');
    expect(result.totalDeductions).toBeCloseTo(2000 + result.statutory.total, 2);
    expect(result.netPay).toBeCloseTo(result.grossPay - result.totalDeductions, 2);
  });

  test('applyStatutory defaults to true when a country is given', () => {
    const result = computePayrollForPeriod({ basicSalary: 100000, country: 'KE' });
    expect(result.statutory).not.toBeNull();
  });

  test('statutory is computed on GROSS pay (basic + allowances), not basic alone', () => {
    const withAllowance = computePayrollForPeriod({ basicSalary: 50000, allowances: 50000, country: 'KE' });
    const basicOnly     = computePayrollForPeriod({ basicSalary: 50000, allowances: 0, country: 'KE' });
    expect(withAllowance.statutory.total).toBeGreaterThan(basicOnly.statutory.total);
  });
});

describe('statutory registry', () => {
  test('KE is registered', () => {
    expect(supportedCountries()).toContain('KE');
    expect(getStatutoryCalculator('KE')).not.toBeNull();
  });
  test('an unknown country resolves to null, not a throw', () => {
    expect(getStatutoryCalculator('ZZ')).toBeNull();
  });
});
