/* ============================================================
   Sidebar — Collapsible Enterprise Navigation
   Expanded : 256 px (icons + labels)
   Collapsed: 64 px  (icons only, native tooltips on hover)

   Collapse / expand UX
   ────────────────────
   • Expanded  → X button in the school header collapses (desktop)
   • Collapsed → hamburger in the TopBar expands (desktop)
   • Mobile    → standard overlay drawer with ✕ in header

   Module visibility
   ─────────────────
   • Admin can toggle / reorder modules in Settings → Modules tab
   • Config saved as school.moduleConfig in MongoDB
   • Sidebar reads from auth session (reactive via patchSchool)
   • Default: all 17 configurable modules shown, original order
   ============================================================ */
import { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, GraduationCap, Users, BookOpen, Calendar,
  CheckSquare, BarChart3, ClipboardList, Scale, FileText,
  Wallet, Settings, LogOut, Library,
  MessageSquare, UserCog, TrendingUp, Tag, HelpCircle,
  BookMarked, Bus, BedDouble, X, BookCheck, MonitorPlay,
  ChevronDown, BookMarked as ClassroomIcon, Video,
} from 'lucide-react';
import clsx from 'clsx';
import useAuthStore from '@/store/auth.js';
import { auth as authApi } from '@/api/client.js';

/* ── All configurable modules (master list) ──────────────────── */
const CONFIGURABLE_MODULES = [
  { key: 'students',   to: '/students',   Icon: GraduationCap, label: 'Students',            section: 'Academic'   },
  { key: 'teachers',   to: '/teachers',   Icon: Users,          label: 'Teachers',            section: 'Academic'   },
  { key: 'classes',    to: '/classes',    Icon: BookOpen,        label: 'Classes',             section: 'Academic'   },
  { key: 'timetable',  to: '/timetable',  Icon: Calendar,       label: 'Timetable',           section: 'Academic'   },
  { key: 'attendance', to: '/attendance', Icon: CheckSquare,     label: 'Attendance',          section: 'Academic'   },
  { key: 'exams',      to: '/exams',      Icon: FileText,        label: 'Exams',               section: 'Academic'   },
  { key: 'grades',     to: '/grades',     Icon: BarChart3,       label: 'Assessment',          section: 'Academic'   },
  { key: 'subjects',   to: '/subjects',   Icon: Library,         label: 'Subjects',            section: 'Academic'   },
  { key: 'admissions', to: '/admissions', Icon: ClipboardList,  label: 'Admissions',          section: 'Operations' },
  { key: 'behaviour',  to: '/behaviour',  Icon: Scale,          label: 'Behaviour',           section: 'Operations' },
  { key: 'finance',    to: '/finance',    Icon: Wallet,         label: 'Finance',             section: 'Operations' },
  { key: 'messages',   to: '/messages',   Icon: MessageSquare,  label: 'Messages',            section: 'Operations' },
  { key: 'events',     to: '/events',     Icon: Calendar,       label: 'Events',              section: 'Operations' },
  { key: 'hr',         to: '/hr',         Icon: UserCog,        label: 'HR & Staff',          section: 'Operations' },
  { key: 'lessons',    to: '/lessons',    Icon: BookCheck,      label: 'Lessons',             section: 'Academic'   },
  { key: 'elearning',  to: '/elearning',  Icon: MonitorPlay,    label: 'eLearning',           section: 'Academic'   },
  { key: 'library',    to: '/library',    Icon: BookMarked,     label: 'Library',             section: 'Operations' },
  { key: 'transport',  to: '/transport',  Icon: Bus,            label: 'Transport',           section: 'Operations' },
  { key: 'hostel',     to: '/hostel',     Icon: BedDouble,      label: 'Hostel',              section: 'Operations' },
  { key: 'reports',    to: '/reports',    Icon: TrendingUp,     label: 'Reports & Analytics', section: 'Insights'   },
];

const SECTION_ORDER = ['Academic', 'Operations', 'Insights'];

/* Build nav sections from saved moduleConfig (or defaults if unset) */
function computeNav(moduleConfig) {
  const cfgMap = Object.fromEntries(
    (moduleConfig ?? []).map((m, i) => [m.key, { enabled: m.enabled ?? true, order: m.order ?? i }])
  );

  const visible = CONFIGURABLE_MODULES
    .filter(m => (cfgMap[m.key]?.enabled ?? true))
    .sort((a, b) => (cfgMap[a.key]?.order ?? 999) - (cfgMap[b.key]?.order ?? 999));

  const grouped = {};
  for (const m of visible) {
    if (!grouped[m.section]) grouped[m.section] = [];
    grouped[m.section].push(m);
  }

  return [
    { label: null, items: [{ key: 'dashboard', to: '/dashboard', Icon: LayoutDashboard, label: 'Dashboard' }] },
    ...SECTION_ORDER
      .filter(sec => grouped[sec]?.length)
      .map(sec => ({ label: sec, items: grouped[sec] })),
    {
      label: 'System',
      items: [
        { to: '/settings',  Icon: Settings,   label: 'Settings'    },
        { to: '/changelog', Icon: Tag,        label: 'Changelog'   },
        { to: '/help',      Icon: HelpCircle, label: 'Help Centre' },
      ],
    },
  ];
}

/* ── Label fade — opacity only (root overflow-hidden clips layout) */
function labelStyle(collapsed) {
  return {
    opacity:    collapsed ? 0 : 1,
    whiteSpace: 'nowrap',
    overflow:   'hidden',
    transition: collapsed
      ? 'opacity 0.1s ease'
      : 'opacity 0.18s ease 0.14s',   // fade in after width expands
  };
}

/* ── eLearning sub-items ─────────────────────────────────────── */
const ELEARNING_ITEMS = [
  {
    to:       '/elearning/sessions',
    label:    'Online Sessions',
    upcoming: false,
    icon: <MonitorPlay className="w-3.5 h-3.5 shrink-0" />,
  },
  {
    to:       '/elearning/classroom',
    label:    'Google Classroom',
    upcoming: true,   // hidden behind "upcoming" badge — backend intact
    icon: (
      <svg viewBox="0 0 48 48" className="w-3.5 h-3.5 shrink-0">
        <path d="M40 6H8a2 2 0 00-2 2v32a2 2 0 002 2h32a2 2 0 002-2V8a2 2 0 00-2-2z" fill="#4CAF50"/>
        <path d="M24 14a5 5 0 100 10 5 5 0 000-10z" fill="white"/>
        <path d="M24 26c-5.33 0-8 2.67-8 4v2h16v-2c0-1.33-2.67-4-8-4z" fill="white"/>
      </svg>
    ),
  },
];

/* ══════════════════════════════════════════════════════════════ */
export default function Sidebar({ collapsed = false, onToggle, onClose }) {
  const navigate = useNavigate();
  const location = useLocation();
  const logout   = useAuthStore(s => s.logout);
  const user     = useAuthStore(s => s.session?.user);
  const school   = useAuthStore(s => s.session?.school);

  // eLearning accordion — auto-open when on any /elearning/* path
  const [eLearningOpen, setELearningOpen] = useState(
    () => location.pathname.startsWith('/elearning')
  );

  /* Dynamic nav — reacts to patchSchool({ moduleConfig }) instantly */
  const moduleConfig = useAuthStore(s => s.session?.school?.moduleConfig);
  const navSections  = computeNav(moduleConfig);

  const schoolName     = school?.name ?? user?.schoolName ?? 'My School';
  const schoolInitials = schoolName
    .split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const schoolLogo  = school?.logoUrl ?? null;
  const userInitial = (user?.name ?? 'U').charAt(0).toUpperCase();

  async function handleLogout() {
    try { await authApi.logout(); } catch { /* ignore */ }
    logout();
    navigate('/login');
  }

  return (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300 overflow-hidden select-none">

      {/* ── School header ──────────────────────────────────────── */}
      {/*
          Collapsed : [logo badge]  (centred)
          Expanded  : [logo] [school name flex-1] [X collapse or mobile close]
      */}
      <div className={clsx(
        'flex h-16 shrink-0 items-center border-b border-slate-800 overflow-hidden',
        collapsed ? 'justify-center gap-0 px-0' : 'gap-3 px-4',
      )}>

        {/* School logo / initials badge — always visible */}
        {schoolLogo ? (
          <img
            src={schoolLogo}
            alt={schoolName}
            className="h-8 w-8 shrink-0 rounded-lg object-contain bg-white/10 p-0.5"
          />
        ) : (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white font-bold text-sm">
            {schoolInitials}
          </div>
        )}

        {/* School name + role — opacity-fade */}
        <div className="flex-1 min-w-0 leading-none" style={labelStyle(collapsed)}>
          <p className="font-semibold text-white text-sm truncate">{schoolName}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 truncate capitalize">
            {user?.role ?? 'Portal'}
          </p>
        </div>

        {/* Desktop collapse — X button, visible only when expanded */}
        {onToggle && !collapsed && (
          <button
            onClick={onToggle}
            title="Collapse sidebar"
            className="shrink-0 text-slate-500 hover:text-white transition p-1.5 rounded-lg hover:bg-white/10"
            aria-label="Collapse sidebar"
          >
            <X size={16} />
          </button>
        )}

        {/* Mobile drawer close — only when onClose is provided */}
        {onClose && (
          <button
            onClick={onClose}
            className="shrink-0 text-slate-500 hover:text-white transition p-1.5 rounded-lg hover:bg-white/10 lg:hidden"
            aria-label="Close sidebar"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* ── Navigation ─────────────────────────────────────────── */}
      <nav
        className={clsx(
          'flex-1 overflow-y-auto overflow-x-hidden py-4 space-y-5',
          collapsed ? 'px-1' : 'px-3',
        )}
      >
        {navSections.map(section => (
          <div key={section.label ?? '__top'}>

            {/* Section label — height + opacity collapse */}
            {section.label && (
              <p
                className="px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600 overflow-hidden"
                style={{
                  opacity:    collapsed ? 0 : 1,
                  maxHeight:  collapsed ? 0 : 20,
                  marginBottom: collapsed ? 0 : 6,
                  whiteSpace: 'nowrap',
                  transition: collapsed
                    ? 'opacity 0.1s ease, max-height 0.15s ease, margin 0.12s ease'
                    : 'opacity 0.18s ease 0.12s, max-height 0.15s ease, margin 0.12s ease',
                }}
              >
                {section.label}
              </p>
            )}

            <ul className="space-y-0.5">
              {section.items.map(({ to, Icon, label, key }) => {

                /* ── eLearning accordion ─────────────────────── */
                if (key === 'elearning') {
                  const isAnyActive = location.pathname.startsWith('/elearning');
                  return (
                    <li key="elearning">
                      {/* Parent trigger */}
                      <button
                        type="button"
                        title={collapsed ? 'eLearning' : undefined}
                        onClick={() => {
                          if (collapsed) { navigate('/elearning/sessions'); return; }
                          setELearningOpen(v => !v);
                        }}
                        className={clsx(
                          'w-full flex items-center rounded-lg transition-colors duration-150',
                          collapsed ? 'justify-center w-10 h-10 mx-auto' : 'gap-3 px-3 py-2',
                          isAnyActive
                            ? 'bg-white/10 text-white font-medium'
                            : 'text-slate-400 hover:bg-white/5 hover:text-white',
                        )}
                      >
                        <MonitorPlay
                          size={16}
                          className={clsx('shrink-0', isAnyActive ? 'text-white' : 'text-slate-500')}
                        />
                        <span style={labelStyle(collapsed)} className="flex-1 text-left text-sm">
                          eLearning
                        </span>
                        {!collapsed && (
                          <ChevronDown
                            size={13}
                            className={clsx(
                              'text-slate-500 transition-transform duration-200 shrink-0',
                              eLearningOpen ? 'rotate-180' : ''
                            )}
                          />
                        )}
                      </button>

                      {/* Sub-items — slide down when open */}
                      {!collapsed && eLearningOpen && (
                        <ul className="mt-0.5 ml-3 pl-4 border-l border-slate-700/60 space-y-0.5">
                          {ELEARNING_ITEMS.map(item => (
                            <li key={item.to}>
                              {item.upcoming ? (
                                /* Upcoming items — not clickable, just a visual placeholder */
                                <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] text-slate-600 cursor-default select-none">
                                  {item.icon}
                                  <span className="flex-1">{item.label}</span>
                                  <span className="text-[10px] font-semibold uppercase tracking-wide bg-slate-700 text-slate-400 px-1.5 py-0.5 rounded-full">
                                    Soon
                                  </span>
                                </div>
                              ) : (
                                <NavLink
                                  to={item.to}
                                  onClick={onClose}
                                  className={({ isActive }) =>
                                    clsx(
                                      'flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] transition-colors duration-150',
                                      isActive
                                        ? 'bg-white/10 text-white font-medium'
                                        : 'text-slate-400 hover:bg-white/5 hover:text-white',
                                    )
                                  }
                                >
                                  {item.icon}
                                  <span>{item.label}</span>
                                </NavLink>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                }

                /* ── Regular nav item ────────────────────────── */
                return (
                  <li key={to}>
                    <NavLink
                      to={to}
                      end={to === '/dashboard'}
                      onClick={onClose}
                      title={collapsed ? label : undefined}
                      className={({ isActive }) =>
                        clsx(
                          'flex items-center rounded-lg transition-colors duration-150',
                          collapsed
                            ? 'justify-center w-10 h-10 mx-auto'
                            : 'gap-3 px-3 py-2',
                          isActive
                            ? 'bg-white/10 text-white font-medium'
                            : 'text-slate-400 hover:bg-white/5 hover:text-white',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon
                            size={16}
                            className={clsx('shrink-0', isActive ? 'text-white' : 'text-slate-500')}
                          />
                          <span style={labelStyle(collapsed)}>
                            {label}
                          </span>
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── User footer ────────────────────────────────────────── */}
      <div
        className={clsx(
          'shrink-0 border-t border-slate-800',
          collapsed ? 'py-3 px-0' : 'py-3 px-4',
        )}
      >
        {collapsed ? (
          /* Collapsed: stacked avatar + logout */
          <div className="flex flex-col items-center gap-2">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-700 text-white text-xs font-semibold"
              title={user?.name ?? 'User'}
            >
              {userInitial}
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="text-slate-500 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-white/5"
            >
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          /* Expanded: avatar + name/role + logout */
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-700 text-white text-xs font-semibold select-none">
              {userInitial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.name ?? 'User'}</p>
              <p className="text-[11px] text-slate-500 truncate capitalize mt-0.5">{user?.role ?? ''}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Sign out"
              className="shrink-0 text-slate-500 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-white/5"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
