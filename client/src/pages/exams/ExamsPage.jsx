/* ============================================================
   Exams & Assessment — v4.34.0
   - 4 tabs: Exams · Markbook · Grade Report · Configuration (admin)
   - Markbook: schedule-driven unified mark entry (replaces Results + CA Marks)
   - Teacher scoped to own classes/subjects via teaching_assignments
   - Schedule entries colour-coded active/upcoming/past
   ============================================================ */
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, BarChart3, ClipboardList, Plus, X, Loader2,
  CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight,
  Search, Save, Check, TrendingUp, PenLine, Bell,
  Award, Users2, GraduationCap, Filter, Percent, Settings,
  Tag, Layers, Info, Trash2, BookOpen, ClipboardPaste, Lock,
  BookMarked,
} from 'lucide-react';
import {
  exams as examsApi,
  classes as classesApi,
  academicConfig as academicConfigApi,
  subjects as subjectsApi,
  assessment as assessmentApi,
  teachingAssignments as taApi,
} from '@/api/client.js';
import RemindersTab   from '../grades/components/RemindersTab.jsx';
import ReportCardsTab from '../grades/components/ReportCardsTab.jsx';
import CAConfigTab    from '../grades/components/ConfigTab.jsx';
import { TypePill, Toast } from '../grades/components/GradesPrimitives.jsx';
import { DEFAULT_CUSTOM_TYPES, _pct, _scoreColor } from '../grades/constants.js';
import useAuthStore from '@/store/auth.js';

const LIMIT = 20;

/* ══════════════════════════════════════════════════════════════ */
export default function ExamsPage() {
  const [tab, setTab] = useState('exams');
  const role = useAuthStore(s => s.session?.user?.role ?? '');
  const canCreate = ['admin', 'superadmin', 'deputy_principal', 'exams_officer'].includes(role);

  const TABS = [
    { id: 'exams',     label: 'Exams',         icon: FileText,    adminOnly: false },
    { id: 'markbook',  label: 'Markbook',       icon: BookMarked,  adminOnly: false },
    { id: 'report',    label: 'Grade Report',   icon: BarChart3,   adminOnly: false },
    { id: 'reminders', label: 'Reminders',      icon: Bell,        adminOnly: false },
    { id: 'config',    label: 'Configuration',  icon: Settings,    adminOnly: true  },
  ].filter(t => !t.adminOnly || canCreate);

  /* ── Shared data loaded once at page level ── */
  const { data: yearsRaw } = useQuery({
    queryKey: ['academic-config', 'years'],
    queryFn:  academicConfigApi.years.list,
    staleTime: 10 * 60_000,
  });
  const years = yearsRaw?.data ?? yearsRaw ?? [];

  const { data: acfgRaw } = useQuery({
    queryKey: ['academic-config', 'main'],
    queryFn:  academicConfigApi.get,
    staleTime: 10 * 60_000,
  });
  /* Fallback defaults if not yet configured */
  const assessmentWeights = acfgRaw?.data?.assessmentWeights
    ?? acfgRaw?.assessmentWeights
    ?? [
      { assessmentType: 'classwork', label: 'Classwork / CAT', weight: 20 },
      { assessmentType: 'midterm',   label: 'Mid-Term Exam',   weight: 30 },
      { assessmentType: 'final',     label: 'End-Term Exam',   weight: 50 },
    ];

  const { data: subjectsRaw } = useQuery({
    queryKey: ['subjects', 'all'],
    queryFn:  () => subjectsApi.list({ limit: 500 }),
    staleTime: 10 * 60_000,
  });
  const subjectsList = subjectsRaw?.data ?? [];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Warm gradient header ── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-indigo-700 to-violet-800 px-6 pt-5 pb-0">
        <div className="pointer-events-none absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute top-4 right-36 w-28 h-28 rounded-full bg-white/5" />
        <div className="max-w-screen-xl mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center shrink-0">
                <GraduationCap size={20} className="text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-lg font-bold text-white leading-tight">Exams & Assessment</h1>
                  {assessmentWeights.length > 0 && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-[10px] font-semibold bg-white/20 text-white px-2 py-0.5 rounded-full border border-white/30">
                      <Layers size={9} /> {assessmentWeights.length} types configured
                    </span>
                  )}
                </div>
                <p className="text-blue-100 text-xs mt-0.5">Schedule exams, enter results and generate grade reports</p>
              </div>
            </div>
          </div>

          {/* ── Tab bar ── */}
          <div className="flex gap-0.5 mt-5">
            {TABS.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition rounded-t-lg ${
                    active
                      ? 'bg-white text-indigo-700 shadow-sm'
                      : 'text-white/90 hover:text-white hover:bg-white/15'
                  }`}
                >
                  <Icon size={13} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-5">
        <AnimatePresence mode="wait">
          {tab === 'exams' && (
            <ExamsTab
              key="exams"
              years={years}
              assessmentWeights={assessmentWeights}
              subjectsList={subjectsList}
              canCreate={canCreate}
            />
          )}
          {tab === 'markbook' && (
            <MarkbookTab key="markbook" years={years} />
          )}
          {tab === 'report' && (
            <motion.div key="report" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              <ReportCardsTab />
            </motion.div>
          )}
          {tab === 'reminders' && (
            <motion.div key="reminders" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              <RemindersTab />
            </motion.div>
          )}
          {tab === 'config' && canCreate && (
            <motion.div key="config" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-6">
              <CAConfigTab />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Status badge ────────────────────────────────────────────── */
const STATUS_CFG = {
  draft:       { label: 'Draft',       cls: 'bg-slate-100 text-slate-600 border-slate-200'      },
  scheduled:   { label: 'Scheduled',   cls: 'bg-blue-50   text-blue-700  border-blue-200'       },
  in_progress: { label: 'In Progress', cls: 'bg-amber-50  text-amber-700 border-amber-200'      },
  active:      { label: 'Active',      cls: 'bg-violet-50 text-violet-700 border-violet-200'    },
  completed:   { label: 'Completed',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  moderated:   { label: 'Moderated',   cls: 'bg-indigo-50 text-indigo-700 border-indigo-200'   },
  approved:    { label: 'Approved',    cls: 'bg-teal-50   text-teal-700  border-teal-200'       },
  locked:      { label: 'Locked',      cls: 'bg-slate-100 text-slate-700 border-slate-300'      },
  published:   { label: 'Published',   cls: 'bg-green-50  text-green-700 border-green-200'      },
  archived:    { label: 'Archived',    cls: 'bg-slate-50  text-slate-500 border-slate-200'      },
  cancelled:   { label: 'Cancelled',   cls: 'bg-red-50    text-red-700   border-red-200'        },
};
function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.draft;
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.cls}`}>{cfg.label}</span>;
}

/* ── Assessment type chip ─────────────────────────────────────── */
function TypeChip({ label }) {
  if (!label) return <span className="text-slate-400 text-xs">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
      <Tag size={9} />{label}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════
   EXAMS TAB
   ══════════════════════════════════════════════════════════════ */
function ExamsTab({ years, assessmentWeights, subjectsList, canCreate }) {
  const qc = useQueryClient();
  const role = useAuthStore(s => s.session?.user?.role ?? '');
  const isTeacher = role === 'teacher';

  const [page, setPage]   = useState(1);
  const [search, setSearch] = useState('');
  const [showAdd,      setShowAdd]      = useState(false);
  const [showAnnounce, setShowAnnounce] = useState(false);

  const [filterYearId, setFilterYearId]               = useState('');
  const [filterTermLabel, setFilterTermLabel]           = useState('');
  const [filterAssessmentType, setFilterAssessmentType] = useState('');

  const selectedYear = years.find(y => (y.id ?? y._id?.toString()) === filterYearId);
  const yearTerms    = selectedYear?.terms ?? [];

  function onYearChange(v) { setFilterYearId(v); setFilterTermLabel(''); setPage(1); }

  const queryParams = useMemo(() => ({
    page, limit: LIMIT,
    search:         search             || undefined,
    academicYearId: filterYearId       || undefined,
    termLabel:      filterTermLabel    || undefined,
    assessmentType: filterAssessmentType || undefined,
  }), [page, search, filterYearId, filterTermLabel, filterAssessmentType]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['exams', 'list', queryParams],
    queryFn:  () => examsApi.list(queryParams),
    placeholderData: prev => prev,
  });
  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};
  const totalPages = pagination.pages  ?? 1;
  const total      = pagination.total  ?? rows.length;

  const hasFilters = !!(filterYearId || filterTermLabel || filterAssessmentType || search);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">

      {/* ── Filter panel ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={13} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Filter Exams</span>
          {hasFilters && (
            <button
              onClick={() => { setFilterYearId(''); setFilterTermLabel(''); setFilterAssessmentType(''); setSearch(''); setPage(1); }}
              className="ml-auto text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Clear all
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Year */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Academic Year</label>
            <select
              value={filterYearId}
              onChange={e => onYearChange(e.target.value)}
              className={selCls}
            >
              <option value="">All years</option>
              {years.map(y => (
                <option key={y.id ?? y._id} value={y.id ?? y._id}>
                  {y.name}{y.isCurrent ? ' ★' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Term */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Term</label>
            <select
              value={filterTermLabel}
              onChange={e => { setFilterTermLabel(e.target.value); setPage(1); }}
              disabled={!filterYearId || yearTerms.length === 0}
              className={`${selCls} disabled:opacity-50`}
            >
              <option value="">All terms</option>
              {yearTerms.map((t, i) => (
                <option key={t.id ?? i} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Assessment Type */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Assessment Type</label>
            <select
              value={filterAssessmentType}
              onChange={e => { setFilterAssessmentType(e.target.value); setPage(1); }}
              className={selCls}
            >
              <option value="">All types</option>
              {assessmentWeights.map((w, i) => (
                <option key={i} value={w.assessmentType}>{w.label} ({w.weight}%)</option>
              ))}
            </select>
          </div>

          {/* Search */}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Search</label>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search exams…"
                className="w-full text-sm pl-7 pr-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 placeholder-slate-400"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Action bar ── */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {hasFilters
            ? `${total} exam${total !== 1 ? 's' : ''} match filters`
            : `${total} total exam${total !== 1 ? 's' : ''}`}
        </p>
        <div className="flex items-center gap-2">
          {isTeacher && (
            <button
              onClick={() => setShowAnnounce(true)}
              className="flex items-center gap-1.5 bg-violet-700 hover:bg-violet-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <PenLine size={14} />
              Announce Sitting
            </button>
          )}
          {canCreate && (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-1.5 bg-indigo-700 hover:bg-indigo-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              <Plus size={14} />
              Create Exam
            </button>
          )}
        </div>
      </div>

      {/* ── Table ── */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-14 animate-pulse" />)}
        </div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg
          icon={<GraduationCap size={36} />}
          title={hasFilters ? 'No exams match these filters' : 'No exams yet'}
          subtitle={
            hasFilters
              ? 'Try adjusting or clearing the filters above'
              : canCreate
                ? 'Click "Create Exam" to schedule the first assessment'
                : 'Exams will appear here once created by an admin'
          }
        />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Exam</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Class</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Max</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(e => (
                <tr key={e._id ?? e.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{e.title}</p>
                    {e.termLabel && <p className="text-[11px] text-slate-400 mt-0.5">{e.termLabel}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">
                    {e.subjectName ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{e.className ?? '—'}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <TypeChip label={e.assessmentLabel ?? null} />
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={e.status} /></td>
                  <td className="px-4 py-3 text-right text-slate-500 hidden lg:table-cell">{e.maxScore ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">
                    {e.date ? new Date(e.date).toLocaleDateString('en-GB') : '—'}
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
          <CreateExamSlideOver
            years={years}
            assessmentWeights={assessmentWeights}
            subjectsList={subjectsList}
            onClose={() => setShowAdd(false)}
            onCreated={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['exams'] }); }}
          />
        )}
        {showAnnounce && (
          <AnnounceSittingSlideOver
            onClose={() => setShowAnnounce(false)}
            onCreated={() => { setShowAnnounce(false); qc.invalidateQueries({ queryKey: ['exams'] }); }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MARKBOOK TAB
   Unified mark entry: Class → Subject → Assessment (from schedule) → Grid
   ══════════════════════════════════════════════════════════════ */

/* ─── Grid cell ─────────────────────────────────────────────── */
function GridCell({ value, rowIdx, colIdx, isLocked, onChange, onNavigate, cellRef }) {
  return (
    <input
      ref={cellRef}
      type="number" min="0" max="100" step="0.5"
      disabled={isLocked}
      value={value ?? ''}
      onChange={e => {
        const v = e.target.value === '' ? undefined : Number(e.target.value);
        if (v === undefined || (v >= 0 && v <= 100)) onChange(v);
      }}
      onKeyDown={e => {
        if (e.key === 'Tab')        { e.preventDefault(); onNavigate(rowIdx, colIdx, e.shiftKey ? -1 : 1, 0); }
        else if (e.key === 'Enter') { e.preventDefault(); onNavigate(rowIdx, colIdx, 0, 1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); onNavigate(rowIdx, colIdx, 1, 0); }
        else if (e.key === 'ArrowLeft')  { e.preventDefault(); onNavigate(rowIdx, colIdx, -1, 0); }
        else if (e.key === 'ArrowDown')  { e.preventDefault(); onNavigate(rowIdx, colIdx, 0, 1); }
        else if (e.key === 'ArrowUp')    { e.preventDefault(); onNavigate(rowIdx, colIdx, 0, -1); }
      }}
      className={`w-full rounded border px-2 py-1 text-right text-sm tabular-nums focus:outline-none transition
        ${isLocked
          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
          : value == null
            ? 'border-slate-200 bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-900/10'
            : value >= 50
              ? 'border-emerald-200 bg-emerald-50/40 focus:border-emerald-400'
              : 'border-red-200 bg-red-50/40 focus:border-red-400'
        }`}
      placeholder="—"
    />
  );
}

/* ─── Schedule entry status ─────────────────────────────────── */
function entryStatus(entry) {
  const today = new Date().toISOString().slice(0, 10);
  if (!entry) return 'unknown';
  if (today < entry.dateFrom) return 'upcoming';
  if (today > entry.dateTo)   return 'past';
  return 'active';
}

const SCHED_BADGE = {
  active:   { cls: 'bg-emerald-100 text-emerald-700 border border-emerald-200', label: 'Active window'  },
  upcoming: { cls: 'bg-blue-100 text-blue-700 border border-blue-200',          label: 'Upcoming'       },
  past:     { cls: 'bg-amber-100 text-amber-700 border border-amber-200',       label: 'Past deadline'  },
  unknown:  { cls: 'bg-slate-100 text-slate-500 border border-slate-200',       label: ''               },
};

function MarkbookTab({ years }) {
  const qc        = useQueryClient();
  const role      = useAuthStore(s => s.session?.user?.role ?? '');
  const isTeacher = role === 'teacher';

  const [yearId,     setYearId]     = useState('');
  const [termNumber, setTermNumber] = useState('');
  const [classId,    setClassId]    = useState('');
  const [subjectId,  setSubjectId]  = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [scores,     setScores]     = useState({});
  const [dirty,      setDirty]      = useState(false);
  const [toast,      setToast]      = useState(null);
  const cellRefs = useRef({});

  /* ── Auto-select current year ── */
  const currentYear = useMemo(() => years.find(y => y.isCurrent), [years]);
  useEffect(() => {
    if (!yearId && currentYear) setYearId(currentYear.id ?? currentYear._id?.toString() ?? '');
  }, [currentYear, yearId]);

  /* ── Teaching assignments (server auto-scopes to teacher's own) ── */
  const { data: assignmentsData } = useQuery({
    queryKey: ['teaching-assignments', 'mine'],
    queryFn:  () => taApi.list(),
    staleTime: 10 * 60_000,
  });
  const assignments = assignmentsData?.data ?? [];

  /* ── All classes (filtered to teacher's assigned ones for teachers) ── */
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'list', 'active'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const allClasses = classesData?.data ?? [];

  const myClassIds = useMemo(
    () => [...new Set(assignments.map(a => a.classId).filter(Boolean))],
    [assignments]
  );

  const classesList = (isTeacher && myClassIds.length > 0)
    ? allClasses.filter(c => myClassIds.includes(c.id ?? c._id))
    : allClasses;

  /* ── Subjects: from assignments for teacher, all for admin ── */
  const { data: allSubjectsData } = useQuery({
    queryKey: ['subjects', 'all'],
    queryFn:  () => subjectsApi.list({ limit: 500 }),
    staleTime: 10 * 60_000,
    enabled:  !isTeacher,
  });

  const subjectsList = useMemo(() => {
    if (isTeacher) {
      if (!classId) return [];
      const seen = new Set();
      return assignments
        .filter(a => a.classId === classId)
        .map(a => ({ id: a.subjectId, name: a.subjectName }))
        .filter(s => s.id && !seen.has(s.id) && seen.add(s.id));
    }
    return allSubjectsData?.data ?? [];
  }, [isTeacher, assignments, classId, allSubjectsData]);

  /* ── Assessment schedule ── */
  const { data: scheduleData } = useQuery({
    queryKey: ['assessment', 'schedule', yearId],
    queryFn:  () => assessmentApi.getSchedule({ academicYearId: yearId || undefined }),
    staleTime: 5 * 60_000,
  });
  const allSchedule = scheduleData?.data ?? [];

  const filteredSchedule = useMemo(() =>
    termNumber ? allSchedule.filter(s => String(s.termNumber) === termNumber) : allSchedule,
    [allSchedule, termNumber]
  );

  const selectedEntry = filteredSchedule.find(s => s.id === scheduleId);

  /* ── Assessment config (for instances) ── */
  const { data: configData } = useQuery({
    queryKey: ['assessment', 'config'],
    queryFn:  () => assessmentApi.getConfig(),
    staleTime: 10 * 60_000,
  });
  const customTypes = configData?.data?.customTypes ?? DEFAULT_CUSTOM_TYPES;

  /* ── Columns from selected schedule entry ── */
  const cols = useMemo(() => {
    if (!selectedEntry) return [];
    const type      = customTypes.find(t => t.key === selectedEntry.assessmentType);
    const instances = type?.instances ?? 1;
    return Array.from({ length: instances }, (_, i) => ({
      typeKey:  selectedEntry.assessmentType,
      instance: i + 1,
      colId:    instances > 1 ? `${selectedEntry.assessmentType}_${i + 1}` : selectedEntry.assessmentType,
      colLabel: instances > 1 ? `${selectedEntry.assessmentType} ${i + 1}` : selectedEntry.assessmentType,
      color:    type?.color ?? 'sky',
      weight:   type?.weight,
    }));
  }, [selectedEntry, customTypes]);

  /* ── Students ── */
  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['classes', classId, 'students'],
    queryFn:  () => classesApi.students(classId, { limit: 500, status: 'active' }),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
  });
  const students = studentsData?.data ?? [];

  const canQuery = !!(classId && subjectId && selectedEntry);

  /* ── Existing marks ── */
  const { data: existingData } = useQuery({
    queryKey: ['assessment', 'marks', { classId, subjectId, assessmentType: selectedEntry?.assessmentType, termNumber: selectedEntry?.termNumber }],
    queryFn:  () => assessmentApi.getMarks({
      classId,
      subjectId,
      termNumber:     selectedEntry.termNumber,
      assessmentType: selectedEntry.assessmentType,
    }),
    enabled:  canQuery,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!existingData?.data) return;
    const map = {};
    for (const m of existingData.data) {
      const colId = m.instance > 1 ? `${m.assessmentType}_${m.instance}` : m.assessmentType;
      map[m.studentId] ??= {};
      map[m.studentId][colId] = m.rawScore;
    }
    setScores(map);
    setDirty(false);
  }, [existingData]);

  useEffect(() => { setScores({}); setDirty(false); }, [classId, subjectId, scheduleId]);

  const setCell = useCallback((studentId, colId, value) => {
    setScores(prev => ({ ...prev, [studentId]: { ...(prev[studentId] ?? {}), [colId]: value } }));
    setDirty(true);
  }, []);

  const navigate = useCallback((rowIdx, colIdx, dc, dr) => {
    const el = cellRefs.current[`${Math.max(0, Math.min(students.length - 1, rowIdx + dr))}_${Math.max(0, Math.min(cols.length - 1, colIdx + dc))}`];
    if (el) { el.focus(); el.select(); }
  }, [cols.length, students.length]);

  /* ── Clipboard paste (TSV from Excel/Sheets) ── */
  const handlePaste = useCallback((e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (!text.trim()) return;
    const rows = text.trim().split('\n').map(r => r.split('\t'));
    const focusedKey = Object.keys(cellRefs.current).find(k => cellRefs.current[k] === document.activeElement);
    if (!focusedKey) return;
    const [startRow, startCol] = focusedKey.split('_').map(Number);
    const newScores = { ...scores };
    rows.forEach((cells, dr) => {
      const rIdx = startRow + dr;
      if (rIdx >= students.length) return;
      const sid = students[rIdx]?.id ?? students[rIdx]?._id;
      if (!sid) return;
      newScores[sid] = { ...(newScores[sid] ?? {}) };
      cells.forEach((cell, dc) => {
        const cIdx = startCol + dc;
        if (cIdx >= cols.length) return;
        const v = parseFloat(cell.replace(',', '.'));
        if (!isNaN(v) && v >= 0 && v <= 100) newScores[sid][cols[cIdx].colId] = v;
      });
    });
    setScores(newScores);
    setDirty(true);
  }, [scores, students, cols]);

  /* ── Save ── */
  const { mutate: saveAll, isPending: saving } = useMutation({
    mutationFn: () => {
      const marksToSave = [];
      for (const s of students) {
        const sid = s.id ?? s._id;
        for (const col of cols) {
          const v = scores[sid]?.[col.colId];
          if (v == null) continue;
          marksToSave.push({
            studentId: sid, subjectId, classId,
            termNumber:     selectedEntry.termNumber,
            assessmentType: col.typeKey,
            instance:       col.instance,
            rawScore:       v,
          });
        }
      }
      return assessmentApi.bulkMarks({ marks: marksToSave });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'marks'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'report'] });
      setDirty(false);
      setToast({ msg: 'Marks saved successfully.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Save failed.', type: 'error' }),
  });

  const status = entryStatus(selectedEntry);
  const badge  = SCHED_BADGE[status];
  const ready  = canQuery && students.length > 0;

  /* ── Column stats ── */
  const colStats = useMemo(() => {
    if (!ready) return {};
    const stats = {};
    for (const col of cols) {
      const vals = students.map(s => scores[s.id ?? s._id]?.[col.colId]).filter(v => v != null).map(Number);
      if (!vals.length) { stats[col.colId] = null; continue; }
      stats[col.colId] = {
        avg:  vals.reduce((a, b) => a + b, 0) / vals.length,
        pass: vals.filter(v => v >= 50).length,
        n:    vals.length,
      };
    }
    return stats;
  }, [scores, students, cols, ready]);

  const selectedYear = years.find(y => (y.id ?? y._id?.toString()) === yearId);
  const yearTerms    = selectedYear?.terms ?? [];

  const selectedClassName  = classesList.find(c => (c.id ?? c._id) === classId)?.name ?? '';
  const selectedSubjectName = subjectsList.find(s => (s.id ?? s._id) === subjectId)?.name ?? subjectId;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      <AnimatePresence>
        {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
      </AnimatePresence>

      {/* ── Selection panel ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Mark Entry Context</p>

        {/* Row 1: Year · Term · Class */}
        <div className="grid sm:grid-cols-3 gap-3 mb-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Academic Year</label>
            <select
              value={yearId}
              onChange={e => { setYearId(e.target.value); setTermNumber(''); setScheduleId(''); }}
              className={selCls}
            >
              <option value="">All years</option>
              {years.map(y => (
                <option key={y.id ?? y._id} value={y.id ?? y._id}>{y.name}{y.isCurrent ? ' ★' : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Term</label>
            <select
              value={termNumber}
              onChange={e => { setTermNumber(e.target.value); setScheduleId(''); }}
              disabled={!yearId}
              className={`${selCls} disabled:opacity-50`}
            >
              <option value="">All terms</option>
              {yearTerms.length > 0
                ? yearTerms.map((t, i) => <option key={t.id ?? i} value={String(i + 1)}>{t.name}</option>)
                : [1, 2, 3].map(n => <option key={n} value={String(n)}>Term {n}</option>)
              }
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              Class {isTeacher && myClassIds.length > 0 && <span className="text-slate-400 font-normal">(your classes)</span>}
            </label>
            <select
              value={classId}
              onChange={e => { setClassId(e.target.value); setSubjectId(''); }}
              className={selCls}
            >
              <option value="">Select class…</option>
              {classesList.map(c => <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2: Subject · Assessment */}
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              Subject {isTeacher && classId && subjectsList.length > 0 && <span className="text-slate-400 font-normal">(assigned to you)</span>}
            </label>
            <select
              value={subjectId}
              onChange={e => setSubjectId(e.target.value)}
              disabled={!classId}
              className={`${selCls} disabled:opacity-50`}
            >
              <option value="">Select subject…</option>
              {subjectsList.map(s => <option key={s.id ?? s._id} value={s.id ?? s._id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              Assessment {filteredSchedule.length === 0 && yearId && <span className="text-amber-600 font-normal">(none scheduled — set up in Configuration)</span>}
            </label>
            <select value={scheduleId} onChange={e => setScheduleId(e.target.value)} className={selCls}>
              <option value="">Select assessment…</option>
              {filteredSchedule.map(entry => {
                const st = entryStatus(entry);
                const dot = st === 'active' ? '🟢' : st === 'upcoming' ? '🔵' : '🟡';
                return (
                  <option key={entry.id} value={entry.id}>
                    {dot} {entry.label || entry.assessmentType} — Term {entry.termNumber} ({entry.dateFrom} → {entry.dateTo})
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {/* Selected entry info strip */}
        {selectedEntry && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-slate-800">{selectedEntry.label || selectedEntry.assessmentType}</span>
            <span className="text-xs text-slate-400">{selectedEntry.dateFrom} – {selectedEntry.dateTo}</span>
            {selectedEntry.isLocked ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-red-700 bg-red-100 border border-red-200 px-2.5 py-0.5 rounded-full">
                <Lock size={10} /> Locked by {selectedEntry.lockedByName ?? 'admin'}{selectedEntry.lockedAt ? ` · ${new Date(selectedEntry.lockedAt).toLocaleDateString('en-GB')}` : ''}
              </span>
            ) : (
              <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
            )}
            {status === 'past' && !selectedEntry.isLocked && (
              <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                <AlertTriangle size={11} /> Deadline passed — marks still editable until manually locked
              </span>
            )}
            {cols.length > 1 && (
              <span className="text-xs text-slate-400 ml-auto">{cols.length} instances</span>
            )}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      {!canQuery ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center gap-2">
          <BookMarked size={28} className="text-slate-300" />
          <p className="text-sm font-medium text-slate-500">Select class, subject and assessment above</p>
          <p className="text-xs text-slate-400">Tab / Enter / arrow keys navigate cells. Paste from Excel or Google Sheets.</p>
        </div>
      ) : studentsLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-12 animate-pulse" />)}</div>
      ) : students.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center gap-2">
          <Users2 size={28} className="text-slate-300" />
          <p className="text-sm text-slate-500">No active students in {selectedClassName || 'this class'}.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {/* Locked banner */}
          {selectedEntry?.isLocked && (
            <div className="flex items-center gap-3 px-5 py-3 bg-red-50 border-b border-red-200">
              <Lock size={14} className="text-red-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-800">Mark entry locked</p>
                <p className="text-xs text-red-600 mt-0.5">
                  Locked by {selectedEntry.lockedByName ?? 'admin'}
                  {selectedEntry.lockedAt ? ` on ${new Date(selectedEntry.lockedAt).toLocaleDateString('en-GB')}` : ''}.
                  {selectedEntry.lockedNote ? ` Note: ${selectedEntry.lockedNote}` : ''}
                  {' '}Contact an administrator to unlock.
                </p>
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/50">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm font-semibold text-slate-800 truncate">
                {selectedClassName} · {selectedSubjectName}
              </span>
              {!selectedEntry?.isLocked && (
                <span className="hidden sm:flex items-center gap-1 text-xs text-slate-400 shrink-0">
                  <ClipboardPaste size={10} /> Paste from Excel
                </span>
              )}
            </div>
            <button
              onClick={() => saveAll()}
              disabled={saving || !dirty || selectedEntry?.isLocked}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition shrink-0"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? 'Saving…' : dirty ? 'Save marks' : 'Saved'}
            </button>
          </div>

          {/* Grid */}
          <div className="overflow-x-auto" onPaste={handlePaste}>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5 w-8 sticky left-0 bg-slate-50 z-10">#</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5 sticky left-8 bg-slate-50 z-10 min-w-[160px]">Student</th>
                  {cols.map(col => (
                    <th key={col.colId} className="text-center text-xs font-medium text-slate-500 px-2 py-2.5 min-w-[76px]">
                      <TypePill type={col.colLabel} color={col.color} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {students.map((s, rowIdx) => {
                  const sid = s.id ?? s._id;
                  return (
                    <tr key={sid} className="hover:bg-slate-50/60 transition">
                      <td className="px-4 py-1.5 text-xs text-slate-400 sticky left-0 bg-white">{rowIdx + 1}</td>
                      <td className="px-3 py-1.5 sticky left-8 bg-white min-w-[160px]">
                        <div className="text-sm font-medium text-slate-800 leading-tight">{s.firstName} {s.lastName}</div>
                        {s.admissionNumber && <div className="text-[11px] text-slate-400">{s.admissionNumber}</div>}
                      </td>
                      {cols.map((col, colIdx) => (
                        <td key={col.colId} className="px-2 py-1.5">
                          <GridCell
                            value={scores[sid]?.[col.colId]}
                            rowIdx={rowIdx} colIdx={colIdx}
                            isLocked={selectedEntry?.isLocked ?? false}
                            onChange={v => setCell(sid, col.colId, v)}
                            onNavigate={navigate}
                            cellRef={el => { cellRefs.current[`${rowIdx}_${colIdx}`] = el; }}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50/80">
                  <td colSpan={2} className="px-4 py-2 text-xs text-slate-500 font-medium sticky left-0 bg-slate-50/80">Avg / Pass</td>
                  {cols.map(col => {
                    const st = colStats[col.colId];
                    return (
                      <td key={col.colId} className="px-2 py-2 text-center text-xs text-slate-500">
                        {st ? (
                          <>
                            <span className={_scoreColor(st.avg)}>{_pct(st.avg)}</span>
                            <span className="block text-[10px] text-slate-400">
                              {st.n}/{students.length} · {Math.round((st.pass / st.n) * 100)}% pass
                            </span>
                          </>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
}


/* ══════════════════════════════════════════════════════════════
   ANNOUNCE SITTING SLIDE-OVER
   Teacher-only: announce a specific exam sitting within an
   admin-planned assessment schedule window.
   ══════════════════════════════════════════════════════════════ */
const EMPTY_ANNOUNCE = {
  classId:         '',
  subjectId:       '',
  scheduleEntryId: '',
  date:            '',
  startTime:       '',
  endTime:         '',
  maxScore:        '100',
  topics:          '',
};

function AnnounceSittingSlideOver({ onClose, onCreated }) {
  const [form, setForm]     = useState(EMPTY_ANNOUNCE);
  const [errors, setErrors] = useState({});

  /* Teaching assignments — auto-scoped to this teacher on server */
  const { data: taData } = useQuery({
    queryKey: ['teaching-assignments', 'mine'],
    queryFn:  () => taApi.list(),
    staleTime: 10 * 60_000,
  });
  const assignments = taData?.data ?? [];

  const myClasses = useMemo(() => {
    const seen = new Set();
    return assignments
      .filter(a => a.classId && !seen.has(a.classId) && seen.add(a.classId))
      .map(a => ({ id: a.classId, name: a.className }));
  }, [assignments]);

  const mySubjects = useMemo(() => {
    if (!form.classId) return [];
    const seen = new Set();
    return assignments
      .filter(a => a.classId === form.classId && a.subjectId && !seen.has(a.subjectId) && seen.add(a.subjectId))
      .map(a => ({ id: a.subjectId, name: a.subjectName }));
  }, [assignments, form.classId]);

  /* Assessment schedule */
  const { data: schedData } = useQuery({
    queryKey: ['assessment', 'schedule'],
    queryFn:  () => assessmentApi.getSchedule(),
    staleTime: 5 * 60_000,
  });
  const schedule = schedData?.data ?? [];
  const openEntries = schedule.filter(e => !e.isLocked);

  const selectedEntry = openEntries.find(e => e.id === form.scheduleEntryId);

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => { const n = { ...e }; delete n[field]; return n; });
  }

  function validate() {
    const errs = {};
    if (!form.classId)         errs.classId         = 'Select a class';
    if (!form.subjectId)       errs.subjectId        = 'Select a subject';
    if (!form.scheduleEntryId) errs.scheduleEntryId  = 'Select an assessment window';
    if (!form.date)            errs.date             = 'Date is required';
    if (!form.maxScore || isNaN(Number(form.maxScore)) || Number(form.maxScore) <= 0) {
      errs.maxScore = 'Max score must be a positive number';
    }
    if (selectedEntry && form.date) {
      if (form.date < selectedEntry.dateFrom || form.date > selectedEntry.dateTo) {
        errs.date = `Date must be within ${selectedEntry.dateFrom} – ${selectedEntry.dateTo}`;
      }
    }
    return errs;
  }

  const mutation = useMutation({
    mutationFn: () => examsApi.announceSitting({
      classId:         form.classId,
      subjectId:       form.subjectId,
      scheduleEntryId: form.scheduleEntryId,
      date:            form.date,
      startTime:       form.startTime || undefined,
      endTime:         form.endTime   || undefined,
      maxScore:        Number(form.maxScore),
      topics:          form.topics    || undefined,
    }),
    onSuccess: onCreated,
    onError:   err => setErrors({ _server: err?.message ?? 'Failed to announce sitting' }),
  });

  function handleSubmit() {
    const errs = validate();
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }
    mutation.mutate();
  }

  const slideIn = { initial: { x: '100%', opacity: 0 }, animate: { x: 0, opacity: 1 }, exit: { x: '100%', opacity: 0 }, transition: { type: 'spring', stiffness: 320, damping: 32 } };

  return (
    <motion.div {...slideIn} className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-violet-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-violet-100 border border-violet-200 flex items-center justify-center">
              <PenLine size={15} className="text-violet-700" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-violet-900">Announce Exam Sitting</h2>
              <p className="text-xs text-violet-600 mt-0.5">For your assigned classes & subjects</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {errors._server && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {errors._server}
            </div>
          )}

          {/* Class */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Class <span className="text-red-500">*</span></label>
            <select
              value={form.classId}
              onChange={e => { set('classId', e.target.value); set('subjectId', ''); }}
              className={selCls}
            >
              <option value="">Select class…</option>
              {myClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {errors.classId && <p className="mt-1 text-xs text-red-500">{errors.classId}</p>}
            {myClasses.length === 0 && <p className="mt-1 text-xs text-amber-600">No class assignments found. Contact admin.</p>}
          </div>

          {/* Subject */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Subject <span className="text-red-500">*</span></label>
            <select
              value={form.subjectId}
              onChange={e => set('subjectId', e.target.value)}
              disabled={!form.classId}
              className={`${selCls} disabled:opacity-50`}
            >
              <option value="">Select subject…</option>
              {mySubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {errors.subjectId && <p className="mt-1 text-xs text-red-500">{errors.subjectId}</p>}
          </div>

          {/* Assessment window */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Assessment Window <span className="text-red-500">*</span></label>
            <select
              value={form.scheduleEntryId}
              onChange={e => { set('scheduleEntryId', e.target.value); set('date', ''); }}
              className={selCls}
            >
              <option value="">Select assessment window…</option>
              {openEntries.map(e => {
                const st = entryStatus(e);
                const dot = st === 'active' ? '🟢' : st === 'upcoming' ? '🔵' : '🟡';
                return (
                  <option key={e.id} value={e.id}>
                    {dot} {e.label || e.assessmentType} — Term {e.termNumber} ({e.dateFrom} → {e.dateTo})
                  </option>
                );
              })}
            </select>
            {errors.scheduleEntryId && <p className="mt-1 text-xs text-red-500">{errors.scheduleEntryId}</p>}
            {openEntries.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">No open assessment windows. Admin must set up the schedule first.</p>
            )}
          </div>

          {/* Date */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Exam Date <span className="text-red-500">*</span>
              {selectedEntry && (
                <span className="ml-1.5 font-normal text-slate-400">({selectedEntry.dateFrom} – {selectedEntry.dateTo})</span>
              )}
            </label>
            <input
              type="date"
              value={form.date}
              min={selectedEntry?.dateFrom}
              max={selectedEntry?.dateTo}
              onChange={e => set('date', e.target.value)}
              className={selCls}
            />
            {errors.date && <p className="mt-1 text-xs text-red-500">{errors.date}</p>}
          </div>

          {/* Time */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Start Time</label>
              <input type="time" value={form.startTime} onChange={e => set('startTime', e.target.value)} className={selCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">End Time</label>
              <input type="time" value={form.endTime} onChange={e => set('endTime', e.target.value)} className={selCls} />
            </div>
          </div>

          {/* Max Score */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Max Score <span className="text-red-500">*</span></label>
            <input
              type="number"
              min="1"
              max="1000"
              value={form.maxScore}
              onChange={e => set('maxScore', e.target.value)}
              className={selCls}
              placeholder="100"
            />
            {errors.maxScore && <p className="mt-1 text-xs text-red-500">{errors.maxScore}</p>}
          </div>

          {/* Topics */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Topics / What to expect</label>
            <textarea
              value={form.topics}
              onChange={e => set('topics', e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Newton's Laws, Friction, Circular Motion…"
              className={`${selCls} resize-none`}
            />
            <p className="text-[10px] text-slate-400 mt-0.5">{form.topics.length}/500 — visible to students on their calendar</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2 rounded-lg transition">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={mutation.isPending}
            className="flex items-center gap-1.5 bg-violet-700 hover:bg-violet-800 disabled:opacity-50 text-white text-sm font-semibold px-5 py-2 rounded-lg transition"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {mutation.isPending ? 'Announcing…' : 'Announce sitting'}
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════
   CREATE EXAM SLIDE-OVER — v4.33.0
   All dropdowns connected to real data (years, terms, subjects,
   assessment types from academic-config)
   ══════════════════════════════════════════════════════════════ */
const EMPTY_FORM = {
  academicYearId:  '',
  termId:          '',
  termLabel:       '',
  assessmentType:  '',
  assessmentLabel: '',
  subjectId:       '',
  subjectName:     '',
  classId:         '',
  title:           '',
  date:            '',
  maxScore:        '100',
  passMark:        '',
  weightPercent:   '',
  status:          'scheduled',
  description:     '',
};

function CreateExamSlideOver({ years, assessmentWeights, subjectsList, onClose, onCreated }) {
  const [form, setForm]     = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [subjectSearch, setSubjectSearch] = useState('');

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60_000,
  });
  const classList = classesData?.data ?? [];

  /* Derived: terms from selected year */
  const selectedYear = years.find(y => (y.id ?? y._id?.toString()) === form.academicYearId);
  const yearTerms    = selectedYear?.terms ?? [];

  /* Subject search */
  const filteredSubjects = useMemo(() =>
    subjectSearch
      ? subjectsList.filter(s => s.name.toLowerCase().includes(subjectSearch.toLowerCase()))
      : subjectsList,
    [subjectsList, subjectSearch]
  );

  const mutation = useMutation({
    mutationFn: d => examsApi.create({
      ...d,
      maxScore:      d.maxScore      ? Number(d.maxScore)      : undefined,
      passMark:      d.passMark      ? Number(d.passMark)      : undefined,
      weightPercent: d.weightPercent ? Number(d.weightPercent) : undefined,
    }),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create exam' }),
  });

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => { const n = { ...e }; delete n[field]; return n; });
  }

  function onYearChange(yearId) {
    const yr = years.find(y => (y.id ?? y._id?.toString()) === yearId);
    setForm(f => {
      const next = { ...f, academicYearId: yearId, termId: '', termLabel: '' };
      // Auto-select current term if year is active
      if (yr?.isCurrent && yr.terms?.length > 0) {
        const today   = new Date().toISOString().slice(0, 10);
        const current = yr.terms.find(t => t.startDate <= today && t.endDate >= today);
        if (current) { next.termId = current.id ?? ''; next.termLabel = current.name ?? ''; }
      }
      return next;
    });
    setErrors(e => { const n = { ...e }; delete n.academicYearId; return n; });
  }

  function onTermChange(idx) {
    const t = yearTerms[Number(idx)];
    if (!t) { set('termId', ''); set('termLabel', ''); return; }
    setForm(f => ({ ...f, termId: t.id ?? '', termLabel: t.name }));
  }

  function onAssessmentChange(idx) {
    const w = assessmentWeights[Number(idx)];
    if (!w) {
      setForm(f => ({ ...f, assessmentType: '', assessmentLabel: '', weightPercent: '' }));
      return;
    }
    setForm(f => {
      const next = { ...f, assessmentType: w.assessmentType, assessmentLabel: w.label, weightPercent: String(w.weight) };
      // Auto-suggest title if subject already selected
      if (!next.title && next.subjectName) next.title = `${w.label} — ${next.subjectName}`;
      return next;
    });
    setErrors(e => { const n = { ...e }; delete n.assessmentType; return n; });
  }

  function onSubjectChange(subjectId) {
    const s = subjectsList.find(s => (s.id ?? s._id) === subjectId);
    setForm(f => {
      const next = { ...f, subjectId, subjectName: s?.name ?? '' };
      // Auto-suggest title if assessment type already selected
      if (!next.title && next.assessmentLabel && s?.name) next.title = `${next.assessmentLabel} — ${s.name}`;
      return next;
    });
    setErrors(e => { const n = { ...e }; delete n.subjectId; return n; });
  }

  function validate() {
    const e = {};
    if (!form.title.trim())   e.title   = 'Exam title is required';
    if (!form.subjectId)      e.subjectId = 'Subject is required';
    if (!form.academicYearId) e.academicYearId = 'Academic year is required';
    return e;
  }

  function submit(ev) {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    mutation.mutate(form);
  }

  /* Currently selected indices (for controlled selects) */
  const selectedTermIdx   = yearTerms.findIndex(t => (t.id && t.id === form.termId) || t.name === form.termLabel);
  const selectedWeightIdx = assessmentWeights.findIndex(w => w.assessmentType === form.assessmentType && w.label === form.assessmentLabel);

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-gradient-to-r from-blue-700 to-indigo-700">
          <div>
            <h2 className="text-base font-semibold text-white">Create Exam</h2>
            <p className="text-xs text-blue-100 mt-0.5">Schedule a new exam or assessment</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white p-1 rounded-lg hover:bg-white/10 transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={15} className="shrink-0" />{errors._server}
            </div>
          )}

          {/* ── Academic Period ── */}
          <div>
            <SectionLabel>Academic Period</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <FField label="Academic Year *" error={errors.academicYearId}>
                <select value={form.academicYearId} onChange={e => onYearChange(e.target.value)} className={iCls(errors.academicYearId)}>
                  <option value="">Select year…</option>
                  {years.length === 0 && <option disabled>No years set — add in Settings</option>}
                  {years.map(y => (
                    <option key={y.id ?? y._id} value={y.id ?? y._id}>
                      {y.name}{y.isCurrent ? ' (Current)' : ''}
                    </option>
                  ))}
                </select>
              </FField>
              <FField label="Term">
                <select
                  value={selectedTermIdx >= 0 ? selectedTermIdx : ''}
                  onChange={e => onTermChange(e.target.value)}
                  disabled={!form.academicYearId || yearTerms.length === 0}
                  className={`${iCls()} disabled:opacity-50`}
                >
                  <option value="">{yearTerms.length === 0 ? (form.academicYearId ? 'No terms defined' : 'Select year first') : 'Select term…'}</option>
                  {yearTerms.map((t, i) => <option key={t.id ?? i} value={i}>{t.name}</option>)}
                </select>
              </FField>
            </div>
            {yearTerms.length === 0 && form.academicYearId && (
              <p className="text-[11px] text-amber-600 mt-1.5">
                ⚠ No terms defined for this year. Add them in Settings → Academic Years.
              </p>
            )}
          </div>

          {/* ── Assessment Details ── */}
          <div>
            <SectionLabel>Assessment Details</SectionLabel>
            <div className="space-y-3">
              <FField label="Assessment Type">
                <select
                  value={selectedWeightIdx >= 0 ? selectedWeightIdx : ''}
                  onChange={e => onAssessmentChange(e.target.value)}
                  className={iCls()}
                >
                  <option value="">Select type… (optional)</option>
                  {assessmentWeights.map((w, i) => (
                    <option key={i} value={i}>{w.label} — {w.weight}%</option>
                  ))}
                </select>
                {form.weightPercent && (
                  <p className="text-[11px] text-indigo-600 mt-1 flex items-center gap-1">
                    <Percent size={9} /> Auto-weight: {form.weightPercent}% of term grade
                  </p>
                )}
              </FField>

              <FField label="Subject *" error={errors.subjectId}>
                {/* Inline search filter */}
                <div className="relative mb-1.5">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={subjectSearch}
                    onChange={e => setSubjectSearch(e.target.value)}
                    placeholder="Filter subjects…"
                    className="w-full text-sm pl-7 pr-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 placeholder-slate-400"
                  />
                </div>
                <select
                  value={form.subjectId}
                  onChange={e => onSubjectChange(e.target.value)}
                  size={Math.min(5, filteredSubjects.length + 1)}
                  className={`${iCls(errors.subjectId)} min-h-[72px]`}
                >
                  <option value="">— No subject selected —</option>
                  {filteredSubjects.map(s => (
                    <option key={s.id ?? s._id} value={s.id ?? s._id}>
                      {s.name}{s.code ? ` (${s.code})` : ''}
                    </option>
                  ))}
                  {filteredSubjects.length === 0 && subjectsList.length > 0 && (
                    <option disabled>No subjects match "{subjectSearch}"</option>
                  )}
                  {subjectsList.length === 0 && (
                    <option disabled>No subjects found — add them in Subjects module</option>
                  )}
                </select>
              </FField>
            </div>
          </div>

          {/* ── Exam Info ── */}
          <div>
            <SectionLabel>Exam Info</SectionLabel>
            <div className="space-y-3">
              <FField label="Exam Title *" error={errors.title}>
                <input
                  value={form.title}
                  onChange={e => set('title', e.target.value)}
                  placeholder="e.g. Mid-Term Exam — Mathematics"
                  className={iCls(errors.title)}
                />
                {/* Auto-suggest shortcut */}
                {form.assessmentLabel && form.subjectName && form.title !== `${form.assessmentLabel} — ${form.subjectName}` && (
                  <button
                    type="button"
                    onClick={() => set('title', `${form.assessmentLabel} — ${form.subjectName}`)}
                    className="text-[11px] text-indigo-600 hover:text-indigo-800 mt-1 underline underline-offset-2"
                  >
                    ↩ Use: "{form.assessmentLabel} — {form.subjectName}"
                  </button>
                )}
              </FField>

              <FField label="Class">
                <select value={form.classId} onChange={e => set('classId', e.target.value)} className={iCls()}>
                  <option value="">No class (school-wide)</option>
                  {classList.map(c => <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>)}
                </select>
              </FField>

              <div className="grid grid-cols-2 gap-3">
                <FField label="Date">
                  <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={iCls()} />
                </FField>
                <FField label="Status">
                  <select value={form.status} onChange={e => set('status', e.target.value)} className={iCls()}>
                    <option value="scheduled">Scheduled</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </FField>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <FField label="Max Score">
                  <input type="number" min="1" value={form.maxScore} onChange={e => set('maxScore', e.target.value)} placeholder="100" className={iCls()} />
                </FField>
                <FField label="Pass Mark">
                  <input type="number" min="0" value={form.passMark} onChange={e => set('passMark', e.target.value)} placeholder="50" className={iCls()} />
                </FField>
                <FField label="Weight %">
                  <input type="number" min="0" max="100" value={form.weightPercent} onChange={e => set('weightPercent', e.target.value)} placeholder="auto" className={iCls()} />
                </FField>
              </div>

              <FField label="Notes / Instructions">
                <textarea
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  rows={2}
                  placeholder="Optional notes for invigilators or students…"
                  className={`${iCls()} resize-none`}
                />
              </FField>
            </div>
          </div>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Creating…' : 'Create Exam'}
          </button>
        </div>
      </motion.div>
    </>
  );
}




/* ── Shared helpers ─────────────────────────────────────────── */
const selCls = 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 text-slate-800';

function SectionLabel({ children }) {
  return (
    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2.5">
      {children}
    </p>
  );
}

function PaginationBar({ page, totalPages, total, limit, onPage }) {
  const start = (page - 1) * limit + 1;
  const end   = Math.min(page * limit, total);
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
      <p className="text-xs text-slate-500">{total > 0 ? `${start}–${end} of ${total}` : '0 results'}</p>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(p => Math.max(1, p - 1))} disabled={page <= 1}
          className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600">
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs text-slate-500 px-2">{page} / {totalPages}</span>
        <button onClick={() => onPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
          className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600">
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

function EmptyMsg({ icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-slate-400">
      <div className="mb-3 opacity-40">{icon}</div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle && <p className="text-xs mt-1 text-slate-400 text-center max-w-xs">{subtitle}</p>}
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
  return `w-full text-sm px-3 py-2 rounded-lg border ${
    error ? 'border-red-300' : 'border-slate-200 focus:border-indigo-400'
  } bg-white focus:outline-none focus:ring-2 ${
    error ? 'focus:ring-red-500/20' : 'focus:ring-indigo-500/20'
  } text-slate-800 placeholder-slate-400 transition`;
}
