/* ============================================================
   IndicatorMarkbook — Kindergarten / competency-band mark entry
   (2026-10). Renders INSTEAD of the numeric grid in MarkbookTab
   (ExamsPage.jsx) whenever the selected class resolves to an
   rc_template (server/utils/rc-template-scale.js) whose subjects
   include the one currently selected — a class either uses this
   subject's indicators or the ordinary numeric Markbook, never both.

   Entry is per-student: open a student, see every indicator for this
   subject, pick a Performance Band (prefills the score, overridable)
   or type a score directly, save all of that student's indicators for
   this subject in one request (POST /indicator-marks/bulk).

   Now wired to mark_submissions review-state (2026-10) — submit for
   review, recall, approve/reject, all through the SAME collection/
   state-machine the numeric Markbook already uses (server/routes/
   mark-submissions.js), keyed by the reserved 'kg_indicators'
   assessmentType sentinel (indicator marks have no real
   assessmentType/instance of their own). Self-contained: queries its
   own submission status rather than ExamsPage.jsx passing anything
   extra down, since nothing else on that page needs it.

   `isLocked` (prop) is still the assessment_schedule ENTRY's own
   admin-set lock flag, unrelated to and independent from the review
   lock below — a class's whole CA window being locked is a different
   concern from this one subject's marks being under review.
   ============================================================ */
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Save, Loader2, CheckCircle2, XCircle, RotateCcw, Send, AlertTriangle, Lock, ChevronRight } from 'lucide-react';
import { indicatorMarks as api, markSubmissions as markSubmissionsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

// Reserved sentinel — must match server/routes/mark-submissions.js's
// KG_INDICATORS_TYPE exactly. Indicator marks have no real
// assessmentType/instance of their own; this is how they key into the
// same mark_submissions collection/state-machine the numeric Markbook
// already uses, without inventing a second moderation system.
const KG_INDICATORS_TYPE = 'kg_indicators';

const SUBMISSION_BADGE = {
  submitted: { label: 'Submitted', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
  approved:  { label: 'Approved',  cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  rejected:  { label: 'Rejected',  cls: 'text-red-700 bg-red-50 border-red-200' },
  locked:    { label: 'Locked',    cls: 'text-slate-600 bg-slate-100 border-slate-200' },
};

const BAND_PILL = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue:    'bg-blue-50    text-blue-700    border-blue-200',
  amber:   'bg-amber-50   text-amber-700   border-amber-200',
  red:     'bg-red-50     text-red-700     border-red-200',
  purple:  'bg-purple-50  text-purple-700  border-purple-200',
  slate:   'bg-slate-100  text-slate-700   border-slate-200',
  orange:  'bg-orange-50  text-orange-700  border-orange-200',
  teal:    'bg-teal-50    text-teal-700    border-teal-200',
  indigo:  'bg-indigo-50  text-indigo-700  border-indigo-200',
  rose:    'bg-rose-50    text-rose-700    border-rose-200',
};

/* A subject's own bands win over the template's — never merged. Same
   rule server/utils/rc-template-scale.js's effectiveBandsForSubject
   enforces; duplicated here (not imported) since that's a server util. */
function effectiveBands(template, templateSubject) {
  return templateSubject?.performanceBands?.length ? templateSubject.performanceBands : (template?.performanceBands ?? []);
}

/* ── Toast ───────────────────────────────────────────────────── */
function Toast({ msg, type, onDismiss }) {
  const isErr = type === 'error';
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b ${
        isErr ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }`}
    >
      {isErr ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      {msg}
      <button onClick={onDismiss} className="ml-auto opacity-60 hover:opacity-100"><X size={12} /></button>
    </motion.div>
  );
}

/* ── Per-student slide-over ─────────────────────────────────── */
function StudentIndicatorSlideOver({
  student, indicators, bands, existingMarks,
  classId, subjectId, streamId, templateId, termNumber, academicYearId,
  onClose, onSaved, onError,
}) {
  const [rows, setRows] = useState(() => {
    const init = {};
    for (const ind of indicators) {
      const existing = existingMarks[ind.id];
      init[ind.id] = { bandId: existing?.bandId ?? '', score: existing?.score ?? '' };
    }
    return init;
  });

  function pickBand(indicatorId, bandId) {
    const band = bands.find(b => b.id === bandId);
    setRows(r => ({
      ...r,
      [indicatorId]: {
        bandId,
        // Prefill from the band's default — never overwrites a score the
        // teacher already typed for this indicator.
        score: r[indicatorId].score === '' ? (band?.defaultScore ?? '') : r[indicatorId].score,
      },
    }));
  }
  function setScore(indicatorId, score) {
    setRows(r => ({ ...r, [indicatorId]: { ...r[indicatorId], score } }));
  }

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => {
      const marks = indicators
        .filter(ind => rows[ind.id].score !== '' && rows[ind.id].score !== null)
        .map(ind => ({
          studentId: student.id ?? student._id,
          classId, subjectId, templateId,
          indicatorId: ind.id,
          bandId: rows[ind.id].bandId || null,
          score: Number(rows[ind.id].score),
          termNumber, academicYearId: academicYearId || undefined,
        }));
      if (marks.length === 0) return Promise.resolve({ data: { saved: 0 } });
      return api.bulkSave(marks);
    },
    onSuccess: onSaved,
    onError: err => onError(err?.message ?? 'Failed to save.'),
  });

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/30 z-40" onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 35 }}
        className="fixed inset-y-0 right-0 w-full max-w-xl bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-semibold text-slate-900">{student.firstName} {student.lastName}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
          {indicators.length === 0 && (
            <p className="text-sm text-slate-400 italic text-center py-8">This subject has no indicators defined yet — add some in Kindergarten Templates.</p>
          )}
          {indicators.map(ind => {
            const row = rows[ind.id];
            return (
              <div key={ind.id} className="border border-slate-200 rounded-xl p-3 space-y-2">
                <p className="text-sm text-slate-700">{ind.text}</p>
                <div className="flex items-center gap-2">
                  <select
                    value={row.bandId}
                    onChange={e => pickBand(ind.id, e.target.value)}
                    className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                  >
                    <option value="">No band</option>
                    {bands.map(b => (
                      <option key={b.id} value={b.id}>{b.label} ({b.grade})</option>
                    ))}
                  </select>
                  <div className="relative shrink-0">
                    <input
                      type="number" min="0" max={ind.maxScore} step="0.5"
                      value={row.score}
                      onChange={e => setScore(ind.id, e.target.value)}
                      placeholder="Score"
                      className="w-20 text-sm text-right border border-slate-200 rounded-lg pl-2 pr-8 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                    />
                    <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] pointer-events-none">/{ind.maxScore}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0 bg-white">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-100 transition">
            Cancel
          </button>
          <button
            onClick={() => save()}
            disabled={saving}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ── Main panel ──────────────────────────────────────────────── */
export default function IndicatorMarkbook({
  classId, subjectId, streamId, students, template, templateSubject,
  termNumber, academicYearId, isLocked, className, subjectName,
}) {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);
  const [openStudentId, setOpenStudentId] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const role = useAuthStore(s => s.session?.user?.role ?? '');
  const canReview = role !== 'teacher';

  const bands = effectiveBands(template, templateSubject);
  const indicators = useMemo(
    () => [...(templateSubject.indicators ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [templateSubject]
  );

  const { data: marksData, isLoading } = useQuery({
    queryKey: ['indicator-marks', { classId, subjectId, termNumber, academicYearId }],
    queryFn:  () => api.list({ classId, subjectId, termNumber, academicYearId: academicYearId || undefined }),
    enabled:  !!classId && !!subjectId,
    staleTime: 15_000,
  });
  const marksByStudent = useMemo(() => {
    const map = {};
    for (const m of marksData?.data ?? []) {
      if (!map[m.studentId]) map[m.studentId] = {};
      map[m.studentId][m.indicatorId] = m;
    }
    return map;
  }, [marksData]);

  // mark_submissions — same collection/state-machine the numeric Markbook
  // uses, keyed by the KG sentinel assessmentType instead of a real CA/
  // HW/MT/ET type+instance. Natural key here has no instance at all.
  const { data: submissionData } = useQuery({
    queryKey: ['markSubmissions', 'kg', { classId, subjectId, streamId, termNumber, academicYearId }],
    queryFn:  () => markSubmissionsApi.list({
      classId, subjectId, streamId: streamId || undefined, termNumber,
      assessmentType: KG_INDICATORS_TYPE, academicYearId: academicYearId || undefined,
    }),
    enabled: !!classId && !!subjectId,
    staleTime: 15_000,
  });
  const submission = submissionData?.data?.[0] ?? null;
  const underReview = ['submitted', 'approved'].includes(submission?.status);
  const reviewLocked = submission?.status === 'locked';
  // Schedule-level lock (prop, admin-set, whole CA window) and review-
  // level lock (this one subject's marks, via mark_submissions) are
  // independent reasons entry can be closed — either one disables it.
  const entryClosed = isLocked || underReview || reviewLocked;

  const { mutate: submitForReview, isPending: submitting } = useMutation({
    mutationFn: () => markSubmissionsApi.submit({
      classId, subjectId, streamId: streamId || undefined, termNumber,
      assessmentType: KG_INDICATORS_TYPE, academicYearId: academicYearId || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['markSubmissions', 'kg'] });
      setToast({ msg: 'Submitted for review.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to submit for review.', type: 'error' }),
  });

  const { mutate: recallSubmission, isPending: recalling } = useMutation({
    mutationFn: () => markSubmissionsApi.recall(submission.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['markSubmissions', 'kg'] }),
    onError: err => setToast({ msg: err?.message ?? 'Failed to recall.', type: 'error' }),
  });

  const { mutate: reviewSubmission, isPending: reviewing } = useMutation({
    mutationFn: ({ action, rejectionReason }) => markSubmissionsApi.review(submission.id, { action, rejectionReason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['markSubmissions', 'kg'] });
      setRejecting(false);
      setRejectReason('');
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to review.', type: 'error' }),
  });

  function scoredCount(studentId) {
    const sm = marksByStudent[studentId] ?? {};
    return indicators.filter(ind => sm[ind.id]).length;
  }

  const openStudent = students.find(s => (s.id ?? s._id) === openStudentId);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <AnimatePresence>
        {toast && <div className="relative"><Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} /></div>}
      </AnimatePresence>

      {isLocked && (
        <div className="flex items-center gap-3 px-5 py-3 bg-red-50 border-b border-red-200">
          <Lock size={14} className="text-red-600 shrink-0" />
          <p className="text-sm font-semibold text-red-800">Mark entry locked — contact an administrator to unlock.</p>
        </div>
      )}
      {!isLocked && reviewLocked && (
        <div className="flex items-center gap-3 px-5 py-3 bg-slate-50 border-b border-slate-200">
          <Lock size={14} className="text-slate-500 shrink-0" />
          <p className="text-sm font-semibold text-slate-700">These marks are locked after approval — request an unlock to edit.</p>
        </div>
      )}
      {!isLocked && !reviewLocked && submission?.status === 'rejected' && (
        <div className="flex items-center gap-3 px-5 py-3 bg-red-50 border-b border-red-200">
          <XCircle size={14} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-800"><span className="font-semibold">Rejected:</span> {submission.rejectionReason || 'No reason given'}</p>
        </div>
      )}

      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/50 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-slate-800 truncate">{className} · {subjectName}</span>
          {submission && SUBMISSION_BADGE[submission.status] && (
            <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${SUBMISSION_BADGE[submission.status].cls}`}>
              {submission.status === 'approved' && <CheckCircle2 size={9} />}
              {submission.status === 'rejected' && <XCircle size={9} />}
              {submission.status === 'locked'   && <Lock size={9} />}
              {SUBMISSION_BADGE[submission.status].label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-slate-400">{template.name} · {indicators.length} indicator{indicators.length !== 1 ? 's' : ''} · Competency-band entry</span>
          {!isLocked && !reviewLocked && submission?.status === 'submitted' && (
            <button
              onClick={() => recallSubmission()}
              disabled={recalling}
              className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-40"
              title="Recall to draft"
            >
              <RotateCcw size={11} /> Recall
            </button>
          )}
          {!isLocked && !reviewLocked && submission?.status === 'submitted' && canReview && !rejecting && (
            <div className="flex items-center gap-1.5">
              <button onClick={() => reviewSubmission({ action: 'approve' })} disabled={reviewing} title="Approve" className="text-emerald-600 hover:text-emerald-700 disabled:opacity-40">
                <CheckCircle2 size={14} />
              </button>
              <button onClick={() => setRejecting(true)} disabled={reviewing} title="Reject" className="text-red-500 hover:text-red-700 disabled:opacity-40">
                <XCircle size={14} />
              </button>
            </div>
          )}
          {!isLocked && !reviewLocked && submission?.status === 'submitted' && canReview && rejecting && (
            <div className="flex items-center gap-1.5">
              <input
                type="text" value={rejectReason} onChange={e => setRejectReason(e.target.value)} autoFocus
                placeholder="Reason" className="w-28 text-[11px] px-1.5 py-1 rounded border border-red-300 focus:outline-none focus:ring-1 focus:ring-red-400/30"
              />
              <button
                onClick={() => reviewSubmission({ action: 'reject', rejectionReason: rejectReason })}
                disabled={!rejectReason.trim() || reviewing}
                className="text-[11px] font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 px-2 py-1 rounded"
              >
                Confirm
              </button>
              <button onClick={() => { setRejecting(false); setRejectReason(''); }} className="text-[11px] text-slate-400 hover:text-slate-600">Cancel</button>
            </div>
          )}
          {!isLocked && !underReview && !reviewLocked && (
            <button
              onClick={() => submitForReview()}
              disabled={submitting}
              className="flex items-center gap-1 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 px-3 py-1.5 rounded-lg transition"
            >
              {submitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
              {submitting ? 'Submitting…' : 'Submit for review'}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="p-5 space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-slate-100 animate-pulse" />)}</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5">Student</th>
              <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5">Progress</th>
              <th className="text-right text-xs font-medium text-slate-500 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {students.map(s => {
              const sid = s.id ?? s._id;
              const count = scoredCount(sid);
              const done = indicators.length > 0 && count === indicators.length;
              return (
                <tr key={sid} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-2.5 text-slate-800 font-medium">{s.firstName} {s.lastName}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs ${done ? 'text-emerald-600 font-medium' : 'text-slate-500'}`}>
                      {count}/{indicators.length} indicators scored
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => setOpenStudentId(sid)}
                      disabled={entryClosed}
                      className="flex items-center gap-1 ml-auto text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {count > 0 ? 'Edit scores' : 'Score'} <ChevronRight size={11} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <AnimatePresence>
        {openStudent && (
          <StudentIndicatorSlideOver
            student={openStudent}
            indicators={indicators}
            bands={bands}
            existingMarks={marksByStudent[openStudentId] ?? {}}
            classId={classId} subjectId={subjectId} streamId={streamId}
            templateId={template.id} termNumber={termNumber} academicYearId={academicYearId}
            onClose={() => setOpenStudentId(null)}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: ['indicator-marks'] });
              setToast({ msg: 'Scores saved.', type: 'success' });
              setOpenStudentId(null);
            }}
            onError={msg => setToast({ msg, type: 'error' })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
