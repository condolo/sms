/* ============================================================
   ExamResultsTab — score / grade entry for formal exams
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import {
  Loader2, Save, ClipboardList, BookOpen,
  Check, TrendingUp, TrendingDown, Award, Users2, AlertTriangle, X,
} from 'lucide-react';
import { classes as classesApi, exams as examsApi } from '@/api/client.js';
import { Skeleton, EmptyMsg, StatusBadge, Toast } from './GradesPrimitives.jsx';

export default function ExamResultsTab() {
  const [examId, setExamId]     = useState('');
  const [saving, setSaving]     = useState(false);
  const [edits, setEdits]       = useState({});
  const [saved, setSaved]       = useState(false);
  const [toast, setToast]       = useState(null);
  // BUG-003 — students whose save was rejected because someone else's
  // edit landed first (stale _v). Kept separate from `edits` so a
  // conflicted student's in-progress typing is never silently dropped.
  const [conflicts, setConflicts] = useState([]);

  const { data: examsData } = useQuery({
    queryKey: ['exams', 'list', { page: 1 }],
    queryFn:  () => examsApi.list({ limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const examsList    = examsData?.data ?? [];
  const selectedExam = examsList.find(e => (e.id ?? e._id) === examId);

  const { data: resultsData, isLoading: resultsLoading, refetch: refetchResults } = useQuery({
    queryKey: ['exams', examId, 'results'],
    queryFn:  () => examsApi.results.list(examId, { limit: 200 }),
    enabled:  !!examId,
    staleTime: 0,
  });
  // BUG-003 (and prerequisite fix): GET /:id/results returns
  // { results, stats, exam }, not a bare array — resultsData.data was
  // being treated as the array itself, which would throw on .map()
  // the moment this tab actually loaded real data. Each result already
  // carries its Mongo-doc `_v` field (no server change needed for that).
  const results    = resultsData?.data?.results ?? [];
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
          score:     edit.score   !== undefined ? Number(edit.score)  : (orig.score   ?? null),
          grade:     edit.grade   !== undefined ? edit.grade   : (orig.grade   ?? ''),
          // ResultSchema's field is `notes`, not `comment` — `comment` was
          // silently stripped server-side (zod drops unrecognized keys),
          // so a teacher's comment never actually persisted. Fixed here
          // since it's the same object literal BUG-003's _v needs.
          notes:     edit.comment !== undefined ? edit.comment : (orig.notes ?? ''),
          // BUG-003 — only send _v when editing a result that already
          // exists (orig._v defined). A brand-new result has nothing to
          // conflict with, and omitting _v is exactly how the server
          // knows to skip the version check for it.
          ...(orig._v !== undefined ? { _v: orig._v } : {}),
        };
      }).filter(r => r.score !== null);

      const res = await examsApi.results.bulkUpsert(examId, { results: records });
      const newConflicts = res?.data?.conflicts ?? [];

      if (newConflicts.length > 0) {
        // Keep only the conflicted students' in-progress edits — theirs
        // weren't saved, so their typing must not disappear. Everyone
        // else's edit succeeded and can be cleared.
        const conflictedIds = new Set(newConflicts.map(c => c.studentId));
        setEdits(e => Object.fromEntries(Object.entries(e).filter(([sid]) => conflictedIds.has(sid))));
        setConflicts(newConflicts);
        setToast({
          msg: `${newConflicts.length} result${newConflicts.length === 1 ? '' : 's'} couldn't be saved — someone else edited ${newConflicts.length === 1 ? 'it' : 'them'} first. See below.`,
          type: 'error',
        });
      } else {
        setEdits({});
        setConflicts([]);
        setSaved(true);
        setToast({ msg: 'All results saved.', type: 'success' });
      }
      // Refetch either way — conflicted rows need the current _v/score
      // so the next save attempt compares against reality, not stale data.
      refetchResults();
    } catch (err) {
      setToast({ msg: err?.message ?? 'Failed to save results', type: 'error' });
    } finally {
      setSaving(false);
    }
  }

  function studentName(studentId) {
    const s = students.find(st => (st.id ?? st._id) === studentId);
    return s ? `${s.firstName} ${s.lastName}` : studentId;
  }

  const hasEdits = Object.keys(edits).length > 0;
  const loading  = resultsLoading || stuLoading;

  const scores   = results.map(r => r.score).filter(s => s != null && !isNaN(s));
  const maxS     = selectedExam?.maxScore ?? 100;
  const avg      = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const highest  = scores.length ? Math.max(...scores) : null;
  const lowest   = scores.length ? Math.min(...scores) : null;
  const passRate = scores.length ? Math.round((scores.filter(s => (s / maxS) * 100 >= 50).length / scores.length) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-700 mb-1.5">Select Exam</label>
          <select
            value={examId}
            onChange={e => { setExamId(e.target.value); setEdits({}); setSaved(false); setConflicts([]); }}
            className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-800"
          >
            <option value="">Choose an exam…</option>
            {examsList.map(e => (
              <option key={e.id ?? e._id} value={e.id ?? e._id}>
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
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* BUG-003 — results rejected because someone else's edit landed
          first. The conflicted student's own typed value stays in the
          grid below (never cleared); this just explains why and shows
          what's currently saved so the teacher can decide what to do. */}
      {conflicts.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  {conflicts.length} result{conflicts.length === 1 ? '' : 's'} not saved — someone else edited {conflicts.length === 1 ? 'it' : 'them'} first
                </p>
                <p className="text-xs text-amber-700 mt-0.5">Your entry is still in the box below. Review what's currently saved, then save again to overwrite it.</p>
              </div>
            </div>
            <button onClick={() => setConflicts([])} className="text-amber-600 hover:text-amber-800 shrink-0">
              <X size={16} />
            </button>
          </div>
          <ul className="mt-3 space-y-1.5">
            {conflicts.map(c => (
              <li key={c.studentId} className="text-xs text-amber-800 bg-white/60 rounded-lg px-3 py-2">
                <span className="font-medium">{studentName(c.studentId)}</span>
                {' — currently saved: '}
                <span className="font-medium">{c.currentScore ?? '—'}</span>
                {' (your entry has not been saved yet)'}
              </li>
            ))}
          </ul>
        </div>
      )}

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
                const sid       = s.id ?? s._id;
                const orig      = resultsMap[sid] ?? {};
                const edit      = edits[sid]      ?? {};
                const score     = edit.score   !== undefined ? edit.score   : (orig.score   ?? '');
                const grade     = edit.grade   !== undefined ? edit.grade   : (orig.grade   ?? '');
                const comment   = edit.comment !== undefined ? edit.comment : (orig.notes   ?? '');
                const changed   = edit.score !== undefined || edit.grade !== undefined || edit.comment !== undefined;
                const conflicted = conflicts.some(c => c.studentId === sid);
                return (
                  <tr key={sid} className={`hover:bg-slate-50 transition-colors ${conflicted ? 'bg-red-50/60' : changed ? 'bg-amber-50/40' : ''}`}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-800 flex items-center gap-1.5">
                        {s.firstName} {s.lastName}
                        {conflicted && <AlertTriangle size={12} className="text-red-500" title="Not saved — someone else edited this first" />}
                      </p>
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
            { label: 'Average Score', value: `${avg} / ${maxS}`,     Icon: TrendingUp,   color: 'text-blue-600 bg-blue-50'    },
            { label: 'Highest Score', value: `${highest} / ${maxS}`, Icon: Award,        color: 'text-emerald-600 bg-emerald-50' },
            { label: 'Lowest Score',  value: `${lowest} / ${maxS}`,  Icon: TrendingDown, color: 'text-amber-600 bg-amber-50'  },
            { label: 'Pass Rate',     value: `${passRate}%`,          Icon: Users2,       color: passRate >= 50 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50' },
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
