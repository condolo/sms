/* ============================================================
   server/utils/report-layouts.js — kindergarten renderer

   Reported directly: turning off Ranking or Principal's Comment in
   Report Card settings should mean the block never appears, not even
   blank. The non-KG layouts (legacy_tabular, subject_paired, marks_
   then_comments) already honour showClassTeacherRemark/showPrincipal
   Remark via _computeReportSections — the KG path never read either
   flag at all. _computeKgReportSections only ever hid a remark block
   when its text happened to be empty, so a KG report with an already-
   written principal comment kept showing it even after the school
   turned the setting off. Ranking has no KG equivalent to begin with
   (no rank/GPA concept for a competency-band report) — nothing to gate
   there, confirmed by _computeKgReportSections never emitting a rank
   field at all.
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

describe('kindergarten.renderPdf — remark boxes honour their toggles, not just text presence', () => {
  test('both boxes draw by default (showClassTeacherRemark/showPrincipalRemark default true)', () => {
    const { spy, calls } = makeSpyDoc();
    LAYOUTS.kindergarten.renderPdf(spy, computeSections(), {}, true);
    const texts = calls.filter(c => c.method === 'text').map(c => c.args[0]);
    expect(texts).toContain('Settling in well.');
    expect(texts).toContain('A pleasure to have in school.');
  });

  test('turning Principal\'s Comment off removes it even though real text was already written', () => {
    const { spy, calls } = makeSpyDoc();
    const sections = computeSections({}, { showPrincipalRemark: false });
    LAYOUTS.kindergarten.renderPdf(spy, sections, {}, true);
    const texts = calls.filter(c => c.method === 'text').map(c => c.args[0]);
    expect(texts).not.toContain('A pleasure to have in school.');
    // Class teacher's box is untouched by the other toggle.
    expect(texts).toContain('Settling in well.');
  });

  test('turning Class Teacher\'s Remark off removes only that box', () => {
    const { spy, calls } = makeSpyDoc();
    const sections = computeSections({}, { showClassTeacherRemark: false });
    LAYOUTS.kindergarten.renderPdf(spy, sections, {}, true);
    const texts = calls.filter(c => c.method === 'text').map(c => c.args[0]);
    expect(texts).not.toContain('Settling in well.');
    expect(texts).toContain('A pleasure to have in school.');
  });
});

describe('kindergarten.renderHtml — remark boxes honour their toggles, not just text presence', () => {
  test('both render by default', () => {
    const html = LAYOUTS.kindergarten.renderHtml(computeSections());
    expect(html).toContain('Settling in well.');
    expect(html).toContain('A pleasure to have in school.');
  });

  test('each toggle independently removes its own block, not both, with no blank box left behind', () => {
    const onlyPrincipal = LAYOUTS.kindergarten.renderHtml(computeSections({}, { showClassTeacherRemark: false }));
    expect(onlyPrincipal).not.toContain('Settling in well.');
    expect(onlyPrincipal).toContain('A pleasure to have in school.');

    const onlyClassTeacher = LAYOUTS.kindergarten.renderHtml(computeSections({}, { showPrincipalRemark: false }));
    expect(onlyClassTeacher).toContain('Settling in well.');
    expect(onlyClassTeacher).not.toContain('A pleasure to have in school.');
  });

  test('both off removes both blocks entirely, text that was already written included', () => {
    const html = LAYOUTS.kindergarten.renderHtml(
      computeSections({}, { showClassTeacherRemark: false, showPrincipalRemark: false })
    );
    expect(html).not.toContain('Settling in well.');
    expect(html).not.toContain('A pleasure to have in school.');
    expect(html).not.toContain("'s General Comment");
  });
});
