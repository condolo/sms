/* ============================================================
   KgStudentReportCard — one student's Kindergarten / competency-band
   report preview. Deliberately separate from StudentReportCard.jsx:
   the data shape (indicators/bands per subject, no finalScore/CA-HW-MT-ET
   breakdown, no ranking/deviation) doesn't fit that component's numeric
   table, and the backend itself keeps these two pipelines separate
   (report-cards.js's /kg/generate vs /generate) rather than branching
   one component on class type.
   ============================================================ */
import { useState, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react';
import { CheckCircle, Printer, Download, Loader2 } from 'lucide-react';
import { reportCards as reportCardsApi } from '@/api/client.js';

// Platform audit (2026-10-18): no client-side maxLength existed here —
// 1000 matches the server's DraftCommentBodySchema cap (report-cards.js).
function Field({ label, value, onChange, multiline = false, maxLength }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={3} maxLength={maxLength}
          className="w-full text-xs text-slate-700 border border-slate-200 rounded-md px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400" />
      ) : (
        <input type="text" value={value} onChange={e => onChange(e.target.value)} maxLength={maxLength}
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

const KgStudentReportCard = forwardRef(function KgStudentReportCard({
  student, classId, academicYearId, className, termNum, academicYear,
  draftComment, onSaveComment, snapshot,
}, ref) {
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

  // Reported directly, traced to a real data-loss mechanism (2026-10-18):
  // saving ANY student's comment in this class invalidates the whole
  // class's draftComments query (ReportCardsTab.jsx), handing every
  // mounted card a new `draftComment` reference even when its own data
  // hasn't changed. This used to resync unconditionally, silently wiping
  // a remark mid-edit for a different student the instant any other
  // save in the class landed. Same guard as StudentReportCard.jsx's
  // equivalent — never resync over an unsaved local edit.
  const computeDirty = () => {
    const original = {
      classTeacherRemark: draftComment?.classTeacherRemark ?? '',
      principalRemark:    draftComment?.principalRemark    ?? '',
    };
    return JSON.stringify(comment) !== JSON.stringify(original);
  };

  useEffect(() => {
    if (computeDirty()) return;
    setComment({
      classTeacherRemark: draftComment?.classTeacherRemark ?? '',
      principalRemark:    draftComment?.principalRemark    ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftComment]);

  const set = (field) => (value) => setComment(c => ({ ...c, [field]: value }));

  /* ── Print / Download PDF (2026-10) — reported directly, with a
     screenshot: this screen had neither button at all, unlike
     StudentReportCard.jsx's equivalent. A published snapshot uses the
     same generic GET /:id/html and /:id/pdf routes the numeric path
     uses (they dispatch on the snapshot's own frozen layoutKey, which
     /kg/publish sets to 'kindergarten'); a draft uses the new
     kg/preview-html and kg/preview-pdf routes — this screen's own
     "Save remarks" button is what persists classTeacherRemark/
     principalRemark first, so Print/Download always reflect exactly
     what was last saved, not an unsaved edit still sitting in the box. ── */
  const [printing, setPrinting] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  async function printCard() {
    setPrinting(true);
    try {
      const { data } = snapshot?.id
        ? await reportCardsApi.html(snapshot.id)
        : await reportCardsApi.kg.previewHtml({
            classId, studentId: student.studentId, termNumber: termNum, academicYearId,
          });
      const w = window.open('', '_blank', 'width=1200,height=900');
      if (!w) return;
      w.document.write(data.html);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 600);
    } catch (err) {
      console.error('[KgStudentReportCard] print failed', err);
      window.alert('Failed to generate the report card for printing. Please try again.');
    } finally {
      setPrinting(false);
    }
  }

  async function downloadPdf() {
    setDownloadingPdf(true);
    try {
      if (snapshot?.id) {
        await reportCardsApi.pdf(snapshot.id);
      } else {
        await reportCardsApi.kg.previewPdf({
          classId, studentId: student.studentId, termNumber: termNum, academicYearId,
        });
      }
    } catch (err) {
      console.error('[KgStudentReportCard] PDF download failed', err);
      window.alert('Failed to generate the PDF. Please try again.');
    } finally {
      setDownloadingPdf(false);
    }
  }

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

  // computeDirty is defined above (shared with the draftComment-resync
  // effect) — the parent calls flushIfDirty via ref before changing
  // Class/Stream/Term/Year context.
  useImperativeHandle(ref, () => ({
    isDirty: computeDirty,
    flushIfDirty: async () => {
      const isDirty = computeDirty();
      if (!isDirty || !onSaveComment) return true;
      try {
        await onSaveComment(comment);
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
        return true;
      } catch (err) {
        setCommentError(err?.message ?? 'Could not save — please try again.');
        return false;
      }
    },
  }), [comment, draftComment, onSaveComment]);

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
          <button onClick={downloadPdf} disabled={downloadingPdf} title="Download PDF directly"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition">
            {downloadingPdf ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Download PDF
          </button>
          <button onClick={printCard} disabled={printing} title="Print / Save PDF"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition">
            {printing ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />} Print
          </button>
        </div>
      </div>

      {/* Subjects */}
      <div className="divide-y divide-slate-50">
        {(student.subjects ?? []).map(subj => (
          <div key={subj.subjectId} className="px-5 py-3.5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold text-slate-700">{subj.name}</p>
              <p className="text-xs">
                {/* Band-only: no number was ever typed for this subject —
                    the band itself (e.g. "Secure") is the whole story. */}
                {subj.bandOnly ? (
                  <span className="font-semibold text-slate-700">{subj.subjectBandLabel || '—'}</span>
                ) : (
                  <>
                    <span className="text-slate-400">
                      {subj.possible > 0 ? `${subj.earned}/${subj.possible} · ` : ''}
                    </span>
                    <span className="font-semibold text-slate-700">
                      {/* 1 decimal, not rounded to a whole number — the grade
                          beside it is banded off this same precise value (see
                          kg-report.js), so rounding here alone made two
                          subjects with identical displayed %s show different
                          grades with nothing visible to explain why. Matches
                          the precision the printed report card already uses. */}
                      {subj.subjectAvgPct != null ? `${subj.subjectAvgPct.toFixed(1)}%` : '—'}
                    </span>
                  </>
                )}
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
                  {showScore && !subj.bandOnly && <th className="font-medium pb-1 w-20 text-right">Score</th>}
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
                    {showScore && !subj.bandOnly && (
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
          {student.overallBandOnly
            ? (student.overallBandLabel || '—')
            : (student.overallAvgPct != null ? `${student.overallAvgPct.toFixed(1)}%` : '—')}
          {showGrade && student.overallGrade && (
            <span className={`ml-2 ${gradeColor(student.overallGrade)}`}>{student.overallGrade}</span>
          )}
        </p>
      </div>

      {/* Remarks */}
      <div className="px-5 py-3.5 border-t border-slate-100 grid sm:grid-cols-2 gap-3">
        <Field label="Class Teacher Remarks" value={comment.classTeacherRemark} onChange={set('classTeacherRemark')} multiline maxLength={1000} />
        <Field label="Principal / Section Head Remarks" value={comment.principalRemark} onChange={set('principalRemark')} multiline maxLength={1000} />
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
});

export default KgStudentReportCard;
