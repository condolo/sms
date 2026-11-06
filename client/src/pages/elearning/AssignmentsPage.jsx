/**
 * eLearning → Assignments (native)
 *
 * The teacher's surface for work issued in Msingi itself: create, see who
 * has turned it in, and grade. Grading calls the same planner Google
 * Classroom uses, so the mark lands in the Markbook under the same locks —
 * and when it cannot, the reason is shown instead of failing silently.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, ChevronRight, ClipboardList,
  Loader2, Plus, X,
} from 'lucide-react';
import { assignments as api, assessment, classes, classSubjects, subjects } from '@/api/client.js';

const TYPE_LABEL = {
  ASSIGNMENT: 'Assignment',
  SHORT_ANSWER_QUESTION: 'Question',
  MULTIPLE_CHOICE_QUESTION: 'Quiz',
  MATERIAL: 'Material',
};

function cls(...parts) {
  return parts.filter(Boolean).join(' ');
}

function isoPlusDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ── Toast ──────────────────────────────────────────────────── */
function Toast({ toast, onDismiss }) {
  if (!toast) return null;
  return (
    <div className="fixed top-4 right-4 z-[70] max-w-sm">
      <div className={cls(
        'flex items-start gap-2 rounded-xl border px-4 py-3 shadow-lg text-sm',
        toast.type === 'error'
          ? 'bg-red-50 border-red-200 text-red-800'
          : 'bg-emerald-50 border-emerald-200 text-emerald-800',
      )}>
        {toast.type === 'error'
          ? <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          : <CheckCircle2 size={16} className="mt-0.5 shrink-0" />}
        <span className="flex-1">{toast.msg}</span>
        <button type="button" onClick={onDismiss} className="opacity-60 hover:opacity-100">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

/* ── Create modal ───────────────────────────────────────────── */
function CreateModal({ open, onClose, onCreated, classList }) {
  const [form, setForm] = useState({
    type: 'ASSIGNMENT',
    title: '',
    description: '',
    classId: '',
    subjectId: '',
    dueDate: isoPlusDays(7),
    dueTime: '23:59',
    maxPoints: '20',
    assessmentScheduleId: '',
  });
  const [toast, setToast] = useState(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const subjectsQuery = useQuery({
    queryKey: ['class-subjects', form.classId],
    queryFn: () => classSubjects.list({ classId: form.classId }),
    enabled: open && !!form.classId,
    retry: false,
  });
  const allowedSubjectIds = useMemo(() => {
    const rows = subjectsQuery.data?.data ?? [];
    return rows.map(r => r.subjectId);
  }, [subjectsQuery.data]);

  const subjectsQueryAll = useQuery({
    queryKey: ['subjects'],
    queryFn: () => subjects.list(),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const subjectList = subjectsQueryAll.data?.data ?? [];

  const scheduleQuery = useQuery({
    queryKey: ['assessment', 'schedule'],
    queryFn: () => assessment.getSchedule(),
    enabled: open,
    retry: false,
  });
  const schedules = scheduleQuery.data?.data ?? [];

  const create = useMutation({
    mutationFn: () => api.create({
      classId: form.classId,
      subjectId: form.subjectId,
      type: form.type,
      title: form.title.trim(),
      description: form.description.trim(),
      dueDate: form.dueDate || null,
      dueTime: form.dueTime || null,
      maxPoints: form.type === 'MATERIAL' ? null : Number(form.maxPoints || 100),
      assessmentScheduleId: form.assessmentScheduleId || null,
    }),
    onSuccess: () => {
      onCreated();
      onClose();
      setForm({
        type: 'ASSIGNMENT', title: '', description: '', classId: '', subjectId: '',
        dueDate: isoPlusDays(7), dueTime: '23:59', maxPoints: '20', assessmentScheduleId: '',
      });
    },
    onError: err => setToast({ type: 'error', msg: err.message }),
  });

  if (!open) return null;

  const iCls = 'w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white';

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4 pb-4 sm:pb-0">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">New assignment</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          <Toast toast={toast} onDismiss={() => setToast(null)} />

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Type</label>
            <div className="grid grid-cols-3 gap-2">
              {[['ASSIGNMENT', 'Assignment'], ['SHORT_ANSWER_QUESTION', 'Question'], ['MATERIAL', 'Material']].map(([v, label]) => (
                <button
                  key={v} type="button" onClick={() => set('type', v)}
                  className={cls(
                    'py-2 rounded-xl text-sm font-medium border transition',
                    form.type === v
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 text-slate-600 hover:border-indigo-300',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} className={iCls} placeholder="e.g. Fractions worksheet" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Instructions</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} className={cls(iCls, 'resize-none')} placeholder="What should the student do?" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Class *</label>
              <select value={form.classId} onChange={e => { set('classId', e.target.value); set('subjectId', ''); }} className={iCls}>
                <option value="">Select class…</option>
                {classList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Subject *</label>
              <select value={form.subjectId} onChange={e => set('subjectId', e.target.value)} className={iCls} disabled={!form.classId}>
                <option value="">{form.classId ? 'Select subject…' : 'Pick a class first'}</option>
                {subjectList
                  .filter(s => !allowedSubjectIds.length || allowedSubjectIds.includes(s.id))
                  .map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {form.type !== 'MATERIAL' && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Due date</label>
                <input type="date" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} className={iCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Due time</label>
                <input type="time" value={form.dueTime} onChange={e => set('dueTime', e.target.value)} className={iCls} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Points</label>
                <input type="number" min="1" value={form.maxPoints} onChange={e => set('maxPoints', e.target.value)} className={iCls} />
              </div>
            </div>
          )}

          {form.type !== 'MATERIAL' && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Feeds Markbook (optional)</label>
              <select value={form.assessmentScheduleId} onChange={e => set('assessmentScheduleId', e.target.value)} className={iCls}>
                <option value="">Just record the grade on the assignment</option>
                {schedules.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.label || s.assessmentType} · Term {s.termNumber} · instance {s.instance ?? 1}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-400 mt-1">
                Linking a window lets the grade reach the Markbook under its normal locks and publish flow.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-6 pb-5 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={create.isPending || !form.title.trim() || !form.classId || !form.subjectId}
            onClick={() => create.mutate()}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
          >
            {create.isPending && <Loader2 size={14} className="animate-spin" />}
            Create assignment
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Detail / grading modal ─────────────────────────────────── */
function DetailModal({ assignment, onClose, onChanged }) {
  const [toast, setToast] = useState(null);
  const [grades, setGrades] = useState({});
  const [feedback, setFeedback] = useState({});
  const qc = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['assignments', assignment.id, 'submissions'],
    queryFn: () => api.submissions(assignment.id),
  });
  const rows = detailQuery.data?.data?.rows ?? [];

  const grade = useMutation({
    mutationFn: ({ studentId }) => api.grade(assignment.id, {
      studentId,
      assignedGrade: Number(grades[studentId]),
      feedback: feedback[studentId] || '',
    }),
    onSuccess: (res, vars) => {
      const mw = res?.data?.markWrite;
      const who = rows.find(r => r.studentId === vars.studentId)?.name || 'Student';
      if (mw?.status === 'WRITTEN') {
        setToast({ type: 'success', msg: `${who}: grade saved and written to the Markbook.` });
      } else if (mw?.status === 'SKIPPED') {
        setToast({ type: 'error', msg: `${who}: grade saved, but not written to the Markbook (${mw.reason.replace(/_/g, ' ')}). See exceptions.` });
      } else {
        setToast({ type: 'success', msg: `${who}: grade saved on the assignment (no Markbook window linked).` });
      }
      qc.invalidateQueries({ queryKey: ['assignments'] });
      onChanged?.();
    },
    onError: err => setToast({ type: 'error', msg: err.message }),
  });

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4 pb-4 sm:pb-0">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-semibold text-slate-900">{assignment.title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {TYPE_LABEL[assignment.type] || assignment.type}
              {' · '}
              {assignment.dueDate ? `Due ${assignment.dueDate}${assignment.dueTime ? ` ${assignment.dueTime}` : ''}` : 'No due date'}
              {assignment.maxPoints ? ` · ${assignment.maxPoints} points` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4">
          <Toast toast={toast} onDismiss={() => setToast(null)} />
          {detailQuery.isLoading ? (
            <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-slate-400" /></div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No students in this class.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {rows.map(row => {
                const sub = row.submission;
                const current = grades[row.studentId] ?? (sub?.assignedGrade ?? '');
                return (
                  <div key={row.studentId} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{row.name}</p>
                      <p className="text-[11px] text-slate-400">
                        {sub?.status === 'TURNED_IN' && `Submitted ${new Date(sub.submittedAt).toLocaleString()}`}
                        {sub?.status === 'GRADED' && `Graded${sub.rawScore != null ? ` · ${sub.rawScore}%` : ''}`}
                        {(!sub || sub.status === 'ASSIGNED') && 'Not submitted'}
                        {sub?.markWriteStatus === 'WRITTEN' && ' · in Markbook'}
                        {sub?.markWriteStatus === 'SKIPPED' && ` · not in Markbook (${String(sub.skipReason || '').replace(/_/g, ' ')})`}
                      </p>
                      {sub?.textAnswer && (
                        <p className="text-xs text-slate-600 mt-1 line-clamp-2 whitespace-pre-wrap">{sub.textAnswer}</p>
                      )}
                    </div>
                    {assignment.type !== 'MATERIAL' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <input
                          type="number" min="0" max={assignment.maxPoints || undefined}
                          value={current}
                          onChange={e => setGrades(g => ({ ...g, [row.studentId]: e.target.value }))}
                          placeholder="—"
                          className="w-20 text-sm border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                        <span className="text-[11px] text-slate-400">/ {assignment.maxPoints}</span>
                        <button
                          type="button"
                          disabled={grade.isPending || current === '' || current == null}
                          onClick={() => grade.mutate({ studentId: row.studentId })}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                        >
                          Save
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────── */
export default function AssignmentsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ classId: '', subjectId: '' });
  const qc = useQueryClient();

  const classQuery = useQuery({
    queryKey: ['classes', 'assignments-picker'],
    queryFn: () => classes.list(),
    staleTime: 5 * 60_000,
  });
  const classList = classQuery.data?.data ?? [];

  const subjectQuery = useQuery({
    queryKey: ['subjects'],
    queryFn: () => subjects.list(),
    staleTime: 5 * 60_000,
  });
  const subjectList = subjectQuery.data?.data ?? [];
  const subjectName = useMemo(
    () => Object.fromEntries(subjectList.map(s => [s.id, s.name])),
    [subjectList],
  );
  const className = useMemo(
    () => Object.fromEntries(classList.map(c => [c.id, c.name])),
    [classList],
  );

  const listQuery = useQuery({
    queryKey: ['assignments', filters],
    queryFn: () => api.list({
      ...(filters.classId ? { classId: filters.classId } : {}),
      ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    }),
  });
  const rows = listQuery.data?.data?.assignments ?? [];

  const exceptionsQuery = useQuery({
    queryKey: ['assignments', 'exceptions'],
    queryFn: () => api.exceptions(),
    retry: false,
  });
  const exceptions = exceptionsQuery.data?.data?.exceptions ?? [];

  const selCls = 'text-sm border border-slate-200 rounded-xl px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400';

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 sm:px-6 pt-5 pb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <ClipboardList size={20} className="text-indigo-600" /> Assignments
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Issue work, collect submissions and grade — no Google account needed.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
        >
          <Plus size={15} /> New assignment
        </button>
      </div>

      {exceptions.length > 0 && (
        <div className="mx-4 sm:mx-6 mb-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
          <AlertTriangle size={15} className="text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800">
            <strong>{exceptions.length}</strong> grade{exceptions.length === 1 ? '' : 's'} could not reach the Markbook.
            {' '}
            {exceptions.slice(0, 2).map(e => `${e.kind.replace(/_/g, ' ').toLowerCase()}`).join(', ')}
            {exceptions.length > 2 ? '…' : ''}
          </p>
        </div>
      )}

      <div className="mx-4 sm:mx-6 mb-3 flex flex-wrap gap-2">
        <select value={filters.classId} onChange={e => setFilters(f => ({ ...f, classId: e.target.value }))} className={selCls}>
          <option value="">All classes</option>
          {classList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filters.subjectId} onChange={e => setFilters(f => ({ ...f, subjectId: e.target.value }))} className={selCls}>
          <option value="">All subjects</option>
          {subjectList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 pb-6">
        {listQuery.isLoading ? (
          <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-slate-400" /></div>
        ) : listQuery.isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {listQuery.error?.message || 'Could not load assignments.'}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
            <ClipboardList size={28} className="mx-auto text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">No assignments yet</p>
            <p className="text-xs text-slate-400 mt-1">Create one and it appears for every student in the class immediately.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(a => {
              const pct = a.maxPoints ? Math.round(((a.gradedCount || 0) / Math.max(1, a.submittedCount || 0)) * 100) : 0;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelected(a)}
                  className="w-full text-left bg-white border border-slate-200 rounded-xl px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800 truncate">{a.title}</span>
                        <span className={cls(
                          'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full',
                          a.source === 'google_classroom'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-indigo-50 text-indigo-700 border border-indigo-200',
                        )}>
                          {a.source === 'google_classroom' ? 'GC' : 'Native'}
                        </span>
                        {a.status === 'DRAFT' && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Draft</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {subjectName[a.subjectId] || a.subjectId} · {className[a.classId] || a.classId}
                        {' · '}
                        {a.dueDate ? `Due ${a.dueDate}` : 'No due date'}
                        {a.maxPoints ? ` · ${a.maxPoints} pts` : ''}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        {a.submittedCount || 0} submitted · {a.gradedCount || 0} graded
                        {a.assessmentScheduleId ? ' · linked to Markbook' : ''}
                      </p>
                    </div>
                    <div className="shrink-0 flex items-center gap-2 text-slate-300">
                      <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, pct)}%` }} />
                      </div>
                      <ChevronRight size={16} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <CreateModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        classList={classList}
        onCreated={() => qc.invalidateQueries({ queryKey: ['assignments'] })}
      />
      {selected && (
        <DetailModal
          assignment={selected}
          onClose={() => setSelected(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: ['assignments'] })}
        />
      )}
    </div>
  );
}
