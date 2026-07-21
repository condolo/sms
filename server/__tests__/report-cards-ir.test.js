/* ============================================================
   Regression test — _buildPDFPage's split into _computeReportSections
   (IR) + _drawReportPage (adapter) must produce a BYTE-FOR-BYTE
   identical pdfkit call sequence to the original monolithic function,
   for every branch that function has (draft/superseded watermark,
   images, second-page addPage(), empty-config "nothing configured"
   edge case, ranking note, moderation warning, attendance block).

   server/__tests__/fixtures/report-card-pdf-golden.json was captured
   by running the ORIGINAL, pre-refactor _buildPDFPage against a spy
   PDFDocument (recording every method call + args) for four fixtures
   covering those branches, BEFORE the extraction into
   _computeReportSections/_drawReportPage happened (Consolidation Plan
   §5.3 step 2's "prove the pipeline before anything else changes").
   The one genuinely time-varying value (the footer's wall-clock
   "Generated:" line) is redacted identically on both sides.

   This test proves the refactor changed HOW the function is organized,
   not WHAT it draws — a real behavior-preservation guarantee, not a
   description of intent.
   ============================================================ */
'use strict';

jest.mock('../middleware/auth', () => ({ authMiddleware: (_r, _s, n) => n() }));
jest.mock('../middleware/rbac', () => ({ rbac: () => (_r, _s, n) => n() }));
jest.mock('../middleware/plan', () => ({ planGate: () => (_r, _s, n) => n() }));
jest.mock('../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

const reportCardsRouter = require('../routes/report-cards');
const golden = require('./fixtures/report-card-pdf-golden.json');

function makeSpyDoc() {
  const calls = [];
  const spy = { page: { width: 595.28, height: 841.89 } };
  const methods = ['addPage', 'rect', 'fill', 'stroke', 'fillColor', 'fontSize', 'font', 'text', 'image', 'save', 'translate', 'rotate', 'fillOpacity', 'restore', 'moveTo', 'lineTo'];
  for (const m of methods) {
    spy[m] = (...args) => { calls.push({ method: m, args: JSON.parse(JSON.stringify(args)) }); return spy; };
  }
  return { spy, calls };
}

function redact(calls) {
  return calls.map(c => ({
    ...c,
    args: c.args.map(a => (typeof a === 'string' && a.startsWith('Generated: ')) ? 'Generated: <REDACTED>' : a),
  }));
}

describe('_buildPDFPage IR/adapter split — golden call-sequence regression', () => {
  golden.fixtures.forEach(fixture => {
    test(`fixture "${fixture.name}" produces an identical pdfkit call sequence to the pre-refactor original`, () => {
      const { spy, calls } = makeSpyDoc();
      reportCardsRouter._buildPDFPage(spy, fixture.snap, fixture.config, fixture.attendance, fixture.isFirstPage, fixture.images);
      const actual = redact(calls);
      expect(actual).toEqual(fixture.calls);
    });
  });

  test('sanity: the golden fixture file itself covers every major branch (not a trivially-passing empty comparison)', () => {
    const names = golden.fixtures.map(f => f.name);
    expect(names).toEqual(['published_basic', 'draft_with_images_second_page', 'superseded', 'minimal_nothing_configured']);
    golden.fixtures.forEach(f => expect(f.calls.length).toBeGreaterThan(50));
  });
});

describe('_computeReportSections — the IR itself, directly', () => {
  test('is a pure function: called twice with the same input produces deep-equal output', () => {
    const fixture = golden.fixtures[0];
    const a = reportCardsRouter._computeReportSections(fixture.snap, fixture.config, fixture.attendance);
    const b = reportCardsRouter._computeReportSections(fixture.snap, fixture.config, fixture.attendance);
    expect(a).toEqual(b);
  });

  test('watermarkText is null for a published, non-superseded snapshot; set for draft/superseded', () => {
    const published = reportCardsRouter._computeReportSections(golden.fixtures[0].snap, golden.fixtures[0].config, golden.fixtures[0].attendance);
    expect(published.watermarkText).toBeNull();

    const draft = reportCardsRouter._computeReportSections(golden.fixtures[1].snap, golden.fixtures[1].config, golden.fixtures[1].attendance);
    expect(draft.watermarkText).toBe('DRAFT');

    const superseded = reportCardsRouter._computeReportSections(golden.fixtures[2].snap, golden.fixtures[2].config, golden.fixtures[2].attendance);
    expect(superseded.watermarkText).toBe('SUPERSEDED');
  });

  test('the minimal fixture (nothing configured) never throws and produces safe fallback text, not undefined/NaN', () => {
    const minimal = golden.fixtures.find(f => f.name === 'minimal_nothing_configured');
    const ir = reportCardsRouter._computeReportSections(minimal.snap, minimal.config, minimal.attendance);
    expect(ir.summary.totalText).toBe('Total Score: —');
    expect(ir.footer.reportId).toBeNull();
    expect(ir.attendance).toBeNull();
    expect(ir.resultsTable.rankingNote).toBeNull();
    expect(ir.resultsTable.rows).toEqual([]);
  });
});
