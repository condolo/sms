/**
 * Student Portal → My Assignments (list)
 * Each card opens the assignment's own page.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen, CheckCircle2, ChevronLeft, Clock, Loader2,
} from 'lucide-react';
import useAuthStore from '@/store/auth.js';
import { assignments as api } from '@/api/client.js';

function cls(...parts) {
  return parts.filter(Boolean).join(' ');
}

function statusOf(a) {
  const sub = a.submission;
  if (!sub || sub.status === 'ASSIGNED') return { key: 'todo', label: 'Not submitted' };
  if (sub.status === 'TURNED_IN') return { key: 'submitted', label: 'Submitted' };
  if (sub.status === 'GRADED' || sub.status === 'RETURNED') {
    return {
      key: 'graded',
      label: sub.assignedGrade != null
        ? `Graded ${sub.assignedGrade}${a.maxPoints ? `/${a.maxPoints}` : ''}`
        : 'Graded',
    };
  }
  return { key: 'todo', label: 'Not submitted' };
}

export default function StudentAssignmentsPage() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.session?.user);

  useEffect(() => {
    if (!user) navigate('/login', { replace: true });
  }, [user, navigate]);

  const listQuery = useQuery({
    queryKey: ['student', 'assignments'],
    queryFn: () => api.list(),
    enabled: !!user,
  });
  const rows = listQuery.data?.data?.assignments ?? [];

  const todo = rows.filter(a => statusOf(a).key === 'todo' && a.type !== 'MATERIAL');
  const done = rows.filter(a => statusOf(a).key !== 'todo' || a.type === 'MATERIAL');

  const card = (a) => {
    const st = statusOf(a);
    const sub = a.submission;
    const graded = st.key === 'graded';
    return (
      <button
        key={a.id}
        type="button"
        onClick={() => navigate(`/student-assignments/${a.id}`)}
        className={cls(
          'w-full text-left bg-white border rounded-xl px-4 py-3 transition',
          graded ? 'border-emerald-200' : 'border-slate-200 hover:border-indigo-300 hover:shadow-sm',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{a.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {a.dueDate ? `Due ${a.dueDate}${a.dueTime ? ` ${a.dueTime}` : ''}` : 'No due date'}
              {a.maxPoints ? ` · ${a.maxPoints} pts` : ''}
              {a.answerMode === 'quiz' ? ` · ${a.questions?.length || 0} questions` : ''}
            </p>
            {graded && sub?.feedback && (
              <p className="text-xs text-slate-600 mt-1.5 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5">
                “{sub.feedback}”
              </p>
            )}
          </div>
          <span className={cls(
            'shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full',
            graded ? 'bg-emerald-50 text-emerald-700'
              : st.key === 'submitted' ? 'bg-sky-50 text-sky-700'
                : 'bg-amber-50 text-amber-700',
          )}>
            {st.label}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 py-5">
        <button type="button" onClick={() => navigate('/student-dashboard')} className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 mb-4">
          <ChevronLeft size={14} /> Back to dashboard
        </button>

        <div className="flex items-center gap-2 mb-1">
          <BookOpen size={20} className="text-indigo-600" />
          <h1 className="text-xl font-bold text-slate-900">My assignments</h1>
        </div>
        <p className="text-xs text-slate-400 mb-4">Work issued to your class. Submit before the due date.</p>

        {listQuery.isLoading ? (
          <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-slate-400" /></div>
        ) : listQuery.isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {listQuery.error?.message || 'Could not load your assignments.'}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
            <CheckCircle2 size={26} className="mx-auto text-emerald-400" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Nothing due right now</p>
            <p className="text-xs text-slate-400 mt-1">New work will appear here when a teacher issues it.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {todo.length > 0 && (
              <div>
                <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-1.5">
                  <Clock size={12} /> To do
                </h2>
                <div className="space-y-2">{todo.map(card)}</div>
              </div>
            )}
            {done.length > 0 && (
              <div>
                <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Submitted & graded</h2>
                <div className="space-y-2">{done.map(card)}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
