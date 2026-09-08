/* ============================================================
   Msingi — Admission-triggered invoicing (2026-09)

   A school-driven request: the admission package (Admission Fee,
   Caution Money, Ambulance Cover, T-shirt, Hymn Book, …) should get
   billed automatically the moment a student is enrolled, instead of
   Finance re-typing the same line items by hand for every admission.

   Called from admissions.js's POST /:id/enroll, right after the new
   student document is created. Deliberately produces a DRAFT invoice,
   never an issued one — Finance still reviews before a parent ever
   sees it (see PATCH /api/finance/invoices/:id/issue in finance.js).
   Automatic generation was the part of this request that mattered;
   automatic issuing was explicitly not — see the confirmed scope in
   CHANGELOG.md's v5.64.0 entry.

   Scope-limited to fee_structures with scopeType 'all' only. A single
   newly-enrolled student's class/section/individual-list membership
   isn't resolved here — only whether the school wants every admission
   billed this way. See FeeStructureSchema.autoGenerateOnEnroll in
   finance.js for the fuller rationale.

   Idempotent: safe to call twice for the same student (e.g. a retried
   /enroll request, or a double form submission) — an invoice already
   tied to {studentId, feeStructureId} is never duplicated.

   Never allowed to fail an enrollment: the caller wraps this in a
   try/catch and logs rather than rejects the request, matching how
   every other post-enrollment side effect in this codebase (guardian
   notification, etc.) is treated as best-effort, not a hard dependency
   of "the student got enrolled".
   ============================================================ */
'use strict';

const { v4: uuidv4 } = require('uuid');
const { tenantModel } = require('./tenant-model');
const { nextInvoiceNumber } = require('./counters');
const { isYearArchived } = require('./archival');
const { calcInvoiceTotals } = require('./invoice-math');
const { resolveAutoDiscounts } = require('./discount-resolution');
const AuditService = require('../services/audit');

async function generateEnrollmentInvoices(schoolId, ctx, student, userId, req) {
  const FeeStructures = tenantModel('fee_structures', ctx);
  const Invoices      = tenantModel('invoices', ctx);

  const structures = await FeeStructures.find({ schoolId, autoGenerateOnEnroll: true, scopeType: 'all' }).lean();
  if (!structures.length) return [];

  const studentId = student.id ?? student._id?.toString();
  const created = [];

  for (const fs of structures) {
    // Academic Year & Term Dependency Map, finding #5 — same guard
    // /fee-structures/:id/generate applies; a locked year just skips
    // this one structure rather than failing the whole enrollment.
    if (await isYearArchived(schoolId, fs.academicYearId)) continue;

    const existing = await Invoices.findOne({ schoolId, studentId, feeStructureId: fs.id }).lean();
    if (existing) continue; // idempotent — already generated for this student

    const discounts   = await resolveAutoDiscounts(schoolId, ctx, [studentId]);
    const discountPct = discounts.get(studentId) ?? 0;
    const totals       = calcInvoiceTotals(fs.lineItems, discountPct);
    const invoiceNumber = await nextInvoiceNumber(schoolId);

    const inv = await Invoices.create({
      id: uuidv4(), schoolId, discountPct, invoiceNumber,
      studentId, studentName: `${student.firstName} ${student.lastName}`,
      title: fs.name, lineItems: fs.lineItems, dueDate: fs.dueDate,
      academicYearId: fs.academicYearId, termId: fs.termId, feeStructureId: fs.id,
      ...totals, amountPaid: 0, balance: totals.total,
      status: 'draft', createdBy: userId,
    });
    const doc = inv.toObject ? inv.toObject() : inv;
    created.push(doc);

    AuditService.log({
      action: 'finance.enrollment_invoice_drafted',
      actor: req?.jwtUser ?? { userId, schoolId }, schoolId,
      target: { type: 'invoice', id: doc.id, label: doc.invoiceNumber },
      details: { studentId, feeStructureId: fs.id, feeStructureName: fs.name },
      req,
    });
  }
  return created;
}

module.exports = { generateEnrollmentInvoices };
