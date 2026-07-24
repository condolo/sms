/* ============================================================
   Msingi — Payslip Rendering (Payroll Phase 1, Step 7)

   Mirrors report-cards.js's proven IR/adapter discipline exactly
   (see docs/audits/HR_PAYROLL_ARCHITECTURAL_REVIEW.md §6):
     _computePayslipSections — pure function, payroll doc → plain-data
       description of every section's content, zero pdfkit calls.
     _drawPayslipPage        — the one adapter that walks that data and
       makes the actual pdfkit drawing calls.
     _buildPayslipPDF        — thin two-line wrapper combining both,
       the only export routes call directly.

   Deliberately does NOT fetch anything live (no schools/users lookup)
   — every value it needs must already be on the payroll doc passed
   in. That's what "do not rely on current employee data when
   regenerating historical payslips" means concretely: the payroll
   doc (or a preserved payroll_history entry — see hr.js's payroll
   locking) is the sole source of truth for a payslip's content,
   snapshotted at confirm time, not re-joined against `users`/`schools`
   at render time.
   ============================================================ */
'use strict';

/**
 * Pure function: payroll record → plain-data section description.
 * No pdfkit calls, no I/O — independently testable and reusable for
 * a future non-PDF renderer (e.g. HTML), same reasoning report-cards'
 * RC2 split was built for.
 */
function _computePayslipSections(payroll) {
  const isOfficial = ['confirmed', 'paid'].includes(payroll.status);
  // A regenerated payroll_history snapshot (hr.js's locked-edit preserve)
  // WAS official at the moment it was superseded — 'DRAFT' would wrongly
  // imply it was never confirmed. Distinct watermark, same mechanism.
  const isHistorical = payroll.historical === true;
  const watermarkText = isHistorical ? 'HISTORICAL' : (!isOfficial ? 'DRAFT' : null);
  const currency = payroll.currency || 'KES';

  const earnings = [
    { label: 'Basic Salary', amount: payroll.basicSalary || 0 },
    ...(Array.isArray(payroll.allowanceItems) && payroll.allowanceItems.length
      ? payroll.allowanceItems.map(i => ({ label: _titleCase(i.type), amount: i.amount }))
      : payroll.allowances > 0 ? [{ label: 'Allowances', amount: payroll.allowances }] : []),
  ];

  const statutoryRows = payroll.statutoryDeductions
    ? [
        { label: 'PAYE',         amount: payroll.statutoryDeductions.paye },
        { label: 'NSSF',         amount: payroll.statutoryDeductions.nssf },
        { label: 'SHIF',         amount: payroll.statutoryDeductions.shif },
        { label: 'Housing Levy', amount: payroll.statutoryDeductions.housingLevy },
      ].filter(r => r.amount > 0)
    : [];

  const manualDeductionRows = Array.isArray(payroll.deductionItems) && payroll.deductionItems.length
    ? payroll.deductionItems.map(i => ({ label: _titleCase(i.type), amount: i.amount }))
    : payroll.deductions > 0 ? [{ label: 'Other Deductions', amount: payroll.deductions }] : [];

  const totalDeductions = payroll.totalDeductions ??
    ((payroll.deductions || 0) + (payroll.statutoryDeductions?.total || 0));

  return {
    watermarkText,
    header: {
      // Snapshotted at confirm time (hr.js PATCH /:id/status) — never
      // a live schools lookup, so a school rename after confirmation
      // never silently rewrites an already-official payslip.
      schoolName: payroll.schoolName || 'School',
      subtitle:   'PAYSLIP' + (isHistorical ? '   [HISTORICAL RECORD — SUPERSEDED]' : (watermarkText ? '   [DRAFT — NOT OFFICIAL]' : '')),
      payPeriod:  payroll.payPeriod,
    },
    employee: {
      name:    payroll.staffName || '—',
      staffId: payroll.staffId,
    },
    earnings,
    grossPay: payroll.grossSalary || 0,
    statutoryDeductions: statutoryRows,
    manualDeductions: manualDeductionRows,
    totalDeductions,
    netPay: payroll.netSalary || 0,
    currency,
    footer: {
      status:      payroll.status,
      recordId:    payroll.id,
      generatedAt: `Generated: ${new Date().toISOString().slice(0, 10)}`,
    },
  };
}

function _titleCase(s) {
  return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * The one adapter — walks the IR and makes the actual pdfkit drawing
 * calls. No calculation logic lives here.
 */
function _drawPayslipPage(doc, s) {
  const PAGE_WIDTH = doc.page.width - 80;
  const DARK = '#1a1a2e', ACCENT = '#2563eb', LIGHT_GRAY = '#f3f4f6', BORDER = '#d1d5db', GRAY = '#555555';

  if (s.watermarkText) {
    doc.save()
       .translate(doc.page.width / 2, doc.page.height / 2)
       .rotate(-45)
       .fontSize(90).fillOpacity(0.06).fillColor('#cc0000')
       .text(s.watermarkText, -200, -45, { width: 400, align: 'center' })
       .restore();
  }

  /* HEADER */
  doc.rect(40, 40, PAGE_WIDTH, 60).fill(DARK);
  doc.fillColor('white').fontSize(17).font('Helvetica-Bold')
     .text(s.header.schoolName, 50, 52, { width: PAGE_WIDTH - 20 });
  doc.fontSize(10).font('Helvetica')
     .text(`${s.header.subtitle}   ·   ${s.header.payPeriod}`, 50, 75, { width: PAGE_WIDTH - 20 });

  /* EMPLOYEE INFO */
  let y = 116;
  doc.rect(40, y, PAGE_WIDTH, 30).fill(LIGHT_GRAY).stroke(BORDER);
  doc.fillColor(DARK).fontSize(10).font('Helvetica-Bold')
     .text(s.employee.name, 50, y + 9, { width: PAGE_WIDTH / 2 });
  doc.font('Helvetica').fillColor(GRAY)
     .text(`Staff ID: ${s.employee.staffId}`, 40 + PAGE_WIDTH / 2, y + 9, { width: PAGE_WIDTH / 2 - 10, align: 'right' });
  y += 44;

  /* EARNINGS TABLE */
  y = _drawTable(doc, 'EARNINGS', s.earnings, s.grossPay, 'Gross Pay', y, PAGE_WIDTH, ACCENT, BORDER, LIGHT_GRAY, GRAY, s.currency);
  y += 14;

  /* DEDUCTIONS TABLE (statutory + manual combined under one heading) */
  const allDeductions = [...s.statutoryDeductions, ...s.manualDeductions];
  y = _drawTable(doc, 'DEDUCTIONS', allDeductions, s.totalDeductions, 'Total Deductions', y, PAGE_WIDTH, '#b91c1c', BORDER, LIGHT_GRAY, GRAY, s.currency);
  y += 18;

  /* NET PAY */
  doc.rect(40, y, PAGE_WIDTH, 34).fill('#eff6ff').stroke(BORDER);
  doc.fillColor(DARK).fontSize(12).font('Helvetica-Bold')
     .text('NET PAY', 50, y + 10, { width: PAGE_WIDTH / 2 });
  doc.fontSize(14).fillColor(ACCENT)
     .text(`${s.currency} ${_fmt(s.netPay)}`, 40, y + 8, { width: PAGE_WIDTH - 10, align: 'right' });
  y += 50;

  /* FOOTER */
  doc.fontSize(8).font('Helvetica').fillColor(GRAY)
     .text(`${s.footer.generatedAt}   ·   Record ${s.footer.recordId}   ·   Status: ${s.footer.status}`, 40, y, { width: PAGE_WIDTH });
}

function _drawTable(doc, title, rows, total, totalLabel, y, PAGE_WIDTH, accent, border, lightGray, gray, currency) {
  doc.fontSize(9).font('Helvetica-Bold').fillColor(accent).text(title, 40, y);
  y += 16;
  doc.rect(40, y, PAGE_WIDTH, Math.max(rows.length, 1) * 18 + 4).stroke(border);
  if (!rows.length) {
    doc.fontSize(9).font('Helvetica').fillColor(gray).text('— none —', 46, y + 5);
    y += 22;
  } else {
    rows.forEach((r, idx) => {
      const rowY = y + 2 + idx * 18;
      if (idx % 2 === 1) doc.rect(40, rowY, PAGE_WIDTH, 18).fill(lightGray);
      doc.fillColor('#111827').fontSize(9).font('Helvetica')
         .text(r.label, 46, rowY + 4, { width: PAGE_WIDTH * 0.6 });
      doc.text(`${currency} ${_fmt(r.amount)}`, 40, rowY + 4, { width: PAGE_WIDTH - 10, align: 'right' });
    });
    y += rows.length * 18 + 4;
  }
  doc.rect(40, y, PAGE_WIDTH, 20).fill('#f9fafb').stroke(border);
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#111827')
     .text(totalLabel, 46, y + 5, { width: PAGE_WIDTH * 0.6 });
  doc.text(`${currency} ${_fmt(total)}`, 40, y + 5, { width: PAGE_WIDTH - 10, align: 'right' });
  return y + 24;
}

function _fmt(n) {
  return Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Thin wrapper — the only export routes call directly. */
function _buildPayslipPDF(doc, payroll) {
  const sections = _computePayslipSections(payroll);
  _drawPayslipPage(doc, sections);
}

module.exports = { _computePayslipSections, _drawPayslipPage, _buildPayslipPDF };
