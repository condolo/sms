/* ============================================================
   Exams & Assessment — v4.33.0 Overhaul
   - Warm gradient header
   - Assessment type connected to academic-config (configurable)
   - Subject dropdown (FK, not free text)
   - Academic Year + Term selectors (connected to real years)
   - Cascading filters: Year → Term → Assessment Type → Search
   - CreateExamSlideOver: all proper dropdowns, auto-suggest title
   - ResultsTab: Year/Term filter to narrow exam picker
   ============================================================ */
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, BarChart3, ClipboardList, Plus, X, Loader2,
  CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight,
  Search, BookOpen, Save, Check, Download, TrendingUp,
  Award, Users2, GraduationCap, Filter, Percent, Settings,
  Tag, Layers,
} from 'lucide-react';
import {
  exams as examsApi,
  grades as gradesApi,
  classes as classesApi,
  academicConfig as academicConfigApi,
  subjects as subjectsApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

const LIMIT = 20;

/* ══════════════════════════════════════════════════════════════ */
export default function ExamsPage() {
  const [tab, setTab] = useState('exams');
  const role = useAuthStore(s => s.session?.user?.role ?? '');
  const canCreate = ['admin', 'superadmin', 'deputy_principal', 'exams_officer'].includes(role);

  const TABS = [
    { id: 'exams',   label: 'Exams',       icon: FileText      },
    { id: 'results', label: 'Results',      icon: ClipboardList },
    { id: 'grades',  label: 'Grade Report', icon: BarChart3     },
  ];

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
            <a
              href="/settings"
              className="hidden sm:flex items-center gap-1.5 text-xs font-medium text-white/80 hover:text-white bg-white/10 hover:bg-white/20 border border-white/30 px-3 py-1.5 rounded-lg transition"
            >
              <Settings size={12} />
              Assessment Config
            </a>
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
          {tab === 'results' && (
            <ResultsTab
              key="results"
              years={years}
              assessmentWeights={assessmentWeights}
            />
          )}
          {tab === 'grades' && (
            <GradesTab key="grades" subjectsList={subjectsList} />
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
  const [page, setPage]   = useState(1);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

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
      </AnimatePresence>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════
   RESULTS TAB
   ══════════════════════════════════════════════════════════════ */
function ResultsTab({ years, assessmentWeights }) {
  const [filterYearId, setFilterYearId]       = useState('');
  const [filterTermLabel, setFilterTermLabel] = useState('');
  const [examId, setExamId]   = useState('');
  const [saving, setSaving]   = useState(false);
  const [edits, setEdits]     = useState({});
  const [saved, setSaved]     = useState(false);

  const selectedYear = years.find(y => (y.id ?? y._id?.toString()) === filterYearId);
  const yearTerms    = selectedYear?.terms ?? [];

  const examQueryParams = useMemo(() => ({
    limit: 200,
    academicYearId: filterYearId    || undefined,
    termLabel:      filterTermLabel || undefined,
  }), [filterYearId, filterTermLabel]);

  const { data: examsData } = useQuery({
    queryKey: ['exams', 'list', examQueryParams],
    queryFn:  () => examsApi.list(examQueryParams),
    staleTime: 2 * 60_000,
  });
  const examsList    = examsData?.data ?? [];
  const selectedExam = examsList.find(e => (e.id ?? e._id) === examId);

  function onYearChange(v) { setFilterYearId(v); setFilterTermLabel(''); setExamId(''); setEdits({}); }
  function onTermChange(v) { setFilterTermLabel(v); setExamId(''); setEdits({}); }

  const { data: resultsData, isLoading: resultsLoading, refetch: refetchResults } = useQuery({
    queryKey: ['exams', examId, 'results'],
    queryFn:  () => examsApi.results.list(examId, { limit: 200 }),
    enabled:  !!examId,
    staleTime: 0,
  });
  const results    = resultsData?.data ?? [];
  const resultsMap = Object.fromEntries(results.map(r => [r.studentId, r]));

  const { data: stuData, isLoading: stuLoading } = useQuery({
    queryKey: ['classes', selectedExam?.classId, 'students'],
    queryFn:  () => classesApi.students(selectedExam.classId, { limit: 500, status: 'active' }),
    enabled:  !!selectedExam?.classId,
    staleTime: 5 * 60_000,
  });
  const students = stuData?.data ?? [];

  function setScore(studentId, field, val) {
    setEdits(e => ({ ...e, [studentId]: { ...e[studentId], [field]: val } }));
    setSaved(false);
  }

  async function saveResults() {
    if (!examId) return;
    setSaving(true);
    try {
      const records = students.map(s => {
        const sid  = s.id ?? s._id;
        const edit = edits[sid] ?? {};
        const orig = resultsMap[sid] ?? {};
        return {
          studentId: sid,
          score:   edit.score   !== undefined ? Number(edit.score)   : (orig.score   ?? null),
          grade:   edit.grade   !== undefined ? edit.grade   : (orig.grade   ?? ''),
          comment: edit.comment !== undefined ? edit.comment : (orig.comment ?? ''),
        };
      }).filter(r => r.score !== null);
      await examsApi.results.bulkUpsert(examId, { records });
      setEdits({});
      setSaved(true);
      refetchResults();
    } catch (err) {
      alert(err?.message ?? 'Failed to save results');
    } finally {
      setSaving(false);
    }
  }

  const hasEdits = Object.keys(edits).length > 0;
  const loading  = resultsLoading || stuLoading;

  const scores   = results.map(r => r.score).filter(s => s != null && !isNaN(s));
  const maxS     = selectedExam?.maxScore ?? 100;
  const avg      = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const highest  = scores.length ? Math.max(...scores) : null;
  const lowest   = scores.length ? Math.min(...scores) : null;
  const passRate = scores.length ? Math.round((scores.filter(s => (s / maxS) * 100 >= 50).length / scores.length) * 100) : null;

  /* Group exams by assessment label for grouped <optgroup> */
  const examsByType = useMemo(() => {
    const groups = {};
    for (const e of examsList) {
      const key = e.assessmentLabel ?? e.assessmentType ?? 'Other';
      groups[key] = groups[key] ?? [];
      groups[key].push(e);
    }
    return groups;
  }, [examsList]);
  const hasGroups = Object.keys(examsByType).length > 1;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">

      {/* ── Selector panel ── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Select Exam</p>
        <div className="grid sm:grid-cols-3 gap-3">
          {/* Year */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Academic Year</label>
            <select value={filterYearId} onChange={e => onYearChange(e.target.value)} className={selCls}>
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
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Term</label>
            <select
              value={filterTermLabel}
              onChange={e => onTermChange(e.target.value)}
              disabled={!filterYearId || yearTerms.length === 0}
              className={`${selCls} disabled:opacity-50`}
            >
              <option value="">All terms</option>
              {yearTerms.map((t, i) => (
                <option key={t.id ?? i} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Exam selector — optionally grouped by assessment type */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Exam
              {examsList.length > 0 && (
                <span className="text-slate-400 font-normal ml-1">({examsList.length} available)</span>
              )}
            </label>
            <select
              value={examId}
              onChange={e => { setExamId(e.target.value); setEdits({}); setSaved(false); }}
              className={selCls}
            >
              <option value="">Choose an exam…</option>
              {hasGroups
                ? Object.entries(examsByType).map(([typeLabel, exs]) => (
                    <optgroup key={typeLabel} label={typeLabel}>
                      {exs.map(e => (
                        <option key={e.id ?? e._id} value={e.id ?? e._id}>
                          {e.title}{e.subjectName ? ` — ${e.subjectName}` : ''}{e.className ? ` (${e.className})` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))
                : examsList.map(e => (
                    <option key={e.id ?? e._id} value={e.id ?? e._id}>
                      {e.title}{e.subjectName ? ` — ${e.subjectName}` : ''}{e.className ? ` (${e.className})` : ''}
                    </option>
                  ))}
            </select>
          </div>
        </div>

        {/* Exam summary strip */}
        {selectedExam && (
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-slate-800">{selectedExam.title}</span>
            {selectedExam.subjectName && <span className="text-xs text-slate-500">{selectedExam.subjectName}</span>}
            {selectedExam.assessmentLabel && <TypeChip label={selectedExam.assessmentLabel} />}
            <StatusBadge status={selectedExam.status} />
            {selectedExam.maxScore && <span className="text-xs text-slate-400">Max: {selectedExam.maxScore}</span>}
            {selectedExam.weightPercent != null && (
              <span className="text-xs text-indigo-600 font-medium">{selectedExam.weightPercent}% weight</span>
            )}
            {hasEdits && (
              <button
                onClick={saveResults}
                disabled={saving}
                className="ml-auto flex items-center gap-1.5 bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                {saving ? 'Saving…' : `Save (${Object.keys(edits).length} changed)`}
              </button>
            )}
            {saved && !hasEdits && (
              <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600 font-medium">
                <Check size={12} />Results saved
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Results table ── */}
      {!examId ? (
        <EmptyMsg
          icon={<ClipboardList size={36} />}
          title="Select an exam above"
          subtitle="Choose a year, term and exam to enter or view results"
        />
      ) : loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-14 animate-pulse" />)}
        </div>
      ) : students.length === 0 ? (
        <EmptyMsg icon={<BookOpen size={36} />} title="No students in this class" subtitle="This exam's class has no active students" />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">
                  Score{selectedExam?.maxScore ? ` /${selectedExam.maxScore}` : ''}
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-24 hidden sm:table-cell">Grade</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Comment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map(s => {
                const sid     = s.id ?? s._id;
                const orig    = resultsMap[sid]   ?? {};
                const edit    = edits[sid]         ?? {};
                const score   = edit.score   !== undefined ? edit.score   : (orig.score   ?? '');
                const grade   = edit.grade   !== undefined ? edit.grade   : (orig.grade   ?? '');
                const comment = edit.comment !== undefined ? edit.comment : (orig.comment ?? '');
                const changed = edit.score !== undefined || edit.grade !== undefined || edit.comment !== undefined;
                return (
                  <tr key={sid} className={`hover:bg-slate-50 transition-colors ${changed ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-800">{s.firstName} {s.lastName}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number" min="0" max={selectedExam?.maxScore ?? 9999}
                        value={score}
                        onChange={e => setScore(sid, 'score', e.target.value)}
                        placeholder="—"
                        className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                      />
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      <input
                        value={grade}
                        onChange={e => setScore(sid, 'grade', e.target.value)}
                        placeholder="A, B+…"
                        className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                      />
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <input
                        value={comment}
                        onChange={e => setScore(sid, 'comment', e.target.value)}
                        placeholder="Optional comment…"
                        className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasEdits && (
            <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={saveResults}
                disabled={saving}
                className="flex items-center gap-1.5 bg-indigo-700 hover:bg-indigo-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving…' : `Save results (${Object.keys(edits).length} changed)`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Stats bar */}
      {scores.length > 0 && !hasEdits && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Average Score', value: `${avg} / ${maxS}`,     Icon: TrendingUp, color: 'text-blue-600 bg-blue-50'       },
            { label: 'Highest Score', value: `${highest} / ${maxS}`,  Icon: Award,      color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Lowest Score',  value: `${lowest} / ${maxS}`,   Icon: TrendingUp, color: 'text-amber-600 bg-amber-50'    },
            { label: 'Pass Rate',     value: `${passRate}%`,          Icon: Users2,     color: passRate >= 50 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50' },
          ].map(({ label, value, Icon, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color.split(' ')[1]}`}>
                <Icon size={16} className={color.split(' ')[0]} />
              </div>
              <div>
                <p className="text-[11px] text-slate-500">{label}</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════
   GRADE REPORT TAB
   ══════════════════════════════════════════════════════════════ */
function GradesTab({ subjectsList }) {
  const [classId, setClassId]   = useState('');
  const [examId, setExamId]     = useState('');
  const [subjectId, setSubjectId] = useState('');

  function exportCSV(rows) {
    const header = 'Student,Subject,Exam,Avg %,Grade';
    const lines  = rows.map(r =>
      [r.studentName ?? r.studentId, r.subject ?? '', r.examTitle ?? '',
       r.avgPct != null ? `${Math.round(r.avgPct)}%` : (r.score ?? ''), r.grade ?? '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'grade-report.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60_000,
  });
  const classList = classesData?.data ?? [];

  const { data: examsData } = useQuery({
    queryKey: ['exams', 'list', { page: 1 }],
    queryFn:  () => examsApi.list({ limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const examsList = examsData?.data ?? [];

  const enabled = !!(classId || examId || subjectId);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['grades', 'report', { classId, examId, subjectId }],
    queryFn:  () => gradesApi.report({
      classId:   classId   || undefined,
      examId:    examId    || undefined,
      subjectId: subjectId || undefined,
      limit: 100,
    }),
    enabled,
    staleTime: 30_000,
  });
  const rows = data?.data ?? [];

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">Class</label>
          <select value={classId} onChange={e => setClassId(e.target.value)} className={selCls}>
            <option value="">All classes</option>
            {classList.map(c => <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">Exam</label>
          <select value={examId} onChange={e => setExamId(e.target.value)} className={selCls}>
            <option value="">All exams</option>
            {examsList.map(e => <option key={e.id ?? e._id} value={e.id ?? e._id}>{e.title}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">Subject</label>
          <select value={subjectId} onChange={e => setSubjectId(e.target.value)} className={selCls}>
            <option value="">All subjects</option>
            {subjectsList.map(s => <option key={s.id ?? s._id} value={s.id ?? s._id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {rows.length > 0 && (() => {
        const pcts  = rows.map(r => Number(r.avgPct ?? r.score ?? 0)).filter(v => !isNaN(v));
        const gAvg  = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null;
        const gPass = pcts.length ? Math.round((pcts.filter(v => v >= 50).length / pcts.length) * 100) : null;
        return (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { label: 'Records',       value: rows.length,                    color: 'text-violet-600 bg-violet-50'   },
              { label: 'Class Average', value: gAvg  != null ? `${gAvg}%`  : '—', color: gAvg  >= 50 ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50' },
              { label: 'Pass Rate',     value: gPass != null ? `${gPass}%` : '—', color: gPass >= 50 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'    },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                <p className="text-[11px] text-slate-500">{label}</p>
                <p className={`text-lg font-bold mt-0.5 ${color.split(' ')[0]}`}>{value}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {!enabled ? (
        <EmptyMsg icon={<BarChart3 size={36} />} title="Apply a filter" subtitle="Select a class, exam or subject to load the grade report" />
      ) : isLoading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-14 animate-pulse" />)}
        </div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg icon={<BarChart3 size={36} />} title="No grade data" subtitle="No results match the selected filters" />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Exam</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Avg %</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Grade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => {
                const pct      = Number(r.avgPct ?? r.score ?? 0);
                const pctColor = pct >= 70 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600';
                return (
                  <tr key={`${r.studentId}-${r.subject}-${i}`} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{r.studentName ?? r.studentId}</td>
                    <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{r.subject ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs hidden md:table-cell">{r.examTitle ?? '—'}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${pctColor}`}>
                      {r.avgPct != null ? `${Math.round(r.avgPct)}%` : r.score != null ? `${r.score}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{r.grade ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">{rows.length} record{rows.length !== 1 ? 's' : ''}</p>
            <button
              onClick={() => exportCSV(rows)}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg transition"
            >
              <Download size={12} />
              Export CSV
            </button>
          </div>
        </div>
      )}
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
