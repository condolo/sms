/* ============================================================
   Msingi — Statutory Payroll Calculator Registry

   Country-keyed lookup. Phase 1 registers Kenya only — this file is
   the ONE place a future country's calculator gets registered; the
   engine (payroll-engine.js) and every route stay country-agnostic
   and never branch on a country code directly. See
   docs/audits/HR_PAYROLL_ARCHITECTURAL_REVIEW.md §9 — mirrors
   onboard.js's existing country-branching discipline (one resolution
   point, not conditionals scattered through calculation code).
   ============================================================ */
'use strict';

const kenya = require('./kenya');

const CALCULATORS = {
  KE: kenya,
};

/** Returns the statutory calculator module for a country code, or null
    if none is registered yet (Phase 1: only 'KE'). Callers must treat
    null as "no statutory deductions apply" rather than throwing —
    a school in an unregistered country should degrade to the plain
    gross-minus-manual-deductions calculation, not fail payroll entirely. */
function getStatutoryCalculator(country) {
  return CALCULATORS[country] || null;
}

function supportedCountries() {
  return Object.keys(CALCULATORS);
}

module.exports = { getStatutoryCalculator, supportedCountries };
