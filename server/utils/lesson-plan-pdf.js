/* ============================================================
   Msingi — Lesson Plan PDF Rendering (Trinitas + Trinity, 2026-09)

   Mirrors payslip-engine.js's IR/adapter split:
     _computeLessonPlanSections — pure function, plan doc + school →
       plain-data description of every section, zero pdfkit calls.
     _drawLessonPlanPage        — the one adapter that walks that data
       and makes the actual pdfkit drawing calls.
     _buildLessonPlanPDF        — thin wrapper combining both, the
       only export the route calls directly.

   Unlike a payslip, this is NOT a frozen historical snapshot — the
   school's current name/logo is fetched live at render time (an
   unpublished planning document has no "this was official as of X"
   moment to preserve), which is why _buildLessonPlanPDF takes the
   already-fetched logo buffer rather than a URL: fetching is I/O,
   kept out of the pure section-computation step same as report-
   cards.js keeps _fetchImageBuf separate from its layout code.
   ============================================================ */
'use strict';

/* Decode a URL or data: URI to a Buffer. Non-fatal — returns null on any
   error, mirroring report-cards.js's own _fetchImageBuf exactly (kept as
   a local copy rather than a cross-import — both files are self-contained
   rendering engines by design, same as payslip-engine.js never imports
   report-layouts.js). */
async function fetchImageBuf(url) {
  if (!url) return null;
  if (url.startsWith('data:')) {
    const b64 = url.split(',')[1];
    return b64 ? Buffer.from(b64, 'base64') : null;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) return null;
  return new Promise((resolve) => {
    const mod = url.startsWith('https://') ? require('https') : require('http');
    const req = mod.get(url, { timeout: 5000 }, resp => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => resolve(Buffer.concat(chunks)));
      resp.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function _fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

/**
 * Pure function: lesson plan doc + school → plain-data section description.
 */
function _computeLessonPlanSections(plan, school) {
  const topicLine = plan.subtopicTitle ? `${plan.topicTitle} — ${plan.subtopicTitle}` : (plan.topicTitle || '—');
  const classLine = plan.streamName ? `${plan.className} (${plan.streamName})` : (plan.className || '—');

  return {
    header: {
      schoolName: school?.name || 'School',
      title: 'LESSON PLAN',
    },
    meta: [
      [{ label: 'Teacher', value: plan.teacherName || '—' }, { label: 'Week', value: plan.weekStart ? `Week of ${_fmtDate(plan.weekStart)}` : '—' }, { label: 'Term & Year', value: plan.termYearLabel || '—' }],
      [{ label: 'Subject', value: plan.subjectName || '—' }, { label: 'Date', value: _fmtDate(plan.date) }, { label: 'Class', value: classLine }],
    ],
    lesson: [
      { label: 'Topic / Subtopic', value: topicLine },
      { label: 'Lesson Objectives', value: plan.objectives || '—' },
      { label: 'Learning Activities', value: plan.activities || '—' },
      { label: 'Resources / References', value: plan.resources || '—' },
      { label: 'Remarks', value: plan.remarks || '—' },
    ],
    differentiation: [
      { label: 'Low Ability', value: plan.differentiation?.low || '—' },
      { label: 'Middle Ability', value: plan.differentiation?.middle || '—' },
      { label: 'High Ability', value: plan.differentiation?.high || '—' },
    ],
    assessment: plan.assessment || '—',
    homework: plan.homework || '—',
    reflection: [
      { label: 'What went well', value: plan.reflection?.wentWell || '—' },
      { label: 'Even better if', value: plan.reflection?.betterIf || '—' },
      { label: 'Areas for improvement', value: plan.reflection?.improvement || '—' },
    ],
    footer: `Generated: ${new Date().toISOString().slice(0, 10)}   ·   Record ${plan.id}`,
  };
}

/* ── Drawing helpers ──────────────────────────────────────── */
const DARK = '#1a1a2e', ACCENT = '#2563eb', LIGHT_GRAY = '#f3f4f6', BORDER = '#d1d5db', GRAY = '#555555', INK = '#111827';

/** A labeled text block — label on its own line, value wrapped below,
    returns the y position after it. Height is driven by pdfkit's own
    text-wrapping (heightOfString), not a fixed guess, so long text never
    gets silently clipped. */
function _drawField(doc, x, y, width, label, value) {
  doc.fontSize(8).font('Helvetica-Bold').fillColor(ACCENT).text(label.toUpperCase(), x, y, { width });
  y += 12;
  doc.fontSize(9.5).font('Helvetica').fillColor(INK);
  const h = doc.heightOfString(value, { width });
  doc.text(value, x, y, { width });
  return y + h + 10;
}

/** Same field, laid out across N equal columns on one row — used for
    Differentiation (3 cols) and Reflection (3 cols). Returns y after the
    tallest column, so uneven text lengths never overlap the next section. */
function _drawColumns(doc, x, y, totalWidth, fields) {
  const gap = 12;
  const colWidth = (totalWidth - gap * (fields.length - 1)) / fields.length;
  let maxBottom = y;
  fields.forEach((f, i) => {
    const colX = x + i * (colWidth + gap);
    const bottom = _drawField(doc, colX, y, colWidth, f.label, f.value);
    if (bottom > maxBottom) maxBottom = bottom;
  });
  return maxBottom;
}

function _sectionHeader(doc, x, y, width, text) {
  doc.rect(x, y, width, 16).fill(LIGHT_GRAY);
  doc.fontSize(8.5).font('Helvetica-Bold').fillColor(DARK).text(text.toUpperCase(), x + 6, y + 4, { width: width - 12 });
  return y + 22;
}

/**
 * The one adapter that draws the page. `images.schoolLogo` is an optional
 * Buffer — missing/failed fetch is drawn without it (see the try/catch),
 * same defensive posture report-layouts.js's signature/stamp images use.
 */
function _drawLessonPlanPage(doc, s, images = {}) {
  const PAGE_WIDTH = doc.page.width - 80;
  const x = 40;
  let y = 40;

  /* HEADER */
  doc.rect(x, y, PAGE_WIDTH, 50).fill(DARK);
  if (images.schoolLogo) {
    try { doc.image(images.schoolLogo, x + 10, y + 8, { fit: [34, 34] }); } catch { /* non-fatal */ }
  }
  const textX = images.schoolLogo ? x + 54 : x + 10;
  doc.fillColor('white').fontSize(15).font('Helvetica-Bold').text(s.header.schoolName, textX, y + 10, { width: PAGE_WIDTH - (textX - x) - 10 });
  doc.fontSize(10).font('Helvetica').text(s.header.title, textX, y + 30, { width: PAGE_WIDTH - (textX - x) - 10 });
  y += 62;

  /* META ROWS (Teacher/Week/Term, Subject/Date/Class) */
  s.meta.forEach(row => {
    doc.rect(x, y, PAGE_WIDTH, 30).fill('#f9fafb').stroke(BORDER);
    const colWidth = PAGE_WIDTH / row.length;
    row.forEach((f, i) => {
      const colX = x + i * colWidth + 6;
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(GRAY).text(f.label.toUpperCase(), colX, y + 5, { width: colWidth - 12 });
      doc.fontSize(9.5).font('Helvetica').fillColor(INK).text(f.value, colX, y + 16, { width: colWidth - 12 });
    });
    y += 34;
  });
  y += 6;

  /* LESSON CONTENT */
  y = _sectionHeader(doc, x, y, PAGE_WIDTH, 'Lesson');
  s.lesson.forEach(f => { y = _drawField(doc, x, y, PAGE_WIDTH, f.label, f.value); });
  y += 4;

  /* DIFFERENTIATION */
  y = _sectionHeader(doc, x, y, PAGE_WIDTH, 'Differentiation');
  y = _drawColumns(doc, x, y, PAGE_WIDTH, s.differentiation);
  y += 4;

  /* ASSESSMENT & EVALUATION */
  y = _sectionHeader(doc, x, y, PAGE_WIDTH, 'Assessment & Evaluation');
  y = _drawField(doc, x, y, PAGE_WIDTH, 'Assessment & Evaluation', s.assessment);

  /* HOMEWORK */
  y = _sectionHeader(doc, x, y, PAGE_WIDTH, 'Lesson / Week Assignment');
  y = _drawField(doc, x, y, PAGE_WIDTH, 'Lesson / Week Assignment', s.homework);

  /* REFLECTION */
  y = _sectionHeader(doc, x, y, PAGE_WIDTH, 'Reflection');
  y = _drawColumns(doc, x, y, PAGE_WIDTH, s.reflection);
  y += 10;

  /* FOOTER */
  doc.fontSize(7.5).font('Helvetica').fillColor(GRAY).text(s.footer, x, y, { width: PAGE_WIDTH });
}

/** Thin wrapper — the only export the route calls directly. */
function _buildLessonPlanPDF(doc, plan, school, images) {
  const sections = _computeLessonPlanSections(plan, school);
  _drawLessonPlanPage(doc, sections, images);
}

module.exports = { fetchImageBuf, _computeLessonPlanSections, _drawLessonPlanPage, _buildLessonPlanPDF };
