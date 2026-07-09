import DashboardMockup from '@/components/landing/DashboardMockup';
import { Users, Calendar, DollarSign, Bell } from 'lucide-react';

/* ── Tablet content — a simplified, tablet-native view, not a shrunk
   desktop layout (which would be illegible at this size). ─────────── */
function TabletScreen() {
  const CARDS = [
    { label: 'Students',   value: '1,247', Icon: Users,      bg: 'bg-indigo-50',  accent: 'text-indigo-600'  },
    { label: 'Attendance', value: '94.2%', Icon: Calendar,   bg: 'bg-emerald-50', accent: 'text-emerald-600' },
    { label: 'Fees',       value: '78%',   Icon: DollarSign, bg: 'bg-amber-50',   accent: 'text-amber-600'   },
  ];
  return (
    <div className="w-full h-full bg-slate-50 flex flex-col">
      <div className="bg-white border-b border-slate-100 px-3.5 py-2.5 flex items-center justify-between flex-shrink-0">
        <div>
          <p className="text-[7px] text-slate-400 font-medium uppercase tracking-wide">Msingi International</p>
          <p className="text-[11px] font-semibold text-slate-800">Dashboard</p>
        </div>
        <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center">
          <Bell size={10} className="text-white" />
        </div>
      </div>
      <div className="p-3 flex flex-col gap-2">
        {CARDS.map(({ label, value, Icon, bg, accent }) => (
          <div key={label} className="bg-white rounded-lg p-2.5 border border-slate-100 shadow-sm flex items-center gap-2.5">
            <div className={`w-7 h-7 rounded-lg ${bg} ${accent} flex items-center justify-center flex-shrink-0`}>
              <Icon size={13} />
            </div>
            <div className="min-w-0">
              <p className="text-[7px] text-slate-400 font-medium leading-tight">{label}</p>
              <p className="text-[13px] font-bold text-slate-800 leading-tight">{value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Angled laptop + tablet composition ──────────────────────────────
   Pure CSS 3D transforms — no external image assets, so no licensing
   question. Both devices tilt as single rigid units (perspective +
   rotateY/rotateX on the outer frame), matching the common "product
   mockup" convention without needing photorealistic modelling.       */
export default function DeviceMockup() {
  return (
    <div className="relative w-full" style={{ perspective: '2200px' }}>
      {/* Laptop */}
      <div
        className="relative"
        style={{ transform: 'rotateY(-11deg) rotateX(3deg)' }}
      >
        {/* Screen bezel */}
        <div className="rounded-[14px] bg-slate-950 p-2.5 shadow-2xl shadow-black/50">
          <div className="rounded-[4px] overflow-hidden" style={{ transform: 'scale(0.82)', transformOrigin: 'top left', width: '122%' }}>
            <DashboardMockup />
          </div>
        </div>
        {/* Keyboard deck */}
        <div className="mx-3 h-4 bg-gradient-to-b from-slate-300 to-slate-400 rounded-b-xl shadow-lg" />
        <div className="mx-auto w-20 h-1.5 bg-slate-500/60 rounded-b-md" />
      </div>

      {/* Tablet — overlapping, front-left, distinct angle */}
      <div
        className="absolute -bottom-6 -left-10 w-40 sm:w-48 hidden sm:block"
        style={{ transform: 'rotateY(-18deg) rotateX(5deg) rotateZ(-2deg)' }}
      >
        <div className="rounded-[16px] bg-slate-950 p-1.5 shadow-2xl shadow-black/50 aspect-[3/4]">
          <div className="rounded-[10px] overflow-hidden w-full h-full">
            <TabletScreen />
          </div>
        </div>
      </div>
    </div>
  );
}
