/* ============================================================
   Teachers — Premium List with Add + View/Edit Slide-Overs
   /platform-audit: RBAC-gated, lucide icons, correct API shape
   ============================================================ */
import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, X, Trash2, Eye, Loader2,
  AlertTriangle, Phone, Mail,
  Briefcase, Users, Edit2, Save, Calendar,
  MapPin, Award, Download, ClipboardList, Plus, Filter,
} from 'lucide-react';
import {
  teachers as teachersApi,
  teachingAssignments as assignmentsApi,
  rooms as roomsApi,
  classes as classesApi,
  classSubjects,
  importExport,
  departments as deptsApi,
  subjects as subjectsApi,
} from '@/api/client.js';
import { Pagination } from '@/components/ui/Pagination.jsx';
import useAuthStore from '@/store/auth.js';
import { useToast } from '@/hooks/useToast.jsx';

const LIMIT = 25;

const CONTRACT_LABELS = {
  full_time: 'Full-time', part_time: 'Part-time',
  supply: 'Supply', volunteer: 'Volunteer',
};
const STATUS_BADGE = {
  active:     'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  inactive:   'bg-slate-100 text-slate-500',
  on_leave:   'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  terminated: 'bg-red-50 text-red-600 ring-1 ring-red-200',
};

const AVATAR_COLORS = [
  'from-violet-500 to-purple-600','from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-600',
  'from-pink-500 to-rose-600',    'from-indigo-500 to-blue-600',
];
function avatarColor(n = '') { return AVATAR_COLORS[(n.charCodeAt(0)||0) % AVATAR_COLORS.length]; }
function initials(f='',l='') { return `${f[0]??''}${l[0]??''}`.toUpperCase(); }

/* ══════════════════════════════════════════════════════════ */
export default function TeacherList() {
  const qc    = useQueryClient();
  const { toast } = useToast();
  const role  = useAuthStore(s => s.session?.user?.role ?? '');
  // Only privileged roles may edit or delete staff records.
  // can('teachers') is a module-level flag (true for every viewer including teachers)
  // so we gate write actions on explicit role membership instead.
  const canCreate   = ['admin', 'superadmin', 'principal', 'hr'].includes(role);
  const canDelete   = ['admin', 'superadmin', 'principal', 'hr'].includes(role);
  const canViewFull = ['admin', 'superadmin', 'principal', 'hr'].includes(role);

  const [search,       setSearch]       = useState('');
  const [debSearch,    setDebSearch]    = useState('');
  const [page,         setPage]         = useState(1);
  const [selected,     setSelected]     = useState(null);
  const [exporting,    setExporting]    = useState(false);
  const [showFilter,   setShowFilter]   = useState(false);
  const [departmentId, setDepartmentId] = useState('');
  const [classId,      setClassId]      = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const timer = useRef(null);

  const hasFilters = !!(departmentId || classId || statusFilter);

  async function handleExport() {
    setExporting(true);
    try { await importExport.exportCSV('teachers'); }
    catch (e) { toast.error(e?.message ?? 'Export failed.'); }
    finally { setExporting(false); }
  }

  function onSearch(v) {
    setSearch(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { setDebSearch(v); setPage(1); }, 350);
  }

  function clearFilters() {
    setDepartmentId(''); setClassId(''); setStatusFilter(''); setPage(1);
  }

  const { data: deptsData } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => deptsApi.list(),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    staleTime: 5 * 60_000,
    enabled: showFilter,
  });
  const departments = deptsData ?? [];

  const { data: clsData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 10 * 60_000,
    enabled: showFilter,
  });
  const classList = clsData?.data ?? [];

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['teachers', { page, search: debSearch, departmentId, classId, statusFilter }],
    queryFn:  () => teachersApi.list({
      page, limit: LIMIT,
      ...(debSearch    && { search: debSearch }),
      ...(departmentId && { departmentId }),
      ...(classId      && { classId }),
      ...(statusFilter && { status: statusFilter }),
    }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};

  const { mutate: remove, variables: removingId } = useMutation({
    mutationFn: id => teachersApi.remove(id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['teachers'] });
      toast.success('Staff member removed.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to remove staff member.'),
  });

  function confirmRemove(t) {
    if (!confirm(`Remove ${t.firstName} ${t.lastName}? This will set their status to inactive.`)) return;
    remove(t.id ?? t._id);
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-2xl mx-auto flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Teachers</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {isLoading ? 'Loading…' : `${(pagination.total ?? 0).toLocaleString()} staff members`}
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
            {canViewFull && (
              <button
                onClick={handleExport}
                disabled={exporting}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:border-slate-400 hover:text-slate-800 disabled:opacity-50 transition-colors"
                title="Export teachers to CSV"
              >
                {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Export
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-5 space-y-4">
        {/* Search row */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => onSearch(e.target.value)}
              placeholder="Search by name, email or staff ID…"
              className="w-full pl-9 pr-8 py-2.5 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400 transition"
            />
            {search && (
              <button onClick={() => { setSearch(''); setDebSearch(''); setPage(1); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={13} />
              </button>
            )}
          </div>
          {hasFilters && (
            <button onClick={clearFilters} className="text-xs font-medium text-slate-500 hover:text-slate-700 underline underline-offset-2 transition">
              Clear filters
            </button>
          )}
        </div>

        {/* Filter panel */}
        <AnimatePresence>
          {showFilter && (
            <motion.div
              initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="flex flex-wrap gap-4 p-4 bg-white rounded-xl border border-slate-200"
            >
              <div className="flex flex-col gap-1.5 min-w-[160px]">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Department</label>
                <select
                  value={departmentId}
                  onChange={e => { setDepartmentId(e.target.value); setPage(1); }}
                  className="text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700"
                >
                  <option value="">All departments</option>
                  {departments.map(d => (
                    <option key={d.id ?? d._id} value={d.id ?? d._id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 min-w-[160px]">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Class</label>
                <select
                  value={classId}
                  onChange={e => { setClassId(e.target.value); setPage(1); }}
                  className="text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700"
                >
                  <option value="">All classes</option>
                  {classList.map(c => (
                    <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5 min-w-[140px]">
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Status</label>
                <select
                  value={statusFilter}
                  onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
                  className="text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700"
                >
                  <option value="">All active</option>
                  <option value="active">Active</option>
                  {canViewFull && <option value="inactive">Inactive</option>}
                  {canViewFull && <option value="on_leave">On Leave</option>}
                  {canViewFull && <option value="terminated">Terminated</option>}
                </select>
              </div>
              {hasFilters && (
                <div className="flex items-end">
                  <button onClick={clearFilters} className="text-xs font-medium text-slate-500 hover:text-slate-700 px-3 py-2 rounded-lg hover:bg-slate-100 transition">
                    Clear filters
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {isFetching && !isLoading && (
            <div className="flex items-center gap-2 px-5 py-2 bg-violet-50 border-b border-violet-100 text-xs text-violet-700">
              <Loader2 size={12} className="animate-spin" /> Refreshing…
            </div>
          )}

          {isLoading ? (
            <div className="divide-y divide-slate-50">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-4 animate-pulse">
                  <div className="w-10 h-10 rounded-full bg-slate-100 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-slate-100 rounded w-36" />
                    <div className="h-2.5 bg-slate-100 rounded w-24" />
                  </div>
                  <div className="h-5 bg-slate-100 rounded w-16" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <AlertTriangle size={24} className="text-red-400" />
              <p className="text-sm text-slate-500">{error?.message ?? 'Failed to load teachers'}</p>
              <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
              <Users size={32} className="mb-2 opacity-40" />
              <p className="text-sm font-medium text-slate-600">No teachers found</p>
              {debSearch ? (
                <button onClick={() => { setSearch(''); setDebSearch(''); setPage(1); }} className="mt-3 text-xs font-medium text-violet-600 underline">
                  Clear search
                </button>
              ) : (
                <p className="mt-2 text-xs text-slate-400">To add staff, use the HR module</p>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left py-3 px-5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Teacher</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Staff ID</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Subjects</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Contract</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rows.map(t => {
                  const id  = t.id ?? t._id;
                  const av  = avatarColor(`${t.firstName}${t.lastName}`);
                  const sts = STATUS_BADGE[t.status] ?? STATUS_BADGE.inactive;
                  const removing = removingId === id;
                  return (
                    <tr key={id} onClick={() => setSelected(t)} className={`hover:bg-slate-50 transition group cursor-pointer ${removing ? 'opacity-40 pointer-events-none' : ''}`}>
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${av} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                            {initials(t.firstName, t.lastName)}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-slate-800 truncate">
                              {t.title ? `${t.title} ` : ''}{t.firstName} {t.lastName}
                            </p>
                            {t.email && <p className="text-xs text-slate-400 truncate">{t.email}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 hidden sm:table-cell">
                        <span className="font-mono text-xs text-slate-500">{t.staffId ?? '—'}</span>
                      </td>
                      <td className="py-3.5 px-4 hidden md:table-cell">
                        {(t.subjects ?? []).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {t.subjects.slice(0, 3).map((s, i) => (
                              <span key={i} className="text-[11px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-medium">{s}</span>
                            ))}
                            {t.subjects.length > 3 && (
                              <span className="text-[11px] text-slate-400">+{t.subjects.length - 3}</span>
                            )}
                          </div>
                        ) : <span className="text-slate-400 text-xs">—</span>}
                      </td>
                      <td className="py-3.5 px-4 hidden lg:table-cell text-xs text-slate-500 capitalize">
                        {CONTRACT_LABELS[t.contractType] ?? t.contractType ?? '—'}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full capitalize ${sts}`}>
                          {t.status?.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                          <button onClick={e => { e.stopPropagation(); setSelected(t); }} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition" title="View details">
                            <Eye size={14} />
                          </button>
                          {canDelete && (
                            <button onClick={e => { e.stopPropagation(); confirmRemove(t); }} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition" title="Remove">
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

        <Pagination page={page} totalPages={pagination.pages ?? 1} total={pagination.total ?? 0} limit={LIMIT} onPage={setPage} />
      </div>

      <AnimatePresence>
        {selected && (
          <TeacherDetailSlideOver
            teacher={selected}
            canEdit={canCreate}
            onClose={() => setSelected(null)}
            onUpdated={updated => {
              setSelected(updated);
              qc.invalidateQueries({ queryKey: ['teachers'] });
            }}
            onRemove={t => { setSelected(null); confirmRemove(t); }}
            canDelete={canDelete}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const EXTRA_ROLE_LABELS = {
  hod:          'Head of Department',
  class_teacher:'Class Teacher',
  timetabler:   'Timetabler',
  exam_officer: 'Exam Officer',
  deputy:       'Deputy Principal',
  principal:    'Principal',
};

/* ── Teacher Detail / Edit Slide-Over ────────────────────── */
function TeacherDetailSlideOver({ teacher: initialTeacher, canEdit, canDelete, onClose, onUpdated, onRemove }) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState('profile');
  const [editing, setEditing]   = useState(false);
  const [teacher, setTeacher]   = useState(initialTeacher);
  const [form, setForm]         = useState(null);
  const [subjectSearch, setSubjectSearch] = useState('');
  const [errors, setErrors]     = useState({});

  const viewerRole = useAuthStore(s => s.session?.user?.role ?? '');
  const canViewFull = ['admin', 'superadmin', 'principal', 'hr'].includes(viewerRole);

  const { data: deptsRaw } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => deptsApi.list(),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    staleTime: 5 * 60_000,
  });
  const allDepts = deptsRaw ?? [];
  const deptName = allDepts.find(d => (d.id ?? d._id) === teacher.departmentId)?.name ?? null;

  const { data: subsRaw } = useQuery({
    queryKey: ['subjects', 'all'],
    queryFn:  () => subjectsApi.list({ limit: 300 }),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    staleTime: 10 * 60_000,
  });
  const allSubjects = subsRaw ?? [];

  const av = avatarColor(`${teacher.firstName}${teacher.lastName}`);
  const sts = STATUS_BADGE[teacher.status] ?? STATUS_BADGE.inactive;

  const updateMutation = useMutation({
    mutationFn: data => teachersApi.update(teacher.id ?? teacher._id, data),
    onSuccess: updated => {
      const merged = { ...teacher, ...updated };
      setTeacher(merged);
      onUpdated(merged);
      setEditing(false);
    },
    onError: err => setErrors({ _server: err?.message ?? 'Failed to update' }),
  });

  function startEdit() {
    setForm({
      _v:           teacher._v          ?? undefined,  // carry version for optimistic lock
      firstName:    teacher.firstName   ?? '',
      lastName:     teacher.lastName    ?? '',
      middleName:   teacher.middleName  ?? '',
      title:        teacher.title       ?? '',
      email:        teacher.email       ?? '',
      phone:        teacher.phone       ?? '',
      gender:       teacher.gender      ?? '',
      dateOfBirth:  teacher.dateOfBirth ? teacher.dateOfBirth.slice(0,10) : '',
      qualifications: teacher.qualifications ?? '',
      subjects:     teacher.subjectIds   ?? teacher.subjects ?? [],
      contractType: teacher.contractType ?? 'full_time',
      status:       teacher.status      ?? 'active',
      joinDate:     teacher.joinDate    ? teacher.joinDate.slice(0,10) : '',
      address:      teacher.address     ?? '',
      departmentId: teacher.departmentId ?? '',
    });
    setErrors({});
    setEditing(true);
  }

  function setF(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => { const n = {...e}; delete n[field]; return n; });
  }

  function toggleSubject(id) {
    setF('subjects', form.subjects.includes(id)
      ? form.subjects.filter(s => s !== id)
      : [...form.subjects, id]
    );
  }

  function save() {
    const e = {};
    if (!form.firstName.trim()) e.firstName = 'Required';
    if (!form.lastName.trim())  e.lastName  = 'Required';
    if (!form.email.trim())     e.email     = 'Required';
    if (Object.keys(e).length)  { setErrors(e); return; }
    updateMutation.mutate(form);
  }

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '—';

  return (
    <>
      <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x:'100%' }} animate={{ x:0 }} exit={{ x:'100%' }}
        transition={{ type:'spring', damping:30, stiffness:300 }}
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${av} flex items-center justify-center text-white text-lg font-bold shrink-0 shadow-sm`}>
                {initials(teacher.firstName, teacher.lastName)}
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {teacher.title ? `${teacher.title} ` : ''}{teacher.firstName} {teacher.middleName ? `${teacher.middleName} ` : ''}{teacher.lastName}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  {teacher.staffId && <span className="font-mono text-[11px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{teacher.staffId}</span>}
                  <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full capitalize ${sts}`}>
                    {teacher.status?.replace('_',' ') ?? 'active'}
                  </span>
                </div>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition mt-0.5">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 px-6 gap-1">
          {[
            { id: 'profile',     label: 'Profile',     Icon: Briefcase    },
            { id: 'assignments', label: 'Assignments', Icon: ClipboardList },
          ].map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => { setActiveTab(id); setEditing(false); }}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition ${
                activeTab === id
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={11} />
              {label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'assignments' ? (
            <TeacherAssignmentsTab teacher={teacher} canEdit={canEdit} />
          ) : !editing ? (
            /* View mode */
            <div className="px-6 py-5 space-y-6">
              {/* Contract summary chips — only shown to roles with full data access */}
              {canViewFull && (
                <div className="flex flex-wrap gap-2">
                  {teacher.contractType && (
                    <span className="flex items-center gap-1.5 text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full">
                      <Briefcase size={11} />
                      {CONTRACT_LABELS[teacher.contractType] ?? teacher.contractType}
                    </span>
                  )}
                  {teacher.joinDate && (
                    <span className="flex items-center gap-1.5 text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full">
                      <Calendar size={11} />
                      Joined {fmtDate(teacher.joinDate)}
                    </span>
                  )}
                  {teacher.gender && (
                    <span className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full capitalize">
                      {teacher.gender.replace('_',' ')}
                    </span>
                  )}
                </div>
              )}

              {/* Department + Extra Roles */}
              {(deptName || (teacher.extraRoles ?? []).length > 0) && (
                <div className="flex flex-wrap gap-2">
                  {deptName && (
                    <span className="flex items-center gap-1.5 text-xs bg-violet-50 text-violet-700 px-3 py-1.5 rounded-full font-medium ring-1 ring-violet-200">
                      {teacher.extraRoles?.includes('hod') ? `HOD · ${deptName}` : deptName}
                    </span>
                  )}
                  {(teacher.extraRoles ?? [])
                    .filter(r => !(r === 'hod' && deptName))
                    .map(r => (
                      <span key={r} className="text-xs bg-slate-100 text-slate-600 px-3 py-1.5 rounded-full">
                        {EXTRA_ROLE_LABELS[r] ?? r}
                      </span>
                    ))}
                </div>
              )}

              {/* Contact — visible only to roles with full data access */}
              {canViewFull && (teacher.email || teacher.phone || teacher.address) && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Contact</p>
                  <div className="space-y-2">
                    {teacher.email && (
                      <div className="flex items-center gap-3 text-sm">
                        <Mail size={13} className="text-slate-400 shrink-0" />
                        <a href={`mailto:${teacher.email}`} className="text-violet-600 hover:underline truncate">{teacher.email}</a>
                      </div>
                    )}
                    {teacher.phone && (
                      <div className="flex items-center gap-3 text-sm">
                        <Phone size={13} className="text-slate-400 shrink-0" />
                        <span className="text-slate-700">{teacher.phone}</span>
                      </div>
                    )}
                    {teacher.address && (
                      <div className="flex items-start gap-3 text-sm">
                        <MapPin size={13} className="text-slate-400 shrink-0 mt-0.5" />
                        <span className="text-slate-700">{teacher.address}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Subjects */}
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Subjects Taught</p>
                {(teacher.subjects ?? []).length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {teacher.subjects.map((s, i) => (
                      <span key={i} className="text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-medium">{s}</span>
                    ))}
                  </div>
                ) : <p className="text-sm text-slate-400">No subjects listed</p>}
              </div>

              {/* Qualifications */}
              {teacher.qualifications && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-3">Qualifications</p>
                  <div className="flex items-start gap-2">
                    <Award size={13} className="text-slate-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{teacher.qualifications}</p>
                  </div>
                </div>
              )}

              {/* DOB — visible only to roles with full data access */}
              {canViewFull && teacher.dateOfBirth && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">Date of Birth</p>
                  <p className="text-sm text-slate-700">{fmtDate(teacher.dateOfBirth)}</p>
                </div>
              )}
            </div>
          ) : (
            /* Edit mode */
            <div className="px-6 py-5 space-y-5">
              {errors._server && (
                <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
                  <AlertTriangle size={14} className="shrink-0" />{errors._server}
                </div>
              )}

              <DSection label="Personal">
                <div className="grid grid-cols-3 gap-3">
                  <DField label="Title">
                    <select value={form.title} onChange={e => setF('title', e.target.value)} className={dCls()}>
                      <option value="">—</option>
                      {['Mr','Mrs','Ms','Miss','Dr','Prof'].map(t => <option key={t}>{t}</option>)}
                    </select>
                  </DField>
                  <DField label="First Name *" error={errors.firstName}>
                    <input value={form.firstName} onChange={e => setF('firstName', e.target.value)} className={dCls(errors.firstName)} />
                  </DField>
                  <DField label="Last Name *" error={errors.lastName}>
                    <input value={form.lastName} onChange={e => setF('lastName', e.target.value)} className={dCls(errors.lastName)} />
                  </DField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <DField label="Gender">
                    <select value={form.gender} onChange={e => setF('gender', e.target.value)} className={dCls()}>
                      <option value="">Select…</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                      <option value="prefer_not_to_say">Prefer not to say</option>
                    </select>
                  </DField>
                  <DField label="Date of Birth">
                    <input type="date" value={form.dateOfBirth} onChange={e => setF('dateOfBirth', e.target.value)} className={dCls()} />
                  </DField>
                </div>
              </DSection>

              <DSection label="Contact">
                <DField label="Email *" error={errors.email}>
                  <input type="email" value={form.email} onChange={e => setF('email', e.target.value)} className={dCls(errors.email)} />
                </DField>
                <div className="grid grid-cols-2 gap-3">
                  <DField label="Phone">
                    <input value={form.phone} onChange={e => setF('phone', e.target.value)} placeholder="+254 …" className={dCls()} />
                  </DField>
                  <DField label="Join Date">
                    <input type="date" value={form.joinDate} onChange={e => setF('joinDate', e.target.value)} className={dCls()} />
                  </DField>
                </div>
                <DField label="Address">
                  <input value={form.address} onChange={e => setF('address', e.target.value)} placeholder="Physical address…" className={dCls()} />
                </DField>
              </DSection>

              <DSection label="Role">
                <div className="grid grid-cols-2 gap-3">
                  <DField label="Contract Type">
                    <select value={form.contractType} onChange={e => setF('contractType', e.target.value)} className={dCls()}>
                      <option value="full_time">Full-time</option>
                      <option value="part_time">Part-time</option>
                      <option value="supply">Supply</option>
                      <option value="volunteer">Volunteer</option>
                    </select>
                  </DField>
                  <DField label="Status">
                    <select value={form.status} onChange={e => setF('status', e.target.value)} className={dCls()}>
                      <option value="active">Active</option>
                      <option value="on_leave">On Leave</option>
                      <option value="inactive">Inactive</option>
                      <option value="terminated">Terminated</option>
                    </select>
                  </DField>
                </div>
                <DField label="Department">
                  <select value={form.departmentId} onChange={e => setF('departmentId', e.target.value)} className={dCls()}>
                    <option value="">— No department —</option>
                    {allDepts.map(d => (
                      <option key={d.id ?? d._id} value={d.id ?? d._id}>{d.name}</option>
                    ))}
                  </select>
                </DField>
                <DField label="Qualifications">
                  <textarea value={form.qualifications} onChange={e => setF('qualifications', e.target.value)} rows={2} placeholder="Degrees, certificates…" className={`${dCls()} resize-none`} />
                </DField>
                <DField label="Subjects Taught">
                  {allSubjects.length > 0 ? (
                    <>
                      <input
                        value={subjectSearch}
                        onChange={e => setSubjectSearch(e.target.value)}
                        placeholder="Filter subjects…"
                        className={`${dCls()} mb-1.5`}
                      />
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                        {allSubjects
                          .filter(s => !subjectSearch || s.name.toLowerCase().includes(subjectSearch.toLowerCase()))
                          .map(s => (
                            <label key={s.id ?? s._id}
                              className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition select-none ${
                                form.subjects.includes(s.id ?? s._id) ? 'bg-indigo-50' : 'hover:bg-slate-50'
                              }`}>
                              <input
                                type="checkbox"
                                checked={form.subjects.includes(s.id ?? s._id)}
                                onChange={() => toggleSubject(s.id ?? s._id)}
                                className="accent-indigo-600 shrink-0"
                              />
                              <span className="text-sm text-slate-700">{s.name}</span>
                            </label>
                          ))}
                      </div>
                      {form.subjects.length > 0 && (
                        <p className="text-[11px] text-slate-500 mt-1.5">{form.subjects.length} subject{form.subjects.length !== 1 ? 's' : ''} selected</p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-400 py-2">No subjects configured — add subjects in the Subjects module first.</p>
                  )}
                </DField>
              </DSection>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          {activeTab === 'assignments' ? (
            <div className="flex w-full justify-end">
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition">Close</button>
            </div>
          ) : !editing ? (
            <>
              <div className="flex gap-2">
                {canDelete && (
                  <button onClick={() => onRemove(teacher)} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition">
                    <Trash2 size={12} /> Remove
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition">Close</button>
                {canEdit && (
                  <button onClick={startEdit} className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
                    <Edit2 size={13} /> Edit
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition">Cancel</button>
              <button
                onClick={save}
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
              >
                {updateMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </>
  );
}

/* ── Teaching Assignments Tab ────────────────────────────── */
function TeacherAssignmentsTab({ teacher, canEdit }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const teacherId = teacher.userId ?? teacher.id ?? teacher._id;

  const [showAdd, setShowAdd] = useState(false);
  const [af, setAf]           = useState({ classId: '', subjectId: '', preferredRoomId: '', periodsPerWeek: '' });
  const [afErr, setAfErr]     = useState({});

  /* ── Fetch assignments for this teacher ─── */
  const { data: aData, isLoading: loadingA } = useQuery({
    queryKey: ['teaching-assignments', { teacherId }],
    queryFn:  () => assignmentsApi.list({ teacherId }),
    staleTime: 60_000,
  });
  const assignments = aData?.data ?? [];

  /* ── Fetch class list (only when add form is open) ─── */
  const { data: clsData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60_000,
    enabled: showAdd,
  });
  const classList = clsData?.data ?? [];

  /* ── Fetch subjects for the selected class ─── */
  const { data: sData } = useQuery({
    queryKey: ['class-subjects', af.classId],
    queryFn:  () => classSubjects.list({ classId: af.classId }),
    staleTime: 60_000,
    enabled: showAdd && !!af.classId,
  });
  const subjectList = sData?.data ?? [];

  /* ── Fetch rooms (only when add form is open) ─── */
  const { data: rData } = useQuery({
    queryKey: ['rooms'],
    queryFn:  () => roomsApi.list(),
    staleTime: 5 * 60_000,
    enabled: showAdd,
  });
  const roomList = rData?.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['teaching-assignments', { teacherId }] });

  const createMut = useMutation({
    mutationFn: data => assignmentsApi.create(data),
    onSuccess:  () => {
      invalidate();
      setShowAdd(false);
      setAf({ classId: '', subjectId: '', preferredRoomId: '', periodsPerWeek: '' });
      setAfErr({});
      toast.success('Assignment added.');
    },
    onError: err => setAfErr({ _s: err?.message ?? 'Failed to add assignment' }),
  });

  const removeMut = useMutation({
    mutationFn: id => assignmentsApi.remove(id),
    onSuccess:  () => { invalidate(); toast.success('Assignment removed.'); },
    onError:    err => toast.error(err?.message ?? 'Failed to remove assignment.'),
  });

  function setField(k, v) {
    setAf(f => {
      const n = { ...f, [k]: v };
      if (k === 'classId') n.subjectId = ''; // reset subject when class changes
      return n;
    });
    setAfErr(e => { const n = { ...e }; delete n[k]; delete n._s; return n; });
  }

  function submitAdd() {
    const e = {};
    if (!af.classId)   e.classId   = 'Select a class';
    if (!af.subjectId) e.subjectId = 'Select a subject';
    if (Object.keys(e).length) { setAfErr(e); return; }
    createMut.mutate({
      teacherId,
      classId:   af.classId,
      subjectId: af.subjectId,
      ...(af.preferredRoomId  ? { preferredRoomId:  af.preferredRoomId }          : {}),
      ...(af.periodsPerWeek   ? { periodsPerWeek:   Number(af.periodsPerWeek) }   : {}),
    });
  }

  const fCls = (err) =>
    `w-full text-sm px-3 py-2 rounded-lg border ${err ? 'border-red-300' : 'border-slate-200'} bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10`;

  return (
    <div className="px-6 py-5 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {loadingA ? '…' : `${assignments.length} assignment${assignments.length !== 1 ? 's' : ''}`} configured
        </p>
        {canEdit && !showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 text-xs font-medium bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-lg transition"
          >
            <Plus size={11} /> Add assignment
          </button>
        )}
      </div>

      {/* Add form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-xl"
          >
            {afErr._s && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                <AlertTriangle size={11} className="shrink-0" />{afErr._s}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {/* Class picker */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Class *</label>
                <select value={af.classId} onChange={e => setField('classId', e.target.value)} className={`mt-1 ${fCls(afErr.classId)}`}>
                  <option value="">Select class…</option>
                  {classList.map(c => (
                    <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>
                  ))}
                </select>
                {afErr.classId && <p className="text-[10px] text-red-500 mt-0.5">{afErr.classId}</p>}
              </div>

              {/* Subject picker — populated from class curriculum */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Subject *</label>
                <select
                  value={af.subjectId}
                  onChange={e => setField('subjectId', e.target.value)}
                  disabled={!af.classId}
                  className={`mt-1 ${fCls(afErr.subjectId)} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <option value="">{af.classId ? 'Select subject…' : 'Choose class first'}</option>
                  {subjectList.map(cs => (
                    <option key={cs.subjectId} value={cs.subjectId}>
                      {cs.subject?.name ?? cs.subjectId}
                    </option>
                  ))}
                </select>
                {afErr.subjectId && <p className="text-[10px] text-red-500 mt-0.5">{afErr.subjectId}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Room picker */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Preferred Room</label>
                <select value={af.preferredRoomId} onChange={e => setField('preferredRoomId', e.target.value)} className={`mt-1 ${fCls()}`}>
                  <option value="">None</option>
                  {roomList.map(r => (
                    <option key={r._id ?? r.id} value={r._id ?? r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              {/* Periods per week */}
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Periods / Week</label>
                <input
                  type="number" min="1" max="40"
                  value={af.periodsPerWeek}
                  onChange={e => setField('periodsPerWeek', e.target.value)}
                  placeholder="e.g. 5"
                  className={`mt-1 ${fCls()}`}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => { setShowAdd(false); setAfErr({}); }}
                className="text-xs font-medium text-slate-600 hover:text-slate-800 px-3 py-1.5 transition"
              >
                Cancel
              </button>
              <button
                onClick={submitAdd}
                disabled={createMut.isPending}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition"
              >
                {createMut.isPending ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                {createMut.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Assignments list */}
      {loadingA ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : assignments.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <ClipboardList size={28} className="text-slate-200" />
          <p className="text-sm font-medium text-slate-400">No assignments configured</p>
          <p className="text-xs text-slate-400 max-w-[220px] leading-relaxed">
            Assignments link this teacher to a subject and class so the timetable can auto-fill their details
          </p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-50">
          {assignments.map(a => (
            <div key={a._id ?? a.id} className="flex items-center gap-3 px-4 py-3 group hover:bg-slate-50 transition">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{a.subjectName ?? a.subjectId}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                  <span className="text-[10px] text-slate-500">
                    <span className="font-medium">Class:</span> {a.className ?? a.classId}
                  </span>
                  {a.preferredRoomName && (
                    <span className="text-[10px] text-slate-400">· Room: {a.preferredRoomName}</span>
                  )}
                  {a.periodsPerWeek && (
                    <span className="text-[10px] text-slate-400">· {a.periodsPerWeek} periods/wk</span>
                  )}
                </div>
              </div>
              {canEdit && (
                <button
                  onClick={() => removeMut.mutate(a.id ?? a._id)}
                  disabled={removeMut.isPending}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-30"
                  title="Remove assignment"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-400 leading-relaxed">
        Assignments tell the timetable who teaches what. When you create a slot for this class + subject, the teacher and preferred room are auto-filled.
      </p>
    </div>
  );
}

function DSection({ label, children }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
function DField({ label, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-700">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
function dCls(error) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${error ? 'border-red-300' : 'border-slate-200 focus:border-slate-400'} bg-white focus:outline-none focus:ring-2 ${error ? 'focus:ring-red-500/20' : 'focus:ring-slate-900/10'} text-slate-800 placeholder-slate-400 transition`;
}

