/* ============================================================
   Admissions — Premium Kanban Pipeline
   Linear/Stripe aesthetic • React Query • framer-motion
   Backend: GET /api/admissions, POST /api/admissions,
            PUT /api/admissions/:id, PATCH /api/admissions/:id/stage
   ============================================================ */
import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserPlus, Search, SlidersHorizontal, ChevronRight,
  X, Loader2, AlertCircle, GraduationCap, Phone, Mail,
  Calendar, Flag, ArrowRight, CheckCircle2, MoreHorizontal,
  Users, TrendingUp, Clock, Star,
} from 'lucide-react';
import { admissions as admissionsApi } from '@/api/client.js';

/* ── Stage config ─────────────────────────────────────────── */
const PIPELINE = [
  { id: 'enquiry',     label: 'Enquiry',     color: 'bg-violet-500', light: 'bg-violet-50 text-violet-700 ring-violet-200', dot: 'bg-violet-400' },
  { id: 'application', label: 'Applied',     color: 'bg-blue-500',   light: 'bg-blue-50 text-blue-700 ring-blue-200',       dot: 'bg-blue-400'   },
  { id: 'assessment',  label: 'Assessment',  color: 'bg-amber-500',  light: 'bg-amber-50 text-amber-700 ring-amber-200',    dot: 'bg-amber-400'  },
  { id: 'interview',   label: 'Interview',   color: 'bg-orange-500', light: 'bg-orange-50 text-orange-700 ring-orange-200', dot: 'bg-orange-400' },
  { id: 'offer',       label: 'Offer',       color: 'bg-cyan-500',   light: 'bg-cyan-50 text-cyan-700 ring-cyan-200',       dot: 'bg-cyan-400'   },
  { id: 'acceptance',  label: 'Acceptance',  color: 'bg-teal-500',   light: 'bg-teal-50 text-teal-700 ring-teal-200',       dot: 'bg-teal-400'   },
  { id: 'enrolled',    label: 'Enrolled',    color: 'bg-emerald-500',light: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-400' },
];

const TERMINAL = [
  { id: 'withdrawn', label: 'Withdrawn', light: 'bg-slate-100 text-slate-500 ring-slate-200', dot: 'bg-slate-400' },
  { id: 'rejected',  label: 'Rejected',  light: 'bg-red-50 text-red-600 ring-red-200',         dot: 'bg-red-400'   },
];

const ALL_STAGES = [...PIPELINE, ...TERMINAL];

const PRIORITY_CONFIG = {
  high:   { label: 'High',   cls: 'bg-red-50 text-red-600 ring-1 ring-red-200'    },
  normal: { label: 'Normal', cls: 'bg-slate-100 text-slate-500'                   },
  low:    { label: 'Low',    cls: 'bg-slate-50 text-slate-400'                    },
};

function stageMeta(id) {
  return ALL_STAGES.find(s => s.id === id) ?? { label: id, light: 'bg-slate-100 text-slate-500 ring-slate-200', dot: 'bg-slate-300' };
}

/* ── Helpers ──────────────────────────────────────────────── */
function initials(first, last) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const AVATAR_COLORS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-pink-500 to-rose-600',
  'from-indigo-500 to-blue-600',
];
function avatarColor(name = '') {
  const code = name.charCodeAt(0) || 0;
  return AVATAR_COLORS[code % AVATAR_COLORS.length];
}

/* ── API helpers ──────────────────────────────────────────── */
async function fetchAllForStage(stage) {
  // Fetch up to 200 records per stage (pipeline is paginated)
  const res = await admissionsApi.list({ stage, limit: 200, page: 1 });
  return res?.data ?? [];
}

/* ══════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════ */
export default function AdmissionsPage() {
  const qc = useQueryClient();

  /* UI state */
  const [search, setSearch]             = useState('');
  const [viewMode, setViewMode]         = useState('kanban');   // 'kanban' | 'list'
  const [showAdd, setShowAdd]           = useState(false);
  const [stageModal, setStageModal]     = useState(null);       // { applicant }
  const [detailPanel, setDetailPanel]   = useState(null);       // applicant obj

  /* Stats */
  const { data: statsRes } = useQuery({
    queryKey: ['admissions', 'stats'],
    queryFn:  () => admissionsApi.stats(),
    staleTime: 60_000,
  });
  // stats response: { total, byStage: [{ stage, count, highPriority }] }
  const byStageArr   = statsRes?.data?.byStage ?? [];
  const statsByStage = Object.fromEntries(byStageArr.map(s => [s.stage, s]));

  /* Full kanban data — one query per active pipeline stage */
  const stageQueries = PIPELINE.map(col =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ['admissions', 'stage', col.id, search],
      queryFn:  () => admissionsApi.list({ stage: col.id, search: search || undefined, limit: 200, page: 1 }),
      staleTime: 30_000,
      select: r => r?.data ?? [],
    })
  );

  const kanbanCols = PIPELINE.map((col, i) => ({
    ...col,
    items: stageQueries[i].data ?? [],
    isLoading: stageQueries[i].isLoading,
  }));

  const totalApplications = statsRes?.data?.total ?? byStageArr.reduce((a, s) => a + (s.count ?? 0), 0);

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Page header ─────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-2xl mx-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Admissions Pipeline</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {totalApplications} total applicant{totalApplications !== 1 ? 's' : ''} across all stages
              </p>
            </div>
            <div className="flex items-center gap-2">
              {/* View toggle */}
              <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-slate-50">
                {[['kanban', 'Board'], ['list', 'List']].map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setViewMode(v)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <UserPlus size={15} />
                New Application
              </button>
            </div>
          </div>

          {/* Stats strip */}
          <div className="flex items-center gap-6 mt-5 pt-4 border-t border-slate-100 overflow-x-auto pb-1">
            <StatChip icon={<Users size={14} />}     label="Total"    value={totalApplications}                                        />
            <StatChip icon={<TrendingUp size={14} />} label="Enrolled" value={statsByStage['enrolled']?.count ?? 0} accent="emerald"   />
            <StatChip icon={<Clock size={14} />}      label="Pending"  value={(statsByStage['enquiry']?.count ?? 0) + (statsByStage['application']?.count ?? 0)} accent="blue" />
            <StatChip icon={<Star size={14} />}       label="High Pri" value={Object.values(statsByStage).reduce((a, s) => a + (s.highPriority ?? 0), 0)} accent="amber" />
          </div>
        </div>
      </div>

      {/* ── Search bar ──────────────────────────────────────── */}
      <div className="px-6 py-3 bg-white border-b border-slate-100">
        <div className="max-w-screen-2xl mx-auto flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search applicants…"
              className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────── */}
      <div className="max-w-screen-2xl mx-auto px-6 py-6">
        {viewMode === 'kanban'
          ? <KanbanBoard cols={kanbanCols} onCardClick={setDetailPanel} onStageClick={setStageModal} />
          : <ListView    cols={kanbanCols} onCardClick={setDetailPanel} onStageClick={setStageModal} />
        }
      </div>

      {/* ── Slide-over: Add Application ─────────────────────── */}
      <AnimatePresence>
        {showAdd && <AddSlideOver onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['admissions'] }); }} />}
      </AnimatePresence>

      {/* ── Modal: Change Stage ─────────────────────────────── */}
      <AnimatePresence>
        {stageModal && (
          <StageModal
            applicant={stageModal}
            onClose={() => setStageModal(null)}
            onChanged={() => { setStageModal(null); qc.invalidateQueries({ queryKey: ['admissions'] }); }}
          />
        )}
      </AnimatePresence>

      {/* ── Side panel: Applicant detail ────────────────────── */}
      <AnimatePresence>
        {detailPanel && (
          <DetailPanel
            applicant={detailPanel}
            onClose={() => setDetailPanel(null)}
            onStageChange={() => { setStageModal(detailPanel); setDetailPanel(null); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Stat chip ────────────────────────────────────────────── */
function StatChip({ icon, label, value, accent }) {
  const accents = { emerald: 'text-emerald-600', blue: 'text-blue-600', amber: 'text-amber-600' };
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className={`${accent ? accents[accent] : 'text-slate-500'}`}>{icon}</span>
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-sm font-semibold ${accent ? accents[accent] : 'text-slate-800'}`}>{value}</span>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   KANBAN BOARD
   ══════════════════════════════════════════════════════════ */
function KanbanBoard({ cols, onCardClick, onStageClick }) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-6" style={{ minHeight: 'calc(100vh - 260px)' }}>
      {cols.map(col => (
        <KanbanColumn key={col.id} col={col} onCardClick={onCardClick} onStageClick={onStageClick} />
      ))}
    </div>
  );
}

function KanbanColumn({ col, onCardClick, onStageClick }) {
  return (
    <div className="flex-shrink-0 w-72 flex flex-col">
      {/* Column header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${col.dot}`} />
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{col.label}</span>
          <span className="text-xs text-slate-400 font-medium bg-slate-100 rounded-full px-1.5 py-0.5">
            {col.isLoading ? '…' : col.items.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2.5">
        {col.isLoading
          ? [1, 2, 3].map(i => <CardSkeleton key={i} />)
          : col.items.length === 0
            ? <EmptyCol label={col.label} />
            : col.items.map(item => (
                <ApplicantCard
                  key={item.id ?? item._id}
                  applicant={item}
                  col={col}
                  onClick={() => onCardClick(item)}
                  onStageClick={() => onStageClick(item)}
                />
              ))
        }
      </div>
    </div>
  );
}

function ApplicantCard({ applicant, col, onClick, onStageClick }) {
  const a   = applicant;
  const pri = PRIORITY_CONFIG[a.priority] ?? PRIORITY_CONFIG.normal;
  const av  = avatarColor(`${a.firstName}${a.lastName}`);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.15 }}
      onClick={onClick}
      className="bg-white rounded-xl border border-slate-200/80 shadow-sm hover:shadow-md hover:border-slate-300 transition-all cursor-pointer group"
    >
      <div className="p-4">
        {/* Top row: avatar + name + priority */}
        <div className="flex items-start gap-3">
          <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${av} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
            {initials(a.firstName, a.lastName)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">
              {a.firstName} {a.lastName}
            </p>
            <p className="text-xs text-slate-400 truncate mt-0.5">
              {a.applyingForClass || a.applyingForYear || 'No class specified'}
            </p>
          </div>
          {a.priority === 'high' && (
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0 ${pri.cls}`}>
              HIGH
            </span>
          )}
        </div>

        {/* Meta */}
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Calendar size={10} />
            {formatDate(a.createdAt)}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onStageClick(); }}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] font-medium text-slate-500 hover:text-slate-800 flex items-center gap-0.5"
          >
            Move <ArrowRight size={10} />
          </button>
        </div>
      </div>

      {/* Bottom accent bar */}
      <div className={`h-0.5 ${col.color} rounded-b-xl opacity-60`} />
    </motion.div>
  );
}

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
      <div className="flex gap-3">
        <div className="w-9 h-9 rounded-full bg-slate-100" />
        <div className="flex-1 space-y-2">
          <div className="h-3 bg-slate-100 rounded w-3/4" />
          <div className="h-2.5 bg-slate-100 rounded w-1/2" />
        </div>
      </div>
    </div>
  );
}

function EmptyCol({ label }) {
  return (
    <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center">
      <p className="text-xs text-slate-400">No {label.toLowerCase()} applicants</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   LIST VIEW (fallback)
   ══════════════════════════════════════════════════════════ */
function ListView({ cols, onCardClick, onStageClick }) {
  const allItems = cols.flatMap(col => col.items.map(i => ({ ...i, _stageMeta: col })));
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 bg-slate-50">
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Applicant</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Grade</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Stage</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Priority</th>
            <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Applied</th>
            <th className="py-3 px-4" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {allItems.length === 0
            ? (
              <tr><td colSpan={6} className="py-16 text-center text-sm text-slate-400">No applications found</td></tr>
            )
            : allItems.map(a => {
                const sm  = a._stageMeta;
                const pri = PRIORITY_CONFIG[a.priority] ?? PRIORITY_CONFIG.normal;
                const av  = avatarColor(`${a.firstName}${a.lastName}`);
                return (
                  <tr
                    key={a.id ?? a._id}
                    onClick={() => onCardClick(a)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors group"
                  >
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${av} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                          {initials(a.firstName, a.lastName)}
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{a.firstName} {a.lastName}</p>
                          <p className="text-xs text-slate-400">{a.parentEmail || a.parentPhone || ''}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 hidden sm:table-cell">
                      <span className="text-slate-600 text-sm">{a.applyingForClass || a.applyingForYear || '—'}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ring-1 ${sm.light}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} />
                        {sm.label}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 hidden md:table-cell">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${pri.cls}`}>{pri.label}</span>
                    </td>
                    <td className="py-3.5 px-4 hidden lg:table-cell text-xs text-slate-400">
                      {formatDate(a.createdAt)}
                    </td>
                    <td className="py-3.5 px-4">
                      <button
                        onClick={e => { e.stopPropagation(); onStageClick(a); }}
                        className="opacity-0 group-hover:opacity-100 text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1 transition"
                      >
                        Move <ChevronRight size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })
          }
        </tbody>
      </table>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   ADD SLIDE-OVER
   ══════════════════════════════════════════════════════════ */
const EMPTY_FORM = {
  firstName: '', lastName: '', middleName: '', dateOfBirth: '',
  gender: '', applyingForClass: '', applyingForYear: '',
  parentName: '', parentEmail: '', parentPhone: '',
  priority: 'normal', notes: '', stage: 'enquiry',
};

function AddSlideOver({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});

  const mutation = useMutation({
    mutationFn: data => admissionsApi.create(data),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create application' }),
  });

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => { const n = { ...e }; delete n[field]; return n; });
  }

  function validate() {
    const e = {};
    if (!form.firstName.trim())  e.firstName  = 'Required';
    if (!form.lastName.trim())   e.lastName   = 'Required';
    if (!form.parentName.trim()) e.parentName = 'Required';
    if (!form.parentPhone.trim() && !form.parentEmail.trim()) e.parentPhone = 'Phone or email required';
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
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      {/* Panel */}
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">New Application</h2>
            <p className="text-xs text-slate-400 mt-0.5">Add a new applicant to the pipeline</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertCircle size={15} className="shrink-0" />
              {errors._server}
            </div>
          )}

          {/* Applicant */}
          <Section label="Applicant Details">
            <div className="grid grid-cols-2 gap-4">
              <Field label="First Name *" error={errors.firstName}>
                <input value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="First name" className={inputCls(errors.firstName)} />
              </Field>
              <Field label="Last Name *" error={errors.lastName}>
                <input value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Last name" className={inputCls(errors.lastName)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Date of Birth">
                <input type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} className={inputCls()} />
              </Field>
              <Field label="Gender">
                <select value={form.gender} onChange={e => set('gender', e.target.value)} className={inputCls()}>
                  <option value="">Select…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Applying for Class">
                <input value={form.applyingForClass} onChange={e => set('applyingForClass', e.target.value)} placeholder="e.g. Year 7" className={inputCls()} />
              </Field>
              <Field label="Academic Year">
                <input value={form.applyingForYear} onChange={e => set('applyingForYear', e.target.value)} placeholder="e.g. 2025/26" className={inputCls()} />
              </Field>
            </div>
          </Section>

          {/* Parent/Guardian */}
          <Section label="Parent / Guardian">
            <Field label="Full Name *" error={errors.parentName}>
              <input value={form.parentName} onChange={e => set('parentName', e.target.value)} placeholder="Parent or guardian name" className={inputCls(errors.parentName)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone" error={errors.parentPhone}>
                <input value={form.parentPhone} onChange={e => set('parentPhone', e.target.value)} placeholder="+254 …" className={inputCls(errors.parentPhone)} />
              </Field>
              <Field label="Email">
                <input type="email" value={form.parentEmail} onChange={e => set('parentEmail', e.target.value)} placeholder="parent@email.com" className={inputCls()} />
              </Field>
            </div>
          </Section>

          {/* Pipeline */}
          <Section label="Pipeline">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Initial Stage">
                <select value={form.stage} onChange={e => set('stage', e.target.value)} className={inputCls()}>
                  {PIPELINE.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select value={form.priority} onChange={e => set('priority', e.target.value)} className={inputCls()}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </Field>
            </div>
            <Field label="Notes">
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Any additional notes…" className={`${inputCls()} resize-none`} />
            </Field>
          </Section>
        </form>

        {/* Footer */}
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
            {mutation.isPending ? 'Saving…' : 'Add Application'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ── Form field helpers ───────────────────────────────────── */
function Section({ label, children }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-700">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

function inputCls(error) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${error ? 'border-red-300 focus:ring-red-500/20' : 'border-slate-200 focus:ring-slate-900/10'} bg-white focus:outline-none focus:ring-2 focus:border-slate-400 text-slate-800 placeholder-slate-400 transition`;
}

/* ══════════════════════════════════════════════════════════
   STAGE MODAL
   ══════════════════════════════════════════════════════════ */
function StageModal({ applicant, onClose, onChanged }) {
  const a = applicant;
  const [selectedStage, setSelectedStage] = useState(a.stage);
  const [notes, setNotes]                 = useState('');

  const mutation = useMutation({
    mutationFn: ({ id, stage, notes }) => admissionsApi.changeStage(id, { stage, notes, date: new Date().toISOString().slice(0, 10) }),
    onSuccess:  onChanged,
  });

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1,    y: 0    }}
        exit={{   opacity: 0, scale: 0.96, y: 10  }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="px-6 pt-6 pb-4 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Move Applicant</h3>
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
                <X size={16} />
              </button>
            </div>
            <p className="text-sm text-slate-500 mt-1">{a.firstName} {a.lastName}</p>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Stage selector */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">Select stage</p>
              <div className="grid grid-cols-2 gap-2">
                {[...PIPELINE, ...TERMINAL].map(s => {
                  const isCurrent  = s.id === a.stage;
                  const isSelected = s.id === selectedStage;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedStage(s.id)}
                      disabled={isCurrent}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium border transition-all text-left ${
                        isSelected && !isCurrent
                          ? 'border-slate-800 bg-slate-900 text-white shadow-sm'
                          : isCurrent
                            ? 'border-slate-100 bg-slate-50 text-slate-400 cursor-default'
                            : 'border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${s.dot} shrink-0`} />
                      <span>{s.label}</span>
                      {isCurrent && <span className="ml-auto text-[10px] text-slate-400">current</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">Note (optional)</p>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                placeholder="Reason for stage change…"
                className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 resize-none placeholder-slate-400"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 pb-6">
            <button onClick={onClose} className="text-sm font-medium text-slate-500 hover:text-slate-700 px-4 py-2">
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate({ id: a.id ?? a._id, stage: selectedStage, notes })}
              disabled={mutation.isPending || selectedStage === a.stage}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {mutation.isPending && <Loader2 size={13} className="animate-spin" />}
              Confirm Move
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   DETAIL PANEL
   ══════════════════════════════════════════════════════════ */
function DetailPanel({ applicant, onClose, onStageChange }) {
  const a  = applicant;
  const sm = stageMeta(a.stage);
  const av = avatarColor(`${a.firstName}${a.lastName}`);
  const pri = PRIORITY_CONFIG[a.priority] ?? PRIORITY_CONFIG.normal;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/25 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 32, stiffness: 320 }}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${av} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                {initials(a.firstName, a.lastName)}
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">{a.firstName} {a.middleName ? a.middleName + ' ' : ''}{a.lastName}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ring-1 ${sm.light}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} />
                    {sm.label}
                  </span>
                  {a.priority !== 'normal' && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${pri.cls}`}>{pri.label}</span>
                  )}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* Move stage CTA */}
          <div className="px-6 py-4 border-b border-slate-100">
            <button
              onClick={onStageChange}
              className="w-full flex items-center justify-between bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
            >
              <span className="flex items-center gap-2">
                <ArrowRight size={14} />
                Move to next stage
              </span>
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="px-6 py-5 space-y-6">
            {/* Academic */}
            <DetailSection icon={<GraduationCap size={14} />} label="Academic">
              <DetailRow label="Applying for" value={a.applyingForClass || '—'} />
              <DetailRow label="Academic year"  value={a.applyingForYear  || '—'} />
              <DetailRow label="Date of birth"  value={formatDate(a.dateOfBirth)} />
              <DetailRow label="Gender"         value={a.gender           || '—'} />
              {a.sibling && <DetailRow label="Sibling" value="Yes — has sibling at school" />}
              {a.specialNeeds && <DetailRow label="Special needs" value={a.specialNeeds} />}
            </DetailSection>

            {/* Parent */}
            <DetailSection icon={<Users size={14} />} label="Parent / Guardian">
              <DetailRow label="Name"  value={a.parentName  || '—'} />
              <DetailRow label="Phone" value={a.parentPhone || '—'} icon={<Phone size={11} className="text-slate-400 shrink-0" />} />
              <DetailRow label="Email" value={a.parentEmail || '—'} icon={<Mail  size={11} className="text-slate-400 shrink-0" />} />
            </DetailSection>

            {/* Timeline */}
            <DetailSection icon={<Calendar size={14} />} label="Timeline">
              <DetailRow label="Applied"     value={formatDate(a.createdAt)} />
              <DetailRow label="Last updated" value={formatDate(a.updatedAt)} />
            </DetailSection>

            {/* Notes */}
            {a.notes && (
              <DetailSection icon={<Flag size={14} />} label="Notes">
                <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
                  {a.notes}
                </p>
              </DetailSection>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}

function DetailSection({ icon, label, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-slate-400">{icon}</span>
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, icon }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-xs text-slate-400 shrink-0 w-28">{label}</span>
      <span className="text-xs font-medium text-slate-700 text-right flex items-center gap-1">
        {icon}{value}
      </span>
    </div>
  );
}
