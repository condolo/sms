/* ============================================================
   RoleGuide — role-contextual help panel
   Shows at the bottom of portal pages.  Collapsed by default;
   one click expands it to explain exactly what the current
   user can see and do based on their assigned role(s).
   ============================================================ */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HelpCircle, ChevronDown,
  CalendarDays, Printer, BookOpen,
  Clock, User, Users, Shield, Settings2,
} from 'lucide-react';
import useAuthStore from '@/store/auth.js';

/* ── Role definitions ─────────────────────────────────────── */
const GUIDES = {
  teacher: {
    bg: 'bg-blue-50', border: 'border-blue-200',
    iconColor: 'text-blue-600',
    badgeBg: 'bg-blue-100', badgeText: 'text-blue-700',
    label: 'Teacher',
    headline: 'You can view and print your personal teaching timetable.',
    items: [
      { Icon: CalendarDays, text: 'Your full weekly schedule across all days — subjects, class, room, and period times' },
      { Icon: Clock,        text: 'Exact start and end times for every period, pulled from the school bell schedule' },
      { Icon: Users,        text: 'The class each lesson is assigned to (shown on every slot card)' },
      { Icon: Printer,      text: 'Print your timetable or save it as a PDF — just click Print / Save as PDF' },
    ],
  },

  parent: {
    bg: 'bg-violet-50', border: 'border-violet-200',
    iconColor: 'text-violet-600',
    badgeBg: 'bg-violet-100', badgeText: 'text-violet-700',
    label: 'Parent / Guardian',
    headline: 'You can view and print the timetable for each of your children.',
    items: [
      { Icon: Users,       text: 'Switch between your children using the name tabs at the top of the page' },
      { Icon: BookOpen,    text: "Each child's full weekly schedule — subject, teacher name, room, and period times" },
      { Icon: Printer,     text: "Print any child's timetable individually as a PDF straight from the browser" },
      { Icon: HelpCircle,  text: "If a child is missing, ask the school admin to link them to your account" },
    ],
  },

  section_head: {
    bg: 'bg-emerald-50', border: 'border-emerald-200',
    iconColor: 'text-emerald-600',
    badgeBg: 'bg-emerald-100', badgeText: 'text-emerald-700',
    label: 'Section Head',
    headline: 'You can monitor all teaching activity across every class in your section.',
    items: [
      { Icon: CalendarDays, text: 'Full timetable overview for your entire section — every class, every period' },
      { Icon: BookOpen,     text: 'Filter by class using the buttons at the top to focus on one class at a time' },
      { Icon: User,         text: 'See which teacher is assigned to each slot, and which room they are in' },
      { Icon: Printer,      text: 'Print the full section overview, or filter to one class first and then print' },
    ],
  },

  admin: {
    bg: 'bg-slate-50', border: 'border-slate-200',
    iconColor: 'text-slate-600',
    badgeBg: 'bg-slate-100', badgeText: 'text-slate-700',
    label: 'Administrator',
    headline: 'You have full control over the school timetable.',
    items: [
      { Icon: Settings2,    text: 'Build and manage timetable slots for any class — drag rows, edit inline' },
      { Icon: Clock,        text: 'Configure bell schedules per section (KG, Primary, Secondary, A-Level)' },
      { Icon: Shield,       text: 'Run conflict detection to catch teacher and room clashes before publishing' },
      { Icon: CalendarDays, text: 'Publish the timetable to make it visible to all staff and parents, or unpublish to edit privately' },
    ],
  },
};

GUIDES.guardian   = GUIDES.parent;
GUIDES.deputy     = { ...GUIDES.admin, label: 'Deputy Head' };
GUIDES.timetabler = { ...GUIDES.admin, label: 'Timetabler',  headline: 'You can build, manage, and publish the school timetable.' };
GUIDES.superadmin = { ...GUIDES.admin, label: 'Super Admin'  };
GUIDES.student    = {
  bg: 'bg-amber-50', border: 'border-amber-200',
  iconColor: 'text-amber-600',
  badgeBg: 'bg-amber-100', badgeText: 'text-amber-700',
  label: 'Student',
  headline: 'Your class timetable is managed by the school.',
  items: [
    { Icon: CalendarDays, text: 'Your parent or guardian can view your weekly schedule from their account' },
    { Icon: Printer,      text: 'Ask your school office for a printed copy of your timetable' },
    { Icon: BookOpen,     text: 'Your subjects, teachers, and rooms are set by the school administration' },
    { Icon: HelpCircle,   text: 'Contact the school admin if any details appear incorrect' },
  ],
};

/* ── Priority order when a user has multiple roles ───────── */
const PRIORITY = ['parent', 'guardian', 'section_head', 'teacher', 'timetabler', 'deputy', 'admin', 'superadmin', 'student'];

function pickGuide(role, roles = []) {
  const all = [role, ...roles].filter(Boolean);
  for (const r of PRIORITY) {
    if (all.includes(r) && GUIDES[r]) return GUIDES[r];
  }
  return GUIDES.teacher; // fallback
}

/* ── Component ────────────────────────────────────────────── */
export default function RoleGuide({ className = '' }) {
  const [open, setOpen] = useState(false);

  const role  = useAuthStore(s => s.session?.user?.role  ?? '');
  const roles = useAuthStore(s => s.session?.user?.roles ?? []);

  const guide = pickGuide(role, roles);
  const { bg, border, iconColor, badgeBg, badgeText, label, headline, items } = guide;

  return (
    <div className={`print:hidden rounded-xl border ${border} overflow-hidden ${className}`}>
      {/* Toggle strip */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition ${bg} hover:brightness-95`}
      >
        <div className="flex items-center gap-2">
          <HelpCircle size={14} className={iconColor} />
          <span className="text-xs font-medium text-slate-700">What can I see?</span>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeBg} ${badgeText}`}>
            {label}
          </span>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={14} className="text-slate-400" />
        </motion.div>
      </button>

      {/* Expanded content */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="guide-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className={`px-5 py-4 border-t ${border} ${bg}`}>
              {/* Headline */}
              <p className="text-sm font-medium text-slate-800 mb-3">{headline}</p>

              {/* Capability list */}
              <ul className="space-y-2">
                {items.map(({ Icon, text }, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <Icon size={13} className={`mt-0.5 shrink-0 ${iconColor}`} />
                    <span className="text-xs text-slate-600 leading-relaxed">{text}</span>
                  </li>
                ))}
              </ul>

              {/* Footer note */}
              <p className="mt-3 text-[11px] text-slate-400 border-t border-slate-200/70 pt-2.5">
                Seeing something unexpected? Contact your school administrator to review your account role.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
