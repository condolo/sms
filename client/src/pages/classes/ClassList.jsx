/* ============================================================
   Classes — Year Groups Grid
   Each class = a year group (Year 7, Year 8, etc.)
   Click a card → ClassDetail where you manage streams.
   ============================================================ */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Users, Plus, X, Loader2,
  CheckCircle2, AlertTriangle, Trash2, Layers, ChevronRight,
  Upload, Download, Pencil,
} from 'lucide-react';
import { classes as classesApi, importExport } from '@/api/client.js';
import BulkImportSlideOver from '@/components/import/BulkImportSlideOver.jsx';
import useAuthStore from '@/store/auth.js';
import { useSections } from '@/hooks/useSections.js';

const CLASS_COLORS = [
  'from-violet-500 to-purple-600','from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500', 'from-amber-500 to-orange-500',
  'from-pink-500 to-rose-500',    'from-indigo-500 to-blue-600',
  'from-teal-500 to-cyan-500',    'from-orange-500 to-red-500',
];
function classColor(name='') { return CLASS_COLORS[(name.charCodeAt(0)||0) % CLASS_COLORS.length]; }

/* ══════════════════════════════════════════════════════════ */
export default function ClassList() {
  const qc      = useQueryClient();
  const navigate = useNavigate();
  const can     = useAuthStore(s => s.can.bind(s));
  const role    = useAuthStore(s => s.session?.user?.role ?? '');
  const canCreate = can('classes') || role === 'admin' || role === 'superadmin';
  const canDelete = can('classes') || role === 'admin' || role === 'superadmin';

  const { sectionMap, sectionTabs } = useSections();
  const [showAdd,       setShowAdd]       = useState(false);
  const [showImport,    setShowImport]    = useState(false);
  const [exporting,     setExporting]     = useState(false);
  const [sectionFilter, setSectionFilter] = useState('all');
  const [deleteTarget,  setDeleteTarget]  = useState(null);
  const [editTarget,    setEditTarget]    = useState(null);

  async function handleExport() {
    setExporting(true);
    try { await importExport.exportCSV('classes'); }
    catch (e) { alert(e?.message ?? 'Export failed'); }
    finally { setExporting(false); }
  }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['classes', 'list'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const rows = data?.data ?? [];

  const filtered = sectionFilter === 'all'
    ? rows
    : rows.filter(c => c.sectionKey === sectionFilter);

  const sortedClasses = [...filtered].sort((a, b) => {
    const ao = a.order ?? 9999;
    const bo = b.order ?? 9999;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  const { mutate: remove, isPending: removing } = useMutation({
    mutationFn: id => classesApi.remove(id),
    onSuccess:  () => { setDeleteTarget(null); qc.invalidateQueries({ queryKey: ['classes'] }); },
    onError:    err => alert(err?.message ?? 'Failed to delete class'),
  });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-2xl mx-auto flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Classes</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {isLoading ? 'Loading…' : `${rows.length} class${rows.length !== 1 ? 'es' : ''}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:border-slate-400 hover:text-slate-800 transition-colors"
            >
              <Upload size={14} /> Import
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:border-slate-400 hover:text-slate-800 disabled:opacity-50 transition-colors"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Export
            </button>
            {canCreate && (
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <Plus size={15} /> Add Class
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-5">

        {/* Section filter tabs */}
        {!isLoading && !isError && (
          <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-1">
            {sectionTabs.map(({ id, label, color }) => {
              const count    = id === 'all' ? rows.length : rows.filter(r => r.sectionKey === id).length;
              const isActive = sectionFilter === id;
              const isEmpty  = id !== 'all' && count === 0;
              return (
                <button
                  key={id}
                  onClick={() => setSectionFilter(id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${
                    isActive ? 'text-white' : isEmpty ? 'text-slate-400 hover:bg-slate-100' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                  style={isActive ? { backgroundColor: id === 'all' ? '#0f172a' : color } : {}}
                >
                  {label}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-white/25 text-white' : isEmpty ? 'bg-slate-100 text-slate-400' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
                <div className="w-10 h-10 rounded-xl bg-slate-100 mb-4" />
                <div className="h-4 bg-slate-100 rounded w-28 mb-2" />
                <div className="h-3 bg-slate-100 rounded w-16" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <AlertTriangle size={24} className="text-red-400" />
            <p className="text-sm text-slate-500">{error?.message ?? 'Failed to load classes'}</p>
            <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400">
            <BookOpen size={36} className="mb-3 opacity-40" />
            <p className="text-sm font-medium text-slate-600">No classes yet</p>
            <p className="text-xs mt-1">Create your first class to get started</p>
            {canCreate && (
              <button onClick={() => setShowAdd(true)} className="mt-4 flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-800 transition">
                <Plus size={14} /> Add first class
              </button>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <BookOpen size={28} className="mb-2 opacity-40" />
            <p className="text-sm font-medium text-slate-600">No classes in this section</p>
            <button onClick={() => setSectionFilter('all')} className="mt-2 text-xs text-violet-600 hover:text-violet-800 transition">
              Show all sections
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {sortedClasses.map(c => {
                    const id  = c.id ?? c._id;
                    const col = classColor(c.name);
                    const sec = c.sectionKey ? sectionMap[c.sectionKey] : null;
                    return (
                      <motion.div
                        key={id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white rounded-xl border border-slate-200 hover:shadow-md hover:border-slate-300 transition-all group relative overflow-hidden cursor-pointer"
                        onClick={() => navigate(`/classes/${id}`)}
                      >
                        <div className={`h-1 bg-gradient-to-r ${col}`} />

                        <div className="p-5">
                          <div className="flex items-start justify-between gap-2">
                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${col} flex items-center justify-center shrink-0`}>
                              <BookOpen size={16} className="text-white" />
                            </div>
                            {canDelete && (
                              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                                <button
                                  onClick={e => { e.stopPropagation(); setEditTarget(c); }}
                                  className="p-1.5 text-slate-400 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition"
                                  title="Edit class"
                                >
                                  <Pencil size={13} />
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); setDeleteTarget(c); }}
                                  className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                                  title="Delete class"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="mt-3">
                            <div className="flex items-center gap-2">
                              <h3 className="font-semibold text-slate-900">{c.name}</h3>
                              {c.order != null && (
                                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                                  #{c.order}
                                </span>
                              )}
                            </div>
                            {c.description && (
                              <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{c.description}</p>
                            )}
                            {sec && (
                              <span className="inline-flex mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded border"
                                style={{ backgroundColor: sec.color + '18', color: sec.color, borderColor: sec.color + '50' }}>
                                {sec.name}
                              </span>
                            )}
                          </div>

                          <div className="mt-4 space-y-1.5">
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <Layers size={12} className="shrink-0" />
                              <span>{c.streamCount ?? 0} stream{(c.streamCount ?? 0) !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <Users size={12} className="shrink-0" />
                              <span>{(c.studentCount ?? 0).toLocaleString()} student{(c.studentCount ?? 0) !== 1 ? 's' : ''}</span>
                            </div>
                          </div>

                          <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                            <span className="text-xs font-medium text-violet-600 group-hover:text-violet-800 transition flex items-center gap-1">
                              Manage streams
                              <ChevronRight size={11} />
                            </span>
                          </div>
                        </div>
                      </motion.div>
            );
          })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showAdd && (
          <AddClassSlideOver
            onClose={() => setShowAdd(false)}
            onCreated={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['classes'] }); }}
          />
        )}
        {showImport && (
          <BulkImportSlideOver
            type="classes"
            label="Classes"
            showExport
            onClose={() => setShowImport(false)}
            onImported={() => qc.invalidateQueries({ queryKey: ['classes'] })}
          />
        )}
        {editTarget && (
          <EditClassSlideOver
            cls={editTarget}
            onClose={() => setEditTarget(null)}
            onSaved={() => { setEditTarget(null); qc.invalidateQueries({ queryKey: ['classes'] }); }}
          />
        )}
        {deleteTarget && (
          <DeleteClassModal
            cls={deleteTarget}
            onClose={() => setDeleteTarget(null)}
            onConfirm={() => remove(deleteTarget.id ?? deleteTarget._id)}
            isLoading={removing}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Delete Confirm Modal ─────────────────────────────────── */
function DeleteClassModal({ cls, onClose, onConfirm, isLoading }) {
  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity:0, scale:0.95 }} animate={{ opacity:1, scale:1 }} exit={{ opacity:0, scale:0.95 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center shrink-0">
              <Trash2 size={18} className="text-red-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Delete Class</h3>
              <p className="text-xs text-slate-500 mt-0.5">This cannot be undone</p>
            </div>
          </div>
          <p className="text-sm text-slate-600 mb-5">
            Delete <span className="font-medium text-slate-900">"{cls.name}"</span>?
            You must remove all streams first.
          </p>
          <div className="flex items-center gap-3 justify-end">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isLoading}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {isLoading ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              Delete
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

/* ── Add Class Slide-Over ─────────────────────────────────── */
const EMPTY_CLASS = { name:'', sectionKey:'', description:'', status:'active', order:'' };

function AddClassSlideOver({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_CLASS);
  const [errors, setErrors] = useState({});

  const { sectionTabs } = useSections();

  const mutation = useMutation({
    mutationFn: data => classesApi.create(data),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create class' }),
  });

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => { const n={...e}; delete n[field]; return n; });
  }

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Class name is required';
    return e;
  }

  function submit(ev) {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    const payload = { ...form };
    if (payload.order === '' || payload.order === null) delete payload.order;
    else payload.order = Number(payload.order);
    mutation.mutate(payload);
  }

  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }}
        transition={{ type:'spring', damping:30, stiffness:300 }}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">New Class</h2>
            <p className="text-xs text-slate-400 mt-0.5">Year group — add streams after creating</p>
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

          <FField label="Class Name *" error={errors.name}>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Year 7, Grade 3, Form 4" className={iCls(errors.name)} />
          </FField>

          <FField label="Section">
            <select value={form.sectionKey} onChange={e => set('sectionKey', e.target.value)} className={iCls()}>
              <option value="">Select section…</option>
              {sectionTabs.filter(s => s.id !== 'all').map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </FField>

          <FField label="Promotion Order" error={errors.order}>
            <input
              type="number" min="1" max="999"
              value={form.order}
              onChange={e => set('order', e.target.value)}
              placeholder="e.g. 1 = first year, 4 = final year"
              className={iCls(errors.order)}
            />
            <p className="text-[11px] text-slate-400 mt-1">Used for year-end promotion — lower number moves up first. Leave blank if not applicable.</p>
          </FField>

          <FField label="Status">
            <select value={form.status} onChange={e => set('status', e.target.value)} className={iCls()}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FField>

          <FField label="Description">
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={3} placeholder="Optional notes…" className={`${iCls()} resize-none`} />
          </FField>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Creating…' : 'Create Class'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

function FField({ label, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-700">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
function iCls(error) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${error ? 'border-red-300' : 'border-slate-200 focus:border-slate-400'} bg-white focus:outline-none focus:ring-2 ${error ? 'focus:ring-red-500/20' : 'focus:ring-slate-900/10'} text-slate-800 placeholder-slate-400 transition`;
}

/* ── Edit Class Slide-Over ────────────────────────────────── */
function EditClassSlideOver({ cls, onClose, onSaved }) {
  const [form, setForm] = useState({
    name:        cls.name        ?? '',
    sectionKey:  cls.sectionKey  ?? '',
    description: cls.description ?? '',
    status:      cls.status      ?? 'active',
    order:       cls.order != null ? String(cls.order) : '',
  });
  const [errors, setErrors] = useState({});

  const { sectionTabs } = useSections();

  const mutation = useMutation({
    mutationFn: data => classesApi.update(cls.id ?? cls._id, data),
    onSuccess:  onSaved,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to update class' }),
  });

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => { const n={...e}; delete n[field]; return n; });
  }

  function validate() {
    const e = {};
    if (!form.name.trim()) e.name = 'Class name is required';
    return e;
  }

  function submit(ev) {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    const payload = { ...form };
    if (payload.order === '' || payload.order === null) delete payload.order;
    else payload.order = Number(payload.order);
    mutation.mutate(payload);
  }

  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }}
        transition={{ type:'spring', damping:30, stiffness:300 }}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Edit Class</h2>
            <p className="text-xs text-slate-400 mt-0.5">Updating <span className="font-medium text-slate-600">{cls.name}</span></p>
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

          <FField label="Class Name *" error={errors.name}>
            <input value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Year 7, Grade 3, Form 4" className={iCls(errors.name)} />
          </FField>

          <FField label="Section">
            <select value={form.sectionKey} onChange={e => set('sectionKey', e.target.value)} className={iCls()}>
              <option value="">No section</option>
              {sectionTabs.filter(s => s.id !== 'all').map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </FField>

          <FField label="Promotion Order" error={errors.order}>
            <input
              type="number" min="1" max="999"
              value={form.order}
              onChange={e => set('order', e.target.value)}
              placeholder="e.g. 1 = first year, 4 = final year"
              className={iCls(errors.order)}
            />
            <p className="text-[11px] text-slate-400 mt-1">Used for year-end promotion — lower number moves up first.</p>
          </FField>

          <FField label="Status">
            <select value={form.status} onChange={e => set('status', e.target.value)} className={iCls()}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FField>

          <FField label="Description">
            <textarea value={form.description} onChange={e => set('description', e.target.value)}
              rows={3} placeholder="Optional notes…" className={`${iCls()} resize-none`} />
          </FField>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </motion.div>
    </>
  );
}
