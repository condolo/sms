/* ============================================================
   KgStudentReportCard — one student's Kindergarten / competency-band
   report preview. Deliberately separate from StudentReportCard.jsx:
   the data shape (indicators/bands per subject, no finalScore/CA-HW-MT-ET
   breakdown, no ranking/deviation) doesn't fit that component's numeric
   table, and the backend itself keeps these two pipelines separate
   (report-cards.js's /kg/generate vs /generate) rather than branching
   one component on class type.
   ============================================================ */
import { useState, useEffect, useCallback } from 'react';
import { CheckCircle } from 'lucide-react';

function Field({ label, value, onChange, multiline = false }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={3}
          className="w-full text-xs text-slate-700 border border-slate-200 rounded-md px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400" />
      ) : (
        <input type="text" value={value} onChange={e => onChange(e.target.value)}
          className="w-full text-xs text-slate-700 border border-slate-200 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
      )}
    </div>
  );
}

function gradeColor(grade) {
  if (!grade) return 'text-slate-400';
  const g = grade.toUpperCase();
  if (g.startsWith('A')) return 'text-emerald-600';
  if (g.startsWith('B')) return 'text-indigo-600';
  if (g.startsWith('C')) return 'text-amber-600';
  return 'text-red-500';
}

export default function KgStudentReportCard({
  student, className, termNum, academicYear,
  draftComment, onSaveComment, snapshot,
}) {
  const display = student.display ?? {};
  const showScore = display.showScore !== false;
  const showGrade = display.showGrade !== false;

  const [comment, setComment] = useState({
    classTeacherRemark: draftComment?.classTeacherRemark ?? '',
    principalRemark:    draftComment?.principalRemark    ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  // Reported directly: saving a KG class teacher remark showed no success
  // message and the button never changed — there was no "saved" state at
  // all here (unlike StudentReportCard.jsx's equivalent), and no catch
  // block either, so a rejected save (e.g. 403 "Only this stream's form
  // teacher can write the class teacher remark") failed completely
  // silently, with nothing telling the caller it had failed, let alone why.
  const [commentError, setCommentError] = useState(null);

  useEffect(() => {
    setComment({
      classTeacherRemark: draftComment?.classTeacherRemark ?? '',
      principalRemark:    draftComment?.principalRemark    ?? '',
    });
  }, [draftComment]);

  const set = (field) => (value) => setComment(c => ({ ...c, [field]: value }));

  const saveNow = useCallback(async () => {
    if (!onSaveComment) return;
    setSaving(true);
    setCommentError(null);
    try {
      await onSaveComment(comment);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setCommentError(err?.message ?? 'Could not save — please try again.');
    } finally {
      setSaving(false);
    }
  }, [comment, onSaveComment]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-bold text-slate-800">{student.studentName}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {student.admissionNo && `Adm. ${student.admissionNo} · `}
            {className}{student.streamName ? ` · ${student.streamName}` : ''}
            {termNum ? ` · Term ${termNum}` : ''}{academicYear ? ` · ${academicYear}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-violet-600 bg-violet-50 px-2.5 py-1 rounded-full">
            {student.templateName}
          </span>
          {snapshot?.reportId && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
              <CheckCircle size={10} /> {snapshot.reportId}
            </span>
          )}
        </div>
      </div>

      {/* Subjects */}
      <div className="divide-y divide-slate-50">
        {(student.subjects ?? []).map(subj => (
          <div key={subj.subjectId} className="px-5 py-3.5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-slate-700">{subj.name}</p>
              <p className="text-xs">
                <span className="text-slate-400">
                  {subj.possible > 0 ? `${subj.earned}/${subj.possible} · ` : ''}
                </span>
                <span className="font-semibold text-slate-700">
                  {subj.subjectAvgPct != null ? `${Math.round(subj.subjectAvgPct)}%` : '—'}
                </span>
                {showGrade && subj.subjectGrade && (
                  <span className={`ml-1.5 font-bold ${gradeColor(subj.subjectGrade)}`}>{subj.subjectGrade}</span>
                )}
              </p>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-slate-400 text-left">
                  <th className="font-medium pb-1">Indicator</th>
                  <th className="font-medium pb-1 w-32">Band</th>
                  {showScore && <th className="font-medium pb-1 w-20 text-right">Score</th>}
                </tr>
              </thead>
              <tbody>
                {(subj.indicators ?? []).map(ind => (
                  <tr key={ind.indicatorId} className="border-t border-slate-50">
                    <td className="py-1.5 pr-2 text-slate-600">{ind.text}</td>
                    <td className="py-1.5 pr-2">
                      {ind.bandLabel ? (
                        <span className="text-slate-700">{ind.bandLabel}</span>
                      ) : (
                        <span className="text-slate-300 italic">Not scored</span>
                      )}
                    </td>
                    {showScore && (
                      <td className="py-1.5 text-right text-slate-600">
                        {ind.score != null ? `${ind.score}/${ind.maxScore}` : '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Overall */}
      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">Overall Average</p>
        <p className="text-sm font-bold text-slate-800">
          {student.overallAvgPct != null ? `${Math.round(student.overallAvgPct)}%` : '—'}
          {showGrade && student.overallGrade && (
            <span className={`ml-2 ${gradeColor(student.overallGrade)}`}>{student.overallGrade}</span>
          )}
        </p>
      </div>

      {/* Remarks */}
      <div className="px-5 py-3.5 border-t border-slate-100 grid sm:grid-cols-2 gap-3">
        <Field label="Class Teacher Remarks" value={comment.classTeacherRemark} onChange={set('classTeacherRemark')} multiline />
        <Field label="Principal / Section Head Remarks" value={comment.principalRemark} onChange={set('principalRemark')} multiline />
      </div>
      <div className="px-5 pb-3.5 flex justify-end items-center gap-2">
        {commentError && <p className="text-[11px] text-red-600">{commentError}</p>}
        <button
          onClick={saveNow}
          disabled={saving}
          className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
        >
          {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save remarks'}
        </button>
      </div>
    </div>
  );
}
