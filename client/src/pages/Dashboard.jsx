/* ============================================================
   Dashboard — Premium Enterprise Home with Charts
   recharts: PieChart, BarChart · Role-aware · Real data
   ============================================================ */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Users, UserCheck, BadgeDollarSign, ClipboardList,
  GraduationCap, BookOpen, Calendar, TrendingUp,
  ArrowRight, X, Bell, ChevronRight, Sparkles,
  BarChart3, Clock, AlertTriangle, Wallet,
} from 'lucide-react';
import {
  students as studentsApi,
  finance   as financeApi,
  admissions as admissionsApi,
  announcements as announcementsApi,
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
  const qc     = useQueryClient();
  const user   = useAuthStore(s => s.session?.user);
  const school = useAuthStore(s => s.session?.school);
  const can    = useAuthStore(s => s.can.bind(s));

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

  const role           = user?.role ?? '';
  const canViewFinance = can('finance')    || role === 'admin' || role === 'superadmin';
  const canViewAdm     = can('admissions') || role === 'admin' || role === 'superadmin';

  /* ── Queries ──────────────────────────────────────────── */
  const { data: stuStats, isLoading: stuLoading, isError: stuError } = useQuery({
    queryKey: ['students', 'stats'],
    queryFn:  () => studentsApi.stats(),
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
    staleTime: 2 * 60_000,
  });

  const { data: annData } = useQuery({
    queryKey: ['announcements'],
    queryFn:  () => announcementsApi.list(),
    staleTime: 60_000,
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

      {/* ── Page header ─────────────────────────────────── */}
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
            <span>Live data</span>
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">

        {/* ── KPI Cards ─────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard
            icon={<Users size={18} />}
            label="Total Students"
            value={fmt(totalStudents)}
            sub={activeStudents != null ? `${fmt(activeStudents)} active` : null}
            accent="violet" to="/students"
            loading={stuLoading} error={stuError}
          />
          <KpiCard
            icon={<GraduationCap size={18} />}
            label="Active Enrolment"
            value={fmt(activeStudents)}
            sub="Currently enrolled"
            accent="emerald" to="/students"
            loading={stuLoading} error={stuError}
          />
          {canViewFinance && (
            <KpiCard
              icon={<BadgeDollarSign size={18} />}
              label="Fees Collected"
              value={fmtCurrency(totalPaid)}
              sub={totalInvoiced != null ? `of ${fmtCurrency(totalInvoiced)} invoiced` : 'This year'}
              accent="blue" to="/finance"
              loading={finLoading} error={finError}
            />
          )}
          {canViewFinance && (
            <KpiCard
              icon={<Wallet size={18} />}
              label="Outstanding Fees"
              value={fmtCurrency(totalBalance)}
              sub="Unpaid balance"
              accent="amber" to="/finance"
              loading={finLoading} error={finError}
            />
          )}
        </div>

        {/* ── Charts row ────────────────────────────────── */}
        <div className="grid lg:grid-cols-3 gap-6">

          {/* Gender pie */}
          <ChartCard title="Students by Gender" icon={<Users size={14} />} loading={stuLoading}>
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

          {/* Finance donut */}
          {canViewFinance && (
            <ChartCard title="Fee Collection" icon={<BadgeDollarSign size={14} />} loading={finLoading}>
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
            <ChartCard title="Payment Methods" icon={<Wallet size={14} />} loading={finLoading}>
              <div className="space-y-2.5">
                {paymentMethods.slice(0, 5).map((m, i) => {
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
        </div>

        {/* ── Admissions funnel bar chart ─────────────────── */}
        {canViewAdm && admBarData.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ClipboardList size={15} className="text-slate-400" />
                <h2 className="text-sm font-semibold text-slate-700">Admissions Pipeline</h2>
                <span className="text-xs text-slate-400">({activeApps} active)</span>
              </div>
              <Link to="/admissions" className="text-xs font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1 transition">
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

        {/* ── Bottom grid ───────────────────────────────── */}
        <div className="grid lg:grid-cols-3 gap-6">

          {/* Recent Students — 2/3 */}
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
                      <Link to={`/students/${s._id ?? s.id}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition group">
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

          {/* Quick actions */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
              <TrendingUp size={15} className="text-slate-400" />
              <h2 className="text-sm font-semibold text-slate-700">Quick Actions</h2>
            </div>
            <div className="px-3 py-3 space-y-1">
              {QUICK_ACTIONS.map(qa => (
                <Link key={qa.to} to={qa.to} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-50 transition group">
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
  );
}

/* ── Chart card wrapper ───────────────────────────────────── */
function ChartCard({ title, icon, loading, children }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
        <span className="text-slate-400">{icon}</span>
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

/* ── KPI Card ─────────────────────────────────────────────── */
const ACCENT = {
  violet:  { bg: 'bg-violet-50',  icon: 'text-violet-600'  },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600' },
  amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600'   },
  blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600'    },
};

function KpiCard({ icon, label, value, sub, to, accent = 'violet', loading, error }) {
  const c = ACCENT[accent] ?? ACCENT.violet;
  const inner = (
    <div className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all group">
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center ${c.icon} shrink-0`}>{icon}</div>
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
            <AlertTriangle size={13} /><span className="text-xs">Failed to load</span>
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
  return to ? <Link to={to} className="block focus:outline-none rounded-xl">{inner}</Link> : inner;
}

/* ── Quick Actions ────────────────────────────────────────── */
const QUICK_ACTIONS = [
  { label: 'Enrol Student',   to: '/students',   desc: 'Add a new student record',    Icon: Users,            iconBg: 'bg-violet-50',  iconColor: 'text-violet-600'  },
  { label: 'Mark Attendance', to: '/attendance', desc: "Take today's register",        Icon: UserCheck,        iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600' },
  { label: 'Finance',         to: '/finance',    desc: 'Invoices and fee collection',  Icon: BadgeDollarSign,  iconBg: 'bg-blue-50',    iconColor: 'text-blue-600'    },
  { label: 'Admissions',      to: '/admissions', desc: 'Review the pipeline',          Icon: ClipboardList,    iconBg: 'bg-amber-50',   iconColor: 'text-amber-600'   },
  { label: 'Timetable',       to: '/timetable',  desc: 'View class schedules',         Icon: Calendar,         iconBg: 'bg-cyan-50',    iconColor: 'text-cyan-600'    },
  { label: 'Grades',          to: '/grades',     desc: 'Assessment and reports',       Icon: BookOpen,         iconBg: 'bg-indigo-50',  iconColor: 'text-indigo-600'  },
];
