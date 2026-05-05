import { NavLink, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import useAuthStore from '@/store/auth.js';
import { auth as authApi } from '@/api/client.js';

const NAV_SECTIONS = [
  {
    label: null,
    items: [
      { to: '/dashboard',   icon: '⊞',  label: 'Dashboard' },
    ],
  },
  {
    label: 'Academic',
    items: [
      { to: '/students',    icon: '🎓', label: 'Students' },
      { to: '/teachers',    icon: '👩‍🏫', label: 'Teachers' },
      { to: '/classes',     icon: '📚', label: 'Classes' },
      { to: '/timetable',   icon: '🗓', label: 'Timetable' },
      { to: '/attendance',  icon: '✅', label: 'Attendance' },
      { to: '/exams',       icon: '📝', label: 'Exams & Grades' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/admissions',  icon: '📋', label: 'Admissions' },
      { to: '/behaviour',   icon: '⚖️',  label: 'Behaviour' },
      { to: '/finance',     icon: '💰', label: 'Finance' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings',    icon: '⚙️',  label: 'Settings' },
    ],
  },
];

export default function Sidebar({ onClose }) {
  const navigate  = useNavigate();
  const logout    = useAuthStore((s) => s.logout);
  const user      = useAuthStore((s) => s.session?.user);

  // Derive school display info from session
  const schoolName = user?.schoolName || 'My School';
  const schoolInitials = schoolName
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  async function handleLogout() {
    try { await authApi.logout(); } catch { /* ignore */ }
    logout();
    navigate('/login');
  }

  return (
    <div className="flex h-full flex-col bg-sidebar-bg text-sidebar-text">
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center gap-3 px-5 border-b border-sidebar-border">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-white font-bold text-sm select-none">
          {schoolInitials}
        </span>
        <div className="leading-none">
          <p className="font-semibold text-white text-sm truncate max-w-[150px]">{schoolName}</p>
          <p className="text-xs text-sidebar-muted mt-0.5 truncate max-w-[140px]">
            {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Portal'}
          </p>
        </div>
        {/* Mobile close */}
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto text-sidebar-muted hover:text-white transition lg:hidden"
            aria-label="Close sidebar"
          >
            ✕
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6 scrollbar-thin">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label ?? '__top'}>
            {section.label && (
              <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-sidebar-muted">
                {section.label}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/dashboard'}
                    onClick={onClose}
                    className={({ isActive }) =>
                      clsx(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
                        isActive
                          ? 'bg-sidebar-active text-white font-medium'
                          : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white',
                      )
                    }
                  >
                    <span className="text-base leading-none w-5 text-center select-none">{item.icon}</span>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* User footer */}
      <div className="shrink-0 border-t border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white text-xs font-semibold select-none">
            {(user?.name ?? 'U').charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0 leading-none">
            <p className="text-sm font-medium text-white truncate">{user?.name ?? 'User'}</p>
            <p className="text-xs text-sidebar-muted truncate mt-0.5">{user?.role ?? ''}</p>
          </div>
          <button
            onClick={handleLogout}
            className="shrink-0 text-sidebar-muted hover:text-red-400 transition text-sm"
            title="Sign out"
          >
            ↩
          </button>
        </div>
      </div>
    </div>
  );
}
