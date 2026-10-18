/* ============================================================
   server/routes/report-cards.js — _lockSubmissionCombos (2026-10-18)

   Reported via a full Config -> Markbook -> MarkList -> Report Card
   audit (never from a user complaint): mark_submissions' only unique
   index is {schoolId, classId, subjectId, termNumber, assessmentType,
   instance} (indexes.js's 'mksub_composite') — streamId is NOT part of
   a submission's identity. The previous auto-lock step conditionally
   included streamId in its own lookup filter, which can't find a
   pre-existing stream-naive doc, falls through to create(), and throws
   a duplicate-key error against that same index — aborting every combo
   still left in the publish's lock loop. Confirmed live against
   sch_demo: 4 of 11 real combos in an already-published, already-
   locked class never got their mark_submissions doc flipped to
   'locked' because an earlier combo hit exactly this collision.
   ============================================================ */
'use strict';

jest.mock('../middleware/auth', () => ({ authMiddleware: (_r, _s, n) => n() }));
jest.mock('../middleware/rbac', () => ({ rbac: () => (_r, _s, n) => n(), hasExplicitSubGrant: jest.fn() }));
jest.mock('../middleware/plan', () => ({ planGate: () => (_r, _s, n) => n() }));
jest.mock('../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));
jest.mock('../utils/tenant-model', () => ({
  tenantModel: jest.fn(() => ({ findOne: () => ({ lean: () => Promise.resolve(null) }) })),
  tenantContext: jest.fn(() => ({})),
}));

const reportCardsRouter = require('../routes/report-cards');
const { _lockSubmissionCombos } = reportCardsRouter;

/** A minimal fake mark_submissions model backed by an in-memory array,
 *  enforcing the real collection's actual unique index (ignoring
 *  streamId) so a regression reintroducing the old bug fails loudly. */
function fakeSubmissions(seed = []) {
  const docs = [...seed];
  return {
    _docs: docs,
    findOne: (query) => ({
      lean: () => Promise.resolve(docs.find(d =>
        d.schoolId === query.schoolId && d.classId === query.classId &&
        d.subjectId === query.subjectId && d.termNumber === query.termNumber &&
        d.assessmentType === query.assessmentType && d.instance === query.instance
      ) ?? null),
    }),
    updateOne: jest.fn(async ({ id }, { $set }) => {
      const doc = docs.find(d => d.id === id);
      Object.assign(doc, $set);
    }),
    create: jest.fn(async (doc) => {
      const dup = docs.find(d =>
        d.schoolId === doc.schoolId && d.classId === doc.classId && d.subjectId === doc.subjectId &&
        d.termNumber === doc.termNumber && d.assessmentType === doc.assessmentType && d.instance === doc.instance
      );
      if (dup) { const e = new Error('E11000 duplicate key error (mksub_composite)'); e.code = 11000; throw e; }
      docs.push(doc);
    }),
  };
}

const BASE = { schoolId: 'sch_1', classId: 'cls_1', termNumber: 1, academicYearId: 'ay_1', userId: 'u1', now: '2026-10-18T12:00:00.000Z', yearFilter: {}, routeTag: 'test' };

describe('_lockSubmissionCombos', () => {
  test('locks an existing submission created WITHOUT a streamId, for a combo that now carries one', async () => {
    const Submissions = fakeSubmissions([
      { id: 'sub_1', schoolId: 'sch_1', classId: 'cls_1', subjectId: 'chem', termNumber: 1, assessmentType: 'MT', instance: 1, status: 'approved' },
    ]);
    await _lockSubmissionCombos(Submissions, {
      ...BASE, combos: [{ subjectId: 'chem', assessmentType: 'MT', instance: 1, streamId: 'stream_A' }],
    });
    expect(Submissions._docs).toHaveLength(1); // updated in place, never duplicated
    expect(Submissions._docs[0].status).toBe('locked');
    expect(Submissions._docs[0].streamId).toBe('stream_A'); // stream recorded as metadata
  });

  test('creates a fresh locked doc when truly none exists', async () => {
    const Submissions = fakeSubmissions([]);
    await _lockSubmissionCombos(Submissions, {
      ...BASE, combos: [{ subjectId: 'bio', assessmentType: 'CA', instance: 1, streamId: null }],
    });
    expect(Submissions._docs).toHaveLength(1);
    expect(Submissions._docs[0]).toMatchObject({ subjectId: 'bio', assessmentType: 'CA', instance: 1, status: 'locked' });
  });

  test('leaves an already-locked submission untouched (no redundant write)', async () => {
    const Submissions = fakeSubmissions([
      { id: 'sub_2', schoolId: 'sch_1', classId: 'cls_1', subjectId: 'eng', termNumber: 1, assessmentType: 'CA', instance: 1, status: 'locked' },
    ]);
    await _lockSubmissionCombos(Submissions, {
      ...BASE, combos: [{ subjectId: 'eng', assessmentType: 'CA', instance: 1, streamId: null }],
    });
    expect(Submissions.updateOne).not.toHaveBeenCalled();
  });

  test('a failure on one combo does not stop the rest from being locked (the actual live symptom)', async () => {
    const Submissions = fakeSubmissions([
      { id: 'sub_3', schoolId: 'sch_1', classId: 'cls_1', subjectId: 'math', termNumber: 1, assessmentType: 'MT', instance: 1, status: 'approved' },
    ]);
    // Force the first combo's updateOne to blow up, simulating any
    // unexpected failure — the second combo must still get processed.
    Submissions.updateOne.mockImplementationOnce(() => { throw new Error('boom'); });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await _lockSubmissionCombos(Submissions, {
      ...BASE,
      combos: [
        { subjectId: 'math', assessmentType: 'MT', instance: 1, streamId: null },
        { subjectId: 'kisw', assessmentType: 'MT', instance: 1, streamId: 'stream_B' },
      ],
    });

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const kiswDoc = Submissions._docs.find(d => d.subjectId === 'kisw');
    expect(kiswDoc).toMatchObject({ status: 'locked' });
    consoleSpy.mockRestore();
  });
});
