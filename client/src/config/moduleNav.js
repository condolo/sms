/* ============================================================
   Module nav derivation — turns the server's MODULE_REGISTRY
   (server/config/moduleRegistry.js, embedded in the session at
   login) into the shape Sidebar.jsx and SettingsPage.jsx need:
     { key, to, Icon, label, section }

   Registry entries are plain data (icon is a string name — the
   registry file is server-side Node/CommonJS with no JSX). This
   file is the one place that resolves those strings to real
   lucide-react component references, so both consumers render
   identical icons without either hand-maintaining its own list.

   Only entries with a `navRoute` get a nav item — analytics, settings,
   and the exams/assessment pair (which share the 'grades' entry's single
   nav item) are deliberately excluded, matching the product behaviour
   this replaces.
   ============================================================ */
import {
  GraduationCap, Users, BookOpen, Calendar, CheckSquare, FileText,
  FileBarChart2, Library, ClipboardList, Scale, Wallet, MessageSquare,
  UserCog, BookCheck, MonitorPlay, BookMarked, Link2, Bus, BedDouble,
  HeartPulse, Boxes, TrendingUp, Sprout, HelpCircle,
} from 'lucide-react';

export const NAV_ICON_MAP = {
  GraduationCap, Users, BookOpen, Calendar, CheckSquare, FileText,
  FileBarChart2, Library, ClipboardList, Scale, Wallet, MessageSquare,
  UserCog, BookCheck, MonitorPlay, BookMarked, Link2, Bus, BedDouble,
  HeartPulse, Boxes, TrendingUp, Sprout,
};

/* Migration-safety net only — snapshot of the module list for sessions
 * whose session.moduleRegistry is absent (a session persisted to
 * localStorage before the registry-unification change deployed — the app
 * never re-fetches it in the background; see auth.js's /me route, which
 * is unused by the client). Every session created after deploy (login,
 * verify-otp, force-change, exchange, school-switch) carries
 * moduleRegistry and uses deriveNavModules() below instead.
 *
 * IMPORTANT: `section` here must be kept in sync with
 * moduleRegistry.js's current section values, not frozen at whatever
 * they were when this array was written — a mismatch means Sidebar.jsx's
 * SECTION_ORDER won't recognize the section and silently drops those
 * modules for any fallback session (this happened for real: the 2026-08
 * taxonomy reorg updated SECTION_ORDER but not this file, and every
 * fallback-path session lost Academic Management/Student Services/
 * Communication/Analytics entirely until it was caught and fixed).
 *
 * Safe to delete once no pre-deploy session can still be active (longest
 * session lifetime — check SessionService's absoluteExpiry default).
 */
export const FALLBACK_NAV_MODULES = [
  { key: 'students',   to: '/students',   Icon: GraduationCap, label: 'Students',            section: 'Academic Management' },
  { key: 'teachers',   to: '/teachers',   Icon: Users,          label: 'Teachers',            section: 'Academic Management' },
  { key: 'classes',    to: '/classes',    Icon: BookOpen,        label: 'Classes',             section: 'Academic Management' },
  { key: 'timetable',  to: '/timetable',  Icon: Calendar,       label: 'Timetable',           section: 'Academic Management' },
  { key: 'attendance', to: '/attendance', Icon: CheckSquare,     label: 'Attendance',          section: 'Academic Management' },
  { key: 'grades',     to: '/exams',      Icon: FileText,        label: 'Exams',               section: 'Academic Management' },
  { key: 'report_cards', to: '/report-cards', Icon: FileBarChart2, label: 'Report Cards',       section: 'Academic Management' },
  { key: 'subjects',   to: '/subjects',   Icon: Library,         label: 'Subjects',            section: 'Academic Management' },
  { key: 'admissions', to: '/admissions', Icon: ClipboardList,  label: 'Admissions',          section: 'Student Services' },
  { key: 'behaviour',  to: '/behaviour',  Icon: Scale,          label: 'Behaviour',           section: 'Student Services' },
  { key: 'growth_profile', to: '/growth-profile', Icon: Sprout, label: 'Growth Profile',      section: 'Student Services' },
  { key: 'finance',    to: '/finance',    Icon: Wallet,         label: 'Finance',             section: 'Operations' },
  { key: 'messages',   to: '/messages',   Icon: MessageSquare,  label: 'Messages',            section: 'Communication' },
  { key: 'events',     to: '/events',     Icon: Calendar,       label: 'Events',              section: 'Communication' },
  { key: 'hr',         to: '/hr',         Icon: UserCog,        label: 'HR & Staff',          section: 'Operations' },
  { key: 'lessons',    to: '/lessons',    Icon: BookCheck,      label: 'Lessons',             section: 'Academic Management' },
  { key: 'elearning',  to: '/elearning',  Icon: MonitorPlay,    label: 'eLearning',           section: 'Academic Management' },
  { key: 'library',    to: '/library',    Icon: BookMarked,     label: 'Library',             section: 'Operations' },
  { key: 'resources',  to: '/resources',  Icon: Link2,          label: 'Resources',           section: 'Communication' },
  { key: 'transport',  to: '/transport',  Icon: Bus,            label: 'Transport',           section: 'Operations' },
  { key: 'hostel',     to: '/hostel',     Icon: BedDouble,      label: 'Hostel',              section: 'Student Services' },
  { key: 'medical',    to: '/medical',    Icon: HeartPulse,     label: 'Medical Centre',      section: 'Student Services' },
  { key: 'inventory',  to: '/inventory',  Icon: Boxes,          label: 'Inventory',           section: 'Operations' },
  { key: 'reports',    to: '/reports',    Icon: TrendingUp,     label: 'Reports & Analytics', section: 'Analytics' },
];

/** moduleRegistry -> [{ key, to, Icon, label, section }], in navOrder,
 *  falling back to FALLBACK_NAV_MODULES when the registry isn't available
 *  (pre-deploy session) or produces no nav-bearing entries at all. */
export function deriveNavModules(moduleRegistry) {
  if (!Array.isArray(moduleRegistry) || moduleRegistry.length === 0) {
    return FALLBACK_NAV_MODULES;
  }
  const derived = moduleRegistry
    .filter(m => m.navRoute)
    .map(m => ({
      key:     m.key,
      to:      m.navRoute,
      Icon:    NAV_ICON_MAP[m.icon] ?? HelpCircle,
      label:   m.navLabel ?? m.label,
      section: m.section,
      _order:  m.navOrder ?? 999,
    }))
    .sort((a, b) => a._order - b._order)
    .map(({ _order, ...rest }) => rest);
  return derived.length ? derived : FALLBACK_NAV_MODULES;
}
