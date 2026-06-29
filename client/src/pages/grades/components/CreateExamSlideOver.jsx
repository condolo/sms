/* ============================================================
   CreateExamSlideOver — slide-over form to create a new exam
   Props: onClose fn, onCreated fn
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { classes as classesApi, exams as examsApi } from '@/api/client.js';
import { iCls, FField } from './GradesPrimitives.jsx';

const EMPTY_EXAM = {
  title: '', subject: '', classId: '', date: '',
  maxScore: '100', term: '', status: 'scheduled', description: '',
};

export default function CreateExamSlideOver({ onClose, onCreated }) {
  const [form, setForm]     = useState(EMPTY_EXAM);
  const [errors, setErrors] = useState({});

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60_000,
  });
  const classList = classesData?.data ?? [];

  const mutation = useMutation({
    mutationFn: d => examsApi.create({ ...d, maxScore: d.maxScore ? Number(d.maxScore) : undefined }),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create exam' }),
  });

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => { const n = { ...e }; delete n[field]; return n; });
  }

  function validate() {
    const e = {};
    if (!form.title.trim())   e.title   = 'Title is required';
    if (!form.subject.trim()) e.subject = 'Subject is required';
    return e;
  }

  function submit(ev) {
    ev?.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    mutation.mutate(form);
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Create Exam</h2>
            <p className="text-xs text-slate-400 mt-0.5">Schedule a new exam or test</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={15} className="shrink-0" />{errors._server}
            </div>
          )}
          <FField label="Exam Title *" error={errors.title}>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="e.g. End of Term Mathematics" className={iCls(errors.title)} />
          </FField>
          <div className="grid grid-cols-2 gap-4">
            <FField label="Subject *" error={errors.subject}>
              <input value={form.subject} onChange={e => set('subject', e.target.value)}
                placeholder="e.g. Mathematics" className={iCls(errors.subject)} />
            </FField>
            <FField label="Term / Period">
              <input value={form.term} onChange={e => set('term', e.target.value)}
                placeholder="e.g. Term 1" className={iCls()} />
            </FField>
          </div>
          <FField label="Class">
            <select value={form.classId} onChange={e => set('classId', e.target.value)} className={iCls()}>
              <option value="">No class (all)</option>
              {classList.map(c => <option key={c._id ?? c.id} value={c._id ?? c.id}>{c.name}</option>)}
            </select>
          </FField>
          <div className="grid grid-cols-2 gap-4">
            <FField label="Date">
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={iCls()} />
            </FField>
            <FField label="Max Score">
              <input type="number" min="1" value={form.maxScore}
                onChange={e => set('maxScore', e.target.value)} placeholder="100" className={iCls()} />
            </FField>
          </div>
          <FField label="Status">
            <select value={form.status} onChange={e => set('status', e.target.value)} className={iCls()}>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="active">Active</option>
              <option value="in_progress">In Progress</option>
            </select>
          </FField>
          <FField label="Description">
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={2} placeholder="Optional notes…" className={`${iCls()} resize-none`} />
          </FField>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
          <button onClick={submit} disabled={mutation.isPending}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition">
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Creating…' : 'Create Exam'}
          </button>
        </div>
      </motion.div>
    </>
  );
}
