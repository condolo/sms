import {
  Activity, Calendar, DollarSign, FileText,
  MessageSquare, GraduationCap, Layers, UserCheck,
  Users, TrendingUp, CheckCircle,
} from 'lucide-react';

const SIDEBAR_NAV = [
  { Icon: Activity,      label: 'Dashboard',  active: true  },
  { Icon: Users,         label: 'Students'   },
  { Icon: GraduationCap, label: 'Academics'  },
  { Icon: Calendar,      label: 'Timetable'  },
  { Icon: Layers,        label: 'Subjects'   },
  { Icon: DollarSign,    label: 'Finance'    },
  { Icon: FileText,      label: 'Reports'    },
  { Icon: MessageSquare, label: 'Messages'   },
];

const KPI_CARDS = [
  { label: 'Total Students',    value: '1,247', delta: '+23 this term',        Icon: Users,      accent: 'text-indigo-600',  bg: 'bg-indigo-50',  bar: 'bg-indigo-500',  pct: 78 },
  { label: 'Avg. Attendance',   value: '94.2%', delta: '↑ 2.1% vs last term', Icon: Calendar,   accent: 'text-emerald-600', bg: 'bg-emerald-50', bar: 'bg-emerald-500', pct: 94 },
  { label: 'Fee Collection',    value: '78%',   delta: 'KSh 2.41M of 3.10M',  Icon: DollarSign, accent: 'text-amber-600',   bg: 'bg-amber-50',   bar: 'bg-amber-500',   pct: 78 },
  { label: 'Reports Published', value: '3 of 4', delta: '1 pending approval', Icon: FileText,   accent: 'text-violet-600',  bg: 'bg-violet-50',  bar: 'bg-violet-500',  pct: 75 },
];

const YEAR_BARS  = [
  { label: 'Year 7',  pct: 87 },
  { label: 'Year 8',  pct: 79 },
  { label: 'Year 9',  pct: 72 },
  { label: 'Year 10', pct: 81 },
  { label: 'Year 11', pct: 76 },
];

const ACTIVITY_FEED = [
  { Icon: CheckCircle, accent: 'text-emerald-500', bg: 'bg-emerald-50', text: 'Year 8 reports published', sub: '28 reports · Term 2',      time: '4m ago'  },
  { Icon: DollarSign,  accent: 'text-indigo-500',  bg: 'bg-indigo-50',  text: 'M-Pesa payment received',  sub: 'J. Kamau · KSh 18,500',    time: '12m ago' },
  { Icon: UserCheck,   accent: 'text-violet-500',  bg: 'bg-violet-50',  text: 'New admission enrolled',   sub: 'A. Osei — Year 7A',        time: '1h ago'  },
  { Icon: TrendingUp,  accent: 'text-sky-500',     bg: 'bg-sky-50',     text: 'Attendance alert resolved', sub: 'Class 9B improved → 91%', time: '2h ago'  },
];

const BAR_COLORS = ['bg-indigo-500', 'bg-violet-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500'];

export default function DashboardMockup() {
  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200/80 shadow-2xl shadow-slate-900/12 bg-white select-none pointer-events-none">
      {/* Browser chrome */}
      <div className="bg-slate-900 px-4 py-2.5 flex items-center gap-3">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400/80" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="bg-slate-800 rounded-md px-5 py-1 text-[10px] text-slate-400 font-mono tracking-tight flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
            app.msingi.io / dashboard
          </div>
        </div>
        <div className="w-[52px]" />
      </div>

      <div className="flex" style={{ height: '460px' }}>
        {/* Sidebar */}
        <div className="w-[54px] bg-slate-900 flex flex-col items-center py-4 gap-1 flex-shrink-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold mb-3 shadow-lg shadow-indigo-900/50">M</div>
          {SIDEBAR_NAV.map(({ Icon, label, active }) => (
            <div key={label} title={label}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                active ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/40' : 'text-slate-600 hover:text-slate-400'
              }`}>
              <Icon size={15} />
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 bg-slate-50 flex flex-col overflow-hidden">
          {/* Top bar */}
          <div className="bg-white border-b border-slate-100 px-5 py-2.5 flex items-center justify-between flex-shrink-0">
            <div>
              <p className="text-[10px] text-slate-400 font-medium tracking-wide uppercase">Mascit Lab Academy</p>
              <p className="text-sm font-semibold text-slate-800">Dashboard</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-100 rounded-full px-2.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
                <span className="text-[10px] text-emerald-700 font-semibold">Live</span>
              </div>
              <span className="text-[10px] text-slate-400 bg-slate-100 rounded-lg px-2 py-1 font-medium">Term 2 · 2025–26</span>
              <div className="w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">PM</div>
            </div>
          </div>

          <div className="flex-1 p-4 overflow-hidden flex flex-col gap-3">
            {/* Welcome banner */}
            <div className="rounded-xl bg-gradient-to-r from-indigo-600 via-indigo-600 to-violet-600 p-3 flex items-center justify-between flex-shrink-0 shadow-md shadow-indigo-500/20">
              <div>
                <p className="text-[10px] font-medium text-indigo-200 mb-0.5">Good morning, Principal Mwangi</p>
                <p className="text-xs font-bold text-white">Term 2 — Week 8 of 13</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] text-indigo-300">Next school event</p>
                <p className="text-[11px] font-semibold text-white">Parent Day · Sat 21 Jun</p>
              </div>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-4 gap-2 flex-shrink-0">
              {KPI_CARDS.map(({ label, value, delta, Icon, accent, bg, bar, pct }) => (
                <div key={label} className="bg-white rounded-xl p-3 border border-slate-100 shadow-sm">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[9px] text-slate-400 font-medium leading-tight">{label}</span>
                    <div className={`w-5 h-5 rounded-md ${bg} ${accent} flex items-center justify-center flex-shrink-0`}><Icon size={10} /></div>
                  </div>
                  <p className="text-sm font-bold text-slate-800 leading-none mb-1">{value}</p>
                  <p className="text-[9px] text-slate-400 mb-1.5">{delta}</p>
                  <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${bar} rounded-full`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Charts row */}
            <div className="grid grid-cols-3 gap-2.5 flex-1 min-h-0">
              {/* Academic performance */}
              <div className="col-span-2 bg-white rounded-xl p-3.5 border border-slate-100 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-2.5 flex-shrink-0">
                  <div>
                    <p className="text-[9px] text-slate-400 font-medium uppercase tracking-widest mb-0.5">Academic Performance</p>
                    <p className="text-[11px] font-semibold text-slate-800">Year Group Summary · Term 2</p>
                  </div>
                  <span className="text-[9px] text-indigo-600 font-semibold bg-indigo-50 px-2 py-0.5 rounded-full">View report →</span>
                </div>
                <div className="space-y-2 flex-1">
                  {YEAR_BARS.map(({ label, pct }, i) => (
                    <div key={label} className="flex items-center gap-2.5">
                      <span className="text-[9px] text-slate-500 w-12 font-medium flex-shrink-0">{label}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                        <div className={`${BAR_COLORS[i % BAR_COLORS.length]} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[9px] font-bold text-slate-600 w-7 text-right flex-shrink-0">{pct}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Activity feed */}
              <div className="bg-white rounded-xl p-3.5 border border-slate-100 shadow-sm flex flex-col">
                <div className="flex items-center justify-between mb-2.5 flex-shrink-0">
                  <p className="text-[11px] font-semibold text-slate-800">Live Activity</p>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <div className="space-y-2.5 flex-1">
                  {ACTIVITY_FEED.map(({ Icon, accent, bg, text, sub, time }, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className={`w-5 h-5 rounded-lg ${bg} ${accent} flex items-center justify-center flex-shrink-0 mt-0.5`}><Icon size={9} /></div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-semibold text-slate-700 truncate leading-tight">{text}</p>
                        <p className="text-[9px] text-slate-400 truncate">{sub}</p>
                      </div>
                      <span className="text-[8px] text-slate-300 flex-shrink-0 mt-0.5">{time}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
