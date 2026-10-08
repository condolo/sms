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

const path = require('path');

/* ── RCE8 — premium institutional redesign: shared type system ──────
   Real embedded fonts (Lora/Work Sans/IBM Plex Mono, OFL-licensed TTFs
   under server/assets/fonts — see OFL.txt there), registered once per
   PDFDocument. subject_paired and marks_then_comments both draw through
   these names/colors so the two layouts share one visual system and
   can't drift apart on it, per the approved design spec. legacy_tabular
   is explicitly excluded (frozen, byte-for-byte, per this file's header
   comment) and keeps drawing with the plain Helvetica/blue palette it
   always has. */
const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONTS = {
  serifRegular: 'RC-Serif-Regular', serifSemibold: 'RC-Serif-SemiBold', serifBold: 'RC-Serif-Bold',
  sansRegular: 'RC-Sans-Regular', sansItalic: 'RC-Sans-Italic', sansMedium: 'RC-Sans-Medium',
  sansSemibold: 'RC-Sans-SemiBold', sansBold: 'RC-Sans-Bold',
  monoRegular: 'RC-Mono-Regular', monoMedium: 'RC-Mono-Medium',
};
const FONT_FILES = {
  [FONTS.serifRegular]: 'Lora-Regular.ttf', [FONTS.serifSemibold]: 'Lora-SemiBold.ttf', [FONTS.serifBold]: 'Lora-Bold.ttf',
  [FONTS.sansRegular]: 'WorkSans-Regular.ttf', [FONTS.sansItalic]: 'WorkSans-Italic.ttf', [FONTS.sansMedium]: 'WorkSans-Medium.ttf',
  [FONTS.sansSemibold]: 'WorkSans-SemiBold.ttf', [FONTS.sansBold]: 'WorkSans-Bold.ttf',
  [FONTS.monoRegular]: 'IBMPlexMono-Regular.ttf', [FONTS.monoMedium]: 'IBMPlexMono-Medium.ttf',
};
// Idempotent per doc — registerFont is cheap, but a flag avoids redoing
// it on every helper call. Guarded for test doubles that don't stub
// registerFont (a spy doc only needs the drawing methods it asserts on).
function _registerReportFonts(doc) {
  if (typeof doc.registerFont !== 'function' || doc._rcFontsRegistered) return;
  Object.entries(FONT_FILES).forEach(([name, file]) => doc.registerFont(name, path.join(FONT_DIR, file)));
  doc._rcFontsRegistered = true;
}

const INK = '#15171c', INK_SOFT = '#5b5f68', INK_FAINT = '#9195a0';
const SURFACE = '#f4f3f0', RULE = '#d8d6d0', RULE_SOFT = '#e8e6e1';
const BRAND = '#1f2d3d', BRAND_WASH = '#eef1f4', ACCENT = '#8a5a2b';
const FAIL_RED = '#b3261e', PASS_GREEN = '#2e7d32';

function _esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Class-teacher observation ratings grid (2026-09) — shared between the
   two "new" layouts (subject_paired, marks_then_comments); legacy_tabular
   is frozen and never renders it, same posture as every other RCE1
   toggle. Empty string when the school hasn't turned this on, or has
   turned it on but defined zero categories — same "zero trace when
   disabled" rule subjectTeacherCommentsEnabled already follows. */
// Redesigned per a shared reference layout: a grid of per-category cards
// (dark header bar + an Excellent/Good/Improve checkbox row each) instead
// of one long Category-vs-rating table — reported directly ("Class
// teacher observation, see the design"). 3 cards per row, wrapping to
// as many rows as the school has categories (2 rows of 3 for the
// 6-category default). Uses the report's own existing dark navy accent
// (already used for every other section header in this file) rather than
// introducing a new, inconsistent colour just for this one grid.
function _observationRatingsHtml(s) {
  if (!s.comments.showObservationRatings || !s.comments.observationRatings.length) return '';
  const LEVELS = [['excellent', 'Excellent'], ['good', 'Good'], ['improve', 'Improve']];
  const cards = s.comments.observationRatings.map(({ category, rating }) => `
    <div style="border:1px solid #cbd5e1;border-radius:6px;overflow:hidden">
      <div style="background:#1e293b;color:#fff;text-align:center;font-weight:700;font-size:10px;letter-spacing:.6px;padding:6px 4px;text-transform:uppercase">${_esc(category)}</div>
      <table style="width:100%;border-collapse:collapse;table-layout:fixed">
        <tr>${LEVELS.map(([, label], i) => `
          <td style="text-align:center;font-size:8px;font-weight:700;letter-spacing:.3px;color:#475569;padding:5px 2px;${i < 2 ? 'border-right:1px solid #e2e8f0;' : ''}">${label.toUpperCase()}</td>`).join('')}
        </tr>
        <tr>${LEVELS.map(([v], i) => `
          <td style="text-align:center;padding:7px 2px;border-top:1px solid #e2e8f0;${i < 2 ? 'border-right:1px solid #e2e8f0;' : ''}">
            <span style="display:inline-block;width:12px;height:12px;border:1.5px solid #475569;border-radius:2px;${rating === v ? 'background:#1e293b' : ''}"></span>
          </td>`).join('')}
        </tr>
      </table>
    </div>`).join('');
  return `
  <div style="margin:16px 0">
    <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 8px">Class Teacher Observations</p>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">${cards}</div>
  </div>`;
}

/* Sign-off images for the HTML renderers — reported directly: "the stamp
   and principal's signature didn't show." These were only ever drawn in
   the PDFKit path (images.principalSignature/schoolStamp, Buffers fetched
   server-side by _fetchSignatureImages for the native-PDF route);
   s.signatures.principalSignatureUrl/schoolStampUrl are the same URLs
   (data: URI or http(s) — see report-cards.js's _fetchImageBuf) as plain
   strings a browser can load directly in an <img>, with no server-side
   fetch needed here. Empty string when the school hasn't uploaded one —
   same "zero trace" rule as every other optional block in this file. */
function _principalSignatureImgHtml(s) {
  if (!s.signatures.principalSignatureUrl) return '';
  return `<img src="${_esc(s.signatures.principalSignatureUrl)}" alt="" style="display:block;height:30px;max-width:170px;object-fit:contain;margin:10px 0 2px" />`;
}
function _schoolStampImgHtml(s) {
  if (!s.signatures.schoolStampUrl) return '';
  return `<img src="${_esc(s.signatures.schoolStampUrl)}" alt="" style="position:absolute;top:0;right:0;height:52px;width:52px;object-fit:contain;opacity:0.85" />`;
}

// Reported directly: "I need... the footer see" (a reference design's
// prominent term-dates bar). closingDate/nextTermBegin already existed
// in the IR and in the Comments tab a school fills in, but were only
// ever rendered by legacy_tabular — subject_paired and marks_then_comments
// silently dropped them. One shared helper now, used by all three, so
// they can't drift apart again (same convention as _observationRatingsHtml).
function _termDatesFooterHtml(s) {
  if (!s.comments.closingDate && !s.comments.nextTermBegin) return '';
  const term = s.cover?.termNumber != null ? `Term ${_esc(s.cover.termNumber)}` : 'Term';
  return `
  <div style="display:grid;grid-template-columns:1fr 1fr;background:#e2e8f0;border-radius:4px;overflow:hidden;margin:16px 0 0;font-size:10px;font-weight:600;color:#334155">
    <div style="padding:8px 14px;border-right:1px solid #cbd5e1">${term} Ended on: ${s.comments.closingDate ? _esc(s.comments.closingDate) : '—'}</div>
    <div style="padding:8px 14px;text-align:right">Next Term begins on: ${s.comments.nextTermBegin ? _esc(s.comments.nextTermBegin) : '—'}</div>
  </div>`;
}

// Sports & Talent — same "previously legacy_tabular-only" gap as the
// dates above, split out as its own small field now that the dates have
// their own prominent bar instead of sharing a 3-column grid with it.
function _sportsAndTalentHtml(s) {
  if (!s.comments.sportsAndTalent) return '';
  return `
  <div style="margin:16px 0 0">
    <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">Sports &amp; Talent</p>
    <p style="margin:0;padding:6px 10px;border:1px solid #e2e8f0;border-radius:4px;font-size:11px">${_esc(s.comments.sportsAndTalent)}</p>
  </div>`;
}

// One signer's full block — banner header, remark text, then a proper
// sign-off row (signature image above the line, name below it, role/
// title below the name, a "Date:" alongside) — redesigned per a shared
// reference layout (reported directly: the old layout put the name
// ABOVE the comment box and just a bare label under the line, with no
// date at all). Used for both Class Teacher and Principal — stampUrl is
// only ever passed for the Principal's block (there's no "class teacher
// stamp" concept), matching every prior fix's "only Principal/stamp" posture.
function _remarkSignOffHtml({ roleLabel, personName, remarkText, signatureUrl, stampUrl, signDate }) {
  return `
    <div style="position:relative">
      ${stampUrl ? `<img src="${_esc(stampUrl)}" alt="" style="position:absolute;top:28px;right:0;height:50px;width:50px;object-fit:contain;opacity:0.85" />` : ''}
      <div style="background:#1e293b;color:#fff;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;text-align:center;padding:7px;border-radius:4px 4px 0 0">${_esc(roleLabel)}'s General Comment</div>
      <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 4px 4px;padding:10px 12px;min-height:66px;font-size:11px;color:#475569">${_esc(remarkText)}</div>
      <div style="margin-top:18px;display:flex;align-items:flex-end;justify-content:space-between;gap:16px">
        <div>
          ${signatureUrl ? `<img src="${_esc(signatureUrl)}" alt="" style="height:32px;max-width:160px;object-fit:contain;display:block;margin-bottom:4px" />` : '<div style="height:32px"></div>'}
          <div style="border-top:1px solid #1e293b;width:170px;padding-top:4px">
            <p style="margin:0;font-size:11px;color:#1e293b">${_esc(personName) || '—'}</p>
            <p style="margin:0;font-size:10px;font-weight:700;color:#475569">${_esc(roleLabel)}</p>
          </div>
        </div>
        ${signDate ? `<p style="margin:0 0 4px;font-size:10px;color:#475569;white-space:nowrap">Date: ${_esc(signDate)}</p>` : ''}
      </div>
    </div>`;
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

  /* COMMENTS — each box independently gated by RCE1's showClassTeacherRemark/
     showPrincipalRemark, same as every other layout. This renderer used to
     draw both unconditionally regardless of either toggle — reported
     directly: turning Principal's Comment off still left its label and an
     empty box on the page instead of removing it and reclaiming the space. */
  rowY += 12;
  if (s.comments.showClassTeacherRemark) {
    doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text("CLASS TEACHER'S REMARK:", 40, rowY);
    rowY += 12;
    doc.rect(40, rowY, PAGE_WIDTH, 30).fill('white').stroke(BORDER);
    doc.fillColor(DARK).fontSize(9).font('Helvetica')
       .text(s.comments.classTeacherRemark, 46, rowY + 9, { width: PAGE_WIDTH - 12 });
    rowY += 38;
  }

  if (s.comments.showPrincipalRemark) {
    doc.fillColor(DARK).fontSize(9).font('Helvetica-Bold').text("PRINCIPAL'S COMMENT:", 40, rowY);
    rowY += 12;
    doc.rect(40, rowY, PAGE_WIDTH, 30).fill('white').stroke(BORDER);
    doc.fillColor(DARK).fontSize(9).font('Helvetica')
       .text(s.comments.principalRemark, 46, rowY + 9, { width: PAGE_WIDTH - 12 });
    rowY += 42;
  }

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

  // No "Generated by Msingi..." line here — a school's own, customisable
  // disclaimer (academic_config.footerNote, default "This report card is
  // computer-generated...") plus the generation date already appear in
  // the real footer at the bottom of the report; this was a second,
  // hardcoded, non-customisable copy on the cover page, and removing it
  // helped but didn't fully fix the reported blank second page.
  // The real, remaining cause: this div's own min-height. @page{margin:
  // 1.5cm;size:A4} (this file's print stylesheet, below) leaves 297mm −
  // 2×15mm = 267mm of actual printable height per page — min-height:277mm
  // is 10mm TALLER than that, so this section alone guarantees overflow
  // onto a second, near-empty page on every print/PDF, regardless of how
  // little content it holds. 260mm leaves real headroom under the 267mm
  // ceiling for borders/line-height rounding, still comfortably fills a
  // single page.
  // Header redesigned per a shared reference layout (logo left, school
  // name/address/phone+email stacked right) — previously this cover
  // didn't show the school's contact details at all, only name+tagline;
  // _schoolHeaderHtml is the same helper _renderCoverHtml uses, so this
  // layout and the other two can't drift apart on it again.
  const coverHtml = `
<div style="min-height:260mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:32px;text-align:center">
  ${_schoolHeaderHtml(s.cover, logoHtml)}
  <div>
    <div style="display:inline-block;background:#1e293b;color:#fff;padding:10px 32px;border-radius:6px;font-size:15px;font-weight:700;letter-spacing:1.5px">
      ${_esc(s.cover.subtitle)}
    </div>
  </div>
  <table style="border-collapse:collapse;width:480px;font-size:13px">${coverRows}</table>
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

  // Reported directly: "no subject teachers name" — this table never
  // showed c.teacherName at all (only subject + text), unlike both newer
  // layouts' own subject-comment tables. Brought to parity: Subject |
  // Teacher | Comment, same column shape marks_then_comments already uses.
  const subjectCommentRows = s.comments.subjectComments.map(c => `
    <tr><td style="${tdS};font-weight:600;width:150px;vertical-align:top">${_esc(c.subjectName)}</td>
        <td style="${tdS};font-weight:600;width:130px;vertical-align:top;color:#475569">${c.teacherName ? _esc(c.teacherName) : '<span style="color:#cbd5e1;font-style:italic">Unassigned</span>'}</td>
        <td style="${tdS};font-size:11px;color:#475569">${c.text ? _esc(c.text) : '<span style="color:#cbd5e1;font-style:italic">No comment entered</span>'}</td></tr>`).join('');

  // RC7 — a disabled capability leaves zero trace: no section header, no
  // table, no placeholder. Genuinely-empty-but-enabled (a report with no
  // subjects) keeps the existing "No subjects on this report" placeholder.
  const subjectCommentsSectionHtml = s.comments.subjectTeacherCommentsEnabled ? `
  <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 6px">Subject Teacher Comments</p>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:11px">
    <thead><tr><th style="${thS};text-align:left">Subject</th><th style="${thS};text-align:left">Teacher</th><th style="${thS};text-align:left">Comment</th></tr></thead>
    <tbody>${subjectCommentRows || `<tr><td colspan="3" style="${tdS};color:#94a3b8;font-style:italic">No subjects on this report.</td></tr>`}</tbody>
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
    ${s.comments.showClassTeacherRemark ? _remarkSignOffHtml({
      roleLabel: s.signatures.classTeacherLabel, personName: s.comments.classTeacherName,
      remarkText: s.comments.classTeacherRemark, signDate: s.footer.signDate,
    }) : ''}
    ${s.comments.showPrincipalRemark ? _remarkSignOffHtml({
      roleLabel: s.signatures.principalLabel, personName: s.comments.principalName,
      remarkText: s.comments.principalRemark, signatureUrl: s.signatures.principalSignatureUrl,
      stampUrl: s.signatures.schoolStampUrl, signDate: s.footer.signDate,
    }) : ''}
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
  ${_observationRatingsHtml(s)}
  ${subjectCommentsSectionHtml}
  ${reportRemarksSectionHtml}
  ${_sportsAndTalentHtml(s)}
  ${_termDatesFooterHtml(s)}
</div>`;

  // beh is already null when showBehaviourSection is off OR there's
  // genuinely no data for the term (_computeReportSections's own
  // showBehaviourSection gate) — this used to force its own page
  // ("page-break-before:always") regardless, showing only a "No
  // behaviour records found" placeholder on an otherwise-blank page.
  // Skipped entirely now, same "zero trace when disabled" rule every
  // other optional section here follows, and the same pattern
  // marks_then_comments' own behHtml already uses.
  const beh = s.behaviour;
  const behHtml = beh ? `
<div style="${pb}">
  <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:14px;border-bottom:2px solid #1e293b;padding-bottom:10px">
    ${logoSmallHtml}
    <div style="text-align:center">
      <h2 style="margin:0 0 2px;font-size:16px;font-weight:800">${_esc(s.header.schoolName)}</h2>
      <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1px">BEHAVIOUR REPORT — ${_esc(s.studentInfo.studentName)}</p>
    </div>
  </div>
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
  </div>
</div>` : '';

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

/* ── Shared cover page (RCE3/4) ──────────────────────────────────
   Consumed by both new layouts, never by legacy_tabular (which keeps
   its own inline header exactly as before). Built from the named
   `cover` fields RCE1 added, not the generic `rows` list — a real
   cover page controls its own visual arrangement of stream/house/
   class teacher/principal rather than a fixed label/value table. */
function _schoolContactLine(cover) {
  return [cover.schoolAddress, cover.schoolPhone, cover.schoolEmail, cover.schoolWebsite].filter(Boolean).join('  •  ');
}

// Cover-page identity header — redesigned per a shared reference layout:
// logo on the left, school name/address/phone+email stacked on the right
// (left-aligned), instead of everything centered in one column. The data
// itself already existed (schoolAddress/schoolPhone/schoolEmail —
// school profile fields, set in Settings — reported directly: "the
// header info of cover page are found in schools settings"); this is a
// layout change, not a new data source. Shared between legacy_tabular's
// own inline cover and the subject_paired/marks_then_comments cover so
// the two can't drift apart.
function _schoolHeaderHtml(cover, logoHtml) {
  const addressLine = cover.schoolAddress || '';
  const contactSubLine = [cover.schoolPhone, cover.schoolEmail].filter(Boolean).join('   ');
  return `
  <div style="display:flex;align-items:center;gap:18px;text-align:left">
    ${logoHtml}
    <div>
      <h1 style="font-size:20px;font-weight:800;margin:0 0 4px;color:#0f172a">${_esc(cover.schoolName)}</h1>
      ${cover.tagline ? `<p style="font-size:11px;font-style:italic;color:#64748b;margin:0 0 4px">${_esc(cover.tagline)}</p>` : ''}
      ${addressLine ? `<p style="font-size:10px;color:#475569;margin:0 0 2px">${_esc(addressLine)}</p>` : ''}
      ${contactSubLine ? `<p style="font-size:10px;color:#475569;margin:0">${_esc(contactSubLine)}</p>` : ''}
      ${cover.schoolWebsite ? `<p style="font-size:10px;color:#475569;margin:0">${_esc(cover.schoolWebsite)}</p>` : ''}
    </div>
  </div>`;
}

function _renderCoverHtml(s) {
  const cover = s.cover;
  const logoHtml = cover.logoUrl
    ? `<img src="${_esc(cover.logoUrl)}" style="height:100px;width:100px;object-fit:contain;border-radius:8px" />`
    : `<div style="width:100px;height:100px;background:#e2e8f0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:bold;color:#94a3b8">${_esc((cover.schoolName?.[0] ?? 'S').toUpperCase())}</div>`;
  const photoHtml = cover.studentPhotoUrl
    ? `<img src="${_esc(cover.studentPhotoUrl)}" style="width:110px;height:135px;object-fit:cover;border:1px solid #cbd5e1;border-radius:4px" />`
    : `<div style="width:110px;height:135px;background:#e2e8f0;border:1px solid #cbd5e1;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#94a3b8">PHOTO</div>`;

  const infoRows = [
    ['Student Name', cover.studentName], ['Admission No.', cover.admissionNo],
    ['Class', cover.className], ['Stream', cover.streamName || '—'], ['House', cover.houseName || '—'],
    ['Class Teacher', cover.classTeacherName || '—'], ['Principal', cover.principalName || '—'],
  ].map(([label, value]) => `
    <tr><td style="padding:7px 14px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc;width:40%">${_esc(label)}</td>
        <td style="padding:7px 14px;border:1px solid #e2e8f0;font-weight:700">${_esc(value)}</td></tr>`).join('');

  // No "Generated by Msingi..." line, and min-height:260mm not 277mm —
  // see _renderLegacyTabularHtml's identical cover for the full
  // reasoning on both (redundant text line; 277mm exceeds the 267mm
  // actually printable on an A4 page under this file's own @page{margin:
  // 1.5cm} rule, guaranteeing a near-blank second page on every print).
  // Header redesigned per a shared reference layout — see
  // _schoolHeaderHtml's own comment.
  return `
<div style="min-height:260mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center">
  ${_schoolHeaderHtml(cover, logoHtml)}
  <div>
    <div style="display:inline-block;background:#1e293b;color:#fff;padding:8px 28px;border-radius:6px;font-size:14px;font-weight:700;letter-spacing:1.5px">
      ${_esc(cover.title)}
    </div>
    <p style="font-size:11px;color:#64748b;margin:8px 0 0">Academic Year ${_esc(cover.academicYear)} &middot; Term ${_esc(cover.termNumber ?? '—')}</p>
  </div>
  ${photoHtml}
  <table style="border-collapse:collapse;width:440px;font-size:12px">${infoRows}</table>
</div>`;
}

// RCE8 — compact header + learner identity, no longer a full centered
// page of its own (reviewer: "Do not reserve a full page for learner
// identity unless the content actually requires it... allowed to begin
// on page 1 after the learner identity section"). Draws at the top of
// whatever page is current and returns the Y it finished at, so the
// caller can continue the results table immediately below it on the
// same page instead of forcing addPage(). A real school logo renders
// as an <img> when images.schoolLogo was fetched (school.logoUrl set);
// otherwise the same letter-avatar fallback the HTML renderer already
// used, now drawn in the brand palette instead of a generic grey circle.
function _drawCoverPdf(doc, s, images) {
  _registerReportFonts(doc);
  const cover = s.cover;
  const PAGE_WIDTH = doc.page.width - 80;
  const X = 40;
  let y = 40;

  if (s.watermarkText) {
    doc.save().translate(doc.page.width / 2, doc.page.height / 2).rotate(-45)
       .fontSize(90).fillOpacity(0.06).fillColor('#cc0000')
       .text(s.watermarkText, -200, -45, { width: 400, align: 'center' })
       .restore();
  }

  // Masthead — logo left, name/tagline/contact stacked right, left-
  // aligned (reviewer: "the header info of cover page are found in
  // schools settings"; premium institutional, not centered ceremony).
  const LOGO = 54;
  if (images.schoolLogo) {
    try { doc.image(images.schoolLogo, X, y, { width: LOGO, height: LOGO, fit: [LOGO, LOGO] }); }
    catch (_) { _drawLogoFallbackPdf(doc, cover, X, y, LOGO); }
  } else {
    _drawLogoFallbackPdf(doc, cover, X, y, LOGO);
  }
  const textX = X + LOGO + 14, textW = PAGE_WIDTH - LOGO - 14;
  doc.fillColor(INK).font(FONTS.serifSemibold).fontSize(16).text(cover.schoolName, textX, y, { width: textW });
  let ty = y + 20;
  if (cover.tagline) {
    doc.fillColor(INK_SOFT).font(FONTS.sansItalic).fontSize(9).text(cover.tagline, textX, ty, { width: textW });
    ty += 13;
  }
  const addressLine = cover.schoolAddress || '';
  const contactSubLine = [cover.schoolPhone, cover.schoolEmail].filter(Boolean).join('   ');
  if (addressLine)     { doc.fillColor(INK_SOFT).font(FONTS.sansRegular).fontSize(8).text(addressLine, textX, ty, { width: textW }); ty += 11; }
  if (contactSubLine)  { doc.fillColor(INK_SOFT).font(FONTS.sansRegular).fontSize(8).text(contactSubLine, textX, ty, { width: textW }); ty += 11; }
  y = Math.max(y + LOGO, ty) + 10;

  doc.moveTo(X, y).lineTo(X + PAGE_WIDTH, y).lineWidth(1.2).stroke(BRAND);
  y += 11;

  // Period bar — kicker left, year/term right.
  doc.fillColor(ACCENT).font(FONTS.sansSemibold).fontSize(8.5).text((cover.title || 'ACADEMIC REPORT').toUpperCase(), X, y);
  doc.fillColor(INK_SOFT).font(FONTS.monoRegular).fontSize(9.5)
     .text(`${cover.academicYear || '—'}  ·  Term ${cover.termNumber ?? '—'}`, X, y, { width: PAGE_WIDTH, align: 'right' });
  y += 21;

  // Learner identity — name (serif, dominant) + class/admission subline
  // + a 2-column meta grid, photo fixed at the right.
  const PHOTO_W = 62, PHOTO_H = 76;
  const identityW = PAGE_WIDTH - PHOTO_W - 16;
  doc.fillColor(INK).font(FONTS.serifSemibold).fontSize(20).text(cover.studentName, X, y, { width: identityW });
  y += 25;
  const subline = [cover.className, cover.admissionNo ? `Admission ${cover.admissionNo}` : null].filter(Boolean).join('   ·   ');
  doc.fillColor(INK_SOFT).font(FONTS.sansRegular).fontSize(9).text(subline.toUpperCase(), X, y, { width: identityW });
  y += 17;

  const metaRows = [
    ['Class Teacher', cover.classTeacherName || '—'], ['Stream', cover.streamName || '—'],
    ['House', cover.houseName || '—'], ['Principal', cover.principalName || '—'],
  ];
  const metaColW = identityW / 2, metaStartY = y;
  metaRows.forEach(([label, value], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const mx = X + col * metaColW, my = metaStartY + row * 25;
    doc.fillColor(INK_FAINT).font(FONTS.sansRegular).fontSize(6.5).text(label.toUpperCase(), mx, my, { width: metaColW - 10 });
    doc.fillColor(INK).font(FONTS.sansMedium).fontSize(9).text(value, mx, my + 9, { width: metaColW - 10 });
  });
  const identityBottom = metaStartY + Math.ceil(metaRows.length / 2) * 25;

  const photoX = X + PAGE_WIDTH - PHOTO_W;
  doc.rect(photoX - 1, y - 1, PHOTO_W + 2, PHOTO_H + 2).stroke(RULE);
  if (images.studentPhoto) {
    try { doc.image(images.studentPhoto, photoX, y, { width: PHOTO_W, height: PHOTO_H, cover: [PHOTO_W, PHOTO_H] }); }
    catch (_) { doc.rect(photoX, y, PHOTO_W, PHOTO_H).fill(SURFACE); }
  } else {
    doc.rect(photoX, y, PHOTO_W, PHOTO_H).fill(SURFACE);
    doc.fillColor(INK_FAINT).font(FONTS.sansRegular).fontSize(7).text('PHOTO', photoX, y + PHOTO_H / 2 - 4, { width: PHOTO_W, align: 'center' });
  }

  y = Math.max(identityBottom, y + PHOTO_H) + 16;
  doc.moveTo(X, y).lineTo(X + PAGE_WIDTH, y).lineWidth(0.75).stroke(RULE_SOFT);
  return y + 10;
}

function _drawLogoFallbackPdf(doc, cover, x, y, size) {
  doc.circle(x + size / 2, y + size / 2, size / 2).fill(BRAND_WASH);
  doc.fillColor(BRAND).font(FONTS.serifSemibold).fontSize(Math.round(size * 0.37))
     .text((cover.schoolName?.[0] || 'S').toUpperCase(), x, y + size / 2 - size * 0.19, { width: size, align: 'center' });
}

/* ── Dynamic PDF text boxes (RCE3b) ──────────────────────────────
   Fixed-height rects drawn independently of `.text()` calls will let
   long text visually overflow past the box (pdfkit's `.text()` wraps
   at `width` but never clips or truncates, and a rect drawn beforehand
   at a hardcoded height has no relationship to how much text actually
   follows). `_measureFlowBox`/`_drawFlowBox` size the box from the
   real content via `doc.heightOfString()` first — call the measure
   function before `ensureSpace()` so pagination decisions also use the
   real height, not a guess. */
function _measureFlowBox(doc, width, blocks) {
  const PAD_TOP = 6, PAD_BOTTOM = 6, PAD_X = 6;
  let h = PAD_TOP;
  blocks.forEach((b, i) => {
    doc.font(b.font || 'Helvetica').fontSize(b.fontSize || 8);
    const bh = doc.heightOfString(b.text, { width: width - PAD_X * 2 });
    h += bh + (i < blocks.length - 1 ? (b.gapAfter ?? 3) : 0);
  });
  h += PAD_BOTTOM;
  return Math.max(h, 24);
}

function _drawFlowBox(doc, x, y, width, blocks) {
  const PAD_TOP = 6, PAD_X = 6;
  const h = _measureFlowBox(doc, width, blocks);
  doc.rect(x, y, width, h).fill('white').stroke('#d1d5db');
  let ty = y + PAD_TOP;
  blocks.forEach((b, i) => {
    doc.fillColor(b.color || '#1a1a2e').font(b.font || 'Helvetica').fontSize(b.fontSize || 8)
       .text(b.text, x + PAD_X, ty, { width: width - PAD_X * 2 });
    const bh = doc.heightOfString(b.text, { width: width - PAD_X * 2 });
    ty += bh + (i < blocks.length - 1 ? (b.gapAfter ?? 3) : 0);
  });
  return h;
}

/* ── RCE8 shared components — overall-performance anchor, observation
   ratings (pills, not a checkbox grid), and one signer's sign-off block.
   Each has a _measure.../_draw... pair so callers can ensureSpace() the
   real height first, keeping the whole block atomic (never split across
   a page boundary) exactly like _measureFlowBox/_drawFlowBox already do
   for comment boxes. Used by both subject_paired and marks_then_comments
   — legacy_tabular is untouched (frozen). ── */
function _measureOverallPerformancePdf(doc, s, width) {
  _registerReportFonts(doc);
  const BOX_H = 70;
  let h = BOX_H + 14;
  if (s.gradingKey.length) {
    const strip = s.gradingKey.map(b => `${b.grade} ${b.range}`).join('     ');
    doc.font(FONTS.monoRegular).fontSize(9);
    h += 12 + doc.heightOfString(strip, { width }) + 4;
  }
  return h;
}

function _drawOverallPerformancePdf(doc, s, x, width, y) {
  _registerReportFonts(doc);
  const BOX_H = 70, PAD = 18;
  doc.roundedRect(x, y, width, BOX_H, 4).fill(BRAND_WASH);
  doc.fillColor(ACCENT).font(FONTS.sansSemibold).fontSize(9).text('OVERALL PERFORMANCE', x + PAD, y + 13);

  // Headline — the average (when shown) is the dominant figure, else
  // total score; meanGrade is the same resolveGrade() lookup the cover's
  // "Mean Mark" row already used, just exposed to renderers directly
  // (RCE8 — not a new/invented data point).
  const headline = s.summary.showAverage && s.summary.averageScore != null
    ? `${s.summary.averageScore.toFixed(1)}%` : (s.summary.totalScore != null ? s.summary.totalScore.toFixed(1) : '—');
  doc.fillColor(INK).font(FONTS.serifBold).fontSize(28)
     .text(headline + (s.summary.meanGrade ? `  ${s.summary.meanGrade}` : ''), x + PAD, y + 25);

  const subParts = [];
  if (s.summary.totalScore != null) subParts.push(`Total ${s.summary.totalScore.toFixed(1)}`);
  if (s.summary.subjectCount) subParts.push(`${s.summary.subjectCount} subject${s.summary.subjectCount === 1 ? '' : 's'}`);
  if (s.summary.showGPA) subParts.push(s.summary.gpaText);
  if (s.summary.showRanking && s.summary.rankText) subParts.push(s.summary.rankText);
  doc.fillColor(INK_SOFT).font(FONTS.monoRegular).fontSize(9).text(subParts.join('   ·   '), x + PAD, y + 56, { width: width - PAD * 2 });

  let ny = y + BOX_H + 14;
  if (s.gradingKey.length) {
    doc.fillColor(INK_SOFT).font(FONTS.sansSemibold).fontSize(8).text('GRADING SCALE', x, ny);
    ny += 12;
    const strip = s.gradingKey.map(b => `${b.grade} ${b.range}`).join('     ');
    doc.fillColor(INK_FAINT).font(FONTS.monoRegular).fontSize(9).text(strip, x, ny, { width });
    ny += doc.heightOfString(strip, { width }) + 4;
  }
  return ny;
}

function _measureObservationRatingsPdf(s) {
  if (!s.comments.showObservationRatings || !s.comments.observationRatings.length) return 0;
  return 16 + s.comments.observationRatings.length * 20 + 4;
}

// Each category shows its selected rating as a filled pill — obvious at
// a glance — or "Not yet rated" in muted italic when null. Replaces the
// old 3-column Excellent/Good/Improve checkbox table, whose empty boxes
// read like an incomplete paper form when nothing was rated yet.
function _drawObservationRatingsPdf(doc, s, x, width, y) {
  if (!s.comments.showObservationRatings || !s.comments.observationRatings.length) return y;
  _registerReportFonts(doc);
  doc.fillColor(INK_SOFT).font(FONTS.sansSemibold).fontSize(9).text('CLASS TEACHER OBSERVATIONS', x, y);
  y += 16;
  doc.lineWidth(0.75).moveTo(x, y).lineTo(x + width, y).stroke(RULE_SOFT);
  const ROW_H = 20;
  s.comments.observationRatings.forEach(({ category, rating }) => {
    doc.fillColor(INK).font(FONTS.sansRegular).fontSize(10).text(category, x, y + 5, { width: width * 0.6 });
    if (rating) {
      const label = rating.charAt(0).toUpperCase() + rating.slice(1);
      doc.font(FONTS.sansBold).fontSize(9);
      const pillW = doc.widthOfString(label) + 20;
      const pillX = x + width - pillW;
      doc.roundedRect(pillX, y + 2, pillW, 15, 3).fill(BRAND_WASH);
      doc.fillColor(BRAND).text(label, pillX, y + 6, { width: pillW, align: 'center' });
    } else {
      doc.fillColor(INK_FAINT).font(FONTS.sansItalic).fontSize(9).text('Not yet rated', x, y + 6, { width, align: 'right' });
    }
    y += ROW_H;
    doc.lineWidth(0.5).moveTo(x, y - 1).lineTo(x + width, y - 1).stroke(RULE_SOFT);
  });
  return y + 6;
}

function _measureSignOffPdf(doc, width, remarkText) {
  _registerReportFonts(doc);
  const PAD_X = 16, BANNER_H = 24, BODY_GAP = 10, SIGROW_H = 46;
  doc.font(FONTS.sansRegular).fontSize(9.5);
  const textH = doc.heightOfString(remarkText || '', { width: width - PAD_X * 2 });
  return BANNER_H + BODY_GAP + textH + SIGROW_H + 10;
}

// One signer's full block — banner, remark text, then signature image
// (above the line) / name+role (below it) / date alongside. Used for
// both the Class Teacher's General Comment and the Principal's Comment
// — stampImg is only ever passed for the Principal (no "class teacher
// stamp" concept), same posture the HTML renderer's _remarkSignOffHtml
// already follows. Always one atomic block (ensureSpace the full
// _measureSignOffPdf height before calling this).
function _drawSignOffPdf(doc, x, y, width, { roleLabel, personName, remarkText, signatureImg, stampImg, signDate }) {
  _registerReportFonts(doc);
  const PAD_X = 16, BANNER_H = 24, SIGROW_H = 46;
  doc.font(FONTS.sansRegular).fontSize(9.5);
  const textH = doc.heightOfString(remarkText || '', { width: width - PAD_X * 2 });
  const totalH = BANNER_H + 10 + textH + SIGROW_H + 10;

  doc.lineWidth(1).roundedRect(x, y, width, totalH, 5).stroke(RULE);
  doc.rect(x, y, width, BANNER_H).fill(BRAND);
  doc.fillColor('white').font(FONTS.sansSemibold).fontSize(9)
     .text(`${roleLabel}'s General Comment`.toUpperCase(), x, y + 8, { width, align: 'center' });

  let ty = y + BANNER_H + 10;
  doc.fillColor(INK_SOFT).font(FONTS.sansRegular).fontSize(9.5).text(remarkText || '', x + PAD_X, ty, { width: width - PAD_X * 2 });
  ty += textH + 12;

  const sigW = 150;
  if (signatureImg) {
    try { doc.image(signatureImg, x + PAD_X, ty - 20, { height: 22, fit: [sigW, 22] }); } catch (_) { /* non-fatal */ }
  }
  const lineY = ty + 4;
  doc.lineWidth(0.75).moveTo(x + PAD_X, lineY).lineTo(x + PAD_X + sigW, lineY).stroke(INK);
  doc.fillColor(INK).font(FONTS.sansRegular).fontSize(9).text(personName || '—', x + PAD_X, lineY + 4, { width: sigW });
  doc.fillColor(INK_SOFT).font(FONTS.sansSemibold).fontSize(8).text(roleLabel, x + PAD_X, lineY + 15, { width: sigW });
  if (stampImg) {
    try { doc.image(stampImg, x + width - PAD_X - 44, ty - 16, { height: 38, fit: [44, 38] }); } catch (_) { /* non-fatal */ }
  }
  if (signDate) {
    doc.fillColor(INK_FAINT).font(FONTS.sansRegular).fontSize(8.5)
       .text(`Date: ${signDate}`, x, lineY + 4, { width: width - PAD_X, align: 'right' });
  }
  return y + totalH;
}

/* ── subject_paired (RCE3): every subject's marks row is immediately
   followed by that subject's own teacher comment row, so a parent
   reads feedback right next to the score it's about, instead of
   scanning a separate comments page. ── */
function _renderSubjectPairedPdf(doc, s, images, isFirstPage) {
  _registerReportFonts(doc);
  if (!isFirstPage) doc.addPage();

  const X = 40;
  const PAGE_WIDTH = doc.page.width - 80;
  const BOTTOM     = doc.page.height - 55;

  // RCE8 — cover no longer owns a whole page; the results table starts
  // directly beneath it on page 1 whenever there's room (reviewer: "Do
  // not reserve a full page for learner identity unless the content
  // actually requires it").
  let rowY = _drawCoverPdf(doc, s, images);

  const typeEntries = s.resultsTable.typeEntries;
  const showDev = s.resultsTable.showDeviation;
  const W_SUBJECT = 150, W_SCORE = 42, W_GRADE = 42, W_DEV = showDev ? 40 : 0;
  const fixedTotal = W_SUBJECT + W_SCORE + W_GRADE + W_DEV;
  const totalGaps  = (typeEntries.length + (showDev ? 3 : 2)) * 5;
  const W_TYPE = typeEntries.length > 0
    ? Math.max(34, Math.floor((PAGE_WIDTH - fixedTotal - totalGaps) / typeEntries.length))
    : 0;
  // RCE3c — column headers use the assessment type's short KEY (CA/HW/
  // MT/ET, exactly what the school configured, e.g. server/routes/
  // assessment.js's DEFAULT_CUSTOM_TYPES) rather than typeEntries[i].label
  // (derived from the full-word label via whitespace/slash splitting —
  // "Continuous Assessment" -> "Continuous", never "CA"). The final
  // per-subject computed score is headed "AVG", not "Score" — it is a
  // weighted average across the type columns, not a single mark.
  const colDefs = [
    { label: 'Subject', width: W_SUBJECT },
    ...typeEntries.map(t => ({ label: t.key, width: W_TYPE })),
    { label: 'AVG', width: W_SCORE },
    { label: 'Grade', width: W_GRADE },
    ...(showDev ? [{ label: 'Dev', width: W_DEV }] : []),
  ];
  const colWidths = colDefs.map(c => c.width);
  const colX = []; let cx = X;
  for (const w of colWidths) { colX.push(cx); cx += w + 5; }

  function drawColumnHeader(y) {
    doc.rect(X, y, PAGE_WIDTH, 16).fill(BRAND);
    doc.fillColor('white').font(FONTS.sansSemibold).fontSize(7.5);
    colDefs.forEach((col, i) => doc.text(col.label, colX[i] + 3, y + 4, { width: colWidths[i] - 3, align: 'center' }));
    return y + 16;
  }
  // Page 1's column-header strip sits right under the cover (which
  // already carries school/student identity, so no repeating dark band
  // is needed there). A page added mid-list gets a slim one-line
  // context repeat first, so a parent who flips straight to a later
  // page isn't lost.
  rowY = drawColumnHeader(rowY) + 4;
  function drawContinuationHeader() {
    doc.fillColor(INK_FAINT).font(FONTS.sansRegular).fontSize(8)
       .text(`${s.studentInfo.studentName}  ·  ${s.studentInfo.className}  ·  ${s.studentInfo.termLine}`, X, 40, { width: PAGE_WIDTH });
    return drawColumnHeader(56) + 4;
  }
  function ensureSpace(h) {
    if (rowY + h > BOTTOM) { doc.addPage(); rowY = drawContinuationHeader(); }
  }

  /* SUBJECT ROWS — marks row + comment row directly beneath each,
     measured together so the pair can never be split across a page
     boundary (reviewer: "If it cannot fit in the remaining page
     space, move the complete block to the next page"). */
  s.resultsTable.rows.forEach(row => {
    const commentEnabled = s.comments.subjectTeacherCommentsEnabled;
    const commentEntry   = s.comments.subjectComments.find(c => c.subjectId === row.subjectId);
    const commentText    = commentEntry?.text || '';
    // RCE3c — labels the comment with the actual subject teacher's name
    // (resolved from teaching_assignments by the caller) when known,
    // falling back to a generic label when no assignment exists (e.g.
    // subjectAssignmentEnforced is off, or no teaching_assignments doc
    // was ever created for this class+subject).
    const commentLabel   = commentEntry?.teacherName ? `${commentEntry.teacherName}:` : 'Subject Teacher:';
    const commentBlocks  = commentEnabled ? [
      ...(row.remarksText ? [{ text: `Grade remark: ${row.remarksText}`, font: FONTS.sansItalic, fontSize: 7.5, color: INK_SOFT }] : []),
      { text: commentLabel, font: FONTS.sansBold, fontSize: 7.5, color: INK_SOFT, gapAfter: 2 },
      { text: commentText || '— No comment entered —', font: FONTS.sansRegular, fontSize: 8.5, color: commentText ? INK : INK_FAINT },
    ] : [];
    const commentH = commentEnabled ? _measureFlowBox(doc, PAGE_WIDTH, commentBlocks) : 0;
    ensureSpace(18 + commentH + 4);

    doc.rect(X, rowY, PAGE_WIDTH, 18).fill(row.failed ? '#fdecea' : SURFACE);
    doc.fillColor(row.failed ? FAIL_RED : INK).font(FONTS.serifSemibold).fontSize(9)
       .text(row.nameLine, colX[0] + 3, rowY + 4.5, { width: colWidths[0] - 3 });
    row.typeValues.forEach((val, ti) => {
      const ci = 1 + ti;
      doc.fillColor(INK_SOFT).font(FONTS.monoRegular).fontSize(8.5)
         .text(val, colX[ci] + 3, rowY + 5, { width: colWidths[ci] - 3, align: 'center' });
    });
    const scoreIdx = 1 + typeEntries.length, gradeIdx = scoreIdx + 1, devIdx = gradeIdx + 1;
    doc.fillColor(INK).font(FONTS.monoMedium).fontSize(8.5)
       .text(row.scoreText, colX[scoreIdx] + 3, rowY + 5, { width: colWidths[scoreIdx] - 3, align: 'center' });
    doc.font(FONTS.serifBold).fontSize(9.5).fillColor(row.hasGrade ? (row.failed ? FAIL_RED : INK) : INK_FAINT)
       .text(row.gradeText, colX[gradeIdx] + 3, rowY + 4, { width: colWidths[gradeIdx] - 3, align: 'center' });
    if (showDev) {
      const devColor = row.deviationText == null ? INK_FAINT : (row.deviationText.startsWith('-') ? FAIL_RED : PASS_GREEN);
      doc.font(FONTS.monoRegular).fontSize(8).fillColor(devColor)
         .text(row.deviationText ?? '—', colX[devIdx] + 3, rowY + 5, { width: colWidths[devIdx] - 3, align: 'center' });
    }
    rowY += 18;

    if (commentEnabled) {
      _drawFlowBox(doc, X, rowY, PAGE_WIDTH, commentBlocks);
      rowY += commentH;
    }
    rowY += 5;
  });

  if (s.resultsTable.rankingNote) {
    ensureSpace(14);
    doc.fillColor(INK_FAINT).font(FONTS.sansRegular).fontSize(7.5).text(s.resultsTable.rankingNote, X, rowY, { width: PAGE_WIDTH });
    rowY += 14;
  }

  // RCE8 — from here on, nothing is a marks row, so a page added mid-
  // closing-section must not repeat the CA/HW/MT/ET column-header strip
  // (confusing — there's no table to label). Just the slim one-line
  // context repeat.
  function drawBareContinuationHeader() {
    doc.fillColor(INK_FAINT).font(FONTS.sansRegular).fontSize(8)
       .text(`${s.studentInfo.studentName}  ·  ${s.studentInfo.className}  ·  ${s.studentInfo.termLine}`, X, 40, { width: PAGE_WIDTH });
    doc.lineWidth(0.75).moveTo(X, 54).lineTo(X + PAGE_WIDTH, 54).stroke(RULE_SOFT);
    return 64;
  }
  function ensureSpaceAfterResults(h) {
    if (rowY + h > BOTTOM) { doc.addPage(); rowY = drawBareContinuationHeader(); }
  }

  /* OVERALL PERFORMANCE + GRADING KEY — one atomic block (reviewer:
     "Overall result + grading key must be treated as an atomic block.
     No text, value, label or border may be clipped at a page boundary"). */
  rowY += 6;
  ensureSpaceAfterResults(_measureOverallPerformancePdf(doc, s, PAGE_WIDTH));
  rowY = _drawOverallPerformancePdf(doc, s, X, PAGE_WIDTH, rowY);

  /* ATTENDANCE */
  if (s.attendance) {
    ensureSpaceAfterResults(30);
    doc.rect(X, rowY, PAGE_WIDTH, 26).fill(SURFACE).stroke(RULE);
    doc.fillColor(INK_SOFT).font(FONTS.sansSemibold).fontSize(8).text('ATTENDANCE', X + 10, rowY + 4);
    doc.fillColor(INK).font(FONTS.sansRegular).fontSize(9).text(s.attendance.text, X + 10, rowY + 14, { width: PAGE_WIDTH - 20 });
    rowY += 30 + 10;
  }

  /* BEHAVIOUR */
  if (s.behaviour) {
    ensureSpaceAfterResults(60);
    doc.fillColor(INK_SOFT).font(FONTS.sansSemibold).fontSize(9).text('BEHAVIOUR', X, rowY);
    rowY += 14;
    const tiles = [
      { label: 'Merits', value: s.behaviour.merits, color: PASS_GREEN },
      { label: 'Demerits', value: s.behaviour.demerits, color: FAIL_RED },
      { label: 'Net Points', value: s.behaviour.points, color: s.behaviour.points >= 0 ? PASS_GREEN : FAIL_RED },
      { label: 'Total', value: s.behaviour.total, color: INK_SOFT },
    ];
    const tileW = (PAGE_WIDTH - 30) / 4;
    tiles.forEach((t, i) => {
      const tx = X + i * (tileW + 10);
      doc.rect(tx, rowY, tileW, 34).stroke(RULE);
      doc.fillColor(INK_FAINT).font(FONTS.sansRegular).fontSize(6.5).text(t.label.toUpperCase(), tx + 6, rowY + 5, { width: tileW - 12, align: 'center' });
      doc.fillColor(t.color).font(FONTS.serifBold).fontSize(14).text(String(t.value), tx, rowY + 15, { width: tileW, align: 'center' });
    });
    rowY += 44 + 10;
  }

  /* CLASS TEACHER OBSERVATIONS — pills, atomic (reviewer: "the selected
     rating should be visually obvious"; "do not make the report look
     like an incomplete paper form full of empty checkboxes"). Off
     unless the school has turned it on and defined at least one
     category, same "zero trace when disabled" rule every other
     optional section here follows. */
  const obsH = _measureObservationRatingsPdf(s);
  if (obsH) {
    ensureSpaceAfterResults(obsH);
    rowY = _drawObservationRatingsPdf(doc, s, X, PAGE_WIDTH, rowY) + 10;
  }

  /* SIGN-OFFS — the RC8 report-remark chain if configured (its own
     flexible N-remark shape doesn't map to a single-signer block, so it
     keeps its original flow-box presentation, just in the new palette);
     otherwise the Class Teacher's General Comment and the Principal's
     Comment each render as their own atomic sign-off block — distinct
     comment types, per the approved design (never silently merged). */
  if (s.comments.reportRemarks.length > 0) {
    s.comments.reportRemarks.forEach(r => {
      const blocks = [{ text: r.text, font: FONTS.sansRegular, fontSize: 9, color: INK }];
      const h = _measureFlowBox(doc, PAGE_WIDTH, blocks);
      ensureSpaceAfterResults(12 + h + 6);
      doc.fillColor(INK_SOFT).font(FONTS.sansSemibold).fontSize(9).text(r.label.toUpperCase() + ':', X, rowY);
      rowY += 12;
      _drawFlowBox(doc, X, rowY, PAGE_WIDTH, blocks);
      rowY += h + 6;
    });
  } else {
    if (s.comments.showClassTeacherRemark) {
      ensureSpaceAfterResults(_measureSignOffPdf(doc, PAGE_WIDTH, s.comments.classTeacherRemark));
      rowY = _drawSignOffPdf(doc, X, rowY, PAGE_WIDTH, {
        roleLabel: s.signatures.classTeacherLabel, personName: s.cover.classTeacherName,
        remarkText: s.comments.classTeacherRemark, signatureImg: null, stampImg: null,
        signDate: s.footer.signDate,
      }) + 10;
    }
    if (s.comments.showPrincipalRemark) {
      ensureSpaceAfterResults(_measureSignOffPdf(doc, PAGE_WIDTH, s.comments.principalRemark));
      rowY = _drawSignOffPdf(doc, X, rowY, PAGE_WIDTH, {
        roleLabel: s.signatures.principalLabel, personName: s.cover.principalName,
        remarkText: s.comments.principalRemark, signatureImg: images.principalSignature || null,
        stampImg: images.schoolStamp || null, signDate: s.footer.signDate,
      }) + 10;
    }
  }

  /* FOOTER — RCE8: was `doc.page.height - 40`, i.e. flush with the
     bottom margin itself; PDFKit treats text drawn right at the margin
     as overflowing it and silently adds a trailing near-blank page just
     to fit it, producing exactly the "near-blank page" the reviewer's
     QA explicitly checks for. -56 matches legacy_tabular's own
     (already-safe) footer offset. */
  const footerY = doc.page.height - 56;
  doc.fillColor(INK_FAINT).font(FONTS.sansRegular).fontSize(7.5)
     .text(s.footer.footerNote, X, footerY, { width: PAGE_WIDTH, align: 'center' });
  if (s.footer.reportId) {
    doc.fillColor(INK_FAINT).font(FONTS.monoRegular).fontSize(6.5)
       .text(`Report ID: ${s.footer.reportId}  |  ${s.footer.genLine}`, X, footerY + 12, { width: PAGE_WIDTH, align: 'center' });
  }
}

function _renderSubjectPairedHtml(s) {
  const watermarkHtml = s.watermarkText
    ? `<div style="position:fixed;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:90px;font-weight:900;color:#cc0000;opacity:0.08;pointer-events:none;white-space:nowrap;z-index:999">${_esc(s.watermarkText)}</div>`
    : '';
  const coverHtml = _renderCoverHtml(s);

  const thS = 'border:1px solid #cbd5e1;padding:5px 8px;background:#1e293b;color:#fff;font-size:9px;text-transform:uppercase;letter-spacing:.5px;text-align:center';
  const tdS = 'border:1px solid #e2e8f0;padding:5px 8px';
  const tdC = `${tdS};text-align:center`;

  // RCE3c — short assessment-type KEY (CA/HW/MT/ET), not the split-derived
  // full-word label; see the identical note in the PDF renderer above.
  const colHeaders = s.resultsTable.typeEntries.map(t => `<th style="${thS}">${_esc(t.key)}</th>`).join('');
  const devHeader   = s.resultsTable.showDeviation ? `<th style="${thS}">Dev</th>` : '';
  // A single header row shown once above the whole subject list — each
  // subject still gets its own small table below (so its comment row can
  // sit directly under it), but a reader needs the column headings
  // visible somewhere, not repeated N times.
  const headerRowHtml = `
    <table style="width:100%;border-collapse:collapse;margin-bottom:4px;font-size:11px">
      <tr><th style="${thS};text-align:left">Subject</th>${colHeaders}<th style="${thS}">AVG</th><th style="${thS}">Grade</th>${devHeader}</tr>
    </table>`;

  const subjectBlocks = s.resultsTable.rows.map(row => {
    const markCells = row.typeValues.map(v => `<td style="${tdC}">${_esc(v)}</td>`).join('');
    const devCell = s.resultsTable.showDeviation
      ? (() => {
          const devColor = row.deviationText == null ? '#94a3b8' : row.deviationText.startsWith('-') ? '#dc2626' : '#16a34a';
          return `<td style="${tdC};color:${devColor};font-weight:600">${row.deviationText == null ? '—' : _esc(row.deviationText)}</td>`;
        })()
      : '';
    const commentEnabled = s.comments.subjectTeacherCommentsEnabled;
    const commentEntry   = s.comments.subjectComments.find(c => c.subjectId === row.subjectId);
    const commentText    = commentEntry?.text || '';
    // RCE3c — actual subject teacher's name when known (resolved from
    // teaching_assignments by the caller), else a generic fallback.
    const commentLabel   = commentEntry?.teacherName ? _esc(commentEntry.teacherName) + ':' : 'Subject Teacher:';
    return `
    <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:11px">
      <tr${row.failed ? ' style="color:#dc2626"' : ''}>
        <td style="${tdS};font-weight:700;min-width:120px">${_esc(row.nameLine)}</td>
        ${markCells}
        <td style="${tdC};font-weight:700">${_esc(row.scoreText)}</td>
        <td style="${tdC};font-weight:700">${_esc(row.gradeText)}</td>
        ${devCell}
      </tr>
      ${commentEnabled ? `
      <tr>
        <td colspan="99" style="border:1px solid #e2e8f0;border-top:none;padding:6px 10px;font-size:10px;color:#475569;background:#fafafa">
          ${row.remarksText ? `<div style="font-style:italic;color:#94a3b8;margin-bottom:2px">Grade remark: ${_esc(row.remarksText)}</div>` : ''}
          <b style="text-transform:uppercase;letter-spacing:.4px;font-size:9px;color:#94a3b8">${commentLabel}</b>
          ${commentText ? _esc(commentText) : '<span style="font-style:italic;color:#cbd5e1"> No comment entered</span>'}
        </td>
      </tr>` : ''}
    </table>`;
  }).join('');

  const gradingRows = s.gradingKey.map(b => `
    <tr><td style="${tdC};font-weight:700">${_esc(b.grade)}</td><td style="${tdC}">${_esc(b.range)}</td>
        <td style="${tdC}">${_esc(b.points)}</td><td style="${tdS}">${_esc(b.label)}</td></tr>`).join('');

  const remarksHtml = s.comments.reportRemarks.length > 0 ? `
  <div style="margin:16px 0">
    ${s.comments.reportRemarks.map(r => `
    <div style="margin-bottom:12px">
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">${_esc(r.label)}</p>
      <div style="border:1px solid #e2e8f0;border-radius:4px;padding:8px 12px;min-height:50px;font-size:11px;color:#475569">${_esc(r.text)}</div>
    </div>`).join('')}
  </div>` : `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:16px 0">
    ${s.comments.showClassTeacherRemark ? `
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">${_esc(s.signatures.classTeacherLabel)}'s Remark</p>
      <div style="border:1px solid #e2e8f0;border-radius:4px;padding:8px 12px;min-height:60px;font-size:11px;color:#475569">${_esc(s.comments.classTeacherRemark)}</div>
    </div>` : ''}
    ${s.comments.showPrincipalRemark ? `
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">${_esc(s.signatures.principalLabel)}'s Comment</p>
      <div style="border:1px solid #e2e8f0;border-radius:4px;padding:8px 12px;min-height:60px;font-size:11px;color:#475569">${_esc(s.comments.principalRemark)}</div>
    </div>` : ''}
  </div>`;

  const behHtml = s.behaviour ? `
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0">
    ${[
      { label: 'Merits', value: s.behaviour.merits, color: '#16a34a' },
      { label: 'Demerits', value: s.behaviour.demerits, color: '#dc2626' },
      { label: 'Net Points', value: s.behaviour.points, color: s.behaviour.points >= 0 ? '#16a34a' : '#dc2626' },
      { label: 'Total', value: s.behaviour.total, color: '#475569' },
    ].map(m => `
    <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px;text-align:center">
      <p style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#94a3b8;margin:0 0 2px">${_esc(m.label)}</p>
      <p style="font-size:20px;font-weight:900;color:${m.color};margin:0">${_esc(m.value)}</p>
    </div>`).join('')}
  </div>` : '';

  // SIGNATURES — this layout's HTML had no equivalent of its own PDF's
  // unconditional signature line at all (reported directly: the stamp
  // and principal's signature didn't show — for this template there
  // wasn't even a line to put them on). Unconditional like the PDF
  // (sigY in _renderSubjectPairedPdf is never gated by either remark
  // toggle), not tied to showClassTeacherRemark/showPrincipalRemark.
  const signaturesHtml = `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0 0">
    <div>
      <div style="border-top:1px solid #1e293b;width:180px;padding-top:4px;font-size:10px;color:#475569">${_esc(s.signatures.classTeacherLabel)}</div>
    </div>
    <div style="position:relative">
      ${_schoolStampImgHtml(s)}
      ${_principalSignatureImgHtml(s)}
      <div style="margin-top:${s.signatures.principalSignatureUrl ? '2px' : '0'};border-top:1px solid #1e293b;width:180px;padding-top:4px;font-size:10px;color:#475569">${_esc(s.signatures.principalLabel)}</div>
    </div>
  </div>`;

  const academicHtml = `
<div style="page-break-before:always">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:2px solid #1e293b;padding-bottom:8px">
    <h2 style="margin:0;font-size:15px;font-weight:800">${_esc(s.header.schoolName)}</h2>
    <p style="margin:0;font-size:10px;color:#64748b">${_esc(s.studentInfo.studentName)} — ${_esc(s.studentInfo.className)} — ${_esc(s.studentInfo.termLine)}</p>
  </div>
  ${headerRowHtml}
  ${subjectBlocks}
  ${s.resultsTable.rankingNote ? `<p style="font-size:9px;color:#64748b;margin:0 0 10px">${_esc(s.resultsTable.rankingNote)}</p>` : ''}
  <table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:11px">
    <tr>
      <td style="${tdS}"><b>${_esc(s.summary.totalText)}</b></td>
      ${s.summary.showAverage ? `<td style="${tdS}"><b>${_esc(s.summary.averageText)}</b></td>` : ''}
      ${s.summary.showGPA ? `<td style="${tdS}">${_esc(s.summary.gpaText)}</td>` : ''}
      ${s.summary.showRanking ? `<td style="${tdS}">${_esc(s.summary.rankText)}</td>` : ''}
    </tr>
  </table>
  ${s.attendance ? `<p style="font-size:11px;color:#475569;margin:0 0 12px"><b>Attendance:</b> ${_esc(s.attendance.text)}</p>` : ''}
  ${s.gradingKey.length ? `
  <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">Grading Key</p>
  <table style="width:100%;border-collapse:collapse;font-size:10px;max-width:480px;margin-bottom:12px">
    <thead><tr><th style="${thS}">Grade</th><th style="${thS}">Range</th><th style="${thS}">Points</th><th style="${thS};text-align:left">Description</th></tr></thead>
    <tbody>${gradingRows}</tbody>
  </table>` : ''}
  ${remarksHtml}
  ${_observationRatingsHtml(s)}
  ${behHtml}
  ${signaturesHtml}
  ${_sportsAndTalentHtml(s)}
  ${_termDatesFooterHtml(s)}
  <p style="text-align:center;font-size:9px;color:#94a3b8;margin-top:16px">${_esc(s.footer.footerNote)} — ${_esc(s.footer.genLine)}${s.footer.reportId ? ` — Report ID: ${_esc(s.footer.reportId)}` : ''}</p>
</div>`;

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
${academicHtml}
</body></html>`;
}

/* ── marks_then_comments (RCE4) — "Subjects First, Comments After":
   shared cover -> one dense marks table for every subject at once (plus
   grading key) -> then every subject's teacher comment together on its
   own page, followed by remarks/behaviour. Distinct from subject_paired,
   which interleaves a comment directly beneath each subject's row —
   this layout is for schools that want a clean, scan-friendly marks
   grid uninterrupted by prose, with feedback read separately after. ── */
function _renderMarksThenCommentsPdf(doc, s, images, isFirstPage) {
  _registerReportFonts(doc);
  if (!isFirstPage) doc.addPage();

  const X = 40;
  const PAGE_WIDTH = doc.page.width - 80;
  const BOTTOM     = doc.page.height - 55;

  // RCE8 — cover no longer owns a whole page; the results table starts
  // directly beneath it on page 1 whenever there's room, same fix as
  // subject_paired's (this layout's own cover/results/commentary/
  // observations/general-comment structure is otherwise unchanged —
  // reviewer: "Template B is much stronger... retain the current
  // overall structure").
  let rowY = _drawCoverPdf(doc, s, images);

  function drawTitleHeader(title) {
    doc.rect(X, 40, PAGE_WIDTH, 40).fill(BRAND);
    doc.fillColor('white').font(FONTS.serifSemibold).fontSize(12)
       .text(s.header.schoolName, X + 10, 49, { width: PAGE_WIDTH - 20 });
    doc.font(FONTS.sansRegular).fontSize(8)
       .text(`${s.studentInfo.studentName} — ${s.studentInfo.className} — ${s.studentInfo.termLine}`, X + 10, 66, { width: PAGE_WIDTH - 20 });
    doc.fillColor(INK_SOFT).font(FONTS.sansSemibold).fontSize(9).text(title, X, 88);
    return 104;
  }

  /* ── MARKS TABLE — same column convention as subject_paired (RCE3c:
     type KEYs not labels, 'AVG' not 'Score'), every subject drawn
     back-to-back with no comment box between rows. ── */
  const typeEntries = s.resultsTable.typeEntries;
  const showDev = s.resultsTable.showDeviation;
  const W_SUBJECT = 150, W_SCORE = 42, W_GRADE = 42, W_DEV = showDev ? 40 : 0;
  const fixedTotal = W_SUBJECT + W_SCORE + W_GRADE + W_DEV;
  const totalGaps  = (typeEntries.length + (showDev ? 3 : 2)) * 5;
  const W_TYPE = typeEntries.length > 0
    ? Math.max(34, Math.floor((PAGE_WIDTH - fixedTotal - totalGaps) / typeEntries.length))
    : 0;
  const colDefs = [
    { label: 'Subject', width: W_SUBJECT },
    ...typeEntries.map(t => ({ label: t.key, width: W_TYPE })),
    { label: 'AVG', width: W_SCORE },
    { label: 'Grade', width: W_GRADE },
    ...(showDev ? [{ label: 'Dev', width: W_DEV }] : []),
  ];
  const colWidths = colDefs.map(c => c.width);
  const colX = []; let cx = X;
  for (const w of colWidths) { colX.push(cx); cx += w + 5; }

  function drawColumnHeader(y) {
    doc.rect(X, y, PAGE_WIDTH, 16).fill(BRAND);
    doc.fillColor('white').font(FONTS.sansSemibold).fontSize(7.5);
    colDefs.forEach((col, i) => doc.text(col.label, colX[i] + 3, y + 4, { width: colWidths[i] - 3, align: 'center' }));
    return y + 16;
  }
  doc.fillColor(INK_SOFT).font(FONTS.sansSemibold).fontSize(9).text('ACADEMIC RESULTS', X, rowY);
  rowY = drawColumnHeader(rowY + 14) + 4;
  function drawMarksContinuationHeader() {
    doc.fillColor(INK_FAINT).font(FONTS.sansRegular).fontSize(8)
       .text(`${s.studentInfo.studentName}  ·  ${s.studentInfo.className}  ·  ${s.studentInfo.termLine}`, X, 40, { width: PAGE_WIDTH });
    return drawColumnHeader(56) + 4;
  }
  function ensureMarksSpace(h) {
    if (rowY + h > BOTTOM) { doc.addPage(); rowY = drawMarksContinuationHeader(); }
  }

  s.resultsTable.rows.forEach(row => {
    ensureMarksSpace(18);
    doc.rect(X, rowY, PAGE_WIDTH, 18).fill(row.failed ? '#fdecea' : SURFACE);
    doc.fillColor(row.failed ? FAIL_RED : INK).font(FONTS.serifSemibold).fontSize(9)
       .text(row.nameLine, colX[0] + 3, rowY + 4.5, { width: colWidths[0] - 3 });
    row.typeValues.forEach((val, ti) => {
      const ci = 1 + ti;
      doc.fillColor(INK_SOFT).font(FONTS.monoRegular).fontSize(8.5)
         .text(val, colX[ci] + 3, rowY + 5, { width: colWidths[ci] - 3, align: 'center' });
    });
    const scoreIdx = 1 + typeEntries.length, gradeIdx = scoreIdx + 1, devIdx = gradeIdx + 1;
    doc.fillColor(INK).font(FONTS.monoMedium).fontSize(8.5)
       .text(row.scoreText, colX[scoreIdx] + 3, rowY + 5, { width: colWidths[scoreIdx] - 3, align: 'center' });
    doc.font(FONTS.serifBold).fontSize(9.5).fillColor(row.hasGrade ? (row.failed ? FAIL_RED : INK) : INK_FAINT)
       .text(row.gradeText, colX[gradeIdx] + 3, rowY + 4, { width: colWidths[gradeIdx] - 3, align: 'center' });
    if (showDev) {
      const devColor = row.deviationText == null ? INK_FAINT : (row.deviationText.startsWith('-') ? FAIL_RED : PASS_GREEN);
      doc.font(FONTS.monoRegular).fontSize(8).fillColor(devColor)
         .text(row.deviationText ?? '—', colX[devIdx] + 3, rowY + 5, { width: colWidths[devIdx] - 3, align: 'center' });
    }
    rowY += 18;
  });

  if (s.resultsTable.rankingNote) {
    ensureMarksSpace(14);
    doc.fillColor(INK_FAINT).font(FONTS.sansRegular).fontSize(7.5).text(s.resultsTable.rankingNote, X, rowY, { width: PAGE_WIDTH });
    rowY += 14;
  }

  // RCE8 — from here on, nothing is a marks row, so a page added
  // mid-closing-section must not repeat the CA/HW/MT/ET column-header
  // strip (same fix as subject_paired — there's no table to label).
  function drawBareContinuationHeader() {
    doc.fillColor(INK_FAINT).font(FONTS.sansRegular).fontSize(8)
       .text(`${s.studentInfo.studentName}  ·  ${s.studentInfo.className}  ·  ${s.studentInfo.termLine}`, X, 40, { width: PAGE_WIDTH });
    doc.lineWidth(0.75).moveTo(X, 54).lineTo(X + PAGE_WIDTH, 54).stroke(RULE_SOFT);
    return 64;
  }
  function ensureSpaceAfterResults(h) {
    if (rowY + h > BOTTOM) { doc.addPage(); rowY = drawBareContinuationHeader(); }
  }

  /* OVERALL PERFORMANCE + GRADING KEY — one atomic block, same as
     subject_paired (reviewer: never split across a page boundary). */
  rowY += 6;
  ensureSpaceAfterResults(_measureOverallPerformancePdf(doc, s, PAGE_WIDTH));
  rowY = _drawOverallPerformancePdf(doc, s, X, PAGE_WIDTH, rowY);

  if (s.attendance) {
    ensureSpaceAfterResults(30);
    doc.rect(X, rowY, PAGE_WIDTH, 26).fill(SURFACE).stroke(RULE);
    doc.fillColor(INK_SOFT).font(FONTS.sansSemibold).fontSize(8).text('ATTENDANCE', X + 10, rowY + 4);
    doc.fillColor(INK).font(FONTS.sansRegular).fontSize(9).text(s.attendance.text, X + 10, rowY + 14, { width: PAGE_WIDTH - 20 });
    rowY += 30;
  }

  /* ── COMMENTS PAGE — every subject's teacher comment together
     (flows naturally; never one subject per page), then observations
     and the two sign-offs. Comments are prefixed "{Subject} —
     {Teacher}:" since they're no longer sitting directly under that
     subject's own marks row (subject_paired's row context is gone
     here, so the subject name has to be restated). ── */
  doc.addPage();
  rowY = drawTitleHeader('SUBJECT TEACHER COMMENTS');
  function ensureCommentsSpace(h) {
    if (rowY + h > BOTTOM) { doc.addPage(); rowY = drawTitleHeader('SUBJECT TEACHER COMMENTS (cont.)'); }
  }

  if (s.comments.subjectTeacherCommentsEnabled) {
    if (s.comments.subjectComments.length === 0) {
      doc.fillColor(INK_FAINT).font(FONTS.sansItalic).fontSize(9).text('No subjects on this report.', X, rowY);
      rowY += 16;
    }
    s.comments.subjectComments.forEach(c => {
      const label = c.teacherName ? `${c.subjectName} — ${c.teacherName}:` : `${c.subjectName} — Subject Teacher:`;
      const commentText = c.text || '';
      const blocks = [
        { text: label, font: FONTS.sansBold, fontSize: 8.5, color: INK, gapAfter: 2 },
        { text: commentText || '— No comment entered —', font: FONTS.sansRegular, fontSize: 8.5, color: commentText ? INK_SOFT : INK_FAINT },
      ];
      const h = _measureFlowBox(doc, PAGE_WIDTH, blocks);
      ensureCommentsSpace(h + 6);
      _drawFlowBox(doc, X, rowY, PAGE_WIDTH, blocks);
      rowY += h + 6;
    });
  }

  /* CLASS TEACHER OBSERVATIONS — pills, atomic. */
  const obsH = _measureObservationRatingsPdf(s);
  if (obsH) {
    ensureCommentsSpace(obsH);
    rowY = _drawObservationRatingsPdf(doc, s, X, PAGE_WIDTH, rowY) + 10;
  }

  if (s.behaviour) {
    ensureCommentsSpace(60);
    doc.fillColor(INK_SOFT).font(FONTS.sansSemibold).fontSize(9).text('BEHAVIOUR', X, rowY);
    rowY += 14;
    const tiles = [
      { label: 'Merits', value: s.behaviour.merits, color: PASS_GREEN },
      { label: 'Demerits', value: s.behaviour.demerits, color: FAIL_RED },
      { label: 'Net Points', value: s.behaviour.points, color: s.behaviour.points >= 0 ? PASS_GREEN : FAIL_RED },
      { label: 'Total', value: s.behaviour.total, color: INK_SOFT },
    ];
    const tileW = (PAGE_WIDTH - 30) / 4;
    tiles.forEach((t, i) => {
      const tx = X + i * (tileW + 10);
      doc.rect(tx, rowY, tileW, 34).stroke(RULE);
      doc.fillColor(INK_FAINT).font(FONTS.sansRegular).fontSize(6.5).text(t.label.toUpperCase(), tx + 6, rowY + 5, { width: tileW - 12, align: 'center' });
      doc.fillColor(t.color).font(FONTS.serifBold).fontSize(14).text(String(t.value), tx, rowY + 15, { width: tileW, align: 'center' });
    });
    rowY += 44 + 10;
  }

  /* SIGN-OFFS — RC8 chain if configured, else the Class Teacher's
     General Comment and the Principal's Comment as their own atomic
     sign-off blocks, same as subject_paired. */
  if (s.comments.reportRemarks.length > 0) {
    s.comments.reportRemarks.forEach(r => {
      const blocks = [{ text: r.text, font: FONTS.sansRegular, fontSize: 9, color: INK }];
      const h = _measureFlowBox(doc, PAGE_WIDTH, blocks);
      ensureCommentsSpace(12 + h + 6);
      doc.fillColor(INK_SOFT).font(FONTS.sansSemibold).fontSize(9).text(r.label.toUpperCase() + ':', X, rowY);
      rowY += 12;
      _drawFlowBox(doc, X, rowY, PAGE_WIDTH, blocks);
      rowY += h + 6;
    });
  } else {
    if (s.comments.showClassTeacherRemark) {
      ensureCommentsSpace(_measureSignOffPdf(doc, PAGE_WIDTH, s.comments.classTeacherRemark));
      rowY = _drawSignOffPdf(doc, X, rowY, PAGE_WIDTH, {
        roleLabel: s.signatures.classTeacherLabel, personName: s.cover.classTeacherName,
        remarkText: s.comments.classTeacherRemark, signatureImg: null, stampImg: null,
        signDate: s.footer.signDate,
      }) + 10;
    }
    if (s.comments.showPrincipalRemark) {
      ensureCommentsSpace(_measureSignOffPdf(doc, PAGE_WIDTH, s.comments.principalRemark));
      rowY = _drawSignOffPdf(doc, X, rowY, PAGE_WIDTH, {
        roleLabel: s.signatures.principalLabel, personName: s.cover.principalName,
        remarkText: s.comments.principalRemark, signatureImg: images.principalSignature || null,
        stampImg: images.schoolStamp || null, signDate: s.footer.signDate,
      }) + 10;
    }
  }

  /* FOOTER — RCE8: see subject_paired's identical fix for why this is
     -56, not the bottom margin itself (-40). */
  const footerY = doc.page.height - 56;
  doc.fillColor(INK_FAINT).font(FONTS.sansRegular).fontSize(7.5)
     .text(s.footer.footerNote, X, footerY, { width: PAGE_WIDTH, align: 'center' });
  if (s.footer.reportId) {
    doc.fillColor(INK_FAINT).font(FONTS.monoRegular).fontSize(6.5)
       .text(`Report ID: ${s.footer.reportId}  |  ${s.footer.genLine}`, X, footerY + 12, { width: PAGE_WIDTH, align: 'center' });
  }
}

function _renderMarksThenCommentsHtml(s) {
  const watermarkHtml = s.watermarkText
    ? `<div style="position:fixed;top:45%;left:50%;transform:translate(-50%,-50%) rotate(-30deg);font-size:90px;font-weight:900;color:#cc0000;opacity:0.08;pointer-events:none;white-space:nowrap;z-index:999">${_esc(s.watermarkText)}</div>`
    : '';
  const coverHtml = _renderCoverHtml(s);

  const thS = 'border:1px solid #cbd5e1;padding:5px 8px;background:#1e293b;color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.5px;text-align:center';
  const tdS = 'border:1px solid #e2e8f0;padding:5px 8px';
  const tdC = `${tdS};text-align:center`;

  const pageHeaderHtml = (title) => `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;border-bottom:2px solid #1e293b;padding-bottom:8px">
    <h2 style="margin:0;font-size:15px;font-weight:800">${_esc(s.header.schoolName)}</h2>
    <p style="margin:0;font-size:10px;color:#64748b">${_esc(s.studentInfo.studentName)} — ${_esc(s.studentInfo.className)} — ${_esc(s.studentInfo.termLine)}</p>
  </div>
  <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#1e293b;margin:0 0 10px">${_esc(title)}</p>`;

  const colHeaders = s.resultsTable.typeEntries.map(t => `<th style="${thS}">${_esc(t.key)}</th>`).join('');
  const devHeader = s.resultsTable.showDeviation ? `<th style="${thS}">Dev</th>` : '';
  const subjectRows = s.resultsTable.rows.map(row => {
    const markCells = row.typeValues.map(v => `<td style="${tdC}">${_esc(v)}</td>`).join('');
    const devCell = s.resultsTable.showDeviation
      ? (() => {
          const devColor = row.deviationText == null ? '#94a3b8' : row.deviationText.startsWith('-') ? '#dc2626' : '#16a34a';
          return `<td style="${tdC};color:${devColor};font-weight:600">${row.deviationText == null ? '—' : _esc(row.deviationText)}</td>`;
        })()
      : '';
    return `
      <tr${row.failed ? ' style="color:#dc2626"' : ''}>
        <td style="${tdS};font-weight:600;min-width:120px">${_esc(row.nameLine)}</td>
        ${markCells}
        <td style="${tdC};font-weight:700">${_esc(row.scoreText)}</td>
        <td style="${tdC};font-weight:700">${_esc(row.gradeText)}</td>
        ${devCell}
      </tr>`;
  }).join('');

  const gradingRows = s.gradingKey.map(b => `
    <tr><td style="${tdC};font-weight:700">${_esc(b.grade)}</td><td style="${tdC}">${_esc(b.range)}</td>
        <td style="${tdC}">${_esc(b.points)}</td><td style="${tdS}">${_esc(b.label)}</td></tr>`).join('');

  const marksHtml = `
<div style="page-break-before:always">
  ${pageHeaderHtml('Academic Results')}
  <table style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11px">
    <tr>
      <td style="${tdS}"><b>${_esc(s.summary.totalText)}</b></td>
      ${s.summary.showAverage ? `<td style="${tdS}"><b>${_esc(s.summary.averageText)}</b></td>` : ''}
      ${s.summary.showGPA ? `<td style="${tdS}">${_esc(s.summary.gpaText)}</td>` : ''}
      ${s.summary.showRanking ? `<td style="${tdS}">${_esc(s.summary.rankText)}</td>` : ''}
    </tr>
  </table>
  <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11px">
    <thead><tr>
      <th style="${thS};text-align:left">Subject</th>${colHeaders}
      <th style="${thS}">AVG</th><th style="${thS}">Grade</th>${devHeader}
    </tr></thead>
    <tbody>${subjectRows}</tbody>
  </table>
  ${s.resultsTable.rankingNote ? `<p style="font-size:9px;color:#64748b;margin:0 0 14px">${_esc(s.resultsTable.rankingNote)}</p>` : ''}
  ${s.attendance ? `<p style="font-size:11px;color:#475569;margin:0 0 14px"><b>Attendance:</b> ${_esc(s.attendance.text)}</p>` : ''}
  ${s.gradingKey.length ? `
  <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">Grading Key</p>
  <table style="width:100%;border-collapse:collapse;font-size:10px;max-width:480px">
    <thead><tr><th style="${thS}">Grade</th><th style="${thS}">Range</th><th style="${thS}">Points</th><th style="${thS};text-align:left">Description</th></tr></thead>
    <tbody>${gradingRows}</tbody>
  </table>` : ''}
</div>`;

  // RCE4 — comments shown as a Subject | Teacher | Comment table (not
  // subject_paired's inline pairing) since these sit on their own page,
  // detached from each subject's marks row — the subject name and
  // teacher both need restating here rather than being implied by context.
  const subjectCommentRows = s.comments.subjectComments.map(c => `
    <tr><td style="${tdS};font-weight:600;width:150px;vertical-align:top">${_esc(c.subjectName)}</td>
        <td style="${tdS};font-weight:600;width:130px;vertical-align:top;color:#475569">${c.teacherName ? _esc(c.teacherName) : '<span style="color:#cbd5e1;font-style:italic">Unassigned</span>'}</td>
        <td style="${tdS};font-size:11px;color:#475569">${c.text ? _esc(c.text) : '<span style="color:#cbd5e1;font-style:italic">No comment entered</span>'}</td></tr>`).join('');

  const subjectCommentsSectionHtml = s.comments.subjectTeacherCommentsEnabled ? `
  <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 6px">Subject Teacher Comments</p>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:11px">
    <thead><tr><th style="${thS};text-align:left">Subject</th><th style="${thS};text-align:left">Teacher</th><th style="${thS};text-align:left">Comment</th></tr></thead>
    <tbody>${subjectCommentRows || `<tr><td colspan="3" style="${tdS};color:#94a3b8;font-style:italic">No subjects on this report.</td></tr>`}</tbody>
  </table>` : '';

  const remarksSectionHtml = s.comments.reportRemarks.length > 0 ? `
  <div style="margin-bottom:16px">
    ${s.comments.reportRemarks.map(r => `
    <div style="margin-bottom:12px">
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">${_esc(r.label)}</p>
      <div style="border:1px solid #e2e8f0;border-radius:4px;padding:8px 12px;min-height:50px;font-size:11px;color:#475569">${_esc(r.text)}</div>
    </div>`).join('')}
  </div>` : `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    ${s.comments.showClassTeacherRemark ? _remarkSignOffHtml({
      roleLabel: s.signatures.classTeacherLabel, personName: s.comments.classTeacherName,
      remarkText: s.comments.classTeacherRemark, signDate: s.footer.signDate,
    }) : ''}
    ${s.comments.showPrincipalRemark ? _remarkSignOffHtml({
      roleLabel: s.signatures.principalLabel, personName: s.comments.principalName,
      remarkText: s.comments.principalRemark, signatureUrl: s.signatures.principalSignatureUrl,
      stampUrl: s.signatures.schoolStampUrl, signDate: s.footer.signDate,
    }) : ''}
  </div>`;

  const beh = s.behaviour;
  const behHtml = beh ? `
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:16px">
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
  </div>` : '';

  const commentsHtml = `
<div style="page-break-before:always">
  ${pageHeaderHtml('Teacher Comments')}
  ${_observationRatingsHtml(s)}
  ${subjectCommentsSectionHtml}
  ${remarksSectionHtml}
  ${behHtml}
  ${_sportsAndTalentHtml(s)}
  ${_termDatesFooterHtml(s)}
  <p style="text-align:center;font-size:9px;color:#94a3b8;margin-top:16px">${_esc(s.footer.footerNote)} — ${_esc(s.footer.genLine)}${s.footer.reportId ? ` — Report ID: ${_esc(s.footer.reportId)}` : ''}</p>
</div>`;

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
</body></html>`;
}

const LAYOUTS = {
  legacy_tabular: {
    label: 'Legacy Tabular',
    renderPdf:  _renderLegacyTabularPdf,
    renderHtml: _renderLegacyTabularHtml,
  },
  subject_paired: {
    label: 'Subject + Comment Together',
    renderPdf:  _renderSubjectPairedPdf,
    renderHtml: _renderSubjectPairedHtml,
  },
  marks_then_comments: {
    label: 'Subjects First, Comments After',
    renderPdf:  _renderMarksThenCommentsPdf,
    renderHtml: _renderMarksThenCommentsHtml,
  },
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
