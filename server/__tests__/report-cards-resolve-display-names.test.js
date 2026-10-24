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

/* ── Dual-ID safe (2026-10-25) — reported directly, live: a published
   MLA report showed Stream "10A" correctly but Class blank. Confirmed
   directly against the real DB: the class ("Year 10") predates the
   UUID-`id` migration — only its Mongo `_id` exists — and this
   function's class lookup matched on `id` alone, so it silently found
   nothing for every such legacy class. These tests use a REAL
   filter-matching mock (the three above don't filter at all) so the
   `$or` clause this fix adds is actually exercised, not just present
   in the source. ── */
describe('_resolveDisplayNames — dual-ID safe class lookup', () => {
  let classStore;
  const SCHOOL = 'school_A';

  function mockMatches(doc, filter) {
    if (filter.$or) return filter.$or.some(sub => mockMatches(doc, sub));
    return Object.entries(filter).every(([k, v]) => doc[k] === v);
  }

  beforeEach(() => {
    jest.resetModules();
    classStore = [];
    jest.doMock('../utils/tenant-model', () => ({
      tenantModel: jest.fn((col) => {
        if (col === 'classes') {
          return { findOne: (filter) => ({ select: () => ({ lean: () => Promise.resolve(classStore.find(d => mockMatches(d, filter)) ?? null) }) }) };
        }
        if (col === 'academic_years') {
          return { findOne: () => ({ select: () => ({ lean: () => Promise.resolve(null) }) }) };
        }
        throw new Error(`unexpected tenantModel('${col}') call in this test`);
      }),
      tenantContext: jest.fn(() => ({})),
    }));
  });

  test('a post-migration class (real UUID `id`) resolves exactly as before', async () => {
    classStore = [{ schoolId: SCHOOL, id: 'cls_uuid_1', name: 'Form 1A' }];
    const router = require('../routes/report-cards');
    const result = await router._resolveDisplayNames(SCHOOL, {}, { classId: 'cls_uuid_1', academicYearId: null, termId: null });
    expect(result.className).toBe('Form 1A');
  });

  test('a legacy class with no `id` field — only a Mongo `_id` — now resolves by its `_id`', async () => {
    const legacyMongoId = '6a32d9214551eb4cbd47d1f0'; // real 24-char hex shape, matches MLA's actual legacy class
    classStore = [{ schoolId: SCHOOL, _id: legacyMongoId, name: 'Year 10' }]; // no `id` field at all
    const router = require('../routes/report-cards');
    const result = await router._resolveDisplayNames(SCHOOL, {}, { classId: legacyMongoId, academicYearId: null, termId: null });
    expect(result.className).toBe('Year 10');
  });

  test('a UUID classId is never probed against `_id` — no cast-error risk, no false match', async () => {
    const uuid = 'not-a-valid-object-id-uuid-1234';
    classStore = [{ schoolId: SCHOOL, _id: '6a32d9214551eb4cbd47d1f0', name: 'Should Never Match' }];
    const router = require('../routes/report-cards');
    const result = await router._resolveDisplayNames(SCHOOL, {}, { classId: uuid, academicYearId: null, termId: null });
    expect(result.className).toBe(''); // genuinely no match — not the unrelated legacy class
  });
});
