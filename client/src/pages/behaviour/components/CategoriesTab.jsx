/* ============================================================
   CategoriesTab — school-editable behaviour categories (admin only).
   Auto-seeded with 8 defaults on first load; each category's
   merit/demerit point values feed Award Points directly, so editing
   here changes what awarding produces immediately (no separate
   "publish" step).
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Tag, Plus, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { behaviour as behaviourApi } from '@/api/client.js';
import { EmptyMsg, ErrState, FField, iCls } from './BehaviourPrimitives.jsx';

const EMPTY_FORM = { name: '', meritPoints: '', demeritPoints: '', description: '' };

export default function CategoriesTab() {
  const qc                    = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState(EMPTY_FORM);
  const [errors, setErrors]   = useState({});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'categories'],
    queryFn:  () => behaviourApi.categories.list({ limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const rows = data?.data ?? [];

  const createMut = useMutation({
    mutationFn: d => behaviourApi.categories.create({
      name: d.name,
      description: d.description || undefined,
      meritPoints:   d.meritPoints   !== '' ? Number(d.meritPoints)   : undefined,
      demeritPoints: d.demeritPoints !== '' ? Number(d.demeritPoints) : undefined,
    }),
    onSuccess: () => {
      setShowAdd(false);
      setForm(EMPTY_FORM);
      qc.invalidateQueries({ queryKey: ['behaviour', 'categories'] });
    },
    onError: err => setErrors({ _server: err?.message ?? 'Failed to create' }),
  });

  const removeMut = useMutation({
    mutationFn: id => behaviourApi.categories.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['behaviour', 'categories'] }),
  });

  function submit(ev) {
    ev.preventDefault();
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (form.meritPoints === '' && form.demeritPoints === '') e.points = 'Set at least a merit or demerit point value';
    if (Object.keys(e).length) { setErrors(e); return; }
    createMut.mutate(form);
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{rows.length} categor{rows.length !== 1 ? 'ies' : 'y'}</p>
        <button
          onClick={() => setShowAdd(s => !s)}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={14} />Add Category
        </button>
      </div>

      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-800">New Category</h3>
              {errors._server && (
                <div className="flex items-center gap-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-lg border border-red-200">
                  <AlertTriangle size={13} />{errors._server}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <FField label="Name *" error={errors.name}>
                  <input
                    value={form.name}
                    onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setErrors({}); }}
                    placeholder="e.g. Punctuality"
                    className={iCls(errors.name)}
                  />
                </FField>
                <FField label="Description">
                  <input
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Optional"
                    className={iCls()}
                  />
                </FField>
                <FField label="Merit Points" error={errors.points}>
                  <input
                    type="number" min="0"
                    value={form.meritPoints}
                    onChange={e => { setForm(f => ({ ...f, meritPoints: e.target.value })); setErrors({}); }}
                    placeholder="Leave blank if not applicable"
                    className={iCls(errors.points)}
                  />
                </FField>
                <FField label="Demerit Points">
                  <input
                    type="number" min="0"
                    value={form.demeritPoints}
                    onChange={e => { setForm(f => ({ ...f, demeritPoints: e.target.value })); setErrors({}); }}
                    placeholder="Leave blank if not applicable"
                    className={iCls()}
                  />
                </FField>
              </div>
              <p className="text-[11px] text-slate-400 -mt-2">
                Set only Merit Points for a merit-only category (e.g. Leadership), only Demerit Points for a demerit-only one, or both.
              </p>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowAdd(false)} className="text-sm font-medium text-slate-600 px-4 py-2">Cancel</button>
                <button
                  type="submit"
                  disabled={createMut.isPending}
                  className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  {createMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  {createMut.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-20 animate-pulse" />)}
        </div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg
          icon={<Tag size={36} />}
          title="No categories"
          subtitle="Add a category to get started — categories are fully editable, including their point values."
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map(c => (
            <div key={c._id ?? c.id} className="group bg-white rounded-xl border border-slate-200 p-4 hover:shadow-sm hover:border-slate-300 transition-all">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-sm font-semibold text-slate-800">{c.name}</span>
                  {c.description && <p className="text-xs text-slate-500 mt-1">{c.description}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    {c.meritPoints != null && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">+{c.meritPoints}</span>
                    )}
                    {c.demeritPoints != null && (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">-{c.demeritPoints}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => { if (confirm(`Delete "${c.name}"?`)) removeMut.mutate(c.id ?? c._id); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                >
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
