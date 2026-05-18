/* ============================================================
   Unit tests — server/utils/archival.js

   Tests isYearArchived and firstArchivedYear without a real DB.
   ============================================================ */
const { isYearArchived, firstArchivedYear } = require('../utils/archival');

/* ── Mock _model so no MongoDB is required ──────────────────── */
const mockFindOne = jest.fn();
jest.mock('../utils/model', () => ({
  _model: jest.fn(() => ({ findOne: mockFindOne })),
}));

/* ── Helper to configure the mock DB response ───────────────── */
function mockConfig(archivedAcademicYears) {
  mockFindOne.mockReturnValue({
    lean: jest.fn().mockResolvedValue(
      archivedAcademicYears !== undefined
        ? { archivedAcademicYears }
        : null
    )
  });
}

beforeEach(() => jest.clearAllMocks());

/* ══════════════════════════════════════════════════════════════
   isYearArchived
   ══════════════════════════════════════════════════════════════ */
describe('isYearArchived', () => {
  test('returns false when schoolId is falsy', async () => {
    expect(await isYearArchived(null, 'year1')).toBe(false);
    expect(await isYearArchived('',   'year1')).toBe(false);
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  test('returns false when academicYearId is falsy', async () => {
    expect(await isYearArchived('school1', null)).toBe(false);
    expect(await isYearArchived('school1', ''  )).toBe(false);
    expect(await isYearArchived('school1', undefined)).toBe(false);
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  test('returns false when config document does not exist (null)', async () => {
    mockConfig(undefined); // findOne returns null
    expect(await isYearArchived('school1', 'year1')).toBe(false);
  });

  test('returns false when archivedAcademicYears field is missing from doc', async () => {
    mockFindOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({}) });
    expect(await isYearArchived('school1', 'year1')).toBe(false);
  });

  test('returns false when archivedAcademicYears is an empty array', async () => {
    mockConfig([]);
    expect(await isYearArchived('school1', 'year1')).toBe(false);
  });

  test('returns false when yearId is NOT in the archived list', async () => {
    mockConfig(['year2', 'year3']);
    expect(await isYearArchived('school1', 'year1')).toBe(false);
  });

  test('returns true when yearId IS in the archived list', async () => {
    mockConfig(['year1', 'year2']);
    expect(await isYearArchived('school1', 'year1')).toBe(true);
  });

  test('returns true when yearId is the only archived year', async () => {
    mockConfig(['year1']);
    expect(await isYearArchived('school1', 'year1')).toBe(true);
  });

  test('is case-sensitive (does not treat YEAR1 as year1)', async () => {
    mockConfig(['YEAR1']);
    expect(await isYearArchived('school1', 'year1')).toBe(false);
  });

  test('queries with projection to load only archivedAcademicYears field', async () => {
    mockConfig([]);
    await isYearArchived('school1', 'year1');
    expect(mockFindOne).toHaveBeenCalledWith(
      { schoolId: 'school1' },
      { archivedAcademicYears: 1 }
    );
  });
});

/* ══════════════════════════════════════════════════════════════
   firstArchivedYear
   ══════════════════════════════════════════════════════════════ */
describe('firstArchivedYear', () => {
  test('returns null for empty array', async () => {
    expect(await firstArchivedYear('school1', [])).toBeNull();
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  test('returns null when all yearIds are null/undefined', async () => {
    expect(await firstArchivedYear('school1', [null, undefined, ''])).toBeNull();
    expect(mockFindOne).not.toHaveBeenCalled();
  });

  test('returns null when no yearId in the list is archived', async () => {
    mockConfig(['year99']);
    expect(await firstArchivedYear('school1', ['year1', 'year2'])).toBeNull();
  });

  test('returns the first archived yearId found', async () => {
    // year2 is archived, year1 is not
    mockFindOne
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue({ archivedAcademicYears: [] }) })       // year1 check
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue({ archivedAcademicYears: ['year2'] }) }); // year2 check
    const result = await firstArchivedYear('school1', ['year1', 'year2']);
    expect(result).toBe('year2');
  });

  test('deduplicates yearIds — does not check the same year twice', async () => {
    mockConfig(['year1']);
    await firstArchivedYear('school1', ['year1', 'year1', 'year1']);
    // Should only call findOne once (distinct check)
    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });

  test('filters null/undefined yearIds before checking', async () => {
    mockConfig(['year1']);
    const result = await firstArchivedYear('school1', [null, undefined, '', 'year1']);
    expect(result).toBe('year1');
    // Should only check 'year1' — nulls skipped
    expect(mockFindOne).toHaveBeenCalledTimes(1);
  });
});
