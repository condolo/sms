/* ============================================================
   Exams & Assessment — Unified module
   Tabs: Exams · Results · Mark Entry · Report Cards · Config · Reminders

   Data stores (both kept — report-cards.js reads both):
     exams + exam_results  → formal exam scheduling & results
     assessment_marks      → continuous assessment (CA/HW/MT/ET)
   ============================================================ */
import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PenLine, FileText, Settings2, Bell,
  CheckCircle2, AlertTriangle, Loader2, Trash2,
  Plus, X, Save, Send, ClipboardList,
  TrendingUp, TrendingDown,
  BookOpen, Calendar, Clock, Award, Printer,
  Search, ChevronLeft, ChevronRight, Check,
  Download, Users2, BarChart3,
} from 'lucide-react';
import {
  assessment as api,
  classes    as classesApi,
  exams      as examsApi,
  grades     as gradesApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

/* ── Constants ──────────────────────────────────────────────── */
const ASSESSMENT_TYPES = ['CA', 'HW', 'MT', 'ET'];
const TERM_NUMBERS     = [1, 2, 3];
const TYPE_LABELS      = {
  CA: 'Continuous Assessment',
  HW: 'Homework / Assignment',
  MT: 'Mid-Term Exam',
  ET: 'End-Term Exam',
};
const DEFAULT_WEIGHTS  = { CA: 20, HW: 10, MT: 30, ET: 40 };
const TYPE_PILL        = {
  CA: 'bg-violet-50 text-violet-700 border-violet-200',
  HW: 'bg-purple-50 text-purple-700 border-purple-200',
  MT: 'bg-amber-50 text-amber-700 border-amber-200',
  ET: 'bg-red-50 text-red-700 border-red-200',
};

const EXAM_LIMIT = 20;

const EXAM_STATUS_CFG = {
  draft:      { label: 'Draft',       cls: 'bg-slate-100 text-slate-600 border-slate-200'    },
  scheduled:  { label: 'Scheduled',   cls: 'bg-blue-50   text-blue-700  border-blue-200'     },
  in_progress:{ label: 'In Progress', cls: 'bg-amber-50  text-amber-700 border-amber-200'    },
  active:     { label: 'Active',      cls: 'bg-violet-50 text-violet-700 border-violet-200'  },
  completed:  { label: 'Completed',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  moderated:  { label: 'Moderated',   cls: 'bg-sky-50    text-sky-700   border-sky-200'      },
  approved:   { label: 'Approved',    cls: 'bg-green-50  text-green-700 border-green-200'    },
  locked:     { label: 'Locked',      cls: 'bg-slate-100 text-slate-700 border-slate-300'    },
  published:  { label: 'Published',   cls: 'bg-indigo-50 text-indigo-700 border-indigo-200'  },
  archived:   { label: 'Archived',    cls: 'bg-slate-50  text-slate-500 border-slate-200'    },
  cancelled:  { label: 'Cancelled',   cls: 'bg-red-50    text-red-700   border-red-200'      },
};

const TABS = [
  { key: 'exams',   label: 'Exams',        Icon: BookOpen,     roles: ['admin','superadmin','teacher','deputy','section_head','deputy_principal'] },
  { key: 'results', label: 'Results',       Icon: ClipboardList, roles: ['admin','superadmin','teacher','deputy','section_head','deputy_principal'] },
  { key: 'entry',   label: 'Mark Entry',    Icon: PenLine,      roles: ['admin','superadmin','teacher','deputy','deputy_principal'] },
  { key: 'report',  label: 'Report Cards',  Icon: FileText,     roles: ['admin','superadmin','teacher','deputy','deputy_principal','parent','student'] },
  { key: 'config',  label: 'Configuration', Icon: Settings2,    roles: ['admin','superadmin'] },
  { key: 'remind',  label: 'Reminders',     Icon: Bell,         roles: ['admin','superadmin','teacher','deputy','deputy_principal'] },
];

/* ── Helpers ─────────────────────────────────────────────────── */
function _round(n)      { return n == null ? null : Math.round((n + 1e-10) * 10) / 10; }
function _pct(n)        { return n == null ? '—' : `${_round(n)}%`; }
function _scoreColor(s) {
  if (s == null) return 'text-slate-400';
  if (s >= 70)   return 'text-emerald-600 font-semibold';
  if (s >= 50)   return 'text-amber-600 font-semibold';
  return 'text-red-500 font-semibold';
}

/* ── Shared primitives ───────────────────────────────────────── */
function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-100 rounded-lg ${className}`} />;
}

function Toast({ msg, type = 'success', onDismiss }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [onDismiss]);
  const isErr = type === 'error';
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border shadow-sm ${
        isErr ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }`}
    >
      {isErr ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      {msg}
      <button onClick={onDismiss} className="ml-1 opacity-60 hover:opacity-100"><X size={12} /></button>
    </motion.div>
  );
}

function SelField({ label, value, onChange, options, placeholder = 'Select…', disabled }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-[140px]">
      {label && <label className="text-xs font-medium text-slate-600">{label}</label>}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 disabled:opacity-50 transition"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function iCls(error) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${
    error ? 'border-red-300' : 'border-slate-200 focus:border-slate-400'
  } bg-white focus:outline-none focus:ring-2 ${
    error ? 'focus:ring-red-500/20' : 'focus:ring-slate-900/10'
  } text-slate-800 placeholder-slate-400 transition`;
}

function TypePill({ type }) {
  return (
    <span className={`inline-flex px-2 py-0.5 text-[11px] font-semibold rounded border ${TYPE_PILL[type] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}>
      {type}
    </span>
  );
}

function StatusBadge({ status }) {
  const cfg = EXAM_STATUS_CFG[status] ?? EXAM_STATUS_CFG.draft;
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.cls}`}>{cfg.label}</span>;
}

function EmptyMsg({ icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white border border-slate-200 rounded-xl">
      <div className="mb-3 opacity-30">{icon}</div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle && <p className="text-xs mt-1 text-slate-400">{subtitle}</p>}
    </div>
  );
}

function ErrState({ msg, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 bg-white border border-red-200 rounded-xl">
      <AlertTriangle size={22} className="text-red-400" />
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

function PaginationBar({ page, totalPages, total, limit, onPage }) {
  const start = (page - 1) * limit + 1;
  const end   = Math.min(page * limit, total);
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
      <p className="text-xs text-slate-500">{total > 0 ? `${start}–${end} of ${total}` : '0 results'}</p>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(p => Math.max(1, p - 1))} disabled={page <= 1}
          className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronLeft size={14} /></button>
        <span className="text-xs text-slate-500 px-2">{page} / {totalPages}</span>
        <button onClick={() => onPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
          className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 1 — EXAMS LIST
   ══════════════════════════════════════════════════════════════ */
function ExamsListTab() {
  const qc              = useQueryClient();
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['exams', 'list', { page, search }],
    queryFn:  () => examsApi.list({ page, limit: EXAM_LIMIT, search: search || undefined }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};
  const totalPages = pagination.pages  ?? 1;
  const total      = pagination.total  ?? rows.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search exams…"
            className="w-full text-sm pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400"
          />
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition ml-auto"
        >
          <Plus size={14} />
          Create Exam
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg icon={<BookOpen size={36} />} title="No exams found" subtitle="Create your first exam to get started" />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Exam</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Class</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">Max</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(e => (
                <tr key={e._id ?? e.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-800">{e.title}</p>
                    {e.term && <p className="text-xs text-slate-400 mt-0.5">{e.term}</p>}
                  </td>
                  <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{e.subject ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{e.className ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={e.status} /></td>
                  <td className="px-4 py-3 text-right text-slate-500 hidden lg:table-cell">{e.maxScore ?? '—'}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">
                    {e.date ? new Date(e.date).toLocaleDateString('en-GB') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationBar page={page} totalPages={totalPages} total={total} limit={EXAM_LIMIT} onPage={setPage} />
        </div>
      )}

      <AnimatePresence>
        {showAdd && (
          <CreateExamSlideOver
            onClose={() => setShowAdd(false)}
            onCreated={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: ['exams'] }); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 2 — EXAM RESULTS ENTRY
   ══════════════════════════════════════════════════════════════ */
function ExamResultsTab() {
  const [examId, setExamId]   = useState('');
  const [saving, setSaving]   = useState(false);
  const [edits, setEdits]     = useState({});
  const [saved, setSaved]     = useState(false);

  const { data: examsData } = useQuery({
    queryKey: ['exams', 'list', { page: 1 }],
    queryFn:  () => examsApi.list({ limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const examsList    = examsData?.data ?? [];
  const selectedExam = examsList.find(e => (e._id ?? e.id) === examId);

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
        const sid  = s._id ?? s.id;
        const edit = edits[sid] ?? {};
        const orig = resultsMap[sid] ?? {};
        return {
          studentId: sid,
          score:     edit.score   !== undefined ? Number(edit.score)  : (orig.score   ?? null),
          grade:     edit.grade   !== undefined ? edit.grade   : (orig.grade   ?? ''),
          comment:   edit.comment !== undefined ? edit.comment : (orig.comment ?? ''),
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

  const scores  = results.map(r => r.score).filter(s => s != null && !isNaN(s));
  const maxS    = selectedExam?.maxScore ?? 100;
  const avg     = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const highest = scores.length ? Math.max(...scores) : null;
  const lowest  = scores.length ? Math.min(...scores) : null;
  const passRate = scores.length ? Math.round((scores.filter(s => (s / maxS) * 100 >= 50).length / scores.length) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-700 mb-1.5">Select Exam</label>
          <select
            value={examId}
            onChange={e => { setExamId(e.target.value); setEdits({}); setSaved(false); }}
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-800"
          >
            <option value="">Choose an exam…</option>
            {examsList.map(e => (
              <option key={e._id ?? e.id} value={e._id ?? e.id}>
                {e.title}{e.subject ? ` — ${e.subject}` : ''}{e.className ? ` (${e.className})` : ''}
              </option>
            ))}
          </select>
        </div>
        {examId && hasEdits && (
          <button onClick={saveResults} disabled={saving}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition mt-5">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : `Save results (${Object.keys(edits).length})`}
          </button>
        )}
        {saved && !hasEdits && (
          <div className="flex items-center gap-1.5 text-sm text-emerald-600 font-medium mt-5">
            <Check size={15} />Results saved
          </div>
        )}
      </div>

      {!examId ? (
        <EmptyMsg icon={<ClipboardList size={36} />} title="Select an exam" subtitle="Choose an exam above to enter or view results" />
      ) : loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : students.length === 0 ? (
        <EmptyMsg icon={<BookOpen size={36} />} title="No students in this class" subtitle="This exam's class has no active students" />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {selectedExam && (
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-4 flex-wrap">
              <p className="text-sm font-semibold text-slate-800">{selectedExam.title}</p>
              {selectedExam.subject && <span className="text-xs text-slate-500">{selectedExam.subject}</span>}
              <StatusBadge status={selectedExam.status} />
              {selectedExam.maxScore && <span className="text-xs text-slate-500">Max: {selectedExam.maxScore}</span>}
            </div>
          )}
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
                const sid     = s._id ?? s.id;
                const orig    = resultsMap[sid] ?? {};
                const edit    = edits[sid]      ?? {};
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
                      <input type="number" min="0" max={selectedExam?.maxScore ?? 9999}
                        value={score} onChange={e => setScore(sid, 'score', e.target.value)}
                        placeholder="—"
                        className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400" />
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      <input value={grade} onChange={e => setScore(sid, 'grade', e.target.value)}
                        placeholder="A, B+…"
                        className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400" />
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <input value={comment} onChange={e => setScore(sid, 'comment', e.target.value)}
                        placeholder="Optional comment…"
                        className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {hasEdits && (
            <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button onClick={saveResults} disabled={saving}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving…' : `Save results (${Object.keys(edits).length} changed)`}
              </button>
            </div>
          )}
        </div>
      )}

      {scores.length > 0 && !hasEdits && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Average Score', value: `${avg} / ${maxS}`,     Icon: TrendingUp, color: 'text-blue-600 bg-blue-50'    },
            { label: 'Highest Score', value: `${highest} / ${maxS}`, Icon: Award,      color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Lowest Score',  value: `${lowest} / ${maxS}`,  Icon: TrendingDown, color: 'text-amber-600 bg-amber-50' },
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
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   CREATE EXAM SLIDE-OVER
   ══════════════════════════════════════════════════════════════ */
const EMPTY_EXAM = { title: '', subject: '', classId: '', date: '', maxScore: '100', term: '', status: 'scheduled', description: '' };

function CreateExamSlideOver({ onClose, onCreated }) {
  const [form, setForm]     = useState(EMPTY_EXAM);
  const [errors, setErrors] = useState({});

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60_000,
  });
  const classList = classesData?.data ?? [];

  const mutation = useMutation({
    mutationFn: d => examsApi.create({ ...d, maxScore: d.maxScore ? Number(d.maxScore) : undefined }),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create exam' }),
  });

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => { const n = { ...e }; delete n[field]; return n; });
  }

  function validate() {
    const e = {};
    if (!form.title.trim())   e.title   = 'Title is required';
    if (!form.subject.trim()) e.subject = 'Subject is required';
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
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Create Exam</h2>
            <p className="text-xs text-slate-400 mt-0.5">Schedule a new exam or test</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={15} className="shrink-0" />{errors._server}
            </div>
          )}
          <FField label="Exam Title *" error={errors.title}>
            <input value={form.title} onChange={e => set('title', e.target.value)} placeholder="e.g. End of Term Mathematics" className={iCls(errors.title)} />
          </FField>
          <div className="grid grid-cols-2 gap-4">
            <FField label="Subject *" error={errors.subject}>
              <input value={form.subject} onChange={e => set('subject', e.target.value)} placeholder="e.g. Mathematics" className={iCls(errors.subject)} />
            </FField>
            <FField label="Term / Period">
              <input value={form.term} onChange={e => set('term', e.target.value)} placeholder="e.g. Term 1" className={iCls()} />
            </FField>
          </div>
          <FField label="Class">
            <select value={form.classId} onChange={e => set('classId', e.target.value)} className={iCls()}>
              <option value="">No class (all)</option>
              {classList.map(c => <option key={c._id ?? c.id} value={c._id ?? c.id}>{c.name}</option>)}
            </select>
          </FField>
          <div className="grid grid-cols-2 gap-4">
            <FField label="Date">
              <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={iCls()} />
            </FField>
            <FField label="Max Score">
              <input type="number" min="1" value={form.maxScore} onChange={e => set('maxScore', e.target.value)} placeholder="100" className={iCls()} />
            </FField>
          </div>
          <FField label="Status">
            <select value={form.status} onChange={e => set('status', e.target.value)} className={iCls()}>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="active">Active</option>
              <option value="in_progress">In Progress</option>
            </select>
          </FField>
          <FField label="Description">
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} placeholder="Optional notes…" className={`${iCls()} resize-none`} />
          </FField>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
          <button onClick={submit} disabled={mutation.isPending}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition">
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Creating…' : 'Create Exam'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 3 — MARK ENTRY (CA / HW / MT / ET)
   ══════════════════════════════════════════════════════════════ */
function MarkEntryTab() {
  const qc = useQueryClient();
  const [classId,        setClassId]        = useState('');
  const [subjectId,      setSubjectId]      = useState('');
  const [termNumber,     setTermNumber]      = useState('');
  const [assessmentType, setAssessmentType]  = useState('');
  const [instance,       setInstance]        = useState('1');
  const [scores,         setScores]          = useState({});
  const [toast,          setToast]           = useState(null);

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'list'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const classesList = classesData?.data ?? [];

  const { data: configData } = useQuery({
    queryKey: ['assessment', 'config'],
    queryFn:  () => api.getConfig(),
    staleTime: 5 * 60_000,
  });
  const cfg       = configData?.data ?? {};
  const instances = cfg.instances ?? { CA: 2, HW: 2 };
  const maxInst   = assessmentType === 'CA' ? (instances.CA ?? 2)
                  : assessmentType === 'HW' ? (instances.HW ?? 2)
                  : 1;

  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['classes', classId, 'students'],
    queryFn:  () => classesApi.students(classId),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
  });
  const students = studentsData?.data ?? [];

  const canQuery = !!(classId && subjectId && termNumber && assessmentType);
  const { data: existingData } = useQuery({
    queryKey: ['assessment', 'marks', { classId, subjectId, termNumber, assessmentType, instance }],
    queryFn:  () => api.getMarks({ classId, subjectId, termNumber: Number(termNumber), assessmentType }),
    enabled:  canQuery,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!existingData) return;
    const map = {};
    for (const m of (existingData?.data ?? [])) {
      if (String(m.instance) === String(instance)) {
        map[m.studentId] = m.rawScore;
      }
    }
    setScores(map);
  }, [existingData, instance]);

  const { mutate: submitMarks, isPending: submitting } = useMutation({
    mutationFn: () => api.bulkMarks({
      marks: students
        .filter(s => scores[s._id ?? s.id] != null)
        .map(s => ({
          studentId:      s._id ?? s.id,
          subjectId,
          classId,
          termNumber:     Number(termNumber),
          assessmentType,
          instance:       Number(instance),
          rawScore:       Number(scores[s._id ?? s.id]),
        })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'marks'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'report'] });
      setToast({ msg: 'Marks saved successfully.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save marks.', type: 'error' }),
  });

  const vals  = useMemo(() => Object.values(scores).filter(v => v != null).map(Number), [scores]);
  const avg   = vals.length ? vals.reduce((s, n) => s + n, 0) / vals.length : null;
  const pass  = vals.filter(v => v >= 50).length;
  const ready = canQuery && students.length > 0;

  return (
    <div className="space-y-4">
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Select Assessment</p>
        <div className="flex flex-wrap gap-3">
          <SelField label="Class" value={classId} onChange={setClassId}
            options={classesList.map(c => ({ value: c._id ?? c.id, label: c.name }))} placeholder="Select class" />
          <div className="flex flex-col gap-1.5 min-w-[160px]">
            <label className="text-xs font-medium text-slate-600">Subject</label>
            <input type="text" value={subjectId} onChange={e => setSubjectId(e.target.value)}
              placeholder="e.g. Mathematics" className={iCls()} />
          </div>
          <SelField label="Term" value={termNumber} onChange={setTermNumber}
            options={TERM_NUMBERS.map(n => ({ value: String(n), label: `Term ${n}` }))} placeholder="Select term" />
          <SelField label="Assessment type" value={assessmentType}
            onChange={v => { setAssessmentType(v); setInstance('1'); }}
            options={ASSESSMENT_TYPES.map(t => ({ value: t, label: `${t} — ${TYPE_LABELS[t]}` }))} placeholder="Select type" />
          {maxInst > 1 && (
            <SelField label="Instance" value={instance} onChange={setInstance} placeholder=""
              options={Array.from({ length: maxInst }, (_, i) => ({ value: String(i + 1), label: `${assessmentType} ${i + 1}` }))} />
          )}
        </div>
      </div>

      {!ready ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <PenLine size={24} className="text-slate-300" />
          <p className="text-sm font-medium text-slate-500">Select class, subject, term and assessment type above</p>
        </div>
      ) : studentsLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : students.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <BookOpen size={24} className="text-slate-300" />
          <p className="text-sm text-slate-500">No students in this class.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100 bg-slate-50/50">
            <div>
              <div className="flex items-center gap-2">
                <TypePill type={assessmentType} />
                <span className="text-sm font-semibold text-slate-800">
                  {assessmentType} {maxInst > 1 ? instance : ''} — {subjectId} — Term {termNumber}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Enter marks out of 100</p>
            </div>
            <button onClick={() => submitMarks()} disabled={submitting || vals.length === 0}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
              {submitting ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {submitting ? 'Saving…' : 'Save marks'}
            </button>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-xs font-medium text-slate-500 px-5 py-2.5 w-8">#</th>
                <th className="text-left text-xs font-medium text-slate-500 px-2 py-2.5">Student</th>
                <th className="text-left text-xs font-medium text-slate-500 px-2 py-2.5 hidden sm:table-cell">Adm. No.</th>
                <th className="text-right text-xs font-medium text-slate-500 px-5 py-2.5 w-32">Score /100</th>
                <th className="text-right text-xs font-medium text-slate-500 px-5 py-2.5 w-20 hidden md:table-cell">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((s, i) => {
                const sid   = s._id ?? s.id;
                const score = scores[sid];
                return (
                  <tr key={sid} className="hover:bg-slate-50 transition">
                    <td className="px-5 py-2.5 text-xs text-slate-400">{i + 1}</td>
                    <td className="px-2 py-2.5 font-medium text-slate-800">{s.firstName} {s.lastName}</td>
                    <td className="px-2 py-2.5 text-xs text-slate-400 hidden sm:table-cell">{s.admissionNumber ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right">
                      <input type="number" min="0" max="100" step="0.5"
                        value={score ?? ''}
                        onChange={e => {
                          const v = e.target.value === '' ? undefined : Number(e.target.value);
                          setScores(prev => ({ ...prev, [sid]: v }));
                        }}
                        className="w-20 rounded-lg border border-slate-200 px-3 py-1.5 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 transition"
                        placeholder="—" />
                    </td>
                    <td className="px-5 py-2.5 text-right hidden md:table-cell">
                      {score == null ? (
                        <span className="text-xs text-slate-300">—</span>
                      ) : score >= 50 ? (
                        <span className="inline-flex px-2 py-0.5 text-[11px] font-medium rounded border bg-emerald-50 text-emerald-700 border-emerald-200">Pass</span>
                      ) : (
                        <span className="inline-flex px-2 py-0.5 text-[11px] font-medium rounded border bg-red-50 text-red-600 border-red-200">Fail</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {vals.length > 0 && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 px-5 py-3 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-500">
              <span>Entered: <strong className="text-slate-700">{vals.length}/{students.length}</strong></span>
              <span>Avg: <strong className={_scoreColor(avg)}>{_pct(avg)}</strong></span>
              <span>Pass rate: <strong className="text-slate-700">{Math.round((pass / vals.length) * 100)}%</strong></span>
              <span>Highest: <strong className="text-emerald-600">{Math.max(...vals)}%</strong></span>
              <span>Lowest: <strong className="text-red-500">{Math.min(...vals)}%</strong></span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 4 — REPORT CARDS
   ══════════════════════════════════════════════════════════════ */
function ReportCardsTab() {
  const [classId,   setClassId]   = useState('');
  const [studentId, setStudentId] = useState('');
  const [termNum,   setTermNum]   = useState('');
  const [half,      setHalf]      = useState(false);

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'list'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const classesList = classesData?.data ?? [];

  const { data: studentsData } = useQuery({
    queryKey: ['classes', classId, 'students'],
    queryFn:  () => classesApi.students(classId),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
  });
  const studentsList = studentsData?.data ?? [];

  const canQuery = !!(studentId || classId);
  const { data: reportData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['assessment', 'report', { classId, studentId, termNum, half }],
    queryFn:  () => api.report({
      ...(studentId ? { studentId } : { classId }),
      ...(termNum   ? { termNumber: termNum } : {}),
      half: half ? 'true' : undefined,
    }),
    enabled:   canQuery,
    staleTime: 60_000,
  });

  const reportCfg      = reportData?.config ?? {};
  const weights        = reportCfg.weights  ?? DEFAULT_WEIGHTS;
  const template       = reportCfg.reportTemplate ?? 'detailed';
  const reportStudents = reportData?.students ?? (reportData?.student ? [reportData.student] : []);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Select Report</p>
        <div className="flex flex-wrap gap-3 items-end">
          <SelField label="Class" value={classId}
            onChange={v => { setClassId(v); setStudentId(''); }}
            options={classesList.map(c => ({ value: c._id ?? c.id, label: c.name }))} placeholder="Select class" />
          {classId && (
            <SelField label="Student (optional)" value={studentId} onChange={setStudentId}
              options={studentsList.map(s => ({ value: s._id ?? s.id, label: `${s.firstName} ${s.lastName}` }))}
              placeholder="All students" />
          )}
          <SelField label="Term" value={termNum} onChange={setTermNum}
            options={TERM_NUMBERS.map(n => ({ value: String(n), label: `Term ${n}` }))} placeholder="All terms" />
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer self-end pb-2">
            <input type="checkbox" checked={half} onChange={e => setHalf(e.target.checked)}
              className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/10" />
            Half-term view
          </label>
        </div>
      </div>

      {!canQuery ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <FileText size={24} className="text-slate-300" />
          <p className="text-sm text-slate-500">Select a class or student to view report cards.</p>
        </div>
      ) : isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : isError ? (
        <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
          <AlertTriangle size={20} className="text-red-400" />
          <p className="text-sm text-slate-600">{error?.message ?? 'Failed to load report data.'}</p>
          <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
        </div>
      ) : reportStudents.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <ClipboardList size={24} className="text-slate-300" />
          <p className="text-sm font-medium text-slate-600">No assessment data found</p>
          <p className="text-xs text-slate-400">Enter marks using the Mark Entry tab first.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            {ASSESSMENT_TYPES.map(t => (
              <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 border border-slate-200 px-2.5 py-1 text-xs text-slate-600">
                <TypePill type={t} />{weights[t]}%
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-xs text-indigo-700">
              {template === 'detailed' ? 'Template A — Detailed' : 'Template B — Summary'}
            </span>
            {half && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs text-amber-700">
                Half-term view
              </span>
            )}
          </div>
          {reportStudents.map(stu => (
            <StudentReportCard key={stu.studentId} student={stu} studentsList={studentsList}
              template={template} half={half} termNum={termNum} />
          ))}
        </div>
      )}
    </div>
  );
}

function StudentReportCard({ student, studentsList, template, half, termNum }) {
  const subjects    = Object.entries(student.subjects ?? {});
  const termsToShow = termNum ? [Number(termNum)] : TERM_NUMBERS;

  const match = studentsList.find(s => (s._id ?? s.id) === student.studentId);
  const name  = match ? `${match.firstName} ${match.lastName}` : (student.studentId ?? '—');
  const admNo = match?.admissionNumber ?? '';

  if (!subjects.length) return null;

  function printCard() {
    const rows = subjects.map(([subId, data]) => {
      if (template === 'summary') {
        const t1 = data.terms?.[1]?.termTotal, t2 = data.terms?.[2]?.termTotal, t3 = data.terms?.[3]?.termTotal;
        return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${subId}</td><td style="text-align:right;padding:6px 12px;border-bottom:1px solid #eee">${t1!=null?t1.toFixed(1)+'%':'—'}</td><td style="text-align:right;padding:6px 12px;border-bottom:1px solid #eee">${t2!=null?t2.toFixed(1)+'%':'—'}</td><td style="text-align:right;padding:6px 12px;border-bottom:1px solid #eee">${t3!=null?t3.toFixed(1)+'%':'—'}</td><td style="text-align:right;padding:6px 12px;border-bottom:1px solid #eee;font-weight:bold">${data.summaryAverage!=null?data.summaryAverage.toFixed(1)+'%':'—'}</td></tr>`;
      }
      return termsToShow.map(tn => { const t = data.terms?.[tn]; return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${subId} (T${tn})</td><td style="text-align:right;padding:6px 12px;border-bottom:1px solid #eee">${t?.finalGrade!=null?t.finalGrade.toFixed(1)+'%':'—'}</td></tr>`; }).join('');
    }).join('');
    const html = `<html><head><title>Report Card — ${name}</title><style>body{font-family:Arial,sans-serif;max-width:700px;margin:30px auto;font-size:13px}h2{margin-bottom:4px}table{width:100%;border-collapse:collapse}th{background:#f1f5f9;padding:8px 12px;text-align:left;font-size:12px}@media print{}</style></head><body><h2>Report Card: ${name}</h2>${admNo?`<p style="color:#666;font-size:12px">Adm No: ${admNo}</p>`:''}<table><thead><tr>${template==='summary'?'<th>Subject</th><th style="text-align:right">T1</th><th style="text-align:right">T2</th><th style="text-align:right">T3</th><th style="text-align:right">Final Avg</th>':'<th>Subject</th><th style="text-align:right">Final Grade</th>'}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const w = window.open('', '_blank', 'width=780,height=900');
    w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">{name}</p>
          {admNo && <p className="text-xs text-slate-400">{admNo}</p>}
        </div>
        <div className="flex items-center gap-2">
          {student.classId && <span className="text-xs text-slate-400">{student.classId}</span>}
          <button onClick={printCard} title="Print report card"
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">
            <Printer size={13} />
          </button>
        </div>
      </div>

      {template === 'summary' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5">Subject</th>
                {TERM_NUMBERS.map(n => (
                  <th key={n} className="text-right text-xs font-medium text-slate-500 px-4 py-2.5">Term {n}</th>
                ))}
                <th className="text-right text-xs font-medium text-slate-700 px-4 py-2.5 bg-slate-100/50">Final avg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subjects.map(([subId, data]) => {
                const t1 = data.terms?.[1]?.termTotal;
                const t2 = data.terms?.[2]?.termTotal;
                const t3 = data.terms?.[3]?.termTotal;
                return (
                  <tr key={subId} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{subId}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${_scoreColor(t1)}`}>{_pct(t1)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${_scoreColor(t2)}`}>{_pct(t2)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${_scoreColor(t3)}`}>{_pct(t3)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-bold bg-slate-50 ${_scoreColor(data.summaryAverage)}`}>
                      {_pct(data.summaryAverage)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        termsToShow.map(termN => (
          <div key={termN} className="border-b border-slate-100 last:border-0">
            <div className="px-5 py-2 bg-indigo-50/60 border-b border-indigo-100">
              <p className="text-xs font-semibold text-indigo-700">
                {half ? `Term ${termN} — Half-Term Report` : `Term ${termN} Report`}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left text-xs font-medium text-slate-500 px-4 py-2.5">Subject</th>
                    <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5">CA avg</th>
                    <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5">HW avg</th>
                    <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5">MT</th>
                    {!half && <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5">ET</th>}
                    {!half && <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5">Term total</th>}
                    {half  && <th className="text-right text-xs font-medium text-amber-600 px-3 py-2.5 bg-amber-50/40">Half-term /100</th>}
                    {!half && termN >= 2 && <th className="text-right text-xs text-slate-400 px-3 py-2.5">ET avg (ref)</th>}
                    {!half && <th className="text-right text-xs font-bold text-slate-700 px-4 py-2.5 bg-slate-50/60">Final grade</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {subjects.map(([subId, data]) => {
                    const t = data.terms?.[termN];
                    if (!t) return (
                      <tr key={subId}>
                        <td className="px-4 py-2.5 text-slate-400 text-xs italic" colSpan={8}>
                          {subId} — no data for Term {termN}
                        </td>
                      </tr>
                    );
                    return (
                      <tr key={subId} className="hover:bg-slate-50 transition">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{subId}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${_scoreColor(t.typeAvgs?.CA)}`}>{_pct(t.typeAvgs?.CA)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${_scoreColor(t.typeAvgs?.HW)}`}>{_pct(t.typeAvgs?.HW)}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums ${_scoreColor(t.typeAvgs?.MT)}`}>{_pct(t.typeAvgs?.MT)}</td>
                        {!half && <td className={`px-3 py-2.5 text-right tabular-nums ${_scoreColor(t.typeAvgs?.ET)}`}>{_pct(t.typeAvgs?.ET)}</td>}
                        {!half && <td className={`px-3 py-2.5 text-right tabular-nums ${_scoreColor(t.termTotal)}`}>{_pct(t.termTotal)}</td>}
                        {half  && <td className={`px-3 py-2.5 text-right tabular-nums font-semibold bg-amber-50/40 ${_scoreColor(t.halfTermTotal)}`}>{_pct(t.halfTermTotal)}</td>}
                        {!half && termN >= 2 && <td className={`px-3 py-2.5 text-right tabular-nums text-slate-400 ${_scoreColor(t.etRunningAvg)}`}>{_pct(t.etRunningAvg)}</td>}
                        {!half && <td className={`px-4 py-2.5 text-right tabular-nums font-bold bg-slate-50/60 ${_scoreColor(t.finalGrade)}`}>{_pct(t.finalGrade)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 5 — CONFIGURATION
   ══════════════════════════════════════════════════════════════ */
function ConfigTab() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);

  const { data: configData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['assessment', 'config'],
    queryFn:  () => api.getConfig(),
    staleTime: 5 * 60_000,
  });
  const cfg = configData?.data ?? {};

  const [weights,   setWeights]   = useState(null);
  const [template,  setTemplate]  = useState(null);
  const [instances, setInstances] = useState(null);

  const activeWeights   = weights   ?? cfg.weights        ?? DEFAULT_WEIGHTS;
  const activeTemplate  = template  ?? cfg.reportTemplate ?? 'detailed';
  const activeInstances = instances ?? cfg.instances       ?? { CA: 2, HW: 2 };

  const weightTotal = Object.values(activeWeights).reduce((s, n) => s + Number(n), 0);
  const weightOk    = Math.abs(weightTotal - 100) < 0.01;

  const { mutate: saveConfig, isPending: saving } = useMutation({
    mutationFn: () => api.updateConfig({
      weights: activeWeights, reportTemplate: activeTemplate, instances: activeInstances,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'config'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'report'] });
      setWeights(null); setTemplate(null); setInstances(null);
      setToast({ msg: 'Configuration saved.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save config.', type: 'error' }),
  });

  const { data: schedData, refetch: refetchSched } = useQuery({
    queryKey: ['assessment', 'schedule'],
    queryFn:  () => api.getSchedule(),
    staleTime: 60_000,
  });
  const schedules = schedData?.data ?? [];

  const EMPTY_SCHED = { termNumber: 1, assessmentType: 'CA', instance: 1, dateFrom: '', dateTo: '' };
  const [newSched, setNewSched] = useState(EMPTY_SCHED);

  const { mutate: saveSched, isPending: savingSched } = useMutation({
    mutationFn: () => api.upsertSchedule(newSched),
    onSuccess:  () => { refetchSched(); setNewSched(EMPTY_SCHED); },
    onError:    err => setToast({ msg: err?.message ?? 'Failed to save schedule.', type: 'error' }),
  });
  const { mutate: delSched } = useMutation({
    mutationFn: id => api.deleteSchedule(id),
    onSuccess:  () => refetchSched(),
  });

  if (isLoading) return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>;
  if (isError)   return (
    <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
      <AlertTriangle size={20} className="text-red-400" />
      <p className="text-sm text-slate-600">{error?.message ?? 'Failed to load config.'}</p>
      <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
    </div>
  );

  const TEMPLATE_OPTIONS = [
    { key: 'detailed', Icon: ClipboardList, title: 'Template A — Detailed', desc: 'Shows CA, HW, MT, ET scores per term with ET reference columns and blended final grade.' },
    { key: 'summary',  Icon: TrendingUp,    title: 'Template B — Summary',  desc: 'Shows term averages only (T1, T2, T3) with equal-weight final average.' },
  ];

  return (
    <div className="space-y-4">
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Assessment Weights</h3>
        <p className="text-xs text-slate-400 mb-4">Must total exactly 100%.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {ASSESSMENT_TYPES.map(type => (
            <div key={type}>
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1.5">
                <TypePill type={type} />{TYPE_LABELS[type]}
              </label>
              <div className="relative">
                <input type="number" min="0" max="100" step="1"
                  value={activeWeights[type] ?? 0}
                  onChange={e => setWeights({ ...activeWeights, [type]: Number(e.target.value) })}
                  className={`${iCls()} pr-8 text-right`} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">%</span>
              </div>
            </div>
          ))}
        </div>
        <div className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${
          weightOk ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {weightOk ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          Total: <strong>{_round(weightTotal)}%</strong>
          {!weightOk && <span className="ml-1">— must equal exactly 100%</span>}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Assessment Instances per Term</h3>
        <p className="text-xs text-slate-400 mb-4">How many CA and HW assessments per term? Scores are averaged before weighting.</p>
        <div className="flex flex-wrap gap-6">
          {['CA', 'HW'].map(type => (
            <div key={type}>
              <label className="text-xs font-medium text-slate-600 mb-1.5 flex items-center gap-1.5">
                <TypePill type={type} />{TYPE_LABELS[type]}
              </label>
              <select value={activeInstances[type] ?? 2}
                onChange={e => setInstances({ ...activeInstances, [type]: Number(e.target.value) })}
                className={`${iCls()} w-32`}>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} per term</option>)}
              </select>
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">MT &amp; ET</label>
            <div className="w-32 text-sm px-3 py-2 rounded-lg border border-slate-100 bg-slate-50 text-slate-400 select-none">1 (fixed)</div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Report Card Template</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {TEMPLATE_OPTIONS.map(({ key, Icon, title, desc }) => (
            <button key={key} onClick={() => setTemplate(key)}
              className={`text-left rounded-xl border-2 p-4 transition ${
                activeTemplate === key ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'
              }`}>
              <Icon size={18} className={`mb-2 ${activeTemplate === key ? 'text-slate-800' : 'text-slate-400'}`} />
              <p className="text-sm font-semibold text-slate-800">{title}</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => saveConfig()} disabled={saving || !weightOk}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save configuration'}
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Assessment Schedule</h3>
        <p className="text-xs text-slate-400 mb-4">Set date windows — teachers are reminded automatically when an assessment opens.</p>
        <div className="flex flex-wrap gap-3 items-end p-4 bg-slate-50 rounded-xl border border-slate-100 mb-4">
          <SelField label="Term" value={String(newSched.termNumber)} placeholder=""
            onChange={v => setNewSched(p => ({ ...p, termNumber: Number(v) }))}
            options={TERM_NUMBERS.map(n => ({ value: String(n), label: `Term ${n}` }))} />
          <SelField label="Type" value={newSched.assessmentType} placeholder=""
            onChange={v => setNewSched(p => ({ ...p, assessmentType: v, instance: 1 }))}
            options={ASSESSMENT_TYPES.map(t => ({ value: t, label: t }))} />
          <SelField label="Instance" value={String(newSched.instance)} placeholder=""
            onChange={v => setNewSched(p => ({ ...p, instance: Number(v) }))}
            options={[1, 2, 3, 4].map(n => ({ value: String(n), label: String(n) }))} />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-600">From</label>
            <input type="date" value={newSched.dateFrom}
              onChange={e => setNewSched(p => ({ ...p, dateFrom: e.target.value }))} className={iCls()} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-600">To</label>
            <input type="date" value={newSched.dateTo}
              onChange={e => setNewSched(p => ({ ...p, dateTo: e.target.value }))} className={iCls()} />
          </div>
          <button onClick={() => saveSched()} disabled={savingSched || !newSched.dateFrom || !newSched.dateTo}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition self-end">
            {savingSched ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Add
          </button>
        </div>

        {schedules.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No schedule entries yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">Assessment</th>
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">Term</th>
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">From</th>
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">To</th>
                <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schedules.map(s => (
                <tr key={s.id ?? s._id} className="hover:bg-slate-50 transition">
                  <td className="px-3 py-2.5">
                    <TypePill type={s.assessmentType} />
                    <span className="ml-1.5 text-xs text-slate-600">{s.instance > 1 ? `${s.assessmentType} ${s.instance}` : ''}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">Term {s.termNumber}</td>
                  <td className="px-3 py-2.5 text-slate-500 text-xs font-mono">{s.dateFrom}</td>
                  <td className="px-3 py-2.5 text-slate-500 text-xs font-mono">{s.dateTo}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button onClick={() => delSched(s.id ?? s._id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 6 — REMINDERS
   ══════════════════════════════════════════════════════════════ */
const REMINDER_CONFIG = {
  overdue:  { label: 'Overdue',  bg: 'bg-red-50 border-red-200',         text: 'text-red-700',     Icon: AlertTriangle },
  open:     { label: 'Open',     bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', Icon: CheckCircle2  },
  upcoming: { label: 'Upcoming', bg: 'bg-blue-50 border-blue-200',       text: 'text-blue-700',    Icon: Calendar      },
};

function RemindersTab() {
  const qc  = useQueryClient();
  const [toast, setToast] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['assessment', 'reminders'],
    queryFn:  () => api.reminders({ days: 14 }),
    staleTime: 60_000,
  });
  const reminders = data?.data ?? [];

  const { mutate: notify, isPending: notifying } = useMutation({
    mutationFn: () => api.notify({}),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'reminders'] });
      setToast({ msg: 'Notification sent to teachers.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Notification failed.', type: 'error' }),
  });

  const overdue  = reminders.filter(r => r.status === 'overdue').length;
  const open     = reminders.filter(r => r.status === 'open').length;
  const upcoming = reminders.filter(r => r.status === 'upcoming').length;

  return (
    <div className="space-y-4">
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex gap-3 text-xs text-slate-500">
          <span className="text-red-600 font-medium">{overdue} overdue</span>
          <span>·</span>
          <span className="text-emerald-600 font-medium">{open} open</span>
          <span>·</span>
          <span className="text-blue-600 font-medium">{upcoming} upcoming</span>
          <span className="text-slate-400">— next 14 days</span>
        </div>
        <button onClick={() => notify()} disabled={notifying || reminders.length === 0}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          {notifying ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          {notifying ? 'Sending…' : 'Notify teachers'}
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : isError ? (
        <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
          <AlertTriangle size={20} className="text-red-400" />
          <p className="text-sm text-slate-600">{error?.message}</p>
          <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
        </div>
      ) : reminders.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <CheckCircle2 size={24} className="text-emerald-400" />
          <p className="text-sm font-medium text-slate-600">All clear</p>
          <p className="text-xs text-slate-400">No overdue or upcoming assessments in the next 14 days.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {reminders.map(r => {
            const cfg = REMINDER_CONFIG[r.status] ?? REMINDER_CONFIG.upcoming;
            const { Icon } = cfg;
            return (
              <div key={r.scheduleId} className={`rounded-xl border p-4 ${cfg.bg}`}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Icon size={16} className={`mt-0.5 shrink-0 ${cfg.text}`} />
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold ${cfg.text}`}>{cfg.label}</span>
                        <TypePill type={r.assessmentType ?? r.label?.split(' ')[0]} />
                        <span className="text-sm font-semibold text-slate-800">
                          {r.label ?? `${r.assessmentType} ${r.instance}`} — Term {r.termNumber}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 font-mono">{r.dateFrom} → {r.dateTo}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-slate-700 tabular-nums">{r.marksEntered ?? 0}</p>
                    <p className="text-xs text-slate-400">marks entered</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════ */
export default function GradesPage() {
  const role = useAuthStore(s => s.session?.user?.role ?? 'teacher');
  const [tab, setTab] = useState('exams');

  const visibleTabs = TABS.filter(t => t.roles.includes(role));

  useEffect(() => {
    if (!visibleTabs.find(t => t.key === tab)) {
      setTab(visibleTabs[0]?.key ?? 'exams');
    }
  }, [role]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-screen-2xl mx-auto px-6 py-5">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Exams &amp; Assessment</h1>
              <p className="text-sm text-slate-500 mt-0.5">Exam scheduling, results, continuous assessment and report cards</p>
            </div>
          </div>
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {visibleTabs.map(({ key, label, Icon }) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                  tab === key
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}>
                <Icon size={13} />{label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
            {tab === 'exams'   && <ExamsListTab />}
            {tab === 'results' && <ExamResultsTab />}
            {tab === 'entry'   && <MarkEntryTab />}
            {tab === 'report'  && <ReportCardsTab />}
            {tab === 'config'  && <ConfigTab />}
            {tab === 'remind'  && <RemindersTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
