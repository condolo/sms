/* ============================================================
   Students — Premium List with Stats, Charts & Add Slide-Over
   /platform-audit: RBAC-gated, correct API shapes, no raw emojis
   ============================================================ */
import { useState, useRef, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Search, X, Filter,
  GraduationCap, Users, AlertTriangle, Eye, Trash2,
  Loader2, CheckCircle2, Phone, Mail, Download,
  ShieldAlert, UserMinus, KeyRound, ArrowUpCircle, ChevronsRight,
} from 'lucide-react';
import {
  students as studentsApi, classes as classesApi, streams as streamsApi, importExport,
  academicConfig as academicConfigApi, settings as settingsApi,
} from '@/api/client.js';
import { useSections } from '@/hooks/useSections.js';
import { Pagination } from '@/components/ui/Pagination.jsx';
import useAuthStore from '@/store/auth.js';
import { useToast } from '@/hooks/useToast.jsx';
import { useCurrentAcademicPeriod } from '@/hooks/useCurrentAcademicPeriod.js';

const LIMIT = 25;

const STATUS_OPTIONS = [
  { value: '',            label: 'Active (default)' },  // backend excludes withdrawn/graduated/transferred
  { value: 'active',      label: 'Active'            },
  { value: 'inactive',    label: 'Inactive'          },
  { value: 'withdrawn',   label: 'Withdrawn'         },
  { value: 'transferred', label: 'Transferred'       },
  { value: 'graduated',   label: 'Graduated'         },
  { value: 'all',         label: 'All students'      },
];
const GENDER_OPTIONS = [
  { value: '',                  label: 'All genders' },
  { value: 'male',              label: 'Male'         },
  { value: 'female',            label: 'Female'       },
  { value: 'other',             label: 'Other'        },
  { value: 'prefer_not_to_say', label: 'Not stated'   },
];

const STATUS_BADGE = {
  active:      'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  inactive:    'bg-slate-100  text-slate-500',
  suspended:   'bg-amber-50   text-amber-700  ring-1 ring-amber-200',
  graduated:   'bg-indigo-50  text-indigo-700 ring-1 ring-indigo-200',
  transferred: 'bg-blue-50    text-blue-700   ring-1 ring-blue-200',
};

const GENDER_COLORS = { male: '#8b5cf6', female: '#ec4899', other: '#6b7280', prefer_not_to_say: '#94a3b8' };
const STATUS_COLORS = { active: '#10b981', inactive: '#94a3b8', suspended: '#f59e0b', graduated: '#6366f1', transferred: '#3b82f6' };

const AVATAR_COLORS = [
  'from-violet-500 to-purple-600','from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-600',
  'from-pink-500 to-rose-600',    'from-indigo-500 to-blue-600',
];
function avatarColor(name = '') { return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length]; }
function initials(f = '', l = '') { return `${f[0] ?? ''}${l[0] ?? ''}`.toUpperCase(); }

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl">
      <p className="font-medium">{payload[0].name}</p>
      <p className="text-slate-300 mt-0.5">{payload[0].value?.toLocaleString()}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════ */
export default function StudentList() {
  const qc      = useQueryClient();
  const { toast } = useToast();
  const can     = useAuthStore(s => s.can.bind(s));
  const role    = useAuthStore(s => s.session?.user?.role ?? '');

  const canDelete     = role === 'admin' || role === 'superadmin';
  const canHardDelete = role === 'admin' || role === 'superadmin';

  /* Houses — for resolving a student's houseId to a display name in the table */
  const { data: settingsData } = useQuery({
    queryKey: ['settings', 'school'],
    queryFn:  () => settingsApi.school.get(),
    staleTime: 5 * 60_000,
  });
  const houses = Array.isArray(settingsData?.data?.houses) ? settingsData.data.houses : [];
  const houseName = id => houses.find(h => (h.id ?? h.name) === id)?.name ?? null;

  /* Read ?classId= from URL so "View students" on class cards pre-filters the list */
  const [searchParams] = useSearchParams();

  /* Filters — classId / streamId seeded from URL params if present */
  const [search,         setSearch]         = useState('');
  const [debSearch,      setDebSearch]      = useState('');
  const [classId,        setClassId]        = useState(() => searchParams.get('classId') ?? '');
  const [streamId,       setStreamId]       = useState(() => searchParams.get('streamId') ?? '');
  const [sectionKey,     setSectionKey]     = useState('');
  const [enrollmentYear, setEnrollmentYear] = useState('');
  const [gender,         setGender]         = useState('');
  const [status,         setStatus]         = useState('active');
  const [page,           setPage]           = useState(1);
  /* Auto-open filter panel when arriving via a class/stream link */
  const [showFilter, setShowFilter] = useState(() => !!(searchParams.get('classId') || searchParams.get('streamId')));

  const [selectedIds,        setSelectedIds]        = useState(() => new Set());
  const [showPurge,          setShowPurge]          = useState(false);
  const [bulkDeactivating,   setBulkDeactivating]   = useState(false);
  const [bulkPortalResult,   setBulkPortalResult]   = useState(null); // { created, skipped, errors }
  const [bulkPortalLoading,  setBulkPortalLoading]  = useState(false);
  // null = closed | student object = single deactivate | 'bulk' = bulk deactivate
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [showPromote, setShowPromote] = useState(false);

  /* React to URL param changes */
  useEffect(() => {
    const cid = searchParams.get('classId') ?? '';
    const sid = searchParams.get('streamId') ?? '';
    setClassId(cid);
    setStreamId(sid);
    if (cid || sid) { setShowFilter(true); setPage(1); }
  }, [searchParams.get('classId'), searchParams.get('streamId')]); // eslint-disable-line react-hooks/exhaustive-deps

  const timer = useRef(null);
  function onSearch(v) {
    setSearch(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setDebSearch(v); setPage(1); }, 350);
  }

  const { sectionTabs } = useSections();

  // Enrolment year options — current year going back 10 years
  const ENROLL_YEARS = Array.from({ length: 11 }, (_, i) => String(new Date().getFullYear() - i));

  /* Classes for filter */
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 10 * 60_000,
  });
  const classList = classesData?.data ?? [];

  /* Streams for the selected class filter */
  const { data: filterStreamData } = useQuery({
    queryKey: ['streams', { classId, filterPanel: true }],
    queryFn:  () => streamsApi.list({ classId, status: 'active', limit: 200 }),
    enabled:  !!classId,
    staleTime: 60_000,
  });
  const filterStreamList = filterStreamData?.data ?? [];

  /* Single stream lookup — when navigating via ?streamId= (no classId in URL) */
  const { data: singleStreamData } = useQuery({
    queryKey: ['streams', streamId],
    queryFn:  () => streamsApi.get(streamId),
    enabled:  !!streamId && !classId,
    staleTime: 5 * 60_000,
  });

  /* Stats */
  const { data: statsRes, isLoading: statsLoading } = useQuery({
    queryKey: ['students', 'stats'],
    queryFn:  () => studentsApi.stats(),
    staleTime: 5 * 60_000,
  });
  const statsObj   = statsRes?.data ?? {};
  const genderData = (statsObj.byGender ?? []).map(g => ({
    name: g._id ? g._id.charAt(0).toUpperCase() + g._id.slice(1) : 'Unknown',
    value: g.count,
    fill:  GENDER_COLORS[g._id] ?? '#94a3b8',
  }));
  const statusData = (statsObj.byStatus ?? []).map(s => ({
    name: s._id ? s._id.charAt(0).toUpperCase() + s._id.slice(1) : 'Unknown',
    value: s.count,
    fill:  STATUS_COLORS[s._id] ?? '#94a3b8',
  }));

  /* List */
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['students', 'list', { page, search: debSearch, classId, streamId, sectionKey, enrollmentYear, gender, status }],
    queryFn:  () => studentsApi.list({
      page, limit: LIMIT,
      ...(debSearch      && { search: debSearch }),
      ...(classId        && { classId }),
      ...(streamId       && { streamId }),
      ...(sectionKey     && { sectionKey }),
      ...(enrollmentYear && { enrollmentYear }),
      ...(gender         && { gender }),
      ...(status         && { status }),
    }),
    placeholderData: prev => prev,
  });

  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};
  const total      = pagination.total ?? 0;
  const totalPages = pagination.pages ?? 1;

  /* Delete (soft) */
  const { mutate: removeStudent, variables: removingId } = useMutation({
    mutationFn: id => studentsApi.remove(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['students'] });
      toast.success('Student deactivated.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to deactivate student.'),
  });

  function confirmRemove(s) { setDeactivateTarget(s); }

  /* ── Bulk selection ───────────────────────────────────────── */
  const allPageSelected = rows.length > 0 && rows.every(s => selectedIds.has(s.id ?? s._id));
  const someSelected    = selectedIds.size > 0;

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelectedIds(allPageSelected ? new Set() : new Set(rows.map(s => s.id ?? s._id)));
  }
  function clearSelection() { setSelectedIds(new Set()); }

  /* Actual deactivation — called by the confirm modal */
  async function executeDeactivate() {
    if (deactivateTarget === 'bulk') {
      setBulkDeactivating(true);
      try {
        await Promise.all(Array.from(selectedIds).map(id => studentsApi.remove(id)));
        clearSelection();
        qc.invalidateQueries({ queryKey: ['students'] });
      } catch (err) {
        toast.error(err?.message ?? 'Failed to deactivate some students.');
      } finally {
        setBulkDeactivating(false);
      }
    } else if (deactivateTarget) {
      removeStudent(deactivateTarget.id ?? deactivateTarget._id);
    }
    setDeactivateTarget(null);
  }

  /* Bulk grant portal access — chunks of 200 (server batch limit), so any
     selection size works in one click. Credentials come back once; the admin
     downloads them as a CSV to print/distribute. */
  async function bulkGrantPortal() {
    const ids = Array.from(selectedIds);
    setBulkPortalLoading(true);
    setBulkPortalResult(null);
    try {
      const merged = { created: 0, skipped: 0, errors: [], credentials: [] };
      for (let i = 0; i < ids.length; i += 200) {
        const res  = await studentsApi.bulkPortalAccounts(ids.slice(i, i + 200));
        const data = res.data ?? res;
        merged.created += data.created ?? 0;
        merged.skipped += data.skipped ?? 0;
        if (Array.isArray(data.errors))      merged.errors.push(...data.errors);
        if (Array.isArray(data.credentials)) merged.credentials.push(...data.credentials);
      }
      setBulkPortalResult(merged);
      if (merged.credentials.length > 0) downloadCredentialsCsv(merged.credentials);
      clearSelection();
      qc.invalidateQueries({ queryKey: ['students'] });
    } catch (err) {
      toast.error(err?.message ?? 'Failed to grant portal access.');
    } finally {
      setBulkPortalLoading(false);
    }
  }

  /* One-time credentials CSV — passwords are never retrievable again after
     this download, so it fires automatically and stays re-downloadable from
     the result banner until it's dismissed. */
  function downloadCredentialsCsv(credentials) {
    const esc  = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Student Name', 'Admission Number (Username)', 'Temporary Password'],
      ...credentials.map(c => [c.name, c.admissionNumber, c.tempPassword]),
    ];
    // ﻿ BOM so Excel opens it as UTF-8
    const csv  = '﻿' + rows.map(r => r.map(esc).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `student-portal-credentials-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* Bulk purge — hard-delete (admin/superadmin only) */
  const { mutate: purgeSelected, isPending: purging } = useMutation({
    mutationFn: () => studentsApi.purge(Array.from(selectedIds)),
    onSuccess:  () => {
      clearSelection();
      setShowPurge(false);
      qc.invalidateQueries({ queryKey: ['students'] });
      toast.success('Selected students permanently deleted.');
    },
    onError: err => {
      setShowPurge(false);
      toast.error(err?.message ?? 'Failed to permanently delete students.');
    },
  });

  const hasFilters = classId || streamId || sectionKey || enrollmentYear || gender || (status && status !== 'active');
  function clearFilters() {
    setClassId(''); setStreamId(''); setSectionKey(''); setEnrollmentYear('');
    setGender(''); setStatus('active'); setPage(1);
  }

  const [exporting,  setExporting]  = useState(false);
  async function handleExport() {
    setExporting(true);
    try {
      await importExport.exportCSV('students', {
        ...(classId        && { classId }),
        ...(streamId       && { streamId }),
        ...(sectionKey     && { sectionKey }),
        ...(enrollmentYear && { enrollmentYear }),
        ...(gender         && { gender }),
        ...(status         && { status }),
        ...(debSearch      && { search: debSearch }),
      });
    }
    catch (e) { toast.error(e?.message ?? 'Export failed.'); }
    finally { setExporting(false); }
  }

  /* Resolve active filter labels for the breadcrumb chips */
  const activeClassName   = classId
    ? (classList.find(c => (c.id ?? c._id) === classId)?.name ?? null)
    : null;
  const activeStreamName  = streamId
    ? (filterStreamList.find(s => (s.id ?? s._id) === streamId)?.name
      ?? singleStreamData?.data?.name
      ?? null)
    : null;
  const activeSectionName = sectionKey
    ? (sectionTabs.find(s => s.id === sectionKey)?.label ?? sectionKey)
    : null;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Page header ─────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-2xl mx-auto flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Students</h1>

              {/* Section chip */}
              {activeSectionName && (
                <FilterChip label={activeSectionName} onClear={() => { setSectionKey(''); setClassId(''); setStreamId(''); setPage(1); }} />
              )}
              {/* Class + Stream chip */}
              {activeClassName && (
                <FilterChip
                  label={[activeClassName, activeStreamName ? `Stream ${activeStreamName}` : null].filter(Boolean).join(' · ')}
                  onClear={() => { setClassId(''); setStreamId(''); setPage(1); }}
                  icon={<GraduationCap size={11} />}
                />
              )}
              {!activeClassName && activeStreamName && (
                <FilterChip label={`Stream ${activeStreamName}`} onClear={() => { setStreamId(''); setPage(1); }} icon={<GraduationCap size={11} />} />
              )}
              {/* Enrolment Year chip */}
              {enrollmentYear && (
                <FilterChip label={`Enrolled ${enrollmentYear}`} onClear={() => { setEnrollmentYear(''); setPage(1); }} />
              )}
              {/* Gender chip */}
              {gender && (
                <FilterChip label={gender.charAt(0).toUpperCase() + gender.slice(1).replace(/_/g, ' ')} onClear={() => { setGender(''); setPage(1); }} />
              )}
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {statsLoading ? 'Loading…' : `${(statsObj.total ?? 0).toLocaleString()} total · ${(statsObj.active ?? 0).toLocaleString()} active`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilter(f => !f)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors ${showFilter || hasFilters ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}
            >
              <Filter size={14} />
              Filters
              {hasFilters && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:border-slate-400 hover:text-slate-800 disabled:opacity-50 transition-colors"
              title={hasFilters ? 'Export filtered students to CSV' : 'Export all students to CSV'}
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Export
            </button>
            {canDelete && (
              <button
                onClick={() => setShowPromote(true)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-violet-200 text-violet-700 hover:bg-violet-50 hover:border-violet-400 transition-colors"
              >
                <ArrowUpCircle size={14} />
                Promote
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-5 space-y-5">

        {/* ── Stats + Charts row ───────────────────────── */}
        {!statsLoading && statsObj.total > 0 && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total card */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users size={14} className="text-slate-400" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</span>
              </div>
              <p className="text-3xl font-bold text-slate-900 tabular-nums">{(statsObj.total ?? 0).toLocaleString()}</p>
              <p className="text-xs text-emerald-600 font-medium mt-1">{(statsObj.active ?? 0).toLocaleString()} active</p>
            </div>

            {/* Gender chart */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">By Gender</span>
              </div>
              {genderData.length > 0 ? (
                <div className="flex items-center gap-3">
                  <ResponsiveContainer width={70} height={70}>
                    <PieChart>
                      <Pie data={genderData} innerRadius={20} outerRadius={33} paddingAngle={2} dataKey="value">
                        {genderData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip content={<ChartTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 flex-1">
                    {genderData.map(d => (
                      <div key={d.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ background: d.fill }} />
                          <span className="text-[11px] text-slate-500">{d.name}</span>
                        </div>
                        <span className="text-[11px] font-semibold text-slate-700 tabular-nums">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <p className="text-xs text-slate-400">No data</p>}
            </div>

            {/* Status chart */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">By Status</span>
              </div>
              {statusData.length > 0 ? (
                <div className="flex items-center gap-3">
                  <ResponsiveContainer width={70} height={70}>
                    <PieChart>
                      <Pie data={statusData} innerRadius={20} outerRadius={33} paddingAngle={2} dataKey="value">
                        {statusData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip content={<ChartTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-1.5 flex-1">
                    {statusData.map(d => (
                      <div key={d.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ background: d.fill }} />
                          <span className="text-[11px] text-slate-500">{d.name}</span>
                        </div>
                        <span className="text-[11px] font-semibold text-slate-700 tabular-nums">{d.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <p className="text-xs text-slate-400">No data</p>}
            </div>

            {/* Class breakdown */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <GraduationCap size={14} className="text-slate-400" />
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Top Classes</span>
              </div>
              <div className="space-y-1.5">
                {(statsObj.byClass ?? []).slice(0, 4).map(c => {
                  const maxC = Math.max(...(statsObj.byClass ?? []).map(x => x.count), 1);
                  return (
                    <div key={c._id ?? c.className}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-[11px] text-slate-600 truncate flex-1">{c.className ?? c._id ?? 'Unknown'}</span>
                        <span className="text-[11px] font-semibold text-slate-700 tabular-nums ml-2">{c.count}</span>
                      </div>
                      <div className="h-1 bg-slate-100 rounded-full">
                        <div className="h-full bg-violet-400 rounded-full" style={{ width: `${Math.round((c.count / maxC) * 100)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Search + filters ─────────────────────────── */}
        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => onSearch(e.target.value)}
              placeholder="Search by name, admission no. or email…"
              className="w-full pl-9 pr-8 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400 transition"
            />
            {search && (
              <button onClick={() => { setSearch(''); setDebSearch(''); setPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={13} />
              </button>
            )}
          </div>

          <AnimatePresence>
            {showFilter && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-end gap-4">
                  {/* Section */}
                  <div className="flex-1 min-w-36">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Section</label>
                    <select value={sectionKey} onChange={e => { setSectionKey(e.target.value); setClassId(''); setStreamId(''); setPage(1); }} className={selectCls}>
                      <option value="">All sections</option>
                      {sectionTabs.filter(s => s.id !== 'all').map(s => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  {/* Class — filtered to selected section if one is active */}
                  <div className="flex-1 min-w-36">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Class</label>
                    <select value={classId} onChange={e => { setClassId(e.target.value); setStreamId(''); setPage(1); }} className={selectCls}>
                      <option value="">All classes</option>
                      {(sectionKey
                        ? classList.filter(c => c.sectionKey === sectionKey)
                        : classList
                      ).map(c => <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>)}
                    </select>
                  </div>
                  {/* Stream — only shown when a class is selected */}
                  {classId && (
                    <div className="flex-1 min-w-36">
                      <label className="block text-xs font-medium text-slate-600 mb-1.5">Stream</label>
                      <select value={streamId} onChange={e => { setStreamId(e.target.value); setPage(1); }} className={selectCls}>
                        <option value="">All streams</option>
                        {filterStreamList.map(s => <option key={s.id ?? s._id} value={s.id ?? s._id}>Stream {s.name}</option>)}
                      </select>
                    </div>
                  )}
                  {/* Gender */}
                  <div className="flex-1 min-w-36">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Gender</label>
                    <select value={gender} onChange={e => { setGender(e.target.value); setPage(1); }} className={selectCls}>
                      {GENDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  {/* Status */}
                  <div className="flex-1 min-w-36">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Status</label>
                    <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className={selectCls}>
                      {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  {/* Enrolment Year */}
                  <div className="flex-1 min-w-36">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Enrolment Year</label>
                    <select value={enrollmentYear} onChange={e => { setEnrollmentYear(e.target.value); setPage(1); }} className={selectCls}>
                      <option value="">All years</option>
                      {ENROLL_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                  {hasFilters && (
                    <button onClick={clearFilters} className="text-xs font-medium text-slate-500 hover:text-slate-800 underline underline-offset-2 whitespace-nowrap">
                      Clear filters
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Bulk action bar ───────────────────────────── */}
        <AnimatePresence>
          {someSelected && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              className="flex items-center gap-3 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-sm"
            >
              <span className="font-medium tabular-nums">{selectedIds.size} selected</span>
              <button onClick={clearSelection} className="text-slate-400 hover:text-white transition ml-1">
                <X size={13} />
              </button>
              <div className="h-4 w-px bg-slate-700 mx-1" />
              {canDelete && (
                <button
                  onClick={bulkGrantPortal}
                  disabled={bulkPortalLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-50 transition text-xs font-medium"
                >
                  {bulkPortalLoading ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
                  Grant Portal Access
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => setDeactivateTarget('bulk')}
                  disabled={bulkDeactivating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 transition text-xs font-medium"
                >
                  {bulkDeactivating ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
                  Deactivate
                </button>
              )}
              {canHardDelete && (
                <button
                  onClick={() => setShowPurge(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 transition text-xs font-medium"
                >
                  <ShieldAlert size={12} />
                  Permanently Delete
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Portal access result banner ───────────────── */}
        {bulkPortalResult && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-800">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
              <span>
                <span className="font-semibold">{bulkPortalResult.created}</span> portal account{bulkPortalResult.created !== 1 ? 's' : ''} created
                {bulkPortalResult.skipped > 0 && <span className="text-emerald-600"> · {bulkPortalResult.skipped} skipped (already active or ineligible)</span>}
                {bulkPortalResult.errors?.length > 0 && <span className="text-amber-700"> · {bulkPortalResult.errors.length} failed</span>}
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {bulkPortalResult.credentials?.length > 0 && (
                <button
                  onClick={() => downloadCredentialsCsv(bulkPortalResult.credentials)}
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 underline underline-offset-2 transition"
                  title="Passwords are shown once — save this file before dismissing"
                >
                  Download credentials (CSV)
                </button>
              )}
              <button onClick={() => setBulkPortalResult(null)} className="text-emerald-500 hover:text-emerald-800 transition">
                <X size={13} />
              </button>
            </div>
          </div>
        )}

        {/* ── Table ─────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {isFetching && !isLoading && (
            <div className="flex items-center gap-2 px-5 py-2 bg-violet-50 border-b border-violet-100 text-xs text-violet-700">
              <Loader2 size={12} className="animate-spin" /> Refreshing…
            </div>
          )}

          {isLoading ? (
            <div className="divide-y divide-slate-50">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-4 animate-pulse">
                  <div className="w-9 h-9 rounded-full bg-slate-100 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-slate-100 rounded w-40" />
                    <div className="h-2.5 bg-slate-100 rounded w-24" />
                  </div>
                  <div className="h-5 bg-slate-100 rounded w-16" />
                  <div className="h-2.5 bg-slate-100 rounded w-14" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <AlertTriangle size={24} className="text-red-400" />
              <p className="text-sm text-slate-500">{error?.message ?? 'Failed to load students'}</p>
              <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <GraduationCap size={32} className="mb-2 opacity-40" />
              <p className="text-sm font-medium text-slate-600">No students found</p>
              <p className="text-xs mt-1">{debSearch ? 'Try a different search term' : 'Add your first student to get started'}</p>
              {debSearch && (
                <button onClick={() => { setSearch(''); setDebSearch(''); setPage(1); }} className="mt-3 text-xs font-medium text-violet-600 underline">
                  Clear search
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="py-3 pl-4 pr-2 w-8">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleSelectAll}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20 cursor-pointer"
                    />
                  </th>
                  <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Student</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Admission No.</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Class</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Gender</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden xl:table-cell">House</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map(s => {
                  const id  = s.id ?? s._id;
                  const av  = avatarColor(`${s.firstName}${s.lastName}`);
                  const sts = STATUS_BADGE[s.status] ?? STATUS_BADGE.inactive;
                  const removing = removingId === id;
                  return (
                    <tr key={id} className={`hover:bg-slate-50 transition group ${removing ? 'opacity-40 pointer-events-none' : ''} ${selectedIds.has(id) ? 'bg-violet-50/60' : ''}`}>
                      <td className="py-3.5 pl-4 pr-2" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(id)}
                          onChange={() => toggleSelect(id)}
                          className="w-3.5 h-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900/20 cursor-pointer"
                        />
                      </td>
                      <td className="py-3.5 px-5">
                        <Link to={`/students/${id}`} className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${av} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                            {initials(s.firstName, s.lastName)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium text-slate-800 truncate group-hover:text-slate-900">{s.firstName} {s.lastName}</p>
                              {s.hasPortalAccount && (
                                <span title="Has student portal account" className="inline-flex items-center shrink-0">
                                  <KeyRound size={10} className="text-violet-400" />
                                </span>
                              )}
                            </div>
                            {s.parentEmail && <p className="text-xs text-slate-400 truncate hidden sm:block">{s.parentEmail}</p>}
                          </div>
                        </Link>
                      </td>
                      <td className="py-3.5 px-4 hidden sm:table-cell">
                        <span className="font-mono text-xs text-slate-500">{s.admissionNumber ?? '—'}</span>
                      </td>
                      <td className="py-3.5 px-4 hidden md:table-cell text-sm text-slate-600">{s.className ?? '—'}</td>
                      <td className="py-3.5 px-4 hidden lg:table-cell text-sm text-slate-600 capitalize">
                        {s.gender === 'prefer_not_to_say' ? 'Not stated' : s.gender ?? '—'}
                      </td>
                      <td className="py-3.5 px-4 hidden xl:table-cell text-sm text-slate-600">{houseName(s.houseId ?? s.house) ?? '—'}</td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full capitalize ${sts}`}>
                          {s.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                          <Link to={`/students/${id}`} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition" title="View profile">
                            <Eye size={14} />
                          </Link>
                          {canDelete && (
                            <button onClick={() => confirmRemove(s)} className="p-1.5 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition" title="Deactivate student">
                              <UserMinus size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <Pagination page={page} totalPages={totalPages} total={total} limit={LIMIT} onPage={setPage} />
      </div>

      {/* ── Deactivate confirm modal ─────────────────────── */}
      <AnimatePresence>
        {deactivateTarget !== null && (
          <DeactivateConfirmModal
            target={deactivateTarget}
            busy={bulkDeactivating || !!removingId}
            onConfirm={executeDeactivate}
            onCancel={() => setDeactivateTarget(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Purge confirm modal ───────────────────────────── */}
      <AnimatePresence>
        {showPurge && (
          <PurgeConfirmModal
            count={selectedIds.size}
            purging={purging}
            onConfirm={purgeSelected}
            onCancel={() => setShowPurge(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Year-end Promotion modal ──────────────────────── */}
      <AnimatePresence>
        {showPromote && (
          <PromoteModal onClose={() => setShowPromote(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Select style ─────────────────────────────────────────── */
const selectCls = 'w-full text-sm px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-700 transition';

/* ══════════════════════════════════════════════════════════
   ADD STUDENT SLIDE-OVER
   ══════════════════════════════════════════════════════════ */
const EMPTY = {
  firstName: '', lastName: '', middleName: '', dateOfBirth: '',
  gender: '', classId: '', streamId: '', parentName: '', parentEmail: '',
  parentPhone: '', address: '', medicalNotes: '', status: 'active',
  enrollmentDate: new Date().toISOString().slice(0, 10),
  enrollmentAcademicYearId: '', enrollmentTermId: '',
};

export function AddStudentSlideOver({ classList, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const currentPeriod = useCurrentAcademicPeriod();

  // Load streams for the selected class
  const { data: streamData } = useQuery({
    queryKey: ['streams', { classId: form.classId }],
    queryFn:  () => streamsApi.list({ classId: form.classId, status: 'active', limit: 200 }),
    enabled:  !!form.classId,
    staleTime: 60_000,
  });
  const streamList = streamData?.data ?? [];

  // Academic years — for the intake year/term pickers
  const { data: yearsData } = useQuery({
    queryKey: ['academic-config', 'years'],
    queryFn:  academicConfigApi.years.list,
    staleTime: 10 * 60_000,
  });
  const years = yearsData?.data ?? yearsData ?? [];
  const selectedYear = years.find(y => (y.id ?? y._id?.toString()) === form.enrollmentAcademicYearId);
  const yearTerms     = selectedYear?.terms ?? [];

  /* Default intake year/term to the live-resolved current period —
     still fully overridable (e.g. backdating an enrolment). */
  useEffect(() => {
    if (!currentPeriod.academicYearId || form.enrollmentAcademicYearId) return;
    setForm(f => ({
      ...f,
      enrollmentAcademicYearId: currentPeriod.academicYearId,
      enrollmentTermId:         currentPeriod.termId ?? '',
    }));
  }, [currentPeriod.academicYearId, currentPeriod.termId]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: data => studentsApi.create(data),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create student' }),
  });

  function set(field, val) {
    setForm(f => {
      const next = { ...f, [field]: val };
      // Clear streamId when class changes
      if (field === 'classId') next.streamId = '';
      // Clear term when year changes
      if (field === 'enrollmentAcademicYearId') next.enrollmentTermId = '';
      return next;
    });
    setErrors(e => { const n = { ...e }; delete n[field]; return n; });
  }

  function validate() {
    const e = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim())  e.lastName  = 'Required';
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
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Enrol New Student</h2>
            <p className="text-xs text-slate-400 mt-0.5">An admission number will be auto-generated</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={15} className="shrink-0" />
              {errors._server}
            </div>
          )}

          <FormSection label="Student Details">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="First Name *" error={errors.firstName}>
                <input value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="First name" className={inputCls(errors.firstName)} />
              </FormField>
              <FormField label="Last Name *" error={errors.lastName}>
                <input value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Last name" className={inputCls(errors.lastName)} />
              </FormField>
            </div>
            <FormField label="Middle Name">
              <input value={form.middleName} onChange={e => set('middleName', e.target.value)} placeholder="Middle name (optional)" className={inputCls()} />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Date of Birth">
                <input type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} className={inputCls()} />
              </FormField>
              <FormField label="Gender">
                <select value={form.gender} onChange={e => set('gender', e.target.value)} className={inputCls()}>
                  <option value="">Select…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Class">
                <select value={form.classId} onChange={e => set('classId', e.target.value)} className={inputCls()}>
                  <option value="">No class yet</option>
                  {classList.map(c => <option key={c._id ?? c.id} value={c.id ?? c._id}>{c.name}</option>)}
                </select>
              </FormField>
              <FormField label="Stream">
                <select
                  value={form.streamId}
                  onChange={e => set('streamId', e.target.value)}
                  disabled={!form.classId}
                  className={inputCls()}
                >
                  <option value="">{form.classId ? 'No stream' : 'Select class first'}</option>
                  {streamList.map(s => <option key={s.id ?? s._id} value={s.id ?? s._id}>Stream {s.name}</option>)}
                </select>
              </FormField>
            </div>
            <FormField label="Enrolment Date">
              <input type="date" value={form.enrollmentDate} onChange={e => set('enrollmentDate', e.target.value)} className={inputCls()} />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Academic Year">
                <select value={form.enrollmentAcademicYearId} onChange={e => set('enrollmentAcademicYearId', e.target.value)} className={inputCls()}>
                  <option value="">Select year…</option>
                  {years.map(y => (
                    <option key={y.id ?? y._id} value={y.id ?? y._id}>
                      {y.name}{y.isCurrent ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Term">
                <select
                  value={form.enrollmentTermId}
                  onChange={e => set('enrollmentTermId', e.target.value)}
                  disabled={!form.enrollmentAcademicYearId}
                  className={inputCls()}
                >
                  <option value="">{form.enrollmentAcademicYearId ? 'Select term…' : 'Select year first'}</option>
                  {yearTerms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </FormField>
            </div>
          </FormSection>

          <FormSection label="Parent / Guardian">
            <FormField label="Full Name">
              <input value={form.parentName} onChange={e => set('parentName', e.target.value)} placeholder="Parent or guardian name" className={inputCls()} />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Phone">
                <div className="relative">
                  <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={form.parentPhone} onChange={e => set('parentPhone', e.target.value)} placeholder="+254 …" className={`${inputCls()} pl-8`} />
                </div>
              </FormField>
              <FormField label="Email">
                <div className="relative">
                  <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="email" value={form.parentEmail} onChange={e => set('parentEmail', e.target.value)} placeholder="parent@email.com" className={`${inputCls()} pl-8`} />
                </div>
              </FormField>
            </div>
            <FormField label="Address">
              <textarea value={form.address} onChange={e => set('address', e.target.value)} rows={2} placeholder="Home address" className={`${inputCls()} resize-none`} />
            </FormField>
          </FormSection>

          <FormSection label="Medical Notes">
            <FormField label="Special needs / medical information">
              <textarea value={form.medicalNotes} onChange={e => set('medicalNotes', e.target.value)} rows={3} placeholder="Any relevant medical or special educational needs…" className={`${inputCls()} resize-none`} />
            </FormField>
          </FormSection>
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
            {mutation.isPending ? 'Enrolling…' : 'Enrol Student'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

function FilterChip({ label, onClear, icon }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2.5 py-1">
      {icon}
      {label}
      <button onClick={onClear} className="ml-0.5 text-violet-400 hover:text-violet-700 transition">
        <X size={11} />
      </button>
    </span>
  );
}

function FormSection({ label, children }) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function FormField({ label, error, children }) {
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
   DEACTIVATE CONFIRM MODAL
   ══════════════════════════════════════════════════════════ */
function DeactivateConfirmModal({ target, busy, onConfirm, onCancel }) {
  const isBulk  = target === 'bulk';
  const name    = isBulk ? null : `${target.firstName} ${target.lastName}`;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50"
        onClick={!busy ? onCancel : undefined}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ type: 'spring', damping: 30, stiffness: 400 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md pointer-events-auto">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <UserMinus size={18} className="text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  {isBulk ? `Deactivate ${target === 'bulk' ? 'selected' : ''} students?` : `Deactivate ${name}?`}
                </h3>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  {isBulk
                    ? 'Selected student records will be set to inactive. Their data is preserved and can be reactivated at any time.'
                    : `${name}'s record will be set to inactive. Their data is preserved and can be reactivated at any time.`
                  }
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
            <button
              onClick={onCancel}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={busy}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
              {busy ? 'Deactivating…' : 'Deactivate'}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   PURGE CONFIRM MODAL
   ══════════════════════════════════════════════════════════ */
function PurgeConfirmModal({ count, purging, onConfirm, onCancel }) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50"
        onClick={!purging ? onCancel : undefined}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ type: 'spring', damping: 30, stiffness: 400 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md pointer-events-auto">
          <div className="p-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <ShieldAlert size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">Permanently delete {count} student{count !== 1 ? 's' : ''}?</h3>
                <p className="text-sm text-slate-500 mt-1 leading-relaxed">
                  This will permanently remove {count === 1 ? 'this student record' : `all ${count} student records`} along with any linked invoices and payment history. <span className="font-medium text-slate-700">This cannot be undone.</span>
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700 space-y-1">
              <p className="font-semibold">The following will also be deleted:</p>
              <p>· All invoices and payment records for the selected students</p>
              <p>· This action is logged and cannot be reversed</p>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50 rounded-b-2xl">
            <button
              onClick={onCancel}
              disabled={purging}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={purging}
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {purging ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              {purging ? 'Deleting…' : `Permanently Delete ${count}`}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   PROMOTE MODAL — year-end bulk promotion (admin only)
   Step 1 (build): admin maps each class to its destination.
   Step 2 (preview): dry-run shows counts before any write.
   Step 3 (done): result shown with totals.
   ══════════════════════════════════════════════════════════ */
function PromoteModal({ onClose }) {
  const qc = useQueryClient();

  const { data: clsData, isLoading: clsLoading } = useQuery({
    queryKey: ['classes', 'list'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 60_000,
  });
  const allClasses = (clsData?.data ?? []).slice().sort((a, b) => {
    const ao = a.order ?? 9999, bo = b.order ?? 9999;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  const [promotions, setPromotions] = useState([]);
  const [preview,    setPreview]    = useState(null);
  const [step,       setStep]       = useState('build');
  const [err,        setErr]        = useState('');

  useEffect(() => {
    if (allClasses.length > 0 && promotions.length === 0) {
      setPromotions(
        allClasses
          .filter(c => c.order != null)
          .map(c => ({ fromClassId: c.id ?? c._id, toClassId: '' }))
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allClasses.length]);

  const validRows = promotions.filter(p => p.fromClassId);

  const { mutate: runPreview, isPending: previewing } = useMutation({
    mutationFn: () => studentsApi.promote({ dryRun: true, promotions: validRows }),
    onSuccess: res => { setPreview(res.data); setStep('preview'); setErr(''); },
    onError:   e  => setErr(e?.message ?? 'Preview failed.'),
  });

  const { mutate: runCommit, isPending: committing } = useMutation({
    mutationFn: () => studentsApi.promote({ dryRun: false, promotions: validRows }),
    onSuccess: res => { setPreview(res.data); setStep('done'); qc.invalidateQueries({ queryKey: ['students'] }); },
    onError:   e  => setErr(e?.message ?? 'Promotion failed.'),
  });

  function updateRow(idx, field, val) {
    setPromotions(prev => prev.map((p, i) => i === idx ? { ...p, [field]: val } : p));
    setPreview(null);
    if (step === 'preview') setStep('build');
  }

  const Stat = ({ label, val, cls }) => (
    <div className={`rounded-xl border p-4 text-center ${cls}`}>
      <p className="text-2xl font-bold">{(val ?? 0).toLocaleString()}</p>
      <p className="text-xs font-medium mt-0.5">{label}</p>
    </div>
  );

  const SummaryRow = ({ row }) => (
    <div className="flex items-center gap-2 px-4 py-3 text-sm">
      <span className="font-medium text-slate-800 w-32 shrink-0 truncate">{row.fromClassName}</span>
      <ChevronsRight size={14} className="text-slate-400 shrink-0" />
      <span className={`font-medium ${row.action === 'graduate' ? 'text-emerald-600' : 'text-violet-600'}`}>
        {row.action === 'graduate' ? 'Graduate' : row.toClassName}
      </span>
      <span className="ml-auto text-xs text-slate-500">{row.count} students{row.skipped > 0 ? ` · ${row.skipped} skipped` : ''}</span>
    </div>
  );

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50"
        onClick={step === 'build' || step === 'preview' ? onClose : undefined}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', damping: 25, stiffness: 280 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
              <ArrowUpCircle size={18} className="text-violet-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-slate-900">Year-End Promotion</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Map each class to its next class. Withdrawn, transferred and graduated students are automatically skipped.
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {err && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5 rounded-lg">
                <AlertTriangle size={14} className="shrink-0" />{err}
              </div>
            )}

            {/* Done */}
            {step === 'done' && preview && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-emerald-700">
                  <CheckCircle2 size={18} /><span className="font-semibold text-sm">Promotion complete</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Promoted"  val={preview.totals?.promoted}  cls="text-violet-700 bg-violet-50 border-violet-200" />
                  <Stat label="Graduated" val={preview.totals?.graduated} cls="text-emerald-700 bg-emerald-50 border-emerald-200" />
                  <Stat label="Skipped"   val={preview.totals?.skipped}   cls="text-slate-600 bg-slate-50 border-slate-200" />
                </div>
                <div className="rounded-xl border border-slate-100 divide-y divide-slate-100 overflow-hidden">
                  {preview.summary?.map((row, i) => <SummaryRow key={i} row={row} />)}
                </div>
              </div>
            )}

            {/* Preview */}
            {step === 'preview' && preview && (
              <div className="space-y-4">
                <p className="text-sm font-medium text-slate-700">Review before committing — this cannot be undone:</p>
                <div className="grid grid-cols-3 gap-3">
                  <Stat label="Will promote"  val={preview.totals?.promoted}  cls="text-violet-700 bg-violet-50 border-violet-200" />
                  <Stat label="Will graduate" val={preview.totals?.graduated} cls="text-emerald-700 bg-emerald-50 border-emerald-200" />
                  <Stat label="Will skip"     val={preview.totals?.skipped}   cls="text-slate-600 bg-slate-50 border-slate-200" />
                </div>
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                  {preview.summary?.map((row, i) => <SummaryRow key={i} row={row} />)}
                </div>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Graduated students will be marked as <strong>graduated</strong> and their portal accounts deactivated.
                  Stream assignments are cleared for promoted students — re-assign in the new class.
                </p>
              </div>
            )}

            {/* Build map */}
            {step === 'build' && (
              <div className="space-y-3">
                {clsLoading ? (
                  <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}</div>
                ) : (
                  <>
                    <div className="grid grid-cols-[1fr_16px_1fr_28px] gap-2 px-1">
                      <p className="text-xs font-medium text-slate-500">From class</p>
                      <span />
                      <p className="text-xs font-medium text-slate-500">To class (blank = graduate)</p>
                      <span />
                    </div>
                    {promotions.map((p, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_16px_1fr_28px] gap-2 items-center">
                        <select
                          value={p.fromClassId}
                          onChange={e => updateRow(idx, 'fromClassId', e.target.value)}
                          className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400"
                        >
                          <option value="">Select class…</option>
                          {allClasses.map(c => {
                            const cid = c.id ?? c._id;
                            return <option key={cid} value={cid}>{c.order != null ? `#${c.order} ` : ''}{c.name}</option>;
                          })}
                        </select>
                        <ChevronsRight size={14} className="text-slate-400 justify-self-center" />
                        <select
                          value={p.toClassId}
                          onChange={e => updateRow(idx, 'toClassId', e.target.value)}
                          className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-400/30 focus:border-violet-400"
                        >
                          <option value="">Graduate (final year)</option>
                          {allClasses.filter(c => (c.id ?? c._id) !== p.fromClassId).map(c => {
                            const cid = c.id ?? c._id;
                            return <option key={cid} value={cid}>{c.order != null ? `#${c.order} ` : ''}{c.name}</option>;
                          })}
                        </select>
                        <button
                          onClick={() => setPromotions(prev => prev.filter((_, i) => i !== idx))}
                          className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition justify-self-center"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setPromotions(prev => [...prev, { fromClassId: '', toClassId: '' }])}
                      className="text-xs font-medium text-violet-600 hover:text-violet-800 transition-colors"
                    >
                      + Add class
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
            {step === 'done' ? (
              <button onClick={onClose} className="px-5 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition">
                Done
              </button>
            ) : step === 'preview' ? (
              <>
                <button onClick={() => { setStep('build'); setPreview(null); }} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition">
                  Back
                </button>
                <button
                  onClick={() => runCommit()}
                  disabled={committing}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg transition"
                >
                  {committing ? <Loader2 size={13} className="animate-spin" /> : <GraduationCap size={13} />}
                  {committing ? 'Running…' : 'Confirm & Promote'}
                </button>
              </>
            ) : (
              <>
                <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition">
                  Cancel
                </button>
                <button
                  onClick={() => runPreview()}
                  disabled={previewing || validRows.length === 0}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg transition"
                >
                  {previewing ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
                  {previewing ? 'Calculating…' : 'Preview'}
                </button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}
