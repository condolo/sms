/**
 * eLearning → Assignments (list)
 *
 * The overview only: filters, counts and a way into the builder or a single
 * assignment's workspace page.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ChevronRight, ClipboardList, Loader2, Plus,
} from 'lucide-react';
import { assignments as api, classes, subjects } from '@/api/client.js';

function cls(...parts) {
  return parts.filter(Boolean).join(' ');
}

export default function AssignmentsPage() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ classId: '', subjectId: '' });

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
          onClick={() => navigate('/elearning/assignments/new')}
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
            Open an assignment to see the reason.
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
            <button
              type="button"
              onClick={() => navigate('/elearning/assignments/new')}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
            >
              <Plus size={14} /> New assignment
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(a => {
              const pct = a.maxPoints ? Math.round(((a.gradedCount || 0) / Math.max(1, a.submittedCount || 0)) * 100) : 0;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => navigate(`/elearning/assignments/${a.id}`)}
                  className="w-full text-left bg-white border border-slate-200 rounded-xl px-4 py-3 hover:border-indigo-300 hover:shadow-sm transition"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-800 truncate">{a.title}</span>
                        {a.answerMode === 'quiz' && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">Quiz</span>
                        )}
                        {a.answerMode === 'file' && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">File</span>
                        )}
                        <span className={cls(
                          'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border',
                          a.source === 'google_classroom'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-indigo-50 text-indigo-700 border-indigo-200',
                        )}>
                          {a.source === 'google_classroom' ? 'GC' : 'Native'}
                        </span>
                        {a.status === 'DRAFT' && (
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Draft</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {a.subjectName || subjectName[a.subjectId] || a.subjectId} · {a.className || className[a.classId] || a.classId}
                        {' · '}
                        {a.dueDate ? `Due ${a.dueDate}` : 'No due date'}
                        {a.maxPoints ? ` · ${a.maxPoints} pts` : ''}
                        {a.questions?.length ? ` · ${a.questions.length} questions` : ''}
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
    </div>
  );
}
