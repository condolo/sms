/**
 * Msingi — Grades & Assessment Page
 * Tabs: Mark Entry | Report Cards | Configuration | Reminders
 */
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { assessment as api, classes as classesApi, students as studentsApi } from '@/api/client.js';
import { PageSpinner, Spinner } from '@/components/ui/Spinner.jsx';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState.jsx';
import { Badge } from '@/components/ui/Badge.jsx';
import useAuthStore from '@/store/auth.js';

/* ── Constants ──────────────────────────────────────────────── */
const ASSESSMENT_TYPES = ['CA', 'HW', 'MT', 'ET'];
const TERM_NUMBERS     = [1, 2, 3];
const TYPE_LABELS      = { CA: 'Continuous Assessment', HW: 'Homework / Assignment', MT: 'Mid-Term', ET: 'End-Term' };
const TYPE_COLORS      = { CA: 'primary', HW: 'purple', MT: 'warning', ET: 'danger' };
const DEFAULT_WEIGHTS  = { CA: 20, HW: 10, MT: 30, ET: 40 };

const TABS = [
  { key: 'entry',   label: '✏️ Mark Entry',      roles: ['admin','superadmin','teacher','deputy'] },
  { key: 'report',  label: '📊 Report Cards',     roles: ['admin','superadmin','teacher','deputy','parent','student'] },
  { key: 'config',  label: '⚙️ Configuration',    roles: ['admin','superadmin'] },
  { key: 'remind',  label: '🔔 Reminders',        roles: ['admin','superadmin','teacher','deputy'] },
];

function _round(n) { return n == null ? null : Math.round((n + 1e-10) * 10) / 10; }
function _scoreColor(s) {
  if (s == null) return 'text-slate-400';
  if (s >= 70) return 'text-green-600 font-semibold';
  if (s >= 50) return 'text-amber-600 font-semibold';
  return 'text-red-600 font-semibold';
}

/* ── Tab bar ────────────────────────────────────────────────── */
function TabBar({ tab, setTab, role }) {
  const visible = TABS.filter(t => t.roles.includes(role));
  return (
    <div className="flex gap-1 border-b border-surface-border overflow-x-auto">
      {visible.map(t => (
        <button
          key={t.key}
          onClick={() => setTab(t.key)}
          className={clsx(
            'px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition',
            tab === t.key
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          )}
        >{t.label}</button>
      ))}
    </div>
  );
}

/* ── Filter row helper ──────────────────────────────────────── */
function Select({ label, value, onChange, options, placeholder = 'All', disabled }) {
  return (
    <div className="flex flex-col gap-1 min-w-[140px]">
      {label && <label className="text-xs font-medium text-slate-500">{label}</label>}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="input-field text-sm py-2 disabled:opacity-50"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 1 — MARK ENTRY
   ══════════════════════════════════════════════════════════════ */
function MarkEntryTab() {
  const qc = useQueryClient();
  const [classId,        setClassId]        = useState('');
  const [subjectId,      setSubjectId]      = useState('');
  const [termNumber,     setTermNumber]      = useState('');
  const [assessmentType, setAssessmentType]  = useState('');
  const [instance,       setInstance]        = useState('1');
  const [scores,         setScores]          = useState({});  // { studentId: rawScore }
  const [saved,          setSaved]           = useState(false);
  const [academicYearId, setAcademicYearId]  = useState('');

  // Load classes
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'list'],
    queryFn:  () => classesApi.list({ limit: 200 }),
  });
  const classesList = classesData?.data ?? [];

  // Load config (instances, weights)
  const { data: configData } = useQuery({
    queryKey: ['assessment', 'config'],
    queryFn:  () => api.getConfig({ academicYearId: academicYearId || undefined }),
  });
  const config    = configData?.data || {};
  const instances = config.instances || { CA: 2, HW: 2 };
  const maxInst   = assessmentType === 'CA' ? (instances.CA || 2)
                  : assessmentType === 'HW' ? (instances.HW || 2)
                  : 1;

  // Load students in selected class
  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['classes', classId, 'students'],
    queryFn:  () => classesApi.students(classId),
    enabled:  !!classId,
  });
  const students = studentsData?.data ?? [];

  // Load existing marks for this assessment
  const canQuery = !!(classId && subjectId && termNumber && assessmentType);
  const { data: existingData } = useQuery({
    queryKey: ['assessment', 'marks', { classId, subjectId, termNumber, assessmentType, instance, academicYearId }],
    queryFn:  () => api.getMarks({
      classId, subjectId, termNumber: Number(termNumber),
      assessmentType, academicYearId: academicYearId || undefined,
    }),
    enabled: canQuery,
    onSuccess: (data) => {
      const map = {};
      for (const m of (data?.data ?? [])) {
        if (String(m.instance) === String(instance)) {
          map[m.studentId] = m.rawScore;
        }
      }
      setScores(map);
      setSaved(false);
    },
  });

  const { mutate: submitMarks, isLoading: submitting } = useMutation({
    mutationFn: () => api.bulkMarks({
      marks: students.map(s => ({
        studentId:      s.id || s._id,
        subjectId,
        classId,
        termNumber:     Number(termNumber),
        assessmentType,
        instance:       Number(instance),
        rawScore:       scores[s.id || s._id] != null ? Number(scores[s.id || s._id]) : 0,
        academicYearId: academicYearId || undefined,
      })).filter(m => scores[m.studentId] != null),
    }),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries(['assessment', 'marks']);
      qc.invalidateQueries(['assessment', 'report']);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const ready = canQuery && students.length > 0;

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="card">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Select Assessment</p>
        <div className="flex flex-wrap gap-3">
          <Select
            label="Class"
            value={classId}
            onChange={setClassId}
            options={classesList.map(c => ({ value: c.id || c._id, label: c.name }))}
            placeholder="Select class"
          />
          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-xs font-medium text-slate-500">Subject</label>
            <input
              type="text"
              value={subjectId}
              onChange={e => setSubjectId(e.target.value)}
              placeholder="e.g. Mathematics"
              className="input-field text-sm py-2"
            />
          </div>
          <Select
            label="Term"
            value={termNumber}
            onChange={setTermNumber}
            options={TERM_NUMBERS.map(n => ({ value: String(n), label: `Term ${n}` }))}
            placeholder="Select term"
          />
          <Select
            label="Assessment Type"
            value={assessmentType}
            onChange={v => { setAssessmentType(v); setInstance('1'); }}
            options={ASSESSMENT_TYPES.map(t => ({ value: t, label: `${t} — ${TYPE_LABELS[t]}` }))}
            placeholder="Select type"
          />
          {maxInst > 1 && (
            <Select
              label="Instance"
              value={instance}
              onChange={setInstance}
              placeholder=""
              options={Array.from({ length: maxInst }, (_, i) => ({ value: String(i+1), label: `${assessmentType} ${i+1}` }))}
            />
          )}
        </div>
      </div>

      {/* Mark entry grid */}
      {!classId || !subjectId || !termNumber || !assessmentType ? (
        <EmptyState icon="✏️" title="Select class, subject, term and assessment type above" />
      ) : studentsLoading ? (
        <PageSpinner message="Loading students…" />
      ) : students.length === 0 ? (
        <EmptyState icon="👥" title="No students in this class" />
      ) : (
        <div className="card !p-0 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-surface-border">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                {assessmentType} {instance} — {subjectId} — Term {termNumber}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">Enter marks out of 100 for each student</p>
            </div>
            <div className="flex items-center gap-3">
              {saved && <span className="text-xs text-green-600 font-medium">✅ Saved!</span>}
              <button
                onClick={() => submitMarks()}
                disabled={submitting}
                className="btn-primary text-sm"
              >
                {submitting ? <Spinner size="sm" /> : 'Save All Marks'}
              </button>
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Student</th>
                <th className="hidden sm:table-cell">Admission No.</th>
                <th className="text-right w-32">Score /100</th>
                <th className="text-right w-20 hidden md:table-cell">Status</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => {
                const sid   = s.id || s._id;
                const score = scores[sid];
                return (
                  <tr key={sid}>
                    <td className="text-slate-400 text-xs">{i + 1}</td>
                    <td className="font-medium text-slate-800">
                      {s.firstName} {s.lastName}
                    </td>
                    <td className="hidden sm:table-cell text-xs text-slate-400">{s.admissionNumber || '—'}</td>
                    <td className="text-right">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={score ?? ''}
                        onChange={e => {
                          const v = e.target.value === '' ? undefined : Number(e.target.value);
                          setScores(prev => ({ ...prev, [sid]: v }));
                        }}
                        className={clsx(
                          'w-20 rounded-lg border px-3 py-1.5 text-right text-sm tabular-nums',
                          'focus:outline-none focus:ring-2 focus:ring-brand-400 border-slate-200'
                        )}
                        placeholder="—"
                      />
                    </td>
                    <td className="hidden md:table-cell text-right">
                      {score == null
                        ? <span className="text-xs text-slate-300">Not entered</span>
                        : score >= 50
                          ? <Badge variant="success" size="sm">Pass</Badge>
                          : <Badge variant="danger" size="sm">Fail</Badge>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Class stats */}
          {Object.values(scores).filter(v => v != null).length > 0 && (
            <div className="px-4 py-3 border-t border-surface-border bg-slate-50 flex gap-6 text-xs text-slate-500">
              {(() => {
                const vals = Object.values(scores).filter(v => v != null).map(Number);
                const avg  = vals.reduce((s,n) => s+n, 0) / vals.length;
                const pass = vals.filter(v => v >= 50).length;
                return (
                  <>
                    <span>Entered: <strong className="text-slate-700">{vals.length}/{students.length}</strong></span>
                    <span>Class avg: <strong className={_scoreColor(avg)}>{_round(avg)}%</strong></span>
                    <span>Pass rate: <strong className="text-slate-700">{Math.round((pass/vals.length)*100)}%</strong></span>
                    <span>Highest: <strong className="text-green-600">{Math.max(...vals)}%</strong></span>
                    <span>Lowest: <strong className="text-red-600">{Math.min(...vals)}%</strong></span>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 2 — REPORT CARDS
   ══════════════════════════════════════════════════════════════ */
function ReportCardsTab() {
  const [classId,   setClassId]   = useState('');
  const [studentId, setStudentId] = useState('');
  const [termNum,   setTermNum]   = useState('');
  const [half,      setHalf]      = useState(false);

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'list'],
    queryFn:  () => classesApi.list({ limit: 200 }),
  });
  const classesList = classesData?.data ?? [];

  const { data: studentsData } = useQuery({
    queryKey: ['classes', classId, 'students'],
    queryFn:  () => classesApi.students(classId),
    enabled:  !!classId,
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
    enabled: canQuery,
  });

  const config   = reportData?.config || {};
  const weights  = config.weights || DEFAULT_WEIGHTS;
  const template = config.reportTemplate || 'detailed';
  const students = reportData?.students ?? (reportData?.student ? [reportData.student] : []);

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="card">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Select Report</p>
        <div className="flex flex-wrap gap-3 items-end">
          <Select
            label="Class"
            value={classId}
            onChange={v => { setClassId(v); setStudentId(''); }}
            options={classesList.map(c => ({ value: c.id || c._id, label: c.name }))}
            placeholder="All classes"
          />
          {classId && (
            <Select
              label="Student (optional)"
              value={studentId}
              onChange={setStudentId}
              options={studentsList.map(s => ({ value: s.id || s._id, label: `${s.firstName} ${s.lastName}` }))}
              placeholder="All students"
            />
          )}
          <Select
            label="Term"
            value={termNum}
            onChange={setTermNum}
            options={TERM_NUMBERS.map(n => ({ value: String(n), label: `Term ${n}` }))}
            placeholder="All terms"
          />
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer self-end mb-0.5">
            <input type="checkbox" checked={half} onChange={e => setHalf(e.target.checked)} className="rounded" />
            Half-term report
          </label>
        </div>
      </div>

      {!canQuery ? (
        <EmptyState icon="📊" title="Select a class or student to view report cards" />
      ) : isLoading ? (
        <PageSpinner message="Computing report cards…" />
      ) : isError ? (
        <ErrorState message={error?.message} onRetry={refetch} />
      ) : students.length === 0 ? (
        <EmptyState icon="📋" title="No assessment data found" desc="Enter marks first using the Mark Entry tab." />
      ) : (
        <div className="space-y-6">
          {/* Config info bar */}
          <div className="flex flex-wrap gap-3 text-xs">
            {ASSESSMENT_TYPES.map(t => (
              <span key={t} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">
                <Badge variant={TYPE_COLORS[t]} size="sm">{t}</Badge>
                {weights[t]}%
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700">
              Template: {template === 'detailed' ? 'Detailed (A)' : 'Summary (B)'}
            </span>
            {half && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">Half-term view</span>}
          </div>

          {students.map(student => (
            <StudentReportCard
              key={student.studentId}
              student={student}
              template={template}
              half={half}
              termNum={termNum}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StudentReportCard({ student, template, half, termNum }) {
  const subjects = Object.entries(student.subjects || {});
  if (!subjects.length) return null;

  const termsToShow = termNum ? [Number(termNum)] : TERM_NUMBERS;

  return (
    <div className="card !p-0 overflow-hidden">
      <div className="px-4 py-3 bg-slate-50 border-b border-surface-border">
        <p className="text-sm font-semibold text-slate-800">{student.studentId}</p>
        <p className="text-xs text-slate-400">{student.classId}</p>
      </div>

      {template === 'summary' ? (
        /* ── Template B: Summary ── */
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Subject</th>
                <th className="text-right">Term 1</th>
                <th className="text-right">Term 2</th>
                <th className="text-right">Term 3</th>
                <th className="text-right bg-slate-50">Final Avg</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map(([subId, data]) => {
                const t1 = data.terms?.[1]?.termTotal;
                const t2 = data.terms?.[2]?.termTotal;
                const t3 = data.terms?.[3]?.termTotal;
                return (
                  <tr key={subId}>
                    <td className="font-medium text-slate-800">{subId}</td>
                    <td className={clsx('text-right tabular-nums', _scoreColor(t1))}>{t1 != null ? `${_round(t1)}%` : '—'}</td>
                    <td className={clsx('text-right tabular-nums', _scoreColor(t2))}>{t2 != null ? `${_round(t2)}%` : '—'}</td>
                    <td className={clsx('text-right tabular-nums', _scoreColor(t3))}>{t3 != null ? `${_round(t3)}%` : '—'}</td>
                    <td className={clsx('text-right tabular-nums font-bold bg-slate-50', _scoreColor(data.summaryAverage))}>
                      {data.summaryAverage != null ? `${_round(data.summaryAverage)}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* ── Template A: Detailed (one block per term) ── */
        termsToShow.map(termN => (
          <div key={termN} className="border-b border-surface-border last:border-0">
            <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100">
              <p className="text-xs font-semibold text-indigo-700">
                {half ? `Term ${termN} — Half-Term Report` : `Term ${termN} Report`}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th className="text-right">CA avg</th>
                    <th className="text-right">HW avg</th>
                    <th className="text-right">MT</th>
                    {!half && <th className="text-right">ET</th>}
                    {!half && <th className="text-right">Term Total</th>}
                    {half  && <th className="text-right bg-amber-50">Half-Term /100</th>}
                    {!half && termN >= 2 && <th className="text-right text-slate-400">ET Avg (ref)</th>}
                    {!half && termN >= 2 && Object.keys(subjects[0]?.[1]?.terms?.[termN]?.etRef || {}).map(k => (
                      <th key={k} className="text-right text-slate-300">{k} (ref)</th>
                    ))}
                    {!half && <th className="text-right font-bold bg-slate-50">Final Grade</th>}
                  </tr>
                </thead>
                <tbody>
                  {subjects.map(([subId, data]) => {
                    const t = data.terms?.[termN];
                    if (!t) return (
                      <tr key={subId}><td colSpan={9} className="text-slate-300 text-xs">No data for Term {termN}</td></tr>
                    );
                    return (
                      <tr key={subId}>
                        <td className="font-medium text-slate-800">{subId}</td>
                        <td className={clsx('text-right tabular-nums', _scoreColor(t.typeAvgs?.CA))}>{t.typeAvgs?.CA != null ? `${_round(t.typeAvgs.CA)}%` : '—'}</td>
                        <td className={clsx('text-right tabular-nums', _scoreColor(t.typeAvgs?.HW))}>{t.typeAvgs?.HW != null ? `${_round(t.typeAvgs.HW)}%` : '—'}</td>
                        <td className={clsx('text-right tabular-nums', _scoreColor(t.typeAvgs?.MT))}>{t.typeAvgs?.MT != null ? `${_round(t.typeAvgs.MT)}%` : '—'}</td>
                        {!half && <td className={clsx('text-right tabular-nums', _scoreColor(t.typeAvgs?.ET))}>{t.typeAvgs?.ET != null ? `${_round(t.typeAvgs.ET)}%` : '—'}</td>}
                        {!half && <td className={clsx('text-right tabular-nums', _scoreColor(t.termTotal))}>{t.termTotal != null ? `${_round(t.termTotal)}%` : '—'}</td>}
                        {half  && <td className={clsx('text-right tabular-nums font-semibold bg-amber-50', _scoreColor(t.halfTermTotal))}>{t.halfTermTotal != null ? `${_round(t.halfTermTotal)}%` : '—'}</td>}
                        {!half && termN >= 2 && <td className={clsx('text-right tabular-nums text-slate-400', _scoreColor(t.etRunningAvg))}>{t.etRunningAvg != null ? `${_round(t.etRunningAvg)}%` : '—'}</td>}
                        {!half && termN >= 2 && Object.entries(t.etRef || {}).map(([k, v]) => (
                          <td key={k} className="text-right tabular-nums text-slate-300 text-xs">{v != null ? `${_round(v)}%` : '—'}</td>
                        ))}
                        {!half && <td className={clsx('text-right tabular-nums font-bold bg-slate-50', _scoreColor(t.finalGrade))}>{t.finalGrade != null ? `${_round(t.finalGrade)}%` : '—'}</td>}
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
   TAB 3 — CONFIGURATION
   ══════════════════════════════════════════════════════════════ */
function ConfigTab() {
  const qc = useQueryClient();

  const { data: configData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['assessment', 'config'],
    queryFn:  () => api.getConfig(),
  });
  const cfg = configData?.data || {};

  const [weights,  setWeights]  = useState(null);
  const [template, setTemplate] = useState(null);
  const [instances, setInstances] = useState(null);

  const activeWeights   = weights   ?? cfg.weights   ?? DEFAULT_WEIGHTS;
  const activeTemplate  = template  ?? cfg.reportTemplate ?? 'detailed';
  const activeInstances = instances ?? cfg.instances  ?? { CA: 2, HW: 2 };

  const weightTotal = Object.values(activeWeights).reduce((s, n) => s + Number(n), 0);
  const weightOk    = Math.abs(weightTotal - 100) < 0.01;

  const { mutate: saveConfig, isLoading: saving } = useMutation({
    mutationFn: () => api.updateConfig({
      weights:        activeWeights,
      reportTemplate: activeTemplate,
      instances:      activeInstances,
    }),
    onSuccess: () => {
      qc.invalidateQueries(['assessment', 'config']);
      qc.invalidateQueries(['assessment', 'report']);
      setWeights(null); setTemplate(null); setInstances(null);
    },
  });

  // Schedule state
  const { data: schedData, refetch: refetchSched } = useQuery({
    queryKey: ['assessment', 'schedule'],
    queryFn:  () => api.getSchedule(),
  });
  const schedules = schedData?.data ?? [];
  const [newSched, setNewSched] = useState({ termNumber: 1, assessmentType: 'CA', instance: 1, dateFrom: '', dateTo: '' });
  const { mutate: saveSched, isLoading: savingSched } = useMutation({
    mutationFn: () => api.upsertSchedule(newSched),
    onSuccess:  () => { refetchSched(); setNewSched({ termNumber: 1, assessmentType: 'CA', instance: 1, dateFrom: '', dateTo: '' }); },
  });
  const { mutate: delSched } = useMutation({
    mutationFn: (id) => api.deleteSchedule(id),
    onSuccess:  () => refetchSched(),
  });

  if (isLoading) return <PageSpinner message="Loading config…" />;
  if (isError)   return <ErrorState message={error?.message} onRetry={refetch} />;

  return (
    <div className="space-y-6">
      {/* Weights */}
      <div className="card">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Assessment Weights</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {ASSESSMENT_TYPES.map(type => (
            <div key={type}>
              <label className="text-xs font-medium text-slate-500 mb-1 block">
                <Badge variant={TYPE_COLORS[type]} size="sm">{type}</Badge>
                <span className="ml-1">{TYPE_LABELS[type]}</span>
              </label>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={activeWeights[type] ?? 0}
                  onChange={e => setWeights({ ...activeWeights, [type]: Number(e.target.value) })}
                  className="input-field text-right pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">%</span>
              </div>
            </div>
          ))}
        </div>

        {/* Weight total indicator */}
        <div className={clsx(
          'mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm',
          weightOk ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        )}>
          <span>{weightOk ? '✅' : '⚠️'}</span>
          <span>Total: <strong>{_round(weightTotal)}%</strong></span>
          {!weightOk && <span className="ml-1">— must equal exactly 100%</span>}
        </div>
      </div>

      {/* Instances */}
      <div className="card">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Assessment Instances per Term</h3>
        <p className="text-xs text-slate-500 mb-4">How many CA and HW assessments per term? Scores are averaged before weighting.</p>
        <div className="flex gap-6">
          {['CA', 'HW'].map(type => (
            <div key={type}>
              <label className="text-xs font-medium text-slate-500 mb-1 block">{TYPE_LABELS[type]}</label>
              <select
                value={activeInstances[type] || 2}
                onChange={e => setInstances({ ...activeInstances, [type]: Number(e.target.value) })}
                className="input-field w-24"
              >
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n} per term</option>)}
              </select>
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1 block">MT & ET</label>
            <div className="input-field w-24 bg-slate-50 text-slate-400 text-sm select-none">1 (fixed)</div>
          </div>
        </div>
      </div>

      {/* Report template */}
      <div className="card">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Report Card Template</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            { key: 'detailed', icon: '📋', title: 'Template A — Detailed', desc: 'Shows CA, HW, MT, ET per term with ET reference columns and blended final grade.' },
            { key: 'summary',  icon: '📊', title: 'Template B — Summary',  desc: 'Shows term averages only (T1, T2, T3) with equal-weight final average.' },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTemplate(t.key)}
              className={clsx(
                'text-left rounded-xl border-2 p-4 transition',
                activeTemplate === t.key ? 'border-brand-500 bg-brand-50' : 'border-slate-200 hover:border-slate-300'
              )}
            >
              <p className="text-xl mb-1">{t.icon}</p>
              <p className="text-sm font-semibold text-slate-800">{t.title}</p>
              <p className="text-xs text-slate-500 mt-1">{t.desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => saveConfig()}
          disabled={saving || !weightOk}
          className="btn-primary"
        >
          {saving ? <Spinner size="sm" /> : 'Save Configuration'}
        </button>
      </div>

      {/* Assessment Schedule */}
      <div className="card">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Assessment Schedule</h3>
        <p className="text-xs text-slate-400 mb-4">Set date ranges for each assessment — teachers will be reminded automatically.</p>

        {/* Add new schedule */}
        <div className="flex flex-wrap gap-3 items-end p-3 bg-slate-50 rounded-xl mb-4">
          <Select label="Term"   value={String(newSched.termNumber)}   onChange={v => setNewSched(p => ({...p, termNumber: Number(v)}))}   placeholder="" options={TERM_NUMBERS.map(n => ({value:String(n),label:`Term ${n}`}))} />
          <Select label="Type"   value={newSched.assessmentType}        onChange={v => setNewSched(p => ({...p, assessmentType:v, instance:1}))} placeholder="" options={ASSESSMENT_TYPES.map(t => ({value:t,label:t}))} />
          <Select label="Inst."  value={String(newSched.instance)}      onChange={v => setNewSched(p => ({...p, instance: Number(v)}))}     placeholder="" options={[1,2,3,4].map(n=>({value:String(n),label:String(n)}))} />
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">From</label>
            <input type="date" value={newSched.dateFrom} onChange={e=>setNewSched(p=>({...p,dateFrom:e.target.value}))} className="input-field text-sm py-2" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500">To</label>
            <input type="date" value={newSched.dateTo} onChange={e=>setNewSched(p=>({...p,dateTo:e.target.value}))} className="input-field text-sm py-2" />
          </div>
          <button
            onClick={() => saveSched()}
            disabled={savingSched || !newSched.dateFrom || !newSched.dateTo}
            className="btn-primary text-sm self-end"
          >
            {savingSched ? <Spinner size="sm" /> : '+ Add'}
          </button>
        </div>

        {/* Existing schedules */}
        {schedules.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No schedule entries yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Assessment</th>
                <th>Term</th>
                <th>From</th>
                <th>To</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedules.map(s => (
                <tr key={s.id}>
                  <td><Badge variant={TYPE_COLORS[s.assessmentType] || 'default'} size="sm">{s.label || `${s.assessmentType} ${s.instance}`}</Badge></td>
                  <td>Term {s.termNumber}</td>
                  <td className="text-sm">{s.dateFrom}</td>
                  <td className="text-sm">{s.dateTo}</td>
                  <td className="text-right">
                    <button onClick={() => delSched(s.id)} className="text-xs text-red-500 hover:text-red-700">Remove</button>
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
   TAB 4 — REMINDERS
   ══════════════════════════════════════════════════════════════ */
function RemindersTab() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['assessment', 'reminders'],
    queryFn:  () => api.reminders({ days: 14 }),
  });
  const reminders = data?.data ?? [];

  const { mutate: notify, isLoading: notifying } = useMutation({
    mutationFn: () => api.notify({}),
    onSuccess:  () => qc.invalidateQueries(['assessment', 'reminders']),
  });

  const STATUS_CONFIG = {
    overdue:  { label: '⚠️ Overdue',  variant: 'danger',  bg: 'bg-red-50   border-red-100' },
    open:     { label: '✏️ Open',     variant: 'success', bg: 'bg-green-50 border-green-100' },
    upcoming: { label: '📅 Upcoming', variant: 'info',    bg: 'bg-blue-50  border-blue-100' },
  };

  if (isLoading) return <PageSpinner message="Checking assessments…" />;
  if (isError)   return <ErrorState message={error?.message} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Showing assessments open, overdue, or opening within the next 14 days.
        </p>
        <button
          onClick={() => notify()}
          disabled={notifying}
          className="btn-primary text-sm"
        >
          {notifying ? <Spinner size="sm" /> : '📧 Notify Teachers'}
        </button>
      </div>

      {reminders.length === 0 ? (
        <EmptyState icon="✅" title="No reminders" desc="All assessments are on schedule or none have been configured yet." />
      ) : (
        <div className="space-y-3">
          {reminders.map(r => {
            const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.upcoming;
            return (
              <div key={r.scheduleId} className={clsx('rounded-xl border p-4', sc.bg)}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Badge variant={sc.variant}>{sc.label}</Badge>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">
                        {r.label} — Term {r.termNumber}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {r.dateFrom} → {r.dateTo}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-slate-700 tabular-nums">{r.marksEntered}</p>
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
  const role = useAuthStore(s => s.session?.user?.role) || 'teacher';

  // Default tab based on role
  const defaultTab = ['admin','superadmin'].includes(role) ? 'config' : 'entry';
  const [tab, setTab] = useState(defaultTab);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-800">Grades & Assessment</h2>
      </div>

      <TabBar tab={tab} setTab={setTab} role={role} />

      <div className="pt-1">
        {tab === 'entry'  && <MarkEntryTab />}
        {tab === 'report' && <ReportCardsTab />}
        {tab === 'config' && <ConfigTab />}
        {tab === 'remind' && <RemindersTab />}
      </div>
    </div>
  );
}
