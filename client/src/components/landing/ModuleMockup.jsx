import { motion } from 'framer-motion';
import { STATUS_DOT, STATUS_LABEL } from '@/data/landingData';

export default function ModuleMockup({ mockup, color }) {
  const { type, rows = [], headers = [], periods = [], items = [] } = mockup;

  const baseCell = 'text-[10px] text-slate-300 truncate';
  const headCell = 'text-[9px] font-semibold uppercase tracking-wider text-slate-500';
  const chromeDots = (
    <div className={`${color} px-3 py-1.5 flex items-center gap-1.5`}>
      <div className="w-1.5 h-1.5 rounded-full bg-white/40" />
      <div className="w-1.5 h-1.5 rounded-full bg-white/40" />
      <div className="w-1.5 h-1.5 rounded-full bg-white/40" />
    </div>
  );

  if (type === 'list') return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
      {chromeDots}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-slate-800">
            {headers.map(h => <th key={h} className={`${headCell} px-3 py-2 text-left`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-800/60 last:border-0">
              {row.map((cell, j) => <td key={j} className={`${baseCell} px-3 py-2`}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  if (type === 'pipeline') return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
      {chromeDots}
      <div className="p-3 space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span className="text-[10px] text-slate-400 w-24 shrink-0">{row.stage}</span>
            <div className="flex-1 h-4 bg-slate-800 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${(row.count / rows[0].count) * 100}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                className={`h-full ${row.color} rounded-full`}
              />
            </div>
            <span className="text-[10px] text-slate-400 w-4 text-right">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (type === 'register') return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
      {chromeDots}
      <div className="divide-y divide-slate-800/60">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2.5 px-3 py-2">
            <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[row.status] || 'bg-slate-500'}`} />
            <span className="text-[10px] text-slate-300 flex-1 truncate">{row.name}</span>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
              row.status === 'present' ? 'bg-emerald-900/60 text-emerald-400' :
              row.status === 'absent'  ? 'bg-red-900/60 text-red-400' :
              'bg-amber-900/60 text-amber-400'
            }`}>{STATUS_LABEL[row.status]}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (type === 'coverage') return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
      {chromeDots}
      <div className="p-3 space-y-3">
        {rows.map((row, i) => (
          <div key={i}>
            <div className="flex justify-between mb-1">
              <span className="text-[10px] text-slate-300">{row.subject}</span>
              <span className="text-[10px] font-bold text-slate-400">{row.pct}%</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                whileInView={{ width: `${row.pct}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, delay: i * 0.1 }}
                className={`h-full rounded-full ${row.pct >= 80 ? 'bg-emerald-500' : row.pct >= 60 ? 'bg-amber-400' : 'bg-blue-400'}`}
              />
            </div>
            <p className="text-[9px] text-slate-600 mt-0.5">{row.covered} / {row.total} topics</p>
          </div>
        ))}
      </div>
    </div>
  );

  if (type === 'ledger') return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
      {chromeDots}
      <div className="divide-y divide-slate-800/60">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2 px-3 py-2">
            <span className="text-[10px] text-slate-300 flex-1 truncate">{row.name}</span>
            <span className="text-[10px] text-slate-400 font-mono">KSh {row.amount}</span>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
              row.status === 'paid'    ? 'bg-emerald-900/60 text-emerald-400' :
              row.status === 'partial' ? 'bg-amber-900/60 text-amber-400' :
              'bg-red-900/60 text-red-400'
            }`}>{STATUS_LABEL[row.status]}</span>
          </div>
        ))}
      </div>
    </div>
  );

  if (type === 'timetable') return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
      {chromeDots}
      <div className="p-3">
        <div className="grid grid-cols-5 gap-1 mb-1">
          {['', 'Mon', 'Tue', 'Wed', 'Thu'].map(d => (
            <div key={d} className="text-[9px] font-semibold text-slate-500 text-center">{d}</div>
          ))}
        </div>
        {periods.map((row, ri) => (
          <div key={ri} className="grid grid-cols-5 gap-1 mb-1">
            <div className="text-[9px] text-slate-500 flex items-center">{row.time}</div>
            {row.subjects.map((s, si) => (
              <div key={si} className="bg-slate-800 rounded px-1 py-1 text-[9px] text-slate-300 text-center truncate">{s}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );

  if (type === 'stats') return (
    <div className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
      {chromeDots}
      <div className="grid grid-cols-2 gap-2 p-3">
        {items.map((item, i) => (
          <div key={i} className="bg-slate-800 rounded-lg p-2.5">
            <p className="text-[9px] text-slate-500 uppercase tracking-wide mb-1">{item.label}</p>
            <p className="text-sm font-bold text-white">{item.value}</p>
            <p className={`text-[9px] font-semibold mt-0.5 ${item.up ? 'text-emerald-400' : 'text-red-400'}`}>{item.trend}</p>
          </div>
        ))}
      </div>
    </div>
  );

  return null;
}
