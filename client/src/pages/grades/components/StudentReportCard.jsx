/* ============================================================
   StudentReportCard — multi-page report card
   On-screen: three sections (Marks / Comments / Behaviour)
   Print:     Cover → Marks → Comments → Behaviour (page-break)

   Props:
     student          — generate output: { studentId, subjects, totalScore, averageScore,
                          gpa, subjectCount, rankings, classTeacherId, classTeacherName }
     studentInfo      — { firstName, lastName, admissionNumber }
     className        — class name string
     subjectMap       — { [subjectId]: { name } }
     customTypes      — [{ key, label, instances, weight }]
     gradeScale       — { bands: [{ min, grade, points, label }] }
     instanceMarks    — { [subjectId]: { [`${typeKey}_${instance}`]: rawScore } }
     draftComment     — { classTeacherName, classTeacherRemark, sportsAndTalent,
                          principalName, principalRemark, closingDate, nextTermBegin,
                          subjectComments: { [subjectId]: string } }
     onSaveComment    — async (data) => void
     termNum          — number
     school           — { name, tagline, logoUrl }
     academicYear     — string
     studentDeviations — { subjects: { [subjectId]: number|null }, mean: number|null } | null
     behaviourSummary — { merits, demerits, points, total } | null
   ============================================================ */
import { Fragment, useState, useCallback, useEffect } from 'react';
import { Printer, Save, Check, BarChart2, MessageSquare, Award, CheckCircle } from 'lucide-react';
import { DEFAULT_GRADE_SCALE, DEFAULT_CUSTOM_TYPES, _gradeFromScale } from '../constants.js';

/* ── Helpers ─────────────────────────────────────────────── */
function buildColumns(types) {
  const cols = [];
  for (const t of types) {
    const n = t.instances ?? 1;
    for (let i = 1; i <= n; i++) {
      cols.push({ typeKey: t.key, instance: i, label: n > 1 ? `${t.label || t.key} ${i}` : (t.label || t.key) });
    }
  }
  return cols;
}

function bandRange(sortedBands, idx) {
  const lo = sortedBands[idx].min;
  const hi = idx === 0 ? 100 : sortedBands[idx - 1].min - 1;
  return `${lo}–${hi}`;
}

function fmtDev(dev) {
  if (dev == null) return '—';
  const n = parseFloat(dev.toFixed(1));
  return n >= 0 ? `+${n}` : String(n);
}

/* ── Editable field ──────────────────────────────────────── */
function Field({ label, value, onChange, multiline = false, readOnly = false, placeholder = '' }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</label>
      {readOnly ? (
        <p className="text-xs text-slate-700 border border-slate-100 bg-slate-50 rounded-md px-2.5 py-1.5 min-h-[30px]">
          {value || <span className="text-slate-300 italic">{placeholder || 'Not set'}</span>}
        </p>
      ) : multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={3}
          className="w-full text-xs text-slate-700 border border-slate-200 rounded-md px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400" />
      ) : (
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          className="w-full text-xs text-slate-700 border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
      )}
    </div>
  );
}

/* ── Section tab button ──────────────────────────────────── */
function SectionTab({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition ${
        active
          ? 'bg-slate-800 text-white'
          : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
      }`}>
      <Icon size={12} />{label}
    </button>
  );
}

export default function StudentReportCard({
  student, studentInfo, className, subjectMap,
  customTypes, gradeScale, instanceMarks,
  draftComment, onSaveComment, termNum, school, academicYear,
  studentDeviations, behaviourSummary, snapshot,
}) {
  const types      = customTypes ?? DEFAULT_CUSTOM_TYPES;
  const bands      = [...(gradeScale?.bands ?? DEFAULT_GRADE_SCALE)].sort((a, b) => b.min - a.min);
  const columns    = buildColumns(types);
  const meanGrade  = _gradeFromScale(student.averageScore, bands);

  const name  = studentInfo ? `${studentInfo.firstName} ${studentInfo.lastName}` : student.studentId;
  const admNo = studentInfo?.admissionNumber ?? '';

  const subjectEntries = Object.entries(student.subjects ?? {})
    .map(([subId, data]) => ({ subId, data, name: subjectMap?.[subId]?.name ?? subId }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const classRank = student.rankings?.class
    ? `${student.rankings.class.rank}/${student.rankings.class.total}`
    : '—';

  const meanDev = studentDeviations?.mean ?? null;

  // Auto-resolved class teacher from generate endpoint
  const autoClassTeacherName = student.classTeacherName ?? null;

  const [section, setSection] = useState('marks');

  const [comment, setComment] = useState({
    classTeacherName:   draftComment?.classTeacherName   ?? '',
    classTeacherRemark: draftComment?.classTeacherRemark ?? '',
    sportsAndTalent:    draftComment?.sportsAndTalent    ?? '',
    principalName:      draftComment?.principalName      ?? '',
    principalRemark:    draftComment?.principalRemark    ?? '',
    closingDate:        draftComment?.closingDate        ?? '',
    nextTermBegin:      draftComment?.nextTermBegin      ?? '',
    subjectComments:    draftComment?.subjectComments    ?? {},
  });

  useEffect(() => {
    if (!draftComment) return;
    setComment({
      classTeacherName:   draftComment.classTeacherName   ?? '',
      classTeacherRemark: draftComment.classTeacherRemark ?? '',
      sportsAndTalent:    draftComment.sportsAndTalent    ?? '',
      principalName:      draftComment.principalName      ?? '',
      principalRemark:    draftComment.principalRemark    ?? '',
      closingDate:        draftComment.closingDate        ?? '',
      nextTermBegin:      draftComment.nextTermBegin      ?? '',
      subjectComments:    draftComment.subjectComments    ?? {},
    });
  }, [draftComment]);

  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const set = (key) => (val) => setComment(c => ({ ...c, [key]: val }));

  const handleSave = useCallback(async () => {
    if (!onSaveComment) return;
    setSaving(true);
    try {
      await onSaveComment(comment);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }, [comment, onSaveComment]);

  /* ── Print ──────────────────────────────────────────────── */
  function printCard() {
    const thS  = 'border:1px solid #cbd5e1;padding:5px 8px;background:#1e293b;color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.5px;text-align:center';
    const tdS  = 'border:1px solid #e2e8f0;padding:5px 8px';
    const tdC  = `${tdS};text-align:center`;
    const pb   = 'page-break-before:always';

    const logoHtml = school?.logoUrl
      ? `<img src="${school.logoUrl}" style="height:72px;width:72px;object-fit:contain;border-radius:4px" />`
      : `<div style="width:72px;height:72px;background:#e2e8f0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:30px;font-weight:bold;color:#94a3b8">${(school?.name?.[0] ?? 'S').toUpperCase()}</div>`;

    /* ── Page 1: Cover ── */
    const coverHtml = `
<div style="min-height:297mm;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:32px;text-align:center">
  ${logoHtml.replace('height:72px;width:72px', 'height:110px;width:110px')}
  <div>
    <h1 style="font-size:26px;font-weight:900;margin:0 0 4px;color:#0f172a">${school?.name ?? 'School Name'}</h1>
    ${school?.tagline ? `<p style="font-size:13px;font-style:italic;color:#64748b;margin:0 0 16px">${school.tagline}</p>` : '<div style="margin-bottom:16px"></div>'}
    <div style="display:inline-block;background:#1e293b;color:#fff;padding:10px 32px;border-radius:6px;font-size:15px;font-weight:700;letter-spacing:1.5px">
      ACADEMIC REPORT — TERM ${termNum ?? '—'} — ${academicYear ?? ''}
    </div>
  </div>
  <table style="border-collapse:collapse;width:480px;font-size:13px">
    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc;width:40%">Student Name</td><td style="padding:8px 14px;border:1px solid #e2e8f0;font-weight:700">${name}</td></tr>
    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc">Admission No.</td><td style="padding:8px 14px;border:1px solid #e2e8f0">${admNo || '—'}</td></tr>
    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc">Class</td><td style="padding:8px 14px;border:1px solid #e2e8f0">${className ?? '—'}</td></tr>
    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc">Mean Mark</td><td style="padding:8px 14px;border:1px solid #e2e8f0;font-weight:700">${student.averageScore != null ? Number(student.averageScore).toFixed(1) + '%' : '—'} — ${meanGrade?.grade ?? '—'} (${meanGrade?.label ?? ''})</td></tr>
    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc">Class Rank</td><td style="padding:8px 14px;border:1px solid #e2e8f0">${classRank}</td></tr>
    <tr><td style="padding:8px 14px;border:1px solid #e2e8f0;font-weight:600;background:#f8fafc">Class Teacher</td><td style="padding:8px 14px;border:1px solid #e2e8f0">${autoClassTeacherName || comment.classTeacherName || '—'}</td></tr>
  </table>
  <p style="font-size:11px;color:#94a3b8;margin-top:auto">Generated by Msingi School Management System</p>
</div>`;

    /* ── Page 2: Marks ── */
    const colHeaders = columns.map(c => `<th style="${thS}">${c.label}</th>`).join('');
    const subjectRows = subjectEntries.map(({ subId, data, name: sName }) => {
      const marks = instanceMarks?.[subId] ?? {};
      const markCells = columns.map(c => {
        const raw = marks[`${c.typeKey}_${c.instance}`];
        return `<td style="${tdC}">${raw != null ? raw : '<span style="color:#cbd5e1">—</span>'}</td>`;
      }).join('');
      const rawDev  = studentDeviations?.subjects?.[subId] ?? null;
      const devStr  = fmtDev(rawDev);
      const devColor = rawDev == null ? '#94a3b8' : rawDev >= 0 ? '#16a34a' : '#dc2626';
      return `
        <tr>
          <td style="${tdS};font-weight:600;min-width:120px">${sName}</td>
          ${markCells}
          <td style="${tdC};font-weight:700">${data.finalScore != null ? Number(data.finalScore).toFixed(1) : '—'}</td>
          <td style="${tdC};font-weight:700">${data.grade ?? '—'}</td>
          <td style="${tdC}">${classRank}</td>
          <td style="${tdC};color:${devColor};font-weight:600">${devStr}</td>
        </tr>`;
    }).join('');

    const gradingRows = bands.map((b, i) => `
      <tr>
        <td style="${tdC};font-weight:700">${b.grade}</td>
        <td style="${tdC}">${bandRange(bands, i)}%</td>
        <td style="${tdC}">${b.points ?? '—'}</td>
        <td style="${tdS}">${b.label ?? ''}</td>
      </tr>`).join('');

    const marksHtml = `
<div style="${pb}">
  <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:14px;border-bottom:2px solid #1e293b;padding-bottom:10px">
    ${logoHtml}
    <div style="text-align:center">
      <h2 style="margin:0 0 2px;font-size:16px;font-weight:800">${school?.name ?? ''}</h2>
      <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1px">TERM ${termNum ?? '—'} ACADEMIC PERFORMANCE — ${academicYear ?? ''}</p>
    </div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11px">
    <tr>
      <td style="${tdS}"><b>Name:</b> ${name}</td>
      <td style="${tdS}"><b>ADM:</b> ${admNo || '—'}</td>
      <td style="${tdS}"><b>Class:</b> ${className ?? '—'}</td>
      <td style="${tdS}"><b>Mean:</b> <b>${student.averageScore != null ? Number(student.averageScore).toFixed(1) + '%' : '—'}</b></td>
      <td style="${tdS}"><b>Grade:</b> <b>${meanGrade?.grade ?? '—'}</b></td>
      <td style="${tdS}"><b>Rank:</b> ${classRank}</td>
      <td style="${tdS}"><b>Dev:</b> <span style="color:${meanDev == null ? '#94a3b8' : meanDev >= 0 ? '#16a34a' : '#dc2626'}">${fmtDev(meanDev)}</span></td>
    </tr>
  </table>
  <table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11px">
    <thead>
      <tr>
        <th style="${thS};text-align:left">Subject</th>
        ${colHeaders}
        <th style="${thS}">Avg %</th>
        <th style="${thS}">Grade</th>
        <th style="${thS}">Rank</th>
        <th style="${thS}">Dev</th>
      </tr>
    </thead>
    <tbody>${subjectRows}</tbody>
  </table>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">Grading Key</p>
      <table style="width:100%;border-collapse:collapse;font-size:10px">
        <thead><tr>
          <th style="${thS}">Grade</th><th style="${thS}">Range</th><th style="${thS}">Points</th><th style="${thS};text-align:left">Description</th>
        </tr></thead>
        <tbody>${gradingRows}</tbody>
      </table>
    </div>
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">Sports &amp; Talent / Co-Curricular</p>
      <div style="border:1px solid #e2e8f0;border-radius:4px;padding:8px 12px;min-height:80px;font-size:11px;color:#475569">${comment.sportsAndTalent || ''}</div>
    </div>
  </div>
</div>`;

    /* ── Page 3: Comments ── */
    const subjectCommentRows = subjectEntries.map(({ subId, name: sName }) => {
      const c = comment.subjectComments?.[subId] ?? '';
      return `
        <tr>
          <td style="${tdS};font-weight:600;width:160px;vertical-align:top">${sName}</td>
          <td style="${tdS};font-size:11px;color:#475569;min-height:28px">${c || '<span style="color:#cbd5e1;font-style:italic">No comment entered</span>'}</td>
        </tr>`;
    }).join('');

    const commentsHtml = `
<div style="${pb}">
  <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:14px;border-bottom:2px solid #1e293b;padding-bottom:10px">
    ${logoHtml}
    <div style="text-align:center">
      <h2 style="margin:0 0 2px;font-size:16px;font-weight:800">${school?.name ?? ''}</h2>
      <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1px">TERM ${termNum ?? '—'} TEACHER COMMENTS — ${name}</p>
    </div>
  </div>
  <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 6px">Subject Teacher Comments</p>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:11px">
    ${subjectCommentRows || `<tr><td colspan="2" style="${tdS};color:#94a3b8;font-style:italic">No subject comments entered yet.</td></tr>`}
  </table>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">
        Class Teacher: <span style="font-style:italic;font-weight:normal">${autoClassTeacherName || comment.classTeacherName || '___________________'}</span>
      </p>
      <div style="border:1px solid #e2e8f0;border-radius:4px;padding:8px 12px;min-height:70px;font-size:11px;color:#475569">${comment.classTeacherRemark || ''}</div>
      <div style="margin-top:24px;border-top:1px solid #1e293b;width:180px;padding-top:4px;font-size:10px;color:#475569">Class Teacher Signature</div>
    </div>
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">
        Principal / Section Head: <span style="font-style:italic;font-weight:normal">${comment.principalName || '___________________'}</span>
      </p>
      <div style="border:1px solid #e2e8f0;border-radius:4px;padding:8px 12px;min-height:70px;font-size:11px;color:#475569">${comment.principalRemark || ''}</div>
      <div style="margin-top:24px;border-top:1px solid #1e293b;width:180px;padding-top:4px;font-size:10px;color:#475569">Principal Signature</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;border-top:1px solid #e2e8f0;padding-top:12px">
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">Closing Date</p>
      <p style="margin:0;padding:6px 10px;border:1px solid #e2e8f0;border-radius:4px;min-height:28px;font-size:11px">${comment.closingDate || ''}</p>
    </div>
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">Next Term Begins</p>
      <p style="margin:0;padding:6px 10px;border:1px solid #e2e8f0;border-radius:4px;min-height:28px;font-size:11px">${comment.nextTermBegin || ''}</p>
    </div>
    <div>
      <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px">Official Stamp</p>
      <div style="height:60px;border:1px dashed #cbd5e1;border-radius:4px"></div>
    </div>
  </div>
</div>`;

    /* ── Page 4: Behaviour ── */
    const beh = behaviourSummary;
    const behHtml = `
<div style="${pb}">
  <div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:14px;border-bottom:2px solid #1e293b;padding-bottom:10px">
    ${logoHtml}
    <div style="text-align:center">
      <h2 style="margin:0 0 2px;font-size:16px;font-weight:800">${school?.name ?? ''}</h2>
      <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:1px">TERM ${termNum ?? '—'} BEHAVIOUR REPORT — ${name}</p>
    </div>
  </div>
  ${beh ? `
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
    ${[
      { label: 'Merits', value: beh.merits ?? 0, color: '#16a34a' },
      { label: 'Demerits', value: beh.demerits ?? 0, color: '#dc2626' },
      { label: 'Net Points', value: beh.points ?? 0, color: (beh.points ?? 0) >= 0 ? '#16a34a' : '#dc2626' },
      { label: 'Total Incidents', value: beh.total ?? 0, color: '#475569' },
    ].map(s => `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:16px;text-align:center">
        <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#94a3b8;margin:0 0 4px">${s.label}</p>
        <p style="font-size:28px;font-weight:900;color:${s.color};margin:0">${s.value}</p>
      </div>`).join('')}
  </div>
  ` : `
  <p style="color:#94a3b8;font-style:italic;font-size:12px;text-align:center;padding:40px 0">No behaviour records found for this term.</p>
  `}
  <p style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 8px">Pastoral Notes</p>
  <div style="border:1px solid #e2e8f0;border-radius:4px;padding:12px;min-height:100px"></div>
</div>`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Report Card — ${name}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;max-width:1050px;margin:20px auto;color:#0f172a;padding:0 16px}
  @media print{@page{margin:1.5cm;size:A4}button{display:none!important}}
</style>
</head><body>
${coverHtml}
${marksHtml}
${commentsHtml}
${behHtml}
<p style="text-align:center;font-size:9px;color:#94a3b8;margin-top:16px">Generated by Msingi School Management System</p>
</body></html>`;

    const w = window.open('', '_blank', 'width=1200,height=900');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
  }

  /* ── On-screen render ───────────────────────────────────── */
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">

      {/* Card header */}
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{name}</p>
          <p className="text-xs text-slate-400">
            {admNo && `ADM: ${admNo} · `}
            {className && `${className} · `}
            Rank {classRank}
            {autoClassTeacherName && ` · Class Teacher: ${autoClassTeacherName}`}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {snapshot?.reportId && (
            <span className="hidden sm:flex items-center gap-1 text-[10px] font-mono font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5" title="Published report ID">
              <CheckCircle size={10} /> {snapshot.reportId}
            </span>
          )}
          <div className="text-right hidden sm:block">
            <p className="text-xs text-slate-500">Mean</p>
            <p className="text-sm font-bold text-slate-800">
              {student.averageScore != null ? `${Number(student.averageScore).toFixed(1)}%` : '—'}
              <span className="ml-1.5 text-indigo-600">{meanGrade?.grade ?? ''}</span>
            </p>
          </div>
          <button onClick={printCard} title="Print / Save PDF"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition">
            <Printer size={13} /> Print
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 sm:grid-cols-8 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/40 text-center text-xs">
        {[
          { label: 'Total',      value: student.totalScore != null ? Number(student.totalScore).toFixed(1) : '—' },
          { label: 'Mean',       value: student.averageScore != null ? `${Number(student.averageScore).toFixed(1)}%` : '—' },
          { label: 'Grade',      value: meanGrade?.grade ?? '—' },
          { label: 'GPA',        value: student.gpa != null ? Number(student.gpa).toFixed(2) : '—' },
          { label: 'Subjects',   value: student.subjectCount ?? subjectEntries.length },
          { label: 'Rank',       value: classRank },
          { label: 'Dev',        value: fmtDev(meanDev), color: meanDev == null ? '' : meanDev >= 0 ? 'text-emerald-600' : 'text-red-500' },
          { label: 'Term',       value: `Term ${termNum ?? '—'}` },
        ].map(({ label, value, color = '' }) => (
          <div key={label} className="py-2 px-1 col-span-2 sm:col-span-1">
            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider leading-tight">{label}</p>
            <p className={`text-xs font-bold mt-0.5 truncate ${color || 'text-slate-700'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Section tabs */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-100 bg-slate-50/60">
        <SectionTab active={section === 'marks'}    onClick={() => setSection('marks')}    icon={BarChart2}     label="Marks" />
        <SectionTab active={section === 'comments'} onClick={() => setSection('comments')} icon={MessageSquare} label="Comments" />
        <SectionTab active={section === 'behaviour'} onClick={() => setSection('behaviour')} icon={Award}       label="Behaviour" />
      </div>

      {/* ── MARKS SECTION ─────────────────────────────────── */}
      {section === 'marks' && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-wide sticky left-0 bg-slate-800 min-w-[120px]">Subject</th>
                {columns.map(c => (
                  <th key={`${c.typeKey}_${c.instance}`} className="px-2 py-2 font-semibold text-[10px] uppercase tracking-wide text-center whitespace-nowrap min-w-[52px]">
                    {c.label}
                  </th>
                ))}
                <th className="px-2 py-2 font-semibold text-[10px] uppercase tracking-wide text-center min-w-[52px]">Avg %</th>
                <th className="px-2 py-2 font-semibold text-[10px] uppercase tracking-wide text-center min-w-[52px]">Grade</th>
                <th className="px-2 py-2 font-semibold text-[10px] uppercase tracking-wide text-center min-w-[52px]">Rank</th>
                <th className="px-2 py-2 font-semibold text-[10px] uppercase tracking-wide text-center min-w-[48px]">Dev</th>
              </tr>
            </thead>
            <tbody>
              {subjectEntries.map(({ subId, data, name: sName }) => {
                const marks  = instanceMarks?.[subId] ?? {};
                const rawDev = studentDeviations?.subjects?.[subId] ?? null;
                const dev    = fmtDev(rawDev);
                const devCls = rawDev == null ? 'text-slate-400' : rawDev >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-500 font-semibold';
                return (
                  <Fragment key={subId}>
                    <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                      <td className="px-3 py-2 font-semibold text-slate-800 sticky left-0 bg-white">{sName}</td>
                      {columns.map(c => {
                        const raw = marks[`${c.typeKey}_${c.instance}`];
                        return (
                          <td key={`${c.typeKey}_${c.instance}`} className="px-2 py-2 text-center tabular-nums text-slate-700">
                            {raw != null ? raw : <span className="text-slate-300">—</span>}
                          </td>
                        );
                      })}
                      <td className="px-2 py-2 text-center tabular-nums font-bold text-slate-800">
                        {data.finalScore != null ? Number(data.finalScore).toFixed(1) : '—'}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <span className="inline-block rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-0.5 font-bold leading-none">
                          {data.grade ?? '—'}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-center text-slate-500">{classRank}</td>
                      <td className={`px-2 py-2 text-center tabular-nums ${devCls}`}>{dev}</td>
                    </tr>
                    {data.remarks && (
                      <tr className="bg-slate-50/40 border-b border-slate-100">
                        <td colSpan={columns.length + 4} className="px-3 py-1 text-[10px] text-slate-500 italic">
                          {data.remarks}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── COMMENTS SECTION ──────────────────────────────── */}
      {section === 'comments' && (
        <div className="p-5 space-y-5">

          {/* Subject comments (read-only — set in MarkEntryTab by subject teacher) */}
          <div>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Subject Teacher Comments</p>
            <div className="space-y-1.5">
              {subjectEntries.map(({ subId, name: sName }) => {
                const c = comment.subjectComments?.[subId];
                return (
                  <div key={subId} className="flex gap-3 items-start rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                    <span className="text-xs font-semibold text-slate-700 min-w-[120px] shrink-0 pt-0.5">{sName}</span>
                    <span className={`text-xs flex-1 ${c ? 'text-slate-700' : 'text-slate-300 italic'}`}>
                      {c || 'No comment entered'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Class teacher + principal comments */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
            <div className="space-y-2">
              <Field
                label={`Class Teacher${autoClassTeacherName ? ` — ${autoClassTeacherName}` : ''}`}
                value={autoClassTeacherName || comment.classTeacherName}
                onChange={set('classTeacherName')}
                readOnly={!!autoClassTeacherName}
                placeholder="Auto-resolved from stream"
              />
              <Field label="Class Teacher Remarks" value={comment.classTeacherRemark} onChange={set('classTeacherRemark')} multiline />
            </div>
            <div className="space-y-2">
              <Field label="Principal / Section Head Name" value={comment.principalName} onChange={set('principalName')} />
              <Field label="Principal / Section Head Remarks" value={comment.principalRemark} onChange={set('principalRemark')} multiline />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Sports & Talent / Co-Curricular" value={comment.sportsAndTalent} onChange={set('sportsAndTalent')} multiline />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Closing Date" value={comment.closingDate} onChange={set('closingDate')} />
            <Field label="Next Term Begins" value={comment.nextTermBegin} onChange={set('nextTermBegin')} />
          </div>

          {onSaveComment && (
            <div className="flex justify-end pt-1">
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition">
                {saved
                  ? <><Check size={13} /> Saved</>
                  : saving
                  ? <><span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" /> Saving…</>
                  : <><Save size={13} /> Save Comments</>}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── BEHAVIOUR SECTION ─────────────────────────────── */}
      {section === 'behaviour' && (
        <div className="p-5">
          {behaviourSummary ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Merits',         value: behaviourSummary.merits   ?? 0, cls: 'text-emerald-600' },
                { label: 'Demerits',       value: behaviourSummary.demerits ?? 0, cls: 'text-red-500' },
                { label: 'Net Points',     value: behaviourSummary.points   ?? 0, cls: (behaviourSummary.points ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500' },
                { label: 'Total Incidents',value: behaviourSummary.total    ?? 0, cls: 'text-slate-700' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="rounded-xl border border-slate-200 p-4 text-center">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
                  <p className={`text-3xl font-black ${cls}`}>{value}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-10">
              <Award size={28} className="text-slate-300" />
              <p className="text-sm text-slate-400 italic">No behaviour data for this student / term.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
