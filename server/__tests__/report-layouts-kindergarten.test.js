/* ============================================================
   server/utils/report-layouts.js — kindergarten renderer

   Reported directly, in two rounds:
   1. Turning off Ranking or Principal's Comment in Report Card settings
      should mean the block never appears, not even blank. The non-KG
      layouts (legacy_tabular, subject_paired, marks_then_comments)
      already honoured showClassTeacherRemark/showPrincipalRemark via
      _computeReportSections — the KG path never read either flag at
      all, only ever hiding a remark block when its text happened to be
      empty. Ranking has no KG equivalent to begin with (no rank/GPA
      concept for a competency-band report) — nothing to gate there.
   2. Turning the comment off then also hid the person's NAME and
      SIGNATURE — a separate School Settings concept (who the principal
      is, their uploaded signature) that must not depend on a Report
      Card comment toggle. The toggle now gates ONLY the "General
      Comment" banner + text; the name/signature row renders whenever
      there's a name to attribute it to, regardless of the toggle.
   ============================================================ */
'use strict';

jest.mock('../middleware/auth', () => ({ authMiddleware: (_r, _s, n) => n() }));
jest.mock('../middleware/rbac', () => ({ rbac: () => (_r, _s, n) => n() }));
jest.mock('../middleware/plan', () => ({ planGate: () => (_r, _s, n) => n() }));
jest.mock('../utils/archival', () => ({ isYearArchived: jest.fn().mockResolvedValue(false) }));

const reportCardsRouter = require('../routes/report-cards');
const { LAYOUTS } = require('../utils/report-layouts');

function makeSpyDoc() {
  const calls = [];
  const spy = { page: { width: 595.28, height: 841.89 } };
  const methods = [
    'addPage', 'rect', 'roundedRect', 'circle', 'fill', 'stroke', 'fillColor', 'fontSize',
    'font', 'text', 'image', 'save', 'translate', 'rotate', 'fillOpacity', 'restore', 'moveTo', 'lineTo',
    'registerFont', 'lineWidth',
    // Logo watermark — doc.opacity() scopes to image draws too, unlike
    // fillOpacity (text-only).
    'opacity',
  ];
  for (const m of methods) {
    spy[m] = (...args) => { calls.push({ method: m, args }); return spy; };
  }
  spy.heightOfString = (text, opts = {}) => {
    const width = opts.width || 400;
    const charsPerLine = Math.max(10, Math.floor(width / 5));
    const lines = Math.max(1, Math.ceil(String(text ?? '').length / charsPerLine));
    return lines * 12;
  };
  return { spy, calls };
}

function baseSnap(overrides = {}) {
  return {
    status: 'published', superseded: false, version: 1,
    studentName: 'Jane Doe', admissionNo: 'ADM001', className: 'KG 2',
    streamName: 'East', academicYear: '2026', termNumber: 2, schoolName: 'Test School',
    kgSubjects: [{ name: 'Literacy', indicators: [{ text: 'Recognises letters', bandLabel: 'Proficient', bandGrade: 'P' }] }],
    comments: {
      classTeacherName: 'Mrs. Otieno', principalName: 'Dr. Kariuki',
      classTeacherRemark: 'Settling in well.', principalRemark: 'A pleasure to have in school.',
    },
    ...overrides,
  };
}

function computeSections(snapOverrides = {}, config = {}, extra = {}) {
  return reportCardsRouter._computeKgReportSections(baseSnap(snapOverrides), config, extra);
}

describe('kindergarten.renderPdf — remark text honours its toggle; name/signature do not', () => {
  test('both boxes draw by default (showClassTeacherRemark/showPrincipalRemark default true)', () => {
    const { spy, calls } = makeSpyDoc();
    LAYOUTS.kindergarten.renderPdf(spy, computeSections(), {}, true);
    const texts = calls.filter(c => c.method === 'text').map(c => c.args[0]);
    expect(texts).toContain('Settling in well.');
    expect(texts).toContain('A pleasure to have in school.');
    expect(texts).toContain('Mrs. Otieno');
    expect(texts).toContain('Dr. Kariuki');
  });

  test('turning Principal\'s Comment off removes the text but keeps the name', () => {
    const { spy, calls } = makeSpyDoc();
    const sections = computeSections({}, { showPrincipalRemark: false });
    LAYOUTS.kindergarten.renderPdf(spy, sections, {}, true);
    const texts = calls.filter(c => c.method === 'text').map(c => c.args[0]);
    expect(texts).not.toContain('A pleasure to have in school.');
    expect(texts).toContain('Dr. Kariuki');
    // Class teacher's box is untouched by the other toggle.
    expect(texts).toContain('Settling in well.');
  });

  test('turning Class Teacher\'s Remark off removes only that text, keeping their name', () => {
    const { spy, calls } = makeSpyDoc();
    const sections = computeSections({}, { showClassTeacherRemark: false });
    LAYOUTS.kindergarten.renderPdf(spy, sections, {}, true);
    const texts = calls.filter(c => c.method === 'text').map(c => c.args[0]);
    expect(texts).not.toContain('Settling in well.');
    expect(texts).toContain('Mrs. Otieno');
    expect(texts).toContain('A pleasure to have in school.');
  });
});

describe('kindergarten.renderHtml — remark text honours its toggle; name/signature do not', () => {
  test('both render by default', () => {
    const html = LAYOUTS.kindergarten.renderHtml(computeSections());
    expect(html).toContain('Settling in well.');
    expect(html).toContain('A pleasure to have in school.');
  });

  test('each toggle independently removes its own TEXT, not the other\'s, and not either name', () => {
    const onlyPrincipalText = LAYOUTS.kindergarten.renderHtml(computeSections({}, { showClassTeacherRemark: false }));
    expect(onlyPrincipalText).not.toContain('Settling in well.');
    expect(onlyPrincipalText).toContain('A pleasure to have in school.');
    expect(onlyPrincipalText).toContain('Mrs. Otieno');

    const onlyClassTeacherText = LAYOUTS.kindergarten.renderHtml(computeSections({}, { showPrincipalRemark: false }));
    expect(onlyClassTeacherText).toContain('Settling in well.');
    expect(onlyClassTeacherText).not.toContain('A pleasure to have in school.');
    expect(onlyClassTeacherText).toContain('Dr. Kariuki');
  });

  test('both off removes both comment texts and banners, but both names still show', () => {
    const html = LAYOUTS.kindergarten.renderHtml(
      computeSections({}, { showClassTeacherRemark: false, showPrincipalRemark: false })
    );
    expect(html).not.toContain('Settling in well.');
    expect(html).not.toContain('A pleasure to have in school.');
    expect(html).not.toContain("'s General Comment");
    expect(html).toContain('Mrs. Otieno');
    expect(html).toContain('Dr. Kariuki');
  });

  test('no name and both toggles off means no block at all — nothing to attribute it to and nothing enabled', () => {
    const html = LAYOUTS.kindergarten.renderHtml(
      computeSections(
        { comments: { classTeacherName: '', principalName: '', classTeacherRemark: '', principalRemark: '' } },
        { showClassTeacherRemark: false, showPrincipalRemark: false },
      )
    );
    expect(html).not.toContain("'s General Comment");
  });
});

describe('kindergarten — faint school-logo watermark ("for every school")', () => {
  // No assessment-type key here — Kindergarten uses competency bands,
  // not CA/HW/MT/ET, so that section doesn't apply to this layout.
  test('renders a low-opacity, centered <img> when the school has a logo on file', () => {
    const html = LAYOUTS.kindergarten.renderHtml(computeSections({}, {}, { school: { logoUrl: 'https://cdn.example/logo.png' } }));
    expect(html).toMatch(/<img src="https:\/\/cdn\.example\/logo\.png" alt="" style="position:fixed;[^"]*opacity:0\.07[^"]*"/);
  });

  test('no logo on file is a silent no-op', () => {
    const html = LAYOUTS.kindergarten.renderHtml(computeSections());
    expect(html).not.toMatch(/opacity:0\.07/);
  });

  test('PDF renderer draws the logo image when images.schoolLogo is a real buffer, skips it otherwise', () => {
    const sections = computeSections();
    const withLogo = makeSpyDoc();
    LAYOUTS.kindergarten.renderPdf(withLogo.spy, sections, { schoolLogo: Buffer.from('fake-image') }, true);
    expect(withLogo.calls.some(c => c.method === 'image')).toBe(true);

    const withoutLogo = makeSpyDoc();
    LAYOUTS.kindergarten.renderPdf(withoutLogo.spy, sections, {}, true);
    expect(withoutLogo.calls.some(c => c.method === 'image')).toBe(false);
  });
});
