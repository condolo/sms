const FEE_ROWS = [
  { name: 'J. Kamau', cls: 'Year 7A', sub: 'KSh 24,500 · M-Pesa QKL78F2B · 2 May · Receipt #3847',  status: '✓ Cleared', badge: 'bg-emerald-50 text-emerald-700' },
  { name: 'A. Osei',  cls: 'Year 8B', sub: 'KSh 18,000 paid · Balance KSh 6,500 due 30 May',          status: 'Partial',   badge: 'bg-amber-50 text-amber-700'    },
  { name: 'M. Ndege', cls: 'Year 9A', sub: 'KSh 0 received · 45 days overdue · SMS reminder sent',    status: 'Overdue',   badge: 'bg-red-50 text-red-600'         },
  { name: 'P. Liu',   cls: 'Year 7B', sub: 'KSh 24,500 · M-Pesa QKL90R7P · 8 May · Receipt #3851',   status: '✓ Cleared', badge: 'bg-emerald-50 text-emerald-700' },
];

export default function FeeRegisterMockup() {
  return (
    <div className="rounded-2xl overflow-hidden border border-slate-200/80 shadow-2xl shadow-slate-900/10 bg-white select-none pointer-events-none">
      <div className="bg-slate-900 px-4 py-3 flex items-center gap-3">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
          <div className="w-3 h-3 rounded-full bg-green-400/80" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="bg-slate-800 rounded-md px-5 py-1 text-xs text-slate-400 font-mono tracking-tight">
            app.msingi.io / finance / term-3-register
          </div>
        </div>
        <div className="w-[52px]" />
      </div>

      <div className="px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-medium mb-0.5">Greenwood Academy</p>
            <p className="text-sm font-semibold text-slate-900">Term 3 Fee Register</p>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">Live</span>
        </div>
        <div className="flex items-center gap-3 mt-2">
          <div className="flex-1 bg-slate-100 rounded-full h-2">
            <div className="bg-indigo-500 h-2 rounded-full" style={{ width: '78%' }} />
          </div>
          <span className="text-[11px] font-bold text-slate-700 shrink-0">78%</span>
        </div>
        <div className="flex gap-4 mt-1.5">
          <span className="text-[10px] text-slate-500">KSh 2.41M collected of 3.10M</span>
          <span className="text-[10px] text-slate-400">23 outstanding · 4 overdue</span>
        </div>
      </div>

      <div className="p-4 space-y-1.5">
        {FEE_ROWS.map(({ name, cls, sub, status, badge }) => (
          <div key={name} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-50/80">
            <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center shrink-0">
              {name[0]}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-semibold text-slate-800">{name} · {cls}</p>
              <p className="text-[10px] text-slate-400 truncate">{sub}</p>
            </div>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${badge}`}>{status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
