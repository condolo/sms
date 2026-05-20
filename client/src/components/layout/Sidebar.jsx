/* ============================================================
   Sidebar — Premium Enterprise Navigation
   lucide-react icons · school from session.school
   ============================================================ */
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, GraduationCap, Users, BookOpen, Calendar,
  CheckSquare, FileText, BarChart3, ClipboardList, Scale,
  Wallet, Download, Settings, LogOut, Building2, Library,
} from 'lucide-react';
import clsx from 'clsx';
import useAuthStore from '@/store/auth.js';
import { auth as authApi } from '@/api/client.js';

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
      { to: '/students',   Icon: GraduationCap,   label: 'Students'           },
      { to: '/teachers',   Icon: Users,            label: 'Teachers'           },
      { to: '/classes',    Icon: BookOpen,          label: 'Classes'            },
      { to: '/timetable',  Icon: Calendar,         label: 'Timetable'          },
      { to: '/attendance', Icon: CheckSquare,       label: 'Attendance'         },
      { to: '/exams',      Icon: FileText,          label: 'Exams'              },
      { to: '/grades',     Icon: BarChart3,         label: 'Grades & Assessment'},
      { to: '/subjects',   Icon: Library,           label: 'Subjects'           },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/admissions', Icon: ClipboardList,    label: 'Admissions'  },
      { to: '/behaviour',  Icon: Scale,            label: 'Behaviour'   },
      { to: '/finance',    Icon: Wallet,           label: 'Finance'     },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/import-export', Icon: Download,  label: 'Import & Export' },
      { to: '/settings',      Icon: Settings,  label: 'Settings'        },
    ],
  },
];

export default function Sidebar({ onClose }) {
  const navigate  = useNavigate();
  const logout    = useAuthStore(s => s.logout);
  const user      = useAuthStore(s => s.session?.user);
  const school    = useAuthStore(s => s.session?.school);

  // School display — prefer session.school.name, fallback to user fields
  const schoolName     = school?.name ?? user?.schoolName ?? 'My School';
  const schoolInitials = schoolName
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  async function handleLogout() {
    try { await authApi.logout(); } catch { /* ignore */ }
    logout();
    navigate('/login');
  }

  return (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">

      {/* ── School header ──────────────────────────────── */}
      <div className="flex h-16 shrink-0 items-center gap-3 px-5 border-b border-slate-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-white font-bold text-sm select-none shrink-0">
          {schoolInitials}
        </div>
        <div className="flex-1 min-w-0 leading-none">
          <p className="font-semibold text-white text-sm truncate">{schoolName}</p>
          <p className="text-[11px] text-slate-500 mt-0.5 truncate capitalize">
            {user?.role ?? 'Portal'}
          </p>
        </div>
        {/* Mobile close */}
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto text-slate-500 hover:text-white transition lg:hidden p-1"
            aria-label="Close sidebar"
          >
            ✕
          </button>
        )}
      </div>

      {/* ── Navigation ─────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
        {NAV_SECTIONS.map(section => (
          <div key={section.label ?? '__top'}>
            {section.label && (
              <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
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
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
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
                        {label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* ── User footer ────────────────────────────────── */}
      <div className="shrink-0 border-t border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-700 text-white text-xs font-semibold select-none">
            {(user?.name ?? 'U').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.name ?? 'User'}</p>
            <p className="text-[11px] text-slate-500 truncate capitalize mt-0.5">{user?.role ?? ''}</p>
          </div>
          <button
            onClick={handleLogout}
            className="shrink-0 text-slate-500 hover:text-red-400 transition p-1.5 rounded-lg hover:bg-white/5"
            title="Sign out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
