/* ============================================================
   Dashboard — 200% Premium Enterprise Home
   recharts · Role-aware · Real data · Birthday Widget
   Upcoming Events · Attendance KPI · Quick Actions
   ============================================================ */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from 'recharts';
import {
  Users, UserCheck, BadgeDollarSign, ClipboardList,
  GraduationCap, BookOpen, Calendar, TrendingUp,
  ArrowRight, X, Bell, ChevronRight, Sparkles,
  BarChart3, Clock, AlertTriangle, Wallet,
  Cake, CalendarDays, CheckCircle, MapPin, Tag,
  ShieldAlert, Activity, Zap, TrendingDown, Award,
  RefreshCw, Rocket,
  BookCheck, Briefcase, FileText, MessageSquare, MonitorPlay, Plus,
} from 'lucide-react';
import {
  students as studentsApi,
  finance   as financeApi,
  admissions as admissionsApi,
  announcements as announcementsApi,
  events as eventsApi,
  attendance as attendanceApi,
  analytics as analyticsApi,
  classes   as classesApi,
  teachers  as teachersApi,
  academicConfig as academicConfigApi,
  birthdaysApi,
  teacherPortalApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { KpiCard }  from '@/components/ui/KpiCard.jsx';
import { useSchoolTheme, withOpacity } from '@/hooks/useSchoolTheme.js';

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
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const AVATAR_COLORS = [
  'from-violet-500 to-purple-600','from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600', 'from-amber-500 to-orange-600',
  'from-pink-500 to-rose-600',    'from-indigo-500 to-blue-600',
];
function avatarColor(name = '') {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
}

/* ── Chart colour palettes ────────────────────────────────── */
const GENDER_COLORS   = { male: '#8b5cf6', female: '#ec4899', other: '#6b7280', prefer_not_to_say: '#94a3b8' };
const STATUS_COLORS   = { active: '#10b981', inactive: '#94a3b8', suspended: '#f59e0b', graduated: '#6366f1', transferred: '#3b82f6' };
const STAGE_COLORS    = { enquiry: '#8b5cf6', application: '#3b82f6', assessment: '#f59e0b', interview: '#f97316', offer: '#06b6d4', acceptance: '#14b8a6', enrolled: '#10b981', withdrawn: '#94a3b8', rejected: '#ef4444' };
const METHOD_COLORS   = ['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ec4899'];
const FINANCE_COLORS  = ['#10b981','#f59e0b'];

const EVENT_CATEGORY_COLORS = {
  term:      '#8b5cf6',
  exam:      '#ef4444',
  meeting:   '#3b82f6',
  sports:    '#10b981',
  cultural:  '#f59e0b',
  training:  '#06b6d4',
  academic:  '#6366f1',
  break:     '#94a3b8',
  general:   '#64748b',
};

/* ── Custom tooltip ───────────────────────────────────────── */
function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl">
      <p className="font-medium">{payload[0].name}</p>
      <p className="text-slate-300 mt-0.5">{payload[0].value?.toLocaleString()}</p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN DASHBOARD
   ══════════════════════════════════════════════════════════ */
export default function Dashboard() {
  const navigate = useNavigate();
  const qc     = useQueryClient();
  const user   = useAuthStore(s => s.session?.user);
  const school = useAuthStore(s => s.session?.school);
  const can    = useAuthStore(s => s.can.bind(s));
  const { primary, accent } = useSchoolTheme();

  const currency       = school?.currency       ?? 'KES';
  const currencySymbol = school?.currencySymbol ?? 'KSh';

  function fmtCurrency(n) {
    if (n == null) return '—';
    try {
      return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${currencySymbol} ${new Intl.NumberFormat().format(n)}`;
    }
  }
  function fmt(n) { return n == null ? '—' : new Intl.NumberFormat().format(n); }

  const role              = user?.role ?? '';
  const isTeacher         = role === 'teacher' || role === 'staff';
  const isAdminLevel      = role === 'admin'   || role === 'superadmin';
  const canViewFinance    = can('finance')    || isAdminLevel;
  const canViewAdm        = can('admissions') || isAdminLevel;
  const canViewStudents   = can('students')   || isAdminLevel;
  const canViewLeadership = LEADER_ROLES.has(role);

  /* ── Queries ──────────────────────────────────────────── */
  const { data: stuStats, isLoading: stuLoading, isError: stuError } = useQuery({
    queryKey: ['students', 'stats'],
    queryFn:  () => studentsApi.stats(),
    enabled:  canViewStudents,
    staleTime: 5 * 60_000,
  });

  const { data: finData, isLoading: finLoading, isError: finError } = useQuery({
    queryKey: ['finance', 'summary'],
    queryFn:  () => financeApi.summary(),
    enabled:  canViewFinance,
    staleTime: 5 * 60_000,
  });

  const { data: admData, isLoading: admLoading, isError: admError } = useQuery({
    queryKey: ['admissions', 'stats'],
    queryFn:  () => admissionsApi.stats(),
    enabled:  canViewAdm,
    staleTime: 5 * 60_000,
  });

  const { data: recentData, isLoading: recentLoading } = useQuery({
    queryKey: ['students', 'recent'],
    queryFn:  () => studentsApi.list({ limit: 8, sort: '-createdAt', status: 'active' }),
    enabled:  canViewStudents,
    staleTime: 2 * 60_000,
  });

  const { data: annData } = useQuery({
    queryKey: ['announcements'],
    queryFn:  () => announcementsApi.list(),
    staleTime: 60_000,
  });

  /* Birthday data — role-filtered by the API */
  const { data: bdayData } = useQuery({
    queryKey: ['birthdays', 'today'],
    queryFn:  () => birthdaysApi.today(),
    staleTime: 10 * 60_000,
  });

  /* Upcoming events */
  const { data: eventsData } = useQuery({
    queryKey: ['events', 'dashboard-upcoming'],
    queryFn:  () => eventsApi.list({ from: todayStr(), limit: 6 }),
    staleTime: 5 * 60_000,
  });

  /* Today's attendance summary */
  const { data: attData } = useQuery({
    queryKey: ['attendance', 'today-summary'],
    queryFn:  () => attendanceApi.summary({ date: todayStr() }),
    staleTime: 2 * 60_000,
  });

  /* Teacher Command Centre — one-shot payload (teacher/staff only) */
  const { data: teacherPortalData, isLoading: teacherLoading } = useQuery({
    queryKey: ['teacher-portal', 'dashboard'],
    queryFn:  () => teacherPortalApi.dashboard(),
    enabled:  isTeacher,
    staleTime: 2 * 60_000,
  });

  /* ── Derived ──────────────────────────────────────────── */
  const statsObj      = stuStats?.data ?? {};
  const totalStudents = statsObj.total   ?? null;
  const activeStudents= statsObj.active  ?? null;

  // Gender pie data
  const genderData = (statsObj.byGender ?? []).map(g => ({
    name:  g._id ? (g._id.charAt(0).toUpperCase() + g._id.slice(1)) : 'Unknown',
    value: g.count,
    fill:  GENDER_COLORS[g._id] ?? '#94a3b8',
  }));

  // Status donut data
  const statusData = (statsObj.byStatus ?? []).map(s => ({
    name:  s._id ? (s._id.charAt(0).toUpperCase() + s._id.slice(1)) : 'Unknown',
    value: s.count,
    fill:  STATUS_COLORS[s._id] ?? '#94a3b8',
  }));

  // Finance
  const invoices        = finData?.data?.invoices ?? {};
  const totalPaid       = invoices.totalPaid    ?? null;
  const totalBalance    = invoices.totalBalance ?? null;
  const totalInvoiced   = invoices.totalInvoiced ?? null;
  const paymentMethods  = (finData?.data?.paymentsByMethod ?? []).map((m, i) => ({
    name:  m._id ?? 'Other',
    value: m.totalCollected,
    count: m.count,
    fill:  METHOD_COLORS[i % METHOD_COLORS.length],
  }));
  const finPieData = totalPaid != null ? [
    { name: 'Collected', value: totalPaid,    fill: FINANCE_COLORS[0] },
    { name: 'Outstanding', value: totalBalance ?? 0, fill: FINANCE_COLORS[1] },
  ] : [];

  // Admissions funnel bar chart
  const byStageArr  = admData?.data?.byStage ?? [];
  const activeApps  = byStageArr.filter(s => !['enrolled','withdrawn','rejected'].includes(s.stage)).reduce((a, s) => a + (s.count ?? 0), 0);
  const admBarData  = byStageArr.map(s => ({
    stage: s.stage.charAt(0).toUpperCase() + s.stage.slice(1),
    count: s.count,
    fill:  STAGE_COLORS[s.stage] ?? '#94a3b8',
  }));

  const recentStudents = recentData?.data ?? [];
  const announcs       = annData?.data    ?? [];
  const upcomingEvents = eventsData?.data ?? [];

  // Birthday data from the role-filtered API
  const todayBirths    = bdayData?.data?.students ?? [];
  const upcomingBirths = bdayData?.data?.upcoming ?? [];

  // Attendance today
  const attSummary   = attData?.data ?? attData ?? null;
  const attPresent   = attSummary?.present  ?? attSummary?.totalPresent  ?? null;
  const attTotal     = attSummary?.total    ?? attSummary?.totalStudents  ?? null;
  const attRate      = attPresent != null && attTotal > 0
    ? Math.round((attPresent / attTotal) * 100)
    : null;

  /* ── Dismiss announcement ─────────────────────────────── */
  const dismissMutation = useMutation({
    mutationFn: id => announcementsApi.dismiss(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['announcements'] }),
  });

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Announcements ───────────────────────────────── */}
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
            <button onClick={() => dismissMutation.mutate(ann.id)} className="text-amber-400 hover:text-amber-700 transition p-0.5">
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* ── Birthday toast banner ────────────────────────── */}
      <AnimatePresence>
        {todayBirths.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="px-6 py-3 flex items-center gap-3"
            style={{ background: `linear-gradient(to right, ${primary}, ${accent})` }}
          >
            <Cake size={15} className="text-white/90 shrink-0" />
            <p className="text-sm text-white font-medium flex-1 truncate">
              {todayBirths.length === 1
                ? `🎂 Happy Birthday, ${todayBirths[0].firstName}! Turning ${todayBirths[0].age} today.`
                : todayBirths.length <= 3
                  ? `🎂 Happy Birthday to ${todayBirths.map(s => s.firstName).join(', ')}! ${todayBirths.length} students celebrating today.`
                  : `🎂 Happy Birthday to ${todayBirths.slice(0, 2).map(s => s.firstName).join(', ')} & ${todayBirths.length - 2} others — ${todayBirths.length} students celebrating today!`}
            </p>
            <Link
              to={todayBirths.length === 1 ? `/students/${todayBirths[0].id}` : '/students'}
              className="text-white/80 hover:text-white text-xs font-medium underline shrink-0"
            >View</Link>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Page header ─────────────────────────────────── */}
      <div id="dashboard-topbar" className="bg-white border-b border-slate-200 h-14 flex items-center px-6 gap-4">
        <h1 id="dashboard-greeting" className="text-[16px] font-bold text-slate-900 flex-1">
          {greeting()}, {firstName(user?.name)} 👋
        </h1>
        <span id="dashboard-term-badge" className="hidden sm:block text-[12px] font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full whitespace-nowrap">
          {school?.currentTerm
            ? `${school.currentTerm} · ${school?.academicYear ?? ''}`
            : school?.academicYear
              ? school.academicYear
              : new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
        <div className="flex items-center gap-2">
          <button
            id="btn-dashboard-reports"
            onClick={() => navigate('/reports')}
            className="px-3.5 py-[7px] rounded-[7px] bg-slate-100 text-slate-600 text-[12px] font-semibold hover:bg-slate-200 transition"
          >
            Reports
          </button>
          <button
            id="btn-dashboard-quick-action"
            onClick={() => navigate(canViewStudents ? '/students' : '/attendance')}
            className="px-3.5 py-[7px] rounded-[7px] text-white text-[12px] font-semibold transition hover:opacity-90"
            style={{ background: primary }}
          >
            + Quick Action
          </button>
        </div>
      </div>

      <div id="dashboard-content" className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">

        {isTeacher ? (
          <TeacherView data={teacherPortalData?.data ?? null} loading={teacherLoading} primary={primary} />
        ) : (<>

        {/* ── Setup Checklist (admin / superadmin only, until dismissed) ── */}
        {isAdminLevel && (
          <SetupChecklist
            school={school}
            role={role}
            stuTotal={stuStats?.data?.total ?? 0}
          />
        )}

        {/* ── KPI Cards ─────────────────────────────────── */}
        <div id="dashboard-kpi-row" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {canViewStudents ? (
            <KpiCard
              variant="filled" colorIndex={0}
              icon={<Users size={18} />}
              label="Total Students"
              value={fmt(totalStudents)}
              sub={activeStudents != null ? `${fmt(activeStudents)} active` : null}
              to="/students"
              loading={stuLoading} error={stuError}
            />
          ) : (
            <KpiCard
              variant="filled" colorIndex={0}
              icon={<CalendarDays size={18} />}
              label="Upcoming Events"
              value={fmt(upcomingEvents.length)}
              sub="In the next 30 days"
              to="/events"
            />
          )}
          {canViewStudents ? (
            <KpiCard
              variant="filled" colorIndex={1}
              icon={<GraduationCap size={18} />}
              label="Active Enrolment"
              value={fmt(activeStudents)}
              sub="Currently enrolled"
              to="/students"
              loading={stuLoading} error={stuError}
            />
          ) : (
            <KpiCard
              variant="filled" colorIndex={1}
              icon={<CheckCircle size={18} />}
              label="Today's Attendance"
              value={attRate != null ? `${attRate}%` : '—'}
              sub={attPresent != null ? `${fmt(attPresent)} present` : 'Not taken yet'}
              to="/attendance"
            />
          )}
          {canViewFinance ? (
            <KpiCard
              variant="filled" colorIndex={2}
              icon={<BadgeDollarSign size={18} />}
              label="Fees Collected"
              value={fmtCurrency(totalPaid)}
              sub={totalInvoiced != null ? `of ${fmtCurrency(totalInvoiced)} invoiced` : 'This year'}
              to="/finance"
              loading={finLoading} error={finError}
            />
          ) : (
            <KpiCard
              variant="filled" colorIndex={2}
              icon={<CalendarDays size={18} />}
              label="Upcoming Events"
              value={fmt(upcomingEvents.length)}
              sub="In the next 30 days"
              to="/events"
            />
          )}
          {canViewFinance ? (
            <KpiCard
              variant="filled" colorIndex={3}
              icon={<Wallet size={18} />}
              label="Outstanding Fees"
              value={fmtCurrency(totalBalance)}
              sub="Unpaid balance"
              to="/finance"
              loading={finLoading} error={finError}
            />
          ) : (
            <KpiCard
              variant="filled" colorIndex={3}
              icon={<CheckCircle size={18} />}
              label="Today's Attendance"
              value={attRate != null ? `${attRate}%` : '—'}
              sub={attPresent != null ? `${fmt(attPresent)} present` : 'Not taken yet'}
              to="/attendance"
            />
          )}
        </div>

        {/* ── Term Overview + Attendance strip ──────────── */}
        <div id="dashboard-term-strip" className="grid lg:grid-cols-2 gap-4">

          {/* Attendance today */}
          <div id="term-strip-attendance" className="bg-white rounded-[10px] border border-slate-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: withOpacity(primary, 0.1) }}>
                <Activity size={13} style={{ color: primary }} />
              </div>
              <h2 className="text-[13px] font-bold text-slate-800 flex-1">Today's Attendance</h2>
              <span id="attendance-today-rate" className={`text-[13px] font-extrabold ${attRate == null ? 'text-slate-400' : attRate >= 80 ? 'text-emerald-600' : 'text-amber-500'}`}>
                {attRate != null ? `${attRate}%` : '—'}
              </span>
            </div>
            <div className="space-y-2">
              {[
                { id: 'att-strip-present', label: 'Present', value: attPresent, color: '#10b981', bg: 'bg-emerald-500' },
                { id: 'att-strip-absent',  label: 'Absent',  value: attTotal != null && attPresent != null ? attTotal - attPresent : null, color: '#ef4444', bg: 'bg-red-400' },
              ].map(({ id, label, value, bg }) => (
                <div key={id} id={id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-slate-500">{label}</span>
                    <span className="text-[11px] font-bold text-slate-700">{value != null ? value.toLocaleString() : '—'}</span>
                  </div>
                  <div className="h-[6px] bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${bg}`}
                      style={{ width: attTotal > 0 && value != null ? `${Math.round((value / attTotal) * 100)}%` : '0%', transition: 'width 0.7s ease' }}
                    />
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-slate-400 pt-1">
                {attTotal != null ? `${attTotal.toLocaleString()} students tracked` : 'No attendance taken today'}
              </p>
            </div>
          </div>

          {/* Term overview */}
          <div id="term-strip-overview" className="bg-white rounded-[10px] border border-slate-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: withOpacity(primary, 0.1) }}>
                <TrendingUp size={13} style={{ color: primary }} />
              </div>
              <h2 className="text-[13px] font-bold text-slate-800 flex-1">Term Overview</h2>
              <Link to="/reports" className="text-[11px] font-medium flex items-center gap-0.5" style={{ color: primary }}>
                Details <ArrowRight size={10} />
              </Link>
            </div>
            <div className="space-y-2.5">
              {[
                {
                  id:    'term-bar-fees',
                  label: 'Fees Collected',
                  pct:   totalPaid != null && totalInvoiced > 0 ? Math.min(100, Math.round((totalPaid / totalInvoiced) * 100)) : null,
                  color: '#4f46e5',
                },
                {
                  id:    'term-bar-adm',
                  label: 'Enrolled (vs applications)',
                  pct:   (() => {
                    const total = admData?.data?.byStage?.reduce((s, x) => s + (x.count ?? 0), 0) ?? 0;
                    const enrolled = admData?.data?.byStage?.find(s => s.stage === 'enrolled')?.count ?? 0;
                    return total > 0 ? Math.min(100, Math.round((enrolled / total) * 100)) : null;
                  })(),
                  color: '#22c55e',
                },
                {
                  id:    'term-bar-att',
                  label: 'Monthly Avg. Attendance',
                  pct:   attRate,
                  color: '#f59e0b',
                },
              ].map(({ id, label, pct, color }) => (
                <div key={id} id={id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-slate-500">{label}</span>
                    <span className="text-[11px] font-bold text-slate-700">{pct != null ? `${pct}%` : '—'}</span>
                  </div>
                  <div className="h-[6px] bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: pct != null ? `${pct}%` : '0%', background: color, transition: 'width 0.7s ease' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Recent Activity timeline ───────────────────── */}
        <div id="dashboard-recent-activity" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: withOpacity(primary, 0.1) }}>
                <Zap size={13} style={{ color: primary }} />
              </div>
              <h2 className="text-[13px] font-bold text-slate-800">Recent Activity</h2>
            </div>
            <span className="text-[11px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
              Today
            </span>
          </div>
          <div id="recent-activity-list" className="divide-y divide-slate-50">
            {[
              ...recentStudents.slice(0, 2).map((s, i) => ({
                key: `student-${s.id ?? i}`,
                id:  `activity-enrolment-${s.id ?? i}`,
                dot: '#6366f1',
                title: `New student enrolled — ${s.firstName} ${s.lastName}${s.className ? ` (${s.className})` : ''}`,
                meta:  s.admissionNumber ? `Adm: ${s.admissionNumber} · ${formatDate(s.createdAt)}` : formatDate(s.createdAt),
              })),
              ...(announcs ?? []).slice(0, 2).map((a, i) => ({
                key:   `ann-${a.id ?? i}`,
                id:    `activity-announcement-${a.id ?? i}`,
                dot:   primary,
                title: a.title,
                meta:  a.body?.slice(0, 80) ?? '',
              })),
              ...upcomingEvents.slice(0, 2).map((ev, i) => ({
                key:   `ev-${ev._id ?? i}`,
                id:    `activity-event-${ev._id ?? i}`,
                dot:   EVENT_CATEGORY_COLORS[ev.category] ?? '#64748b',
                title: ev.title,
                meta:  `${ev.category ?? 'event'} · ${formatDate(ev.date)}`,
              })),
            ]
              .filter(Boolean)
              .slice(0, 5)
              .map(item => (
                <div key={item.key} id={item.id} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="w-2 h-2 rounded-full mt-[5px] flex-shrink-0" style={{ background: item.dot }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 leading-snug truncate">{item.title}</p>
                    {item.meta && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{item.meta}</p>}
                  </div>
                </div>
              ))}
            {recentStudents.length === 0 && announcs.length === 0 && upcomingEvents.length === 0 && (
              <div id="activity-empty" className="flex flex-col items-center justify-center py-8 text-slate-400">
                <Activity size={24} className="mb-2 opacity-40" />
                <p className="text-xs">No recent activity</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Charts row ────────────────────────────────── */}
        <div id="dashboard-charts-row" className="grid lg:grid-cols-3 gap-6">

          {/* Gender pie — student access only */}
          {canViewStudents && (
            <ChartCard title="Students by Gender" icon={<Users size={14} />} loading={stuLoading} primary={primary}>
              {genderData.length > 0 ? (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="55%" height={160}>
                    <PieChart>
                      <Pie data={genderData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                        {genderData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip content={<ChartTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-2">
                    {genderData.map(d => (
                      <div key={d.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
                          <span className="text-xs text-slate-600">{d.name}</span>
                        </div>
                        <span className="text-xs font-semibold text-slate-800 tabular-nums">{d.value.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <EmptyChart label="No student data yet" />}
            </ChartCard>
          )}

          {/* Finance donut */}
          {canViewFinance && (
            <ChartCard title="Fee Collection" icon={<BadgeDollarSign size={14} />} loading={finLoading} primary={primary}>
              {finPieData.length > 0 && totalInvoiced ? (
                <div className="flex items-center gap-4">
                  <ResponsiveContainer width="55%" height={160}>
                    <PieChart>
                      <Pie data={finPieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                        {finPieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <Tooltip content={<ChartTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex-1 space-y-3">
                    {finPieData.map(d => (
                      <div key={d.name}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.fill }} />
                            <span className="text-xs text-slate-600">{d.name}</span>
                          </div>
                          <span className="text-xs font-semibold text-slate-800">{fmtCurrency(d.value)}</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full">
                          <div className="h-full rounded-full" style={{ width: `${Math.round((d.value / (totalInvoiced || 1)) * 100)}%`, background: d.fill }} />
                        </div>
                      </div>
                    ))}
                    <p className="text-[11px] text-slate-400 pt-1">
                      {totalInvoiced ? `${Math.round((totalPaid / totalInvoiced) * 100)}% collection rate` : ''}
                    </p>
                  </div>
                </div>
              ) : <EmptyChart label="No finance data yet" />}
            </ChartCard>
          )}

          {/* Payment methods */}
          {canViewFinance && paymentMethods.length > 0 && (
            <ChartCard title="Payment Methods" icon={<Wallet size={14} />} loading={finLoading} primary={primary}>
              <div className="space-y-2.5">
                {paymentMethods.slice(0, 5).map((m) => {
                  const max = Math.max(...paymentMethods.map(x => x.value), 1);
                  return (
                    <div key={m.name}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: m.fill }} />
                          <span className="text-xs font-medium text-slate-600 capitalize">{m.name}</span>
                          <span className="text-[10px] text-slate-400">({m.count})</span>
                        </div>
                        <span className="text-xs font-semibold text-slate-800">{fmtCurrency(m.value)}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.round((m.value / max) * 100)}%`, background: m.fill }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </ChartCard>
          )}

          {/* If no finance — show attendance chart */}
          {!canViewFinance && (
            <ChartCard title="Today's Attendance" icon={<UserCheck size={14} />} primary={primary}>
              {attRate != null ? (
                <div className="flex flex-col items-center justify-center py-4 gap-3">
                  <div className="relative w-28 h-28">
                    <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f1f5f9" strokeWidth="2.5" />
                      <circle cx="18" cy="18" r="15.9" fill="none" stroke={attRate >= 80 ? '#10b981' : attRate >= 60 ? '#f59e0b' : '#ef4444'}
                        strokeWidth="2.5" strokeDasharray={`${attRate} ${100 - attRate}`} strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className={`text-2xl font-bold ${attRate >= 80 ? 'text-emerald-600' : attRate >= 60 ? 'text-amber-600' : 'text-red-500'}`}>{attRate}%</span>
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-slate-700">{fmt(attPresent)} present</p>
                    <p className="text-xs text-slate-400">of {fmt(attTotal)} students today</p>
                  </div>
                </div>
              ) : (
                <EmptyChart label="No attendance taken today" />
              )}
            </ChartCard>
          )}
        </div>

        {/* ── Admissions funnel bar chart ─────────────────── */}
        {canViewAdm && admBarData.length > 0 && (
          <div id="dashboard-admissions-funnel" className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: withOpacity(primary, 0.1) }}>
                  <ClipboardList size={13} style={{ color: primary }} />
                </div>
                <h2 className="text-sm font-semibold text-slate-700">Admissions Pipeline</h2>
                <span className="text-xs text-slate-400">({activeApps} active)</span>
              </div>
              <Link to="/admissions" className="text-xs font-medium flex items-center gap-1 transition" style={{ color: primary }}>
                Open board <ArrowRight size={12} />
              </Link>
            </div>
            <div className="px-5 py-4">
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={admBarData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="stage" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
                    {admBarData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ── Birthday + Events row ─────────────────────── */}
        <div id="dashboard-birthday-events-row" className="grid lg:grid-cols-3 gap-6">

          {/* Birthday Widget — 1/3 */}
          <BirthdayWidget
            todayBirths={todayBirths}
            upcomingBirths={upcomingBirths}
          />

          {/* Upcoming Events — 2/3 */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: withOpacity(primary, 0.1) }}>
                  <CalendarDays size={13} style={{ color: primary }} />
                </div>
                <h2 className="text-sm font-semibold text-slate-700">Upcoming Events</h2>
              </div>
              <Link to="/events" className="text-xs font-medium flex items-center gap-1 transition" style={{ color: primary }}>
                View calendar <ArrowRight size={12} />
              </Link>
            </div>
            {upcomingEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <CalendarDays size={28} className="mb-2 opacity-40" />
                <p className="text-sm">No upcoming events</p>
                <Link to="/events" className="text-xs mt-1 font-medium" style={{ color: primary }}>Add events →</Link>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {upcomingEvents.map(ev => {
                  const catColor = EVENT_CATEGORY_COLORS[ev.category] ?? '#64748b';
                  const evDate   = ev.date ? new Date(ev.date) : null;
                  const isToday  = evDate && evDate.toDateString() === new Date().toDateString();
                  return (
                    <div key={ev._id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition">
                      {/* Date block */}
                      <div className="shrink-0 w-10 text-center">
                        <p className="text-xs text-slate-400 uppercase leading-none">
                          {evDate ? evDate.toLocaleDateString('en-GB', { month: 'short' }) : '—'}
                        </p>
                        <p className="text-lg font-bold text-slate-800 leading-tight">
                          {evDate ? evDate.getDate() : '—'}
                        </p>
                      </div>

                      {/* Category dot */}
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ background: catColor }} />

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-slate-800 truncate">{ev.title}</p>
                          {isToday && (
                            <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ color: primary, background: withOpacity(primary, 0.1), border: `1px solid ${withOpacity(primary, 0.25)}` }}>TODAY</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 truncate capitalize">{ev.category ?? 'general'}{ev.location ? ` · ${ev.location}` : ''}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Bottom grid ───────────────────────────────── */}
        <div id="dashboard-bottom-grid" className={`grid gap-6 ${canViewStudents ? 'lg:grid-cols-3' : ''}`}>

          {/* Recent Students — only for roles with student access */}
          {canViewStudents && (
            <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: withOpacity(primary, 0.1) }}>
                    <GraduationCap size={13} style={{ color: primary }} />
                  </div>
                  <h2 className="text-sm font-semibold text-slate-700">Recently Enrolled</h2>
                </div>
                <Link to="/students" className="text-xs font-medium flex items-center gap-1 transition" style={{ color: primary }}>
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
                      <li key={s.id ?? s._id}>
                        <Link to={`/students/${s.id ?? s._id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition group">
                          <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${av} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                            {initials(s.firstName, s.lastName)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{s.firstName} {s.lastName}</p>
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
          )}

          {/* Quick actions — permission-filtered */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
              <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: withOpacity(primary, 0.1) }}>
                <TrendingUp size={13} style={{ color: primary }} />
              </div>
              <h2 className="text-sm font-semibold text-slate-700">Quick Actions</h2>
            </div>
            <div className="px-3 py-3 space-y-1">
              {QUICK_ACTIONS.filter(qa => can(qa.module)).map(qa => (
                <Link key={qa.to} to={qa.to} className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition group">
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

        {/* ── Attendance stat (finance users) ────────────── */}
        {canViewFinance && attRate != null && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex items-center gap-5">
            <div className="relative w-14 h-14 shrink-0">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f1f5f9" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.9" fill="none"
                  stroke={attRate >= 80 ? '#10b981' : attRate >= 60 ? '#f59e0b' : '#ef4444'}
                  strokeWidth="3" strokeDasharray={`${attRate} ${100 - attRate}`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-bold text-slate-700">{attRate}%</span>
              </div>
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-700">Today's Attendance</p>
              <p className="text-xs text-slate-400 mt-0.5">{fmt(attPresent)} present · {fmt(attTotal)} students</p>
            </div>
            <Link to="/attendance" className="shrink-0 flex items-center gap-1 text-xs font-medium transition" style={{ color: primary }}>
              Mark attendance <ArrowRight size={12} />
            </Link>
          </div>
        )}

        {/* ── Leadership Analytics ────────────────────────── */}
        {canViewLeadership && (
          <>
            <div className="border-t border-slate-200 pt-2" />
            <LeadershipPanel school={school} />
          </>
        )}
        </>)}
      </div>
    </div>
  );
}

/* ── Birthday Widget ──────────────────────────────────────── */
function BirthdayWidget({ todayBirths, upcomingBirths }) {
  const { primary, accent } = useSchoolTheme();
  const hasAny = todayBirths.length > 0 || upcomingBirths.length > 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: withOpacity(primary, 0.1) }}>
          <Cake size={13} style={{ color: primary }} />
        </div>
        <h2 className="text-sm font-semibold text-slate-700">Birthdays</h2>
        {todayBirths.length > 0 && (
          <span className="ml-auto text-[10px] font-bold text-white px-1.5 py-0.5 rounded-full" style={{ background: primary }}>
            {todayBirths.length} today
          </span>
        )}
      </div>

      {!hasAny ? (
        <div className="flex flex-col items-center justify-center py-10 text-slate-400">
          <Cake size={24} className="mb-2 opacity-40" />
          <p className="text-xs text-slate-500">No birthdays in the next 7 days</p>
          <p className="text-xs text-slate-400 mt-1">Add DOB to student profiles</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {todayBirths.slice(0, 5).map(s => (
            <Link key={s.id ?? s._id} to={`/students/${s.id ?? s._id}`}
              className="flex items-center gap-3 px-4 py-3 transition group"
              style={{ '--hover-bg': withOpacity(primary, 0.06) }}
              onMouseEnter={e => e.currentTarget.style.background = withOpacity(primary, 0.06)}
              onMouseLeave={e => e.currentTarget.style.background = ''}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}>
                {(s.firstName?.[0] ?? '?')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{s.firstName} {s.lastName}</p>
                <p className="text-xs font-medium" style={{ color: primary }}>🎂 Turning {s.age} today!</p>
              </div>
            </Link>
          ))}
          {todayBirths.length > 5 && (
            <Link to="/students" className="flex items-center justify-center gap-1.5 px-4 py-2.5 hover:bg-slate-50 transition">
              <span className="text-xs font-semibold" style={{ color: primary }}>+{todayBirths.length - 5} more celebrating today</span>
            </Link>
          )}
          {upcomingBirths.slice(0, 5).map(s => (
            <Link key={s.id ?? s._id} to={`/students/${s.id ?? s._id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition group">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                style={{ background: withOpacity(primary, 0.08), color: primary }}>
                {(s.firstName?.[0] ?? '?')}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{s.firstName} {s.lastName}</p>
                <p className="text-xs text-slate-400">in {s.daysUntil} day{s.daysUntil !== 1 ? 's' : ''}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Chart card wrapper ───────────────────────────────────── */
function ChartCard({ title, icon, loading, children, primary: _primary }) {
  const { primary: themePrimary } = useSchoolTheme();
  const pc = _primary ?? themePrimary;
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: withOpacity(pc, 0.1) }}>
          <span style={{ color: pc, display: 'flex', alignItems: 'center' }}>{icon}</span>
        </div>
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      </div>
      <div className="px-5 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-40 animate-pulse">
            <div className="w-32 h-32 rounded-full bg-slate-100" />
          </div>
        ) : children}
      </div>
    </div>
  );
}

function EmptyChart({ label }) {
  return (
    <div className="flex items-center justify-center h-32 text-slate-400">
      <p className="text-xs">{label}</p>
    </div>
  );
}

/* KpiCard is imported from @/components/ui/KpiCard.jsx */

/* ══════════════════════════════════════════════════════════
   SETUP CHECKLIST
   Shown to superadmin / admin on new schools until dismissed.
   Tracks 6 essential setup steps with a live progress bar.
   Dismissal is persisted in localStorage keyed by schoolId.
   ══════════════════════════════════════════════════════════ */
function SetupChecklist({ school, role, stuTotal }) {
  const { primary } = useSchoolTheme();
  const schoolId = school?.id ?? '';
  const dismissKey = `msingi_setup_done_${schoolId}`;

  const [dismissed, setDismissed] = useState(
    () => !!localStorage.getItem(dismissKey),
  );

  const isAdmin = role === 'superadmin' || role === 'admin';

  /* Only fire the extra queries when the checklist is visible */
  const enabled = isAdmin && !dismissed && !!schoolId;

  const { data: classRes } = useQuery({
    queryKey: ['setup-check', 'classes'],
    queryFn:  () => classesApi.list({ limit: 1 }),
    enabled,
    staleTime: 5 * 60_000,
  });
  const { data: teacherRes } = useQuery({
    queryKey: ['setup-check', 'teachers'],
    queryFn:  () => teachersApi.list({ limit: 1 }),
    enabled,
    staleTime: 5 * 60_000,
  });
  const { data: feeRes } = useQuery({
    queryKey: ['setup-check', 'fee-structures'],
    queryFn:  () => financeApi.feeStructures.list(),
    enabled,
    staleTime: 5 * 60_000,
  });
  const { data: yearsRes } = useQuery({
    queryKey: ['setup-check', 'academic-years'],
    queryFn:  () => academicConfigApi.years.list(),
    enabled,
    staleTime: 5 * 60_000,
  });

  if (!isAdmin || dismissed) return null;

  /* ── Derive step completion ────────────────────────────── */
  const years      = yearsRes?.data ?? [];
  const activeYear = years.find(y => y.status === 'active');
  const hasYear    = !!(activeYear?.terms?.length > 0);
  const hasClasses  = (classRes?.pagination?.total ?? classRes?.data?.length ?? 0) > 0;
  const hasTeachers = (teacherRes?.pagination?.total ?? teacherRes?.data?.length ?? 0) > 0;
  const hasStudents = (stuTotal ?? 0) > 0;
  const hasFees     = (feeRes?.data?.length ?? 0) > 0;
  const hasProfile  = !!(school?.logoUrl);

  const STEPS = [
    {
      id: 'profile',
      Icon: GraduationCap,
      iconBg: 'bg-violet-50',
      iconColor: 'text-violet-500',
      label: 'Complete school profile',
      hint: 'Upload your logo and add contact details',
      done: hasProfile,
      to: '/settings',
    },
    {
      id: 'ay',
      Icon: Calendar,
      iconBg: 'bg-blue-50',
      iconColor: 'text-blue-500',
      label: 'Set academic year & terms',
      hint: 'Create the current year and set term dates',
      done: hasYear,
      to: '/settings',
    },
    {
      id: 'classes',
      Icon: BookOpen,
      iconBg: 'bg-cyan-50',
      iconColor: 'text-cyan-600',
      label: 'Create classes / grades',
      hint: 'Add Grade 1, Form 1, etc.',
      done: hasClasses,
      to: '/classes',
    },
    {
      id: 'staff',
      Icon: Users,
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
      label: 'Add teaching staff',
      hint: 'Import or manually add your teachers',
      done: hasTeachers,
      to: '/teachers',
    },
    {
      id: 'students',
      Icon: UserCheck,
      iconBg: 'bg-teal-50',
      iconColor: 'text-teal-600',
      label: 'Enroll first students',
      hint: 'Add students or import via CSV',
      done: hasStudents,
      to: '/students',
    },
    {
      id: 'fees',
      Icon: BadgeDollarSign,
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-600',
      label: 'Set up fee structures',
      hint: 'Configure tuition, boarding, transport fees',
      done: hasFees,
      to: '/finance',
    },
  ];

  const doneCount = STEPS.filter(s => s.done).length;
  const pct       = Math.round((doneCount / STEPS.length) * 100);
  const allDone   = doneCount === STEPS.length;

  function dismiss() {
    localStorage.setItem(dismissKey, 'true');
    setDismissed(true);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden"
    >
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="px-5 py-4 flex items-center justify-between gap-4 border-b border-slate-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
            <Rocket size={15} className="text-amber-500" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-slate-900">School Setup Checklist</h3>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                allDone ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}>{pct}% complete</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {allDone
                ? 'Your school is fully configured! You can dismiss this.'
                : `${STEPS.length - doneCount} step${STEPS.length - doneCount !== 1 ? 's' : ''} remaining — complete them to unlock the full platform.`}
            </p>
          </div>
        </div>
        <button
          onClick={dismiss}
          className="text-xs text-slate-400 hover:text-slate-600 shrink-0 transition"
        >
          {allDone ? 'Dismiss ✓' : 'Hide for now'}
        </button>
      </div>

      {/* ── Progress bar ────────────────────────────────────── */}
      <div className="h-1 bg-slate-100">
        <div
          className={`h-full transition-all duration-700 ease-out ${allDone ? 'bg-emerald-500' : ''}`}
          style={{ width: `${pct}%`, background: allDone ? undefined : primary }}
        />
      </div>

      {/* ── Steps grid ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {STEPS.map((step, i) => {
          const inner = (
            <div
              key={step.id}
              className={`flex flex-col gap-1.5 px-4 py-3 border-r border-b border-slate-100 last:border-r-0 transition-colors ${
                step.done ? 'bg-emerald-50/40 cursor-default' : 'cursor-pointer'
              }`}
              onMouseEnter={e => { if (!step.done) e.currentTarget.style.background = withOpacity(primary, 0.05); }}
              onMouseLeave={e => { if (!step.done) e.currentTarget.style.background = ''; }}
            >
              <div className="flex items-center gap-2">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                  step.done ? 'bg-emerald-500' : ''
                }`} style={!step.done ? { background: withOpacity(primary, 0.15) } : {}}>
                  {step.done
                    ? <CheckCircle size={11} className="text-white" />
                    : <span className="text-[10px] font-bold" style={{ color: primary }}>{i + 1}</span>}
                </div>
                <div className={`w-6 h-6 rounded-md flex items-center justify-center ${step.iconBg}`}>
                  <step.Icon size={13} className={step.iconColor} />
                </div>
              </div>
              <p className={`text-xs font-medium leading-snug ${
                step.done ? 'text-emerald-700 line-through decoration-emerald-400/60' : 'text-slate-700'
              }`}>
                {step.label}
              </p>
              {!step.done && (
                <p className="text-[11px] text-slate-400 leading-snug">{step.hint}</p>
              )}
              {!step.done && (
                <span className="text-[11px] font-medium flex items-center gap-0.5 mt-auto" style={{ color: primary }}>
                  Go <ArrowRight size={10} />
                </span>
              )}
            </div>
          );
          return step.done
            ? <div key={step.id}>{inner}</div>
            : <Link key={step.id} to={step.to}>{inner}</Link>;
        })}
      </div>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════
   LEADERSHIP ANALYTICS PANEL
   Visible to: superadmin, admin, deputy_principal, section_head
   Plan:        premium
   ══════════════════════════════════════════════════════════ */
const LEADER_ROLES = new Set(['superadmin', 'admin', 'deputy_principal', 'section_head']);

/* Colour helpers */
function scoreColor(pct) {
  if (pct == null) return '#94a3b8';
  if (pct >= 70)   return '#10b981';
  if (pct >= 50)   return '#f59e0b';
  return '#ef4444';
}
function riskColor(pct) {
  if (pct == null) return '#94a3b8';
  if (pct <= 10)   return '#10b981';
  if (pct <= 25)   return '#f59e0b';
  return '#ef4444';
}

function LeadershipPanel({ school }) {
  const [days, setDays] = useState(30);
  const { primary } = useSchoolTheme();

  const { data: raw, isLoading, isError, refetch } = useQuery({
    queryKey: ['analytics', 'leadership', days],
    queryFn:  () => analyticsApi.leadership(days),
    staleTime: 5 * 60_000,
    retry: false,   // plan upgrade error should surface immediately, not retry
  });

  const data = raw?.data ?? raw ?? null;

  const currency       = school?.currency       ?? 'KES';
  const currencySymbol = school?.currencySymbol ?? 'KSh';

  function fmtC(n) {
    if (n == null) return '—';
    try { return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n); }
    catch { return `${currencySymbol} ${new Intl.NumberFormat().format(n)}`; }
  }
  function fmt(n) { return n == null ? '—' : new Intl.NumberFormat().format(n); }

  /* Derived */
  const attendance     = data?.attendanceRisk    ?? [];
  const fee            = data?.feeExposure       ?? null;
  const behaviour      = data?.behaviourHeatmap  ?? [];
  const academic       = data?.academicHealth    ?? [];

  const totalAtRisk   = attendance.reduce((s, r) => s + (r.atRiskCount ?? 0), 0);
  const totalTracked  = attendance.reduce((s, r) => s + (r.totalStudents ?? 0), 0);
  const schoolAttRate = totalTracked > 0
    ? Math.round(attendance.reduce((s, r) => s + (r.avgRate ?? 0) * r.totalStudents, 0) / totalTracked)
    : null;

  const topBehaviourClasses = behaviour.slice(0, 6);
  const bMax = Math.max(...topBehaviourClasses.map(b => b.total), 1);

  const academicSorted = [...academic].sort((a, b) => (a.avgScore ?? 0) - (b.avgScore ?? 0));
  const aMax = Math.max(...academicSorted.map(a => a.avgScore ?? 0), 1);

  if (isError) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex items-center gap-3">
        <AlertTriangle size={16} className="text-amber-400 shrink-0" />
        <p className="text-sm text-slate-500 flex-1">Leadership analytics unavailable — premium plan required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: primary }}>
            <Activity size={13} className="text-white" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Leadership Analytics</h2>
            <p className="text-xs text-slate-400">
              {data?.meta?.since ? `From ${new Date(data.meta.since).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}` : 'Loading…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex bg-slate-100 rounded-lg p-0.5 gap-0.5">
            {[7, 30, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2.5 py-1 text-xs rounded-md font-medium transition ${
                  days === d ? 'bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
                style={days === d ? { color: primary } : {}}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={() => refetch()}
            className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition"
            title="Refresh"
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* 4-panel grid */}
      <div className="grid lg:grid-cols-2 gap-5">

        {/* ── 1. Attendance Risk ─────────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: withOpacity(primary, 0.1) }}>
                <UserCheck size={13} style={{ color: primary }} />
              </div>
              <span className="text-sm font-semibold text-slate-700">Attendance Risk</span>
            </div>
            <Link to="/attendance" className="text-xs transition flex items-center gap-1 font-medium" style={{ color: primary }}>
              View <ArrowRight size={11} />
            </Link>
          </div>
          {isLoading ? (
            <div className="p-5 space-y-2 animate-pulse">
              {[...Array(5)].map((_, i) => <div key={i} className="h-7 bg-slate-100 rounded" />)}
            </div>
          ) : attendance.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
              <CheckCircle size={24} className="opacity-40" />
              <p className="text-xs">No attendance data for this period</p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-3">
              {/* Top KPIs */}
              <div className="flex items-center gap-4 pb-3 border-b border-slate-50">
                <div className="text-center">
                  <p className="text-xl font-bold tabular-nums"
                    style={{ color: riskColor(totalTracked > 0 ? Math.round(totalAtRisk / totalTracked * 100) : 0) }}>
                    {totalAtRisk}
                  </p>
                  <p className="text-[10px] text-slate-400">at risk</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-slate-700 tabular-nums">{schoolAttRate != null ? `${schoolAttRate}%` : '—'}</p>
                  <p className="text-[10px] text-slate-400">avg rate</p>
                </div>
                <div className="flex-1 text-right">
                  <p className="text-xs text-slate-400">{fmt(totalTracked)} students tracked</p>
                </div>
              </div>
              {/* Per-class list */}
              <div className="space-y-2">
                {attendance.slice(0, 6).map(cls => (
                  <div key={cls.classId} className="flex items-center gap-3">
                    <p className="text-xs text-slate-600 w-24 truncate shrink-0">{cls.className}</p>
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${cls.avgRate ?? 0}%`, background: riskColor(cls.atRiskPct) }}
                      />
                    </div>
                    <div className="text-right shrink-0 w-20">
                      <span className="text-xs font-semibold tabular-nums text-slate-700">{cls.avgRate ?? 0}%</span>
                      {cls.atRiskCount > 0 && (
                        <span className="ml-1.5 text-[10px] font-medium text-red-500">{cls.atRiskCount} at risk</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── 2. Fee Exposure ────────────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: withOpacity(primary, 0.1) }}>
                <Wallet size={13} style={{ color: primary }} />
              </div>
              <span className="text-sm font-semibold text-slate-700">Fee Exposure</span>
            </div>
            <Link to="/finance" className="text-xs transition flex items-center gap-1 font-medium" style={{ color: primary }}>
              View <ArrowRight size={11} />
            </Link>
          </div>
          {isLoading ? (
            <div className="p-5 space-y-2 animate-pulse">
              {[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded" />)}
            </div>
          ) : !fee ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
              <CheckCircle size={24} className="opacity-40" />
              <p className="text-xs">No outstanding invoices</p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {/* KPI row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-amber-50 rounded-lg px-4 py-3">
                  <p className="text-lg font-bold text-amber-700 tabular-nums truncate">{fmtC(fee.totalOutstanding)}</p>
                  <p className="text-[10px] text-amber-600 mt-0.5">Total outstanding</p>
                </div>
                <div className="bg-red-50 rounded-lg px-4 py-3">
                  <p className="text-lg font-bold text-red-600 tabular-nums truncate">{fmtC(fee.overdueAmount)}</p>
                  <p className="text-[10px] text-red-500 mt-0.5">Overdue ({fee.overdueCount ?? 0} invoices)</p>
                </div>
              </div>
              {/* Collection progress */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-500">Collection rate</span>
                  <span className="text-xs font-semibold text-slate-700">
                    {fee.collectionRate != null ? `${fee.collectionRate}%` : '—'}
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${fee.collectionRate ?? 0}%`,
                      background: fee.collectionRate >= 80 ? '#10b981' : fee.collectionRate >= 60 ? '#f59e0b' : '#ef4444',
                    }}
                  />
                </div>
              </div>
              {/* Students owing */}
              <div className="flex items-center justify-between text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
                <span>Students with outstanding fees</span>
                <span className="font-semibold text-slate-700">{fmt(fee.studentsOwing)}</span>
              </div>
            </div>
          )}
        </div>

        {/* ── 3. Behaviour Heatmap ───────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: withOpacity(primary, 0.1) }}>
                <ShieldAlert size={13} style={{ color: primary }} />
              </div>
              <span className="text-sm font-semibold text-slate-700">Behaviour</span>
            </div>
            <Link to="/behaviour" className="text-xs transition flex items-center gap-1 font-medium" style={{ color: primary }}>
              View <ArrowRight size={11} />
            </Link>
          </div>
          {isLoading ? (
            <div className="p-5 space-y-2 animate-pulse">
              {[...Array(5)].map((_, i) => <div key={i} className="h-7 bg-slate-100 rounded" />)}
            </div>
          ) : behaviour.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
              <Award size={24} className="opacity-40" />
              <p className="text-xs">No incidents recorded this period</p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-3">
              {/* Totals row */}
              <div className="flex items-center gap-4 pb-3 border-b border-slate-50">
                <div className="text-center">
                  <p className="text-xl font-bold text-emerald-600 tabular-nums">
                    {fmt(behaviour.reduce((s, b) => s + (b.merits ?? 0), 0))}
                  </p>
                  <p className="text-[10px] text-slate-400">merits</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-bold text-red-500 tabular-nums">
                    {fmt(behaviour.reduce((s, b) => s + (b.demerits ?? 0), 0))}
                  </p>
                  <p className="text-[10px] text-slate-400">demerits</p>
                </div>
                {behaviour.some(b => b.high > 0) && (
                  <div className="flex-1 flex justify-end">
                    <span className="text-[10px] font-bold text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full">
                      {behaviour.reduce((s, b) => s + (b.high ?? 0), 0)} high severity
                    </span>
                  </div>
                )}
              </div>
              {/* Per-class heatmap bars */}
              <div className="space-y-2">
                {topBehaviourClasses.map(cls => {
                  const dPct = bMax > 0 ? Math.round((cls.demerits ?? 0) / bMax * 100) : 0;
                  const mPct = bMax > 0 ? Math.round((cls.merits   ?? 0) / bMax * 100) : 0;
                  return (
                    <div key={cls.classId ?? cls._id} className="flex items-center gap-3">
                      <p className="text-xs text-slate-600 w-24 truncate shrink-0">{cls.className}</p>
                      <div className="flex-1 flex gap-1">
                        <div className="h-1.5 rounded-full bg-emerald-400 transition-all duration-500" style={{ width: `${mPct}%` }} />
                        <div className="h-1.5 rounded-full bg-red-400 transition-all duration-500" style={{ width: `${dPct}%` }} />
                      </div>
                      <div className="text-right shrink-0 w-24 text-xs tabular-nums text-slate-500">
                        <span className="text-emerald-600 font-medium">+{cls.merits ?? 0}</span>
                        {' / '}
                        <span className="text-red-500 font-medium">−{cls.demerits ?? 0}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── 4. Academic Health ─────────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0" style={{ background: withOpacity(primary, 0.1) }}>
                <GraduationCap size={13} style={{ color: primary }} />
              </div>
              <span className="text-sm font-semibold text-slate-700">Academic Health</span>
              <span className="text-[10px] text-slate-400">(published grades)</span>
            </div>
            <Link to="/grades" className="text-xs transition flex items-center gap-1 font-medium" style={{ color: primary }}>
              View <ArrowRight size={11} />
            </Link>
          </div>
          {isLoading ? (
            <div className="p-5 space-y-2 animate-pulse">
              {[...Array(5)].map((_, i) => <div key={i} className="h-7 bg-slate-100 rounded" />)}
            </div>
          ) : academic.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
              <BookOpen size={24} className="opacity-40" />
              <p className="text-xs">No published grades yet</p>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-3">
              {/* Overall average */}
              {academic.length > 0 && (() => {
                const overall = Math.round(academic.reduce((s, a) => s + (a.avgScore ?? 0), 0) / academic.length);
                return (
                  <div className="flex items-center gap-4 pb-3 border-b border-slate-50">
                    <div className="text-center">
                      <p className="text-xl font-bold tabular-nums" style={{ color: scoreColor(overall) }}>{overall}%</p>
                      <p className="text-[10px] text-slate-400">school avg</p>
                    </div>
                    <div className="flex-1">
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${overall}%`, background: scoreColor(overall) }} />
                      </div>
                    </div>
                    {academicSorted[0] && academicSorted[0].avgScore < 50 && (
                      <span className="text-[10px] font-bold text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full shrink-0">
                        {academicSorted.filter(a => a.avgScore < 50).length} below 50%
                      </span>
                    )}
                  </div>
                );
              })()}
              {/* Per-class bars — worst first */}
              <div className="space-y-2">
                {academicSorted.slice(0, 6).map(cls => (
                  <div key={cls.classId} className="flex items-center gap-3">
                    <p className="text-xs text-slate-600 w-24 truncate shrink-0">{cls.className}</p>
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${cls.avgScore ?? 0}%`, background: scoreColor(cls.avgScore) }}
                      />
                    </div>
                    <div className="text-right shrink-0 w-16">
                      <span
                        className="text-xs font-semibold tabular-nums"
                        style={{ color: scoreColor(cls.avgScore) }}
                      >
                        {cls.avgScore ?? 0}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Quick Actions — master list (module key must match sidebar CONFIGURABLE_MODULES key)
   Each action is shown only when the current user's permissions include that module.
   Admin / superadmin always see all of them (can() returns true for those roles). */
const QUICK_ACTIONS = [
  { label: 'Enrol Student',   to: '/students',   desc: 'Add a new student record',    Icon: Users,            iconBg: 'bg-violet-50',  iconColor: 'text-violet-600',  module: 'students'   },
  { label: 'Mark Attendance', to: '/attendance', desc: "Take today's register",        Icon: UserCheck,        iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600', module: 'attendance' },
  { label: 'Admissions',      to: '/admissions', desc: 'Review the pipeline',          Icon: ClipboardList,    iconBg: 'bg-amber-50',   iconColor: 'text-amber-600',   module: 'admissions' },
  { label: 'Finance',         to: '/finance',    desc: 'Invoices and fee collection',  Icon: BadgeDollarSign,  iconBg: 'bg-blue-50',    iconColor: 'text-blue-600',    module: 'finance'    },
  { label: 'Timetable',       to: '/timetable',  desc: 'View class schedules',         Icon: Calendar,         iconBg: 'bg-cyan-50',    iconColor: 'text-cyan-600',    module: 'timetable'  },
  { label: 'Exams & Grades',  to: '/exams',      desc: 'Assessment and reports',       Icon: BookOpen,         iconBg: 'bg-indigo-50',  iconColor: 'text-indigo-600',  module: 'exams'      },
  { label: 'HR & Staff',      to: '/hr',         desc: 'Leave, payroll, documents',    Icon: UserCheck,        iconBg: 'bg-rose-50',    iconColor: 'text-rose-600',    module: 'hr'         },
  { label: 'Behaviour',       to: '/behaviour',  desc: 'Incidents and merits',         Icon: ShieldAlert,      iconBg: 'bg-orange-50',  iconColor: 'text-orange-600',  module: 'behaviour'  },
  { label: 'Lessons',         to: '/lessons',    desc: 'Syllabus and curriculum',      Icon: BookOpen,         iconBg: 'bg-teal-50',    iconColor: 'text-teal-600',    module: 'lessons'    },
  { label: 'Reports',         to: '/reports',    desc: 'Analytics and insights',       Icon: BarChart3,        iconBg: 'bg-emerald-50', iconColor: 'text-emerald-700', module: 'reports'    },
  { label: 'Messages',        to: '/messages',   desc: 'Announcements & messaging',    Icon: Bell,             iconBg: 'bg-sky-50',     iconColor: 'text-sky-600',     module: 'messages'   },
];

/* ══════════════════════════════════════════════════════════
   TEACHER VIEW — rendered inside Dashboard when role=teacher
   Data comes from GET /api/teacher-portal/dashboard
   ══════════════════════════════════════════════════════════ */
function _tmins(t = '') { const [h,m] = t.split(':').map(Number); return (h||0)*60+(m||0); }
function _nowMins()     { const n = new Date(); return n.getHours()*60+n.getMinutes(); }
function _weekday(iso)  { if (!iso) return ''; return new Date(iso).toLocaleDateString('en-GB', { weekday:'short' }); }
function _fmtD(iso)     { if (!iso) return '—'; return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short' }); }
function _daysUntil(d)  { if (!d) return null; return Math.ceil((new Date(d) - new Date()) / 86400000); }
function _todayISO()    { return new Date().toISOString().slice(0,10); }

function TCard({ title, icon: Icon, iconColor='text-teal-600', children, badge, action }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
        <Icon size={14} className={iconColor} />
        <h3 className="text-sm font-semibold text-slate-800 flex-1">{title}</h3>
        {badge}{action}
      </div>
      {children}
    </div>
  );
}

function TAttRing({ pct=0, size=40, stroke=4 }) {
  const r=Math.max((size-stroke)/2,1), circ=2*Math.PI*r, off=circ-(pct/100)*circ;
  const c = pct>=80?'#10b981':pct>=60?'#f59e0b':'#ef4444';
  return (
    <svg width={size} height={size} className="rotate-[-90deg] shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke}/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={c} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"/>
    </svg>
  );
}

function TBar({ pct=0 }) {
  const c = pct>=80?'bg-emerald-500':pct>=50?'bg-amber-400':'bg-red-400';
  return (
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${c} transition-all duration-700`} style={{ width:`${pct}%` }}/>
    </div>
  );
}

function TeacherView({ data, loading, primary }) {
  if (loading || !data) return (
    <div className="flex items-center justify-center py-24">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin"/>
        <p className="text-sm text-slate-400">Loading your workspace…</p>
      </div>
    </div>
  );

  const {
    teacher={}, school={}, timetableToday=[], attendanceWidget=[],
    pendingAttendanceCount=0, todayLessonsCount=0, unreadMessages=0,
    myClasses=[], formClassData=null, atRiskStudents=[],
    curriculumCoverage=[], lessonPlans=[], departments=[],
    hr={}, upcomingExams=[], announcements=[], events=[],
    _noStaffRecord=false,
  } = data;

  const nowMins    = _nowMins();
  const todayISO   = _todayISO();
  const activeSlot = timetableToday.find(s => _tmins(s.startTime) <= nowMins && nowMins < _tmins(s.endTime)) ?? null;
  const nextSlot   = timetableToday.find(s => _tmins(s.startTime) > nowMins) ?? null;
  const unplanned  = timetableToday.filter(s => !lessonPlans.some(p => p.classId===s.classId && p.subjectId===s.subjectId && p.date===todayISO));

  const checklist = [
    { done: pendingAttendanceCount===0, label: pendingAttendanceCount===0 ? 'All attendance submitted' : `${pendingAttendanceCount} class${pendingAttendanceCount>1?'es':''} pending attendance`, urgent: pendingAttendanceCount>0 },
    { done: unplanned.length===0, label: unplanned.length>0 ? `${unplanned.length} lesson${unplanned.length>1?'s':''} without a plan` : 'All lessons planned', urgent: unplanned.length>0 },
    { done: false, label: `${todayLessonsCount} lesson${todayLessonsCount!==1?'s':''} today`, urgent: false },
    { done: upcomingExams.length===0, label: upcomingExams.length>0 ? `${upcomingExams.length} upcoming exam${upcomingExams.length>1?'s':''}` : 'No upcoming exams', urgent: false },
    { done: unreadMessages===0, label: unreadMessages>0 ? `${unreadMessages} unread message${unreadMessages>1?'s':''}` : 'No unread messages', urgent: unreadMessages>0 },
    ...(atRiskStudents.length>0 ? [{ done:false, label:`${atRiskStudents.length} student${atRiskStudents.length>1?'s':''} need attention`, urgent:true }] : []),
    ...((hr.pendingLeaveCount??0)>0 ? [{ done:false, label:`${hr.pendingLeaveCount} leave request${hr.pendingLeaveCount>1?'s':''} pending`, urgent:false }] : []),
  ];

  return (
    <div className="space-y-5">

      {/* ── Hero banner ─────────────────────────────────── */}
      <div className="bg-gradient-to-br from-teal-600 via-teal-700 to-teal-900 rounded-2xl p-6 text-white relative overflow-hidden">
        <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-white/5"/>
        <div className="absolute -bottom-10 -right-4 w-48 h-48 rounded-full bg-white/5"/>
        <p className="text-teal-300 text-[11px] font-semibold uppercase tracking-widest mb-1 relative">{school?.name ?? ''}</p>
        <h2 className="text-xl font-bold mb-4 relative">Today's Work</h2>
        <div className="relative bg-white/10 rounded-xl px-4 py-3 grid sm:grid-cols-2 gap-x-8 gap-y-1.5">
          {checklist.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              {item.done
                ? <CheckCircle size={13} className="text-emerald-400 shrink-0"/>
                : item.urgent
                  ? <AlertTriangle size={13} className="text-amber-300 shrink-0"/>
                  : <Clock size={13} className="text-teal-300 shrink-0"/>
              }
              <span className={`text-xs ${item.urgent?'text-amber-200 font-semibold':item.done?'text-emerald-300':'text-teal-100'}`}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Staff record not linked warning ─────────────── */}
      {_noStaffRecord && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5"/>
          <div>
            <p className="text-sm font-semibold text-amber-800">Staff profile not linked</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Your login account is not connected to a staff directory record. Contact your administrator to link
              your profile — timetable, classes, and assignments will appear once it's set up.
            </p>
          </div>
        </div>
      )}

      {/* ── Emergency online mode ─────────────────────── */}
      {school?.emergencyOnlineMode && (
        <div className="flex items-center gap-3 px-4 py-3 bg-sky-50 border border-sky-200 rounded-xl">
          <MonitorPlay size={16} className="text-sky-600 shrink-0"/>
          <p className="text-sm font-semibold text-sky-700">Emergency Online Learning is active</p>
        </div>
      )}

      {/* ── Main 3/2 grid ─────────────────────────────── */}
      <div className="grid lg:grid-cols-5 gap-5">

        {/* LEFT — wider column */}
        <div className="lg:col-span-3 space-y-5">

          {/* TODAY'S TIMETABLE */}
          <TCard title="Today's Timetable" icon={Calendar} iconColor="text-teal-600"
            badge={<span className="text-[11px] text-slate-400">{new Date().toLocaleDateString('en-GB',{weekday:'long'})}</span>}>
            {!timetableToday.length ? (
              <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                <Calendar size={24} className="mb-2 opacity-40"/>
                <p className="text-sm">No lessons scheduled today</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {timetableToday.map((slot, i) => {
                  const start=_tmins(slot.startTime), end=_tmins(slot.endTime);
                  const isNow=start<=nowMins&&nowMins<end, isNext=!activeSlot&&slot===nextSlot, isPast=end<=nowMins;
                  const attSubmitted=attendanceWidget.find(a=>a.classId===slot.classId)?.submitted??false;
                  return (
                    <div key={i} className={`px-5 py-3 ${isNow?'bg-teal-50':''}`}>
                      <div className="flex items-center gap-3">
                        <div className="text-center shrink-0 w-12">
                          <p className={`text-[10px] font-bold ${isNow?'text-teal-700':'text-slate-600'} ${isPast&&!isNow?'opacity-50':''}`}>{slot.startTime}</p>
                          <p className={`text-[10px] text-slate-400 ${isPast&&!isNow?'opacity-50':''}`}>{slot.endTime}</p>
                        </div>
                        <div className={`flex-1 min-w-0 ${isPast&&!isNow?'opacity-50':''}`}>
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <p className={`text-sm font-semibold truncate ${isNow?'text-teal-800':'text-slate-800'}`}>{slot.subjectName}</p>
                            {isNow  && <span className="text-[9px] font-bold text-white bg-teal-500 px-1.5 py-0.5 rounded-full shrink-0">NOW</span>}
                            {isNext && <span className="text-[9px] font-bold text-white bg-amber-400 px-1.5 py-0.5 rounded-full shrink-0">NEXT</span>}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-slate-400">
                            <span>{slot.className}</span>
                            {slot.room && <><span>·</span><span className="flex items-center gap-0.5"><MapPin size={9}/>{slot.room}</span></>}
                          </div>
                        </div>
                        {!isPast && (
                          <div className="flex items-center gap-1 shrink-0">
                            <Link to={`/attendance${slot.classId?`?classId=${slot.classId}`:''}`}
                              className={`text-[10px] font-semibold px-2 py-1 rounded-lg border transition ${attSubmitted?'text-emerald-600 bg-emerald-50 border-emerald-200':'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100'}`}>
                              {attSubmitted?'✓ Att.':'Take Att.'}
                            </Link>
                            <Link to={`/lessons${slot.classId?`?classId=${slot.classId}`:''}`}
                              className="text-[10px] font-semibold px-2 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition">
                              Lesson
                            </Link>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TCard>

          {/* AT-RISK STUDENTS */}
          {atRiskStudents.length>0 && (
            <TCard title="Students Needing Attention" icon={AlertTriangle} iconColor="text-amber-500"
              badge={<span className="text-[11px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">{atRiskStudents.length}</span>}>
              <div className="divide-y divide-slate-50">
                {atRiskStudents.map((s,i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold ${s.reason==='behaviour'?'bg-red-50 text-red-600':'bg-amber-50 text-amber-600'}`}>{s.name[0]}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{s.name}</p>
                      <p className="text-[11px] text-slate-400">{s.className}</p>
                    </div>
                    <div className="text-right shrink-0">
                      {s.reason==='attendance'
                        ? <p className="text-xs font-bold text-amber-600">{s.absences} absences</p>
                        : <p className="text-xs font-bold text-red-600">{s.incidents} incidents</p>}
                      <p className="text-[10px] text-slate-400 capitalize">{s.reason} concern</p>
                    </div>
                    <Link to={`/students?search=${encodeURIComponent(s.name)}`} className="shrink-0 text-teal-600 hover:text-teal-800"><ChevronRight size={14}/></Link>
                  </div>
                ))}
              </div>
            </TCard>
          )}

          {/* CURRICULUM COVERAGE */}
          {curriculumCoverage.length>0 && (
            <TCard title="Curriculum Coverage" icon={BookCheck} iconColor="text-teal-600"
              action={<Link to="/lessons" className="text-[10px] font-semibold text-teal-600 hover:text-teal-800 flex items-center gap-0.5">Syllabus<ChevronRight size={10}/></Link>}>
              <div className="px-5 py-4 space-y-4">
                {curriculumCoverage.map((c,i) => {
                  const plan=lessonPlans.find(p=>p.classId===c.classId&&p.subjectId===c.subjectId);
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="min-w-0 flex-1">
                          <span className="text-sm font-medium text-slate-800">{c.subjectName}</span>
                          <span className="text-[10px] text-slate-400 ml-2">{c.className}</span>
                          <span className="text-[10px] text-slate-300 ml-1">({c.covered}/{c.total})</span>
                        </div>
                        <span className={`text-xs font-bold ml-3 shrink-0 ${c.pct>=80?'text-emerald-600':c.pct>=50?'text-amber-600':'text-red-500'}`}>{c.pct}%</span>
                      </div>
                      <TBar pct={c.pct}/>
                      {plan && (
                        <div className="mt-1.5 flex items-start gap-1.5 px-2 py-1.5 bg-teal-50 rounded-lg border border-teal-100">
                          <BookOpen size={10} className="text-teal-500 mt-0.5 shrink-0"/>
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold text-teal-700 truncate">{plan.topicTitle}</p>
                            {plan.objectives&&<p className="text-[9px] text-teal-600 truncate">{plan.objectives}</p>}
                          </div>
                          <span className="text-[9px] text-teal-500 shrink-0 ml-auto">{_fmtD(plan.date)}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </TCard>
          )}

          {/* LESSON PLANS */}
          {lessonPlans.length>0 && (
            <TCard title="Lesson Plans — Next 7 Days" icon={BookOpen} iconColor="text-teal-600">
              <div className="divide-y divide-slate-50">
                {lessonPlans.map((plan,i) => {
                  const isToday=plan.date===todayISO;
                  return (
                    <div key={plan.id||i} className={`px-5 py-3 ${isToday?'bg-teal-50/50':''}`}>
                      <div className="flex items-start gap-3">
                        <div className={`text-center shrink-0 w-10 rounded-lg py-1 ${isToday?'bg-teal-100':'bg-slate-100'}`}>
                          <p className={`text-[10px] font-bold leading-tight ${isToday?'text-teal-700':'text-slate-600'}`}>{isToday?'TODAY':_weekday(plan.date)}</p>
                          <p className="text-[9px] text-slate-400">{_fmtD(plan.date)}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{plan.topicTitle}</p>
                          <p className="text-[11px] text-slate-400 truncate">{plan.subjectName} · {plan.className}</p>
                          {plan.objectives&&<p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1 italic">{plan.objectives}</p>}
                        </div>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${plan.status==='delivered'?'bg-emerald-50 text-emerald-600':'bg-teal-50 text-teal-600'}`}>
                          {plan.status==='delivered'?'Done':'Planned'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </TCard>
          )}

          {/* MY CLASSES */}
          {myClasses.length>0 && (
            <TCard title="My Classes" icon={Users} iconColor="text-teal-600">
              <div className="divide-y divide-slate-50">
                {myClasses.map((cls,i) => (
                  <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-teal-700">{cls.name?.[0]??'?'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800">{cls.name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{cls.subjects.slice(0,3).join(' · ')}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-slate-700">{cls.studentCount}</p>
                      <p className="text-[10px] text-slate-400">students</p>
                    </div>
                    <div className="relative w-10 h-10">
                      <TAttRing pct={cls.attendancePct} size={40} stroke={4}/>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <p className={`text-[9px] font-bold ${cls.attendancePct>=80?'text-emerald-600':cls.attendancePct>=60?'text-amber-600':'text-red-500'}`}>{cls.attendancePct}%</p>
                      </div>
                    </div>
                    <Link to={`/classes/${cls.id}`} className="shrink-0 text-teal-600 hover:text-teal-800"><ChevronRight size={14}/></Link>
                  </div>
                ))}
              </div>
            </TCard>
          )}
        </div>

        {/* RIGHT — narrower column */}
        <div className="lg:col-span-2 space-y-5">

          {/* TODAY'S ATTENDANCE */}
          <TCard title="Today's Attendance" icon={CheckCircle} iconColor="text-teal-600">
            {!attendanceWidget.length ? (
              <p className="text-xs text-slate-400 text-center py-6">No classes in today's timetable</p>
            ) : (
              <div className="divide-y divide-slate-50">
                {attendanceWidget.map((a,i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${a.submitted?'bg-emerald-500':'bg-amber-400'}`}/>
                    <p className="text-sm font-medium text-slate-700 flex-1 truncate">{a.className}</p>
                    {a.submitted
                      ? <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Submitted</span>
                      : <Link to={`/attendance?classId=${a.classId}`} className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full hover:bg-amber-100 transition">Take Now →</Link>
                    }
                  </div>
                ))}
              </div>
            )}
          </TCard>

          {/* CLASS TEACHER PANEL */}
          {formClassData && (
            <TCard title={`Class Teacher — ${formClassData.name}`} icon={GraduationCap} iconColor="text-teal-600">
              <div className="px-5 py-4">
                <div className="grid grid-cols-2 gap-2 mb-3">
                  {[
                    { label:'Students', value:formClassData.totalStudents, bg:'bg-slate-50', vc:'text-slate-700' },
                    { label:'Present',  value:formClassData.presentToday,  bg:'bg-emerald-50', vc:'text-emerald-700' },
                    { label:'Absent',   value:formClassData.absentToday,   bg:formClassData.absentToday>0?'bg-red-50':'bg-slate-50', vc:formClassData.absentToday>0?'text-red-600':'text-slate-400' },
                    { label:'Fee Alerts',value:formClassData.feeAlerts,    bg:formClassData.feeAlerts>0?'bg-amber-50':'bg-slate-50', vc:formClassData.feeAlerts>0?'text-amber-600':'text-slate-400' },
                  ].map(({label,value,bg,vc}) => (
                    <div key={label} className={`rounded-xl px-3 py-2.5 ${bg}`}>
                      <p className={`text-base font-bold ${vc}`}>{value}</p>
                      <p className="text-[10px] text-slate-400">{label}</p>
                    </div>
                  ))}
                </div>
                {formClassData.behaviourAlerts>0 && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-xl">
                    <AlertTriangle size={12} className="text-red-400 shrink-0"/>
                    <p className="text-xs text-red-700 font-medium">{formClassData.behaviourAlerts} behaviour alert{formClassData.behaviourAlerts>1?'s':''}</p>
                    <Link to="/behaviour" className="ml-auto text-[10px] font-semibold text-red-600 hover:underline">View →</Link>
                  </div>
                )}
                <Link to={`/classes/${formClassData.id}`} className="mt-3 flex items-center justify-center gap-1 text-xs font-semibold text-teal-600 hover:text-teal-800 py-2 rounded-lg hover:bg-teal-50 transition">
                  View class detail <ChevronRight size={12}/>
                </Link>
              </div>
            </TCard>
          )}

          {/* UPCOMING EXAMS */}
          {upcomingExams.length>0 && (
            <TCard title="Upcoming Exams" icon={ClipboardList} iconColor="text-rose-500">
              <div className="divide-y divide-slate-50">
                {upcomingExams.map((ex,i) => {
                  const days=_daysUntil(ex.date), urgent=days!==null&&days<=3;
                  return (
                    <div key={i} className="flex items-center gap-3 px-5 py-3">
                      <div className={`w-8 h-8 rounded-xl flex flex-col items-center justify-center shrink-0 ${urgent?'bg-red-50':'bg-slate-50'}`}>
                        <p className={`text-xs font-bold leading-none ${urgent?'text-red-600':'text-slate-500'}`}>{days===0?'!':days}</p>
                        {days!==null&&days>0&&<p className="text-[9px] text-slate-400">days</p>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{ex.subjectName}</p>
                        <p className="text-[11px] text-slate-400">{ex.className} · {_weekday(ex.date)}, {_fmtD(ex.date)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="px-5 pb-3">
                <Link to="/exams" className="text-xs font-semibold text-teal-600 hover:text-teal-800 flex items-center gap-1">All exams<ChevronRight size={12}/></Link>
              </div>
            </TCard>
          )}

          {/* DEPARTMENTS */}
          {departments.length>0 && (
            <TCard title="My Department" icon={Briefcase} iconColor="text-indigo-500">
              <div className="px-5 py-4 space-y-3">
                {departments.map((dept,i) => (
                  <div key={dept.id||i} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-white text-xs font-bold" style={{background:dept.color}}>
                      {dept.code?.[0]??dept.name?.[0]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-slate-800">{dept.name}</p>
                        {dept.isHod&&<span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full">HOD</span>}
                      </div>
                      {dept.hodName&&<p className="text-[11px] text-slate-400">HOD: {dept.hodName}</p>}
                    </div>
                    <Link to="/subjects" className="shrink-0 text-slate-400 hover:text-teal-600"><ChevronRight size={14}/></Link>
                  </div>
                ))}
              </div>
            </TCard>
          )}

          {/* HR — LEAVE & PAY */}
          <TCard title="HR — Leave &amp; Pay" icon={Briefcase} iconColor="text-slate-500">
            <div className="px-5 py-4 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold text-slate-600">Leave Requests</p>
                  <Link to="/hr" className="text-[10px] font-semibold text-teal-600 hover:text-teal-800 flex items-center gap-0.5">Apply<Plus size={9}/></Link>
                </div>
                {(hr.recentLeave?.length??0)>0 ? (
                  <div className="space-y-1.5">
                    {hr.recentLeave.map((lr,i) => (
                      <div key={lr.id||i} className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-medium text-slate-700 capitalize">{lr.type}</span>
                          <span className="text-[10px] text-slate-400 ml-2">{_fmtD(lr.startDate)} – {_fmtD(lr.endDate)}</span>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${lr.status==='approved'?'bg-emerald-50 text-emerald-700 border border-emerald-200':lr.status==='rejected'?'bg-red-50 text-red-700 border border-red-200':'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                          {lr.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : <p className="text-xs text-slate-400">No recent leave requests</p>}
              </div>
              {hr.latestPayroll && (
                <div className="border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold text-slate-600 mb-2">Latest Payslip</p>
                  <div className="flex items-center justify-between bg-slate-50 rounded-xl px-3 py-2.5">
                    <div>
                      <p className="text-sm font-bold text-slate-800">KSh {(hr.latestPayroll.netSalary||0).toLocaleString()}</p>
                      <p className="text-[10px] text-slate-400">{hr.latestPayroll.payPeriod}</p>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${hr.latestPayroll.status==='paid'?'bg-emerald-50 text-emerald-700':hr.latestPayroll.status==='confirmed'?'bg-blue-50 text-blue-700':'bg-slate-100 text-slate-500'}`}>
                      {hr.latestPayroll.status}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </TCard>

          {/* SCHOOL EVENTS */}
          {events.length>0 && (
            <TCard title="School Events" icon={Calendar} iconColor="text-blue-500">
              <div className="divide-y divide-slate-50">
                {events.map((ev,i) => {
                  const days=_daysUntil(ev.date);
                  return (
                    <div key={i} className="flex items-center gap-3 px-5 py-3">
                      <div className="w-2 h-2 rounded-full shrink-0 bg-blue-400"/>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{ev.title}</p>
                        <p className="text-[11px] text-slate-400">{_weekday(ev.date)}, {_fmtD(ev.date)}</p>
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {days===0?'Today':days===1?'Tomorrow':days!==null?`${days}d`:''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </TCard>
          )}

          {/* ANNOUNCEMENTS */}
          {announcements.length>0 && (
            <TCard title="Announcements" icon={Bell} iconColor="text-amber-500">
              <div className="divide-y divide-slate-50">
                {announcements.map((ann,i) => (
                  <div key={i} className="px-5 py-3.5">
                    <p className="text-sm font-semibold text-slate-800 mb-0.5">{ann.title}</p>
                    {ann.body&&<p className="text-[11px] text-slate-500 line-clamp-2">{ann.body}</p>}
                    <p className="text-[10px] text-slate-400 mt-1">{_fmtD(ann.createdAt)}</p>
                  </div>
                ))}
              </div>
            </TCard>
          )}
        </div>
      </div>

      {/* ── Quick Actions ─────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={14} className="text-teal-600"/>
          <p className="text-sm font-semibold text-slate-800">Quick Actions</p>
        </div>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
          {[
            { icon:CheckCircle,   label:'Attendance',  to:'/attendance' },
            { icon:ClipboardList, label:'Enter Marks', to:'/exams'      },
            { icon:BookCheck,     label:'Lesson Plan', to:'/lessons'    },
            { icon:Award,         label:'Behaviour',   to:'/behaviour'  },
            { icon:MessageSquare, label:'Messages',    to:'/messages'   },
            { icon:Users,         label:'Students',    to:'/students'   },
            { icon:CalendarDays,  label:'Events',      to:'/events'     },
            { icon:FileText,      label:'Reports',     to:'/reports'    },
          ].map(({icon:Icon,label,to}) => (
            <Link key={label} to={to}
              className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-slate-100 hover:border-teal-200 hover:bg-teal-50 transition group">
              <div className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-teal-100 flex items-center justify-center transition">
                <Icon size={14} className="text-slate-600 group-hover:text-teal-700 transition"/>
              </div>
              <p className="text-[10px] font-medium text-slate-500 group-hover:text-teal-700 transition text-center leading-tight">{label}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
