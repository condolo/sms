/* ============================================================
   OverviewTab — BPS dashboard: stats, stage alerts,
   milestone achievers, serious incidents, stage reference
   ============================================================ */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Scale, CheckCircle2, Flag, Award, Star, ShieldAlert,
} from 'lucide-react';
import {
  STAGES, meritTotal, demeritTotal, studentStage, studentMilestone, matrixLabel,
} from '../bpsConstants.js';
import { behaviour as behaviourApi, students as studentsApi } from '@/api/client.js';
import { StageBadge, MilestoneBadge, StatCard } from './BehaviourPrimitives.jsx';

export default function OverviewTab() {
  const { data: incData, isLoading } = useQuery({
    queryKey: ['behaviour', 'incidents', 'all'],
    queryFn:  () => behaviourApi.incidents.list({ limit: 1000 }),
    staleTime: 2 * 60_000,
  });
  const { data: stuData } = useQuery({
    queryKey: ['students', 'list', { limit: 500 }],
    queryFn:  () => studentsApi.list({ limit: 500, status: 'active' }),
    staleTime: 5 * 60_000,
  });

  const allLogs  = incData?.data ?? [];
  const students = stuData?.data ?? [];

  const totalMerits   = allLogs.filter(l => l.type === 'merit').reduce((s, l) => s + (l.points ?? 0), 0);
  const totalDemerits = Math.abs(allLogs.filter(l => l.type === 'demerit').reduce((s, l) => s + (l.points ?? 0), 0));
  const totalEvents   = allLogs.length;

  const stageAlerts = useMemo(() => (
    students
      .map(s => ({ s, stage: studentStage(allLogs, s.id ?? s._id) }))
      .filter(x => x.stage)
      .sort((a, b) => b.stage.stage - a.stage.stage)
  ), [allLogs, students]);

  const milestoneStudents = useMemo(() => (
    students
      .map(s => ({ s, ms: studentMilestone(allLogs, s.id ?? s._id), total: meritTotal(allLogs, s.id ?? s._id) }))
      .filter(x => x.ms)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8)
  ), [allLogs, students]);

  const seriousLogs = allLogs
    .filter(l => l.type === 'demerit' && Math.abs(l.points ?? 0) >= 5)
    .sort((a, b) => new Date(b.date ?? b.createdAt) - new Date(a.date ?? a.createdAt))
    .slice(0, 8);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-5">
      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Merits/demerits keep semantic green/red; neutral cards use school theme */}
        <StatCard icon={<TrendingUp size={18} className="text-emerald-600" />}  label="Total Merits"    value={`+${totalMerits}`}  valueColor="text-emerald-600" bg="bg-emerald-50" />
        <StatCard icon={<TrendingDown size={18} className="text-red-600" />}    label="Total Demerits"  value={`-${totalDemerits}`} valueColor="text-red-600"    bg="bg-red-50" />
        <StatCard icon={<Scale size={18} />}  label="Total Events"    value={totalEvents}      colorIndex={0} />
        <StatCard icon={<Flag  size={18} />}  label="On Intervention" value={stageAlerts.length} colorIndex={1} />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Stage alerts */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Flag size={14} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-800">Intervention Alerts</h3>
            <span className="ml-auto text-xs text-slate-400">90-day rolling window</span>
          </div>
          {isLoading ? (
            <div className="p-6 space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}</div>
          ) : stageAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <CheckCircle2 size={28} className="mb-2 opacity-40 text-emerald-400" />
              <p className="text-sm text-slate-500">No students on intervention</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {stageAlerts.map(({ s, stage }) => {
                const sid = s.id ?? s._id;
                const d   = demeritTotal(allLogs, sid);
                return (
                  <div key={sid} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: stage.color }}>
                        {s.firstName?.[0] ?? '?'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-800">{s.firstName} {s.lastName}</p>
                        <p className="text-xs text-slate-400">{s.className ?? s.grade ?? '—'} · {d} demerit pts</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <StageBadge stage={stage} compact />
                      <p className="text-[10px] text-slate-400">{stage.who}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Milestone achievers */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Award size={14} className="text-violet-500" />
            <h3 className="text-sm font-semibold text-slate-800">Milestone Achievers</h3>
          </div>
          {milestoneStudents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Star size={28} className="mb-2 opacity-40" />
              <p className="text-sm text-slate-500">No milestones reached yet</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {milestoneStudents.map(({ s, ms, total }) => (
                <div key={s.id ?? s._id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 text-xs font-bold">
                      {s.firstName?.[0] ?? '?'}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{s.firstName} {s.lastName}</p>
                      <p className="text-xs text-slate-400">{s.className ?? '—'}</p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <MilestoneBadge milestone={ms} />
                    <p className="text-xs font-semibold text-emerald-600">+{total} pts</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Serious incidents */}
      {seriousLogs.length > 0 && (
        <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-red-100 flex items-center gap-2 bg-red-50">
            <ShieldAlert size={14} className="text-red-500" />
            <h3 className="text-sm font-semibold text-red-800">Serious Incidents (|pts| ≥ 5)</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {seriousLogs.map(log => (
              <div key={log._id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">{log.studentName ?? log.studentId}</p>
                  <p className="text-xs text-slate-500 truncate">{log.description ?? matrixLabel(log.behaviourId) ?? log.category}</p>
                  {log.note && <p className="text-xs text-slate-400 italic truncate">{log.note}</p>}
                </div>
                <div className="flex flex-col items-end ml-4 shrink-0">
                  <span className="font-bold text-red-600 text-sm">{log.points}</span>
                  <span className="text-xs text-slate-400">{log.date ? new Date(log.date).toLocaleDateString('en-GB') : '—'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stage reference */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3">Intervention Stage Reference</h3>
        <div className="space-y-2">
          {STAGES.map(s => (
            <div key={s.stage} className="flex items-center gap-3 text-xs" style={{ color: s.color }}>
              <span className="font-bold w-16 shrink-0">Stage {s.stage}</span>
              <span className="text-slate-400 w-10 shrink-0">≥{s.pts} pts</span>
              <span className="font-medium flex-1 truncate">{s.label}</span>
              <span className="text-slate-400 shrink-0">{s.who}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-slate-400 mt-3">Demerit accumulation measured over a rolling 90-day window.</p>
      </div>
    </motion.div>
  );
}
