/**
 * Student Portal → My Assignments
 *
 * A student sees the work issued to their class, opens one, types an
 * answer, and submits. Once graded, the score and the teacher's feedback
 * replace the submit box. Self-scoped by the server; this screen only ever
 * sees the caller's own class and submission.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BookOpen, CheckCircle2, ChevronLeft, Clock,
  Loader2, Send, X,
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

function SubmitModal({ assignment, onClose, onDone }) {
  const [answer, setAnswer] = useState('');
  const [toast, setToast] = useState(null);

  const submit = useMutation({
    mutationFn: () => api.submit(assignment.id, { textAnswer: answer.trim() }),
    onSuccess: () => { onDone(); onClose(); },
    onError: err => setToast({ type: 'error', msg: err.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm px-4 pb-4 sm:pb-0">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-semibold text-slate-900">{assignment.title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {assignment.dueDate ? `Due ${assignment.dueDate}${assignment.dueTime ? ` ${assignment.dueTime}` : ''}` : 'No due date'}
              {assignment.maxPoints ? ` · ${assignment.maxPoints} points` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
          {toast && (
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>{toast.msg}</span>
            </div>
          )}
          {assignment.description && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Instructions</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{assignment.description}</p>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">Your answer *</label>
            <textarea
              value={answer}
              onChange={e => setAnswer(e.target.value)}
              rows={7}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              placeholder="Type your answer here…"
            />
          </div>
        </div>

        <div className="flex gap-2 px-5 pb-4 pt-3 border-t border-slate-100">
          <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={submit.isPending || !answer.trim()}
            onClick={() => submit.mutate()}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
          >
            {submit.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StudentAssignmentsPage() {
  const navigate = useNavigate();
  const user = useAuthStore(s => s.session?.user);
  const qc = useQueryClient();
  const [open, setOpen] = useState(null);

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
    return (
      <button
        key={a.id}
        type="button"
        onClick={() => a.type !== 'MATERIAL' && st.key !== 'graded' ? setOpen(a) : null}
        className={cls(
          'w-full text-left bg-white border rounded-xl px-4 py-3 transition',
          st.key === 'graded' ? 'border-emerald-200' : 'border-slate-200 hover:border-indigo-300 hover:shadow-sm',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 truncate">{a.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {a.subjectId && <span className="uppercase text-[10px] tracking-wide text-slate-400 mr-1">{a.subjectId.replace(/^sub_?/, '').replace(/_/g, ' ')}</span>}
              {a.dueDate ? `Due ${a.dueDate}${a.dueTime ? ` ${a.dueTime}` : ''}` : 'No due date'}
              {a.maxPoints ? ` · ${a.maxPoints} pts` : ''}
            </p>
            {st.key === 'graded' && sub?.feedback && (
              <p className="text-xs text-slate-600 mt-1.5 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5">
                “{sub.feedback}”
              </p>
            )}
          </div>
          <span className={cls(
            'shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full',
            st.key === 'graded' ? 'bg-emerald-50 text-emerald-700'
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

      {open && (
        <SubmitModal
          assignment={open}
          onClose={() => setOpen(null)}
          onDone={() => qc.invalidateQueries({ queryKey: ['student', 'assignments'] })}
        />
      )}
    </div>
  );
}
