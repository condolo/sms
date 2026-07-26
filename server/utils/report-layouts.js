/* ============================================================
   Msingi — Report Card Layout Registry (RCE2)

   A pluggable set of renderers over the one shared IR that
   report-cards.js's _computeReportSections produces. Every layout gets
   the exact same data (marks, comments, attendance, behaviour, ranking,
   grading key, cover fields) — a layout only decides how that data is
   arranged on the page, never what data exists (Report Card Template
   Engine plan, Architecture section).

   `legacy_tabular` below is today's exact PDF/HTML output, moved here
   verbatim (byte-for-byte, zero behavior change) — kept forever as the
   renderer for snapshots published before this engine existed, or for
   any school that never configures a `report_card_templates` default.
   It is never offered as a choice for a NEW default assignment (see
   report-card-templates.js's LEGACY_TABULAR sentinel / LAYOUT_KEYS).

   New layouts (subject_paired — RCE3, marks_then_comments — RCE4) are
   added as additional entries in LAYOUTS, each exporting the same
   { label, renderPdf(doc, sections, images, isFirstPage), renderHtml(sections) }
   shape — report-cards.js dispatches through LAYOUTS[key], never
   branches on the key itself.
   ============================================================ */
'use strict';

function _esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* PDF renderer — walks the IR and makes the pdfkit calls. Every
   coordinate/color/size constant here is unchanged from the original
   monolithic _buildPDFPage; only the source of each value moved from
   `snap`/`config` directly to the pre-computed `s` (sections) object. */
function _renderLegacyTabularPdf(doc, s, images, isFirstPage) {
  if (!isFirstPage) doc.addPage();

  const PAGE_WIDTH = doc.page.width - 80;
  const GRAY = '#555555', DARK = '#1a1a2e', ACCENT = '#2563eb', LIGHT_GRAY = '#f3f4f6', BORDER = '#d1d5db';
  const COL_GAP = 5;

  /* DRAFT WATERMARK */
  if (s.watermarkText) {
    doc.save()
       .translate(doc.page.width / 2, doc.page.height / 2)
       .rotate(-45)
       .fontSize(90).fillOpacity(0.06).fillColor('#cc0000')
       .text(s.watermarkText, -200, -45, { width: 400, align: 'center' })
       .restore();
  }

  /* HEADER */
  doc.rect(40, 40, PAGE_WIDTH, 60).fill(DARK);
  doc.fillColor('white').fontSize(17).font('Helvetica-Bold')
     .text(s.header.schoolName, 50, 52, { width: PAGE_WIDTH - 20 });
  doc.fontSize(9).font('Helvetica')
     .text(s.header.subtitle, 50, 75, { width: PAGE_WIDTH - 20 });
  doc.fillColor(DARK);

  /* STUDENT INFO — passport photo on right, text on left */
  const infoTop    = 115;
  const infoHeight = 90;
  const PHOTO_W = 52, PHOTO_H = 68;
  const photoX  = 40 + PAGE_WIDTH - PHOTO_W - 6;
  const photoY  = infoTop + 11;
  doc.rect(40, infoTop, PAGE_WIDTH, infoHeight).fill(LIGHT_GRAY).stroke(BORDER);

  const textWidth = PAGE_WIDTH - PHOTO_W - 20;
  const c1 = 50, c2 = 280;
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('STUDENT NAME', c1, infoTop + 8);
  doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text(s.studentInfo.studentName, c1, infoTop + 19, { width: Math.min(200, textWidth - c1 + 40) });
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('ADMISSION NO.', c2, infoTop + 8);
  doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold').text(s.studentInfo.admissionNo, c2, infoTop + 19, { width: 130 });
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('CLASS', c1, infoTop + 50);
  doc.fillColor(DARK).fontSize(10).font('Helvetica').text(s.studentInfo.className, c1, infoTop + 61);
  doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('TERM / ACADEMIC YEAR', c2, infoTop + 50);
  doc.fillColor(DARK).fontSize(10).font('Helvetica')
     .text(s.studentInfo.termLine, c2, infoTop + 61, { width: 160 });

  /* Passport photo — rendered if available, else a placeholder box */
  doc.rect(photoX - 1, photoY - 1, PHOTO_W + 2, PHOTO_H + 2).stroke(BORDER);
  if (images.studentPhoto) {
    try {
      doc.image(images.studentPhoto, photoX, photoY, { width: PHOTO_W, height: PHOTO_H, cover: [PHOTO_W, PHOTO_H] });
    } catch (_) {
      doc.rect(photoX, photoY, PHOTO_W, PHOTO_H).fill('#e2e8f0');
    }
  } else {
    doc.rect(photoX, photoY, PHOTO_W, PHOTO_H).fill('#e2e8f0');
    doc.fillColor('#94a3b8').fontSize(6.5).font('Helvetica')
       .text('PHOTO', photoX, photoY + PHOTO_H / 2 - 4, { width: PHOTO_W, align: 'center' });
  }

  /* VERSION BADGE */
  if (s.studentInfo.versionBadge) {
    doc.fillColor(s.studentInfo.versionBadge.superseded ? '#dc2626' : '#059669').fontSize(8).font('Helvetica-Bold')
       .text(s.studentInfo.versionBadge.text, c2, infoTop + 37, { width: 130, align: 'left' });
  }

  /* MODERATION BYPASS WARNING */
  if (s.studentInfo.moderationBypassed) {
    const warnY = infoTop + infoHeight + 2;
    doc.rect(40, warnY, PAGE_WIDTH, 14).fill('#fef3c7');
    doc.fillColor('#92400e').fontSize(7.5).font('Helvetica-Bold')
       .text('⚠ Published with moderation check bypassed', 44, warnY + 3, { width: PAGE_WIDTH - 8 });
  }

  /* RESULTS TABLE — dynamic columns from the IR's typeEntries */
  const tableTop = infoTop + infoHeight + (s.studentInfo.moderationBypassed ? 20 : 6);

  const typeEntries = s.resultsTable.typeEntries;
  const W_SUBJECT  = 155, W_SCORE = 42, W_GRADE = 42, W_REMARKS = 80;
  const fixedTotal = W_SUBJECT + W_SCORE + W_GRADE + W_REMARKS;
  const totalGaps  = (typeEntries.length + 3) * COL_GAP;
  const W_TYPE     = typeEntries.length > 0
    ? Math.max(36, Math.floor((PAGE_WIDTH - fixedTotal - totalGaps) / typeEntries.length))
    : 0;

  const colDefs = [
    { label: 'Subject',  width: W_SUBJECT },
    ...typeEntries.map(t => ({ label: t.label + '\n(%)', width: W_TYPE })),
    { label: 'Score',   width: W_SCORE   },
    { label: 'Grade',   width: W_GRADE   },
    { label: 'Remarks', width: W_REMARKS },
  ];
  const colWidths = colDefs.map(c => c.width);
  const colX = []; let cx = 40;
  for (const w of colWidths) { colX.push(cx); cx += w + COL_GAP; }

  doc.rect(40, tableTop, PAGE_WIDTH, 22).fill(ACCENT);
  doc.fillColor('white').fontSize(8).font('Helvetica-Bold');
  colDefs.forEach((col, i) => {
    doc.text(col.label, colX[i] + 3, tableTop + 4, { width: colWidths[i] - 3, align: 'center' });
  });

  let rowY = tableTop + 22;
  const typeStart = 1;
  const scoreIdx  = typeStart + typeEntries.length;
  const gradeIdx  = scoreIdx + 1;
  const rmrkIdx   = gradeIdx + 1;

  s.resultsTable.rows.forEach((row, idx) => {
    const rowH = 18;
    doc.rect(40, rowY, PAGE_WIDTH, rowH).fill(idx % 2 === 0 ? 'white' : LIGHT_GRAY);

    doc.fillColor(row.failed ? '#dc2626' : DARK).fontSize(8.5).font('Helvetica');
    doc.text(row.nameLine, colX[0] + 3, rowY + 5, { width: colWidths[0] - 3 });

    row.typeValues.forEach((val, ti) => {
      const ci = typeStart + ti;
      doc.fillColor(DARK).fontSize(8.5).font('Helvetica')
         .text(val, colX[ci] + 3, rowY + 5, { width: colWidths[ci] - 3, align: 'center' });
    });

    doc.fillColor(DARK).fontSize(8.5).font('Helvetica')
       .text(row.scoreText, colX[scoreIdx] + 3, rowY + 5, { width: colWidths[scoreIdx] - 3, align: 'center' });

    doc.font('Helvetica-Bold').fillColor(row.hasGrade ? (row.failed ? '#dc2626' : ACCENT) : GRAY)
       .text(row.gradeText, colX[gradeIdx] + 3, rowY + 5, { width: colWidths[gradeIdx] - 3, align: 'center' });

    doc.font('Helvetica').fillColor(GRAY).fontSize(7.5)
       .text(row.remarksText, colX[rmrkIdx] + 3, rowY + 5, { width: colWidths[rmrkIdx] - 3 });
    rowY += rowH;
  });

  doc.rect(40, tableTop, PAGE_WIDTH, rowY - tableTop).stroke(BORDER);

  if (s.resultsTable.rankingNote) {
    doc.fillColor(GRAY).fontSize(7).font('Helvetica')
       .text(s.resultsTable.rankingNote, 40, rowY + 3, { width: PAGE_WIDTH });
    rowY += 12;
  }

  /* SUMMARY */
  rowY += 6;
  doc.rect(40, rowY, PAGE_WIDTH, 28).fill('#eff6ff').stroke(BORDER);
  doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold');
  doc.text(s.summary.totalText, 50, rowY + 5);
  doc.text(s.summary.averageText, 160, rowY + 5);
  if (s.summary.showGPA) doc.text(s.summary.gpaText, 265, rowY + 5);
  if (s.summary.showRanking) {
    doc.fillColor(ACCENT).text(s.summary.rankText, 355, rowY + 5);
  }
  rowY += 28;

  /* ATTENDANCE */
  if (s.attendance) {
    rowY += 8;
    doc.rect(40, rowY, PAGE_WIDTH, 26).fill(LIGHT_GRAY).stroke(BORDER);
    doc.fillColor(GRAY).fontSize(8).font('Helvetica').text('ATTENDANCE', 50, rowY + 4);
    doc.fillColor(DARK).fontSize(9).font('Helvetica')
       .text(s.attendance.text, 50, rowY + 14, { width: PAGE_WIDTH - 20 });
    rowY += 26;
  }

  /* COMMENTS */
  rowY += 12;
  doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text("CLASS TEACHER'S REMARK:", 40, rowY);
  rowY += 12;
  doc.rect(40, rowY, PAGE_WIDTH, 30).fill('white').stroke(BORDER);
  doc.fillColor(DARK).fontSize(9).font('Helvetica')
     .text(s.comments.classTeacherRemark, 46, rowY + 9, { width: PAGE_WIDTH - 12 });
  rowY += 38;

  doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text("PRINCIPAL'S COMMENT:", 40, rowY);
  rowY += 12;
  doc.rect(40, rowY, PAGE_WIDTH, 30).fill('white').stroke(BORDER);
  doc.fillColor(DARK).fontSize(9).font('Helvetica')
     .text(s.comments.principalRemark, 46, rowY + 9, { width: PAGE_WIDTH - 12 });
  rowY += 42;

  /* SIGNATURES */
  const sigY = rowY + 8;
  const sigW = (PAGE_WIDTH - 20) / 2;

  if (images.principalSignature) {
    try {
      doc.image(images.principalSignature, 40 + sigW + 10, sigY - 28, { height: 28, fit: [sigW - 10, 28] });
    } catch (_) { /* non-fatal — skip image if corrupt */ }
  }
  if (images.schoolStamp) {
    try {
      doc.image(images.schoolStamp, 40 + PAGE_WIDTH - 56, sigY - 36, { height: 36, fit: [50, 36] });
    } catch (_) { /* non-fatal */ }
  }

  doc.moveTo(40, sigY + 20).lineTo(40 + sigW - 10, sigY + 20).stroke(DARK);
  doc.moveTo(40 + sigW + 10, sigY + 20).lineTo(40 + PAGE_WIDTH, sigY + 20).stroke(DARK);
  doc.fillColor(GRAY).fontSize(8).font('Helvetica')
     .text(s.signatures.classTeacherLabel, 40, sigY + 24, { width: sigW })
     .text(s.signatures.principalLabel,    40 + sigW + 10, sigY + 24, { width: sigW });

  /* FOOTER */
  const footerY = doc.page.height - 55;
  doc.rect(40, footerY, PAGE_WIDTH, 0.5).fill(BORDER);
  doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
     .text(s.footer.footerNote, 40, footerY + 6, { width: PAGE_WIDTH, align: 'center' });
  if (s.footer.reportId) {
    const verifyRow = footerY + 18;
    doc.fillColor(DARK).fontSize(7).font('Helvetica-Bold')
       .text(`Report ID: ${s.footer.reportId}`, 40, verifyRow, { width: PAGE_WIDTH / 2 });
    doc.fillColor(GRAY).fontSize(7).font('Helvetica')
       .text(`Verify at: /verify/${s.footer.reportId}`, 40 + PAGE_WIDTH / 2, verifyRow, { width: PAGE_WIDTH / 2, align: 'right' });
    doc.fillColor(GRAY).fontSize(6.5).font('Helvetica')
       .text(s.footer.genLine, 40, footerY + 28, { width: PAGE_WIDTH, align: 'center' });
  } else {
    doc.fillColor(GRAY).fontSize(7.5).font('Helvetica')
       .text(s.footer.genLine, 40, footerY + 18, { width: PAGE_WIDTH, align: 'center' });
  }
}

/* HTML renderer — the second adapter over the same IR the PDF renderer
   consumes. Four pages: cover / marks (+ grading key) / comments /
   behaviour — deliberately without per-instance mark columns (RC3
   scoping decision: tracked separately as its own follow-up). */
function _renderLegacyTabularHtml(s) {
  const pb = 'page-break-before:always';
  const watermarkHtml = s.watermarkText
    ? `<div style="position:fixed;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:90px;font-weight:900;color:#cc0000;opacity:0.08;pointer-events:none;white-space:nowrap;z-index:999">${_esc(s.watermarkText)}</div>`
    : '';

  const logoHtml = s.cover.logoUrl
    ? `<img src="${_esc(s.cover.logoUrl)}" style="height:96px;width:96px;object-fit:contain;border-radius:6px" />`
    : `<div style="width:96px;height:96px;background:#e2e8f0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:bold;color:#94a3b8">${_esc((s.header.schoolName?.[0] ?? 'S').toUpperCase())}</div>`;
  const logoSmallHtml = s.cover.logoUrl
    ? `<img src="${_esc(s.cover.logoUrl)}" style="height:56px;width:56px;object-fit:contain;border-radius:4px" />`
    : `<div style="width:56px;height:56px;background:#e2e8f0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:bold;color:#94a3b8">${_esc((s.header.schoolName?.[0] ?? 'S').toUpperCase())}</div>`;

  const coverRows = s.cover.rows.map(r => `
    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc;width:40%">${_esc(r.label)}</td>
        <td style="padding:8px 14px;border:1px solid #e2e8f0;font-weight:700">${_esc(r.value)}</td></tr>`).join('');

  const coverHtml = `
<div style="min-height:277mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:32px;text-align:center">
  ${logoHtml}
  <div>
    <h1 style="font-size:26px;font-weight:900;margin:0 0 4px;color:#0f172a">${_esc(s.header.schoolName)}</h1>
    ${s.cover.tagline ? `<p style="font-size:13px;font-style:italic;color:#64748b;margin:0 0 16px">${_esc(s.cover.tagline)}</p>` : '<div style="margin-bottom:16px"></div>'}
    <div style="display:inline-block;background:#1e293b;color:#fff;padding:10px 32px;border-radius:6px;font-size:15px;font-weight:700;letter-spacing:1.5px">
      ${_esc(s.cover.subtitle)}
    </div>
  </div>
  <table style="border-collapse:collapse;width:480px;font-size:13px">${coverRows}</table>
  <p style="font-size:11px;color:#94a3b8;margin-top:auto">Generated by Msingi School Management System</p>
</div>`;

  const thS = 'border:1px solid #cbd5e1;padding:5px 8px;background:#1e293b;color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.5px;text-align:center';
  const tdS = 'border:1px solid #e2e8f0;padding:5px 8px';
  const tdC = `${tdS};text-align:center`;

  const colHeaders = s.resultsTable.typeEntries.map(t => `<th style="${thS}">${_esc(t.label)}</th>`).join('');
  const subjectRows = s.resultsTable.rows.map(row => {
    const markCells = row.typeValues.map(v => `<td style="${tdC}">${_esc(v)}</td>`).join('');
    const devColor = row.deviationText == null ? '#94a3b8' : row.deviationText.startsWith('-') ? '#dc2626' : '#16a34a';
    return `
      <tr${row.failed ? ' style="color:#dc2626"' : ''}>
        <td style="${tdS};font-weight:600;min-width:120px">${_esc(row.nameLine)}</td>
        ${markCells}
        <td style="${tdC};font-weight:700">${_esc(row.scoreText)}</td>
        <td style="${tdC};font-weight:700">${_esc(row.gradeText)}</td>
        <td style="${tdC};color:${devColor};font-weight:600">${row.deviationText == null ? '—' : _esc(row.deviationText)}</td>
        <td style="${tdS};font-size:9px;color:#64748b">${_esc(row.remarksText)}</td>
      </tr>`;
  }).join('');

  const gradingRows = s.gradingKey.map(b => `
    <tr><td style="${tdC};font-weight:700">${_esc(b.grade)}</td><td style="${tdC}">${_esc(b.range)}</td>
        <td style="${tdC}">${_esc(b.points)}</td><td style="${tdS}">${_esc(b.label)}</td></tr>`).join('');

  const marksHtml = `
<div style="${pb}">
  <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:14px;border-bottom:2px solid #1e293b;padding-bottom:10px">
    ${logoSmallHtml}
    <div style="text-align:center">
      <h2 style="margin:0 0 2px;font-size:16px;font-weight:800">${_esc(s.header.schoolName)}</h2>
      <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1px">${_esc(s.header.subtitle)}</p>
    </div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11px">
    <tr>
      <td style="${tdS}"><b>Name:</b> ${_esc(s.studentInfo.studentName)}</td>
      <td style="${tdS}"><b>ADM:</b> ${_esc(s.studentInfo.admissionNo)}</td>
      <td style="${tdS}"><b>Class:</b> ${_esc(s.studentInfo.className)}</td>
      <td style="${tdS}"><b>${_esc(s.summary.totalText)}</b></td>
      <td style="${tdS}"><b>${_esc(s.summary.averageText)}</b></td>
      ${s.summary.showRanking ? `<td style="${tdS}">${_esc(s.summary.rankText)}</td>` : ''}
    </tr>
  </table>
  <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11px">
    <thead><tr>
      <th style="${thS};text-align:left">Subject</th>${colHeaders}
      <th style="${thS}">Score</th><th style="${thS}">Grade</th><th style="${thS}">Dev</th><th style="${thS};text-align:left">Remarks</th>
    </tr></thead>
    <tbody>${subjectRows}</tbody>
  </table>
  ${s.resultsTable.rankingNote ? `<p style="font-size:9px;color:#64748b;margin:0 0 14px">${_esc(s.resultsTable.rankingNote)}</p>` : ''}
  ${s.attendance ? `<p style="font-size:11px;color:#475569;margin:0 0 14px"><b>Attendance:</b> ${_esc(s.attendance.text)}</p>` : ''}
  <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">Grading Key</p>
  <table style="width:100%;border-collapse:collapse;font-size:10px;max-width:480px">
    <thead><tr><th style="${thS}">Grade</th><th style="${thS}">Range</th><th style="${thS}">Points</th><th style="${thS};text-align:left">Description</th></tr></thead>
    <tbody>${gradingRows}</tbody>
  </table>
</div>`;

  const subjectCommentRows = s.comments.subjectComments.map(c => `
    <tr><td style="${tdS};font-weight:600;width:160px;vertical-align:top">${_esc(c.subjectId)}</td>
        <td style="${tdS};font-size:11px;color:#475569">${c.text ? _esc(c.text) : '<span style="color:#cbd5e1;font-style:italic">No comment entered</span>'}</td></tr>`).join('');

  // RC7 — a disabled capability leaves zero trace: no section header, no
  // table, no placeholder. Genuinely-empty-but-enabled (a report with no
  // subjects) keeps the existing "No subjects on this report" placeholder.
  const subjectCommentsSectionHtml = s.comments.subjectTeacherCommentsEnabled ? `
  <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 6px">Subject Teacher Comments</p>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:11px">
    ${subjectCommentRows || `<tr><td colspan="2" style="${tdS};color:#94a3b8;font-style:italic">No subjects on this report.</td></tr>`}
  </table>` : '';

  // RC8 — a school using the report_comment_approval chain renders its
  // configured, variable-length remark list here instead; a school that
  // never configured it (reportRemarks always []) keeps the original
  // fixed Class Teacher / Principal two-column layout, byte-for-byte.
  const reportRemarksSectionHtml = s.comments.reportRemarks.length > 0 ? `
  <div style="margin-bottom:16px">
    ${s.comments.reportRemarks.map(r => `
    <div style="margin-bottom:12px">
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">${_esc(r.label)}</p>
      <div style="border:1px solid #e2e8f0;border-radius:4px;padding:8px 12px;min-height:50px;font-size:11px;color:#475569">${_esc(r.text)}</div>
    </div>`).join('')}
  </div>` : `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">
        ${_esc(s.signatures.classTeacherLabel)}: <span style="font-style:italic;font-weight:normal">${_esc(s.comments.classTeacherName) || '___________________'}</span>
      </p>
      <div style="border:1px solid #e2e8f0;border-radius:4px;padding:8px 12px;min-height:70px;font-size:11px;color:#475569">${_esc(s.comments.classTeacherRemark)}</div>
      <div style="margin-top:24px;border-top:1px solid #1e293b;width:180px;padding-top:4px;font-size:10px;color:#475569">${_esc(s.signatures.classTeacherLabel)} Signature</div>
    </div>
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">
        ${_esc(s.signatures.principalLabel)}: <span style="font-style:italic;font-weight:normal">${_esc(s.comments.principalName) || '___________________'}</span>
      </p>
      <div style="border:1px solid #e2e8f0;border-radius:4px;padding:8px 12px;min-height:70px;font-size:11px;color:#475569">${_esc(s.comments.principalRemark)}</div>
      <div style="margin-top:24px;border-top:1px solid #1e293b;width:180px;padding-top:4px;font-size:10px;color:#475569">${_esc(s.signatures.principalLabel)} Signature</div>
    </div>
  </div>`;

  const commentsHtml = `
<div style="${pb}">
  <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:14px;border-bottom:2px solid #1e293b;padding-bottom:10px">
    ${logoSmallHtml}
    <div style="text-align:center">
      <h2 style="margin:0 0 2px;font-size:16px;font-weight:800">${_esc(s.header.schoolName)}</h2>
      <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1px">TEACHER COMMENTS — ${_esc(s.studentInfo.studentName)}</p>
    </div>
  </div>
  ${subjectCommentsSectionHtml}
  ${reportRemarksSectionHtml}
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;border-top:1px solid #e2e8f0;padding-top:12px">
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">Sports &amp; Talent</p>
      <p style="margin:0;padding:6px 10px;border:1px solid #e2e8f0;border-radius:4px;min-height:28px;font-size:11px">${_esc(s.comments.sportsAndTalent)}</p>
    </div>
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">Closing Date</p>
      <p style="margin:0;padding:6px 10px;border:1px solid #e2e8f0;border-radius:4px;min-height:28px;font-size:11px">${_esc(s.comments.closingDate)}</p>
    </div>
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">Next Term Begins</p>
      <p style="margin:0;padding:6px 10px;border:1px solid #e2e8f0;border-radius:4px;min-height:28px;font-size:11px">${_esc(s.comments.nextTermBegin)}</p>
    </div>
  </div>
</div>`;

  const beh = s.behaviour;
  const behHtml = `
<div style="${pb}">
  <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:14px;border-bottom:2px solid #1e293b;padding-bottom:10px">
    ${logoSmallHtml}
    <div style="text-align:center">
      <h2 style="margin:0 0 2px;font-size:16px;font-weight:800">${_esc(s.header.schoolName)}</h2>
      <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1px">BEHAVIOUR REPORT — ${_esc(s.studentInfo.studentName)}</p>
    </div>
  </div>
  ${beh ? `
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
    ${[
      { label: 'Merits', value: beh.merits, color: '#16a34a' },
      { label: 'Demerits', value: beh.demerits, color: '#dc2626' },
      { label: 'Net Points', value: beh.points, color: beh.points >= 0 ? '#16a34a' : '#dc2626' },
      { label: 'Total Incidents', value: beh.total, color: '#475569' },
    ].map(m => `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center">
        <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#94a3b8;margin:0 0 4px">${_esc(m.label)}</p>
        <p style="font-size:28px;font-weight:900;color:${m.color};margin:0">${_esc(m.value)}</p>
      </div>`).join('')}
  </div>` : `
  <p style="color:#94a3b8;font-style:italic;font-size:12px;text-align:center;padding:40px 0">No behaviour records found for this term.</p>`}
</div>`;

  const footerHtml = `<p style="text-align:center;font-size:9px;color:#94a3b8;margin-top:16px">${_esc(s.footer.footerNote)} — ${_esc(s.footer.genLine)}${s.footer.reportId ? ` — Report ID: ${_esc(s.footer.reportId)}` : ''}</p>`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Report Card — ${_esc(s.studentInfo.studentName)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;max-width:1050px;margin:20px auto;color:#0f172a;padding:0 16px}
  @media print{@page{margin:1.5cm;size:A4}button{display:none!important}}
</style>
</head><body>
${watermarkHtml}
${coverHtml}
${marksHtml}
${commentsHtml}
${behHtml}
${footerHtml}
</body></html>`;
}

const LAYOUTS = {
  legacy_tabular: {
    label: 'Legacy Tabular',
    renderPdf:  _renderLegacyTabularPdf,
    renderHtml: _renderLegacyTabularHtml,
  },
  // subject_paired (RCE3) and marks_then_comments (RCE4) are added here
  // as sibling entries — report-cards.js always dispatches through
  // LAYOUTS[key], never branches on the key itself.
};

/**
 * Resolve a layout entry by key, falling back to legacy_tabular for any
 * unknown/missing key — the same "never fail to render, degrade to the
 * always-correct baseline" posture as resolveTemplate()'s own fallback.
 */
function getLayout(layoutKey) {
  return LAYOUTS[layoutKey] || LAYOUTS.legacy_tabular;
}

module.exports = { LAYOUTS, getLayout, _esc };
