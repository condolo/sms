/* ============================================================
   server/routes/report-cards.js — RCE2 layout dispatch wiring

   Only one real renderer (legacy_tabular) exists yet, so a rendering-
   output comparison can't distinguish "dispatches on snap.layoutKey"
   from "always uses legacy_tabular" — both look identical today.
   This mocks the registry itself to prove _buildPDFPage actually
   passes the snapshot's OWN frozen layoutKey through to getLayout(),
   not a hardcoded key — the exact wiring RCE3/4's real second and
   third renderers will depend on being correct.
   ============================================================ */
'use strict';

const mockRenderPdf = jest.fn();
const mockGetLayout = jest.fn(() => ({ renderPdf: mockRenderPdf, renderHtml: jest.fn(() => '<html></html>') }));

jest.mock('../utils/report-layouts', () => ({
  getLayout: (...args) => mockGetLayout(...args),
  LAYOUTS: {},
  _esc: (s) => String(s ?? ''),
}));

const reportCardsRouter = require('../routes/report-cards');

function baseSnap(overrides = {}) {
  return {
    status: 'published', superseded: false, version: 1,
    studentName: 'Jane Doe', admissionNo: 'ADM001', className: 'Grade 7',
    termName: 'Term 2', academicYear: '2026', termNumber: 2, schoolName: 'Test School',
    assessmentWeights: [], gradingSchema: [], subjects: {},
    totalScore: 0, averageScore: 0, gpa: 0, rankings: {}, comments: {},
    ...overrides,
  };
}

beforeEach(() => { mockGetLayout.mockClear(); mockRenderPdf.mockClear(); });

describe('_buildPDFPage — dispatches on the snapshot\'s own frozen layoutKey', () => {
  test('a published snapshot with layoutKey set passes it straight through', () => {
    reportCardsRouter._buildPDFPage({}, baseSnap({ layoutKey: 'subject_paired' }), {}, null, true, {});
    expect(mockGetLayout).toHaveBeenCalledWith('subject_paired');
  });

  test('a pre-engine snapshot with no layoutKey field passes undefined through, not a hardcoded key', () => {
    reportCardsRouter._buildPDFPage({}, baseSnap(), {}, null, true, {});
    expect(mockGetLayout).toHaveBeenCalledWith(undefined);
  });

  test('renderPdf is called with the computed sections, the images, and isFirstPage', () => {
    const images = { studentPhoto: 'x' };
    reportCardsRouter._buildPDFPage({}, baseSnap({ layoutKey: 'marks_then_comments' }), {}, null, false, images);
    expect(mockRenderPdf).toHaveBeenCalledWith({}, expect.any(Object), images, false);
  });
});
