/* ============================================================
   Reports & Analytics — aggregated school-wide insights
   Uses existing attendance, finance, behaviour, grades APIs.
   ============================================================ */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  BarChart3, Users, Wallet, Scale, Calendar,
  Download, TrendingUp, TrendingDown, AlertCircle, BookOpen, UserCheck,
} from 'lucide-react';
import {
  students  as studentsApi,
  attendance as attendanceApi,
  finance    as financeApi,
  behaviour  as behaviourApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { Stat, Card, ChartTip, COLORS } from './ReportsPrimitives.jsx';

/* ── Helpers ──────────────────────────────────────────────── */
const MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/* ── Tabs ─────────────────────────────────────────────────── */
const TABS = [
  { id: 'overview',    label: 'Overview',    Icon: BarChart3  },
  { id: 'attendance',  label: 'Attendance',  Icon: Calendar   },
  { id: 'finance',     label: 'Finance',     Icon: Wallet     },
  { id: 'behaviour',   label: 'Behaviour',   Icon: Scale      },
  { id: 'academic',    label: 'Academic',    Icon: BookOpen   },
  { id: 'enrollment',  label: 'Enrollment',  Icon: UserCheck  },
];

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */
export default function ReportsPage() {
  const navigate = useNavigate();
  const [tab, setTab]       = useState('overview');
  const school         = useAuthStore(s => s.session?.school);
  const sym            = school?.currencySymbol ?? 'KSh';

  /* ── Data fetches ── */
  const { data: studStats }  = useQuery({ queryKey: ['students','stats'],    queryFn: () => studentsApi.stats(),                select: r => r?.data ?? r });
  const { data: finSummary } = useQuery({ queryKey: ['finance','summary'],   queryFn: () => financeApi.summary({}),             select: r => r?.data ?? r });
  const { data: attSummary } = useQuery({ queryKey: ['attendance','summary'],queryFn: () => attendanceApi.summary({}),          select: r => r?.data ?? r });
  const { data: behSummary } = useQuery({ queryKey: ['behaviour','summary'], queryFn: () => behaviourApi.incidents.summary({}), select: r => r?.data ?? r });

  const { data: recentStudents, isLoading: recentLoading } = useQuery({
    queryKey: ['students', 'recent-enrollments'],
    queryFn:  () => studentsApi.list({ limit: 15, sort: 'enrollmentDate', order: 'desc' }),
    select:   r => r?.data ?? r,
    enabled:  tab === 'enrollment',
    staleTime: 5 * 60_000,
  });

  // finSummary shape: { invoices: { totalInvoiced, totalPaid, ... }, paymentsByMethod: [...] }
  const _fin            = finSummary?.invoices ?? finSummary ?? {};
  const totalStudents   = studStats?.total   ?? 0;
  const activeStudents  = studStats?.active  ?? 0;
  const totalCollected  = _fin.totalPaid      ?? 0;
  const totalInvoiced   = _fin.totalInvoiced  ?? 0;
  const outstanding     = (totalInvoiced - totalCollected) || 0;
  const collectionRate  = totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 0;

  // behSummary is an array of per-student records: [{merits, demerits, ...}]
  const _beh        = Array.isArray(behSummary) ? behSummary : [];
  const totalMerits   = _beh.reduce((s, r) => s + (r.merits   ?? 0), 0);
  const totalDemerits = _beh.reduce((s, r) => s + (r.demerits ?? 0), 0);

  /* ── Gender breakdown for pie ── */
  // byGender is [{_id: 'female', count: 10}, ...] from aggregation
  const genderData = Array.isArray(studStats?.byGender)
    ? studStats.byGender.map(g => ({ name: (g._id || 'Unknown').charAt(0).toUpperCase() + (g._id || 'unknown').slice(1), value: g.count }))
    : [];

  /* ── Class size bar data ── */
  // byClass is [{_id: 'cls_demo_f1a', className: 'Form 1A', count: 3}, ...]
  const classSizeData = Array.isArray(studStats?.byClass)
    ? studStats.byClass.map(c => ({ name: c.className || c._id || 'Unknown', students: c.count })).sort((a, b) => b.students - a.students)
    : [];

  /* ── Finance status pie ── */
  const finStatusData = [
    { name: 'Paid',    value: _fin.countPaid    ?? 0 },
    { name: 'Partial', value: _fin.countPartial ?? 0 },
    { name: 'Unpaid',  value: _fin.countUnpaid  ?? 0 },
  ];

  /* ── Card-level quick export ── */
  function exportCSV(type) {
    let rows = [];
    const date = new Date().toISOString().slice(0,10);
    if (type === 'students' && studStats?.byClass) {
      const raw = Array.isArray(studStats.byClass)
        ? studStats.byClass.map(c => [c.className ?? c._id ?? '—', c.count ?? c.students ?? 0])
        : Object.entries(studStats.byClass);
      rows = [['Class','Students'], ...raw];
    } else if (type === 'finance' && finSummary) {
      rows = [['Metric','Value'],['Total Invoiced',totalInvoiced],['Total Collected',totalCollected],['Outstanding',outstanding],['Collection Rate %',collectionRate]];
    }
    if (!rows.length) return;
    const csv = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const el = document.createElement('a');
    el.href = url; el.download = `report_${type}_${date}.csv`;
    el.click(); URL.revokeObjectURL(url);
  }

  /* ── Tab-aware export ── */
  function exportCurrentTab() {
    let rows = [];
    const date = new Date().toISOString().slice(0,10);
    let filename = `report_${tab}_${date}.csv`;

    const toCSV = (data) => data.map(r => r.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');

    if (tab === 'overview' || tab === 'enrollment') {
      if (studStats?.byClass) {
        const raw = Array.isArray(studStats.byClass)
          ? studStats.byClass.map(c => [c.className ?? c._id ?? '—', c.count ?? c.students ?? 0])
          : Object.entries(studStats.byClass);
        rows = [['Class', 'Students'], ...raw];
        filename = `report_enrollment_${date}.csv`;
      }
    } else if (tab === 'finance') {
      rows = [
        ['Metric', 'Value'],
        ['Total Invoiced',   totalInvoiced],
        ['Total Collected',  totalCollected],
        ['Outstanding',      outstanding],
        ['Collection Rate %', collectionRate],
      ];
    } else if (tab === 'behaviour') {
      rows = [
        ['Metric', 'Count'],
        ['Total Merits',   totalMerits],
        ['Total Demerits', totalDemerits],
      ];
    } else if (tab === 'attendance' && attSummary) {
      const s = attSummary;
      rows = [
        ['Metric', 'Value'],
        ['Total Records',   s.total   ?? 0],
        ['Present',         s.present ?? 0],
        ['Absent',          s.absent  ?? 0],
        ['Late',            s.late    ?? 0],
        ['Excused',         s.excused ?? 0],
        ['Attendance Rate %', s.rate  ?? 0],
      ];
    }

    if (!rows.length) return;
    const blob = new Blob([toCSV(rows)], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const el   = document.createElement('a');
    el.href = url; el.download = filename;
    el.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Reports & Analytics</h1>
          <p className="text-slate-500 text-sm mt-0.5">School-wide insights and performance data.</p>
        </div>
        <button
          onClick={exportCurrentTab}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
        >
          <Download size={14} /> Export {tab.charAt(0).toUpperCase() + tab.slice(1)}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            // Academic was promoted to its own page (AssessmentAnalyticsPage) —
            // it needs real screen space for class/subject breakdowns, a
            // distribution chart, and spread stats that never fit well as one
            // tab among six. This button now just navigates there instead of
            // switching local tab state.
            onClick={() => (t.id === 'academic' ? navigate('/reports/academic') : setTab(t.id))}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition ${
              tab === t.id ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <t.Icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {tab === 'overview' && (
        <div className="space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Total Students"     value={totalStudents.toLocaleString()} sub={`${activeStudents} active`} Icon={Users}    colorIndex={0} />
            <Stat label="Fee Collection"     value={`${collectionRate}%`}           sub={`${sym} ${totalCollected.toLocaleString()} collected`} Icon={Wallet}   colorIndex={1}  />
            <Stat label="Outstanding Fees"   value={`${sym} ${outstanding.toLocaleString()}`} sub="current term" Icon={AlertCircle} colorIndex={3}  />
            <Stat label="Behaviour Merits"   value={totalMerits.toLocaleString()}   sub={`${totalDemerits} demerits`} Icon={Scale}    colorIndex={2}   />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Gender breakdown */}
            <Card title="Student Gender Breakdown">
              {genderData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={genderData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {genderData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip content={<ChartTip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <p className="text-center text-slate-400 text-sm py-10">No data available</p>}
            </Card>

            {/* Students per class */}
            <Card title="Students per Class" action={
              <button onClick={() => exportCSV('students')} className="text-xs text-violet-600 hover:underline flex items-center gap-1">
                <Download size={11} /> CSV
              </button>
            }>
              {classSizeData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={classSizeData.slice(0, 8)} margin={{ left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip content={<ChartTip />} />
                    <Bar dataKey="students" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-center text-slate-400 text-sm py-10">No data available</p>}
            </Card>
          </div>
        </div>
      )}

      {/* ── ATTENDANCE TAB ── */}
      {tab === 'attendance' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <Stat label="Avg Daily Attendance" value={attSummary?.avgRate != null ? `${Math.round(attSummary.avgRate * 100)}%` : '—'} Icon={Calendar} colorIndex={1} />
            <Stat label="Days Recorded"  value={attSummary?.daysRecorded ?? '—'} Icon={Calendar} colorIndex={2}   />
            <Stat label="Chronic Absent" value={attSummary?.chronicAbsent ?? '—'} sub="< 80% attendance" Icon={AlertCircle} colorIndex={3} />
          </div>
          <Card title="Attendance by Class">
            {attSummary?.byClass && Object.keys(attSummary.byClass).length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart
                  data={Object.entries(attSummary.byClass).map(([name, rate]) => ({ name, rate: Math.round((rate ?? 0) * 100) }))}
                  margin={{ left: -10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} unit="%" />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="rate" name="Attendance %" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-slate-400 text-sm py-16">Attendance summary not yet available. Mark attendance to see data here.</p>
            )}
          </Card>
        </div>
      )}

      {/* ── FINANCE TAB ── */}
      {tab === 'finance' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Total Invoiced"   value={`${sym} ${totalInvoiced.toLocaleString()}`}   Icon={Wallet} colorIndex={0} />
            <Stat label="Total Collected"  value={`${sym} ${totalCollected.toLocaleString()}`}  Icon={Wallet} colorIndex={1}  />
            <Stat label="Outstanding"      value={`${sym} ${outstanding.toLocaleString()}`}     Icon={AlertCircle} colorIndex={3} />
            <Stat label="Collection Rate"  value={`${collectionRate}%`}                          Icon={TrendingUp} colorIndex={2} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Invoice Status Distribution" action={
              <button onClick={() => exportCSV('finance')} className="text-xs text-violet-600 hover:underline flex items-center gap-1">
                <Download size={11} /> CSV
              </button>
            }>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={finStatusData.filter(d => d.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}>
                    {finStatusData.map((_, i) => <Cell key={i} fill={['#10b981','#f59e0b','#ef4444'][i % 3]} />)}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </Card>
            <Card title="Collection Summary">
              <div className="space-y-4 pt-2">
                {[
                  { label: 'Paid in full',  value: finSummary?.countPaid    ?? 0, color: 'bg-emerald-500' },
                  { label: 'Partial',       value: finSummary?.countPartial ?? 0, color: 'bg-amber-400'   },
                  { label: 'Unpaid',        value: finSummary?.countUnpaid  ?? 0, color: 'bg-red-400'     },
                ].map(row => (
                  <div key={row.label}>
                    <div className="flex justify-between text-xs text-slate-600 mb-1">
                      <span>{row.label}</span>
                      <span className="font-medium">{row.value} invoices</span>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${row.color}`}
                        style={{ width: `${finSummary?.totalCount ? Math.round((row.value / finSummary.totalCount) * 100) : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ── BEHAVIOUR TAB ── */}
      {tab === 'behaviour' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <Stat label="Total Merits"   value={totalMerits.toLocaleString()}   Icon={Scale}  colorIndex={1}  />
            <Stat label="Total Demerits" value={totalDemerits.toLocaleString()} Icon={Scale}  colorIndex={3}    />
            <Stat label="Incidents This Term" value={(totalMerits + totalDemerits).toLocaleString()} Icon={BarChart3} colorIndex={2} />
          </div>
          <Card title="Behaviour by Type">
            {behSummary ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'Merits',   value: totalMerits   },
                      { name: 'Demerits', value: totalDemerits },
                    ].filter(d => d.value > 0)}
                    dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    <Cell fill="#10b981" />
                    <Cell fill="#ef4444" />
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-center text-slate-400 text-sm py-16">No behaviour data available yet.</p>
            )}
          </Card>
        </div>
      )}

      {/* ── ENROLLMENT TAB ── */}
      {tab === 'enrollment' && (
        <div className="space-y-6">
          {/* KPI row from studStats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Total Enrolled"  value={(studStats?.total  ?? 0).toLocaleString()} Icon={Users}     colorIndex={0} />
            <Stat label="Active Students" value={(studStats?.active ?? 0).toLocaleString()} Icon={UserCheck} colorIndex={1}  />
            <Stat label="Inactive"
              value={((studStats?.total ?? 0) - (studStats?.active ?? 0)).toLocaleString()}
              Icon={AlertCircle} colorIndex={3} />
            <Stat
              label="Avg Class Size"
              value={
                studStats?.byClass && studStats.byClass.length > 0
                  ? Math.round((studStats.total ?? 0) / studStats.byClass.length)
                  : '—'
              }
              Icon={BarChart3} colorIndex={2}
            />
          </div>

          {/* Full class enrollment bar */}
          {studStats?.byClass && studStats.byClass.length > 0 && (
            <Card title="Enrollment by Class" action={
              <button
                onClick={() => exportCSV('students')}
                className="text-xs text-violet-600 hover:underline flex items-center gap-1"
              >
                <Download size={11} /> CSV
              </button>
            }>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={[...studStats.byClass]
                    .sort((a, b) => (a.className ?? a._id ?? '').localeCompare(b.className ?? b._id ?? ''))
                    .map(c => ({ name: c.className ?? c._id ?? 'Unknown', students: c.count ?? c.students ?? 0 }))}
                  margin={{ left: -10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} interval={0} angle={-35} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="students" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          )}

          {/* Recently enrolled */}
          <Card title="Recently Enrolled Students">
            {recentLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}
              </div>
            ) : !recentStudents?.length ? (
              <p className="text-center text-slate-400 text-sm py-8">No enrollment data available.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Student</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Class</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Enrolled</th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentStudents.map((s, i) => (
                    <tr key={s._id ?? s.id} className={`border-b border-slate-50 ${i % 2 === 0 ? '' : 'bg-slate-50/40'}`}>
                      <td className="py-2.5 px-3 font-medium text-slate-800">{s.firstName} {s.lastName}</td>
                      <td className="py-2.5 px-3 text-slate-600 hidden sm:table-cell">{s.className ?? '—'}</td>
                      <td className="py-2.5 px-3 text-slate-500 text-xs">
                        {s.enrollmentDate
                          ? new Date(s.enrollmentDate).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })
                          : '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                          s.status === 'active' ? 'bg-emerald-100 text-emerald-700'
                          : s.status === 'suspended' ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-100 text-slate-600'
                        }`}>
                          {s.status ?? 'active'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

    </div>
  );
}
