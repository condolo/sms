/* ============================================================
   EnrollmentTab — Manage student subject enrollment.

   Flow:
     1. Pick a class → see its subjects (from class curriculum)
     2. Click a subject → right panel shows enrolled students
     3. Add individual student via search or bulk-enroll class
     4. Remove (unenroll) individual student
   ============================================================ */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Users, Search, X, Plus, UserMinus, UserPlus, BookOpen, Loader2,
} from 'lucide-react';
import clsx from 'clsx';
import {
  classes        as classesApi,
  classSubjects  as csApi,
  students       as studentsApi,
  studentSubjects as enrollApi,
} from '@/api/client.js';
import { useSections } from '@/hooks/useSections.js';

const SECTION_BADGE = {
  primary:   'bg-blue-100 text-blue-700',
  secondary: 'bg-violet-100 text-violet-700',
  alevel:    'bg-amber-100 text-amber-700',
  all:       'bg-slate-100 text-slate-600',
  kg:        'bg-pink-100 text-pink-700',
};
const SECTION_LABELS = { kg: 'KG', primary: 'Primary', secondary: 'Secondary', alevel: 'A-Level', all: 'All' };

export default function EnrollmentTab({ flash }) {
  const qc = useQueryClient();
  const { sections: schoolSections } = useSections();
  const [classId,    setClassId]    = useState('');
  const [subjectId,  setSubjectId]  = useState('');
  const [search,     setSearch]     = useState('');
  const [enrolling,  setEnrolling]  = useState(null);
  const [unenrolling, setUnenrolling] = useState(null);
  const [bulking,    setBulking]    = useState(false);

  /* ── data ─────────────────────────────────────────────────── */
  const { data: classes = [] } = useQuery({
    queryKey: ['classes'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    select:   r => (r?.data ?? (Array.isArray(r) ? r : [])).sort((a,b) => (a.order ?? 0) - (b.order ?? 0)),
    staleTime: 60_000,
  });

  // Subjects for selected class (from class_subjects curriculum)
  const { data: curriculumSubjects = [], isLoading: currLoading } = useQuery({
    queryKey: ['class-curriculum-subjects', classId],
    queryFn:  () => csApi.list({ classId }),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    enabled:  !!classId,
    staleTime: 30_000,
  });

  // Enrolled students for selected subject
  const { data: enrollments = [], isLoading: enrollLoading, refetch: refetchEnroll } = useQuery({
    queryKey: ['subject-enrollments-class', classId, subjectId],
    queryFn:  () => enrollApi.list({ subjectId }),
    select:   r => {
      const all = r?.data ?? (Array.isArray(r) ? r : []);
      // Filter to this class only
      return all.filter(e => e.classId === classId || e.student?.classId === classId);
    },
    enabled:  !!subjectId && !!classId,
    staleTime: 0,
  });

  // Students in this class for search/add
  const { data: classStudents = [] } = useQuery({
    queryKey: ['students-in-class', classId],
    queryFn:  () => studentsApi.list({ classId, status: 'active', limit: 500 }),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    enabled:  !!classId,
    staleTime: 30_000,
  });

  const enrolledIds  = new Set(enrollments.map(e => e.studentId));
  const searchQ      = search.trim().toLowerCase();
  const searchResults = searchQ.length >= 2
    ? classStudents.filter(s =>
        !enrolledIds.has(s.id) &&
        (`${s.firstName} ${s.lastName}`.toLowerCase().includes(searchQ) ||
         (s.admissionNumber ?? '').toLowerCase().includes(searchQ))
      ).slice(0, 8)
    : [];

  const selectedSubject = curriculumSubjects.find(cs => cs.subjectId === subjectId);
  const selectedClass   = classes.find(c => c.id === classId);
  const sectionKey      = selectedClass?.sectionKey ?? '';

  /* Group classes by section */
  const classBySection = classes.reduce((acc, c) => {
    const key = c.sectionKey ?? 'other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});
  const knownSectionKeys = new Set(schoolSections.map(s => s.key));
  const sectionLabelMap  = Object.fromEntries(schoolSections.map(s => [s.key, s.name]));
  const sectionOrder = [
    ...schoolSections.map(s => s.key),
    ...Object.keys(classBySection).filter(k => !knownSectionKeys.has(k) && k !== 'other'),
    'other',
  ];

  /* ── actions ─────────────────────────────────────────────── */
  function invalidateCounts() { qc.invalidateQueries({ queryKey: ['student-subjects-counts'] }); }

  async function handleEnroll(studentId) {
    setEnrolling(studentId);
    try {
      await enrollApi.enroll({ studentId, subjectId });
      refetchEnroll(); invalidateCounts(); setSearch('');
      flash('Student enrolled');
    } catch (err) { flash(err.message || 'Enroll failed', 'error'); }
    finally { setEnrolling(null); }
  }

  async function handleUnenroll(enrollmentId) {
    setUnenrolling(enrollmentId);
    try {
      await enrollApi.unenroll(enrollmentId);
      refetchEnroll(); invalidateCounts();
      flash('Student unenrolled');
    } catch (err) { flash(err.message || 'Unenroll failed', 'error'); }
    finally { setUnenrolling(null); }
  }

  async function handleBulkEnroll() {
    setBulking(true);
    try {
      const r = await enrollApi.bulk({ subjectId, classId });
      refetchEnroll(); invalidateCounts();
      flash(r?.message ?? `${selectedClass?.name} enrolled in ${selectedSubject?.subject?.name}`);
    } catch (err) { flash(err.message || 'Bulk enroll failed', 'error'); }
    finally { setBulking(false); }
  }

  /* ── render ─────────────────────────────────────────────── */
  return (
    <div className="px-6 py-5">

      {/* Selectors row */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {/* Class selector */}
        <div className="relative">
          <BookOpen size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <select
            value={classId}
            onChange={e => { setClassId(e.target.value); setSubjectId(''); setSearch(''); }}
            className="pl-9 pr-8 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 min-w-[200px]"
          >
            <option value="">Select a class…</option>
            {sectionOrder.map(sec => {
              const group = classBySection[sec];
              if (!group?.length) return null;
              const label = sectionLabelMap[sec] ?? SECTION_LABELS[sec] ?? sec;
              return (
                <optgroup key={sec} label={label}>
                  {group.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              );
            })}
          </select>
        </div>

        {/* Subject selector (only once class chosen) */}
        {classId && (
          <select
            value={subjectId}
            onChange={e => { setSubjectId(e.target.value); setSearch(''); }}
            disabled={currLoading || curriculumSubjects.length === 0}
            className="px-3 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 min-w-[200px] disabled:opacity-50"
          >
            <option value="">
              {currLoading ? 'Loading subjects…' : curriculumSubjects.length === 0 ? 'No subjects in curriculum' : 'Select a subject…'}
            </option>
            {curriculumSubjects.map(cs => (
              <option key={cs.subjectId} value={cs.subjectId}>
                {cs.subject?.name ?? cs.subjectId}{cs.isCompulsoryForClass ? ' ★' : ''}
              </option>
            ))}
          </select>
        )}

        {selectedClass && (
          <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-medium', SECTION_BADGE[sectionKey] ?? 'bg-slate-100 text-slate-600')}>
            {SECTION_LABELS[sectionKey] ?? sectionKey}
          </span>
        )}
      </div>

      {/* Placeholder — no class */}
      {!classId && (
        <div className="rounded-xl border-2 border-dashed border-slate-200 py-20 text-center">
          <Users size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500 font-medium">Select a class to manage subject enrollment</p>
          <p className="text-xs text-slate-400 mt-1">Then pick a subject to see and manage enrolled students</p>
        </div>
      )}

      {/* Class selected but no subject */}
      {classId && !subjectId && !currLoading && (
        <div className="rounded-xl border-2 border-dashed border-slate-200 py-20 text-center">
          <BookOpen size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500 font-medium">
            {curriculumSubjects.length === 0
              ? 'No subjects in this class curriculum yet. Set up the curriculum first.'
              : 'Select a subject from the dropdown above'}
          </p>
        </div>
      )}

      {/* Main enrollment panel */}
      {classId && subjectId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Left: Enroll actions ────────────────────────── */}
          <div className="space-y-4">
            {/* Subject header */}
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex items-center gap-3">
              <div className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: selectedSubject?.subject?.color ?? '#6366F1' }}>
                <BookOpen size={15} className="text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 truncate">{selectedSubject?.subject?.name ?? subjectId}</p>
                <p className="text-xs text-slate-500">{selectedClass?.name} · {enrollments.length} enrolled</p>
              </div>
              {/* Bulk enroll button */}
              <button onClick={handleBulkEnroll} disabled={bulking}
                className="ml-auto shrink-0 flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700 disabled:opacity-50 transition font-medium">
                {bulking ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                {bulking ? 'Enrolling…' : 'Enroll class'}
              </button>
            </div>

            {/* Search & add individual */}
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Add Individual Student</p>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name or admission number…"
                  className="w-full rounded-lg border border-slate-300 pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
                {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"><X size={13} /></button>}
              </div>
              {searchQ.length > 0 && searchQ.length < 2 && <p className="text-[11px] text-slate-400 mt-1.5">Type at least 2 characters</p>}
              {searchQ.length >= 2 && (
                <div className="mt-2 space-y-1">
                  {searchResults.length === 0
                    ? <p className="text-xs text-slate-400 py-2 text-center">No matching students in {selectedClass?.name} (or all enrolled)</p>
                    : searchResults.map(s => (
                        <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{s.firstName} {s.lastName}</p>
                            {s.admissionNumber && <p className="text-[11px] text-slate-400">{s.admissionNumber}</p>}
                          </div>
                          <button onClick={() => handleEnroll(s.id)} disabled={enrolling === s.id}
                            className="shrink-0 flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs text-white hover:bg-violet-700 disabled:opacity-50 transition">
                            {enrolling === s.id ? <Loader2 size={11} className="animate-spin" /> : <><Plus size={11} />Enroll</>}
                          </button>
                        </div>
                      ))
                  }
                </div>
              )}
            </div>
          </div>

          {/* ── Right: Enrolled students list ──────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-900">Enrolled Students</h2>
              <span className="text-xs text-slate-500">{enrollments.length} of {classStudents.length} in class</span>
            </div>

            {enrollLoading ? (
              <div className="py-12 text-center text-slate-400 flex items-center justify-center gap-2 text-sm"><Loader2 size={16} className="animate-spin" />Loading…</div>
            ) : enrollments.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
                <Users size={24} className="mx-auto text-slate-300 mb-2" />
                <p className="text-sm text-slate-400">No students enrolled in this subject yet</p>
                <p className="text-xs text-slate-400 mt-1">Use "Enroll class" for bulk enrollment or search above</p>
              </div>
            ) : (
              <div className="space-y-1">
                {enrollments.map(e => (
                  <div key={e.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5 hover:bg-slate-50 transition">
                    <div className="h-7 w-7 shrink-0 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 text-xs font-semibold">
                      {(e.student?.firstName?.[0] ?? '?').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {e.student ? `${e.student.firstName} ${e.student.lastName}` : e.studentId}
                      </p>
                      {e.student?.admissionNumber && <p className="text-[11px] text-slate-400">{e.student.admissionNumber}</p>}
                    </div>
                    <button onClick={() => handleUnenroll(e.id)} disabled={unenrolling === e.id}
                      className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 transition" title="Unenroll">
                      {unenrolling === e.id ? <Loader2 size={13} className="animate-spin" /> : <UserMinus size={13} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
