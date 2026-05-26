import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { User, LogOut, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import useAuthStore from '@/store/auth.js';

const BREADCRUMB_MAP = {
  '/dashboard':     'Dashboard',
  '/students':      'Students',
  '/teachers':      'Teachers',
  '/classes':       'Classes',
  '/timetable':     'Timetable',
  '/attendance':    'Attendance',
  '/exams':         'Exams & Grades',
  '/admissions':    'Admissions',
  '/behaviour':     'Behaviour',
  '/finance':       'Finance',
  '/settings':      'Settings',
  '/grades':        'Grades',
  '/subjects':      'Subjects',
  '/messages':      'Messages',
  '/events':        'Events',
  '/reports':       'Reports',
  '/hr':            'HR',
  '/profile':       'My Profile',
};

function useBreadcrumb() {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);
  if (!segments.length) return 'Dashboard';
  const root = '/' + segments[0];
  return BREADCRUMB_MAP[root] ?? segments[0].charAt(0).toUpperCase() + segments[0].slice(1);
}

/* ── Avatar — shows photo if available, initials otherwise ─── */
function Avatar({ user, size = 8 }) {
  const [imgErr, setImgErr] = useState(false);
  const initials = (user?.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const src = user?.id ? `/api/users/${user.id}/photo` : null;

  if (src && !imgErr) {
    return (
      <img
        src={src}
        alt={user?.name}
        className={`h-${size} w-${size} rounded-full object-cover`}
        onError={() => setImgErr(true)}
      />
    );
  }
  return (
    <div className={`flex h-${size} w-${size} items-center justify-center rounded-full bg-brand-600 text-white text-xs font-semibold select-none`}>
      {initials}
    </div>
  );
}

export default function TopBar({ onMenuClick }) {
  const title      = useBreadcrumb();
  const navigate   = useNavigate();
  const user       = useAuthStore((s) => s.session?.user);
  const clearSession = useAuthStore((s) => s.clearSession);
  const plan       = useAuthStore((s) => s.session?.school?.plan ?? s.session?.user?.plan ?? 'core');

  const [open, setOpen] = useState(false);
  const dropRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function handleLogout() {
    clearSession();
    navigate('/login', { replace: true });
  }

  const PLAN_COLORS = {
    core:       'bg-slate-100 text-slate-600',
    standard:   'bg-blue-100 text-blue-700',
    premium:    'bg-violet-100 text-violet-700',
    enterprise: 'bg-amber-100 text-amber-700',
  };

  const roleLabel = (user?.primaryRole || user?.role || '').replace(/_/g, ' ');

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 bg-white border-b border-surface-border px-4 md:px-6">
      {/* Mobile hamburger */}
      <button
        onClick={onMenuClick}
        className="text-slate-500 hover:text-slate-700 transition lg:hidden"
        aria-label="Open menu"
      >
        ☰
      </button>

      {/* Title */}
      <h1 className="text-base font-semibold text-slate-800 flex-1 truncate">{title}</h1>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {/* Plan badge */}
        <span className={clsx('hidden sm:inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize', PLAN_COLORS[plan] ?? PLAN_COLORS.core)}>
          {plan}
        </span>

        {/* User avatar + dropdown */}
        <div className="relative" ref={dropRef}>
          <button
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1.5 rounded-full pr-1 hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-expanded={open}
            aria-haspopup="true"
          >
            <Avatar user={user} size={8} />
            <ChevronDown className={clsx('h-3 w-3 text-slate-400 transition-transform', open && 'rotate-180')} />
          </button>

          {/* Dropdown */}
          {open && (
            <div className="absolute right-0 top-full mt-2 w-56 rounded-xl bg-white shadow-lg border border-slate-200 py-1 z-50 animate-in fade-in slide-in-from-top-1 duration-100">
              {/* User info header */}
              <div className="px-4 py-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <Avatar user={user} size={9} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{user?.name}</p>
                    <p className="text-xs text-slate-500 truncate capitalize">{roleLabel}</p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="py-1">
                <button
                  onClick={() => { setOpen(false); navigate('/profile'); }}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <User className="h-4 w-4 text-slate-400" />
                  My Profile
                </button>

                <div className="border-t border-slate-100 my-1" />

                <button
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
