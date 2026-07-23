/* ============================================================
   Msingi — Kenyan Statutory Payroll Deductions

   ⚠ VERIFY BEFORE PRODUCTION USE ⚠
   The rates below were populated from the model's training-data
   knowledge of Kenyan payroll law, NOT independently verified against
   a live KRA/NSSF/SHIF/Housing-Levy publication. PAYE bands, NSSF
   tiers, SHIF rates, and the Housing Levy rate are all set by
   government and change on their own schedule (PAYE bands were last
   revised by the Finance Act 2023; SHIF replaced NHIF in Oct 2024;
   NSSF's tiered contributions finished phasing in Feb 2025). Confirm
   every figure below against the current official source before this
   is used for a real payroll run. This file exists specifically so
   that verification/correction touches ONE place, not several.

   All Kenya-specific calculation logic lives in this single file —
   deliberately, so the country-agnostic engine (payroll-engine.js)
   never embeds Kenya-specific numbers or branching. See
   docs/audits/HR_PAYROLL_ARCHITECTURAL_REVIEW.md §3/§9 for why this
   is platform/country-level configuration, not a per-school setting.
   ============================================================ */
'use strict';

const COUNTRY = 'KE';

/* ── Rate configuration — the part that needs periodic verification ── */
const RATES = {
  country:       COUNTRY,
  effectiveFrom: '2025-02-01', // NSSF's final tier phase-in date, the most recent of the changes below
  source:        'Populated from model training-data knowledge — NOT independently verified. Confirm against KRA/NSSF/SHIF/Housing-Levy official publications before production use.',

  /* PAYE — monthly bands, per the Finance Act 2023 structure.
     Bands are cumulative thresholds on TAXABLE income (gross pay less
     NSSF/SHIF/Housing-Levy employee contributions — see
     computeTaxableIncome below), not on gross pay directly. */
  paye: {
    bands: [
      { upTo: 24_000,       rate: 0.10  },
      { upTo: 32_333,       rate: 0.25  },
      { upTo: 500_000,      rate: 0.30  },
      { upTo: 800_000,      rate: 0.325 },
      { upTo: Infinity,     rate: 0.35  },
    ],
    personalReliefMonthly: 2_400, // flat KES/month, subtracted from computed tax, never below 0
  },

  /* NSSF — Tier I (up to the Lower Earnings Limit) + Tier II (between
     the LEL and the Upper Earnings Limit), both at 6% employee-side.
     Earnings above the UEL are not subject to further NSSF deduction. */
  nssf: {
    lowerEarningsLimit: 8_000,
    upperEarningsLimit: 72_000,
    employeeRate:       0.06,
  },

  /* SHIF (Social Health Insurance Fund) — replaced NHIF's fixed bands
     with a flat percentage of gross pay, subject to a minimum. */
  shif: {
    rate:              0.0275,
    minimumMonthly:    300,
  },

  /* Affordable Housing Levy — employee-side only; the matching
     employer 1.5% is a cost to the school, not a payroll deduction,
     so it's out of scope for this calculator (which computes what
     comes OFF an employee's pay). */
  housingLevy: {
    employeeRate: 0.015,
  },
};

/* ── Pure calculation functions ──────────────────────────────────── */

/** NSSF employee contribution for one month's pensionable pay. */
function calculateNSSF(grossPay, rates = RATES) {
  const { lowerEarningsLimit, upperEarningsLimit, employeeRate } = rates.nssf;
  const tier1Base = Math.min(grossPay, lowerEarningsLimit);
  const tier2Base = Math.max(0, Math.min(grossPay, upperEarningsLimit) - lowerEarningsLimit);
  const tier1 = tier1Base * employeeRate;
  const tier2 = tier2Base * employeeRate;
  return _round2(tier1 + tier2);
}

/** SHIF contribution — percentage of gross, floored at the statutory
    minimum. The floor only applies to an actual (nonzero) salary — a
    zero-or-negative gross pay period (e.g. unpaid leave with no other
    earnings) owes nothing, not the minimum contribution. */
function calculateSHIF(grossPay, rates = RATES) {
  if (grossPay <= 0) return 0;
  const computed = grossPay * rates.shif.rate;
  return _round2(Math.max(computed, rates.shif.minimumMonthly));
}

/** Affordable Housing Levy — employee side only. */
function calculateHousingLevy(grossPay, rates = RATES) {
  return _round2(grossPay * rates.housingLevy.employeeRate);
}

/** Taxable income for PAYE purposes: gross less the other statutory
    employee contributions, which are deductible before PAYE applies. */
function computeTaxableIncome(grossPay, { nssf, shif, housingLevy }) {
  return Math.max(0, _round2(grossPay - nssf - shif - housingLevy));
}

/** PAYE before relief — walks the band table on taxable income. */
function calculatePAYEGross(taxableIncome, rates = RATES) {
  let tax = 0;
  let lowerBound = 0;
  for (const band of rates.paye.bands) {
    if (taxableIncome <= lowerBound) break;
    const bandCeiling = Math.min(taxableIncome, band.upTo);
    const bandAmount  = Math.max(0, bandCeiling - lowerBound);
    tax += bandAmount * band.rate;
    lowerBound = band.upTo;
  }
  return _round2(tax);
}

/** PAYE after the flat personal relief, floored at 0. */
function calculatePAYE(taxableIncome, rates = RATES) {
  const gross = calculatePAYEGross(taxableIncome, rates);
  return _round2(Math.max(0, gross - rates.paye.personalReliefMonthly));
}

/**
 * Full Kenyan statutory breakdown for one month's gross pay.
 * Returns each contribution plus the combined total — the single
 * entry point the country-agnostic payroll engine calls.
 */
function computeStatutoryDeductions(grossPay, rates = RATES) {
  const nssf        = calculateNSSF(grossPay, rates);
  const shif        = calculateSHIF(grossPay, rates);
  const housingLevy = calculateHousingLevy(grossPay, rates);
  const taxableIncome = computeTaxableIncome(grossPay, { nssf, shif, housingLevy });
  const paye         = calculatePAYE(taxableIncome, rates);
  const total        = _round2(nssf + shif + housingLevy + paye);

  return {
    country: COUNTRY,
    nssf, shif, housingLevy, paye, taxableIncome, total,
    ratesEffectiveFrom: rates.effectiveFrom,
  };
}

function _round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

module.exports = {
  COUNTRY,
  RATES,
  calculateNSSF,
  calculateSHIF,
  calculateHousingLevy,
  calculatePAYEGross,
  calculatePAYE,
  computeTaxableIncome,
  computeStatutoryDeductions,
};
