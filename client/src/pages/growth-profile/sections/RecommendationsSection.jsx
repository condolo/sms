/* ============================================================
   RecommendationsSection — Staff writes, students/parents read.
   Confidential recommendations are hidden from students/parents.
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, X, Save, Loader2, Lock, MessageSquare } from 'lucide-react';
import { growthProfile as gpApi, teachers as teachersApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-100 rounded ${className}`} />;
}

function iCls() {
  return 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 placeholder-slate-400 transition';
}

const TYPE_LABELS = { academic: 'Academic', character: 'Character', leadership: 'Leadership', general: 'General' };

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function RecommendationCard({ rec, canDelete, onDelete, isDeleting }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-slate-50/50 transition" onClick={() => setExpanded(e => !e)}>
        <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
          <MessageSquare size={13} className="text-violet-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-800">{rec.authorName ?? 'Staff Member'}</p>
            {rec.authorRole && <span className="text-[10px] text-slate-400">{rec.authorRole}</span>}
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700`}>
              {TYPE_LABELS[rec.type] ?? rec.type}
            </span>
            {rec.isConfidential && (
              <span className="flex items-center gap-0.5 text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                <Lock size={9} /> Confidential
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{fmtDate(rec.createdAt)}</p>
          {!expanded && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{rec.content}</p>
          )}
        </div>
        {canDelete && (
          <button onClick={e => { e.stopPropagation(); onDelete(rec); }} disabled={isDeleting} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition shrink-0" title="Delete">
            {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </button>
        )}
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
            <div className="px-4 pb-4 pt-1 border-t border-slate-100">
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{rec.content}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function WriteForm({ studentId, onClose }) {
  const [form, setForm] = useState({ type: 'general', content: '', authorRole: '', isConfidential: false });
  const [error, setError] = useState(null);
  const user = useAuthStore(s => s.session?.user);
  const qc   = useQueryClient();

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => gpApi.recommendations.create({ ...data, studentId, authorName: user?.name ?? '', authorId: user?.id ?? '' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['growth-recommendations', studentId] }); qc.invalidateQueries({ queryKey: ['growth-profile', studentId] }); onClose(); },
    onError: (e) => setError(e.message ?? 'Failed to save'),
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="bg-slate-50 border border-slate-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-slate-800">Write Recommendation</h4>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-200 transition"><X size={14} /></button>
      </div>
      {error && <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{error}</div>}
      <form onSubmit={e => { e.preventDefault(); setError(null); mutate(form); }} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
            <select className={iCls()} value={form.type} onChange={e => set('type', e.target.value)}>
              {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Your role / title</label>
            <input className={iCls()} value={form.authorRole} onChange={e => set('authorRole', e.target.value)} placeholder="e.g. Class Teacher, HOD" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Recommendation *</label>
          <textarea rows={5} className={`${iCls()} resize-none`} value={form.content} onChange={e => set('content', e.target.value)} placeholder="Write your recommendation here…" required minLength={10} />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={form.isConfidential} onChange={e => set('isConfidential', e.target.checked)} className="rounded" />
          Mark as confidential (hidden from student and parents)
        </label>
        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={isPending} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {isPending ? 'Saving…' : 'Submit recommendation'}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
        </div>
      </form>
    </motion.div>
  );
}

export default function RecommendationsSection({ studentId, canEdit, isAdmin }) {
  const [showForm, setShowForm]   = useState(false);
  const [deleting, setDeleting]   = useState(null);
  const qc     = useQueryClient();
  const user   = useAuthStore(s => s.session?.user);
  const role   = user?.role ?? '';
  const userId = user?.id ?? '';

  const canWrite = ['admin', 'superadmin', 'teacher', 'section_head', 'deputy_principal'].includes(role);

  const { data, isLoading } = useQuery({
    queryKey: ['growth-recommendations', studentId],
    queryFn:  () => gpApi.recommendations.list({ studentId, limit: 100 }),
    enabled:  !!studentId,
    staleTime: 2 * 60_000,
  });
  const recs = data?.data ?? [];

  const { mutate: deleteRec, isPending: isDeleting } = useMutation({
    mutationFn: (id) => gpApi.recommendations.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['growth-recommendations', studentId] }); qc.invalidateQueries({ queryKey: ['growth-profile', studentId] }); setDeleting(null); },
  });

  if (isLoading) return <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-20 rounded-xl" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">{recs.length} recommendation{recs.length !== 1 ? 's' : ''}</p>
        {canWrite && !showForm && (
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 transition">
            <Plus size={13} /> Write recommendation
          </button>
        )}
      </div>

      <AnimatePresence>
        {showForm && <WriteForm studentId={studentId} onClose={() => setShowForm(false)} />}
      </AnimatePresence>

      {recs.length === 0 ? (
        <div className="py-12 text-center">
          <MessageSquare size={24} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm font-medium text-slate-600">No recommendations yet</p>
          <p className="text-xs text-slate-400 mt-1">Staff can write academic, character, or leadership recommendations.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recs.map(r => (
            <RecommendationCard
              key={r.id ?? r._id}
              rec={r}
              canDelete={isAdmin || r.authorId === userId || r.createdBy === userId}
              onDelete={(rec) => deleteRec(rec.id)}
              isDeleting={isDeleting && deleting === r.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
