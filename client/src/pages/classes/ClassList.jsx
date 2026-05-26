/* ============================================================
   Classes — Premium Card Grid with Add Slide-Over
   /platform-audit: RBAC-gated, lucide icons, correct API shape
   ============================================================ */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Users, UserCheck, Plus, X, Loader2,
  CheckCircle2, AlertTriangle, Trash2, Hash, Home, Upload, Download,
} from 'lucide-react';
import { classes as classesApi, teachers as teachersApi, importExport } from '@/api/client.js';
import BulkImportSlideOver from '@/components/import/BulkImportSlideOver.jsx';
import useAuthStore from '@/store/auth.js';
import { useSections } from '@/hooks/useSections.js';

const CLASS_COLORS = [
  'from-violet-500 to-purple-600','from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500', 'from-amber-500 to-orange-500',
  'from-pink-500 to-rose-500',    'from-indigo-500 to-blue-500',
  'from-teal-500 to-cyan-500',    'from-orange-500 to-red-500',
];
function classColor(name='') { return CLASS_COLORS[(name.charCodeAt(0)||0) % CLASS_COLORS.length]; }

/* Section colours and labels are now driven by useSections() — see component */

/* ══════════════════════════════════════════════════════════ */
export default function ClassList() {
  const qc      = useQueryClient();
  const can     = useAuthStore(s => s.can.bind(s));
  const role    = useAuthStore(s => s.session?.user?.role ?? '');
  const canCreate = can('classes') || role === 'admin' || role === 'superadmin';
  const canDelete = can('classes') || role === 'admin' || role === 'superadmin';

  /* Dynamic sections — replaces hardcoded SECTION_LABELS / SECTION_BADGE */
  const { sectionMap, sectionTabs } = useSections();
  const [showAdd,       setShowAdd]       = useState(false);
  const [showImport,    setShowImport]    = useState(false);
  const [exporting,     setExporting]     = useState(false);
  const [sectionFilter, setSectionFilter] = useState('all');

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

  // Client-side section filter + year/level grouping (streams share the same `year`)
  const filtered = sectionFilter === 'all'
    ? rows
    : rows.filter(c => c.sectionKey === sectionFilter);

  const grouped = {};
  for (const c of [...filtered].sort((a, b) => a.name.localeCompare(b.name))) {
    const key = c.year?.trim() || '__';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c);
  }
  const yearGroups = Object.entries(grouped).sort(([a], [b]) => {
    if (a === '__') return 1; if (b === '__') return -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  const { mutate: remove } = useMutation({
    mutationFn: id => classesApi.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['classes'] }),
  });

  function confirmRemove(c) {
    if (!confirm(`Delete class "${c.name}"? This cannot be undone.`)) return;
    remove(c._id ?? c.id);
  }

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
              title="Import classes from CSV"
            >
              <Upload size={14} />
              Import
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:border-slate-400 hover:text-slate-800 disabled:opacity-50 transition-colors"
              title="Export classes to CSV"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Export
            </button>
            {canCreate && (
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <Plus size={15} />
                Add Class
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-5">

        {/* Section filter tabs — all configured sections always shown (even if count=0)
            This matches timetable behaviour: section appears as soon as admin creates it
            so classes can be assigned to it. Dependency chain: Settings → Classes → Timetable */}
        {!isLoading && !isError && (
          <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-1">
            {sectionTabs.map(({ id, label, color }) => {
              const count = id === 'all' ? rows.length : rows.filter(r => r.sectionKey === id).length;
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
                  title={isEmpty ? `No classes in ${label} yet` : undefined}
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
          /* ── Grouped by Year / Level — each year group may hold multiple streams ── */
          <div className="space-y-6">
            {yearGroups.map(([year, classes]) => (
              <div key={year}>
                {/* Year / Level header with stream count badge */}
                {year !== '__' && (
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-sm font-semibold text-slate-700">{year}</span>
                    {classes.length > 1 && (
                      <span className="inline-flex items-center text-[11px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        {classes.length} streams
                      </span>
                    )}
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>
                )}
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {classes.map(c => {
                    const id  = c._id ?? c.id;
                    const col = classColor(c.name);
                    const cap = Number(c.capacity) || 0;
                    const cnt = Number(c.studentCount) || 0;
                    const fillPct   = cap > 0 ? Math.min(Math.round((cnt / cap) * 100), 100) : 0;
                    const fillColor = fillPct >= 100 ? 'bg-red-500' : fillPct >= 80 ? 'bg-amber-400' : 'bg-emerald-500';
                    return (
                      <motion.div
                        key={id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-white rounded-xl border border-slate-200 hover:shadow-md hover:border-slate-300 transition-all group relative overflow-hidden"
                      >
                        {/* Top colour bar */}
                        <div className={`h-1 bg-gradient-to-r ${col}`} />

                        <div className="p-5">
                          <div className="flex items-start justify-between gap-2">
                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${col} flex items-center justify-center shrink-0`}>
                              <BookOpen size={16} className="text-white" />
                            </div>
                            {canDelete && (
                              <button
                                onClick={() => confirmRemove(c)}
                                className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>

                          <div className="mt-3">
                            <h3 className="font-semibold text-slate-900">{c.name}</h3>
                            {/* Only show year in the card if the class has no year group header */}
                            {c.year && year === '__' && (
                              <p className="text-xs text-slate-400 mt-0.5">{c.year}</p>
                            )}
                            {c.sectionKey && (() => {
                              const sec = sectionMap[c.sectionKey];
                              const col = sec?.color ?? '#6366f1';
                              return (
                                <span className="inline-flex mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded border"
                                  style={{ backgroundColor: col + '18', color: col, borderColor: col + '50' }}>
                                  {sec?.name ?? c.sectionKey}
                                </span>
                              );
                            })()}
                          </div>

                          <div className="mt-4 space-y-1.5">
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <Users size={12} className="shrink-0" />
                              <span>{cnt.toLocaleString()} student{cnt !== 1 ? 's' : ''}</span>
                              {cap > 0 && (
                                <span className={`ml-auto text-[10px] font-semibold ${fillPct >= 100 ? 'text-red-500' : fillPct >= 80 ? 'text-amber-500' : 'text-emerald-600'}`}>
                                  {fillPct}%
                                </span>
                              )}
                            </div>
                            {cap > 0 && (
                              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                <div className={`h-1.5 rounded-full transition-all ${fillColor}`} style={{ width: `${fillPct}%` }} />
                              </div>
                            )}
                            {c.teacherName && (
                              <div className="flex items-center gap-2 text-xs text-slate-500">
                                <UserCheck size={12} className="shrink-0" />
                                <span className="truncate">{c.teacherName}</span>
                              </div>
                            )}
                            {c.room && (
                              <div className="flex items-center gap-2 text-xs text-slate-500">
                                <Home size={12} className="shrink-0" />
                                <span>{c.room}</span>
                              </div>
                            )}
                            {cap > 0 && (
                              <div className="flex items-center gap-2 text-xs text-slate-500">
                                <Hash size={12} className="shrink-0" />
                                <span>Capacity: {cap}</span>
                              </div>
                            )}
                          </div>

                          <div className="mt-4 pt-3 border-t border-slate-100">
                            <Link
                              to={`/students?classId=${id}`}
                              className="text-xs font-medium text-violet-600 hover:text-violet-800 transition flex items-center gap-1"
                            >
                              <Users size={11} />
                              View students
                            </Link>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))}
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
      </AnimatePresence>
    </div>
  );
}

/* ── Add Class Slide-Over ─────────────────────────────────── */
const EMPTY_CLASS = { name:'', sectionKey:'', year:'', room:'', capacity:'', teacherId:'', description:'', status:'active' };

function AddClassSlideOver({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_CLASS);
  const [errors, setErrors] = useState({});

  // Sections — React Query returns cached data, no extra network request
  const { sectionTabs } = useSections();

  // Load teachers for assignment dropdown
  const { data: teachersData } = useQuery({
    queryKey: ['teachers', { page: 1, search: '' }],
    queryFn:  () => teachersApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const teacherList = teachersData?.data ?? [];

  const mutation = useMutation({
    mutationFn: data => classesApi.create({ ...data, capacity: data.capacity ? Number(data.capacity) : undefined }),
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
    mutation.mutate(form);
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
            <p className="text-xs text-slate-400 mt-0.5">Add a class or form group</p>
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

          <FField2 label="Class Name *" error={errors.name}>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Year 7A, Grade 3, Form 4" className={iCls2(errors.name)} />
          </FField2>

          {/* Section + Year / Level — related fields side-by-side */}
          <div className="grid grid-cols-2 gap-4">
            <FField2 label="Section">
              <select value={form.sectionKey} onChange={e => set('sectionKey', e.target.value)} className={iCls2()}>
                <option value="">Select section…</option>
                {/* Dynamic — populated from school's configured sections */}
                {sectionTabs.filter(s => s.id !== 'all').map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </FField2>
            <FField2 label="Year / Level">
              <input value={form.year} onChange={e => set('year', e.target.value)} placeholder="e.g. Year 7, Form 1" className={iCls2()} />
            </FField2>
          </div>

          {/* Room + Capacity */}
          <div className="grid grid-cols-2 gap-4">
            <FField2 label="Room">
              <input value={form.room} onChange={e => set('room', e.target.value)} placeholder="e.g. Room 12" className={iCls2()} />
            </FField2>
            <FField2 label="Capacity">
              <input type="number" min="1" max="200" value={form.capacity} onChange={e => set('capacity', e.target.value)} placeholder="Max students" className={iCls2()} />
            </FField2>
          </div>

          <FField2 label="Status">
            <select value={form.status} onChange={e => set('status', e.target.value)} className={iCls2()}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </FField2>

          <FField2 label="Form Tutor / Class Teacher">
            <select value={form.teacherId} onChange={e => set('teacherId', e.target.value)} className={iCls2()}>
              <option value="">No teacher assigned</option>
              {teacherList.map(t => (
                <option key={t._id ?? t.id} value={t._id ?? t.id}>
                  {t.title ? `${t.title} ` : ''}{t.firstName} {t.lastName}
                </option>
              ))}
            </select>
          </FField2>
          <FField2 label="Description">
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} placeholder="Optional notes about this class…" className={`${iCls2()} resize-none`} />
          </FField2>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">Cancel</button>
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

function FField2({ label, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-700">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
function iCls2(error) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${error ? 'border-red-300' : 'border-slate-200 focus:border-slate-400'} bg-white focus:outline-none focus:ring-2 ${error ? 'focus:ring-red-500/20' : 'focus:ring-slate-900/10'} text-slate-800 placeholder-slate-400 transition`;
}
