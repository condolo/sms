/* ============================================================
   Msingi — Behaviour Incidents PDF export.

   Built for school leadership to answer two questions at once:
   "what happened" (the filtered incident log — whole school, one
   class, or one stream) and "who logged it" (a per-staff tally, so a
   principal can see how each staff member is actually using the
   module — not just browse incidents one at a time). Rendered through
   the same shared HTML+Puppeteer pipeline every other PDF in this app
   now uses (see html-to-pdf.js) — one renderer, no PDFKit involved.
   ============================================================ */
'use strict';

const BRAND = '#1f2d3d';
const BRAND_WASH = '#eef1f4';
const FAIL_RED = '#b3261e';
const PASS_GREEN = '#2e7d32';

function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * @param {object} opts
 * @param {object|null} opts.school - {name, logoUrl}
 * @param {string} opts.scopeLabel - "Whole School" | class name | "Class · Stream"
 * @param {string|null} opts.dateFrom
 * @param {string|null} opts.dateTo
 * @param {object[]} opts.incidents - raw behaviour_incidents docs
 * @param {Record<string,string>} opts.classNameMap - classId -> name
 * @param {Record<string,{name:string, role:string}>} opts.reporterMap - userId -> {name, role}
 * @param {object[]} opts.staffRows - [{name, role, total, merits, demerits, points}], pre-sorted
 * @param {string} opts.generatedByName
 */
function renderIncidentsReportHtml({
  school, scopeLabel, dateFrom, dateTo, incidents, classNameMap, reporterMap, staffRows, generatedByName,
}) {
  const schoolName = school?.name || 'School';
  const rangeLabel = dateFrom || dateTo
    ? `${dateFrom ? esc(dateFrom) : 'Start'} – ${dateTo ? esc(dateTo) : 'Today'}`
    : 'All dates';

  const totalMerits   = incidents.filter(i => i.type === 'merit').length;
  const totalDemerits = incidents.filter(i => i.type === 'demerit').length;
  const netPoints     = incidents.reduce((s, i) => s + (i.points || 0), 0);

  const staffRowsHtml = staffRows.map(r => `
    <tr>
      <td style="${tdS}font-weight:600">${esc(r.name)}</td>
      <td style="${tdS}color:#64748b">${esc(r.role || '—')}</td>
      <td style="${tdC}">${r.total}</td>
      <td style="${tdC};color:${PASS_GREEN};font-weight:600">${r.merits}</td>
      <td style="${tdC};color:${FAIL_RED};font-weight:600">${r.demerits}</td>
      <td style="${tdC};font-weight:700">${r.points >= 0 ? '+' : ''}${r.points}</td>
    </tr>`).join('');

  const incidentRowsHtml = incidents.map(i => {
    const reporter = reporterMap[i.reportedBy];
    const reporterLabel = reporter
      ? `${esc(reporter.name)}${reporter.role ? ` <span style="color:#94a3b8">(${esc(reporter.role)})</span>` : ''}`
      : (i.reportedBy ? esc(i.reportedBy) : '<span style="color:#94a3b8;font-style:italic">Unattributed</span>');
    const typeColor = i.type === 'merit' ? PASS_GREEN : i.type === 'demerit' ? FAIL_RED : '#64748b';
    return `
    <tr>
      <td style="${tdS}white-space:nowrap">${i.date ? esc(new Date(i.date).toLocaleDateString('en-GB')) : '—'}</td>
      <td style="${tdS}font-weight:600">${esc(i.studentName || i.studentId)}</td>
      <td style="${tdS}color:#64748b">${esc(classNameMap[i.classId] || '—')}</td>
      <td style="${tdS};color:${typeColor};font-weight:600;text-transform:capitalize">${esc(i.type || '—')}</td>
      <td style="${tdS}color:#64748b">${esc(i.category || i.title || '—')}</td>
      <td style="${tdC};font-weight:700">${(i.points || 0) >= 0 ? '+' : ''}${i.points ?? 0}</td>
      <td style="${tdS}">${reporterLabel}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Behaviour Incidents — ${esc(schoolName)}</title>
<style>
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}
  body{font-family:Arial,Helvetica,sans-serif;max-width:1100px;margin:20px auto;color:#0f172a;padding:0 16px}
  @media print{@page{margin:1.5cm;size:A4 landscape}}
  table{width:100%;border-collapse:collapse}
</style>
</head><body>
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;border-bottom:2px solid ${BRAND};padding-bottom:10px">
    <div>
      <h1 style="margin:0;font-size:18px;font-weight:800">${esc(schoolName)}</h1>
      <p style="margin:2px 0 0;font-size:11px;color:#64748b">Behaviour Incidents Report</p>
    </div>
    <div style="text-align:right;font-size:11px;color:#64748b">
      <div><b>Scope:</b> ${esc(scopeLabel)}</div>
      <div><b>Period:</b> ${rangeLabel}</div>
      <div>Generated ${esc(new Date().toLocaleString('en-GB'))}${generatedByName ? ` by ${esc(generatedByName)}` : ''}</div>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0">
    ${[
      { label: 'Total Incidents', value: incidents.length, color: BRAND },
      { label: 'Merits', value: totalMerits, color: PASS_GREEN },
      { label: 'Demerits', value: totalDemerits, color: FAIL_RED },
      { label: 'Net Points', value: `${netPoints >= 0 ? '+' : ''}${netPoints}`, color: netPoints >= 0 ? PASS_GREEN : FAIL_RED },
    ].map(k => `
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;text-align:center">
      <p style="margin:0 0 4px;font-size:9px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#94a3b8">${esc(k.label)}</p>
      <p style="margin:0;font-size:20px;font-weight:800;color:${k.color}">${k.value}</p>
    </div>`).join('')}
  </div>

  <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:16px 0 6px">Staff Activity — who logged what</p>
  <table style="margin-bottom:16px;font-size:10.5px">
    <thead><tr>
      <th style="${thS}">Staff</th><th style="${thS}">Role</th><th style="${thS}">Incidents Logged</th>
      <th style="${thS}">Merits</th><th style="${thS}">Demerits</th><th style="${thS}">Net Points</th>
    </tr></thead>
    <tbody>${staffRowsHtml || `<tr><td colspan="6" style="${tdS}color:#94a3b8;font-style:italic">No incidents in this scope/period.</td></tr>`}</tbody>
  </table>

  <p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:16px 0 6px">Incident Log</p>
  <table style="font-size:10px">
    <thead><tr>
      <th style="${thS}">Date</th><th style="${thS}">Student</th><th style="${thS}">Class</th>
      <th style="${thS}">Type</th><th style="${thS}">Category / Title</th><th style="${thS}">Points</th><th style="${thS}">Recorded By</th>
    </tr></thead>
    <tbody>${incidentRowsHtml || `<tr><td colspan="7" style="${tdS}color:#94a3b8;font-style:italic">No incidents in this scope/period.</td></tr>`}</tbody>
  </table>

  <p style="text-align:center;font-size:9px;color:#94a3b8;margin-top:16px">This report is computer-generated from ${esc(schoolName)}'s live Behaviour module data.</p>
</body></html>`;
}

const thS = `border:1px solid #cbd5e1;padding:5px 8px;background:${BRAND};color:#fff;font-size:9.5px;text-transform:uppercase;letter-spacing:.3px;text-align:left`;
const tdS = `border:1px solid #e2e8f0;padding:5px 8px;`;
const tdC = `border:1px solid #e2e8f0;padding:5px 8px;text-align:center`;

module.exports = { renderIncidentsReportHtml };
