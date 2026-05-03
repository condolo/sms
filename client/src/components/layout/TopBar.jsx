import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import clsx from 'clsx';
import useAuthStore from '@/store/auth.js';

const BREADCRUMB_MAP = {
  '/dashboard':   'Dashboard',
  '/students':    'Students',
  '/teachers':    'Teachers',
  '/classes':     'Classes',
  '/timetable':   'Timetable',
  '/attendance':  'Attendance',
  '/exams':       'Exams & Grades',
  '/admissions':  'Admissions',
  '/behaviour':   'Behaviour',
  '/finance':     'Finance',
  '/settings':    'Settings',
};

function useBreadcrumb() {
  const { pathname } = useLocation();
  // Match longest prefix
  const segments = pathname.split('/').filter(Boolean);
  if (!segments.length) return 'Dashboard';
  const root = '/' + segments[0];
  return BREADCRUMB_MAP[root] ?? segments[0].charAt(0).toUpperCase() + segments[0].slice(1);
}

export default function TopBar({ onMenuClick }) {
  const title  = useBreadcrumb();
  const user   = useAuthStore((s) => s.session?.user);
  const plan   = useAuthStore((s) => s.session?.user?.plan ?? 'core');

  const PLAN_COLORS = {
    core:       'bg-slate-100 text-slate-600',
    standard:   'bg-blue-100 text-blue-700',
    premium:    'bg-violet-100 text-violet-700',
    enterprise: 'bg-amber-100 text-amber-700',
  };

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

        {/* User avatar */}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-white text-xs font-semibold select-none">
          {(user?.name ?? 'U').charAt(0).toUpperCase()}
        </div>
      </div>
    </header>
  );
}
