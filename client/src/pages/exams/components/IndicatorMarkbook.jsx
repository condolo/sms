/* ============================================================
   IndicatorMarkbook — Kindergarten / competency-band mark entry
   (2026-10). Renders INSTEAD of the numeric grid in MarkbookTab
   (ExamsPage.jsx) whenever the selected class resolves to an
   rc_template (server/utils/rc-template-scale.js) whose subjects
   include the one currently selected — a class either uses this
   subject's indicators or the ordinary numeric Markbook, never both.

   Indicators themselves are managed HERE, not in Kindergarten
   Templates (2026-10-19, direct request): "whoever is setting the
   template is like an admin, he doesn't know all the indicators per
   subject... these indicators vary depending on what content was
   set... they have to be added manually in the Markbook." The
   template still decides which subjects use this entry mode and the
   performance bands; the subject teacher now owns the indicator TEXT
   itself, scoped per class+subject+term (server/routes/
   indicator-marks.js's /definitions), so it's free to differ as the
   actual content taught changes.

   Entry is per-student: open a student, see every indicator for this
   subject, pick a Performance Band (prefills the score, overridable)
   or type a score directly, save all of that student's indicators for
   this subject in one request (POST /indicator-marks/bulk).

   Reads mark_submissions for its lock state (2026-10-13 workflow
   redesign) — the submit-for-review/recall/approve/reject UI was
   removed; a teacher can freely edit until the report card is
   published, which locks the matching mark_submissions doc
   automatically (server/routes/report-cards.js's /kg/publish), keyed
   by the reserved 'kg_indicators' assessmentType sentinel (indicator
   marks have no real assessmentType/instance of their own). The rare
   post-publish correction path (unlock-request → admin-approve →
   24h auto-relock) is unchanged and still lives in mark-submissions.js
   — just with no UI here, same as the numeric Markbook. Self-contained:
   queries its own submission status rather than ExamsPage.jsx passing
   anything extra down, since nothing else on that page needs it.

   `isLocked` (prop) is still the assessment_schedule ENTRY's own
   admin-set lock flag, unrelated to and independent from the review
   lock below — a class's whole CA window being locked is a different
   concern from this one subject's marks being under review.
   ============================================================ */
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Save, Loader2, CheckCircle2, AlertTriangle, Lock, ChevronRight, Plus, Pencil, Trash2, ListChecks } from 'lucide-react';
import { indicatorMarks as api, markSubmissions as markSubmissionsApi } from '@/api/client.js';

// Reserved sentinel — must match server/routes/mark-submissions.js's
// KG_INDICATORS_TYPE exactly. Indicator marks have no real
// assessmentType/instance of their own; this is how they key into the
// same mark_submissions collection/state-machine the numeric Markbook
// already uses, without inventing a second moderation system.
const KG_INDICATORS_TYPE = 'kg_indicators';

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
            <p className="text-sm text-slate-400 italic text-center py-8">No indicators yet — close this and add one above, under "Indicators for this term."</p>
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

/* ── Indicator manager (add/edit/delete) ──────────────────────
   Teacher-owned, scoped to this class+subject+term — see this file's
   own header. Deliberately lightweight compared to RCTemplatesSection's
   old admin editor: one text field, one maxScore field, inline. */
function IndicatorDefRow({ indicator, disabled, onSave, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [text, setText]       = useState(indicator.text);
  const [maxScore, setMaxScore] = useState(indicator.maxScore ?? 10);

  function commit() {
    const trimmed = text.trim();
    if (!trimmed) { setText(indicator.text); setEditing(false); return; }
    if (trimmed !== indicator.text || Number(maxScore) !== indicator.maxScore) {
      onSave({ text: trimmed, maxScore: Number(maxScore) || 10 });
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 py-1">
        <input
          autoFocus
          type="text" value={text} maxLength={400}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setText(indicator.text); setEditing(false); } }}
          onBlur={commit}
          className="flex-1 text-sm border border-indigo-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
        />
        <input
          type="number" min="1" max="1000" value={maxScore}
          onChange={e => setMaxScore(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); }}
          onBlur={commit}
          className="w-16 text-sm text-right border border-indigo-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1 group">
      <p className="flex-1 text-sm text-slate-700">{indicator.text}</p>
      <span className="text-xs text-slate-400 shrink-0">/{indicator.maxScore ?? 10}</span>
      {!disabled && (
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition">
          <button onClick={() => setEditing(true)} className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition" title="Edit">
            <Pencil size={12} />
          </button>
          <button
            onClick={() => { if (window.confirm(`Delete "${indicator.text}"?`)) onDelete(); }}
            className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function IndicatorManager({ indicators, disabled, onAdd, onSave, onDelete, adding }) {
  const [open, setOpen] = useState(indicators.length === 0);
  const [newText, setNewText] = useState('');
  const [newMax, setNewMax]   = useState(10);

  function submitAdd() {
    const trimmed = newText.trim();
    if (!trimmed) return;
    onAdd({ text: trimmed, maxScore: Number(newMax) || 10 });
    setNewText('');
    setNewMax(10);
  }

  return (
    <div className="border-b border-slate-100">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-2.5 bg-white hover:bg-slate-50 transition"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
          <ListChecks size={13} className="text-slate-400" />
          Indicators for this term ({indicators.length})
        </span>
        <ChevronRight size={13} className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-3 pt-0.5">
          {indicators.length === 0 && (
            <p className="text-xs text-slate-400 italic py-1">
              No indicators yet for this subject this term — add what was actually taught below.
            </p>
          )}
          <div className="divide-y divide-slate-50">
            {indicators.map(ind => (
              <IndicatorDefRow
                key={ind.id}
                indicator={ind}
                disabled={disabled}
                onSave={data => onSave(ind.id, data)}
                onDelete={() => onDelete(ind.id)}
              />
            ))}
          </div>
          {!disabled && (
            <div className="flex items-center gap-2 mt-2">
              <input
                type="text" value={newText} maxLength={400}
                onChange={e => setNewText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitAdd(); }}
                placeholder="e.g. Able to identify and name the five senses"
                className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
              />
              <input
                type="number" min="1" max="1000" value={newMax}
                onChange={e => setNewMax(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitAdd(); }}
                title="Maximum possible score"
                className="w-16 text-sm text-right border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
              />
              <button
                type="button" onClick={submitAdd} disabled={adding || !newText.trim()}
                className="flex items-center gap-1 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 px-3 py-1.5 rounded-lg transition shrink-0"
              >
                {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />} Add
              </button>
            </div>
          )}
        </div>
      )}
    </div>
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

  const bands = effectiveBands(template, templateSubject);

  // Indicator TEXT is teacher-managed per class+subject+term (2026-10-19)
  // — NOT read off the template any more. See this file's own header.
  const { data: indicatorDefsData } = useQuery({
    queryKey: ['indicator-definitions', { classId, subjectId, termNumber, academicYearId }],
    queryFn:  () => api.definitions.list({ classId, subjectId, termNumber, academicYearId: academicYearId || undefined }),
    enabled:  !!classId && !!subjectId,
    staleTime: 15_000,
  });
  const indicators = useMemo(
    () => [...(indicatorDefsData?.data ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [indicatorDefsData]
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
  // Submit-for-review no longer blocks editing (2026-10-13 workflow
  // redesign) — isLocked (schedule-level) and reviewLocked (set
  // automatically at report-card publish) are the only two reasons
  // entry can be closed now.
  const reviewLocked = submission?.status === 'locked';
  const entryClosed = isLocked || reviewLocked;

  /* ── Indicator management (add/edit/delete) ──────────────────
     Teacher-owned now — see this file's header. Mutations share the
     indicator-definitions query key so the list and every open
     slide-over stay in sync without a manual refetch call. */
  const defsQueryKey = ['indicator-definitions', { classId, subjectId, termNumber, academicYearId }];

  const { mutate: addIndicator, isPending: addingIndicator } = useMutation({
    mutationFn: (data) => api.definitions.create({ classId, subjectId, termNumber, academicYearId: academicYearId || undefined, ...data }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: defsQueryKey }); },
    onError:   err => setToast({ msg: err?.message ?? 'Failed to add indicator.', type: 'error' }),
  });
  const { mutate: editIndicator } = useMutation({
    mutationFn: ({ id, ...data }) => api.definitions.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: defsQueryKey }); },
    onError:   err => setToast({ msg: err?.message ?? 'Failed to save indicator.', type: 'error' }),
  });
  const { mutate: deleteIndicator } = useMutation({
    mutationFn: (id) => api.definitions.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: defsQueryKey }); },
    onError:   err => setToast({ msg: err?.message ?? 'Failed to delete indicator.', type: 'error' }),
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
          <p className="text-sm font-semibold text-slate-700">The report card for this term has been published — ask an administrator to unlock it for a correction.</p>
        </div>
      )}

      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/50 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-slate-800 truncate">{className} · {subjectName}</span>
          {reviewLocked && (
            <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 text-slate-600 bg-slate-100 border-slate-200">
              <Lock size={9} /> Locked
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-slate-400">{template.name} · Competency-band entry</span>
        </div>
      </div>

      <IndicatorManager
        indicators={indicators}
        disabled={entryClosed}
        adding={addingIndicator}
        onAdd={addIndicator}
        onSave={(id, data) => editIndicator({ id, ...data })}
        onDelete={deleteIndicator}
      />

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
