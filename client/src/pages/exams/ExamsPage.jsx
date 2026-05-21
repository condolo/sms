/* ============================================================
   Exams & Grades — Premium 3-Tab: Exams · Results · Grade Report
   /platform-audit: Added Create Exam slide-over, Results entry,
   class/exam filter on grade report, replaced emoji icons
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileText, BarChart3, ClipboardList, Plus, X, Loader2,
  CheckCircle2, AlertTriangle, ChevronLeft, ChevronRight,
  Search, Calendar, BookOpen, Layers, Save, Check,
  Download, TrendingUp, Award, Users2,
} from 'lucide-react';
import { exams as examsApi, grades as gradesApi, classes as classesApi } from '@/api/client.js';

const LIMIT = 20;

/* ══════════════════════════════════════════════════════════════ */
export default function ExamsPage() {
  const [tab, setTab] = useState('exams');

  const TABS = [
    { id: 'exams',   label: 'Exams',       icon: FileText     },
    { id: 'results', label: 'Results',      icon: ClipboardList },
    { id: 'grades',  label: 'Grade Report', icon: BarChart3    },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-xl mx-auto">
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Exams & Grades</h1>
          <p className="text-sm text-slate-500 mt-0.5">Create exams, enter results and view grade reports</p>
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
          {tab === 'exams'   && <ExamsTab   key="exams"   />}
          {tab === 'results' && <ResultsTab key="results" />}
          {tab === 'grades'  && <GradesTab  key="grades"  />}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Status badge config ─────────────────────────────────────── */
const STATUS_CFG = {
  draft:     { label: 'Draft',     cls: 'bg-slate-100 text-slate-600 border-slate-200'  },
  scheduled: { label: 'Scheduled', cls: 'bg-blue-50   text-blue-700  border-blue-200'   },
  active:    { label: 'Active',    cls: 'bg-violet-50  text-violet-700 border-violet-200' },
  completed: { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-50    text-red-700   border-red-200'    },
};
function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.draft;
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.cls}`}>{cfg.label}</span>;
}

/* ── Exams Tab ──────────────────────────────────────────────── */
function ExamsTab() {
  const qc             = useQueryClient();
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['exams', 'list', { page, search }],
    queryFn:  () => examsApi.list({ page, limit: LIMIT, search: search || undefined }),
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
            placeholder="Search exams…"
            className="w-full text-sm pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400"
          />
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors ml-auto"
        >
          <Plus size={14} />
          Create Exam
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
        <EmptyMsg icon={<FileText size={36} />} title="No exams found" subtitle="Create your first exam to get started" />
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
                <tr key={e._id} className="hover:bg-slate-50 transition-colors">
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
          <PaginationBar page={page} totalPages={totalPages} total={total} limit={LIMIT} onPage={setPage} />
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
    </motion.div>
  );
}

/* ── Results Tab ────────────────────────────────────────────── */
function ResultsTab() {
  const [examId, setExamId]   = useState('');
  const [saving, setSaving]   = useState(false);
  const [edits, setEdits]     = useState({});   // { studentId: { score, grade, comment } }
  const [saved, setSaved]     = useState(false);

  /* Load exams for selector */
  const { data: examsData } = useQuery({
    queryKey: ['exams', 'list', { page: 1 }],
    queryFn:  () => examsApi.list({ limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const examsList    = examsData?.data ?? [];
  const selectedExam = examsList.find(e => (e._id ?? e.id) === examId);

  /* Load existing results for selected exam */
  const { data: resultsData, isLoading: resultsLoading, refetch: refetchResults } = useQuery({
    queryKey: ['exams', examId, 'results'],
    queryFn:  () => examsApi.results.list(examId, { limit: 200 }),
    enabled:  !!examId,
    staleTime: 0,
  });
  const results    = resultsData?.data ?? [];
  const resultsMap = Object.fromEntries(results.map(r => [r.studentId, r]));

  /* Load students in the exam's class */
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
          score:     edit.score  !== undefined ? Number(edit.score)  : (orig.score ?? null),
          grade:     edit.grade  !== undefined ? edit.grade  : (orig.grade  ?? ''),
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

  /* Stats computed from saved results */
  const scores = results.map(r => r.score).filter(s => s != null && !isNaN(s));
  const maxS   = selectedExam?.maxScore ?? 100;
  const avg    = scores.length ? Math.round(scores.reduce((a,b) => a+b, 0) / scores.length) : null;
  const highest = scores.length ? Math.max(...scores) : null;
  const lowest  = scores.length ? Math.min(...scores) : null;
  const passRate = scores.length ? Math.round((scores.filter(s => (s/maxS)*100 >= 50).length / scores.length) * 100) : null;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      {/* Exam selector + save */}
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
              <option key={e._id ?? e.id} value={e._id ?? e.id}>{e.title}{e.subject ? ` — ${e.subject}` : ''}{e.className ? ` (${e.className})` : ''}</option>
            ))}
          </select>
        </div>
        {examId && hasEdits && (
          <button
            onClick={saveResults}
            disabled={saving}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors mt-5"
          >
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

      {/* Results table */}
      {!examId ? (
        <EmptyMsg icon={<ClipboardList size={36} />} title="Select an exam" subtitle="Choose an exam above to enter or view results" />
      ) : loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-14 animate-pulse" />)}
        </div>
      ) : students.length === 0 ? (
        <EmptyMsg icon={<BookOpen size={36} />} title="No students in this class" subtitle="This exam's class has no active students" />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* Exam info strip */}
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
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Score{selectedExam?.maxScore ? ` /${selectedExam.maxScore}` : ''}</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-24 hidden sm:table-cell">Grade</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Comment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {students.map(s => {
                const sid    = s._id ?? s.id;
                const orig   = resultsMap[sid]   ?? {};
                const edit   = edits[sid]         ?? {};
                const score  = edit.score  !== undefined ? edit.score  : (orig.score  ?? '');
                const grade  = edit.grade  !== undefined ? edit.grade  : (orig.grade  ?? '');
                const comment = edit.comment !== undefined ? edit.comment : (orig.comment ?? '');
                const changed = edit.score !== undefined || edit.grade !== undefined || edit.comment !== undefined;

                return (
                  <tr key={sid} className={`hover:bg-slate-50 transition-colors ${changed ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-800">{s.firstName} {s.lastName}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number"
                        min="0"
                        max={selectedExam?.maxScore ?? 9999}
                        value={score}
                        onChange={e => setScore(sid, 'score', e.target.value)}
                        placeholder="—"
                        className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-800"
                      />
                    </td>
                    <td className="px-4 py-2.5 hidden sm:table-cell">
                      <input
                        value={grade}
                        onChange={e => setScore(sid, 'grade', e.target.value)}
                        placeholder="A, B+…"
                        className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-800"
                      />
                    </td>
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <input
                        value={comment}
                        onChange={e => setScore(sid, 'comment', e.target.value)}
                        placeholder="Optional comment…"
                        className="w-full text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-800"
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
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving…' : `Save results (${Object.keys(edits).length} changed)`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Stats bar — visible when exam has saved results */}
      {scores.length > 0 && !hasEdits && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Average Score', value: `${avg} / ${maxS}`, Icon: TrendingUp, color: 'text-blue-600 bg-blue-50' },
            { label: 'Highest Score', value: `${highest} / ${maxS}`, Icon: Award, color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Lowest Score',  value: `${lowest} / ${maxS}`, Icon: TrendingUp, color: 'text-amber-600 bg-amber-50' },
            { label: 'Pass Rate',     value: `${passRate}%`, Icon: Users2, color: passRate >= 50 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50' },
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

/* ── Grade Report Tab ───────────────────────────────────────── */
function GradesTab() {
  const [classId, setClassId]   = useState('');
  const [examId, setExamId]     = useState('');
  const [subject, setSubject]   = useState('');

  function exportCSV(rows) {
    const header = 'Student,Subject,Exam,Avg %,Grade';
    const lines  = rows.map(r =>
      [r.studentName ?? r.studentId, r.subject ?? '', r.examTitle ?? '',
       r.avgPct != null ? `${Math.round(r.avgPct)}%` : (r.score ?? ''), r.grade ?? '']
      .map(v => `"${String(v).replace(/"/g,'""')}"`)
      .join(',')
    );
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'grade-report.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  /* Classes */
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60_000,
  });
  const classList = classesData?.data ?? [];

  /* Exams (to filter by) */
  const { data: examsData } = useQuery({
    queryKey: ['exams', 'list', { page: 1 }],
    queryFn:  () => examsApi.list({ limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const examsList = examsData?.data ?? [];

  /* Grade report — requires at least one filter */
  const enabled = !!(classId || examId || subject);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['grades', 'report', { classId, examId, subject }],
    queryFn:  () => gradesApi.report({ classId: classId || undefined, examId: examId || undefined, subject: subject || undefined, limit: 100 }),
    enabled,
    staleTime: 30_000,
  });
  const rows = data?.data ?? [];

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      {/* Filters */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">Class</label>
          <select value={classId} onChange={e => setClassId(e.target.value)} className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800">
            <option value="">All classes</option>
            {classList.map(c => <option key={c._id ?? c.id} value={c._id ?? c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">Exam</label>
          <select value={examId} onChange={e => setExamId(e.target.value)} className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800">
            <option value="">All exams</option>
            {examsList.map(e => <option key={e._id ?? e.id} value={e._id ?? e.id}>{e.title}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1.5">Subject</label>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="e.g. Mathematics"
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-800 placeholder-slate-400"
          />
        </div>
      </div>

      {/* Grade summary KPIs */}
      {rows.length > 0 && (() => {
        const pcts = rows.map(r => Number(r.avgPct ?? r.score ?? 0)).filter(v => !isNaN(v));
        const gAvg = pcts.length ? Math.round(pcts.reduce((a,b)=>a+b,0)/pcts.length) : null;
        const gPass = pcts.length ? Math.round((pcts.filter(v=>v>=50).length/pcts.length)*100) : null;
        return (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Records', value: rows.length, color: 'text-violet-600 bg-violet-50' },
              { label: 'Class Average', value: gAvg != null ? `${gAvg}%` : '—', color: gAvg >= 50 ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50' },
              { label: 'Pass Rate', value: gPass != null ? `${gPass}%` : '—', color: gPass >= 50 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 px-4 py-3">
                <p className="text-[11px] text-slate-500">{label}</p>
                <p className={`text-lg font-bold mt-0.5 ${color.split(' ')[0]}`}>{value}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Report table */}
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
                const pct = Number(r.avgPct ?? r.score ?? 0);
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

/* ── Create Exam Slide-Over ──────────────────────────────────── */
const EMPTY_EXAM = { title: '', subject: '', classId: '', date: '', maxScore: '100', term: '', status: 'draft', description: '' };

function CreateExamSlideOver({ onClose, onCreated }) {
  const [form, setForm]     = useState(EMPTY_EXAM);
  const [errors, setErrors] = useState({});

  /* Load classes */
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
              <option value="completed">Completed</option>
            </select>
          </FField>

          <FField label="Description">
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} placeholder="Optional notes…" className={`${iCls()} resize-none`} />
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
            {mutation.isPending ? 'Creating…' : 'Create Exam'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ── Shared helpers ─────────────────────────────────────────── */
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
