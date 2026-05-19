/* ============================================================
   Dashboard — Premium Enterprise Home
   Linear/Stripe aesthetic • Role-aware • Real data
   ============================================================ */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users, UserCheck, BadgeDollarSign, ClipboardList,
  GraduationCap, BookOpen, Calendar, TrendingUp,
  ArrowRight, X, Bell, ChevronRight, Sparkles,
  BarChart3, Clock, AlertTriangle,
} from 'lucide-react';
import {
  students, attendance, finance, admissions, announcements as announcementsApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

/* ── Helpers ──────────────────────────────────────────────── */
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function firstName(name) { return name?.split(' ')[0] ?? 'there'; }
function initials(f = '', l = '') { return `${f[0] ?? ''}${l[0] ?? ''}`.toUpperCase(); }
function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const AVATAR_COLORS = [
  'from-violet-500 to-purple-600', 'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',  'from-amber-500 to-orange-600',
  'from-pink-500 to-rose-600',     'from-indigo-500 to-blue-600',
];
function avatarColor(name = '') {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
}

/* ══════════════════════════════════════════════════════════
   MAIN DASHBOARD
   ══════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const qc   = useQueryClient();
  const user  = useAuthStore(s => s.session?.user);
  const school = useAuthStore(s => s.session?.school);
  const can   = useAuthStore(s => s.can.bind(s));

  // School currency — multi-tenant aware
  const currency       = school?.currency       ?? 'KES';
  const currencySymbol = school?.currencySymbol ?? 'KSh';

  function fmtCurrency(n) {
    if (n == null) return '—';
    try {
      return new Intl.NumberFormat('en-KE', {
        style: 'currency', currency, maximumFractionDigits: 0,
      }).format(n);
    } catch {
      return `${currencySymbol} ${new Intl.NumberFormat().format(n)}`;
    }
  }
  function fmt(n) {
    if (n == null) return '—';
    return new Intl.NumberFormat().format(n);
  }

  const today = new Date().toISOString().slice(0, 10);
  const role  = user?.role ?? '';

  // Visibility gates — finance sensitive; teachers don't need fee data
  const canViewFinance    = can('finance')    || role === 'admin' || role === 'superadmin';
  const canViewAttendance = can('attendance') || role === 'admin' || role === 'superadmin' || role === 'teacher';
  const canViewAdmissions = can('admissions') || role === 'admin' || role === 'superadmin';

  /* ── Queries ──────────────────────────────────────────── */
  const { data: studentsData, isLoading: studentsLoading, isError: studentsError } = useQuery({
    queryKey: ['students', 'count'],
    queryFn:  () => students.list({ limit: 1, status: 'active' }),
    staleTime: 5 * 60_000,
  });

  const { data: attData, isLoading: attLoading, isError: attError } = useQuery({
    queryKey: ['attendance', 'summary', today],
    queryFn:  () => attendance.summary({ dateFrom: today, dateTo: today }),
    enabled:  canViewAttendance,
    staleTime: 2 * 60_000,
  });

  const { data: finData, isLoading: finLoading, isError: finError } = useQuery({
    queryKey: ['finance', 'summary'],
    queryFn:  () => finance.summary({ year: new Date().getFullYear() }),
    enabled:  canViewFinance,
    staleTime: 5 * 60_000,
  });

  const { data: admData, isLoading: admLoading, isError: admError } = useQuery({
    queryKey: ['admissions', 'stats'],
    queryFn:  () => admissions.stats(),
    enabled:  canViewAdmissions,
    staleTime: 5 * 60_000,
  });

  const { data: recentData, isLoading: recentLoading } = useQuery({
    queryKey: ['students', 'recent'],
    queryFn:  () => students.list({ limit: 8, sort: '-createdAt', status: 'active' }),
    staleTime: 2 * 60_000,
  });

  const { data: annData } = useQuery({
    queryKey: ['announcements'],
    queryFn:  () => announcementsApi.list(),
    staleTime: 60_000,
  });

  /* ── Derived values ───────────────────────────────────── */
  const totalStudents  = studentsData?.pagination?.total ?? null;
  const presentToday   = attData?.data?.presentCount     ?? null;
  const attendanceRate = attData?.data?.rate != null ? Math.round(attData.data.rate) : null;
  const outstanding    = finData?.data?.outstanding       ?? null;

  // CORRECT stats parsing: { total, byStage: [{ stage, count, highPriority }] }
  const byStageArr     = admData?.data?.byStage ?? [];
  const activeApps     = byStageArr
    .filter(s => !['enrolled', 'withdrawn', 'rejected'].includes(s.stage))
    .reduce((a, s) => a + (s.count ?? 0), 0);
  const totalApps      = admData?.data?.total ?? null;

  const recentStudents = recentData?.data ?? [];
  const announcs       = annData?.data ?? [];

  /* ── Dismiss announcement ─────────────────────────────── */
  const dismissMutation = useMutation({
    mutationFn: id => announcementsApi.dismiss(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['announcements'] }),
  });

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Announcements banner ────────────────────────── */}
      <AnimatePresence>
        {announcs.map(ann => (
          <motion.div
            key={ann.id}
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-start gap-3"
          >
            <Bell size={15} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-900">{ann.title}</p>
              {ann.body && <p className="text-xs text-amber-700 mt-0.5">{ann.body}</p>}
            </div>
            <button
              onClick={() => dismissMutation.mutate(ann.id)}
              className="shrink-0 text-amber-500 hover:text-amber-700 transition p-0.5"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* ── Header ──────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-6 py-6">
        <div className="max-w-screen-2xl mx-auto flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={14} className="text-amber-500" />
              <span className="text-xs font-medium text-slate-400">
                {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            </div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
              {greeting()}, {firstName(user?.name)} 👋
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {school?.name ?? user?.schoolName ?? 'Your School'} · {role.charAt(0).toUpperCase() + role.slice(1)} Dashboard
            </p>
          </div>
          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-400">
            <Clock size={13} />
            <span>Last updated just now</span>
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">

        {/* ── KPI cards ─────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            icon={<Users size={18} />}
            label="Active Students"
            value={fmt(totalStudents)}
            accent="violet"
            to="/students"
            loading={studentsLoading}
            error={studentsError}
            sub={totalStudents != null ? `${totalStudents} enrolled` : null}
          />
          {canViewAttendance && (
            <KpiCard
              icon={<UserCheck size={18} />}
              label="Present Today"
              value={presentToday != null ? fmt(presentToday) : '—'}
              sub={attendanceRate != null ? `${attendanceRate}% attendance rate` : 'No data yet'}
              accent="emerald"
              to="/attendance"
              loading={attLoading}
              error={attError}
            />
          )}
          {canViewFinance && (
            <KpiCard
              icon={<BadgeDollarSign size={18} />}
              label="Outstanding Fees"
              value={fmtCurrency(outstanding)}
              sub="Current academic year"
              accent="amber"
              to="/finance"
              loading={finLoading}
              error={finError}
            />
          )}
          {canViewAdmissions && (
            <KpiCard
              icon={<ClipboardList size={18} />}
              label="Active Applications"
              value={fmt(activeApps || totalApps)}
              sub={byStageArr.length > 0 ? `${byStageArr.find(s => s.stage === 'enquiry')?.count ?? 0} new enquiries` : 'View pipeline'}
              accent="blue"
              to="/admissions"
              loading={admLoading}
              error={admError}
            />
          )}
        </div>

        {/* ── Main content ──────────────────────────────── */}
        <div className="grid lg:grid-cols-3 gap-6">

          {/* Recent Students — 2/3 width */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <GraduationCap size={15} className="text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-700">Recently Enrolled</h2>
              </div>
              <Link to="/students" className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1 transition">
                View all <ArrowRight size={12} />
              </Link>
            </div>

            {recentLoading ? (
              <div className="p-5 space-y-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 animate-pulse">
                    <div className="w-9 h-9 rounded-full bg-slate-100 shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 bg-slate-100 rounded w-40" />
                      <div className="h-2.5 bg-slate-100 rounded w-24" />
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded w-12" />
                  </div>
                ))}
              </div>
            ) : recentStudents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-slate-400">
                <Users size={28} className="mb-2 opacity-40" />
                <p className="text-sm">No students enrolled yet</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-50">
                {recentStudents.map(s => {
                  const av = avatarColor(`${s.firstName}${s.lastName}`);
                  return (
                    <li key={s._id ?? s.id}>
                      <Link
                        to={`/students/${s._id ?? s.id}`}
                        className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition group"
                      >
                        <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${av} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                          {initials(s.firstName, s.lastName)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate group-hover:text-slate-900">
                            {s.firstName} {s.lastName}
                          </p>
                          <p className="text-xs text-slate-400 truncate">
                            {s.admissionNumber && `${s.admissionNumber} · `}{s.className ?? s.classId ?? 'No class'}
                          </p>
                        </div>
                        <span className="text-xs text-slate-400 shrink-0">{formatDate(s.createdAt)}</span>
                        <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition shrink-0" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Right column */}
          <div className="space-y-5">
            {/* Admissions funnel */}
            {canViewAdmissions && byStageArr.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={15} className="text-slate-400" />
                    <h2 className="text-sm font-semibold text-slate-700">Admissions Funnel</h2>
                  </div>
                  <Link to="/admissions" className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1 transition">
                    Open <ArrowRight size={12} />
                  </Link>
                </div>
                <div className="px-5 py-4 space-y-2.5">
                  {byStageArr.slice(0, 6).map(s => {
                    const maxCount = Math.max(...byStageArr.map(x => x.count ?? 0), 1);
                    const pct = Math.round(((s.count ?? 0) / maxCount) * 100);
                    const STAGE_COLORS = {
                      enquiry: 'bg-violet-400', application: 'bg-blue-400',
                      assessment: 'bg-amber-400', interview: 'bg-orange-400',
                      offer: 'bg-cyan-400', acceptance: 'bg-teal-400',
                      enrolled: 'bg-emerald-500', withdrawn: 'bg-slate-300', rejected: 'bg-red-300',
                    };
                    return (
                      <div key={s.stage}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-slate-600 capitalize">{s.stage}</span>
                          <span className="text-xs text-slate-400 tabular-nums">{s.count ?? 0}</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${STAGE_COLORS[s.stage] ?? 'bg-slate-400'} transition-all duration-500`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quick actions */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
                <TrendingUp size={15} className="text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-700">Quick Actions</h2>
              </div>
              <div className="px-3 py-3 space-y-1">
                {QUICK_ACTIONS.filter(qa => !qa.role || qa.role === role || role === 'admin' || role === 'superadmin').map(qa => (
                  <Link
                    key={qa.to}
                    to={qa.to}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition group"
                  >
                    <div className={`w-7 h-7 rounded-lg ${qa.iconBg} flex items-center justify-center shrink-0`}>
                      <qa.Icon size={14} className={qa.iconColor} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 group-hover:text-slate-900 transition">{qa.label}</p>
                      <p className="text-[11px] text-slate-400">{qa.desc}</p>
                    </div>
                    <ChevronRight size={13} className="text-slate-300 group-hover:text-slate-500 transition shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── KPI Card ─────────────────────────────────────────────── */
const ACCENT = {
  violet:  { bg: 'bg-violet-50',  icon: 'text-violet-600',  border: 'border-violet-100' },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', border: 'border-emerald-100' },
  amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600',   border: 'border-amber-100'  },
  blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600',    border: 'border-blue-100'   },
};

function KpiCard({ icon, label, value, sub, to, accent = 'violet', loading, error }) {
  const c = ACCENT[accent] ?? ACCENT.violet;

  const inner = (
    <div className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all group">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center ${c.icon} shrink-0`}>
          {icon}
        </div>
        {to && <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-500 transition mt-1 shrink-0" />}
      </div>
      <div className="mt-4">
        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-7 w-20 bg-slate-100 rounded" />
            <div className="h-3 w-32 bg-slate-100 rounded" />
          </div>
        ) : error ? (
          <div className="flex items-center gap-1.5 text-slate-400">
            <AlertTriangle size={13} />
            <span className="text-xs">Failed to load</span>
          </div>
        ) : (
          <>
            <p className="text-2xl font-bold text-slate-900 tabular-nums tracking-tight">{value ?? '—'}</p>
            {sub && <p className="text-xs text-slate-400 mt-0.5 truncate">{sub}</p>}
          </>
        )}
        <p className="text-xs font-medium text-slate-500 mt-3">{label}</p>
      </div>
    </div>
  );

  return to ? (
    <Link to={to} className="block focus:outline-none focus:ring-2 focus:ring-slate-300 rounded-xl">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/* ── Quick Actions config ─────────────────────────────────── */
const QUICK_ACTIONS = [
  {
    label: 'Enrol Student',    to: '/students',    desc: 'Add a new student record',
    Icon: Users,        iconBg: 'bg-violet-50',  iconColor: 'text-violet-600',
  },
  {
    label: 'Mark Attendance',  to: '/attendance',  desc: "Take today's register",
    Icon: UserCheck,    iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600',
  },
  {
    label: 'Finance',          to: '/finance',     desc: 'Invoices and fee collection',
    Icon: BadgeDollarSign, iconBg: 'bg-amber-50', iconColor: 'text-amber-600',
  },
  {
    label: 'Admissions',       to: '/admissions',  desc: 'Review the pipeline',
    Icon: ClipboardList, iconBg: 'bg-blue-50',   iconColor: 'text-blue-600',
  },
  {
    label: 'Timetable',        to: '/timetable',   desc: 'View class schedules',
    Icon: Calendar,     iconBg: 'bg-cyan-50',   iconColor: 'text-cyan-600',
  },
  {
    label: 'Grades',           to: '/grades',      desc: 'Assessment and reports',
    Icon: BookOpen,     iconBg: 'bg-indigo-50', iconColor: 'text-indigo-600',
  },
];
