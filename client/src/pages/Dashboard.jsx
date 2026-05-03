import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { students, attendance, finance, admissions } from '@/api/client.js';
import { PageSpinner } from '@/components/ui/Spinner.jsx';
import { ErrorState }  from '@/components/ui/EmptyState.jsx';
import useAuthStore from '@/store/auth.js';

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, to, color = 'indigo', loading }) {
  const COLOR_MAP = {
    indigo:  { bg: 'bg-indigo-50',  icon: 'text-indigo-600',  ring: 'ring-indigo-200' },
    green:   { bg: 'bg-green-50',   icon: 'text-green-600',   ring: 'ring-green-200' },
    amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600',   ring: 'ring-amber-200' },
    blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600',    ring: 'ring-blue-200' },
    purple:  { bg: 'bg-purple-50',  icon: 'text-purple-600',  ring: 'ring-purple-200' },
    rose:    { bg: 'bg-rose-50',    icon: 'text-rose-600',    ring: 'ring-rose-200' },
  };
  const c = COLOR_MAP[color] ?? COLOR_MAP.indigo;

  const inner = (
    <div className="stat-card hover:shadow-card-hover transition-shadow">
      <div className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl', c.bg, c.icon)}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-500 truncate">{label}</p>
        {loading ? (
          <div className="mt-1.5 h-6 w-16 rounded-md bg-slate-100 animate-pulse" />
        ) : (
          <p className="mt-0.5 text-2xl font-bold text-slate-800 tabular-nums">{value ?? '—'}</p>
        )}
        {sub && !loading && (
          <p className="mt-0.5 text-xs text-slate-400 truncate">{sub}</p>
        )}
      </div>
    </div>
  );

  return to ? (
    <Link to={to} className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-500">
      {inner}
    </Link>
  ) : (
    <div>{inner}</div>
  );
}

// ─── Quick actions ─────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { label: 'Add Student',         to: '/students',    icon: '➕', desc: 'Enrol a new student' },
  { label: 'Record Attendance',   to: '/attendance',  icon: '✅', desc: 'Mark today's register' },
  { label: 'New Invoice',         to: '/finance',     icon: '💳', desc: 'Generate fee invoice' },
  { label: 'Admissions',          to: '/admissions',  icon: '📋', desc: 'Review applications' },
];

// ─── Main component ────────────────────────────────────────────────────────────

export default function Dashboard() {
  const user = useAuthStore((s) => s.session?.user);

  // ── Students total
  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['students', 'count'],
    queryFn:  () => students.list({ limit: 1, status: 'active' }),
  });

  // ── Today's attendance summary (current date)
  const today = new Date().toISOString().slice(0, 10);
  const { data: attendanceData, isLoading: attLoading } = useQuery({
    queryKey: ['attendance', 'summary', today],
    queryFn:  () => attendance.summary({ dateFrom: today, dateTo: today }),
  });

  // ── Finance summary
  const { data: financeData, isLoading: financeLoading } = useQuery({
    queryKey: ['finance', 'summary'],
    queryFn:  () => finance.summary({ year: new Date().getFullYear() }),
  });

  // ── Admissions stats
  const { data: admissionsData, isLoading: admissionsLoading } = useQuery({
    queryKey: ['admissions', 'stats'],
    queryFn:  () => admissions.stats(),
  });

  // ── Recent students (5 most recent)
  const { data: recentStudents, isLoading: recentLoading, isError: recentError, refetch: refetchRecent } = useQuery({
    queryKey: ['students', 'recent'],
    queryFn:  () => students.list({ limit: 5, sort: '-createdAt', status: 'active' }),
  });

  // Derived values
  const totalStudents    = studentsData?.pagination?.total ?? null;
  const presentToday     = attendanceData?.data?.presentCount ?? null;
  const attendancePct    = attendanceData?.data?.rate != null
    ? `${Math.round(attendanceData.data.rate)}% present`
    : null;
  const outstandingFees  = financeData?.data?.outstanding ?? null;
  const openApplications = admissionsData?.data?.find?.((s) => s._id === 'applied')?.count
    ?? admissionsData?.data?.reduce?.((a, s) => a + (s.count ?? 0), 0) ?? null;

  function fmt(n) {
    if (n == null) return '—';
    return new Intl.NumberFormat().format(n);
  }
  function fmtCurrency(n) {
    if (n == null) return '—';
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Greeting */}
      <div>
        <h2 className="text-xl font-bold text-slate-800">
          Good {greeting()}, {firstName(user?.name)} 👋
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon="🎓" label="Active Students"
          value={fmt(totalStudents)}
          to="/students" color="indigo"
          loading={studentsLoading}
        />
        <StatCard
          icon="✅" label="Present Today"
          value={fmt(presentToday)}
          sub={attendancePct}
          to="/attendance" color="green"
          loading={attLoading}
        />
        <StatCard
          icon="💰" label="Outstanding Fees"
          value={fmtCurrency(outstandingFees)}
          to="/finance" color="amber"
          loading={financeLoading}
        />
        <StatCard
          icon="📋" label="Open Applications"
          value={fmt(openApplications)}
          to="/admissions" color="blue"
          loading={admissionsLoading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Students */}
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-700">Recently enrolled</h3>
            <Link to="/students" className="text-xs text-brand-600 hover:underline font-medium">View all →</Link>
          </div>

          {recentLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-slate-100 animate-pulse" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-32 rounded bg-slate-100 animate-pulse" />
                    <div className="h-2.5 w-20 rounded bg-slate-100 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentError ? (
            <ErrorState message="Could not load recent students." onRetry={refetchRecent} />
          ) : (recentStudents?.data ?? []).length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">No students found.</p>
          ) : (
            <ul className="divide-y divide-surface-border -mx-1">
              {(recentStudents?.data ?? []).map((s) => (
                <li key={s._id}>
                  <Link
                    to={`/students/${s._id}`}
                    className="flex items-center gap-3 px-1 py-2.5 rounded-lg hover:bg-slate-50 transition"
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-xs font-semibold uppercase select-none">
                      {initials(s.firstName, s.lastName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">
                        {s.firstName} {s.lastName}
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {s.admissionNumber} · {s.className ?? s.classId ?? 'No class'}
                      </p>
                    </div>
                    <span className="text-xs text-slate-400 shrink-0">
                      {s.createdAt ? new Date(s.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Quick actions</h3>
          <div className="space-y-2">
            {QUICK_ACTIONS.map((qa) => (
              <Link
                key={qa.to}
                to={qa.to}
                className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-slate-50 transition group"
              >
                <span className="text-xl leading-none select-none">{qa.icon}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 group-hover:text-brand-600 transition">
                    {qa.label}
                  </p>
                  <p className="text-xs text-slate-400">{qa.desc}</p>
                </div>
                <span className="ml-auto text-slate-300 group-hover:text-brand-400 transition">›</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function firstName(name) {
  return name?.split(' ')[0] ?? 'there';
}

function initials(first = '', last = '') {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}
