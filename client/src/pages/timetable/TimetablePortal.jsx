/* ============================================================
   Msingi — Timetable Portal
   Read-only timetable views for teachers, parents, section heads.

   Teacher      → their weekly teaching schedule
   Parent/Guard → per-child class timetable with child switcher
   Section head → all slots in their section (overview + class grids)

   Print: the entire portal is print-safe. Clicking "Print / PDF"
   hides the shell nav and triggers window.print().
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarDays, Printer, AlertTriangle, Loader2,
  ChevronRight, User, Users, BookOpen, Clock, Lock,
} from 'lucide-react';
import { timetable as ttApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import RoleGuide from '@/components/RoleGuide.jsx';

/* ── Days ────────────────────────────────────────────────────── */
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
const DAY_SHORT = { monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri' };
const DAY_FULL  = { monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday' };

/* ── Colour palette (deterministic by subject) ───────────────── */
const PALETTE = [
  { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', sub: 'text-violet-500' },
  { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   sub: 'text-blue-500'   },
  { bg: 'bg-emerald-50',border: 'border-emerald-200',text: 'text-emerald-700',sub: 'text-emerald-500' },
  { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  sub: 'text-amber-500'  },
  { bg: 'bg-rose-50',   border: 'border-rose-200',   text: 'text-rose-700',   sub: 'text-rose-500'   },
  { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', sub: 'text-indigo-500' },
  { bg: 'bg-teal-50',   border: 'border-teal-200',   text: 'text-teal-700',   sub: 'text-teal-500'   },
  { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', sub: 'text-orange-500' },
];
function slotColor(subject = '') {
  return PALETTE[(subject.charCodeAt(0) || 0) % PALETTE.length];
}

/* ── Build period-ordered time rows from slots ───────────────── */
function buildRows(slots) {
  // Collect unique (period, startTime, endTime) combos
  const rowMap = {};
  slots.forEach(s => {
    const key = `${s.period}|${s.startTime ?? ''}`;
    if (!rowMap[key]) {
      rowMap[key] = {
        period:    s.period,
        startTime: s.startTime ?? '',
        endTime:   s.endTime   ?? '',
      };
    }
  });
  return Object.values(rowMap).sort((a, b) => {
    if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
    return String(a.period).localeCompare(String(b.period));
  });
}

/* ── Build slot lookup map { day → { period → slot } } ──────── */
function buildSlotMap(slots) {
  const m = {};
  slots.forEach(s => {
    const d = (s.day || '').toLowerCase();
    const p = String(s.period);
    if (!m[d]) m[d] = {};
    m[d][p] = s;
  });
  return m;
}

/* ── Shared read-only timetable grid ─────────────────────────── */
function ReadGrid({ slots, days = DAYS }) {
  const rows    = buildRows(slots);
  const slotMap = buildSlotMap(slots);

  if (!slots.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2 text-center">
        <CalendarDays size={28} className="text-slate-200" />
        <p className="text-sm text-slate-400">No lessons scheduled yet.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden print:shadow-none print:border-slate-300">
      {/* Day header */}
      <div className="flex bg-slate-50 border-b border-slate-200 print:bg-slate-100">
        <div className="shrink-0 border-r border-slate-200" style={{ width: '90px', minWidth: '90px' }} />
        {days.map((day, i) => (
          <div
            key={day}
            className={`flex-1 py-2.5 text-center text-xs font-semibold text-slate-700 ${i < days.length - 1 ? 'border-r border-slate-200' : ''}`}
          >
            <span className="hidden sm:inline">{DAY_FULL[day]}</span>
            <span className="sm:hidden">{DAY_SHORT[day]}</span>
          </div>
        ))}
      </div>

      {/* Rows */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: '520px' }}>
          {rows.map(row => {
            const hasAny = days.some(d => slotMap[d]?.[row.period]);
            if (!hasAny) return null;
            return (
              <div key={`${row.period}-${row.startTime}`} className="flex border-b border-slate-100 last:border-b-0" style={{ minHeight: '68px' }}>
                {/* Period label */}
                <div className="flex flex-col justify-center px-2 border-r border-slate-100 shrink-0 bg-slate-50/40" style={{ width: '90px', minWidth: '90px' }}>
                  <span className="text-[10px] font-bold text-slate-500">P{row.period}</span>
                  {row.startTime && <span className="text-[9px] text-slate-400">{row.startTime}</span>}
                  {row.endTime   && <span className="text-[9px] text-slate-400">–{row.endTime}</span>}
                </div>

                {/* Day cells */}
                {days.map((day, i) => {
                  const slot = slotMap[day]?.[row.period];
                  const col  = slot ? slotColor(slot.subject ?? '') : null;
                  const isLast = i === days.length - 1;
                  return (
                    <div key={day} className={`flex-1 p-1.5 ${isLast ? '' : 'border-r border-slate-100'}`} style={{ minWidth: 0 }}>
                      {slot ? (
                        <div className={`h-full rounded-lg border px-2 py-1.5 ${col.bg} ${col.border}`}>
                          <p className={`text-[11px] font-semibold leading-tight truncate ${col.text}`}>
                            {slot.subject || '—'}
                          </p>
                          {slot.teacherName && (
                            <p className={`text-[10px] mt-0.5 truncate ${col.sub} opacity-80`}>{slot.teacherName}</p>
                          )}
                          {slot.room && (
                            <p className={`text-[10px] truncate ${col.sub} opacity-60`}>{slot.room}</p>
                          )}
                          {slot.className && (
                            <p className={`text-[10px] truncate ${col.sub} opacity-60`}>{slot.className}</p>
                          )}
                        </div>
                      ) : (
                        <div className="h-full min-h-[52px]" />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Print button ─────────────────────────────────────────────── */
function PrintButton({ label = 'Print / Save as PDF' }) {
  return (
    <button
      onClick={() => window.print()}
      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition print:hidden"
    >
      <Printer size={12} /> {label}
    </button>
  );
}

/* ── "Not published" notice ───────────────────────────────────── */
function NotPublished() {
  return (
    <div className="bg-white border border-amber-200 rounded-xl p-10 flex flex-col items-center gap-3">
      <Lock size={28} className="text-amber-300" />
      <p className="text-sm font-medium text-slate-700">Timetable not yet published</p>
      <p className="text-xs text-slate-400 text-center max-w-xs">
        The timetable is still being finalised. It will appear here once your school publishes it.
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TEACHER VIEW
   ══════════════════════════════════════════════════════════════ */
function TeacherPortalView() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['timetable', 'my'],
    queryFn:  () => ttApi.my(),
    staleTime: 5 * 60_000,
  });

  const payload     = data?.data ?? {};
  const slots       = payload.slots ?? [];
  const teacher     = payload.teacher;
  const message     = payload.message;
  const notPublished = message?.includes('not been published');

  // Summary stats
  const totalLessons = slots.filter(s => !s.type || s.type === 'lesson').length;
  const byDay = DAYS.map(d => ({ day: d, count: slots.filter(s => (s.day || '').toLowerCase() === d).length }));

  if (isPending) return (
    <div className="bg-white border border-slate-200 rounded-xl p-10 animate-pulse">
      <div className="h-4 bg-slate-100 rounded w-40 mb-3" />
      {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded mb-2" />)}
    </div>
  );

  if (isError || notPublished) return <NotPublished />;

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-slate-900 flex items-center justify-center">
            <User size={15} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              {teacher ? `${teacher.firstName} ${teacher.lastName}` : 'My Timetable'}
            </p>
            <p className="text-xs text-slate-400">{totalLessons} lesson{totalLessons !== 1 ? 's' : ''} per week</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Day summary chips */}
          <div className="flex items-center gap-1">
            {byDay.filter(d => d.count > 0).map(d => (
              <span key={d.day} className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                {DAY_SHORT[d.day]} {d.count}
              </span>
            ))}
          </div>
          <PrintButton />
        </div>
      </div>

      {/* No teacher record notice */}
      {!teacher && message && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-700">
          <AlertTriangle size={13} className="shrink-0" />
          {message}
        </div>
      )}

      {/* Grid */}
      <div id="print-timetable">
        <ReadGrid slots={slots} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   PARENT / GUARDIAN VIEW — child switcher
   ══════════════════════════════════════════════════════════════ */
function ParentPortalView() {
  const [activeChildIdx, setActiveChildIdx] = useState(0);

  const { data, isPending, isError } = useQuery({
    queryKey: ['timetable', 'my-children'],
    queryFn:  () => ttApi.myChildren(),
    staleTime: 5 * 60_000,
  });

  const payload     = data?.data ?? {};
  const children    = payload.children ?? [];
  const notPublished = payload.notPublished;
  const termLabel   = payload.termLabel ?? '';

  if (isPending) return (
    <div className="bg-white border border-slate-200 rounded-xl p-10 animate-pulse">
      <div className="flex gap-2 mb-5">
        {[1, 2].map(i => <div key={i} className="h-8 bg-slate-100 rounded-lg w-24" />)}
      </div>
      {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded mb-2" />)}
    </div>
  );

  if (isError || notPublished) return <NotPublished />;

  if (!children.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
        <Users size={28} className="text-slate-200" />
        <p className="text-sm text-slate-400">No children are linked to this account yet.</p>
        <p className="text-xs text-slate-300">Ask the school administrator to link your children.</p>
      </div>
    );
  }

  const active = children[Math.min(activeChildIdx, children.length - 1)];

  return (
    <div className="space-y-4">
      {/* Child tabs */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {children.map((c, i) => (
            <button
              key={c.student.id}
              onClick={() => setActiveChildIdx(i)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                activeChildIdx === i
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <User size={11} />
              {c.student.firstName} {c.student.lastName}
              {c.student.className && (
                <span className={`text-[10px] ${activeChildIdx === i ? 'text-slate-300' : 'text-slate-400'}`}>
                  · {c.student.className}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {termLabel && (
            <span className="text-[11px] text-slate-400 hidden sm:inline">{termLabel}</span>
          )}
          <PrintButton label={`Print ${active?.student.firstName}'s Timetable`} />
        </div>
      </div>

      {/* Active child grid */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeChildIdx}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          id="print-timetable"
        >
          <div className="mb-2 flex items-center gap-1.5">
            <ChevronRight size={12} className="text-slate-400" />
            <span className="text-xs font-medium text-slate-600">
              {active?.student.firstName} {active?.student.lastName}
              {active?.student.className && <> · <span className="text-slate-400">{active.student.className}</span></>}
            </span>
            <span className="text-[11px] text-slate-400 ml-2">
              {(active?.slots ?? []).filter(s => !s.type || s.type === 'lesson').length} lessons/week
            </span>
          </div>
          <ReadGrid slots={active?.slots ?? []} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SECTION HEAD VIEW
   Shows all slots in their section, grouped by class per day.
   ══════════════════════════════════════════════════════════════ */
function SectionHeadView() {
  const [activeClass, setActiveClass] = useState(null);

  const { data, isPending, isError } = useQuery({
    queryKey: ['timetable', 'my'],
    queryFn:  () => ttApi.my(),
    staleTime: 5 * 60_000,
  });

  const payload     = data?.data ?? {};
  const slots       = payload.slots ?? [];
  const section     = payload.section;
  const notPublished = payload.message?.includes('not been published');

  // Gather distinct classes
  const classMap = {};
  slots.forEach(s => {
    if (s.classId && !classMap[s.classId]) {
      classMap[s.classId] = { classId: s.classId, className: s.className || s.classId };
    }
  });
  const classes = Object.values(classMap).sort((a, b) => a.className.localeCompare(b.className));

  const displaySlots = activeClass
    ? slots.filter(s => s.classId === activeClass)
    : slots;

  if (isPending) return (
    <div className="bg-white border border-slate-200 rounded-xl p-10 animate-pulse">
      {[...Array(6)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded mb-2" />)}
    </div>
  );

  if (isError || notPublished) return <NotPublished />;

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-3 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActiveClass(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              !activeClass ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Classes
          </button>
          {classes.map(c => (
            <button
              key={c.classId}
              onClick={() => setActiveClass(c.classId)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                activeClass === c.classId ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {c.className}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {section && section !== 'all' && (
            <span className="text-[11px] text-slate-400 capitalize hidden sm:inline">{section} section</span>
          )}
          <PrintButton />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Classes',  value: classes.length,        Icon: BookOpen },
          { label: 'Lessons',  value: slots.filter(s => !s.type || s.type === 'lesson').length, Icon: CalendarDays },
          { label: 'Teachers', value: new Set(slots.map(s => s.teacherId).filter(Boolean)).size, Icon: User },
          { label: 'Rooms',    value: new Set(slots.map(s => s.room).filter(Boolean)).size,      Icon: Clock },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center">
              <Icon size={13} className="text-slate-500" />
            </div>
            <div>
              <p className="text-lg font-bold text-slate-900 leading-tight">{value}</p>
              <p className="text-[11px] text-slate-400">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div id="print-timetable">
        <ReadGrid slots={displaySlots} />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN EXPORT — role dispatcher
   ══════════════════════════════════════════════════════════════ */
export default function TimetablePortal() {
  const role  = useAuthStore(s => s.session?.user?.role ?? '');
  const roles = useAuthStore(s => s.session?.user?.roles ?? []);
  const allRoles = [role, ...roles];

  const isParent      = allRoles.some(r => r === 'parent' || r === 'guardian');
  const isTeacher     = allRoles.includes('teacher');
  const isSectionHead = allRoles.includes('section_head');

  let title   = 'My Timetable';
  let subline = 'Your personal schedule';
  let Content = TeacherPortalView;

  if (isParent) {
    title   = 'Children\'s Timetables';
    subline = 'View and print each child\'s weekly schedule';
    Content = ParentPortalView;
  } else if (isSectionHead) {
    title   = 'Section Overview';
    subline = 'All classes and teaching activity in your section';
    Content = SectionHeadView;
  }

  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 print:hidden">
        <div className="max-w-screen-xl mx-auto flex items-center gap-3">
          <CalendarDays size={17} className="text-slate-400" />
          <div>
            <h1 className="text-base font-semibold text-slate-900 leading-tight">{title}</h1>
            <p className="text-xs text-slate-400 mt-0.5">{subline}</p>
          </div>
        </div>
      </div>

      {/* Print-only header */}
      <div className="hidden print:block px-6 py-4 border-b border-slate-200 mb-4">
        <h1 className="text-xl font-bold text-slate-900">{title}</h1>
        <p className="text-sm text-slate-500 mt-0.5">Printed {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      </div>

      {/* Content */}
      <div className="max-w-screen-xl mx-auto px-6 py-5 space-y-5">
        <Content />
        <RoleGuide />
      </div>
    </div>
  );
}
