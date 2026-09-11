/* ============================================================
   Unit tests — server/utils/student-merge.js (2026-09)

   Reported directly, pressing on the duplicate-resolve feature's
   quality: "you instruct so that database is also aligned, right? no
   dead codes after the delete, right?" Answer at the time was no — the
   original resolve/resolve-bulk routes only cleaned up invoices and
   payments, leaving every other studentId-referencing collection
   pointing at a now-deleted student. mergeStudentData() is the fix:
   re-point every reference onto the kept record BEFORE the removed one
   is ever deleted, across every collection that actually has one.
   ============================================================ */

const mockUpdateMany = {};
function mockModelFor(collection) {
  if (!mockUpdateMany[collection]) {
    mockUpdateMany[collection] = jest.fn().mockResolvedValue({ modifiedCount: 0 });
  }
  return { updateMany: mockUpdateMany[collection] };
}

jest.mock('../utils/tenant-model', () => ({
  tenantModel: jest.fn((collection) => mockModelFor(collection)),
}));

const { mergeStudentData, REFERENCING_COLLECTIONS } = require('../utils/student-merge');

beforeEach(() => {
  for (const fn of Object.values(mockUpdateMany)) fn.mockClear();
});

describe('mergeStudentData', () => {
  test('re-points every referencing collection, matching both the old id and _id forms', async () => {
    await mergeStudentData('sch_1', {}, { id: 'stu_old', _id: 'oid_old' }, 'stu_new');

    for (const collection of REFERENCING_COLLECTIONS) {
      expect(mockUpdateMany[collection]).toHaveBeenCalledWith(
        { studentId: { $in: ['stu_old', 'oid_old'] } },
        { $set: { studentId: 'stu_new' } },
      );
    }
  });

  test('covers invoices and payments too — merge, not delete', () => {
    expect(REFERENCING_COLLECTIONS).toEqual(expect.arrayContaining(['invoices', 'payments']));
  });

  test('falls back to just the _id form when the old record has no UUID id (pre-migration record)', async () => {
    await mergeStudentData('sch_1', {}, { _id: 'oid_only' }, 'stu_new');
    expect(mockUpdateMany.attendance).toHaveBeenCalledWith(
      { studentId: { $in: ['oid_only'] } },
      { $set: { studentId: 'stu_new' } },
    );
  });

  test('returns only the collections that actually had something to move', async () => {
    mockUpdateMany.attendance = jest.fn().mockResolvedValue({ modifiedCount: 3 });
    mockUpdateMany.grades     = jest.fn().mockResolvedValue({ modifiedCount: 0 });

    const counts = await mergeStudentData('sch_1', {}, { id: 'stu_old' }, 'stu_new');

    expect(counts.attendance).toBe(3);
    expect(counts).not.toHaveProperty('grades');
  });

  test('is a no-op when the old record has neither id nor _id', async () => {
    const counts = await mergeStudentData('sch_1', {}, {}, 'stu_new');
    expect(counts).toEqual({});
    expect(mockUpdateMany.attendance).not.toHaveBeenCalled();
  });

  test('is a no-op when no newStudentId is given', async () => {
    const counts = await mergeStudentData('sch_1', {}, { id: 'stu_old' }, undefined);
    expect(counts).toEqual({});
  });
});
