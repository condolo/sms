/* ============================================================
   Weekly Student Snapshot — student detail view
   Route: /weekly-snapshot/:studentId

   Section order: Topics → Assignments → Attendance → Behaviour →
   Medical → Library → Growth, matching the approved plan. Read-only —
   this page never writes anything, it only displays what the cron
   already generated (weekly-snapshot-cron.js) and the server already
   redacted (weekly-snapshots.js's medical-section logic).

   Prev/next/first/last navigates between STUDENTS in the same class
   roster (not between weeks) — the design the user asked for explicitly:
   a class teacher opens one student, then steps through the rest of the
   class without going back to the roster grid each time. Computed as
   plain array-index arithmetic over one classesApi.students() fetch, no
   dedicated server endpoint (see the approved plan's "Roster navigation"
   section) — the student's own classId (from the weeks response) is
   what that roster fetch is scoped to.

   The week itself is a separate, in-page picker — a student can have
   many weeks of snapshot history; only ONE is ever open at a time.
   ============================================================ */
import { useState, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  CalendarCheck, Download, Loader2, AlertTriangle,
  BookOpen, ClipboardList, CheckSquare, Scale, HeartPulse, BookMarked, Sprout,
} from 'lucide-react';
import { classes as classesApi, weeklySnapshots } from '@/api/client.js';

const GRADIENTS = [
  'from-violet-500 to-purple-600', 'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',  'from-amber-500 to-orange-500',
  'from-pink-500 to-rose-500',     'from-indigo-500 to-blue-500',
];
function avatarGradient(name = '') {
  return GRADIENTS[(name.charCodeAt(0) || 0) % GRADIENTS.length];
}
function initials(first = '', last = '') {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase() || '?';
}

function SectionCard({ Icon, color, title, isEmpty, emptyLabel, children }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon size={16} className={color} />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      {isEmpty ? (
        <p className="text-sm text-slate-400">{emptyLabel}</p>
      ) : children}
    </div>
  );
}

export default function WeeklySnapshotDetail() {
  const { studentId } = useParams();
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState(null); // null = most recent
  const [downloading, setDownloading] = useState(false);

  const { data: weeksRes, isLoading: weeksLoading, isError: weeksError } = useQuery({
    queryKey: ['weekly-snapshots', studentId, 'weeks'],
    queryFn:  () => weeklySnapshots.weeks(studentId),
  });
  const student = weeksRes?.data?.student ?? null;
  const weeks   = weeksRes?.data?.weeks ?? [];
  const activeWeekStart = weekStart ?? weeks[0]?.weekStart ?? null;

  const { data: detailRes, isLoading: detailLoading, isError: detailError } = useQuery({
    queryKey: ['weekly-snapshots', studentId, activeWeekStart],
    queryFn:  () => weeklySnapshots.detail(studentId, activeWeekStart),
    enabled:  !!activeWeekStart,
  });
  const snapshot = detailRes?.data?.snapshot ?? null;
  const sections = snapshot?.sections ?? null;

  // Roster navigation — one fetch of the student's own class, sorted the
  // same way classes.js's /:id/students always sorts (lastName, firstName).
  const { data: rosterRes } = useQuery({
    queryKey: ['classes', student?.classId, 'students', 'for-weekly-snapshot-nav'],
    queryFn:  () => classesApi.students(student.classId, { limit: 200, status: 'active' }),
    enabled:  !!student?.classId,
    staleTime: 60_000,
  });
  const roster = rosterRes?.data ?? [];
  const currentIndex = useMemo(
    () => roster.findIndex(s => (s.id ?? s._id) === studentId),
    [roster, studentId],
  );
  const goTo = (idx) => {
    const target = roster[idx];
    if (target) navigate(`/weekly-snapshot/${target.id ?? target._id}`);
  };

  const handleDownload = async () => {
    if (!activeWeekStart) return;
    setDownloading(true);
    try { await weeklySnapshots.pdf(studentId, activeWeekStart); }
    finally { setDownloading(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-screen-lg mx-auto flex items-center gap-3">
          <Link to="/weekly-snapshot" className="p-1.5 -ml-1.5 rounded-lg hover:bg-slate-100 text-slate-500 shrink-0">
            <ChevronLeft size={18} />
          </Link>

          {student ? (
            <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${avatarGradient(student.firstName)} flex items-center justify-center text-white text-xs font-semibold shrink-0`}>
              {initials(student.firstName, student.lastName)}
            </div>
          ) : (
            <div className="w-9 h-9 rounded-full bg-slate-100 animate-pulse shrink-0" />
          )}

          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-slate-900 truncate">
              {student ? `${student.firstName} ${student.lastName}` : 'Loading…'}
            </h1>
            <p className="text-xs text-slate-500 truncate">{student?.className ?? ''} · Weekly Snapshot</p>
          </div>

          {roster.length > 0 && currentIndex >= 0 && (
            <div className="flex items-center gap-0.5 shrink-0">
              <button title="First student" disabled={currentIndex <= 0}
                onClick={() => goTo(0)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-30 disabled:pointer-events-none">
                <ChevronsLeft size={16} />
              </button>
              <button title="Previous student" disabled={currentIndex <= 0}
                onClick={() => goTo(currentIndex - 1)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-30 disabled:pointer-events-none">
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs text-slate-400 px-1 font-mono tabular-nums">
                {currentIndex + 1}/{roster.length}
              </span>
              <button title="Next student" disabled={currentIndex >= roster.length - 1}
                onClick={() => goTo(currentIndex + 1)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-30 disabled:pointer-events-none">
                <ChevronRight size={16} />
              </button>
              <button title="Last student" disabled={currentIndex >= roster.length - 1}
                onClick={() => goTo(roster.length - 1)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-30 disabled:pointer-events-none">
                <ChevronsRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-screen-lg mx-auto px-6 py-5 space-y-4">
        {weeksLoading ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 size={22} className="animate-spin" />
          </div>
        ) : weeksError ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-2">
            <AlertTriangle size={22} />
            <p className="text-sm">Couldn't load this student's snapshot history.</p>
          </div>
        ) : weeks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-2 bg-white rounded-xl border border-slate-200">
            <CalendarCheck size={26} className="opacity-40" />
            <p className="text-sm">No snapshot has been generated for this student yet.</p>
            <p className="text-xs text-slate-300">Snapshots are generated automatically every Saturday.</p>
          </div>
        ) : (
          <>
            {/* Week picker + PDF download */}
            <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3">
              <CalendarCheck size={15} className="text-sky-600 shrink-0" />
              <select
                value={activeWeekStart ?? ''}
                onChange={e => setWeekStart(e.target.value)}
                className="text-sm flex-1 max-w-xs border-0 focus:outline-none text-slate-800 bg-transparent"
              >
                {weeks.map(w => (
                  <option key={w.weekStart} value={w.weekStart}>
                    Week of {w.weekStart} – {w.weekEnd}
                  </option>
                ))}
              </select>
              <button
                onClick={handleDownload}
                disabled={downloading || !activeWeekStart}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 shrink-0"
              >
                {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                Download PDF
              </button>
            </div>

            {detailLoading ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {[...Array(6)].map((_, i) => <div key={i} className="h-28 bg-white rounded-xl border border-slate-200 animate-pulse" />)}
              </div>
            ) : detailError || !sections ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-2">
                <AlertTriangle size={22} />
                <p className="text-sm">Couldn't load this week's snapshot.</p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <SectionCard Icon={BookOpen} color="text-emerald-600" title="Topics Covered"
                  isEmpty={sections.topics.length === 0} emptyLabel="No topics recorded this week.">
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {sections.topics.map((t, i) => (
                      <li key={i}>
                        <span className="font-medium">{t.subjectName}:</span> {t.topicTitle}
                        {t.subtopicTitle ? ` — ${t.subtopicTitle}` : ''}
                        <span className="text-xs text-slate-400 ml-1">({t.teacherName})</span>
                      </li>
                    ))}
                  </ul>
                </SectionCard>

                <SectionCard Icon={ClipboardList} color="text-blue-600" title="Assignments & Scores"
                  isEmpty={sections.assignments.length === 0} emptyLabel="No assessments recorded this week.">
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {sections.assignments.map((a, i) => (
                      <li key={i} className="flex justify-between">
                        <span>{a.assessmentType} #{a.instance}{a.label ? ` — ${a.label}` : ''}</span>
                        <span className="font-semibold tabular-nums">{a.rawScore}/100</span>
                      </li>
                    ))}
                  </ul>
                </SectionCard>

                <SectionCard Icon={CheckSquare} color="text-teal-600" title="Attendance" isEmpty={false}>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      ['Present', sections.attendance.present, 'text-emerald-600'],
                      ['Absent',  sections.attendance.absent,  'text-rose-600'],
                      ['Late',    sections.attendance.late,    'text-amber-600'],
                    ].map(([label, val, color]) => (
                      <div key={label} className="bg-slate-50 rounded-lg py-2">
                        <p className={`text-lg font-bold tabular-nums ${color}`}>{val}</p>
                        <p className="text-[11px] text-slate-500">{label}</p>
                      </div>
                    ))}
                  </div>
                </SectionCard>

                <SectionCard Icon={Scale} color="text-violet-600" title="Behaviour"
                  isEmpty={sections.behaviour.length === 0} emptyLabel="No behaviour records this week.">
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {sections.behaviour.map((b, i) => (
                      <li key={i} className="flex justify-between">
                        <span>{b.itemLabel} <span className="text-xs text-slate-400">({b.category})</span></span>
                        <span className={`font-semibold tabular-nums ${b.points > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {b.points > 0 ? '+' : ''}{b.points}
                        </span>
                      </li>
                    ))}
                  </ul>
                </SectionCard>

                {sections.medical && (
                  <SectionCard Icon={HeartPulse} color="text-rose-600" title="Medical"
                    isEmpty={sections.medical.length === 0} emptyLabel="No clinic visits this week.">
                    <ul className="space-y-1.5 text-sm text-slate-700">
                      {sections.medical.map((m, i) => (
                        <li key={i}>
                          <span className="text-xs text-slate-400">{m.date}</span> — {m.complaint}
                          {m.sentHome && <span className="text-xs text-amber-600 ml-1">(sent home)</span>}
                        </li>
                      ))}
                    </ul>
                  </SectionCard>
                )}

                <SectionCard Icon={BookMarked} color="text-indigo-600" title="Library"
                  isEmpty={sections.library.length === 0} emptyLabel="No library activity this week.">
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {sections.library.map((l, i) => (
                      <li key={i} className="flex justify-between">
                        <span className="truncate">"{l.bookTitle}"</span>
                        <span className="text-xs text-slate-400 shrink-0 ml-2">{l.status}</span>
                      </li>
                    ))}
                  </ul>
                </SectionCard>

                <SectionCard Icon={Sprout} color="text-amber-600" title="Growth & Achievements"
                  isEmpty={sections.growth.length === 0} emptyLabel="No new growth records this week.">
                  <ul className="space-y-1.5 text-sm text-slate-700">
                    {sections.growth.map((g, i) => (
                      <li key={i}>{g.title}{g.category ? ` (${g.category})` : ''}</li>
                    ))}
                  </ul>
                </SectionCard>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
