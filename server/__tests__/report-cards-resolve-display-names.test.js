/* ============================================================
   server/routes/report-cards.js — _resolveDisplayNames (2026-10-18)

   Reported directly, with a side-by-side PDF comparison: a published
   report card showed "Class —" and a blank "Academic Year ·" prefix.
   Root cause: className/termName/academicYear were optional display
   strings PublishSchema trusted the client to send — but the client
   (ReportCardsTab.jsx) only ever sends {classId, termNumber,
   academicYearId}, never these three, so every snapshot froze them
   blank forever. This resolves them server-side from the same IDs
   _resolveTermScope already resolved, authoritatively — never
   dependent on the client sending matching text.
   ============================================================ */
'use strict';

jest.mock('../middleware/auth', () => ({ authMiddleware: (_r, _s, n) => n() }));
jest.mock('../middleware/rbac', () => ({ rbac: () => (_r, _s, n) => n() }));
jest.mock('../middleware/plan', () => ({ planGate: () => (_r, _s, n) => n() }));
jest.mock('../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

let mockClassDoc = null;
let mockYearDoc = null;

jest.mock('../utils/tenant-model', () => ({
  tenantModel: jest.fn((col) => {
    if (col === 'classes') {
      return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(mockClassDoc) }) }) };
    }
    if (col === 'academic_years') {
      return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(mockYearDoc) }) }) };
    }
    throw new Error(`unexpected tenantModel('${col}') call in this test`);
  }),
  tenantContext: jest.fn(() => ({})),
}));

const reportCardsRouter = require('../routes/report-cards');

beforeEach(() => {
  mockClassDoc = { name: 'Form 1A' };
  mockYearDoc = { name: '2026-2027', terms: [{ id: 't1', name: 'Term 1' }, { id: 't2', name: 'Term 2' }] };
});

describe('_resolveDisplayNames', () => {
  test('resolves className, academicYear, and termName from the real DB records', async () => {
    const result = await reportCardsRouter._resolveDisplayNames('school_A', {}, {
      classId: 'cls_1', academicYearId: 'ay_1', termId: 't1',
    });
    expect(result).toEqual({ className: 'Form 1A', academicYear: '2026-2027', termName: 'Term 1' });
  });

  test('no academicYearId at all — academicYear/termName are blank, className still resolves', async () => {
    const result = await reportCardsRouter._resolveDisplayNames('school_A', {}, {
      classId: 'cls_1', academicYearId: null, termId: null,
    });
    expect(result).toEqual({ className: 'Form 1A', academicYear: '', termName: '' });
  });

  test('a class or year that no longer resolves falls back to empty strings, not a crash', async () => {
    mockClassDoc = null;
    mockYearDoc = null;
    const result = await reportCardsRouter._resolveDisplayNames('school_A', {}, {
      classId: 'cls_missing', academicYearId: 'ay_missing', termId: 't1',
    });
    expect(result).toEqual({ className: '', academicYear: '', termName: '' });
  });
});
