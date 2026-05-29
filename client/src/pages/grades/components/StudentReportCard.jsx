/* ============================================================
   StudentReportCard — per-student report card with print support
   Props: student, studentsList, template, half, termNum
   ============================================================ */
import { Printer } from 'lucide-react';
import { TERM_NUMBERS, _pct, _scoreColor } from '../constants.js';

export default function StudentReportCard({ student, studentsList, template, half, termNum }) {
  const subjects    = Object.entries(student.subjects ?? {});
  const termsToShow = termNum ? [Number(termNum)] : TERM_NUMBERS;

  const match = studentsList.find(s => (s.id ?? s._id) === student.studentId);
  const name  = match ? `${match.firstName} ${match.lastName}` : (student.studentId ?? '—');
  const admNo = match?.admissionNumber ?? '';

  if (!subjects.length) return null;

  function printCard() {
    const rows = subjects.map(([subId, data]) => {
      if (template === 'summary') {
        const t1 = data.terms?.[1]?.termTotal, t2 = data.terms?.[2]?.termTotal, t3 = data.terms?.[3]?.termTotal;
        return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${subId}</td><td style="text-align:right;padding:6px 12px;border-bottom:1px solid #eee">${t1!=null?t1.toFixed(1)+'%':'—'}</td><td style="text-align:right;padding:6px 12px;border-bottom:1px solid #eee">${t2!=null?t2.toFixed(1)+'%':'—'}</td><td style="text-align:right;padding:6px 12px;border-bottom:1px solid #eee">${t3!=null?t3.toFixed(1)+'%':'—'}</td><td style="text-align:right;padding:6px 12px;border-bottom:1px solid #eee;font-weight:bold">${data.summaryAverage!=null?data.summaryAverage.toFixed(1)+'%':'—'}</td></tr>`;
      }
      return termsToShow.map(tn => { const t = data.terms?.[tn]; return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${subId} (T${tn})</td><td style="text-align:right;padding:6px 12px;border-bottom:1px solid #eee">${t?.finalGrade!=null?t.finalGrade.toFixed(1)+'%':'—'}</td></tr>`; }).join('');
    }).join('');
    const html = `<html><head><title>Report Card — ${name}</title><style>body{font-family:Arial,sans-serif;max-width:700px;margin:30px auto;font-size:13px}h2{margin-bottom:4px}table{width:100%;border-collapse:collapse}th{background:#f1f5f9;padding:8px 12px;text-align:left;font-size:12px}@media print{}</style></head><body><h2>Report Card: ${name}</h2>${admNo?`<p style="color:#666;font-size:12px">Adm No: ${admNo}</p>`:''}<table><thead><tr>${template==='summary'?'<th>Subject</th><th style="text-align:right">T1</th><th style="text-align:right">T2</th><th style="text-align:right">T3</th><th style="text-align:right">Final Avg</th>':'<th>Subject</th><th style="text-align:right">Final Grade</th>'}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const w = window.open('', '_blank', 'width=780,height=900');
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">{name}</p>
          {admNo && <p className="text-xs text-slate-400">{admNo}</p>}
        </div>
        <div className="flex items-center gap-2">
          {student.classId && <span className="text-xs text-slate-400">{student.classId}</span>}
          <button onClick={printCard} title="Print report card"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">
            <Printer size={13} />
          </button>
        </div>
      </div>

      {template === 'summary' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5">Subject</th>
                {TERM_NUMBERS.map(n => (
                  <th key={n} className="text-right text-xs font-medium text-slate-500 px-4 py-2.5">Term {n}</th>
                ))}
                <th className="text-right text-xs font-medium text-slate-700 px-4 py-2.5 bg-slate-100/50">Final avg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subjects.map(([subId, data]) => {
                const t1 = data.terms?.[1]?.termTotal;
                const t2 = data.terms?.[2]?.termTotal;
                const t3 = data.terms?.[3]?.termTotal;
                return (
                  <tr key={subId} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{subId}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${_scoreColor(t1)}`}>{_pct(t1)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${_scoreColor(t2)}`}>{_pct(t2)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${_scoreColor(t3)}`}>{_pct(t3)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-bold bg-slate-50 ${_scoreColor(data.summaryAverage)}`}>
                      {_pct(data.summaryAverage)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        termsToShow.map(termN => (
          <div key={termN} className="border-b border-slate-100 last:border-0">
            <div className="px-5 py-2 bg-indigo-50/60 border-b border-indigo-100">
              <p className="text-xs font-semibold text-indigo-700">
                {half ? `Term ${termN} — Half-Term Report` : `Term ${termN} Report`}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5">Subject</th>
                    <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5">CA avg</th>
                    <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5">HW avg</th>
                    <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5">MT</th>
                    {!half && <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5">ET</th>}
                    {!half && <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5">Term total</th>}
                    {half  && <th className="text-right text-xs font-medium text-amber-600 px-3 py-2.5 bg-amber-50/40">Half-term /100</th>}
                    {!half && termN >= 2 && <th className="text-right text-xs text-slate-400 px-3 py-2.5">ET avg (ref)</th>}
                    {!half && <th className="text-right text-xs font-bold text-slate-700 px-4 py-2.5 bg-slate-50/60">Final grade</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subjects.map(([subId, data]) => {
                    const t = data.terms?.[termN];
                    if (!t) return (
                      <tr key={subId}>
                        <td className="px-4 py-2.5 text-slate-400 text-xs italic" colSpan={8}>
                          {subId} — no data for Term {termN}
                        </td>
                      </tr>
                    );
                    return (
                      <tr key={subId} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{subId}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${_scoreColor(t.typeAvgs?.CA)}`}>{_pct(t.typeAvgs?.CA)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${_scoreColor(t.typeAvgs?.HW)}`}>{_pct(t.typeAvgs?.HW)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${_scoreColor(t.typeAvgs?.MT)}`}>{_pct(t.typeAvgs?.MT)}</td>
                        {!half && <td className={`px-3 py-2.5 text-right tabular-nums ${_scoreColor(t.typeAvgs?.ET)}`}>{_pct(t.typeAvgs?.ET)}</td>}
                        {!half && <td className={`px-3 py-2.5 text-right tabular-nums ${_scoreColor(t.termTotal)}`}>{_pct(t.termTotal)}</td>}
                        {half  && <td className={`px-3 py-2.5 text-right tabular-nums font-semibold bg-amber-50/40 ${_scoreColor(t.halfTermTotal)}`}>{_pct(t.halfTermTotal)}</td>}
                        {!half && termN >= 2 && <td className={`px-3 py-2.5 text-right tabular-nums text-slate-400 ${_scoreColor(t.etRunningAvg)}`}>{_pct(t.etRunningAvg)}</td>}
                        {!half && <td className={`px-4 py-2.5 text-right tabular-nums font-bold bg-slate-50/60 ${_scoreColor(t.finalGrade)}`}>{_pct(t.finalGrade)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
