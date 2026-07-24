/* ============================================================
   server/utils/payslip-engine.js (Payroll Phase 1, Step 7)

   _computePayslipSections is a pure function (payroll doc -> IR) —
   tested directly, no pdfkit involved. _drawPayslipPage/_buildPayslipPDF
   are smoke-tested against a spy PDFDocument (same technique
   report-cards-ir.test.js uses for _buildPDFPage), confirming the
   adapter walks the IR without throwing and draws the watermark only
   when the IR says to — not a golden-fixture byte-for-byte test, since
   this is new code, not a behavior-preserving refactor of prior code.
   ============================================================ */
'use strict';

const {
  _computePayslipSections, _drawPayslipPage, _buildPayslipPDF,
} = require('../utils/payslip-engine');

function baseline(overrides = {}) {
  return {
    id: 'pay_abc123',
    status: 'confirmed',
    schoolName: 'Test School',
    payPeriod: '2026-07',
    staffId: 'u_staff_1',
    staffName: 'Staff One',
    basicSalary: 50000,
    allowances: 5000,
    deductions: 2000,
    grossSalary: 55000,
    netSalary: 48000,
    currency: 'KES',
    ...overrides,
  };
}

describe('_computePayslipSections — pure IR', () => {
  test('an official (confirmed/paid) record has no watermark', () => {
    const s = _computePayslipSections(baseline({ status: 'confirmed' }));
    expect(s.watermarkText).toBeNull();
    expect(s.header.subtitle).toBe('PAYSLIP');
  });

  test('a draft record gets a DRAFT watermark and subtitle note', () => {
    const s = _computePayslipSections(baseline({ status: 'draft' }));
    expect(s.watermarkText).toBe('DRAFT');
    expect(s.header.subtitle).toContain('DRAFT — NOT OFFICIAL');
  });

  test('a historical snapshot gets a HISTORICAL watermark, not DRAFT, even for a confirmed/paid status', () => {
    const s = _computePayslipSections(baseline({ status: 'paid', historical: true }));
    expect(s.watermarkText).toBe('HISTORICAL');
    expect(s.header.subtitle).toContain('HISTORICAL RECORD — SUPERSEDED');
  });

  test('falls back to a live-lookup-free "School" label when schoolName is unset', () => {
    const s = _computePayslipSections(baseline({ schoolName: undefined }));
    expect(s.header.schoolName).toBe('School');
  });

  test('itemized allowanceItems are used verbatim instead of the flat "Allowances" row', () => {
    const s = _computePayslipSections(baseline({
      allowanceItems: [{ type: 'housing', amount: 10000 }, { type: 'transport', amount: 3000 }],
    }));
    expect(s.earnings).toEqual([
      { label: 'Basic Salary', amount: 50000 },
      { label: 'Housing', amount: 10000 },
      { label: 'Transport', amount: 3000 },
    ]);
  });

  test('falls back to a flat "Allowances" row when no allowanceItems are present', () => {
    const s = _computePayslipSections(baseline({ allowances: 5000, allowanceItems: undefined }));
    expect(s.earnings).toEqual([
      { label: 'Basic Salary', amount: 50000 },
      { label: 'Allowances', amount: 5000 },
    ]);
  });

  test('zero allowances produce no allowances row at all', () => {
    const s = _computePayslipSections(baseline({ allowances: 0, allowanceItems: undefined }));
    expect(s.earnings).toEqual([{ label: 'Basic Salary', amount: 50000 }]);
  });

  test('statutory deduction rows are included only when > 0, zero-value rows filtered out', () => {
    const s = _computePayslipSections(baseline({
      statutoryDeductions: { paye: 4000, nssf: 1200, shif: 0, housingLevy: 750, total: 5950 },
    }));
    expect(s.statutoryDeductions).toEqual([
      { label: 'PAYE', amount: 4000 },
      { label: 'NSSF', amount: 1200 },
      { label: 'Housing Levy', amount: 750 },
    ]);
  });

  test('no statutoryDeductions on the record produces an empty statutory rows array', () => {
    const s = _computePayslipSections(baseline({ statutoryDeductions: null }));
    expect(s.statutoryDeductions).toEqual([]);
  });

  test('itemized deductionItems are used verbatim instead of the flat "Other Deductions" row', () => {
    const s = _computePayslipSections(baseline({
      deductionItems: [{ type: 'loan', amount: 2000 }],
    }));
    expect(s.manualDeductions).toEqual([{ label: 'Loan', amount: 2000 }]);
  });

  test('totalDeductions on the record wins over the derived fallback', () => {
    const s = _computePayslipSections(baseline({ totalDeductions: 9999, deductions: 2000, statutoryDeductions: null }));
    expect(s.totalDeductions).toBe(9999);
  });

  test('totalDeductions falls back to deductions + statutory.total when absent from the record', () => {
    const s = _computePayslipSections(baseline({
      totalDeductions: undefined, deductions: 2000,
      statutoryDeductions: { paye: 3000, nssf: 0, shif: 0, housingLevy: 0, total: 3000 },
    }));
    expect(s.totalDeductions).toBe(5000);
  });

  test('employee/footer/currency fields pass through from the payroll doc', () => {
    const s = _computePayslipSections(baseline());
    expect(s.employee).toEqual({ name: 'Staff One', staffId: 'u_staff_1' });
    expect(s.currency).toBe('KES');
    expect(s.footer.status).toBe('confirmed');
    expect(s.footer.recordId).toBe('pay_abc123');
    expect(s.grossPay).toBe(55000);
    expect(s.netPay).toBe(48000);
  });
});

function makeSpyDoc() {
  const calls = [];
  const spy = { page: { width: 595.28, height: 841.89 } };
  const methods = ['rect', 'fill', 'stroke', 'fillColor', 'fillOpacity', 'fontSize', 'font', 'text', 'save', 'translate', 'rotate', 'restore'];
  for (const m of methods) {
    spy[m] = (...args) => { calls.push({ method: m, args }); return spy; };
  }
  return { spy, calls };
}

describe('_drawPayslipPage / _buildPayslipPDF — adapter smoke tests', () => {
  test('draws a rotate+restore watermark sequence when the IR has a watermarkText', () => {
    const { spy, calls } = makeSpyDoc();
    _buildPayslipPDF(spy, baseline({ status: 'draft' }));
    expect(calls.some(c => c.method === 'rotate' && c.args[0] === -45)).toBe(true);
    expect(calls.some(c => c.method === 'text' && c.args[0] === 'DRAFT')).toBe(true);
    expect(calls.some(c => c.method === 'restore')).toBe(true);
  });

  test('draws no watermark sequence for an official record', () => {
    const { spy, calls } = makeSpyDoc();
    _buildPayslipPDF(spy, baseline({ status: 'confirmed' }));
    expect(calls.some(c => c.method === 'rotate')).toBe(false);
  });

  test('renders the net pay figure and school name onto the page', () => {
    const { spy, calls } = makeSpyDoc();
    _drawPayslipPage(spy, _computePayslipSections(baseline({ netSalary: 48000, schoolName: 'Green Valley' })));
    const texts = calls.filter(c => c.method === 'text').map(c => c.args[0]);
    expect(texts).toContain('Green Valley');
    expect(texts.some(t => String(t).includes('48,000.00'))).toBe(true);
  });
});
