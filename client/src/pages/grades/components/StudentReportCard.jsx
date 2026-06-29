/* ============================================================
   StudentReportCard — PDF-matching report card with print support
   Props:
     student        — generate output: { studentId, subjects, totalScore, averageScore, gpa, subjectCount, rankings }
     studentInfo    — { firstName, lastName, admissionNumber }
     className      — class name string
     subjectMap     — { [subjectId]: { name } }
     customTypes    — [{ key, label, instances, weight }]
     gradeScale     — { bands: [{ min, grade, points, label }] }
     instanceMarks  — { [subjectId]: { [`${typeKey}_${instance}`]: rawScore } }
     draftComment   — { classTeacherName, classTeacherRemark, sportsAndTalent, principalName, principalRemark, closingDate, nextTermBegin }
     onSaveComment  — async (data) => void
     termNum        — number
     school         — { name, tagline, logoUrl }
     academicYear   — string
   ============================================================ */
import { Fragment, useState, useCallback, useEffect } from 'react';
import { Printer, Save, Check } from 'lucide-react';
import { DEFAULT_GRADE_SCALE, DEFAULT_CUSTOM_TYPES, _gradeFromScale } from '../constants.js';

/* ── Column builder ──────────────────────────────────────── */
function buildColumns(types) {
  const cols = [];
  for (const t of types) {
    const n = t.instances ?? 1;
    for (let i = 1; i <= n; i++) {
      cols.push({ typeKey: t.key, instance: i, label: n > 1 ? `${t.key} ${i}` : t.key });
    }
  }
  return cols;
}

/* ── Grade-band range display ────────────────────────────── */
function bandRange(sortedBands, idx) {
  const lo = sortedBands[idx].min;
  const hi = idx === 0 ? 100 : sortedBands[idx - 1].min - 1;
  return `${lo}–${hi}`;
}

/* ── Deviation display ───────────────────────────────────── */
function fmtDev(dev) {
  if (dev == null) return '—';
  const n = parseFloat(dev.toFixed(1));
  return n >= 0 ? `+${n}` : String(n);
}

/* ── Editable field ──────────────────────────────────────── */
function Field({ label, value, onChange, multiline = false, className = '' }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={2}
          className="w-full text-xs text-slate-700 border border-slate-200 rounded-md px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full text-xs text-slate-700 border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        />
      )}
    </div>
  );
}

export default function StudentReportCard({
  student, studentInfo, className, subjectMap,
  customTypes, gradeScale, instanceMarks,
  draftComment, onSaveComment, termNum, school, academicYear,
  studentDeviations,   // { subjects: { [subjectId]: number|null }, mean: number|null } | null
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

  // Local comment state — sync when draftComment prop changes (e.g., after a save)
  const [comment, setComment] = useState({
    classTeacherName:   draftComment?.classTeacherName   ?? '',
    classTeacherRemark: draftComment?.classTeacherRemark ?? '',
    sportsAndTalent:    draftComment?.sportsAndTalent    ?? '',
    principalName:      draftComment?.principalName      ?? '',
    principalRemark:    draftComment?.principalRemark    ?? '',
    closingDate:        draftComment?.closingDate        ?? '',
    nextTermBegin:      draftComment?.nextTermBegin      ?? '',
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
    const tdS = 'border:1px solid #cbd5e1;padding:5px 8px';
    const thS = `${tdS};background:#1e293b;color:#fff;font-size:10px;text-transform:uppercase;letter-spacing:.5px;text-align:center`;

    const colHeaderCells = columns
      .map(c => `<th style="${thS}">${c.label}</th>`)
      .join('');

    const subjectRows = subjectEntries.map(({ subId, data, name: sName }) => {
      const marks = instanceMarks?.[subId] ?? {};
      const markCells = columns
        .map(c => {
          const raw = marks[`${c.typeKey}_${c.instance}`];
          return `<td style="${tdS};text-align:center">${raw != null ? raw : '—'}</td>`;
        })
        .join('');
      return `
        <tr>
          <td style="${tdS};font-weight:600;min-width:110px">${sName}</td>
          ${markCells}
          <td style="${tdS};text-align:center;font-weight:bold">${data.finalScore != null ? data.finalScore.toFixed(1) : '—'}</td>
          <td style="${tdS};text-align:center;font-weight:bold">${data.grade ?? '—'}</td>
          <td style="${tdS};text-align:center">${classRank}</td>
          <td style="${tdS};text-align:center">—</td>
          <td style="${tdS};text-align:center">${fmtDev(studentDeviations?.subjects?.[subId] ?? null)}</td>
        </tr>
        <tr style="background:#f8fafc">
          <td colspan="${columns.length + 6}" style="${tdS};font-style:italic;color:#475569;font-size:11px;padding-left:14px">
            ${data.remarks ?? ''}
          </td>
        </tr>`;
    }).join('');

    const gradingRows = bands.map((b, i) => `
      <tr>
        <td style="${tdS};text-align:center;font-weight:700">${b.grade}</td>
        <td style="${tdS};text-align:center">${bandRange(bands, i)}%</td>
        <td style="${tdS};text-align:center">${b.points ?? '—'}</td>
        <td style="${tdS}">${b.label ?? ''}</td>
      </tr>`).join('');

    const logoHtml = school?.logoUrl
      ? `<img src="${school.logoUrl}" style="height:68px;width:68px;object-fit:contain;border-radius:4px" />`
      : `<div style="width:68px;height:68px;background:#e2e8f0;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:bold;color:#94a3b8">${(school?.name?.[0] ?? 'S').toUpperCase()}</div>`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Report Card — ${name}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;max-width:1100px;margin:24px auto;font-size:12px;color:#1e293b;padding:0 12px}
  h1{font-size:20px;margin:0 0 2px}
  table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11px}
  .info td{padding:5px 10px;border:1px solid #e2e8f0}
  .stamp-box{height:70px;border:1px dashed #cbd5e1;border-radius:4px}
  .section-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#475569;margin:0 0 4px}
  .footer-box{border:1px solid #e2e8f0;border-radius:4px;padding:8px 12px;min-height:56px}
  @media print{@page{margin:1cm;size:A4 landscape}button{display:none!important}}
</style>
</head><body>

<div style="display:flex;align-items:center;justify-content:center;gap:20px;margin-bottom:18px;border-bottom:2px solid #1e293b;padding-bottom:14px">
  ${logoHtml}
  <div style="text-align:center">
    <h1>${school?.name ?? 'School Name'}</h1>
    ${school?.tagline ? `<p style="margin:0 0 4px;font-style:italic;color:#475569;font-size:12px">${school.tagline}</p>` : ''}
    <p style="margin:0;font-size:14px;font-weight:bold;letter-spacing:1px;color:#1e293b">
      ACADEMIC REPORT &mdash; TERM ${termNum ?? '—'} &mdash; ${academicYear ?? ''}
    </p>
  </div>
</div>

<table class="info" style="margin-bottom:14px">
  <tr>
    <td><b>ADM No:</b> ${admNo || '—'}</td>
    <td><b>Name:</b> ${name}</td>
    <td><b>Class:</b> ${className ?? '—'}</td>
    <td><b>Subjects:</b> ${student.subjectCount ?? subjectEntries.length}</td>
    <td><b>Total Marks:</b> ${student.totalScore != null ? Number(student.totalScore).toFixed(1) : '—'}</td>
    <td><b>Mean Mark:</b> ${student.averageScore != null ? Number(student.averageScore).toFixed(1) + '%' : '—'}</td>
    <td><b>Mean Grade:</b> <b>${meanGrade?.grade ?? '—'}</b></td>
    <td><b>Class Rank:</b> ${classRank}</td>
    <td><b>Mean Dev:</b> <b style="color:${meanDev == null ? '#94a3b8' : meanDev >= 0 ? '#16a34a' : '#dc2626'}">${fmtDev(meanDev)}</b></td>
  </tr>
</table>

<table>
  <thead>
    <tr>
      <th style="${thS};text-align:left">Subject</th>
      ${colHeaderCells}
      <th style="${thS}">Avg %</th>
      <th style="${thS}">Grade</th>
      <th style="${thS}">Rank</th>
      <th style="${thS}">Target</th>
      <th style="${thS}">Dev</th>
    </tr>
  </thead>
  <tbody>${subjectRows}</tbody>
</table>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:14px">
  <div>
    <p class="section-title">Grading Key</p>
    <table style="font-size:11px">
      <thead>
        <tr>
          <th style="${thS}">Grade</th>
          <th style="${thS}">Range</th>
          <th style="${thS}">Points</th>
          <th style="${thS};text-align:left">Description</th>
        </tr>
      </thead>
      <tbody>${gradingRows}</tbody>
    </table>
  </div>
  <div>
    <p class="section-title">Sports &amp; Talent</p>
    <div class="footer-box"><p style="margin:0;color:#475569">${comment.sportsAndTalent || ''}</p></div>
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:14px">
  <div>
    <p class="section-title">Class Teacher: <span style="font-style:italic;font-weight:normal">${comment.classTeacherName || '___________________'}</span></p>
    <div class="footer-box"><p style="margin:0;color:#475569">${comment.classTeacherRemark || ''}</p></div>
  </div>
  <div>
    <p class="section-title">Principal / Section Head: <span style="font-style:italic;font-weight:normal">${comment.principalName || '___________________'}</span></p>
    <div class="footer-box"><p style="margin:0;color:#475569">${comment.principalRemark || ''}</p></div>
  </div>
</div>

<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;border-top:1px solid #e2e8f0;padding-top:10px">
  <div>
    <p class="section-title">Closing Date</p>
    <p style="margin:0;padding:6px 10px;border:1px solid #e2e8f0;border-radius:4px;min-height:30px">${comment.closingDate || ''}</p>
  </div>
  <div>
    <p class="section-title">Next Term Begins</p>
    <p style="margin:0;padding:6px 10px;border:1px solid #e2e8f0;border-radius:4px;min-height:30px">${comment.nextTermBegin || ''}</p>
  </div>
  <div>
    <p class="section-title">Official Stamp</p>
    <div class="stamp-box"></div>
  </div>
</div>

<p style="text-align:center;font-size:9px;color:#94a3b8;margin-top:20px">
  Generated by Msingi School Management System
</p>
</body></html>`;

    const w = window.open('', '_blank', 'width=1200,height=900');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  }

  /* ── Render ─────────────────────────────────────────────── */
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">

      {/* Card header */}
      <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{name}</p>
          <p className="text-xs text-slate-400">{admNo && `ADM: ${admNo} · `}{className && `${className} · `}Rank {classRank}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right hidden sm:block">
            <p className="text-xs text-slate-500">Mean</p>
            <p className="text-sm font-bold text-slate-800">
              {student.averageScore != null ? `${Number(student.averageScore).toFixed(1)}%` : '—'}
              <span className="ml-1.5 text-indigo-600">{meanGrade?.grade ?? ''}</span>
            </p>
          </div>
          <button
            onClick={printCard}
            title="Print / Save PDF"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition"
          >
            <Printer size={13} /> Print
          </button>
        </div>
      </div>

      {/* Student stats bar */}
      <div className="grid grid-cols-4 sm:grid-cols-8 divide-x divide-slate-100 border-b border-slate-100 bg-slate-50/40 text-center text-xs">
        {[
          { label: 'Total Marks', value: student.totalScore != null ? Number(student.totalScore).toFixed(1) : '—' },
          { label: 'Mean Mark',   value: student.averageScore != null ? `${Number(student.averageScore).toFixed(1)}%` : '—' },
          { label: 'Mean Grade',  value: meanGrade?.grade ?? '—' },
          { label: 'GPA',         value: student.gpa != null ? Number(student.gpa).toFixed(2) : '—' },
          { label: 'Subjects',    value: student.subjectCount ?? subjectEntries.length },
          { label: 'Class Rank',  value: classRank },
          {
            label: 'Mean Dev',
            value: fmtDev(meanDev),
            color: meanDev == null ? '' : meanDev >= 0 ? 'text-emerald-600' : 'text-red-500',
          },
          { label: 'Term',        value: `Term ${termNum ?? '—'}` },
        ].map(({ label, value, color = '' }) => (
          <div key={label} className="py-2 px-1 col-span-2 sm:col-span-1">
            <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider leading-tight">{label}</p>
            <p className={`text-xs font-bold mt-0.5 truncate ${color || 'text-slate-700'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Subject table */}
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
              <th className="px-2 py-2 font-semibold text-[10px] uppercase tracking-wide text-center min-w-[48px]">Target</th>
              <th className="px-2 py-2 font-semibold text-[10px] uppercase tracking-wide text-center min-w-[48px]">Dev</th>
            </tr>
          </thead>
          <tbody>
            {subjectEntries.map(({ subId, data, name: sName }) => {
              const marks = instanceMarks?.[subId] ?? {};
              const rawDev = studentDeviations?.subjects?.[subId] ?? null;
              const dev    = fmtDev(rawDev);
              const devCls = rawDev == null ? 'text-slate-400'
                : rawDev >= 0 ? 'text-emerald-600 font-semibold'
                : 'text-red-500 font-semibold';
              return (
                <Fragment key={subId}>
                  {/* Score row */}
                  <tr className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                    <td className="px-3 py-2 font-semibold text-slate-800 sticky left-0 bg-white">
                      {sName}
                    </td>
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
                    <td className="px-2 py-2 text-center text-slate-300">—</td>
                    <td className={`px-2 py-2 text-center tabular-nums ${devCls}`}>{dev}</td>
                  </tr>
                  {/* Auto-generated comment row from grade band label */}
                  {data.remarks && (
                    <tr className="bg-slate-50/40 border-b border-slate-100">
                      <td
                        colSpan={columns.length + 6}
                        className="px-3 py-1 text-[10px] text-slate-500 italic"
                      >
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

      {/* Grading key + Sports/Talent */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border-t border-slate-100 bg-slate-50/30">
        {/* Grading table */}
        <div>
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Grading Key</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="text-center px-2 py-1 font-semibold text-slate-600 border border-slate-200">Grade</th>
                  <th className="text-center px-2 py-1 font-semibold text-slate-600 border border-slate-200">Range</th>
                  <th className="text-center px-2 py-1 font-semibold text-slate-600 border border-slate-200">Points</th>
                  <th className="text-left   px-2 py-1 font-semibold text-slate-600 border border-slate-200">Description</th>
                </tr>
              </thead>
              <tbody>
                {bands.map((b, i) => (
                  <tr key={b.grade} className="border border-slate-100">
                    <td className="text-center px-2 py-1 font-bold text-slate-800 border border-slate-200">{b.grade}</td>
                    <td className="text-center px-2 py-1 text-slate-600 border border-slate-200 tabular-nums">{bandRange(bands, i)}%</td>
                    <td className="text-center px-2 py-1 text-slate-600 border border-slate-200">{b.points ?? '—'}</td>
                    <td className="text-left   px-2 py-1 text-slate-600 border border-slate-200">{b.label ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sports & Talent */}
        <Field
          label="Sports & Talent"
          value={comment.sportsAndTalent}
          onChange={set('sportsAndTalent')}
          multiline
          className="self-start"
        />
      </div>

      {/* Comment footer */}
      <div className="p-4 border-t border-slate-100 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Field label="Class Teacher Name" value={comment.classTeacherName} onChange={set('classTeacherName')} />
            <Field label="Class Teacher Remarks" value={comment.classTeacherRemark} onChange={set('classTeacherRemark')} multiline />
          </div>
          <div className="space-y-2">
            <Field label="Principal / Section Head Name" value={comment.principalName} onChange={set('principalName')} />
            <Field label="Principal / Section Head Remarks" value={comment.principalRemark} onChange={set('principalRemark')} multiline />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Closing Date" value={comment.closingDate} onChange={set('closingDate')} />
          <Field label="Next Term Begins" value={comment.nextTermBegin} onChange={set('nextTermBegin')} />
        </div>

        {onSaveComment && (
          <div className="flex justify-end pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition"
            >
              {saved
                ? <><Check size={13} /> Saved</>
                : saving
                ? <><span className="animate-spin inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full" /> Saving…</>
                : <><Save size={13} /> Save Comments</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
