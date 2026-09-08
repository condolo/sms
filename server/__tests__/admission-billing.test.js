/* ============================================================
   utils/admission-billing.js — generateEnrollmentInvoices()

   Part 4 of 4 for the 2026-09 school-driven Finance request: the
   admission package (Admission Fee, Caution Money, Ambulance Cover,
   T-shirt, Hymn Book, …) should get billed automatically the moment a
   student is enrolled, instead of Finance re-typing it by hand for
   every admission. Called from admissions.js's POST /:id/enroll.

   Covers:
     1. A matching fee structure (autoGenerateOnEnroll + scopeType
        'all') produces exactly one DRAFT invoice for the new student.
     2. A structure with any other scopeType is never picked up — the
        deliberate scope limitation (see finance.js's schema comment).
     3. A structure with autoGenerateOnEnroll: false is left alone.
     4. Idempotent — calling twice for the same student never creates a
        second invoice for the same fee structure.
     5. A locked/archived academic year skips that one structure rather
        than throwing.
     6. Auto-discounts (sibling/director/referral) apply to the
        enrollment invoice the same way they apply to a bulk-generated
        one — the same resolveAutoDiscounts() used by
        POST /fee-structures/:id/generate.

   All DB calls are mocked — no MongoDB required.
   ============================================================ */
'use strict';

const SCHOOL = 'school_test_001';

function matchesFilter(doc, filter) {
  return Object.entries(filter || {}).every(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if ('$in' in v) return Array.isArray(doc[k]) ? v.$in.some(x => doc[k].includes(x)) : v.$in.includes(doc[k]);
      if ('$ne' in v) return doc[k] !== v.$ne;
    }
    return doc[k] === v;
  });
}
function mockChainArr(arr) { return { select: () => mockChainArr(arr), lean: () => Promise.resolve(arr) }; }
function mockChainObj(obj) { return { select: () => mockChainObj(obj), lean: () => Promise.resolve(obj) }; }
function makeFakeCollection(seed = []) {
  const docs = [...seed];
  return {
    _docs: () => docs,
    find:    jest.fn((filter) => mockChainArr(docs.filter(d => matchesFilter(d, filter)))),
    findOne: jest.fn((filter) => mockChainObj(docs.find(d => matchesFilter(d, filter)) || null)),
    create:  jest.fn((doc) => { docs.push(doc); return Promise.resolve(doc); }),
  };
}

let mockFeeStructures, mockInvoices, mockDiscountPolicies, mockStudents, mockUsers, mockSchoolDoc;
jest.mock('../utils/model', () => ({
  _model: jest.fn((c) => {
    if (c === 'schools') return { findOne: jest.fn(() => mockChainObj(mockSchoolDoc)) };
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../utils/tenant-model', () => ({
  tenantModel: jest.fn((c) => {
    if (c === 'fee_structures')     return mockFeeStructures;
    if (c === 'invoices')           return mockInvoices;
    if (c === 'discount_policies')  return mockDiscountPolicies;
    if (c === 'students')           return mockStudents;
    if (c === 'users')              return mockUsers;
    return { find: jest.fn(() => mockChainArr([])), findOne: jest.fn(() => mockChainObj(null)) };
  }),
}));
jest.mock('../utils/counters', () => ({ nextInvoiceNumber: jest.fn().mockResolvedValue('INV-1') }));
jest.mock('../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));
const mockAuditLog = jest.fn();
jest.mock('../services/audit', () => ({ log: (...args) => mockAuditLog(...args) }));

const { isYearArchived } = require('../utils/archival');
const { generateEnrollmentInvoices } = require('../utils/admission-billing');

const STUDENT = { id: 'stu_new', schoolId: SCHOOL, firstName: 'Amara', lastName: 'Osei' };

beforeEach(() => {
  jest.clearAllMocks();
  isYearArchived.mockResolvedValue(false);
  mockInvoices          = makeFakeCollection([]);
  mockDiscountPolicies  = makeFakeCollection([]);
  mockStudents          = makeFakeCollection([STUDENT]);
  mockUsers             = makeFakeCollection([]);
  mockSchoolDoc         = { currency: 'KES' };
});

test('a matching fee structure (autoGenerateOnEnroll + scopeType all) produces one draft invoice', async () => {
  mockFeeStructures = makeFakeCollection([{
    id: 'fs_admission', schoolId: SCHOOL, name: 'New Admission Package', scopeType: 'all', autoGenerateOnEnroll: true,
    lineItems: [{ description: 'Admission Fee', quantity: 1, unitPrice: 15000 }, { description: 'Caution Money', quantity: 1, unitPrice: 10000 }],
  }]);

  const result = await generateEnrollmentInvoices(SCHOOL, {}, STUDENT, 'usr_admin', { jwtUser: { schoolId: SCHOOL } });

  expect(result).toHaveLength(1);
  const inv = mockInvoices._docs()[0];
  expect(inv.studentId).toBe('stu_new');
  expect(inv.status).toBe('draft');
  expect(inv.total).toBe(25000);
  expect(inv.currency).toBe('KES');
  expect(inv.feeStructureId).toBe('fs_admission');
  expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'finance.enrollment_invoice_drafted' }));
});

test('uses the school\'s own currency, not a hardcoded one', async () => {
  mockSchoolDoc = { currency: 'UGX' };
  mockFeeStructures = makeFakeCollection([{
    id: 'fs_admission', schoolId: SCHOOL, name: 'New Admission Package', scopeType: 'all', autoGenerateOnEnroll: true,
    lineItems: [{ description: 'Admission Fee', quantity: 1, unitPrice: 15000 }],
  }]);
  const result = await generateEnrollmentInvoices(SCHOOL, {}, STUDENT, 'usr_admin', {});
  expect(result[0].currency).toBe('UGX');
});

test('falls back to KES when the school has no currency set', async () => {
  mockSchoolDoc = {};
  mockFeeStructures = makeFakeCollection([{
    id: 'fs_admission', schoolId: SCHOOL, name: 'New Admission Package', scopeType: 'all', autoGenerateOnEnroll: true,
    lineItems: [{ description: 'Admission Fee', quantity: 1, unitPrice: 15000 }],
  }]);
  const result = await generateEnrollmentInvoices(SCHOOL, {}, STUDENT, 'usr_admin', {});
  expect(result[0].currency).toBe('KES');
});

test('a structure scoped to classes (not "all") is never picked up', async () => {
  mockFeeStructures = makeFakeCollection([{
    id: 'fs_scoped', schoolId: SCHOOL, name: 'Grade 3 Only', scopeType: 'classes', classIds: ['cls_1'], autoGenerateOnEnroll: true,
    lineItems: [{ description: 'Something', quantity: 1, unitPrice: 1000 }],
  }]);
  const result = await generateEnrollmentInvoices(SCHOOL, {}, STUDENT, 'usr_admin', {});
  expect(result).toHaveLength(0);
  expect(mockInvoices._docs()).toHaveLength(0);
});

test('a structure with autoGenerateOnEnroll: false is left alone', async () => {
  mockFeeStructures = makeFakeCollection([{
    id: 'fs_manual', schoolId: SCHOOL, name: 'Manual Fees', scopeType: 'all', autoGenerateOnEnroll: false,
    lineItems: [{ description: 'Something', quantity: 1, unitPrice: 1000 }],
  }]);
  const result = await generateEnrollmentInvoices(SCHOOL, {}, STUDENT, 'usr_admin', {});
  expect(result).toHaveLength(0);
});

test('idempotent — calling twice never creates a second invoice for the same student+structure', async () => {
  mockFeeStructures = makeFakeCollection([{
    id: 'fs_admission', schoolId: SCHOOL, name: 'New Admission Package', scopeType: 'all', autoGenerateOnEnroll: true,
    lineItems: [{ description: 'Admission Fee', quantity: 1, unitPrice: 15000 }],
  }]);

  await generateEnrollmentInvoices(SCHOOL, {}, STUDENT, 'usr_admin', {});
  const secondResult = await generateEnrollmentInvoices(SCHOOL, {}, STUDENT, 'usr_admin', {});

  expect(secondResult).toHaveLength(0); // skipped — already exists
  expect(mockInvoices._docs()).toHaveLength(1); // still only one invoice total
});

test('a locked academic year skips that one structure without throwing', async () => {
  isYearArchived.mockResolvedValue(true);
  mockFeeStructures = makeFakeCollection([{
    id: 'fs_locked', schoolId: SCHOOL, name: 'Locked Year Fees', scopeType: 'all', autoGenerateOnEnroll: true, academicYearId: 'ay_old',
    lineItems: [{ description: 'Something', quantity: 1, unitPrice: 1000 }],
  }]);
  const result = await generateEnrollmentInvoices(SCHOOL, {}, STUDENT, 'usr_admin', {});
  expect(result).toHaveLength(0);
  expect(mockInvoices._docs()).toHaveLength(0);
});

test('an active sibling discount applies to the enrollment invoice, same as bulk generation', async () => {
  mockFeeStructures = makeFakeCollection([{
    id: 'fs_admission', schoolId: SCHOOL, name: 'New Admission Package', scopeType: 'all', autoGenerateOnEnroll: true,
    lineItems: [{ description: 'Admission Fee', quantity: 1, unitPrice: 1000 }],
  }]);
  mockStudents = makeFakeCollection([
    { id: 'stu_elder',   schoolId: SCHOOL, firstName: 'Elder',   lastName: 'Kid', enrollmentDate: '2020-01-01' },
    { id: 'stu_new',     schoolId: SCHOOL, firstName: 'Amara',   lastName: 'Osei', enrollmentDate: '2026-09-01' },
  ]);
  mockUsers = makeFakeCollection([
    { id: 'guardian_1', schoolId: SCHOOL, role: 'parent', studentIds: ['stu_elder', 'stu_new'] },
  ]);
  mockDiscountPolicies = makeFakeCollection([
    { id: 'dp_sib', schoolId: SCHOOL, type: 'sibling', active: true, tiers: [{ nthChild: 2, discountPct: 10 }] },
  ]);

  const result = await generateEnrollmentInvoices(SCHOOL, {}, STUDENT, 'usr_admin', {});
  expect(result[0].discountPct).toBe(10);
  expect(result[0].total).toBe(900);
});

test('multiple qualifying structures each produce their own draft invoice', async () => {
  mockFeeStructures = makeFakeCollection([
    { id: 'fs_1', schoolId: SCHOOL, name: 'Admission Package', scopeType: 'all', autoGenerateOnEnroll: true, lineItems: [{ description: 'Admission Fee', quantity: 1, unitPrice: 15000 }] },
    { id: 'fs_2', schoolId: SCHOOL, name: 'Ambulance Cover',  scopeType: 'all', autoGenerateOnEnroll: true, lineItems: [{ description: 'Ambulance', quantity: 1, unitPrice: 500 }] },
  ]);
  const result = await generateEnrollmentInvoices(SCHOOL, {}, STUDENT, 'usr_admin', {});
  expect(result).toHaveLength(2);
  expect(mockInvoices._docs()).toHaveLength(2);
});
