/* ============================================================
   Behaviour — Premium 3-Tab: Incidents · Appeals · Categories
   /platform-audit: Added Add Incident slide-over, Categories CRUD,
   replaced emoji icons, wired all existing behaviour API methods
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Scale, Send, Tag, Plus, X, Loader2, CheckCircle2,
  AlertTriangle, TrendingUp, TrendingDown, Search,
  ChevronLeft, ChevronRight, Star, ShieldAlert, MoreHorizontal,
  Check, XCircle,
} from 'lucide-react';
import { behaviour as behaviourApi, students as studentsApi } from '@/api/client.js';

const LIMIT = 20;

/* ══════════════════════════════════════════════════════════════ */
export default function BehaviourPage() {
  const [tab, setTab] = useState('incidents');

  const TABS = [
    { id: 'incidents', label: 'Incidents',  icon: Scale    },
    { id: 'appeals',   label: 'Appeals',    icon: Send     },
    { id: 'categories',label: 'Categories', icon: Tag      },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-xl mx-auto">
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Behaviour</h1>
          <p className="text-sm text-slate-500 mt-0.5">Track incidents, merits, appeals and categories</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-screen-xl mx-auto flex gap-0">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors ${
                  active
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-5">
        <AnimatePresence mode="wait">
          {tab === 'incidents'  && <IncidentsTab  key="incidents"  />}
          {tab === 'appeals'    && <AppealsTab    key="appeals"    />}
          {tab === 'categories' && <CategoriesTab key="categories" />}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Incidents Tab ─────────────────────────────────────────── */
function IncidentsTab() {
  const qc = useQueryClient();
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [typeFilter, setType] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'incidents', { page, search, typeFilter }],
    queryFn:  () => behaviourApi.incidents.list({ page, limit: LIMIT, search: search || undefined, type: typeFilter || undefined }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};
  const totalPages = pagination.pages  ?? 1;
  const total      = pagination.total  ?? rows.length;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search incidents…"
            className="w-full text-sm pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400"
          />
        </div>
        <select
          value={typeFilter}
          onChange={e => { setType(e.target.value); setPage(1); }}
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700"
        >
          <option value="">All types</option>
          <option value="merit">Merit</option>
          <option value="demerit">Demerit</option>
        </select>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors ml-auto"
        >
          <Plus size={14} />
          Add Incident
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-14 animate-pulse" />)}
        </div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg icon={<Scale size={36} />} title="No incidents recorded" subtitle="Add an incident to get started" />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Category</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Description</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Points</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r._id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.studentName ?? r.studentId}</td>
                  <td className="px-4 py-3">
                    <TypeBadge type={r.type} />
                  </td>
                  <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{r.category ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell max-w-[200px]">
                    <span className="truncate block">{r.description ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-semibold ${(r.points ?? 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {(r.points ?? 0) > 0 ? `+${r.points}` : r.points}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">
                    {r.date ? new Date(r.date).toLocaleDateString('en-GB') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationBar page={page} totalPages={totalPages} total={total} limit={LIMIT} onPage={setPage} />
        </div>
      )}

      <AnimatePresence>
        {showAdd && (
          <AddIncidentSlideOver
            onClose={() => setShowAdd(false)}
            onCreated={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['behaviour', 'incidents'] }); }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Appeals Tab ─────────────────────────────────────────────── */
function AppealsTab() {
  const qc                      = useQueryClient();
  const [page, setPage]         = useState(1);
  const [resolving, setResolving] = useState(null); // { id, outcome: 'resolved'|'rejected' }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'appeals', { page }],
    queryFn:  () => behaviourApi.appeals.list({ page, limit: LIMIT }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};
  const totalPages = pagination.pages  ?? 1;
  const total      = pagination.total  ?? rows.length;

  const { mutate: resolve, isPending: resolving_ } = useMutation({
    mutationFn: ({ id, outcome }) => behaviourApi.appeals.resolve(id, { outcome }),
    onSuccess:  () => { setResolving(null); qc.invalidateQueries({ queryKey: ['behaviour', 'appeals'] }); },
  });

  const statusCfg = {
    pending:  { label: 'Pending',  cls: 'bg-amber-50  text-amber-700  border-amber-200'  },
    resolved: { label: 'Resolved', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    rejected: { label: 'Rejected', cls: 'bg-red-50    text-red-700    border-red-200'    },
  };

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-24 animate-pulse" />)}
        </div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg icon={<Send size={36} />} title="No appeals found" subtitle="Appeals from students will appear here" />
      ) : (
        <>
          <div className="space-y-3">
            {rows.map(a => {
              const cfg = statusCfg[a.status] ?? statusCfg.pending;
              return (
                <div key={a._id} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800">{a.studentName ?? a.studentId}</p>
                      <p className="text-sm text-slate-500 mt-1 line-clamp-2">{a.reason ?? '—'}</p>
                      {a.createdAt && (
                        <p className="text-xs text-slate-400 mt-2">{new Date(a.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.cls}`}>{cfg.label}</span>
                      {a.status === 'pending' && (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => resolve({ id: a._id, outcome: 'resolved' })}
                            className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg hover:bg-emerald-100 transition"
                          >
                            <Check size={11} />Resolve
                          </button>
                          <button
                            onClick={() => resolve({ id: a._id, outcome: 'rejected' })}
                            className="flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg hover:bg-red-100 transition"
                          >
                            <XCircle size={11} />Reject
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <PaginationBar page={page} totalPages={totalPages} total={total} limit={LIMIT} onPage={setPage} />
        </>
      )}
    </motion.div>
  );
}

/* ── Categories Tab ─────────────────────────────────────────── */
function CategoriesTab() {
  const qc             = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'demerit', defaultPoints: '', description: '' });
  const [errors, setErrors] = useState({});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'categories'],
    queryFn:  () => behaviourApi.categories.list({ limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const rows = data?.data ?? [];

  const createMut = useMutation({
    mutationFn: d => behaviourApi.categories.create({ ...d, defaultPoints: d.defaultPoints ? Number(d.defaultPoints) : undefined }),
    onSuccess:  () => { setShowAdd(false); setForm({ name: '', type: 'demerit', defaultPoints: '', description: '' }); qc.invalidateQueries({ queryKey: ['behaviour', 'categories'] }); },
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create category' }),
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
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{rows.length} categor{rows.length !== 1 ? 'ies' : 'y'}</p>
        <button
          onClick={() => setShowAdd(s => !s)}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={14} />
          Add Category
        </button>
      </div>

      {/* Inline add form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-800">New Category</h3>
              {errors._server && (
                <div className="flex items-center gap-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-lg border border-red-200">
                  <AlertTriangle size={13} />{errors._server}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <FField label="Name *" error={errors.name}>
                  <input value={form.name} onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setErrors({}); }} placeholder="e.g. Bullying, Punctuality" className={iCls(errors.name)} />
                </FField>
                <FField label="Type">
                  <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={iCls()}>
                    <option value="merit">Merit</option>
                    <option value="demerit">Demerit</option>
                    <option value="both">Both</option>
                  </select>
                </FField>
                <FField label="Default Points">
                  <input type="number" value={form.defaultPoints} onChange={e => setForm(f => ({ ...f, defaultPoints: e.target.value }))} placeholder="e.g. -5" className={iCls()} />
                </FField>
                <FField label="Description">
                  <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional description" className={iCls()} />
                </FField>
              </div>
              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => setShowAdd(false)} className="text-sm font-medium text-slate-600 px-4 py-2">Cancel</button>
                <button type="submit" disabled={createMut.isPending} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  {createMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  {createMut.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* List */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-24 animate-pulse" />)}
        </div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg icon={<Tag size={36} />} title="No categories yet" subtitle="Create categories to classify incidents" />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map(c => (
            <div key={c._id ?? c.id} className="group bg-white rounded-xl border border-slate-200 p-4 hover:shadow-sm hover:border-slate-300 transition-all relative">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{c.name}</span>
                    <TypeBadge type={c.type} />
                  </div>
                  {c.description && <p className="text-xs text-slate-500 mt-1">{c.description}</p>}
                  {c.defaultPoints != null && (
                    <p className={`text-xs font-semibold mt-2 ${Number(c.defaultPoints) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {Number(c.defaultPoints) > 0 ? '+' : ''}{c.defaultPoints} pts default
                    </p>
                  )}
                </div>
                <button
                  onClick={() => { if (confirm(`Delete category "${c.name}"?`)) removeMut.mutate(c._id ?? c.id); }}
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

/* ── Add Incident Slide-Over ────────────────────────────────── */
const EMPTY_INCIDENT = { studentId: '', studentName: '', type: 'demerit', category: '', severity: 'medium', points: '', description: '', date: new Date().toISOString().slice(0, 10) };

function AddIncidentSlideOver({ onClose, onCreated }) {
  const [form, setForm]     = useState(EMPTY_INCIDENT);
  const [errors, setErrors] = useState({});
  const [stuSearch, setStuSearch] = useState('');

  /* Student search */
  const { data: stuData } = useQuery({
    queryKey: ['students', 'search', stuSearch],
    queryFn:  () => studentsApi.list({ search: stuSearch, limit: 10, status: 'active' }),
    enabled:  stuSearch.length >= 2,
    staleTime: 30_000,
  });
  const stuResults = stuData?.data ?? [];

  /* Categories */
  const { data: catData } = useQuery({
    queryKey: ['behaviour', 'categories'],
    queryFn:  () => behaviourApi.categories.list({ limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const categories = (catData?.data ?? []).filter(c => !form.type || c.type === 'both' || c.type === form.type);

  const mutation = useMutation({
    mutationFn: d => behaviourApi.incidents.create({ ...d, points: d.points ? Number(d.points) : undefined }),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to record incident' }),
  });

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => { const n = { ...e }; delete n[field]; return n; });
  }

  function validate() {
    const e = {};
    if (!form.studentId) e.studentId = 'Select a student';
    if (!form.type)      e.type      = 'Type is required';
    return e;
  }

  function submit(ev) {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    mutation.mutate(form);
  }

  const SEVERITIES = ['low', 'medium', 'high', 'critical'];
  const sevColor   = { low: 'text-blue-600 bg-blue-50 border-blue-200', medium: 'text-amber-600 bg-amber-50 border-amber-200', high: 'text-orange-600 bg-orange-50 border-orange-200', critical: 'text-red-600 bg-red-50 border-red-200' };

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
            <h2 className="text-base font-semibold text-slate-900">Record Incident</h2>
            <p className="text-xs text-slate-400 mt-0.5">Merit or demerit event</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={15} className="shrink-0" />{errors._server}
            </div>
          )}

          {/* Student search */}
          <FField label="Student *" error={errors.studentId}>
            {form.studentId ? (
              <div className="flex items-center gap-2 p-2.5 rounded-lg border border-slate-200 bg-slate-50">
                <span className="text-sm font-medium text-slate-800 flex-1">{form.studentName}</span>
                <button type="button" onClick={() => { set('studentId', ''); set('studentName', ''); setStuSearch(''); }} className="text-slate-400 hover:text-red-500 transition"><X size={14} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={stuSearch}
                  onChange={e => setStuSearch(e.target.value)}
                  placeholder="Search student name…"
                  className={`${iCls(errors.studentId)} pl-8`}
                />
                {stuResults.length > 0 && stuSearch.length >= 2 && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto">
                    {stuResults.map(s => (
                      <button
                        key={s._id ?? s.id}
                        type="button"
                        onClick={() => { set('studentId', s._id ?? s.id); set('studentName', `${s.firstName} ${s.lastName}`); setStuSearch(''); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition"
                      >
                        <span className="font-medium text-slate-800">{s.firstName} {s.lastName}</span>
                        {s.className && <span className="text-slate-400 ml-1.5 text-xs">· {s.className}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </FField>

          {/* Type */}
          <div className="grid grid-cols-2 gap-3">
            {['merit', 'demerit'].map(t => (
              <button
                key={t}
                type="button"
                onClick={() => { set('type', t); set('points', t === 'merit' ? '' : ''); }}
                className={`flex items-center gap-2 p-3 rounded-lg border-2 transition-all text-sm font-medium capitalize ${
                  form.type === t
                    ? t === 'merit'
                      ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                      : 'border-red-400 bg-red-50 text-red-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                {t === 'merit' ? <Star size={14} /> : <ShieldAlert size={14} />}
                {t}
              </button>
            ))}
          </div>

          {/* Severity */}
          <FField label="Severity">
            <div className="flex gap-2 flex-wrap">
              {SEVERITIES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set('severity', s)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium capitalize transition-all ${
                    form.severity === s ? sevColor[s] + ' ring-2 ring-offset-1' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  } ${form.severity === s ? '' : ''}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </FField>

          <div className="grid grid-cols-2 gap-4">
            <FField label="Category">
              <select value={form.category} onChange={e => set('category', e.target.value)} className={iCls()}>
                <option value="">None</option>
                {categories.map(c => (
                  <option key={c._id ?? c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </FField>
            <FField label="Points">
              <input
                type="number"
                value={form.points}
                onChange={e => set('points', e.target.value)}
                placeholder={form.type === 'merit' ? '+5' : '-5'}
                className={iCls()}
              />
            </FField>
          </div>

          <FField label="Date">
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} max={new Date().toISOString().slice(0, 10)} className={iCls()} />
          </FField>

          <FField label="Description">
            <textarea
              value={form.description}
              onChange={e => set('description', e.target.value)}
              rows={3}
              placeholder="Describe what happened…"
              className={`${iCls()} resize-none`}
            />
          </FField>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Saving…' : 'Record Incident'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ── Shared helpers ─────────────────────────────────────────── */
function TypeBadge({ type }) {
  if (type === 'merit') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
      <TrendingUp size={10} />Merit
    </span>
  );
  if (type === 'demerit') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
      <TrendingDown size={10} />Demerit
    </span>
  );
  return <span className="text-xs text-slate-400">{type}</span>;
}

function PaginationBar({ page, totalPages, total, limit, onPage }) {
  const start = (page - 1) * limit + 1;
  const end   = Math.min(page * limit, total);
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
      <p className="text-xs text-slate-500">{total > 0 ? `${start}–${end} of ${total}` : '0 results'}</p>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronLeft size={14} /></button>
        <span className="text-xs text-slate-500 px-2">{page} / {totalPages}</span>
        <button onClick={() => onPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

function EmptyMsg({ icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-slate-400">
      <div className="mb-3 opacity-40">{icon}</div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle && <p className="text-xs mt-1">{subtitle}</p>}
    </div>
  );
}

function ErrState({ msg, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <AlertTriangle size={24} className="text-red-400" />
      <p className="text-sm text-slate-500">{msg ?? 'Failed to load'}</p>
      {onRetry && <button onClick={onRetry} className="text-xs font-medium text-slate-700 underline">Retry</button>}
    </div>
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
