/* ============================================================
   Resources — shared-links repository (Governance Spec §5)
   New module: title/description/url/category, multi-dimensional
   visibility (whole school, specific roles, a specific class,
   individual people, or a custom group).
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Link2, Plus, ExternalLink, Trash2, Edit2, X, Save, Clock, Users2 } from 'lucide-react';
import { resources as resourcesApi, classes as classesApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { useToast } from '@/hooks/useToast.jsx';

const ROLE_OPTIONS = [
  { value: 'teacher', label: 'Teachers' },
  { value: 'parent',  label: 'Parents' },
  { value: 'student', label: 'Students' },
  { value: 'hr',      label: 'HR' },
  { value: 'finance', label: 'Finance' },
];

const FULL_ACCESS_ROLES = new Set(['admin', 'superadmin', 'principal', 'deputy_principal']);

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function ResourceForm({ classes, record, onClose, onSave, saving }) {
  const isEdit = !!record;
  const [form, setForm] = useState({
    title:       record?.title ?? '',
    description: record?.description ?? '',
    url:         record?.url ?? '',
    category:    record?.category ?? '',
    expiresAt:   record?.expiresAt ?? '',
    scope:       record?.visibility?.scope ?? 'all',
    roles:       record?.visibility?.roles ?? [],
    classIds:    record?.visibility?.classIds ?? [],
  });
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function toggleRole(r) { setForm(f => ({ ...f, roles: f.roles.includes(r) ? f.roles.filter(x => x !== r) : [...f.roles, r] })); }
  function toggleClass(id) { setForm(f => ({ ...f, classIds: f.classIds.includes(id) ? f.classIds.filter(x => x !== id) : [...f.classIds, id] })); }

  const fCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40';

  function handleSubmit(e) {
    e.preventDefault();
    onSave({
      title: form.title, description: form.description, url: form.url,
      category: form.category || undefined, expiresAt: form.expiresAt || null,
      visibility: {
        scope: form.scope,
        roles: form.scope === 'targeted' ? form.roles : [],
        classIds: form.scope === 'targeted' ? form.classIds : [],
        sectionKeys: [], userIds: [], groupId: null,
      },
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">{isEdit ? 'Edit Resource' : 'Share a Resource'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Title *</label>
            <input required value={form.title} onChange={e => set('title', e.target.value)} className={fCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Link *</label>
            <input required type="url" value={form.url} onChange={e => set('url', e.target.value)} placeholder="https://…" className={fCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
            <textarea rows={2} value={form.description} onChange={e => set('description', e.target.value)} className={`${fCls} resize-none`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Category</label>
              <input value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Forms" className={fCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Expires (optional)</label>
              <input type="date" value={form.expiresAt?.slice(0, 10) ?? ''} onChange={e => set('expiresAt', e.target.value)} className={fCls} />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            <label className="block text-xs font-semibold text-slate-600 mb-2">Who can see this?</label>
            <div className="flex gap-2 mb-3">
              <button type="button" onClick={() => set('scope', 'all')}
                className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${form.scope === 'all' ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-600'}`}>
                Whole School
              </button>
              <button type="button" onClick={() => set('scope', 'targeted')}
                className={`flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold ${form.scope === 'targeted' ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-600'}`}>
                Specific Audience
              </button>
            </div>

            {form.scope === 'targeted' && (
              <div className="space-y-3">
                <div>
                  <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Roles</p>
                  <div className="flex flex-wrap gap-1.5">
                    {ROLE_OPTIONS.map(r => (
                      <button key={r.value} type="button" onClick={() => toggleRole(r.value)}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border ${form.roles.includes(r.value) ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500'}`}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>
                {classes.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Classes</p>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                      {classes.map(c => (
                        <button key={c.id} type="button" onClick={() => toggleClass(c.id)}
                          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border ${form.classIds.includes(c.id) ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500'}`}>
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Saving…</> : <><Save size={13} /> {isEdit ? 'Save Changes' : 'Share'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ResourcesPage() {
  const qc   = useQueryClient();
  const user = useAuthStore(s => s.session?.user);
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(null); // null | { mode:'add' } | { mode:'edit', record }

  const { data: resourcesData, isLoading } = useQuery({
    queryKey: ['resources'],
    queryFn:  () => resourcesApi.list({}),
  });
  const items = resourcesData?.data ?? [];

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn:  () => classesApi.list({ limit: 200 }),
  });
  const classesList = classesData?.data ?? classesData?.classes ?? [];

  const saveResource = useMutation({
    mutationFn: (data) => showForm?.mode === 'edit' ? resourcesApi.update(showForm.record.id, data) : resourcesApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources'] });
      setShowForm(null);
      toast.success('Resource saved.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to save resource.'),
  });

  const removeResource = useMutation({
    mutationFn: (id) => resourcesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources'] });
      toast.success('Resource removed.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to remove resource.'),
  });

  function canManage(r) {
    return FULL_ACCESS_ROLES.has(user?.role) || r.creatorId === user?.id;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Resources</h1>
          <p className="text-slate-500 text-sm mt-0.5">Shared links visible to the whole school or a targeted audience.</p>
        </div>
        <button onClick={() => setShowForm({ mode: 'add' })}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700">
          <Plus size={14} /> Share a Resource
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-slate-400 text-sm">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-center py-16">
          <Link2 size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-slate-500 text-sm">No resources shared yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((r, i) => (
            <motion.div key={r.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
              className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col">
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <p className="font-semibold text-slate-900 text-sm leading-snug">{r.title}</p>
                {canManage(r) && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => setShowForm({ mode: 'edit', record: r })} className="text-slate-400 hover:text-violet-600 p-0.5"><Edit2 size={13} /></button>
                    <button onClick={() => removeResource.mutate(r.id)} className="text-slate-400 hover:text-red-600 p-0.5"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
              {r.description && <p className="text-xs text-slate-500 mb-2 line-clamp-2">{r.description}</p>}
              <div className="flex items-center gap-2 flex-wrap mt-auto pt-2">
                {r.category && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{r.category}</span>}
                {r.visibility?.scope === 'all'
                  ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 flex items-center gap-0.5"><Users2 size={9} /> Whole School</span>
                  : <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 flex items-center gap-0.5"><Users2 size={9} /> Targeted</span>}
                {r.expiresAt && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 flex items-center gap-0.5"><Clock size={9} /> {fmtDate(r.expiresAt)}</span>}
              </div>
              <a href={r.url} target="_blank" rel="noopener noreferrer"
                className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition">
                Open Link <ExternalLink size={12} />
              </a>
            </motion.div>
          ))}
        </div>
      )}

      {showForm && (
        <ResourceForm
          classes={classesList}
          record={showForm.mode === 'edit' ? showForm.record : null}
          saving={saveResource.isPending}
          onClose={() => setShowForm(null)}
          onSave={data => saveResource.mutate(data)}
        />
      )}
    </div>
  );
}
