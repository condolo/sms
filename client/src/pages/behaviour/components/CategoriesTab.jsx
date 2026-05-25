/* ============================================================
   CategoriesTab — custom behaviour categories CRUD (admin only)
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Tag, Plus, X, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { behaviour as behaviourApi } from '@/api/client.js';
import { TypeBadge, EmptyMsg, ErrState, FField, iCls } from './BehaviourPrimitives.jsx';

const EMPTY_FORM = { name: '', type: 'demerit', defaultPoints: '', description: '' };

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
      ...d,
      defaultPoints: d.defaultPoints ? Number(d.defaultPoints) : undefined,
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
    if (Object.keys(e).length) { setErrors(e); return; }
    createMut.mutate(form);
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{rows.length} custom categor{rows.length !== 1 ? 'ies' : 'y'}</p>
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
                <FField label="Type">
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={iCls()}>
                    <option value="merit">Merit</option>
                    <option value="demerit">Demerit</option>
                    <option value="both">Both</option>
                  </select>
                </FField>
                <FField label="Default Points">
                  <input
                    type="number"
                    value={form.defaultPoints}
                    onChange={e => setForm(f => ({ ...f, defaultPoints: e.target.value }))}
                    placeholder="-5"
                    className={iCls()}
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
              </div>
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
          title="No custom categories"
          subtitle="Built-in BPS matrix categories are always available. Add custom ones here."
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map(c => (
            <div key={c._id ?? c.id} className="group bg-white rounded-xl border border-slate-200 p-4 hover:shadow-sm hover:border-slate-300 transition-all">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{c.name}</span>
                    <TypeBadge type={c.type} />
                  </div>
                  {c.description && <p className="text-xs text-slate-500 mt-1">{c.description}</p>}
                  {c.defaultPoints != null && (
                    <p className={`text-xs font-bold mt-2 ${Number(c.defaultPoints) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {Number(c.defaultPoints) > 0 ? '+' : ''}{c.defaultPoints} pts default
                    </p>
                  )}
                </div>
                <button
                  onClick={() => { if (confirm(`Delete "${c.name}"?`)) removeMut.mutate(c._id ?? c.id); }}
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
