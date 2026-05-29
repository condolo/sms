/* ============================================================
   Sidebar — Collapsible Enterprise Navigation
   Expanded : 256 px (icons + labels)
   Collapsed: 64 px  (icons only, native tooltips on hover)

   Animation strategy
   ──────────────────
   • Width spring is driven by AppShell (motion.aside)
   • Text labels use inline opacity/transition so each element
     fades independently without heavy per-label AnimatePresence
   • Layout-critical divs (footer user info, school name) use
     conditional rendering to avoid flex-1 vs overflow conflicts
   • Root div is overflow-hidden so nothing bleeds outside 64 px
   ============================================================ */
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, GraduationCap, Users, BookOpen, Calendar,
  CheckSquare, BarChart3, ClipboardList, Scale,
  Wallet, Settings, LogOut, Library,
  MessageSquare, UserCog, TrendingUp, Tag, HelpCircle,
  ChevronLeft, ChevronRight, BookMarked, Bus, BedDouble,
} from 'lucide-react';
import clsx from 'clsx';
import useAuthStore from '@/store/auth.js';
import { auth as authApi } from '@/api/client.js';

/* ── Nav tree ────────────────────────────────────────────────── */
const NAV_SECTIONS = [
  {
    label: null,
    items: [
      { to: '/dashboard',  Icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    label: 'Academic',
    items: [
      { to: '/students',   Icon: GraduationCap,  label: 'Students'           },
      { to: '/teachers',   Icon: Users,           label: 'Teachers'           },
      { to: '/classes',    Icon: BookOpen,         label: 'Classes'            },
      { to: '/timetable',  Icon: Calendar,        label: 'Timetable'          },
      { to: '/attendance', Icon: CheckSquare,      label: 'Attendance'         },
      { to: '/grades',     Icon: BarChart3,        label: 'Exams & Assessment' },
      { to: '/subjects',   Icon: Library,          label: 'Subjects'           },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/admissions', Icon: ClipboardList,   label: 'Admissions' },
      { to: '/behaviour',  Icon: Scale,           label: 'Behaviour'  },
      { to: '/finance',    Icon: Wallet,          label: 'Finance'    },
      { to: '/messages',   Icon: MessageSquare,   label: 'Messages'   },
      { to: '/events',     Icon: Calendar,        label: 'Events'     },
      { to: '/hr',         Icon: UserCog,         label: 'HR & Staff' },
      { to: '/library',    Icon: BookMarked,      label: 'Library'    },
      { to: '/transport',  Icon: Bus,             label: 'Transport'  },
      { to: '/hostel',     Icon: BedDouble,       label: 'Hostel'     },
    ],
  },
  {
    label: 'Insights',
    items: [
      { to: '/reports', Icon: TrendingUp, label: 'Reports & Analytics' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings',  Icon: Settings,   label: 'Settings'    },
      { to: '/changelog', Icon: Tag,        label: 'Changelog'   },
      { to: '/help',      Icon: HelpCircle, label: 'Help Centre' },
    ],
  },
];

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

/* ══════════════════════════════════════════════════════════════ */
export default function Sidebar({ collapsed = false, onToggle, onClose }) {
  const navigate = useNavigate();
  const logout   = useAuthStore(s => s.logout);
  const user     = useAuthStore(s => s.session?.user);
  const school   = useAuthStore(s => s.session?.school);

  const schoolName     = school?.name ?? user?.schoolName ?? 'My School';
  const schoolInitials = schoolName
    .split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
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
          Collapsed layout  : [logo] [     gap     ] (toggle/close at right is removed)
          Expanded layout   : [logo] [name/role flex-1] [toggle/close]
          overflow-hidden on this div clips the name when collapsing.
      */}
      <div className={clsx(
        'flex h-16 shrink-0 items-center border-b border-slate-800 overflow-hidden',
        collapsed ? 'justify-center gap-0 px-0' : 'gap-3 px-4',
      )}>

        {/* School initials badge — always visible */}
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white font-bold text-sm">
          {schoolInitials}
        </div>

        {/* School name + role — opacity-fade, flex-1 shrinks naturally */}
        <div className="flex-1 min-w-0 leading-none" style={labelStyle(collapsed)}>
          <p className="font-semibold text-white text-sm truncate">{schoolName}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 truncate capitalize">
            {user?.role ?? 'Portal'}
          </p>
        </div>

        {/* Mobile drawer close — only when onClose is provided */}
        {onClose && (
          <button
            onClick={onClose}
            className="shrink-0 text-slate-500 hover:text-white transition lg:hidden p-1 rounded-lg hover:bg-white/10"
            aria-label="Close sidebar"
          >
            ✕
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
        {NAV_SECTIONS.map(section => (
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
              {section.items.map(({ to, Icon, label }) => (
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
                        {/* Label fades out; overflow-hidden on root clips the rest */}
                        <span style={labelStyle(collapsed)}>
                          {label}
                        </span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* ── Collapse / Expand toggle — lives inside nav, no header clutter */}
        {onToggle && (
          <div className="pt-2 border-t border-slate-800/60">
            <button
              onClick={onToggle}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={clsx(
                'flex items-center rounded-lg transition-colors duration-150 text-slate-500 hover:text-white hover:bg-white/5',
                collapsed
                  ? 'justify-center w-10 h-10 mx-auto'
                  : 'gap-3 px-3 py-2 w-full',
              )}
            >
              {collapsed
                ? <ChevronRight size={16} className="shrink-0" />
                : (
                  <>
                    <ChevronLeft size={16} className="shrink-0" />
                    <span style={labelStyle(collapsed)}>Collapse</span>
                  </>
                )
              }
            </button>
          </div>
        )}
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
