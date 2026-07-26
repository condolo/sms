/* ============================================================
   server/utils/report-layouts.js — marks_then_comments renderer (RCE4)

   Same integration approach as report-layouts-subject-paired.test.js:
   real IR via report-cards.js's _computeReportSections fed into
   LAYOUTS.marks_then_comments. Covers: the three-page structure (cover
   / marks+grading-key / comments+remarks+behaviour), that no per-subject
   comment appears on the marks page (the defining difference from
   subject_paired), the restated "{Subject} — {Teacher}:" comment label,
   and the same RCE1 toggles/RCE3c header conventions subject_paired
   already respects.
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

describe('marks_then_comments.renderPdf — structure', () => {
  test('draws cover -> marks page -> comments page: two addPage()s when isFirstPage=true', () => {
    const { spy, calls } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy, computeSections(), {}, true);
    expect(calls.filter(c => c.method === 'addPage').length).toBe(2);
  });

  test('isFirstPage=false adds one extra leading page (outer per-student break)', () => {
    const { spy, calls } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy, computeSections(), {}, false);
    expect(calls.filter(c => c.method === 'addPage').length).toBe(3);
  });

  test('does not throw when nothing optional is configured', () => {
    const { spy } = makeSpyDoc();
    expect(() => LAYOUTS.marks_then_comments.renderPdf(spy, computeSections(), {}, true)).not.toThrow();
  });

  test('no per-subject comment text appears on the marks page — only after the second addPage (the defining difference from subject_paired)', () => {
    const { spy, calls } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy, computeSections(), {}, true);
    const addPageIdxs = calls.reduce((acc, c, i) => { if (c.method === 'addPage') acc.push(i); return acc; }, []);
    const marksPageCalls = calls.slice(addPageIdxs[0] + 1, addPageIdxs[1]);
    expect(marksPageCalls.some(c => c.method === 'text' && String(c.args[0]).includes('Strong grasp of algebra'))).toBe(false);
    const commentsPageCalls = calls.slice(addPageIdxs[1] + 1);
    expect(commentsPageCalls.some(c => c.method === 'text' && String(c.args[0]).includes('Strong grasp of algebra'))).toBe(true);
  });

  test('draws a Dev column value only when showDeviation is true', () => {
    const withDev = computeSections({}, {}, { deviations: { subjects: { math: 3.4 } } });
    const { spy: spy1, calls: calls1 } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy1, withDev, {}, true);
    expect(calls1.some(c => c.method === 'text' && c.args[0] === '+3.4')).toBe(true);

    const withoutDev = computeSections({}, { showDeviation: false }, { deviations: { subjects: { math: 3.4 } } });
    const { spy: spy2, calls: calls2 } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy2, withoutDev, {}, true);
    expect(calls2.some(c => c.method === 'text' && c.args[0] === '+3.4')).toBe(false);
  });

  test('omits the class-teacher/principal remark blocks when their show flags are false', () => {
    const { spy: spy1, calls: calls1 } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy1, computeSections(), {}, true);
    expect(calls1.some(c => c.method === 'text' && c.args[0] === 'Good progress this term.')).toBe(true);

    const { spy: spy2, calls: calls2 } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy2, computeSections({}, { showClassTeacherRemark: false, showPrincipalRemark: false }), {}, true);
    expect(calls2.some(c => c.method === 'text' && c.args[0] === 'Good progress this term.')).toBe(false);
    expect(calls2.some(c => c.method === 'text' && c.args[0] === 'Keep it up.')).toBe(false);
  });

  test('omits subject comments entirely when subjectTeacherCommentsEnabled is false', () => {
    const { spy, calls } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy, computeSections({}, {}, { subjectTeacherCommentsEnabled: false }), {}, true);
    expect(calls.some(c => c.method === 'text' && String(c.args[0]).includes('Strong grasp of algebra'))).toBe(false);
  });

  test('the marks table column headers use the assessment type KEY, headed AVG not Score', () => {
    const { spy, calls } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy, computeSections(), {}, true);
    expect(calls.some(c => c.method === 'text' && c.args[0] === 'cat')).toBe(true);
    expect(calls.some(c => c.method === 'text' && c.args[0] === 'exam')).toBe(true);
    expect(calls.some(c => c.method === 'text' && c.args[0] === 'AVG')).toBe(true);
    expect(calls.some(c => c.method === 'text' && c.args[0] === 'Score')).toBe(false);
  });

  test('labels each subject comment "{Subject} — {Teacher}:" when a teacher is known, a generic fallback otherwise', () => {
    const withTeacher = computeSections({}, {}, { subjectTeacherNames: { math: 'Collins Ndolo' } });
    const { spy: spy1, calls: calls1 } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy1, withTeacher, {}, true);
    expect(calls1.some(c => c.method === 'text' && c.args[0] === 'math — Collins Ndolo:')).toBe(true);

    const withoutTeacher = computeSections();
    const { spy: spy2, calls: calls2 } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy2, withoutTeacher, {}, true);
    expect(calls2.some(c => c.method === 'text' && c.args[0] === 'english — Subject Teacher:')).toBe(true);
  });

  test('draws behaviour tiles when behaviour data is present', () => {
    const sections = computeSections({}, {}, { behaviour: { merits: 5, demerits: 1, points: 4, total: 6 } });
    const { spy, calls } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy, sections, {}, true);
    expect(calls.some(c => c.method === 'text' && c.args[0] === 'BEHAVIOUR')).toBe(true);
    expect(calls.some(c => c.method === 'text' && c.args[0] === '5')).toBe(true);
  });
});

describe('marks_then_comments.renderHtml — content', () => {
  test('is a well-formed HTML document containing the cover, marks and comments sections', () => {
    const html = LAYOUTS.marks_then_comments.renderHtml(computeSections());
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('REPORT CARD');
    expect(html).toContain('Jane Doe');
    expect(html).toContain('East'); // streamName
    expect(html).toContain('Red House'); // houseName
    expect(html).toContain('Academic Results');
    expect(html).toContain('Teacher Comments');
  });

  test('the marks table renders no per-subject comment text; comments appear only in the later Subject Teacher Comments table', () => {
    const html = LAYOUTS.marks_then_comments.renderHtml(computeSections());
    const marksHeadingIdx    = html.indexOf('Academic Results');
    const commentsHeadingIdx = html.indexOf('Teacher Comments');
    const commentIdx         = html.indexOf('Strong grasp of algebra');
    expect(commentIdx).toBeGreaterThan(commentsHeadingIdx);
    expect(commentIdx).toBeGreaterThan(marksHeadingIdx);
  });

  test('subject comments table shows Subject | Teacher | Comment columns with the real teacher name', () => {
    const html = LAYOUTS.marks_then_comments.renderHtml(computeSections({}, {}, { subjectTeacherNames: { math: 'Collins Ndolo' } }));
    expect(html).toContain('Collins Ndolo');
    expect(html).toContain('Unassigned'); // english has no assignment in this fixture
  });

  test('subject comments section is entirely absent when subjectTeacherCommentsEnabled is false', () => {
    const html = LAYOUTS.marks_then_comments.renderHtml(computeSections({}, {}, { subjectTeacherCommentsEnabled: false }));
    expect(html).not.toContain('Subject Teacher Comments');
    expect(html).not.toContain('Strong grasp of algebra');
  });

  test('renders a column-header row with the assessment type KEY and AVG, not the full-word label or "Score"', () => {
    const html = LAYOUTS.marks_then_comments.renderHtml(computeSections());
    expect(html).toContain('>cat<');
    expect(html).toContain('>exam<');
    expect(html).toContain('>AVG<');
    expect(html).not.toContain('>Score<');
  });

  test('remark blocks respect showClassTeacherRemark/showPrincipalRemark independently', () => {
    const html = LAYOUTS.marks_then_comments.renderHtml(computeSections({}, { showClassTeacherRemark: false }));
    expect(html).not.toContain('Good progress this term.');
    expect(html).toContain('Keep it up.');
  });

  test('behaviour tiles render when behaviour data is present', () => {
    const html = LAYOUTS.marks_then_comments.renderHtml(computeSections({}, {}, { behaviour: { merits: 5, demerits: 1, points: 4, total: 6 } }));
    expect(html).toContain('Merits');
    expect(html).toContain('>5<');
  });

  test('school contact details render on the shared cover when present (RCE3b cover reused by RCE4)', () => {
    const html = LAYOUTS.marks_then_comments.renderHtml(
      computeSections({}, {}, { school: { logoUrl: null, tagline: 'Excellence', address: '123 Main St', phone: '0700-000000', email: 'info@school.ac.ke', website: 'school.ac.ke' } })
    );
    expect(html).toContain('123 Main St');
    expect(html).toContain('0700-000000');
  });
});

describe('marks_then_comments.renderPdf — dynamic comment box sizing', () => {
  test('a longer subject comment produces a taller flow box than a short one', () => {
    const short = computeSections({ comments: { classTeacherName: 'Mrs. Otieno', principalName: 'Dr. Kariuki', subjectComments: { math: 'Good.', english: 'OK.' } } });
    const long  = computeSections({ comments: { classTeacherName: 'Mrs. Otieno', principalName: 'Dr. Kariuki', subjectComments: {
      math: 'This is a much longer comment that should wrap across several lines and therefore require a visibly taller comment box than a one-word remark would need, proving the box height is measured from the actual text rather than a fixed constant.',
      english: 'OK.',
    } } });

    function commentsPageRectHeights(calls) {
      const addPageIdxs = calls.reduce((acc, c, i) => { if (c.method === 'addPage') acc.push(i); return acc; }, []);
      return calls.slice(addPageIdxs[1] + 1).filter(c => c.method === 'rect').map(c => c.args[3]);
    }
    const { spy: spy1, calls: calls1 } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy1, short, {}, true);
    const { spy: spy2, calls: calls2 } = makeSpyDoc();
    LAYOUTS.marks_then_comments.renderPdf(spy2, long, {}, true);

    const heights1 = commentsPageRectHeights(calls1);
    const heights2 = commentsPageRectHeights(calls2);
    // rect #0 on the comments page is the fixed 40px page-header band
    // (drawTitleHeader); rect #1 is math's comment box, drawn by
    // _drawFlowBox — the one that should differ between fixtures.
    expect(heights1[0]).toBe(40);
    expect(heights2[1]).toBeGreaterThan(heights1[1]);
  });
});
