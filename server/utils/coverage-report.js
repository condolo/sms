/* ============================================================
   Msingi — Lesson coverage export (v5.287.0)

   One teacher, or one class (optionally one stream): every teaching
   assignment with the same progress Lessons → Overview shows, and, when
   asked, each topic and subtopic with whether it was covered and when.

   Same rules as GET /lessons/summary, so the export and the screen never
   disagree:
     • topics of the subject for the class (plus topics saved before class
       scoping, which every class shows), for the academic year;
     • ticks that count for the row's stream (utils/topic-coverage.js);
     • whole-class ticks only: marks for individual students are not class
       progress;
     • leafProgress(): each subtopic is one item, so is a topic without one.

   Read-only. Formats: CSV (opens in Excel) and PDF (shared HTML renderer,
   PDFKit fallback when Chromium can't launch).
   ============================================================ */
'use strict';

const { tenantModel } = require('./tenant-model');
const { coverageStreamFilter, leafProgress } = require('./topic-coverage');

const CLASS_LEVEL = Object.freeze({ studentId: { $exists: false } });
const topicClassPart = (classId) => (classId ? { $or: [{ classId }, { classId: { $exists: false } }] } : {});

/**
 * Assignments saved without a teacher, class, subject or stream name (imports,
 * seed data) are named from their own records, the same way GET
 * /teaching-assignments names teachers (v5.270.0). A saved name is never
 * replaced. Best-effort: a failed lookup leaves the name blank, never fails.
 */
async function fillNames(ctx, schoolId, docs) {
  const missing = (idKey, nameKey) => [...new Set(docs.filter(d => !d[nameKey] && d[idKey]).map(d => d[idKey]))];
  const tIds = missing('teacherId', 'teacherName');
  const cIds = missing('classId', 'className');
  const sIds = missing('subjectId', 'subjectName');
  const stIds = missing('streamId', 'streamName');
  try {
    const [staff, classes, subjects, streams] = await Promise.all([
      tIds.length ? tenantModel('teachers', ctx).find({ schoolId, $or: [{ userId: { $in: tIds } }, { id: { $in: tIds } }] }).select('id userId title firstName lastName').lean() : [],
      cIds.length ? tenantModel('classes', ctx).find({ schoolId, id: { $in: cIds } }).select('id name').lean() : [],
      sIds.length ? tenantModel('subjects', ctx).find({ schoolId, id: { $in: sIds } }).select('id name').lean() : [],
      stIds.length ? tenantModel('streams', ctx).find({ schoolId, id: { $in: stIds } }).select('id name').lean() : [],
    ]);
    const teacherOf = new Map();
    for (const t of staff || []) {
      const n = [t.title, t.firstName, t.lastName].filter(Boolean).join(' ');
      if (t.userId) teacherOf.set(t.userId, n);
      if (t.id) teacherOf.set(t.id, n);
    }
    const nameMap = (list) => new Map((list || []).map(x => [x.id, x.name]));
    const maps = [['teacherId', 'teacherName', teacherOf], ['classId', 'className', nameMap(classes)], ['subjectId', 'subjectName', nameMap(subjects)], ['streamId', 'streamName', nameMap(streams)]];
    for (const d of docs) for (const [idKey, nameKey, m] of maps) if (!d[nameKey] && m.get(d[idKey])) d[nameKey] = m.get(d[idKey]);
  } catch (err) {
    console.error('[coverage-report] names (ignored):', err.message);
  }
  return docs;
}

/** Assignments a report covers. A stream report also lists the class's whole-class assignments. */
function assignmentFilter(schoolId, { teacherId, classId, streamId }) {
  if (teacherId) return { schoolId, teacherId };
  const f = { schoolId, classId };
  if (streamId) f.$or = [{ streamId }, { streamId: null }, { streamId: '' }];
  return f;
}

/**
 * @returns {Promise<{ rows: object[], academicYear: string }>}
 *   rows: { teacherName, className, streamName, wholeClass, subjectName, totalItems, coveredItems, pct, topics? }
 */
async function buildCoverageReport(ctx, schoolId, { teacherId, classId, streamId, academicYear, withTopics }) {
  const assignments = await tenantModel('teaching_assignments', ctx)
    .find(assignmentFilter(schoolId, { teacherId, classId, streamId })).lean();
  await fillNames(ctx, schoolId, assignments);

  const topicsFor = {};
  await Promise.all([...new Set(assignments.map(a => `${a.subjectId}__${a.classId}`))].map(async key => {
    const [sid, cid] = key.split('__');
    topicsFor[key] = await tenantModel('syllabus_topics', ctx)
      .find({ schoolId, subjectId: sid, academicYear, ...topicClassPart(cid) })
      .select('id title subtopics order createdAt').sort({ order: 1, createdAt: 1 }).lean();
  }));

  const rows = await Promise.all(assignments.map(async a => {
    const topics = topicsFor[`${a.subjectId}__${a.classId}`] || [];
    const ticks = await tenantModel('lesson_coverage', ctx).find({
      schoolId, classId: a.classId, subjectId: a.subjectId, academicYear,
      ...coverageStreamFilter(a.streamId), ...CLASS_LEVEL,
    }).select('topicId subtopicId streamId coveredAt').lean();
    const { totalItems, coveredItems } = leafProgress(topics, ticks);

    const row = {
      teacherName: a.teacherName || '(teacher not found)',
      className:   a.className || '(class not found)',
      streamName:  a.streamName || '',
      wholeClass:  !a.streamId,
      subjectName: a.subjectName || '(subject not found)',
      totalItems, coveredItems,
      pct: totalItems > 0 ? Math.round((coveredItems / totalItems) * 100) : 0,
    };

    if (withTopics) {
      // Date covered: the stream's own tick wins over the whole-class one, as on the teacher's screen.
      const at = {};
      for (const r of ticks) {
        const key = r.subtopicId ? `${r.topicId}__${r.subtopicId}` : r.topicId;
        if (!(key in at) || (r.streamId && a.streamId)) at[key] = r.coveredAt ?? null;
      }
      row.topics = topics.map(t => (t.subtopics?.length
        ? { title: t.title, items: t.subtopics.map(st => {
            const key = `${t.id}__${st.id}`;
            return { title: st.title, covered: key in at, coveredAt: at[key] ?? null };
          }) }
        : { title: t.title, items: null, covered: t.id in at, coveredAt: at[t.id] ?? null }));
    }
    return row;
  }));

  rows.sort((x, y) => (teacherId
    ? x.className.localeCompare(y.className) || x.streamName.localeCompare(y.streamName) || x.subjectName.localeCompare(y.subjectName)
    : x.subjectName.localeCompare(y.subjectName) || x.streamName.localeCompare(y.streamName) || x.teacherName.localeCompare(y.teacherName)));

  return { rows, academicYear };
}

const dateOf = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { timeZone: 'Africa/Nairobi' }) : '');
const streamLabel = (r) => (r.wholeClass ? 'Whole class' : r.streamName);
function totalsOf(rows) {
  const total = rows.reduce((n, r) => n + r.totalItems, 0);
  const covered = rows.reduce((n, r) => n + r.coveredItems, 0);
  return { total, covered, pct: total > 0 ? Math.round((covered / total) * 100) : 0 };
}

/* ── CSV ───────────────────────────────────────────────────────
   A cell starting with = + - @ (or tab/CR) is prefixed with ' so a name or
   topic can never run as a spreadsheet formula. */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv({ rows, academicYear }, { withTopics }) {
  const lines = [];
  if (!withTopics) {
    lines.push(['Teacher', 'Class', 'Stream', 'Subject', 'Items covered', 'Total items', 'Coverage %', 'Academic year']);
    for (const r of rows) lines.push([r.teacherName, r.className, streamLabel(r), r.subjectName, r.coveredItems, r.totalItems, r.totalItems ? r.pct : '', academicYear]);
  } else {
    lines.push(['Teacher', 'Class', 'Stream', 'Subject', 'Topic', 'Subtopic', 'Covered', 'Date covered', 'Subject coverage %', 'Academic year']);
    for (const r of rows) {
      const base = [r.teacherName, r.className, streamLabel(r), r.subjectName];
      if (!r.topics.length) lines.push([...base, '(no topics added)', '', '', '', '', academicYear]);
      for (const t of r.topics) {
        if (!t.items) lines.push([...base, t.title, '', t.covered ? 'Yes' : 'No', dateOf(t.coveredAt), r.pct, academicYear]);
        else for (const st of t.items) lines.push([...base, t.title, st.title, st.covered ? 'Yes' : 'No', dateOf(st.coveredAt), r.pct, academicYear]);
      }
    }
  }
  // BOM so Excel reads names with accents correctly.
  return '﻿' + lines.map(l => l.map(csvCell).join(',')).join('\r\n');
}

/* ── PDF (HTML, rendered by html-to-pdf.js) ─────────────────── */
const BRAND = '#1f2d3d';
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const thS = `border:1px solid #cbd5e1;padding:5px 8px;background:${BRAND};color:#fff;font-size:9.5px;text-transform:uppercase;letter-spacing:.3px;text-align:left`;
const tdS = 'border:1px solid #e2e8f0;padding:5px 8px;';
const tdR = 'border:1px solid #e2e8f0;padding:5px 8px;text-align:right;';

const NOTE = 'Same figures as Lessons → Overview. Each subtopic counts as one item, and so does a topic without subtopics. '
  + 'A tick for the whole class counts for every stream; a stream\'s own tick counts for that stream only. '
  + 'Marks for individual students are not included.';

function renderCoverageHtml({ by, school, scopeLabel, academicYear, rows, withTopics, generatedByName, generatedAt = new Date() }) {
  const schoolName = school?.name || 'School';
  const tot = totalsOf(rows);
  const byTeacher = by === 'teacher';

  const summaryRows = rows.map(r => `
    <tr>
      <td style="${tdS}">${esc(byTeacher ? r.className : r.subjectName)}</td>
      <td style="${tdS}">${esc(streamLabel(r))}</td>
      <td style="${tdS}">${esc(byTeacher ? r.subjectName : r.teacherName)}</td>
      <td style="${tdR}">${r.coveredItems} / ${r.totalItems}</td>
      <td style="${tdR}font-weight:700">${r.totalItems ? `${r.pct}%` : '—'}</td>
    </tr>`).join('');

  const detail = !withTopics ? '' : rows.map(r => {
    const items = r.topics.length ? r.topics.map(t => {
      if (!t.items) return `<tr><td style="${tdS}font-weight:600" colspan="2">${esc(t.title)}</td><td style="${tdS}">${t.covered ? '✓ Covered' : '<span style="color:#94a3b8">Not yet</span>'}</td><td style="${tdS}">${esc(dateOf(t.coveredAt))}</td></tr>`;
      const done = t.items.filter(i => i.covered).length;
      return `<tr><td style="${tdS}font-weight:600;background:#f8fafc" colspan="4">${esc(t.title)} <span style="color:#64748b;font-weight:400">(${done} / ${t.items.length})</span></td></tr>`
        + t.items.map(st => `<tr><td style="${tdS}width:16px"></td><td style="${tdS}">${esc(st.title)}</td><td style="${tdS}">${st.covered ? '✓ Covered' : '<span style="color:#94a3b8">Not yet</span>'}</td><td style="${tdS}">${esc(dateOf(st.coveredAt))}</td></tr>`).join('');
    }).join('') : `<tr><td colspan="4" style="${tdS}color:#94a3b8;font-style:italic">No topics added for this subject and class in ${esc(academicYear)}.</td></tr>`;
    return `
    <div style="break-inside:avoid-page;margin-top:16px">
      <p style="font-size:12px;font-weight:700;margin:0 0 4px">${esc(r.subjectName)} — ${esc(r.className)}${r.wholeClass ? ' (whole class)' : ` · ${esc(r.streamName)}`}
        <span style="font-weight:400;color:#64748b">· ${esc(r.teacherName)} · ${r.coveredItems} / ${r.totalItems}${r.totalItems ? ` (${r.pct}%)` : ''}</span></p>
      <table style="font-size:10px"><thead><tr><th style="${thS}" colspan="2">Topic / subtopic</th><th style="${thS}">Status</th><th style="${thS}">Date covered</th></tr></thead>
      <tbody>${items}</tbody></table>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Lesson Coverage — ${esc(schoolName)}</title>
<style>
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:Arial,Helvetica,sans-serif;max-width:1000px;margin:20px auto;color:#0f172a;padding:0 16px}
  @media print{@page{margin:1.5cm;size:A4 portrait}}
  table{width:100%;border-collapse:collapse}
  tr{break-inside:avoid}
</style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid ${BRAND};padding-bottom:10px;margin-bottom:12px">
    <div>
      <h1 style="margin:0;font-size:18px;font-weight:800">${esc(schoolName)}</h1>
      <p style="margin:2px 0 0;font-size:11px;color:#64748b">Lesson Coverage Report</p>
    </div>
    <div style="text-align:right;font-size:11px;color:#64748b">
      <div><b>${esc(scopeLabel)}</b></div>
      <div>Academic year ${esc(academicYear)}</div>
      <div>Generated ${esc(generatedAt.toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' }))}${generatedByName ? ` by ${esc(generatedByName)}` : ''}</div>
    </div>
  </div>
  <p style="font-size:13px;margin:0 0 10px"><b>Overall: ${tot.covered} of ${tot.total} items covered${tot.total ? ` (${tot.pct}%)` : ''}</b> across ${rows.length} class-subject${rows.length === 1 ? '' : 's'}.</p>
  <table style="font-size:10.5px">
    <thead><tr><th style="${thS}">${byTeacher ? 'Class' : 'Subject'}</th><th style="${thS}">Stream</th><th style="${thS}">${byTeacher ? 'Subject' : 'Teacher'}</th><th style="${thS};text-align:right">Covered / items</th><th style="${thS};text-align:right">Coverage</th></tr></thead>
    <tbody>${summaryRows}</tbody>
  </table>
  ${detail}
  <p style="font-size:9px;color:#64748b;margin-top:16px">${esc(NOTE)}</p>
</body></html>`;
}

/* PDFKit fallback, used only when Chromium can't launch (same posture as behaviour-report.js). */
function renderCoveragePdf({ school, scopeLabel, academicYear, rows, withTopics, generatedByName, generatedAt = new Date() }) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 36, size: 'A4' });
  const bufs = [];
  doc.on('data', c => bufs.push(c));
  const done = new Promise(resolve => doc.on('end', resolve));
  const W = doc.page.width - 72;
  const bottom = () => doc.page.height - 50;
  let y = 36;
  const line = (text, { bold = false, size = 9, color = '#000', indent = 0 } = {}) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const h = doc.heightOfString(text, { width: W - indent });
    if (y + h > bottom()) { doc.addPage(); y = 36; }
    doc.fillColor(color).text(text, 36 + indent, y, { width: W - indent });
    y += h + 3;
  };
  const tot = totalsOf(rows);
  line(school?.name || 'School', { bold: true, size: 16 });
  line('Lesson Coverage Report', { color: '#64748b', size: 10 });
  line(`${scopeLabel}  ·  Academic year ${academicYear}  ·  Generated ${generatedAt.toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' })}${generatedByName ? ` by ${generatedByName}` : ''}`, { color: '#64748b' });
  y += 6;
  line(`Overall: ${tot.covered} of ${tot.total} items covered${tot.total ? ` (${tot.pct}%)` : ''}`, { bold: true, size: 11 });
  y += 4;
  for (const r of rows) {
    line(`${r.subjectName} — ${r.className}${r.wholeClass ? ' (whole class)' : ` · ${r.streamName}`} — ${r.teacherName}: ${r.coveredItems} / ${r.totalItems}${r.totalItems ? ` (${r.pct}%)` : ''}`, { bold: withTopics });
    if (!withTopics) continue;
    if (!r.topics.length) line('No topics added.', { color: '#94a3b8', indent: 12 });
    for (const t of r.topics) {
      if (!t.items) { line(`${t.covered ? '[x]' : '[ ]'} ${t.title}${t.coveredAt ? `  (${dateOf(t.coveredAt)})` : ''}`, { indent: 12 }); continue; }
      line(t.title, { indent: 12, bold: true });
      for (const st of t.items) line(`${st.covered ? '[x]' : '[ ]'} ${st.title}${st.coveredAt ? `  (${dateOf(st.coveredAt)})` : ''}`, { indent: 24 });
    }
    y += 6;
  }
  y += 6;
  line(NOTE, { size: 7, color: '#64748b' });
  doc.end();
  return done.then(() => Buffer.concat(bufs));
}

module.exports = { buildCoverageReport, fillNames, toCsv, renderCoverageHtml, renderCoveragePdf, csvCell, assignmentFilter };
