/* ============================================================
   Reports & Analytics — aggregated school-wide insights
   Uses existing attendance, finance, behaviour, grades APIs.
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  BarChart3, Users, Wallet, Scale, Calendar,
  Download, TrendingUp, TrendingDown, AlertCircle,
} from 'lucide-react';
import {
  students  as studentsApi,
  attendance as attendanceApi,
  finance    as financeApi,
  behaviour  as behaviourApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

/* ── Helpers ──────────────────────────────────────────────── */
const COLORS = ['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444','#ec4899'];
const MONTHS  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function Stat({ label, value, sub, trend, Icon, color }) {
  const colors = {
    violet: 'bg-violet-50 text-violet-600',
    blue:   'bg-blue-50   text-blue-600',
    green:  'bg-emerald-50 text-emerald-600',
    amber:  'bg-amber-50  text-amber-600',
    red:    'bg-red-50    text-red-600',
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`rounded-lg p-2 ${colors[color] ?? colors.violet}`}>
          <Icon size={16} />
        </div>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
      {trend != null && (
        <div className={`flex items-center gap-1 mt-2 text-xs font-medium ${trend >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {Math.abs(trend)}% vs last term
        </div>
      )}
    </div>
  );
}

function Card({ title, children, action }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-900 text-sm">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-900 text-white text-xs rounded-lg px-3 py-2 shadow-xl">
      {label && <p className="font-medium mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="text-slate-300">{p.name}: <span className="text-white font-semibold">{p.value?.toLocaleString()}</span></p>
      ))}
    </div>
  );
}

/* ── Tabs ─────────────────────────────────────────────────── */
const TABS = [
  { id: 'overview',    label: 'Overview',    Icon: BarChart3  },
  { id: 'attendance',  label: 'Attendance',  Icon: Calendar   },
  { id: 'finance',     label: 'Finance',     Icon: Wallet     },
  { id: 'behaviour',   label: 'Behaviour',   Icon: Scale      },
];

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */
export default function ReportsPage() {
  const [tab, setTab]  = useState('overview');
  const school         = useAuthStore(s => s.session?.school);
  const sym            = school?.currencySymbol ?? 'KSh';

  /* ── Data fetches ── */
  const { data: studStats }  = useQuery({ queryKey: ['students','stats'],    queryFn: () => studentsApi.stats() });
  const { data: finSummary } = useQuery({ queryKey: ['finance','summary'],   queryFn: () => financeApi.summary({}) });
  const { data: attSummary } = useQuery({ queryKey: ['attendance','summary'],queryFn: () => attendanceApi.summary({}) });
  const { data: behSummary } = useQuery({ queryKey: ['behaviour','summary'], queryFn: () => behaviourApi.incidents.summary({}) });

  const totalStudents  = studStats?.total   ?? 0;
  const activeStudents = studStats?.active  ?? 0;
  const totalCollected = finSummary?.totalPaid       ?? 0;
  const totalInvoiced  = finSummary?.totalAmount     ?? 0;
  const outstanding    = (totalInvoiced - totalCollected) || 0;
  const collectionRate = totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 0;

  const totalMerits   = behSummary?.totalMerits   ?? 0;
  const totalDemerits = behSummary?.totalDemerits ?? 0;

  /* ── Gender breakdown for pie ── */
  const genderData = studStats?.byGender
    ? Object.entries(studStats.byGender).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }))
    : [];

  /* ── Class size bar data ── */
  const classSizeData = studStats?.byClass
    ? Object.entries(studStats.byClass).map(([name, value]) => ({ name, students: value })).sort((a, b) => b.students - a.students)
    : [];

  /* ── Finance status pie ── */
  const finStatusData = finSummary?.byStatus
    ? Object.entries(finSummary.byStatus).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
      }))
    : [
        { name: 'Paid',    value: finSummary?.countPaid    ?? 0 },
        { name: 'Partial', value: finSummary?.countPartial ?? 0 },
        { name: 'Unpaid',  value: finSummary?.countUnpaid  ?? 0 },
      ];

  /* ── Export handler ── */
  function exportCSV(type) {
    let rows = [];
    let filename = `msingi_report_${type}_${new Date().toISOString().slice(0,10)}.csv`;

    if (type === 'students' && studStats?.byClass) {
      rows = [['Class','Students'], ...Object.entries(studStats.byClass)];
    } else if (type === 'finance' && finSummary) {
      rows = [
        ['Metric','Value'],
        ['Total Invoiced', totalInvoiced],
        ['Total Collected', totalCollected],
        ['Outstanding', outstanding],
        ['Collection Rate %', collectionRate],
      ];
    }

    const csv  = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
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
          onClick={() => exportCSV('students')}
          className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
        >
          <Download size={14} /> Export
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
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
            <Stat label="Total Students"     value={totalStudents.toLocaleString()} sub={`${activeStudents} active`} Icon={Users}    color="violet" />
            <Stat label="Fee Collection"     value={`${collectionRate}%`}           sub={`${sym} ${totalCollected.toLocaleString()} collected`} Icon={Wallet}   color="green"  />
            <Stat label="Outstanding Fees"   value={`${sym} ${outstanding.toLocaleString()}`} sub="current term" Icon={AlertCircle} color="amber"  />
            <Stat label="Behaviour Merits"   value={totalMerits.toLocaleString()}   sub={`${totalDemerits} demerits`} Icon={Scale}    color="blue"   />
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
            <Stat label="Avg Daily Attendance" value={attSummary?.avgRate != null ? `${Math.round(attSummary.avgRate * 100)}%` : '—'} Icon={Calendar} color="green" />
            <Stat label="Days Recorded"  value={attSummary?.daysRecorded ?? '—'} Icon={Calendar} color="blue"   />
            <Stat label="Chronic Absent" value={attSummary?.chronicAbsent ?? '—'} sub="< 80% attendance" Icon={AlertCircle} color="red" />
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
            <Stat label="Total Invoiced"   value={`${sym} ${totalInvoiced.toLocaleString()}`}   Icon={Wallet} color="violet" />
            <Stat label="Total Collected"  value={`${sym} ${totalCollected.toLocaleString()}`}  Icon={Wallet} color="green"  />
            <Stat label="Outstanding"      value={`${sym} ${outstanding.toLocaleString()}`}     Icon={AlertCircle} color="amber" />
            <Stat label="Collection Rate"  value={`${collectionRate}%`}                          Icon={TrendingUp} color="blue" />
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
            <Stat label="Total Merits"   value={totalMerits.toLocaleString()}   Icon={Scale}  color="green"  />
            <Stat label="Total Demerits" value={totalDemerits.toLocaleString()} Icon={Scale}  color="red"    />
            <Stat label="Incidents This Term" value={(totalMerits + totalDemerits).toLocaleString()} Icon={BarChart3} color="blue" />
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
    </div>
  );
}
