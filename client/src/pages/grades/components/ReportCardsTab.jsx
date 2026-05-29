/* ============================================================
   ReportCardsTab — class/student/term selector + report view
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, FileText } from 'lucide-react';
import { assessment as api, classes as classesApi } from '@/api/client.js';
import { TERM_NUMBERS, ASSESSMENT_TYPES, DEFAULT_WEIGHTS } from '../constants.js';
import { Skeleton, SelField, TypePill } from './GradesPrimitives.jsx';
import StudentReportCard from './StudentReportCard.jsx';

export default function ReportCardsTab() {
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
            options={classesList.map(c => ({ value: c.id ?? c._id, label: c.name }))} placeholder="Select class" />
          {classId && (
            <SelField label="Student (optional)" value={studentId} onChange={setStudentId}
              options={studentsList.map(s => ({ value: s.id ?? s._id, label: `${s.firstName} ${s.lastName}` }))}
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
            <StudentReportCard
              key={stu.studentId}
              student={stu}
              studentsList={studentsList}
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
