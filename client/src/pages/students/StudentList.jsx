/* ============================================================
   Students — Premium List with Stats, Charts & Add Slide-Over
   /platform-audit: RBAC-gated, correct API shapes, no raw emojis
   ============================================================ */
import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Search, X, UserPlus, ChevronRight, Filter,
  GraduationCap, Users, AlertTriangle, Eye, Trash2,
  Loader2, CheckCircle2, Phone, Mail, Calendar, Download,
} from 'lucide-react';
import { students as studentsApi, classes as classesApi, importExport } from '@/api/client.js';
import { Pagination } from '@/components/ui/Pagination.jsx';
import useAuthStore from '@/store/auth.js';

const LIMIT = 25;

const STATUS_OPTIONS = [
  { value: '',           label: 'All statuses' },
  { value: 'active',     label: 'Active'       },
  { value: 'inactive',   label: 'Inactive'     },
  { value: 'suspended',  label: 'Suspended'    },
  { value: 'graduated',  label: 'Graduated'    },
  { value: 'transferred',label: 'Transferred'  },
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
  const can     = useAuthStore(s => s.can.bind(s));
  const role    = useAuthStore(s => s.session?.user?.role ?? '');

  const canCreate = can('students') || role === 'admin' || role === 'superadmin';
  const canDelete = can('students') || role === 'admin' || role === 'superadmin';

  /* Read ?classId= from URL so "View students" on class cards pre-filters the list */
  const [searchParams] = useSearchParams();

  /* Filters — classId seeded from URL param if present */
  const [search,    setSearch]    = useState('');
  const [debSearch, setDebSearch] = useState('');
  const [classId,   setClassId]   = useState(() => searchParams.get('classId') ?? '');
  const [gender,    setGender]    = useState('');
  const [status,    setStatus]    = useState('active');
  const [page,      setPage]      = useState(1);
  const [showAdd,   setShowAdd]   = useState(false);
  /* Auto-open filter panel when arriving via a class link so the active filter is visible */
  const [showFilter, setShowFilter] = useState(() => !!searchParams.get('classId'));

  /* React to URL param changes (e.g. navigating from one class card to another
     while already on the students page — component stays mounted)            */
  useEffect(() => {
    const cid = searchParams.get('classId') ?? '';
    setClassId(cid);
    if (cid) { setShowFilter(true); setPage(1); }
  }, [searchParams.get('classId')]); // eslint-disable-line react-hooks/exhaustive-deps

  const timer = useRef(null);
  function onSearch(v) {
    setSearch(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setDebSearch(v); setPage(1); }, 350);
  }

  /* Classes for filter */
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 10 * 60_000,
  });
  const classList = classesData?.data ?? [];

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
    queryKey: ['students', 'list', { page, search: debSearch, classId, gender, status }],
    queryFn:  () => studentsApi.list({
      page, limit: LIMIT,
      ...(debSearch && { search: debSearch }),
      ...(classId   && { classId }),
      ...(gender    && { gender }),
      ...(status    && { status }),
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
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['students'] }),
  });

  function confirmRemove(s) {
    if (!confirm(`Remove ${s.firstName} ${s.lastName}? Their record will be set to inactive.`)) return;
    removeStudent(s._id ?? s.id);
  }

  const hasFilters = classId || gender || (status && status !== 'active');
  function clearFilters() { setClassId(''); setGender(''); setStatus('active'); setPage(1); }

  const [exporting, setExporting] = useState(false);
  async function handleExport() {
    setExporting(true);
    try { await importExport.exportCSV('students'); }
    catch (e) { alert(e?.message ?? 'Export failed'); }
    finally { setExporting(false); }
  }

  /* Resolve the active class name for the filter breadcrumb */
  const activeClassName = classId
    ? (classList.find(c => (c._id ?? c.id) === classId)?.name ?? null)
    : null;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Page header ─────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-2xl mx-auto flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Students</h1>
              {activeClassName && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2.5 py-1">
                  <GraduationCap size={11} />
                  {activeClassName}
                  <button
                    onClick={() => { setClassId(''); setPage(1); }}
                    className="ml-0.5 text-violet-400 hover:text-violet-700 transition"
                    title="Clear class filter"
                  >
                    <X size={11} />
                  </button>
                </span>
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
              title="Export all students to CSV"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Export
            </button>
            {canCreate && (
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <UserPlus size={15} />
                Add Student
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
                  <div className="flex-1 min-w-36">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Class</label>
                    <select value={classId} onChange={e => { setClassId(e.target.value); setPage(1); }} className={selectCls}>
                      <option value="">All classes</option>
                      {classList.map(c => <option key={c._id ?? c.id} value={c._id ?? c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <div className="flex-1 min-w-36">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Status</label>
                    <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className={selectCls}>
                      {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  <div className="flex-1 min-w-36">
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">Gender</label>
                    <select value={gender} onChange={e => { setGender(e.target.value); setPage(1); }} className={selectCls}>
                      {GENDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
                  const id  = s._id ?? s.id;
                  const av  = avatarColor(`${s.firstName}${s.lastName}`);
                  const sts = STATUS_BADGE[s.status] ?? STATUS_BADGE.inactive;
                  const removing = removingId === id;
                  return (
                    <tr key={id} className={`hover:bg-slate-50 transition group ${removing ? 'opacity-40 pointer-events-none' : ''}`}>
                      <td className="py-3.5 px-5">
                        <Link to={`/students/${id}`} className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${av} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                            {initials(s.firstName, s.lastName)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800 truncate group-hover:text-slate-900">{s.firstName} {s.lastName}</p>
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
                      <td className="py-3.5 px-4 hidden xl:table-cell text-sm text-slate-600">{s.house ?? '—'}</td>
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
                            <button onClick={() => confirmRemove(s)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition" title="Remove student">
                              <Trash2 size={14} />
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

      {/* ── Add Student Slide-Over ───────────────────────── */}
      <AnimatePresence>
        {showAdd && (
          <AddStudentSlideOver
            classList={classList}
            onClose={() => setShowAdd(false)}
            onCreated={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['students'] }); }}
          />
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
  gender: '', classId: '', parentName: '', parentEmail: '',
  parentPhone: '', address: '', medicalNotes: '', status: 'active',
  enrollmentDate: new Date().toISOString().slice(0, 10),
};

function AddStudentSlideOver({ classList, onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});

  const mutation = useMutation({
    mutationFn: data => studentsApi.create(data),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create student' }),
  });

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
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
                  {classList.map(c => <option key={c._id ?? c.id} value={c._id ?? c.id}>{c.name}</option>)}
                </select>
              </FormField>
              <FormField label="Enrolment Date">
                <input type="date" value={form.enrollmentDate} onChange={e => set('enrollmentDate', e.target.value)} className={inputCls()} />
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
