import { CheckCircle } from 'lucide-react';

const REPORT_STAGES = [
  { stage: 'Grade Submission', person: 'Mr. Kariuki',    status: 'Complete', date: '14 May 16:04', ok: true  },
  { stage: 'HOD Review',       person: 'Mrs. Wanjiku',   status: 'Approved', date: '15 May 09:30', ok: true  },
  { stage: 'Moderation',       person: 'Deputy Ochieng', status: 'Passed',   date: '16 May 14:45', ok: true  },
  { stage: 'Principal Sign',   person: 'Dr. Mwangi',     status: 'Pending',  date: '— awaiting',   ok: false },
  { stage: 'Parent Portal',    person: '28 families',    status: 'Locked',   date: '— blocked',    ok: false },
];

const AUDIT_TRAIL = [
  'Grade submission locked by Mr. Kariuki · 14 May 16:04',
  'HOD Mrs. Wanjiku reviewed all 28 reports · 15 May 09:30',
  'Deputy Ochieng moderated 2 flagged grades · 16 May 14:45',
];

export default function ReportGovernanceMockup() {
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
            app.msingi.io / reports / year-8 / term-2
          </div>
        </div>
        <div className="w-[52px]" />
      </div>

      <div className="px-5 pt-4 pb-3 border-b border-slate-100 flex items-start justify-between">
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-medium mb-0.5">Greenwood Academy · Year 8</p>
          <p className="text-sm font-semibold text-slate-900">Report Cards · Term 2 · 2025–26</p>
          <p className="text-[10px] text-slate-400 mt-0.5">28 reports · 9 subjects · Initiated 14 May · Target publish: 23 May</p>
        </div>
        <span className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold shrink-0">3 / 5 Done</span>
      </div>

      <div className="p-4">
        <div className="space-y-1.5">
          {REPORT_STAGES.map(({ stage, person, status, date, ok }) => (
            <div key={stage} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg ${ok ? 'bg-emerald-50/60' : 'bg-slate-50'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${ok ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                {ok
                  ? <CheckCircle size={11} className="text-white" />
                  : <div className="w-2 h-2 rounded-full bg-slate-400" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-slate-800">{stage}</p>
                <p className="text-[10px] text-slate-400">{person}</p>
              </div>
              <div className="text-right shrink-0">
                <p className={`text-[10px] font-semibold ${ok ? 'text-emerald-700' : 'text-slate-400'}`}>{status}</p>
                <p className="text-[9px] text-slate-300">{date}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-[10px] text-slate-400 uppercase tracking-widest font-medium mb-2">Audit Trail</p>
          {AUDIT_TRAIL.map((e, i) => (
            <div key={i} className="flex items-start gap-2 mb-1.5">
              <div className="w-1 h-1 rounded-full bg-slate-300 mt-1.5 shrink-0" />
              <p className="text-[10px] text-slate-500">{e}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
