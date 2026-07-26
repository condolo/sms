/* ============================================================
   server/utils/report-layouts.js — subject_paired renderer (RCE3)

   Builds real IR via report-cards.js's _computeReportSections (same
   integration point every other renderer test uses) and feeds it into
   LAYOUTS.subject_paired, rather than hand-building a sections object
   that could drift from the real shape. Covers: the two-page structure
   (cover then academic content), the per-subject comment-row pairing,
   and every RCE1 toggle actually changing this renderer's output
   (unlike legacy_tabular, which ignores them by design).
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
  ];
  for (const m of methods) {
    spy[m] = (...args) => { calls.push({ method: m, args }); return spy; };
  }
  // RCE3b — _measureFlowBox/_drawFlowBox call doc.heightOfString() to size
  // boxes dynamically; a rough chars-per-line estimate is enough for a
  // structural test (exact pixel height isn't asserted anywhere here).
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
    studentName: 'Jane Doe', admissionNo: 'ADM001', className: 'Grade 7',
    streamName: 'East', houseName: 'Red House',
    termName: 'Term 2', academicYear: '2026', termNumber: 2, schoolName: 'Test School',
    studentPhotoUrl: null,
    assessmentWeights: [{ assessmentType: 'cat', label: 'CAT', weight: 40 }, { assessmentType: 'exam', label: 'Exam', weight: 60 }],
    gradingSchema: [{ min: 0, grade: 'A', points: 12, label: 'Excellent' }],
    subjects: {
      math: { finalScore: 85, grade: 'A', breakdown: { cat: 80, exam: 88 }, remarks: 'Excellent work' },
      english: { finalScore: 55, grade: 'C', breakdown: { cat: 50, exam: 58 } },
    },
    totalScore: 140, averageScore: 70, gpa: 3.2,
    rankings: { class: { rank: 2, outOf: 30 } },
    comments: {
      classTeacherName: 'Mrs. Otieno', principalName: 'Dr. Kariuki',
      classTeacherRemark: 'Good progress this term.', principalRemark: 'Keep it up.',
      subjectComments: { math: 'Strong grasp of algebra.', english: 'Needs more reading practice.' },
    },
    ...overrides,
  };
}

function computeSections(snapOverrides = {}, config = {}, extra = {}) {
  return reportCardsRouter._computeReportSections(
    baseSnap(snapOverrides), { rankingEnabled: true, ...config }, null,
    { subjectTeacherCommentsEnabled: true, ...extra }
  );
}

describe('subject_paired.renderPdf — structure', () => {
  test('draws a cover page then addPage()s into a separate academic page', () => {
    const { spy, calls } = makeSpyDoc();
    const sections = computeSections();
    LAYOUTS.subject_paired.renderPdf(spy, sections, {}, true);
    const addPageCalls = calls.filter(c => c.method === 'addPage');
    // isFirstPage=true means no leading addPage for the outer per-student
    // break, but the cover->academic transition inside this layout must
    // always addPage() exactly once.
    expect(addPageCalls.length).toBe(1);
  });

  test('isFirstPage=false adds one extra leading page (outer per-student break) plus the internal cover->academic break', () => {
    const { spy, calls } = makeSpyDoc();
    const sections = computeSections();
    LAYOUTS.subject_paired.renderPdf(spy, sections, {}, false);
    expect(calls.filter(c => c.method === 'addPage').length).toBe(2);
  });

  test('does not throw when nothing optional is configured (no photo, no behaviour, no attendance)', () => {
    const { spy } = makeSpyDoc();
    const sections = computeSections();
    expect(() => LAYOUTS.subject_paired.renderPdf(spy, sections, {}, true)).not.toThrow();
  });

  test('draws a Dev column value only when showDeviation is true', () => {
    const withDev = computeSections({}, {}, { deviations: { subjects: { math: 3.4 } } });
    const { spy: spy1, calls: calls1 } = makeSpyDoc();
    LAYOUTS.subject_paired.renderPdf(spy1, withDev, {}, true);
    expect(calls1.some(c => c.method === 'text' && c.args[0] === '+3.4')).toBe(true);

    const withoutDev = computeSections({}, { showDeviation: false }, { deviations: { subjects: { math: 3.4 } } });
    const { spy: spy2, calls: calls2 } = makeSpyDoc();
    LAYOUTS.subject_paired.renderPdf(spy2, withoutDev, {}, true);
    expect(calls2.some(c => c.method === 'text' && c.args[0] === '+3.4')).toBe(false);
  });

  test('omits the class-teacher/principal remark blocks when their show flags are false', () => {
    const shown  = computeSections();
    const hidden = computeSections({}, { showClassTeacherRemark: false, showPrincipalRemark: false });

    const { spy: spy1, calls: calls1 } = makeSpyDoc();
    LAYOUTS.subject_paired.renderPdf(spy1, shown, {}, true);
    expect(calls1.some(c => c.method === 'text' && c.args[0] === 'Good progress this term.')).toBe(true);

    const { spy: spy2, calls: calls2 } = makeSpyDoc();
    LAYOUTS.subject_paired.renderPdf(spy2, hidden, {}, true);
    expect(calls2.some(c => c.method === 'text' && c.args[0] === 'Good progress this term.')).toBe(false);
    expect(calls2.some(c => c.method === 'text' && c.args[0] === 'Keep it up.')).toBe(false);
  });

  test('omits per-subject comment rows entirely when subjectTeacherCommentsEnabled is false', () => {
    const sections = computeSections({}, {}, { subjectTeacherCommentsEnabled: false });
    const { spy, calls } = makeSpyDoc();
    LAYOUTS.subject_paired.renderPdf(spy, sections, {}, true);
    expect(calls.some(c => c.method === 'text' && String(c.args[0]).includes('Strong grasp of algebra'))).toBe(false);
    expect(calls.some(c => c.method === 'text' && c.args[0] === 'Teacher comment:')).toBe(false);
  });
});

describe('subject_paired.renderHtml — content', () => {
  test('is a well-formed HTML document containing the cover and academic sections', () => {
    const html = LAYOUTS.subject_paired.renderHtml(computeSections());
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('REPORT CARD');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('East'); // streamName
    expect(html).toContain('Red House'); // houseName
  });

  test('each subject comment appears immediately after that subject\'s own marks row (Light International pairing)', () => {
    const html = LAYOUTS.subject_paired.renderHtml(computeSections());
    const mathIdx    = html.indexOf('math');
    const mathComment = html.indexOf('Strong grasp of algebra');
    const englishIdx  = html.indexOf('english');
    expect(mathComment).toBeGreaterThan(mathIdx);
    expect(mathComment).toBeLessThan(englishIdx); // math's comment renders before english's row starts
  });

  test('subject comments section is entirely absent when subjectTeacherCommentsEnabled is false', () => {
    const html = LAYOUTS.subject_paired.renderHtml(computeSections({}, {}, { subjectTeacherCommentsEnabled: false }));
    expect(html).not.toContain('Teacher Comment');
    expect(html).not.toContain('Strong grasp of algebra');
  });

  test('remark blocks respect showClassTeacherRemark/showPrincipalRemark independently', () => {
    const onlyPrincipal = computeSections({}, { showClassTeacherRemark: false });
    const html = LAYOUTS.subject_paired.renderHtml(onlyPrincipal);
    expect(html).not.toContain('Good progress this term.');
    expect(html).toContain('Keep it up.');
  });

  test('school contact details render on the cover when present, are omitted when absent (RCE3b)', () => {
    const withContact = LAYOUTS.subject_paired.renderHtml(
      computeSections({}, {}, { school: { logoUrl: null, tagline: 'Excellence', address: '123 Main St', phone: '0700-000000', email: 'info@school.ac.ke', website: 'school.ac.ke' } })
    );
    expect(withContact).toContain('123 Main St');
    expect(withContact).toContain('0700-000000');
    expect(withContact).toContain('info@school.ac.ke');

    const withoutContact = LAYOUTS.subject_paired.renderHtml(computeSections());
    expect(withoutContact).not.toContain('undefined');
  });
});

describe('subject_paired.renderPdf — RCE3b dynamic box sizing', () => {
  test('a longer teacher comment produces a taller comment box than a short one', () => {
    const short = computeSections({ comments: { classTeacherName: 'Mrs. Otieno', principalName: 'Dr. Kariuki', subjectComments: { math: 'Good.', english: 'OK.' } } });
    const long  = computeSections({ comments: { classTeacherName: 'Mrs. Otieno', principalName: 'Dr. Kariuki', subjectComments: {
      math: 'This is a much longer comment that should wrap across several lines and therefore require a visibly taller comment box than a one-word remark would need, proving the box height is measured from the actual text rather than a fixed constant.',
      english: 'OK.',
    } } });

    const { spy: spy1, calls: calls1 } = makeSpyDoc();
    LAYOUTS.subject_paired.renderPdf(spy1, short, {}, true);
    const { spy: spy2, calls: calls2 } = makeSpyDoc();
    LAYOUTS.subject_paired.renderPdf(spy2, long, {}, true);

    // Everything before the (single, isFirstPage=true) addPage() call is
    // the cover page — skip it. On the academic page, rect #0 is math's
    // marks row (fixed 18px), rect #1 is math's comment box.
    function academicRects(calls) {
      const addPageIdx = calls.findIndex(c => c.method === 'addPage');
      return calls.slice(addPageIdx + 1).filter(c => c.method === 'rect');
    }
    const rects1 = academicRects(calls1);
    const rects2 = academicRects(calls2);
    // rect #0 is the header band (fixed 40px); #1 is math's marks row
    // (fixed 18px); #2 is math's comment box — the one that should differ.
    expect(rects1[1].args[3]).toBe(18); // sanity: this really is the marks row
    expect(rects2[2].args[3]).toBeGreaterThan(rects1[2].args[3]);
  });

  test('the class-teacher remark box grows to fit a long remark instead of a fixed 28px height', () => {
    const sections = computeSections({
      comments: {
        classTeacherName: 'Mrs. Otieno', principalName: 'Dr. Kariuki',
        classTeacherRemark: 'A very long class teacher remark spanning multiple sentences to force text wrapping across several lines inside the remark box, which must grow to accommodate it rather than clipping or overflowing past a fixed height.',
        principalRemark: 'Fine.',
      },
    });
    const { spy, calls } = makeSpyDoc();
    LAYOUTS.subject_paired.renderPdf(spy, sections, {}, true);
    // Skip the cover page (its photo placeholder is >100px tall, which
    // would trivially satisfy a loose ">28" check on the whole document).
    const addPageIdx = calls.findIndex(c => c.method === 'addPage');
    const academicRectHeights = calls.slice(addPageIdx + 1).filter(c => c.method === 'rect').map(c => c.args[3]);
    // Fixed heights already present on this page: 18 (marks rows), 32
    // (summary bar) — a genuinely measured long-remark box must clear
    // both by a real margin, not just "bigger than a small constant".
    expect(academicRectHeights.some(h => h > 40)).toBe(true);
  });
});
