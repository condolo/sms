/* ============================================================
   Msingi — Payroll Computation Engine (Payroll Phase 1, Step 2/3)

   Single source of truth for "given these inputs, what does this
   person get paid." Every payroll calculation in the platform must
   go through computePayrollForPeriod — no route or UI component
   re-derives gross/net pay independently (see
   docs/audits/HR_PAYROLL_ARCHITECTURAL_REVIEW.md §2, which found the
   pre-existing implementation computed grossSalary/netSalary inline,
   in two separate route handlers, with no shared, testable function).

   Deliberately NOT a rules engine / DSL / plugin system — the review
   was explicit that nothing else config-driven in this codebase
   (academic-config's grade bands, workflow-config's approval steps)
   needed that much generality, and this doesn't either. It's one pure
   function plus a country-keyed calculator lookup (statutory/index.js).

   Country-agnostic by construction: this file has zero Kenya-specific
   numbers or branching. Statutory calculation is entirely delegated to
   whatever calculator statutory/index.js resolves for the given
   country; if none is registered, statutory deductions are simply
   skipped (not an error) — see statutory/index.js's own comment.
   ============================================================ */
'use strict';

const { getStatutoryCalculator } = require('./statutory');

function _round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

/**
 * @param {object} input
 * @param {number} input.basicSalary
 * @param {number} [input.allowances=0]      — flat total for Phase 1 (itemized allowance types are Step 4)
 * @param {number} [input.manualDeductions=0] — non-statutory deductions (e.g. loan repayments), flat total for Phase 1
 * @param {boolean} [input.applyStatutory=true] — whether to compute statutory deductions at all
 * @param {string} [input.country]           — ISO-ish country code (e.g. 'KE'); no statutory calc applied if omitted
 *                                              or unregistered in statutory/index.js
 * @returns {{
 *   grossPay: number,
 *   manualDeductions: number,
 *   statutory: null | { country, nssf, shif, housingLevy, paye, taxableIncome, total, ratesEffectiveFrom },
 *   totalDeductions: number,
 *   netPay: number,
 * }}
 */
function computePayrollForPeriod({
  basicSalary = 0, allowances = 0, manualDeductions = 0,
  applyStatutory = true, country = null,
}) {
  const grossPay = _round2(basicSalary + allowances);

  let statutory = null;
  if (applyStatutory && country) {
    const calculator = getStatutoryCalculator(country);
    if (calculator) {
      statutory = calculator.computeStatutoryDeductions(grossPay);
    }
  }

  const statutoryTotal = statutory ? statutory.total : 0;
  const totalDeductions = _round2(manualDeductions + statutoryTotal);
  const netPay = _round2(grossPay - totalDeductions);

  return {
    grossPay,
    manualDeductions: _round2(manualDeductions),
    statutory,
    totalDeductions,
    netPay,
  };
}

module.exports = { computePayrollForPeriod };
