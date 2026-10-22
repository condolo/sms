/* ============================================================
   Assessment Analytics — promoted out of Reports & Analytics' old
   "Academic" tab (2026-10) so it has real room for a class breakdown,
   a score-distribution histogram, and spread stats, none of which fit
   well sharing a tab with five other modules.

   Reads live Markbook data only (GET /api/assessment/analytics →
   assessment_marks), never exam_results or the legacy grades
   collection — Exams contributes scheduling context for MT/ET, not a
   second marks source. Role-scoped server-side: a teacher sees only
   their own assigned classes, management sees the whole school.
   ============================================================ */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  ArrowLeft, Download, BarChart3, TrendingUp, TrendingDown, Scale, BookOpen, FileDown, AlertTriangle,
} from 'lucide-react';
import { assessment as assessmentApi, academicConfig as academicConfigApi, classSubjects as classSubjectsApi } from '@/api/client.js';
import { Stat, Card, ChartTip } from './ReportsPrimitives.jsx';

function _downloadCSV(rows, filename) {
  if (!rows.length) return;
  const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const el = document.createElement('a');
  el.href = url; el.download = filename;
  el.click(); URL.revokeObjectURL(url);
}

/* A sortable breakdown table — identical shape for subjects and classes,
   just a different id/name/label set. */
function BreakdownTable({ title, rows, idKey, nameKey, nameLabel, compareTo, sort, setSort, emptyHint }) {
  function doSort(col) {
    setSort(prev => (prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' }));
  }
  const sorted = [...rows].sort((a, b) => {
    const { col, dir } = sort;
    const av = a[col], bv = b[col];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return dir === 'asc' ? cmp : -cmp;
  });
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-center text-slate-400 text-sm py-12">{emptyHint}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                {[
                  { col: nameKey,  label: nameLabel },
                  { col: 'count',    label: 'Entries'   },
                  { col: 'avgPct',   label: 'Avg %'     },
                  ...(compareTo !== 'none' ? [{ col: 'delta', label: 'Change' }] : []),
                  { col: 'passRate', label: 'Pass Rate' },
                ].map(({ col, label }) => (
                  <th
                    key={col}
                    onClick={() => doSort(col)}
                    className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-900"
                  >
                    {label}
                    {sort.col === col && <span className="ml-1 text-violet-600">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr key={row[idKey]} className={`border-b border-slate-50 ${i % 2 === 0 ? '' : 'bg-slate-50/40'}`}>
                  <td className="py-2.5 px-3 font-medium text-slate-800">{row[nameKey]}</td>
                  <td className="py-2.5 px-3 text-slate-600">{row.count}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-[60px]">
                        <div className="h-full rounded-full bg-violet-500" style={{ width: `${row.avgPct}%` }} />
                      </div>
                      <span className="text-slate-700 font-medium">{row.avgPct}%</span>
                    </div>
                  </td>
                  {compareTo !== 'none' && (
                    <td className="py-2.5 px-3">
                      {row.delta == null ? (
                        <span className="text-slate-300">No prior data</span>
                      ) : (
                        <span className={`inline-flex items-center gap-1 font-medium ${
                          row.delta > 0 ? 'text-emerald-600' : row.delta < 0 ? 'text-red-500' : 'text-slate-400'
                        }`}>
                          {row.delta > 0 ? <TrendingUp size={13} /> : row.delta < 0 ? <TrendingDown size={13} /> : null}
                          {row.delta > 0 ? '+' : ''}{row.delta}%
                        </span>
                      )}
                    </td>
                  )}
                  <td className="py-2.5 px-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                      row.passRate >= 80 ? 'bg-emerald-100 text-emerald-700'
                      : row.passRate >= 50 ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'
                    }`}>
                      {row.passRate}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* Subject Enrollment Coverage — a different axis than the marks-based
   tables above: not "how did students score", but "is every student
   actually enrolled in the subjects they should be". A compulsory
   subject short of the class roster is a real gap (flagged); an
   elective's partial coverage is expected (never flagged) since the
   roster splits across electives by choice. */
function EnrollmentCoverageTable({ classes, sort, setSort }) {
  function doSort(col) {
    setSort(prev => (prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));
  }
  const rows = (classes ?? []).flatMap(c =>
    c.subjects.map(s => ({ ...s, classId: c.classId, className: c.className }))
  );
  const sorted = [...rows].sort((a, b) => {
    const { col, dir } = sort;
    const av = a[col], bv = b[col];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return dir === 'asc' ? cmp : -cmp;
  });
  const unenrolledTotal = (classes ?? []).reduce((s, c) => s + (c.unenrolledStudents || 0), 0);

  return (
    <Card title="Subject Enrollment Coverage by Class">
      <p className="text-xs text-slate-400 -mt-2 mb-3">
        A compulsory subject short of its class roster is flagged below (Gap). An elective's partial coverage is expected and never flagged.
      </p>
      {unenrolledTotal > 0 && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 text-red-700 text-xs font-medium rounded-lg px-3 py-2 mb-3">
          <AlertTriangle size={14} />
          {unenrolledTotal} active student{unenrolledTotal !== 1 ? 's are' : ' is'} enrolled in zero subjects across the classes shown — check the Subjects → Enrollment tab.
        </div>
      )}
      {rows.length === 0 ? (
        <p className="text-center text-slate-400 text-sm py-12">No curriculum/enrollment data available for the selected class(es).</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                {[
                  { col: 'className', label: 'Class' },
                  { col: 'subject',   label: 'Subject' },
                  { col: 'isCompulsory', label: 'Type' },
                  { col: 'enrolled', label: 'Enrolled' },
                  { col: 'enrollmentPct', label: 'Coverage' },
                  { col: 'gap', label: 'Gap' },
                ].map(({ col, label }) => (
                  <th
                    key={col}
                    onClick={() => doSort(col)}
                    className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-900"
                  >
                    {label}
                    {sort.col === col && <span className="ml-1 text-violet-600">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => (
                <tr key={`${row.classId}::${row.subjectId}`} className={`border-b border-slate-50 ${row.gap > 0 ? 'bg-red-50/60' : i % 2 === 0 ? '' : 'bg-slate-50/40'}`}>
                  <td className="py-2.5 px-3 font-medium text-slate-800">{row.className}</td>
                  <td className="py-2.5 px-3 text-slate-700">{row.subject}</td>
                  <td className="py-2.5 px-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                      row.isCompulsory ? 'bg-slate-100 text-slate-600' : 'bg-sky-100 text-sky-700'
                    }`}>
                      {row.isCompulsory ? 'Compulsory' : 'Elective'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">{row.enrolled}/{row.rosterSize}</td>
                  <td className="py-2.5 px-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden max-w-[60px]">
                        <div className="h-full rounded-full bg-violet-500" style={{ width: `${row.enrollmentPct ?? 0}%` }} />
                      </div>
                      <span className="text-slate-700 font-medium">{row.enrollmentPct != null ? `${row.enrollmentPct}%` : '—'}</span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3">
                    {row.gap == null ? (
                      <span className="text-slate-300">—</span>
                    ) : row.gap > 0 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">{row.gap} missing</span>
                    ) : (
                      <span className="text-emerald-600 font-medium">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function AssessmentAnalyticsPage() {
  const navigate = useNavigate();
  const [classId,    setClassId]    = useState('');
  const [subjectId,  setSubjectId]  = useState('');
  const [compareTo,  setCompareTo]  = useState('previousTerm'); // 'previousTerm' | 'previousYear' | 'none'
  const [subjectSort, setSubjectSort] = useState({ col: 'subject', dir: 'asc' });
  const [classSort,   setClassSort]   = useState({ col: 'className', dir: 'asc' });
  const [enrollSort,  setEnrollSort]  = useState({ col: 'gap', dir: 'desc' });
  const [exportingPdf, setExportingPdf] = useState(false);
  const [pdfError,     setPdfError]     = useState('');
  // Year/term — left blank by default so the server picks "now" the same
  // way every other page does (resolveCurrentPeriod), but explicitly
  // reachable here: marks for a different term than whatever the school's
  // calendar currently resolves to "current" are real, already-entered
  // Markbook data too, and there was previously no way to reach them
  // (reported directly: term 3 resolved as current and showed nothing,
  // with no control to check term 1/2 where the marks actually were).
  const [yearId,     setYearId]     = useState('');
  const [termNumber, setTermNumber] = useState('');

  const { data: yearsRaw } = useQuery({
    queryKey: ['academic-config', 'years'],
    queryFn:  academicConfigApi.years.list,
    staleTime: 10 * 60_000,
  });
  const years = yearsRaw?.data ?? yearsRaw ?? [];
  const selectedYear = years.find(y => (y.id ?? y._id) === yearId);
  const yearTerms = selectedYear?.terms ?? [];

  // subjectId is deliberately NOT sent to the server — it doesn't affect
  // scope/RBAC (unlike classId), so narrowing to one subject is done
  // client-side below. That also keeps the subject dropdown's own option
  // list from collapsing to whichever one subject is currently selected.
  const { data: raw, isLoading } = useQuery({
    queryKey: ['assessment', 'analytics', { classId, compareTo, yearId, termNumber }],
    queryFn:  () => assessmentApi.analytics({
      classId:        classId || undefined,
      compareTo,
      academicYearId: yearId     || undefined,
      termNumber:     termNumber || undefined,
    }),
    select:   r => r?.data ?? r,
    staleTime: 5 * 60_000,
  });

  // Subject-enrollment coverage — a different axis from the marks-based
  // query above (not scored performance, whether students are actually
  // enrolled in the subjects they should be), so it's fetched separately;
  // still respects the same class filter/scope.
  const { data: enrollRaw } = useQuery({
    queryKey: ['class-subjects', 'enrollment-analytics', { classId }],
    queryFn:  () => classSubjectsApi.enrollmentAnalytics({ classId: classId || undefined }),
    select:   r => r?.data ?? r,
    staleTime: 5 * 60_000,
  });
  const enrollmentClasses = enrollRaw?.classes ?? [];

  const data = raw ?? {};
  const isWholeSchool  = data.scope === 'whole_school';
  const availableClasses = data.availableClasses ?? [];
  const subjectsRaw = data.subjects ?? [];
  const classesRaw  = data.classes ?? [];
  const subjectOptions = subjectsRaw.map(s => ({ id: s.subjectId, name: s.subject }));
  const subjectsFiltered = subjectId ? subjectsRaw.filter(s => s.subjectId === subjectId) : subjectsRaw;

  const subjectRows = subjectsFiltered.map(s => ({
    subjectId: s.subjectId, subject: s.subject,
    count: s.current.count, avgPct: s.current.avgPct, passRate: s.current.passRate,
    delta: s.delta,
  }));
  const classRows = classesRaw.map(c => ({
    classId: c.classId, className: c.className,
    count: c.current.count, avgPct: c.current.avgPct, passRate: c.current.passRate,
    delta: c.delta,
  }));

  const overallAvg  = data.overall?.avgPct  ?? 0;
  const overallPass = data.overall?.passRate ?? 0;
  const { minScore, maxScore, median, stdDev } = data.overall ?? {};

  const chartSubjectData = [...subjectRows].sort((a, b) => a.avgPct - b.avgPct).slice(0, 10)
    .map(r => ({ name: r.subject, avg: r.avgPct }));
  const chartClassData = [...classRows].sort((a, b) => a.avgPct - b.avgPct).slice(0, 12)
    .map(r => ({ name: r.className, avg: r.avgPct }));
  const distribution = data.distribution ?? [];

  function exportCSV() {
    const date = new Date().toISOString().slice(0, 10);
    _downloadCSV(
      [
        ['Subject', 'Entries', 'Average %', 'Change', 'Pass Rate %'],
        ...subjectRows.map(r => [r.subject, r.count, r.avgPct, r.delta ?? '—', r.passRate]),
        [],
        ['Class', 'Entries', 'Average %', 'Change', 'Pass Rate %'],
        ...classRows.map(r => [r.className, r.count, r.avgPct, r.delta ?? '—', r.passRate]),
      ],
      `assessment_analytics_${date}.csv`
    );
  }

  async function exportPdf() {
    setExportingPdf(true);
    setPdfError('');
    try {
      await assessmentApi.analyticsPdf({
        classId:        classId || undefined,
        compareTo,
        academicYearId: yearId     || undefined,
        termNumber:     termNumber || undefined,
      });
    } catch (err) {
      setPdfError(err.message || 'Failed to generate PDF');
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate('/reports')}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 mb-1"
          >
            <ArrowLeft size={12} /> Reports & Analytics
          </button>
          <h1 className="text-xl font-bold text-slate-900">Assessment Analytics</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Live Markbook performance — not a static report, updates as marks are entered.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
            >
              <Download size={14} /> Export CSV
            </button>
            <button
              onClick={exportPdf}
              disabled={exportingPdf}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition disabled:opacity-50"
            >
              <FileDown size={14} /> {exportingPdf ? 'Generating…' : 'Export PDF'}
            </button>
          </div>
          {pdfError && <p className="text-xs text-red-500">{pdfError}</p>}
        </div>
      </div>

      {/* Scope badge + filters — visible to everyone so a teacher never
          mistakes "your classes" for "whole school". */}
      <div className="flex flex-wrap items-center gap-3">
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
          isWholeSchool ? 'bg-violet-100 text-violet-700' : 'bg-sky-100 text-sky-700'
        }`}>
          {isWholeSchool ? 'Whole school' : 'Your classes only'}
        </span>

        <select
          value={yearId}
          onChange={e => { setYearId(e.target.value); setTermNumber(''); }}
          className="text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700"
        >
          <option value="">Current year</option>
          {years.map(y => (
            <option key={y.id ?? y._id} value={y.id ?? y._id}>{y.name}{y.isCurrent ? ' ★' : ''}</option>
          ))}
        </select>

        <select
          value={termNumber}
          onChange={e => setTermNumber(e.target.value)}
          className="text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700"
        >
          <option value="">Current term</option>
          {yearTerms.length > 0
            ? yearTerms.map((t, i) => <option key={t.id ?? i} value={String(i + 1)}>{t.name}</option>)
            : [1, 2, 3].map(n => <option key={n} value={String(n)}>Term {n}</option>)
          }
        </select>

        <select
          value={classId}
          onChange={e => setClassId(e.target.value)}
          className="text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700"
        >
          <option value="">{isWholeSchool ? 'All classes' : 'All my classes'}</option>
          {availableClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        <select
          value={subjectId}
          onChange={e => setSubjectId(e.target.value)}
          className="text-sm px-3 py-2 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700"
        >
          <option value="">All subjects</option>
          {subjectOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        <div className="flex items-center rounded-xl border border-slate-200 bg-white p-0.5 text-xs font-semibold">
          {[
            { id: 'previousTerm', label: 'vs Last Term' },
            { id: 'previousYear', label: 'vs Last Year' },
            { id: 'none',         label: 'This period only' },
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => setCompareTo(opt.id)}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                compareTo === opt.id ? 'bg-violet-600 text-white' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {data.currentPeriod && (
          <span className="text-xs text-slate-400 ml-auto">
            {data.currentPeriod.academicYearName} · Term {data.currentPeriod.termNumber}
            {data.previousPeriod && ` — vs ${data.previousPeriod.academicYearName} · Term ${data.previousPeriod.termNumber}`}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="h-3 bg-slate-200 rounded w-24 mb-3" />
              <div className="h-7 bg-slate-200 rounded w-16" />
            </div>
          ))}
        </div>
      ) : !data.currentPeriod ? (
        <p className="text-center text-slate-400 text-sm py-12">
          No academic year is configured yet for this school. Set one up in Settings → Academic Years.
        </p>
      ) : (
        <>
          {/* KPI row — these reflect the class/school scope above, not the
              subject filter (which only narrows the tables/charts below). */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Subjects Tracked" value={subjectsRaw.length} Icon={BookOpen} colorIndex={0} />
            <Stat label="Marks Entered"     value={(data.overall?.count ?? 0).toLocaleString()} Icon={BarChart3} colorIndex={2} />
            <Stat label="Overall Avg Score" value={overallAvg > 0 ? `${overallAvg}%` : '—'} Icon={TrendingUp} colorIndex={1} />
            <Stat label="Avg Pass Rate"     value={overallPass > 0 ? `${overallPass}%` : '—'} Icon={Scale} colorIndex={3} />
          </div>

          {/* Spread — a single average can't tell two very different classes
              apart (everyone near 67% vs. half at 90%, half at 44%); median
              and the min/max range make that visible at a glance. */}
          {data.overall?.count > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Stat label="Median Score" value={median != null ? `${median}%` : '—'} Icon={BarChart3} colorIndex={4} />
              <Stat label="Lowest Score" value={minScore != null ? `${minScore}%` : '—'} Icon={TrendingDown} colorIndex={5} />
              <Stat label="Highest Score" value={maxScore != null ? `${maxScore}%` : '—'} Icon={TrendingUp} colorIndex={1} />
              <Stat label="Std. Deviation" value={stdDev != null ? stdDev : '—'} sub="Lower = more consistent" Icon={Scale} colorIndex={2} />
            </div>
          )}

          {/* Score distribution histogram */}
          {distribution.length > 0 && (
            <Card title="Score Distribution">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={distribution} margin={{ left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="band" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="count" name="Marks" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Subject chart + table */}
            {chartSubjectData.length > 0 && (
              <Card title="Average Score % by Subject">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartSubjectData} margin={{ left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="avg" name="Avg %" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}

            {/* Class chart */}
            {chartClassData.length > 0 && (
              <Card title="Average Score % by Class">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartClassData} margin={{ left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="avg" name="Avg %" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            )}
          </div>

          <BreakdownTable
            title="Subject Performance Breakdown"
            rows={subjectRows} idKey="subjectId" nameKey="subject" nameLabel="Subject"
            compareTo={compareTo} sort={subjectSort} setSort={setSubjectSort}
            emptyHint="No assessment marks recorded yet for this period. Enter marks via the Markbook."
          />

          <BreakdownTable
            title="Performance by Class"
            rows={classRows} idKey="classId" nameKey="className" nameLabel="Class"
            compareTo={compareTo} sort={classSort} setSort={setClassSort}
            emptyHint="No assessment marks recorded yet for this period."
          />

          <EnrollmentCoverageTable classes={enrollmentClasses} sort={enrollSort} setSort={setEnrollSort} />
        </>
      )}
    </div>
  );
}
