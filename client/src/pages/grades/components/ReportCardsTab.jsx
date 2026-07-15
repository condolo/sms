/* ============================================================
   ReportCardsTab — class/term selector + report card view
   ============================================================ */
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, FileText, Send, CheckCircle, Loader2 } from 'lucide-react';
import {
  assessment as assessmentApi,
  classes as classesApi,
  subjects as subjectsApi,
  reportCards as reportCardsApi,
  behaviour as behaviourApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { TERM_NUMBERS, DEFAULT_CUSTOM_TYPES } from '../constants.js';
import { Skeleton, SelField } from './GradesPrimitives.jsx';
import StudentReportCard from './StudentReportCard.jsx';
import { useCurrentAcademicPeriod } from '@/hooks/useCurrentAcademicPeriod.js';

export default function ReportCardsTab() {
  const [classId, setClassId] = useState('');
  const [termNum, setTermNum] = useState('');
  const qc = useQueryClient();
  const currentPeriod = useCurrentAcademicPeriod();

  /* Default the term picker to the live-resolved current term the moment
     it loads — still fully overridable (e.g. to publish a past term). */
  useEffect(() => {
    if (!currentPeriod.termNumber || termNum) return;
    setTermNum(String(currentPeriod.termNumber));
  }, [currentPeriod.termNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  const [publishError, setPublishError] = useState('');

  const school      = useAuthStore(s => s.session?.school);
  const academicYear = school?.academicYear ?? '';
  const role        = useAuthStore(s => s.session?.user?.role ?? '');

  /* ── Data queries ─────────────────────────────────────── */

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

  const { data: subjectMap } = useQuery({
    queryKey: ['subjects', 'map'],
    queryFn:  () => subjectsApi.list({ limit: 500 }),
    staleTime: 10 * 60_000,
    select: (res) => Object.fromEntries((res?.data ?? []).map(s => [s.id ?? s._id, s])),
  });

  const canQuery   = !!(classId && termNum);
  const prevTermNum = canQuery && Number(termNum) > 1 ? Number(termNum) - 1 : null;

  const { data: generateData, isLoading: isGenerating, isError, error, refetch } = useQuery({
    queryKey: ['reportCards', 'generate', { classId, termNum }],
    queryFn:  () => reportCardsApi.generate({ classId, termNumber: Number(termNum) }),
    enabled:  canQuery,
    staleTime: 60_000,
  });

  // Previous term — used for term-over-term deviation calculation
  const { data: prevGenerateData } = useQuery({
    queryKey: ['reportCards', 'generate', { classId, termNum: String(prevTermNum) }],
    queryFn:  () => reportCardsApi.generate({ classId, termNumber: prevTermNum }),
    enabled:  prevTermNum !== null,
    staleTime: 5 * 60_000,
  });

  // Per-instance raw marks indexed as [studentId][subjectId][`${type}_${instance}`]
  const { data: instanceMarksAll } = useQuery({
    queryKey: ['assessment', 'marks', { classId, termNum }],
    queryFn:  () => assessmentApi.getMarks({ classId, termNumber: Number(termNum) }),
    enabled:  canQuery,
    staleTime: 60_000,
    select: (res) => {
      const idx = {};
      for (const m of (res?.data ?? [])) {
        if (!idx[m.studentId]) idx[m.studentId] = {};
        if (!idx[m.studentId][m.subjectId]) idx[m.studentId][m.subjectId] = {};
        idx[m.studentId][m.subjectId][`${m.assessmentType}_${m.instance}`] = m.rawScore;
      }
      return idx;
    },
  });

  // Draft comments indexed by studentId
  const { data: commentsMap } = useQuery({
    queryKey: ['reportCards', 'draftComments', { classId, termNum }],
    queryFn:  () => reportCardsApi.draftComments.list({ classId, termNumber: Number(termNum) }),
    enabled:  canQuery,
    staleTime: 30_000,
    select: (res) => Object.fromEntries((res?.data ?? []).map(c => [c.studentId, c])),
  });

  // Behaviour summary indexed by studentId for this class
  const { data: behaviourMap } = useQuery({
    queryKey: ['behaviour', 'summary', { classId }],
    queryFn:  () => behaviourApi.summary({ classId }),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
    select: (res) => Object.fromEntries((res?.data ?? []).map(b => [b._id, b])),
  });

  // Published snapshots for this class/term — keyed by studentId
  const { data: snapshotsMap } = useQuery({
    queryKey: ['reportCards', 'snapshots', { classId, termNum }],
    queryFn:  () => reportCardsApi.snapshots.list({ classId, termNumber: Number(termNum), limit: 200 }),
    enabled:  canQuery,
    staleTime: 30_000,
    select: (res) => Object.fromEntries(
      (res?.data ?? []).filter(s => !s.superseded).map(s => [s.studentId, s])
    ),
  });

  /* ── Publish mutation ─────────────────────────────────── */
  const { mutate: publishBatch, isPending: isPublishing } = useMutation({
    mutationFn: () => reportCardsApi.publish({ classId, termNumber: Number(termNum) }),
    onSuccess: () => {
      setPublishError('');
      qc.invalidateQueries({ queryKey: ['reportCards', 'snapshots', { classId, termNum }] });
    },
    onError: (err) => setPublishError(err?.message ?? 'Publish failed'),
  });

  /* ── Comment save mutation ────────────────────────────── */

  const { mutateAsync: saveComment } = useMutation({
    mutationFn: ({ studentId, data }) =>
      reportCardsApi.draftComments.upsert(studentId, {
        ...data,
        classId,
        termNumber: Number(termNum),
      }),
    onSuccess: () => qc.invalidateQueries({
      queryKey: ['reportCards', 'draftComments', { classId, termNum }],
    }),
  });

  /* ── Derived data ─────────────────────────────────────── */

  // generate returns ok(res, { generated, config, students }) → { success, data: { generated, config, students } }
  const genPayload  = generateData?.data ?? {};
  const config      = genPayload.config ?? {};
  const customTypes = config.customTypes ?? DEFAULT_CUSTOM_TYPES;
  const gradeScale  = config.gradeScale ?? null;
  const students    = genPayload.students ?? [];

  const selectedClass = classesList.find(c => (c.id ?? c._id) === classId);
  const className     = selectedClass?.name ?? '';

  // Student info map from class students list
  const studentInfoMap = Object.fromEntries(
    studentsList.map(s => [s.id ?? s._id, s])
  );

  // Term-over-term deviation: current score − previous term score, per student per subject
  // deviationMap[studentId] = { subjects: { [subjectId]: number|null }, mean: number|null }
  const deviationMap = useMemo(() => {
    if (!students.length) return {};
    const prevStudents = prevGenerateData?.data?.students ?? [];
    const prevByStudent = Object.fromEntries(prevStudents.map(s => [s.studentId, s]));

    const map = {};
    for (const student of students) {
      const prev = prevByStudent[student.studentId];
      const subjectDevs = {};
      let total = 0, count = 0;

      for (const [subId, subData] of Object.entries(student.subjects ?? {})) {
        const curr = subData.finalScore ?? null;
        const prv  = prev?.subjects?.[subId]?.finalScore ?? null;
        const dev  = curr != null && prv != null ? curr - prv : null;
        subjectDevs[subId] = dev;
        if (dev != null) { total += dev; count++; }
      }

      map[student.studentId] = {
        subjects: subjectDevs,
        mean: count > 0 ? total / count : null,
      };
    }
    return map;
  }, [students, prevGenerateData]);

  /* ── Render ───────────────────────────────────────────── */

  return (
    <div className="space-y-4">

      {/* Selector bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Generate Report Cards</p>
        <div className="flex flex-wrap gap-3 items-end">
          <SelField
            label="Class"
            value={classId}
            onChange={v => { setClassId(v); }}
            options={classesList.map(c => ({ value: c.id ?? c._id, label: c.name }))}
            placeholder="Select class"
          />
          <SelField
            label="Term"
            value={termNum}
            onChange={setTermNum}
            options={TERM_NUMBERS.map(n => ({ value: String(n), label: `Term ${n}` }))}
            placeholder="Select term"
          />
          {canQuery && ['admin', 'superadmin'].includes(role) && (
            <div className="flex flex-col gap-1 ml-auto">
              <button
                onClick={() => { setPublishError(''); publishBatch(); }}
                disabled={isPublishing || !students.length}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isPublishing
                  ? <><Loader2 size={14} className="animate-spin" /> Publishing…</>
                  : <><Send size={14} /> Publish Report Cards</>}
              </button>
              {publishError && (
                <p className="text-xs text-red-500">{publishError}</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content area */}
      {!canQuery ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <FileText size={24} className="text-slate-300" />
          <p className="text-sm text-slate-500">Select a class and term to generate report cards.</p>
        </div>
      ) : isGenerating ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64" />)}
        </div>
      ) : isError ? (
        <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
          <AlertTriangle size={20} className="text-red-400" />
          <p className="text-sm text-slate-600">{error?.message ?? 'Failed to generate report data.'}</p>
          <button onClick={refetch} className="text-xs font-medium text-slate-700 underline mt-1">Retry</button>
        </div>
      ) : students.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <ClipboardList size={24} className="text-slate-300" />
          <p className="text-sm font-medium text-slate-600">No assessment data found</p>
          <p className="text-xs text-slate-400">Enter marks using the CA Marks tab first.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            {students.length} student{students.length !== 1 ? 's' : ''} · {className} · Term {termNum} {academicYear && `· ${academicYear}`}
          </p>
          {students.map(student => (
            <StudentReportCard
              key={student.studentId}
              student={student}
              studentInfo={studentInfoMap[student.studentId]}
              className={className}
              subjectMap={subjectMap}
              customTypes={customTypes}
              gradeScale={gradeScale}
              instanceMarks={instanceMarksAll?.[student.studentId]}
              draftComment={commentsMap?.[student.studentId]}
              onSaveComment={(data) => saveComment({ studentId: student.studentId, data })}
              termNum={Number(termNum)}
              school={school}
              academicYear={academicYear}
              studentDeviations={deviationMap[student.studentId] ?? null}
              behaviourSummary={behaviourMap?.[student.studentId] ?? null}
              snapshot={snapshotsMap?.[student.studentId] ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
