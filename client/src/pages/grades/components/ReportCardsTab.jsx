/* ============================================================
   ReportCardsTab — class/term selector + report card view
   ============================================================ */
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, FileText, Send, CheckCircle, Loader2 } from 'lucide-react';
import {
  assessment as assessmentApi,
  classes as classesApi,
  streams as streamsApi,
  subjects as subjectsApi,
  reportCards as reportCardsApi,
  behaviour as behaviourApi,
  academicConfig as academicConfigApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { TERM_NUMBERS, DEFAULT_CUSTOM_TYPES } from '../constants.js';
import { Skeleton, SelField } from './GradesPrimitives.jsx';
import StudentReportCard from './StudentReportCard.jsx';
import { useCurrentAcademicPeriod } from '@/hooks/useCurrentAcademicPeriod.js';

export default function ReportCardsTab() {
  const [classId, setClassId] = useState('');
  const [streamId, setStreamId] = useState('');
  const [termNum, setTermNum] = useState('');
  // Reported directly: no way to generate/publish for a year other than
  // whatever the school's calendar currently resolves as "current" — left
  // blank by default so the server still picks "now" (_resolveTermScope),
  // same posture as AssessmentAnalyticsPage's own year picker, but
  // explicitly reachable to review or publish a past year's term.
  const [yearId, setYearId] = useState('');
  const qc = useQueryClient();
  const currentPeriod = useCurrentAcademicPeriod();

  /* Default the term picker to the live-resolved current term the moment
     it loads — still fully overridable (e.g. to publish a past term). */
  useEffect(() => {
    if (!currentPeriod.termNumber || termNum) return;
    setTermNum(String(currentPeriod.termNumber));
  }, [currentPeriod.termNumber]); // eslint-disable-line react-hooks/exhaustive-deps

  // A stream filter only makes sense for the class it was picked under —
  // switching classes must not silently keep filtering by a stream that
  // belongs to the PREVIOUS class (or, worse, a same-named stream in the
  // new one that isn't what the admin meant).
  useEffect(() => { setStreamId(''); }, [classId]);

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

  // Academic years — explicit override for the term selector, same
  // "server resolves 'now' when omitted, but reachable to pick a
  // different year" posture as AssessmentAnalyticsPage.jsx.
  const { data: yearsData } = useQuery({
    queryKey: ['academic-config', 'years'],
    queryFn:  academicConfigApi.years.list,
    staleTime: 10 * 60_000,
  });
  const yearsList = yearsData?.data ?? yearsData ?? [];

  const { data: studentsData } = useQuery({
    queryKey: ['classes', classId, 'students'],
    queryFn:  () => classesApi.students(classId),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
  });
  const studentsList = studentsData?.data ?? [];

  // Streams for the selected class — raised directly: "after class add
  // even the stream to filter more." Filtering happens client-side below
  // (students is rendered unconditionally; /generate has no streamId
  // param, nor should it — a report batch is still generated/published
  // for the whole class, this narrows which of its students are SHOWN).
  const { data: streamsData } = useQuery({
    queryKey: ['streams', 'list', { classId }],
    queryFn:  () => streamsApi.list({ classId, status: 'active', limit: 50 }),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
  });
  const streamsList = streamsData?.data ?? [];

  const { data: subjectMap } = useQuery({
    queryKey: ['subjects', 'map'],
    queryFn:  () => subjectsApi.list({ limit: 500 }),
    staleTime: 10 * 60_000,
    select: (res) => Object.fromEntries((res?.data ?? []).map(s => [s.id ?? s._id, s])),
  });

  const canQuery   = !!(classId && termNum);
  const prevTermNum = canQuery && Number(termNum) > 1 ? Number(termNum) - 1 : null;

  const { data: generateData, isLoading: isGenerating, isError, error, refetch } = useQuery({
    queryKey: ['reportCards', 'generate', { classId, termNum, yearId }],
    queryFn:  () => reportCardsApi.generate({ classId, termNumber: Number(termNum), academicYearId: yearId || undefined }),
    enabled:  canQuery,
    staleTime: 60_000,
  });

  // Previous term — used for term-over-term deviation calculation
  const { data: prevGenerateData } = useQuery({
    queryKey: ['reportCards', 'generate', { classId, termNum: String(prevTermNum), yearId }],
    queryFn:  () => reportCardsApi.generate({ classId, termNumber: prevTermNum, academicYearId: yearId || undefined }),
    enabled:  prevTermNum !== null,
    staleTime: 5 * 60_000,
  });

  // Per-instance raw marks indexed as [studentId][subjectId][`${type}_${instance}`]
  // academicYearId included — Academic Year & Term Dependency Map, finding
  // #2 — explicit yearId (now pickable above) wins over the live-resolved
  // "current" year, so switching the Year selector actually changes what
  // this reads instead of staying pinned to "now" underneath it.
  const effectiveYearId = yearId || currentPeriod.academicYearId || '';
  const { data: instanceMarksAll } = useQuery({
    queryKey: ['assessment', 'marks', { classId, termNum, academicYearId: effectiveYearId }],
    queryFn:  () => assessmentApi.getMarks({ classId, termNumber: Number(termNum), academicYearId: effectiveYearId || undefined }),
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

  // Draft comments indexed by studentId. NOTE: report_card_draft_comments
  // is keyed by {studentId, termNumber} only — the server route has no
  // academicYearId filter to pass (a separate, pre-existing gap, same
  // class of issue the comment above describes but not yet closed for
  // this specific collection) — so a student's Term 2 draft comment can
  // in principle be shared across every year that has a Term 2 until
  // it's frozen into a published snapshot. Flagged, not fixed here.
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

  // Published snapshots for this class/term/year — keyed by studentId
  const { data: snapshotsMap } = useQuery({
    queryKey: ['reportCards', 'snapshots', { classId, termNum, yearId }],
    queryFn:  () => reportCardsApi.snapshots.list({ classId, termNumber: Number(termNum), academicYearId: yearId || undefined, limit: 200 }),
    enabled:  canQuery,
    staleTime: 30_000,
    select: (res) => Object.fromEntries(
      (res?.data ?? []).filter(s => !s.superseded).map(s => [s.studentId, s])
    ),
  });

  /* ── Publish mutation ─────────────────────────────────── */
  // Publish is always for the WHOLE class/term/year batch — PublishSchema
  // has no studentId/streamId narrowing, so the stream filter below is a
  // view-only convenience and must never look like it scopes this.
  const { mutate: publishBatch, isPending: isPublishing } = useMutation({
    mutationFn: () => reportCardsApi.publish({ classId, termNumber: Number(termNum), academicYearId: yearId || undefined }),
    onSuccess: () => {
      setPublishError('');
      qc.invalidateQueries({ queryKey: ['reportCards', 'snapshots', { classId, termNum, yearId }] });
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

  const { mutateAsync: saveSubjectComment } = useMutation({
    mutationFn: ({ studentId, subjectId, comment }) =>
      reportCardsApi.draftComments.saveSubject(studentId, subjectId, {
        classId,
        termNumber: Number(termNum),
        comment,
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

  // Reported directly: "the academic year is wrong ... not from what is
  // set in the system" — this tab had no year picker, so every report
  // card's displayed academic year came from the SESSION's live "current"
  // value (school.academicYear) regardless of which year's term the
  // admin actually generated. Once a year is explicitly picked above,
  // its own name must be what renders — not whatever "now" resolves to.
  const selectedYearDoc = yearId ? yearsList.find(y => (y.id ?? y._id) === yearId) : null;
  const displayAcademicYear = selectedYearDoc?.name ?? academicYear;

  // Student info map from class students list
  const studentInfoMap = Object.fromEntries(
    studentsList.map(s => [s.id ?? s._id, s])
  );

  // Stream filter — view-only narrowing of the already-generated class
  // batch (see the Publish mutation's own comment: a report batch is
  // always generated/published for the whole class regardless of this).
  const visibleStudents = streamId
    ? students.filter(s => studentInfoMap[s.studentId]?.streamId === streamId)
    : students;

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
            label="Stream"
            value={streamId}
            onChange={setStreamId}
            options={streamsList.map(st => ({ value: st.id ?? st._id, label: st.name }))}
            placeholder={classId ? 'All streams' : 'Select a class first'}
            disabled={!classId || streamsList.length === 0}
          />
          <SelField
            label="Term"
            value={termNum}
            onChange={setTermNum}
            options={TERM_NUMBERS.map(n => ({ value: String(n), label: `Term ${n}` }))}
            placeholder="Select term"
          />
          <SelField
            label="Academic Year"
            value={yearId}
            onChange={setYearId}
            options={yearsList.map(y => ({ value: y.id ?? y._id, label: y.name ?? y.year }))}
            placeholder={currentPeriod.academicYear ? `Current (${currentPeriod.academicYear})` : 'Current year'}
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
              {streamId && !publishError && (
                <p className="text-xs text-slate-400">Publishes every stream in {className}, not just the one shown here.</p>
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
      ) : visibleStudents.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <ClipboardList size={24} className="text-slate-300" />
          <p className="text-sm font-medium text-slate-600">No students in the selected stream</p>
          <button onClick={() => setStreamId('')} className="text-xs font-medium text-slate-700 underline mt-1">Clear stream filter</button>
        </div>
      ) : (
        <div className="space-y-4">
          {genPayload.provisional && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800">
                <span className="font-semibold">Provisional — not yet moderated.</span>{' '}
                {genPayload.unmoderatedExams?.length === 1
                  ? `"${genPayload.unmoderatedExams[0].title}" hasn't been moderated and approved yet.`
                  : `${genPayload.unmoderatedExams?.length ?? 0} exams feeding these scores haven't been moderated and approved yet.`}{' '}
                These numbers can still change before Publish will accept them.
              </p>
            </div>
          )}
          <p className="text-xs text-slate-500">
            {visibleStudents.length} student{visibleStudents.length !== 1 ? 's' : ''} · {className}
            {streamId && ` · ${streamsList.find(st => (st.id ?? st._id) === streamId)?.name ?? 'Stream'}`}
            {' '}· Term {termNum} {displayAcademicYear && `· ${displayAcademicYear}`}
          </p>
          {visibleStudents.map(student => (
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
              onSaveSubjectComment={(subjectId, comment) => saveSubjectComment({ studentId: student.studentId, subjectId, comment })}
              termNum={Number(termNum)}
              school={school}
              academicYear={displayAcademicYear}
              studentDeviations={deviationMap[student.studentId] ?? null}
              behaviourSummary={behaviourMap?.[student.studentId] ?? null}
              snapshot={snapshotsMap?.[student.studentId] ?? null}
              observationConfig={{ enabled: !!config.showObservationRatings, categories: config.observationCategories ?? [] }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
