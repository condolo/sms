/* ============================================================
   ReportCardsTab — class/term selector + report card view
   ============================================================ */
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useBlocker } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ClipboardList, FileText, Send, CheckCircle, Loader2, Lock, Printer } from 'lucide-react';
import {
  assessment as assessmentApi,
  classes as classesApi,
  streams as streamsApi,
  subjects as subjectsApi,
  reportCards as reportCardsApi,
  rcTemplates as rcTemplatesApi,
  behaviour as behaviourApi,
  attendance as attendanceApi,
  academicConfig as academicConfigApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { TERM_NUMBERS, DEFAULT_CUSTOM_TYPES } from '../constants.js';
import { Skeleton, SelField } from './GradesPrimitives.jsx';
import StudentReportCard from './StudentReportCard.jsx';
import KgStudentReportCard from './KgStudentReportCard.jsx';
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

  // Reported gap (platform audit, 2026-10-18): this screen's Class/Stream/
  // Term/Year selectors reset state with no save-before-switch guard at
  // all — unlike ExamsPage.jsx's grid, a teacher could type a class
  // teacher/principal remark here, switch class or term, and silently
  // lose it. Each mounted card (Student/KgStudentReportCard) exposes
  // isDirty()/flushIfDirty() via ref; this registry lets the selectors
  // and the browser-exit guards below ask every currently-visible card
  // before letting a switch or navigation proceed, same reasoning as
  // ExamsPage.jsx's own saveBeforeSwitch.
  const cardRefs = useRef(new Map());
  function registerCardRef(studentId, el) {
    if (el) cardRefs.current.set(studentId, el);
    else cardRefs.current.delete(studentId);
  }
  const [switchError, setSwitchError] = useState('');
  async function saveBeforeSwitch() {
    const cards = [...cardRefs.current.values()];
    if (cards.length === 0) return true;
    setSwitchError('');
    const results = await Promise.all(cards.map(c => c.flushIfDirty().catch(() => false)));
    if (results.every(Boolean)) return true;
    setSwitchError('Some unsaved remarks could not be saved automatically — please check the highlighted card(s) before switching.');
    return false;
  }
  // Reads cardRefs.current fresh on every call — safe to call lazily from
  // the blocker below (react-router invokes it at the moment navigation
  // is attempted, not once at render time), since cardRefs is a stable
  // ref, never recreated by a re-render.
  const anyCardDirty = useCallback(() => {
    return [...cardRefs.current.values()].some(c => c.isDirty?.());
  }, []);

  useEffect(() => {
    const handler = (e) => { if (anyCardDirty()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  const navBlocker = useBlocker(anyCardDirty);
  useEffect(() => {
    if (navBlocker.state !== 'blocked') return;
    (async () => {
      const ok = await saveBeforeSwitch();
      if (ok) navBlocker.proceed();
      else navBlocker.reset();
    })();
  }, [navBlocker]); // eslint-disable-line react-hooks/exhaustive-deps

  const [publishError, setPublishError] = useState('');
  // Reported directly (2026-10-13 workflow redesign): there is no more
  // pre-publish moderation step to be "incomplete" — publishing now
  // locks the Markbook automatically instead of requiring every subject
  // to already be submitted+approved+manually-locked beforehand.
  const [confirmingPublish, setConfirmingPublish] = useState(false);

  const school      = useAuthStore(s => s.session?.school);
  const academicYear = school?.academicYear ?? '';
  const role        = useAuthStore(s => s.session?.user?.role ?? '');
  // Same floor GET /bulk-pdf itself enforces (subject-scope.js's
  // isManagement) — showing the button to a role the server would just
  // 403 isn't useful, and this is deliberately broader than Publish's own
  // admin/superadmin-only gate (deputy/principal/hod can legitimately
  // want a printable batch without also holding publish rights).
  const isManagementRole = ['admin', 'superadmin', 'deputy_principal', 'deputy', 'principal', 'hod'].includes(role);

  /* ── Data queries ─────────────────────────────────────── */

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'list'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const classesList = classesData?.data ?? [];

  // Does this class use the Kindergarten competency-band pipeline, or
  // the ordinary numeric one? Deliberately separate endpoints/UI below —
  // report-cards.js's /kg/generate and /kg/publish are built around
  // concepts (indicators, performance bands) that don't fit the numeric
  // CA/HW/MT/ET shape, same reason the server never branches one route
  // on class type.
  const { data: kgTemplateData } = useQuery({
    queryKey: ['rc-templates', 'resolve', { classId }],
    queryFn:  () => rcTemplatesApi.resolve(classId),
    enabled:  !!classId,
    staleTime: 60_000,
  });
  const isKgClass = !!kgTemplateData?.data;

  // Academic years — explicit override for the term selector, same
  // "server resolves 'now' when omitted, but reachable to pick a
  // different year" posture as AssessmentAnalyticsPage.jsx.
  const { data: yearsData } = useQuery({
    queryKey: ['academic-config', 'years'],
    queryFn:  academicConfigApi.years.list,
    staleTime: 10 * 60_000,
  });
  const yearsList = yearsData?.data ?? yearsData ?? [];

  /* Term dates for the selected class/term/year. Attendance records carry
     only a date (no termId), so the live preview must send the term's own
     date range — without it GET /attendance/summary happily aggregates
     every term ever recorded for the class and a Term 3 card showed
     "Total Days 60" instead of that term's 20. The published PDF already
     scopes by the snapshot's term dates; this brings the preview in line. */
  const termYearDoc = useMemo(() => {
    const list = Array.isArray(yearsList) ? yearsList : [];
    if (yearId) return list.find(y => (y.id ?? y._id) === yearId) || null;
    return list.find(y => y.isCurrent) || list[0] || null;
  }, [yearsList, yearId]);

  const selectedTermDates = useMemo(() => {
    const terms = Array.isArray(termYearDoc?.terms) ? termYearDoc.terms : [];
    const selected = terms.find(t => Number(t.termNumber ?? 0) === Number(termNum))
      || terms[Number(termNum) - 1];
    return selected?.startDate && selected?.endDate
      ? { dateFrom: selected.startDate, dateTo: selected.endDate }
      : {};
  }, [termYearDoc, termNum]);

  // Reported directly: a student showed as a raw UUID instead of their
  // name, and vanished entirely once a stream filter was applied — both
  // traced to this call sending no limit, so the server's default page
  // size (50) silently truncated this lookup map for any class with more
  // than 50 active students. The actual report batch below (classesApi/
  // academic-calc's own generate query) has no such cap — it's only this
  // name/admission-number/streamId lookup that was quietly incomplete.
  // 500 matches the same ceiling the Markbook's own roster fetch uses.
  // Platform audit (2026-10-18): this call carried no `assessmentScope`
  // flag, so a staff member whose floor role is generically "school"-level
  // for its own module (exams_officer, admissions_officer, finance, hr,
  // timetabler, discipline_committee) but who also holds a real, narrow
  // teaching assignment fell through to the unrestricted default branch
  // here — same leak already closed for Attendance/Lessons/the Markbook's
  // own roster fetch (ExamsPage.jsx), just missed on this one caller.
  const { data: studentsData, isError: isStudentsError, refetch: refetchStudents } = useQuery({
    queryKey: ['classes', classId, 'students'],
    queryFn:  () => classesApi.students(classId, { limit: 500, assessmentScope: true }),
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
  const canQueryNumeric = canQuery && !isKgClass;
  const prevTermNum = canQueryNumeric && Number(termNum) > 1 ? Number(termNum) - 1 : null;

  const { data: generateData, isLoading: isGenerating, isError, error, refetch } = useQuery({
    queryKey: ['reportCards', 'generate', { classId, termNum, yearId }],
    queryFn:  () => reportCardsApi.generate({ classId, termNumber: Number(termNum), academicYearId: yearId || undefined }),
    enabled:  canQueryNumeric,
    staleTime: 60_000,
  });

  // Previous term — used for term-over-term deviation calculation
  const { data: prevGenerateData } = useQuery({
    queryKey: ['reportCards', 'generate', { classId, termNum: String(prevTermNum), yearId }],
    queryFn:  () => reportCardsApi.generate({ classId, termNumber: prevTermNum, academicYearId: yearId || undefined }),
    enabled:  prevTermNum !== null,
    staleTime: 5 * 60_000,
  });

  // Kindergarten pipeline — same selector state, a different endpoint.
  const { data: kgGenerateData, isLoading: isKgGenerating, isError: isKgError, error: kgError, refetch: refetchKg } = useQuery({
    queryKey: ['reportCards', 'kg', 'generate', { classId, termNum, yearId }],
    queryFn:  () => reportCardsApi.kg.generate({ classId, termNumber: Number(termNum), academicYearId: yearId || undefined }),
    enabled:  canQuery && isKgClass,
    staleTime: 60_000,
  });

  // Per-instance raw marks indexed as [studentId][subjectId][`${type}_${instance}`]
  // academicYearId included — Academic Year & Term Dependency Map, finding
  // #2 — explicit yearId (now pickable above) wins over the live-resolved
  // "current" year, so switching the Year selector actually changes what
  // this reads instead of staying pinned to "now" underneath it.
  const effectiveYearId = yearId || currentPeriod.academicYearId || '';
  const { data: instanceMarksAll, isError: isMarksError, refetch: refetchMarks } = useQuery({
    queryKey: ['assessment', 'marks', { classId, termNum, academicYearId: effectiveYearId }],
    queryFn:  () => assessmentApi.getMarks({ classId, termNumber: Number(termNum), academicYearId: effectiveYearId || undefined }),
    enabled:  canQueryNumeric,
    staleTime: 60_000,
    select: (res) => {
      const idx = {};
      // Publishing locks every mark row for that class + term
      // (assessment_marks.isLocked). The UI needs to SHOW that state -
      // until now the only sign a class had been published was a small
      // report-ID chip on each card, so nobody could see that the
      // Markbook was closed until a teacher tried to edit a mark and
      // was refused.
      let locked = false;
      for (const m of (res?.data ?? [])) {
        if (m.isLocked) locked = true;
        if (!idx[m.studentId]) idx[m.studentId] = {};
        if (!idx[m.studentId][m.subjectId]) idx[m.studentId][m.subjectId] = {};
        idx[m.studentId][m.subjectId][`${m.assessmentType}_${m.instance}`] = m.rawScore;
      }
      return { index: idx, locked };
    },
  });

  // Draft comments indexed by studentId. NOTE: report_card_draft_comments
  // is keyed by {studentId, termNumber} only — the server route has no
  // academicYearId filter to pass (a separate, pre-existing gap, same
  // class of issue the comment above describes but not yet closed for
  // this specific collection) — so a student's Term 2 draft comment can
  // in principle be shared across every year that has a Term 2 until
  // it's frozen into a published snapshot. Flagged, not fixed here.
  const { data: commentsMap, isError: isCommentsError, refetch: refetchComments } = useQuery({
    queryKey: ['reportCards', 'draftComments', { classId, termNum }],
    queryFn:  () => reportCardsApi.draftComments.list({ classId, termNumber: Number(termNum) }),
    enabled:  canQuery,
    staleTime: 30_000,
    select: (res) => Object.fromEntries((res?.data ?? []).map(c => [c.studentId, c])),
  });

  // Behaviour summary indexed by studentId for this class
  const { data: behaviourMap, isError: isBehaviourError, refetch: refetchBehaviour } = useQuery({
    queryKey: ['behaviour', 'summary', { classId }],
    queryFn:  () => behaviourApi.incidents.summary({ classId }),
    enabled:  !!classId,
    staleTime: 5 * 60_000,
    select: (res) => Object.fromEntries((res?.data ?? []).map(b => [b._id, b])),
  });

  /* Attendance summary indexed by studentId for this class — reported
     directly: "attendance summary is on but I'm not seeing it", traced to
     this screen never fetching attendance at all (only the published PDF
     did). Mirrors behaviourMap above exactly, but scoped to the selected
     term's date range: attendance records have no termId, so a bare
     { classId } query aggregates every term and a Term 3 card misleadingly
     showed 60 total days (3 × 20) instead of 20. */
  const { data: attendanceMap, isError: isAttendanceError, refetch: refetchAttendance } = useQuery({
    queryKey: ['attendance', 'summary', { classId, ...selectedTermDates }],
    queryFn:  () => attendanceApi.summary({ classId, ...selectedTermDates }),
    enabled:  !!classId && !!termNum && !!selectedTermDates.dateFrom,
    staleTime: 5 * 60_000,
    select: (res) => Object.fromEntries((res?.data ?? []).map(a => [a._id, a])),
  });

  // Published snapshots for this class/term/year — keyed by studentId
  const { data: snapshotsMap, isError: isSnapshotsError, refetch: refetchSnapshots } = useQuery({
    queryKey: ['reportCards', 'snapshots', { classId, termNum, yearId }],
    queryFn:  () => reportCardsApi.snapshots.list({ classId, termNumber: Number(termNum), academicYearId: yearId || undefined, limit: 200 }),
    enabled:  canQuery,
    staleTime: 30_000,
    select: (res) => Object.fromEntries(
      (res?.data ?? []).filter(s => !s.superseded).map(s => [s.studentId, s])
    ),
  });

  // Reported directly, root-caused against live data (2026-10-18, Mr
  // Rajiv — "some of my marks disappeared"): marks/comments he'd already
  // saved were confirmed intact in the database the whole time. Every
  // query above except the main "generate" one swallowed a fetch failure
  // completely silently — commentsMap/instanceMarksAll/behaviourMap/
  // attendanceMap/snapshotsMap all rendered as if the data were genuinely
  // empty, with nothing telling the teacher a request had failed rather
  // than that nothing existed. One combined banner, not five separate
  // ones — a teacher needs "something failed to load, don't trust what
  // you see as complete" once, not a wall of red boxes.
  const anyLoadError = isStudentsError || isCommentsError || isMarksError || isBehaviourError || isAttendanceError || isSnapshotsError;
  function retryAllLoads() {
    if (isStudentsError) refetchStudents();
    if (isCommentsError) refetchComments();
    if (isMarksError) refetchMarks();
    if (isBehaviourError) refetchBehaviour();
    if (isAttendanceError) refetchAttendance();
    if (isSnapshotsError) refetchSnapshots();
  }

  // "Just a label" (2026-10-18) — the Mid-Term/End-of-Term tag shown in
  // place of "Term X" on the report card. A setting per {class, term,
  // year}, not part of the snapshot until generate/publish freezes it
  // onto one — so it survives a republish without needing to be retyped.
  const { data: cycleLabelData } = useQuery({
    queryKey: ['reportCards', 'cycleLabel', { classId, termNum, yearId }],
    queryFn:  () => reportCardsApi.cycleLabel.get({ classId, termNumber: Number(termNum), academicYearId: yearId || undefined }),
    enabled:  canQuery,
    staleTime: 30_000,
  });
  const savedCycleLabel = cycleLabelData?.data?.label ?? '';
  const [labelDraft, setLabelDraft] = useState('');
  const [labelSaved, setLabelSaved] = useState(false);
  useEffect(() => { setLabelDraft(savedCycleLabel); }, [savedCycleLabel]);

  const { mutate: saveCycleLabel, isPending: savingLabel } = useMutation({
    mutationFn: () => reportCardsApi.cycleLabel.set({
      classId, termNumber: Number(termNum), academicYearId: yearId || undefined, label: labelDraft,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reportCards', 'cycleLabel', { classId, termNum, yearId }] });
      setLabelSaved(true);
      setTimeout(() => setLabelSaved(false), 2000);
    },
  });

  /* ── Publish mutation ─────────────────────────────────── */
  // Publish is always for the WHOLE class/term/year batch — PublishSchema
  // has no studentId/streamId narrowing, so the stream filter below is a
  // view-only convenience and must never look like it scopes this.
  const { mutate: publishBatch, isPending: isPublishing } = useMutation({
    mutationFn: (override = {}) => (isKgClass ? reportCardsApi.kg.publish : reportCardsApi.publish)({
      classId, termNumber: Number(termNum), academicYearId: yearId || undefined,
      ...override,
    }),
    onSuccess: () => {
      setPublishError('');
      qc.invalidateQueries({ queryKey: ['reportCards', 'snapshots', { classId, termNum, yearId }] });
    },
    onError: (err) => setPublishError(err?.message ?? 'Publish failed'),
  });

  /* ── Bulk print (the accepted school standard) ──────────────
     Reported directly: "the downloaded class report cards look
     different from the printed ones - the print version was accurate."
     True root cause: the class download went through a completely
     different renderer (the server's cursor-streamed PDFKit bulk
     export), while a single card's Print button renders the shared
     IR through the HTML adapter in the browser. Two renderers, two
     designs - they could never match.

     This replaces it with the only construction that is 1:1 by
     definition: every student's card is rendered through the EXACT
     route their own Print button uses - a published snapshot through
     GET /report-cards/:id/html, an unpublished one through
     POST /report-cards/preview-html - and the results are combined
     into one printable document, one student per page. Printing that
     document (or choosing "Save as PDF" in the print dialog) is
     byte-for-byte what printing that student's card produces.

     The server-side bulk PDF route (GET /report-cards/bulk-pdf) is
     left untouched and still available for API consumers. */
  const [printingClass, setPrintingClass] = useState(false);
  const [printClassError, setPrintClassError] = useState('');

  function _bodyOf(doc) {
    const m = String(doc || '').match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    return m ? m[1] : String(doc || '');
  }
  function _stylesOf(doc) {
    return [...String(doc || '').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]).join('\n');
  }

  async function printClass(scope) {
    setPrintClassError('');
    const list = scope === 'stream' ? visibleStudents : students;
    if (!list.length) {
      setPrintClassError('There are no report cards to print for this selection.');
      return;
    }
    setPrintingClass(true);
    try {
      const docs = [];
      for (const student of list) {
        const snap = snapshotsMap?.[student.studentId];
        const html = snap?.id
          ? (await reportCardsApi.html(snap.id))?.data?.html
          : (await reportCardsApi.previewHtml({
              student,
              studentInfo: studentInfoMap[student.studentId],
              classId,
              className,
              termNum: Number(termNum),
              academicYear: displayAcademicYear,
              school,
              draftComment: commentsMap?.[student.studentId],
              studentDeviations: deviationMap[student.studentId] ?? null,
              behaviourSummary: behaviourMap?.[student.studentId] ?? null,
              config: { gradeScale, customTypes, reportLabel: savedCycleLabel || null },
            }))?.data?.html;
        if (html) docs.push(html);
      }
      if (!docs.length) {
        setPrintClassError('Could not render the report cards for this class.');
        return;
      }

      const streamName = streamsList.find(s => (s.id ?? s._id) === streamId)?.name;
      const title = [
        'Report Cards',
        className || 'Class',
        scope === 'stream' && streamName ? streamName : null,
        `Term ${termNum}`,
        displayAcademicYear || null,
      ].filter(Boolean).join(' - ');

      const printDocument = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>${title}</title>
<style>${_stylesOf(docs[0])}</style>
<style>
  @page { margin: 1.5cm; size: A4; }
  .rc-batch > * { page-break-after: always; break-after: page; }
  .rc-batch > *:last-child { page-break-after: auto; break-after: auto; }
  html, body { margin: 0; padding: 0; }
</style>
</head><body>
<div class="rc-batch">
${docs.map(h => `<div>${_bodyOf(h)}</div>`).join('\n')}
</div>
</body></html>`;

      const w = window.open('', '_blank', 'width=1200,height=900');
      if (!w) {
        setPrintClassError('Please allow pop-ups to print the class report cards.');
        return;
      }
      w.document.open();
      w.document.write(printDocument);
      w.document.close();
      w.focus();
      // Photos/signatures are remote images - wait for them before the
      // print dialog opens, or they land on the page after it.
      const imgs = Array.from(w.document.images || []);
      await Promise.all(imgs.map(img => (img.complete
        ? Promise.resolve()
        : new Promise(res => { img.onload = res; img.onerror = res; }))));
      setTimeout(() => w.print(), 400);
    } catch (err) {
      console.error('[ReportCardsTab] print class failed', err);
      setPrintClassError(err?.message ?? 'Failed to render the class report cards.');
    } finally {
      setPrintingClass(false);
    }
  }

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

  const kgGenPayload = kgGenerateData?.data ?? {};
  const kgStudents   = kgGenPayload.students ?? [];

  const selectedClass = classesList.find(c => (c.id ?? c._id) === classId);
  const className     = selectedClass?.name ?? '';

  // Reported directly: "the academic year is wrong ... not from what is
  // set in the system" — this tab had no year picker, so every report
  // card's displayed academic year came from the SESSION's live "current"
  // value (school.academicYear) regardless of which year's term the
  // admin actually generated. Once a year is explicitly picked above,
  // its own name must be what renders — not whatever "now" resolves to.
  //
  // Reported directly again (2026-10-19, cover page read "Academic Year
  // · Mid Term 1" with nothing between): when no year is explicitly
  // picked (the common default — "Current year" placeholder), this fell
  // all the way back to `academicYear` = school.academicYear, a raw
  // string field on the schools doc that nothing ever populates — it was
  // always ''. useCurrentAcademicPeriod() (already used elsewhere in
  // this file, line 37) resolves the real current year server-side from
  // academic_years.isCurrent, same source the year picker's own
  // placeholder text already trusts — that belongs in this fallback
  // chain ahead of the dead school.academicYear field, not after it.
  const selectedYearDoc = yearId ? yearsList.find(y => (y.id ?? y._id) === yearId) : null;
  const displayAcademicYear = selectedYearDoc?.name ?? currentPeriod.academicYear ?? academicYear;

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
  const visibleKgStudents = streamId
    ? kgStudents.filter(s => studentInfoMap[s.studentId]?.streamId === streamId)
    : kgStudents;

  // How many of these students already have a PUBLISHED snapshot
  // (a published card prints its frozen render; an unpublished one prints
  // the live draft). Only used for the "Print Class" hint below.
  const publishedCount = Object.keys(snapshotsMap ?? {}).length;

  // Published / locked state of the selected class + term, for the
  // status strip under the selectors. Reported directly: "will the UI
  // show the class was published and locked?" - it had to, in one place.
  const totalStudents     = isKgClass ? kgStudents.length : students.length;
  const publishedSnaps    = Object.values(snapshotsMap ?? {});
  const latestVersion     = publishedSnaps.reduce((m, s) => Math.max(m, s.version || 1), 0);
  const latestPublishedAt = publishedSnaps
    .map(s => s.publishedAt)
    .filter(Boolean)
    .sort()
    .pop() || null;
  const marksLocked        = !!instanceMarksAll?.locked;

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

      {switchError && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">{switchError}</div>
      )}

      {anyLoadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center justify-between gap-3 text-xs text-red-800">
          <span>
            Some data failed to load — marks, comments, attendance, or behaviour shown below may be incomplete.
            This does not mean anything was deleted; it's still saved.
          </span>
          <button
            onClick={retryAllLoads}
            className="shrink-0 px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-700 font-medium hover:bg-red-50 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Selector bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Generate Report Cards</p>
        <div className="flex flex-wrap gap-3 items-end">
          <SelField
            label="Class"
            value={classId}
            onChange={async v => { if (!(await saveBeforeSwitch())) return; setClassId(v); }}
            options={classesList.map(c => ({ value: c.id ?? c._id, label: c.name }))}
            placeholder="Select class"
          />
          <SelField
            label="Stream"
            value={streamId}
            onChange={async v => { if (!(await saveBeforeSwitch())) return; setStreamId(v); }}
            options={streamsList.map(st => ({ value: st.id ?? st._id, label: st.name }))}
            placeholder={classId ? 'All streams' : 'Select a class first'}
            disabled={!classId || streamsList.length === 0}
          />
          <SelField
            label="Term"
            value={termNum}
            onChange={async v => { if (!(await saveBeforeSwitch())) return; setTermNum(v); }}
            options={TERM_NUMBERS.map(n => ({ value: String(n), label: `Term ${n}` }))}
            placeholder="Select term"
          />
          <SelField
            label="Academic Year"
            value={yearId}
            onChange={async v => { if (!(await saveBeforeSwitch())) return; setYearId(v); }}
            options={yearsList.map(y => ({ value: y.id ?? y._id, label: y.name ?? y.year }))}
            placeholder={currentPeriod.academicYear ? `Current (${currentPeriod.academicYear})` : 'Current year'}
          />
          {canQuery && isManagementRole && (
            <div className="flex flex-col gap-1">
              <div className="flex gap-2">
                <button
                  onClick={() => printClass('class')}
                  disabled={printingClass}
                  title={`Print every report card in ${className || 'this class'} as ONE document — every page is rendered through the exact same route as that student's own Print button. Choose "Save as PDF" in the print dialog to download it.`}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {printingClass ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                  Print Class
                </button>
                {streamId && (
                  <button
                    onClick={() => printClass('stream')}
                    disabled={printingClass}
                    title="Print only this stream's report cards"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {printingClass ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
                    Print Stream
                  </button>
                )}
              </div>
              {publishedCount < students.length && (
                <p className="text-xs text-slate-500">
                  {publishedCount} of {students.length} published — the rest print as drafts.
                </p>
              )}
              {printClassError && <p className="text-xs text-red-500">{printClassError}</p>}
            </div>
          )}
          {canQuery && ['admin', 'superadmin'].includes(role) && (
            <div className="flex flex-col gap-1 ml-auto">
              <button
                onClick={() => { setPublishError(''); setConfirmingPublish(true); }}
                disabled={isPublishing || !(isKgClass ? kgStudents.length : students.length)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isPublishing
                  ? <><Loader2 size={14} className="animate-spin" /> Publishing…</>
                  : <><Send size={14} /> Publish Report Cards</>}
              </button>
              {publishError && (
                <p className="text-xs text-red-500">{publishError}</p>
              )}
              {streamId && !publishError && !confirmingPublish && (
                <p className="text-xs text-slate-400">Publishes every stream in {className}, not just the one shown here.</p>
              )}
            </div>
          )}
        </div>
        {/* Published / locked state of the selected class + term. Reported
            directly: "will the UI show the class was published and locked?"
            Until now the only signal was a small report-ID chip on each
            student card - neither the class as a whole nor the fact that
            its Markbook rows are closed was visible anywhere, so an admin
            or teacher had to try editing a mark to find out. */}
        {canQuery && totalStudents > 0 && (
          <div className={`mx-6 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-xs ${
            publishedCount > 0
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-slate-200 bg-slate-50 text-slate-600'
          }`}>
            {publishedCount > 0 ? (
              <>
                <span className="inline-flex items-center gap-1 font-semibold">
                  <CheckCircle size={13} /> Published
                </span>
                {latestVersion > 0 && <span className="font-mono">v{latestVersion}</span>}
                {latestPublishedAt && (
                  <span>· {new Date(latestPublishedAt).toLocaleDateString()}</span>
                )}
                <span>
                  · {publishedCount} of {totalStudents} student{totalStudents === 1 ? '' : 's'}
                </span>
                {marksLocked && (
                  <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                    <Lock size={11} /> Marks locked
                  </span>
                )}
                <span className="text-emerald-700/80">
                  Visible to students and parents. Publishing again creates a new version.
                </span>
              </>
            ) : (
              <>
                <span className="inline-flex items-center gap-1 font-semibold">
                  <AlertTriangle size={13} /> Not published
                </span>
                <span>
                  Marks and comments are still editable. Publishing locks the Markbook for this
                  class and term and releases the cards to students and parents.
                </span>
              </>
            )}
          </div>
        )}
        {/* Reported directly: publishing should warn before it locks the
           Markbook and makes report cards visible to students/parents —
           2026-10-13 workflow redesign (marks now lock AUTOMATICALLY at
           publish, there's no more pre-publish approval step to check). */}
        {confirmingPublish && (
          <div className="mx-6 mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-2.5">
            <p className="text-sm font-semibold text-amber-800">Confirm publish</p>
            <p className="text-xs text-amber-700">
              Publishing will lock every mark entry in the Markbook for <strong>{className || 'this class'}</strong> — Term {termNum}{displayAcademicYear && ` · ${displayAcademicYear}`} — teachers will no longer be able to edit them, and these report cards become visible to students and parents immediately. Only an admin can unlock marks afterward for a correction.
            </p>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => { setConfirmingPublish(false); publishBatch(); }}
                disabled={isPublishing}
                className="text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
              >
                Lock &amp; Publish
              </button>
              <button
                onClick={() => setConfirmingPublish(false)}
                className="text-xs text-amber-600 hover:text-amber-800 px-1"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Content area — Kindergarten classes render through their own
          generate/publish pipeline (see isKgClass above); the loading/
          error/empty states below branch on it, not a second copy of
          this whole block. */}
      {!canQuery ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <FileText size={24} className="text-slate-300" />
          <p className="text-sm text-slate-500">Select a class and term to generate report cards.</p>
        </div>
      ) : (isKgClass ? isKgGenerating : isGenerating) ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-64" />)}
        </div>
      ) : (isKgClass ? isKgError : isError) ? (
        <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
          <AlertTriangle size={20} className="text-red-400" />
          <p className="text-sm text-slate-600">{(isKgClass ? kgError : error)?.message ?? 'Failed to generate report data.'}</p>
          <button onClick={() => (isKgClass ? refetchKg() : refetch())} className="text-xs font-medium text-slate-700 underline mt-1">Retry</button>
        </div>
      ) : (isKgClass ? kgStudents : students).length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <ClipboardList size={24} className="text-slate-300" />
          <p className="text-sm font-medium text-slate-600">
            {isKgClass ? 'No indicator marks found' : 'No assessment data found'}
          </p>
          <p className="text-xs text-slate-400">
            {isKgClass
              ? "Enter marks using the Markbook's Kindergarten view first."
              : 'Enter marks using the CA Marks tab first.'}
          </p>
        </div>
      ) : (isKgClass ? visibleKgStudents : visibleStudents).length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <ClipboardList size={24} className="text-slate-300" />
          <p className="text-sm font-medium text-slate-600">No students in the selected stream</p>
          <button onClick={() => setStreamId('')} className="text-xs font-medium text-slate-700 underline mt-1">Clear stream filter</button>
        </div>
      ) : isKgClass ? (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            {visibleKgStudents.length} student{visibleKgStudents.length !== 1 ? 's' : ''} · {className}
            {streamId && ` · ${streamsList.find(st => (st.id ?? st._id) === streamId)?.name ?? 'Stream'}`}
            {' '}· Term {termNum} {displayAcademicYear && `· ${displayAcademicYear}`}
          </p>
          {visibleKgStudents.map(student => (
            <KgStudentReportCard
              key={student.studentId}
              ref={el => registerCardRef(student.studentId, el)}
              student={student}
              className={className}
              termNum={Number(termNum)}
              academicYear={displayAcademicYear}
              draftComment={commentsMap?.[student.studentId]}
              onSaveComment={(data) => saveComment({ studentId: student.studentId, data })}
              snapshot={snapshotsMap?.[student.studentId] ?? null}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            {visibleStudents.length} student{visibleStudents.length !== 1 ? 's' : ''} · {className}
            {streamId && ` · ${streamsList.find(st => (st.id ?? st._id) === streamId)?.name ?? 'Stream'}`}
            {' '}· Term {termNum} {displayAcademicYear && `· ${displayAcademicYear}`}
          </p>
          {visibleStudents.map(student => (
            <StudentReportCard
              key={student.studentId}
              ref={el => registerCardRef(student.studentId, el)}
              student={student}
              studentInfo={studentInfoMap[student.studentId]}
              classId={classId}
              className={className}
              subjectMap={subjectMap}
              customTypes={customTypes}
              gradeScale={gradeScale}
              instanceMarks={instanceMarksAll?.index?.[student.studentId]}
              draftComment={commentsMap?.[student.studentId]}
              onSaveComment={(data) => saveComment({ studentId: student.studentId, data })}
              onSaveSubjectComment={(subjectId, comment) => saveSubjectComment({ studentId: student.studentId, subjectId, comment })}
              termNum={Number(termNum)}
              school={school}
              academicYear={displayAcademicYear}
              studentDeviations={deviationMap[student.studentId] ?? null}
              behaviourSummary={behaviourMap?.[student.studentId] ?? null}
              attendanceSummary={attendanceMap?.[student.studentId] ?? null}
              showAttendance={config.showAttendanceSummary !== false}
              snapshot={snapshotsMap?.[student.studentId] ?? null}
              observationConfig={{ enabled: !!config.showObservationRatings, categories: config.observationCategories ?? [] }}
              showRanking={!!config.rankingEnabled && config.showRankOnReport !== false}
              reportLabel={savedCycleLabel || null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
