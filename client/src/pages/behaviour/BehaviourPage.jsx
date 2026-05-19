/* ============================================================
   Behaviour — Full BPS Workflow
   /platform-audit: Borrowed from SAA BPS v2:
   • Categorised matrix with locked point values
   • 4-step award wizard (student → type → behaviour → confirm)
   • Intervention stages (90-day rolling demerit accumulation)
   • Merit milestones (all-time cumulative)
   • Appeals: submit → freeze → review → overturn/keep
   School-agnostic: no houses, no KS labels
   ============================================================ */
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Scale, Star, ShieldAlert, TrendingUp, TrendingDown,
  Send, Tag, Plus, X, Loader2, CheckCircle2, AlertTriangle,
  Search, ChevronLeft, ChevronRight, Check, XCircle,
  BarChart3, Flag, BookOpen, Award, Users,
} from 'lucide-react';
import {
  MATRIX, STAGES, MILESTONES,
  meritTotal, demeritTotal, studentStage, studentMilestone, nextMilestone,
  matrixLabel, isSerious,
} from './bpsConstants.js';
import { behaviour as behaviourApi, students as studentsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

const LIMIT = 20;

/* ── Stage badge ─────────────────────────────────────────────── */
function StageBadge({ stage, compact = false }) {
  if (!stage) return null;
  return (
    <span
      style={{ background: stage.color }}
      className={`inline-flex items-center text-white font-bold ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-1'} rounded-full`}
    >
      S{stage.stage}{!compact && ` — ${stage.label.split('—')[1]?.trim()}`}
    </span>
  );
}

/* ── Milestone badge ─────────────────────────────────────────── */
const MS_ICONS = { Bronze: '🥉', Silver: '🥈', Gold: '🥇', "Principal's Award": '🏅', Platinum: '🏆' };
function MilestoneBadge({ milestone, compact = false }) {
  if (!milestone) return null;
  const icon = MS_ICONS[milestone.badge] ?? '⭐';
  return (
    <span
      style={{ color: milestone.color, borderColor: milestone.ring }}
      className={`inline-flex items-center gap-1 border font-semibold ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2.5 py-1'} rounded-full bg-white`}
    >
      {icon}{!compact && ` ${milestone.badge}`}
    </span>
  );
}

/* ── Type badge ──────────────────────────────────────────────── */
function TypeBadge({ type }) {
  if (type === 'merit') return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
      <TrendingUp size={10} />Merit
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200">
      <TrendingDown size={10} />Demerit
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════ */
export default function BehaviourPage() {
  const [tab, setTab] = useState('overview');
  const can  = useAuthStore(s => s.can.bind(s));
  const role = useAuthStore(s => s.session?.user?.role ?? '');
  const isAdmin = role === 'admin' || role === 'superadmin';

  const TABS = [
    { id: 'overview',    label: 'Overview',    icon: BarChart3  },
    { id: 'award',       label: 'Award Points', icon: Star       },
    { id: 'incidents',   label: 'Incidents',    icon: Scale      },
    { id: 'appeals',     label: 'Appeals',      icon: Send       },
    ...(isAdmin ? [{ id: 'categories', label: 'Categories', icon: Tag }] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-xl mx-auto">
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Behaviour Points</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Behaviour Point System — merit awards, demerit logging, intervention stages, and appeals
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-screen-xl mx-auto flex gap-0 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-5">
        <AnimatePresence mode="wait">
          {tab === 'overview'    && <OverviewTab    key="overview"    />}
          {tab === 'award'       && <AwardTab       key="award"       />}
          {tab === 'incidents'   && <IncidentsTab   key="incidents"   />}
          {tab === 'appeals'     && <AppealsTab     key="appeals"     />}
          {tab === 'categories'  && <CategoriesTab  key="categories"  />}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ── Overview Tab ────────────────────────────────────────────── */
function OverviewTab() {
  /* Load recent incidents for stage/milestone calculation */
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

  /* Aggregate stats */
  const totalMerits   = allLogs.filter(l => l.type === 'merit').reduce((s, l) => s + (l.points ?? 0), 0);
  const totalDemerits = Math.abs(allLogs.filter(l => l.type === 'demerit').reduce((s, l) => s + (l.points ?? 0), 0));
  const totalEvents   = allLogs.length;

  /* Stage alerts — compute per student */
  const stageAlerts = useMemo(() => {
    return students
      .map(s => ({ s, stage: studentStage(allLogs, s._id ?? s.id) }))
      .filter(x => x.stage)
      .sort((a, b) => b.stage.stage - a.stage.stage);
  }, [allLogs, students]);

  /* Milestone achievers */
  const milestoneStudents = useMemo(() => {
    return students
      .map(s => ({ s, ms: studentMilestone(allLogs, s._id ?? s.id), total: meritTotal(allLogs, s._id ?? s.id) }))
      .filter(x => x.ms)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [allLogs, students]);

  /* Recent serious incidents */
  const seriousLogs = allLogs
    .filter(l => l.type === 'demerit' && Math.abs(l.points ?? 0) >= 5)
    .sort((a, b) => new Date(b.date ?? b.createdAt) - new Date(a.date ?? a.createdAt))
    .slice(0, 8);

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-5">
      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={<TrendingUp size={18} className="text-emerald-600" />} label="Total Merits"   value={`+${totalMerits}`}   valueColor="text-emerald-600" bg="bg-emerald-50" />
        <StatCard icon={<TrendingDown size={18} className="text-red-600" />}   label="Total Demerits" value={`-${totalDemerits}`}  valueColor="text-red-600"     bg="bg-red-50" />
        <StatCard icon={<Scale size={18} className="text-slate-600" />}        label="Total Events"   value={totalEvents}           valueColor="text-slate-800"   bg="bg-slate-100" />
        <StatCard icon={<Flag size={18} className="text-amber-600" />}         label="On Intervention"value={stageAlerts.length}    valueColor="text-amber-700"   bg="bg-amber-50" />
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
                const sid = s._id ?? s.id;
                const d   = demeritTotal(allLogs, sid);
                return (
                  <div key={sid} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: stage.color }}>
                        {(s.firstName?.[0] ?? '?')}
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
                <div key={s._id ?? s.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
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

/* ── Award Tab — 4-Step Wizard ───────────────────────────────── */
function AwardTab() {
  const qc = useQueryClient();
  const user = useAuthStore(s => s.session?.user);

  const [step, setStep]     = useState(1);
  const [sid, setSid]       = useState('');
  const [sName, setSName]   = useState('');
  const [type, setType]     = useState('');       // 'merit' | 'demerit'
  const [catIdx, setCatIdx] = useState(0);
  const [item, setItem]     = useState(null);     // matrix item
  const [note, setNote]     = useState('');
  const [stuSearch, setStuSearch] = useState('');
  const [toast, setToast]   = useState(null);

  /* Student search */
  const { data: stuData } = useQuery({
    queryKey: ['students', 'search', stuSearch],
    queryFn:  () => studentsApi.list({ search: stuSearch, limit: 12, status: 'active' }),
    enabled:  stuSearch.length >= 2,
    staleTime: 30_000,
  });
  const stuResults = stuData?.data ?? [];

  /* Student's existing incidents (for stage/milestone preview) */
  const { data: stuIncData } = useQuery({
    queryKey: ['behaviour', 'incidents', 'student', sid],
    queryFn:  () => behaviourApi.incidents.list({ studentId: sid, limit: 500 }),
    enabled:  !!sid,
    staleTime: 60_000,
  });
  const stuLogs = stuIncData?.data ?? [];

  /* Computed state for preview */
  const currentMerits  = meritTotal(stuLogs, sid);
  const currentDemerit = demeritTotal(stuLogs, sid);
  const currentStage   = studentStage(stuLogs, sid);
  const currentMs      = studentMilestone(stuLogs, sid);
  const pts            = item ? (type === 'merit' ? item.merit : item.demerit) : null;
  const newMerits      = type === 'merit' && pts ? currentMerits + pts : currentMerits;
  const newDemerit     = type === 'demerit' && pts ? currentDemerit + Math.abs(pts) : currentDemerit;

  /* Preview: will a new stage be triggered? */
  const fakeStuLogs    = pts && type === 'demerit'
    ? [...stuLogs, { studentId: sid, type: 'demerit', points: pts, date: new Date().toISOString(), status: 'active' }]
    : stuLogs;
  const newStage       = studentStage(fakeStuLogs, sid);
  const stageTrigger   = newStage && newStage?.stage !== currentStage?.stage;

  /* Preview: will a new milestone be triggered? */
  const fakeMeritLogs  = pts && type === 'merit'
    ? [...stuLogs, { studentId: sid, type: 'merit', points: pts, date: new Date().toISOString(), status: 'active' }]
    : stuLogs;
  const newMs          = studentMilestone(fakeMeritLogs, sid);
  const msTrigger      = newMs && newMs?.badge !== currentMs?.badge;

  const nextMs         = nextMilestone(stuLogs, sid);
  const needsNote      = isSerious(pts);
  const canSubmit      = !!sid && !!type && !!item && pts !== null && (!needsNote || note.trim().length >= 10);

  const mutation = useMutation({
    mutationFn: data => behaviourApi.incidents.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['behaviour', 'incidents'] });
      setToast({ type: 'success', student: sName, pts, msTrigger, newMs, stageTrigger, newStage });
      reset();
      setTimeout(() => setToast(null), 6000);
    },
    onError: err => setToast({ type: 'error', msg: err?.message ?? 'Failed to record' }),
  });

  function reset() { setStep(1); setSid(''); setSName(''); setType(''); setCatIdx(0); setItem(null); setNote(''); setStuSearch(''); }

  function submit() {
    if (!canSubmit) return;
    mutation.mutate({
      studentId:   sid,
      type,
      category:    MATRIX[catIdx]?.category,
      description: item.label,
      points:      pts,
      severity:    Math.abs(pts) >= 10 ? 'critical' : Math.abs(pts) >= 5 ? 'high' : Math.abs(pts) >= 3 ? 'medium' : 'low',
      note:        note.trim() || undefined,
      date:        new Date().toISOString().slice(0, 10),
    });
  }

  /* Items visible for selected type in selected category */
  const catItems = (MATRIX[catIdx]?.items ?? []).filter(i =>
    type === 'merit' ? i.merit !== null : i.demerit !== null
  );

  const STEP_LABELS = ['Select Student', 'Merit or Demerit', 'Choose Behaviour', 'Confirm & Submit'];

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4 max-w-2xl">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className={`rounded-xl border px-4 py-3 text-sm font-medium flex items-start gap-3 ${
              toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
            <div>
              {toast.type === 'success' ? (
                <>
                  <span className="font-bold">{toast.student}</span>
                  {' — '}{toast.pts > 0 ? '+' : ''}{toast.pts} pts recorded.
                  {toast.msTrigger && <span className="ml-2 font-bold">{MS_ICONS[toast.newMs.badge]} Milestone: {toast.newMs.badge}!</span>}
                  {toast.stageTrigger && <span className="ml-2 font-bold text-amber-700">⚠ Stage {toast.newStage.stage} triggered.</span>}
                </>
              ) : toast.msg}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Step indicator */}
      <div className="flex gap-2">
        {STEP_LABELS.map((label, i) => {
          const done   = step > i + 1;
          const active = step === i + 1;
          return (
            <button
              key={i}
              onClick={() => step > i + 1 && setStep(i + 1)}
              className={`flex-1 text-[11px] font-semibold py-2 px-1 rounded-lg transition-all text-center ${
                active  ? 'bg-slate-900 text-white' :
                done    ? 'bg-emerald-100 text-emerald-700 cursor-pointer hover:bg-emerald-200' :
                'bg-slate-100 text-slate-400 cursor-default'
              }`}
            >
              {done ? '✓ ' : ''}{label}
            </button>
          );
        })}
      </div>

      {/* ─── Step 1: Select student ─── */}
      {step === 1 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">Who is this for?</h3>
          {sid ? (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 text-xs font-bold">{sName[0]}</div>
              <span className="flex-1 text-sm font-medium text-slate-800">{sName}</span>
              <button onClick={() => { setSid(''); setSName(''); setStuSearch(''); }} className="text-slate-400 hover:text-red-500 transition"><X size={14} /></button>
            </div>
          ) : (
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={stuSearch}
                onChange={e => setStuSearch(e.target.value)}
                placeholder="Search student by name…"
                className="w-full text-sm pl-8 pr-3 py-2.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400"
              />
            </div>
          )}
          <AnimatePresence>
            {!sid && stuSearch.length >= 2 && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                {stuResults.length === 0 ? (
                  <p className="text-center text-sm text-slate-400 py-4">No students found for "{stuSearch}"</p>
                ) : (
                  <div className="space-y-1.5 mt-1">
                    {stuResults.map(s => {
                      const id = s._id ?? s.id;
                      return (
                        <button
                          key={id}
                          onClick={() => { setSid(id); setSName(`${s.firstName} ${s.lastName}`); setStep(2); setStuSearch(''); }}
                          className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition text-left"
                        >
                          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {s.firstName?.[0] ?? '?'}
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800">{s.firstName} {s.lastName}</p>
                            {s.className && <p className="text-xs text-slate-400">{s.className}</p>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* ─── Step 2: Merit or Demerit ─── */}
      {step === 2 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <p className="text-sm text-slate-600">Recording for: <strong className="text-slate-900">{sName}</strong></p>
          {sid && stuLogs.length > 0 && (
            <div className="flex gap-3">
              <div className="flex-1 bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-emerald-600">+{currentMerits}</p>
                <p className="text-xs text-emerald-700">Merit pts (all-time)</p>
                {currentMs && <MilestoneBadge milestone={currentMs} compact />}
              </div>
              <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-red-600">-{currentDemerit}</p>
                <p className="text-xs text-red-700">Demerit pts (90 days)</p>
                {currentStage && <StageBadge stage={currentStage} compact />}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { setType('merit'); setCatIdx(0); setItem(null); setStep(3); }}
              className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-emerald-300 bg-emerald-50 hover:bg-emerald-100 transition cursor-pointer"
            >
              <TrendingUp size={28} className="text-emerald-600" />
              <span className="font-bold text-emerald-700 text-base">Merit</span>
              <span className="text-xs text-emerald-600">Reward positive behaviour</span>
            </button>
            <button
              onClick={() => { setType('demerit'); setCatIdx(0); setItem(null); setStep(3); }}
              className="flex flex-col items-center gap-2 p-5 rounded-xl border-2 border-red-300 bg-red-50 hover:bg-red-100 transition cursor-pointer"
            >
              <TrendingDown size={28} className="text-red-600" />
              <span className="font-bold text-red-700 text-base">Demerit</span>
              <span className="text-xs text-red-600">Record a concern</span>
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 3: Choose category + behaviour ─── */}
      {step === 3 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <TypeBadge type={type} />
            <span className="text-sm text-slate-500">→ <strong className="text-slate-800">{sName}</strong></span>
          </div>

          {/* Category selector */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Category</label>
            <select
              value={catIdx}
              onChange={e => { setCatIdx(+e.target.value); setItem(null); }}
              className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-800"
            >
              {MATRIX.map((cat, i) => {
                const hasItems = cat.items.some(it => type === 'merit' ? it.merit !== null : it.demerit !== null);
                return hasItems ? <option key={i} value={i}>{cat.category}</option> : null;
              })}
            </select>
          </div>

          {/* Behaviour items */}
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {catItems.map(it => {
              const p       = type === 'merit' ? it.merit : it.demerit;
              const active  = item?.id === it.id;
              return (
                <button
                  key={it.id}
                  onClick={() => { setItem(it); setNote(''); setStep(4); }}
                  className={`w-full flex items-center justify-between gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                    active
                      ? 'border-slate-800 bg-slate-50'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-sm text-slate-700 flex-1">{it.label}</span>
                  <span className={`font-bold text-sm shrink-0 ${p >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {p > 0 ? '+' : ''}{p}
                  </span>
                </button>
              );
            })}
            {catItems.length === 0 && (
              <p className="text-center text-sm text-slate-400 py-6">No {type} items in this category</p>
            )}
          </div>
        </div>
      )}

      {/* ─── Step 4: Confirm ─── */}
      {step === 4 && item && (
        <div className={`bg-white rounded-xl border-2 p-5 space-y-4 ${type === 'merit' ? 'border-emerald-300' : 'border-red-300'}`}>
          <div className="flex items-center gap-2">
            <TypeBadge type={type} />
            <span className="text-sm font-medium text-slate-700">Confirm before submitting</span>
          </div>

          {/* Summary rows */}
          <div className="space-y-2 text-sm">
            {[
              ['Student',   sName],
              ['Category',  MATRIX[catIdx]?.category],
              ['Behaviour', item.label],
            ].map(([label, value]) => (
              <div key={label} className="flex gap-3 py-1.5 border-b border-slate-100">
                <span className="text-slate-400 w-24 shrink-0">{label}</span>
                <span className="font-medium text-slate-800">{value}</span>
              </div>
            ))}
            <div className="flex gap-3 py-1.5 border-b border-slate-100">
              <span className="text-slate-400 w-24 shrink-0">Points</span>
              <span className={`font-bold text-lg ${pts >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {pts > 0 ? '+' : ''}{pts}
                <span className="text-xs text-slate-400 font-normal ml-2">(locked — cannot be edited)</span>
              </span>
            </div>
          </div>

          {/* Stage / milestone preview */}
          {(stageTrigger || msTrigger || nextMs) && (
            <div className="space-y-2">
              {msTrigger && (
                <div className="bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 text-sm text-violet-800 font-medium">
                  {MS_ICONS[newMs.badge]} This will trigger the <strong>{newMs.badge}</strong> milestone!
                </div>
              )}
              {stageTrigger && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-sm text-amber-800 font-medium">
                  ⚠ This will trigger <strong>{newStage.label}</strong> — action required by {newStage.who}.
                </div>
              )}
              {!stageTrigger && !msTrigger && nextMs && type === 'merit' && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-500">
                  {nextMs.pts - (currentMerits + (pts ?? 0))} pts to {nextMs.badge} milestone.
                </div>
              )}
            </div>
          )}

          {/* Note input */}
          {needsNote ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 space-y-2">
              <p className="text-xs font-bold text-red-700">⚠ Serious infraction — note required (min. 10 characters)</p>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                placeholder="Describe the incident in detail…"
                className="w-full text-sm px-3 py-2 rounded-lg border border-red-200 bg-white focus:outline-none focus:ring-2 focus:ring-red-500/20 text-slate-800 placeholder-slate-400 resize-none"
              />
              <p className={`text-[11px] ${note.trim().length >= 10 ? 'text-emerald-600' : 'text-red-500'}`}>{note.trim().length}/10 min</p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Note (optional)</label>
              <input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Context, repeated offence, location…"
                className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-800 placeholder-slate-400"
              />
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => setStep(3)} className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
              Back
            </button>
            <button
              onClick={submit}
              disabled={!canSubmit || mutation.isPending}
              className={`flex-2 flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-lg transition-colors disabled:opacity-50 ${
                type === 'merit' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {mutation.isPending ? 'Submitting…' : 'Confirm & Submit'}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

/* ── Incidents Tab ───────────────────────────────────────────── */
function IncidentsTab() {
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [typeFilter, setType] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'incidents', { page, search, typeFilter }],
    queryFn:  () => behaviourApi.incidents.list({ page, limit: LIMIT, search: search || undefined, type: typeFilter || undefined }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};
  const totalPages = pagination.pages  ?? 1;
  const total      = pagination.total  ?? rows.length;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search incidents…"
            className="w-full text-sm pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400" />
        </div>
        <select value={typeFilter} onChange={e => { setType(e.target.value); setPage(1); }}
          className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none text-slate-700">
          <option value="">All types</option>
          <option value="merit">Merit</option>
          <option value="demerit">Demerit</option>
        </select>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-14 animate-pulse" />)}</div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg icon={<Scale size={36} />} title="No incidents" subtitle="Use Award Points to log the first incident" />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Behaviour</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Type</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Category</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Points</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(r => (
                <tr key={r._id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.studentName ?? r.studentId}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-[200px]">
                    <span className="block truncate">{r.description ?? r.category ?? '—'}</span>
                    {r.note && <span className="block text-xs text-slate-400 italic truncate">{r.note}</span>}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell"><TypeBadge type={r.type} /></td>
                  <td className="px-4 py-3 text-slate-500 text-xs hidden md:table-cell">{r.category ?? '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-bold ${(r.points ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {(r.points ?? 0) > 0 ? '+' : ''}{r.points}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">
                    {r.date ? new Date(r.date).toLocaleDateString('en-GB') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <PaginationBar page={page} totalPages={totalPages} total={total} limit={LIMIT} onPage={setPage} />
        </div>
      )}
    </motion.div>
  );
}

/* ── Appeals Tab ─────────────────────────────────────────────── */
function AppealsTab() {
  const qc                      = useQueryClient();
  const [page, setPage]         = useState(1);
  const [notes, setNotes]       = useState({});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'appeals', { page }],
    queryFn:  () => behaviourApi.appeals.list({ page, limit: LIMIT }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data       ?? [];
  const pagination = data?.pagination ?? {};
  const totalPages = pagination.pages  ?? 1;
  const total      = pagination.total  ?? rows.length;

  const pending  = rows.filter(a => a.status === 'pending');
  const resolved = rows.filter(a => a.status !== 'pending');

  const resolveMut = useMutation({
    mutationFn: ({ id, outcome }) => behaviourApi.appeals.resolve(id, { outcome, note: notes[id] ?? '' }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['behaviour', 'appeals'] }),
  });

  const statusCls = {
    pending:  'bg-amber-50  text-amber-700  border-amber-200',
    resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    accepted: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected: 'bg-red-50    text-red-700    border-red-200',
  };

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-5">
      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-28 animate-pulse" />)}</div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg icon={<Send size={36} />} title="No appeals" subtitle="Student appeals will appear here for review" />
      ) : (
        <>
          {pending.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Pending ({pending.length})</h3>
              <div className="space-y-3">
                {pending.map(a => (
                  <div key={a._id} className="bg-white rounded-xl border-2 border-amber-300 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{a.studentName ?? a.studentId}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{a.grade ?? '—'} · Submitted {a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-GB') : '—'}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${statusCls.pending}`}>Pending</span>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      <p className="text-xs font-semibold text-amber-800 mb-1">Student's reason:</p>
                      <p className="text-sm text-amber-900">{a.reason ?? '—'}</p>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Your decision note (optional)</label>
                      <input
                        value={notes[a._id] ?? ''}
                        onChange={e => setNotes(n => ({ ...n, [a._id]: e.target.value }))}
                        placeholder="Explain your decision…"
                        className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-800 placeholder-slate-400"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => resolveMut.mutate({ id: a._id, outcome: 'resolved' })}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100 transition"
                      >
                        <Check size={13} />Accept — Remove Points
                      </button>
                      <button
                        onClick={() => resolveMut.mutate({ id: a._id, outcome: 'rejected' })}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold text-red-700 bg-red-50 border border-red-300 rounded-lg hover:bg-red-100 transition"
                      >
                        <XCircle size={13} />Reject — Keep Points
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {resolved.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-400 mb-3">Resolved</h3>
              <div className="space-y-2">
                {resolved.map(a => (
                  <div key={a._id} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{a.studentName ?? a.studentId}</p>
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{a.reason}</p>
                    </div>
                    <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full border ${statusCls[a.status] ?? statusCls.resolved}`}>
                      {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <PaginationBar page={page} totalPages={totalPages} total={total} limit={LIMIT} onPage={setPage} />
        </>
      )}
    </motion.div>
  );
}

/* ── Categories Tab ──────────────────────────────────────────── */
function CategoriesTab() {
  const qc              = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'demerit', defaultPoints: '', description: '' });
  const [errors, setErrors] = useState({});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'categories'],
    queryFn:  () => behaviourApi.categories.list({ limit: 100 }),
    staleTime: 5 * 60_000,
  });
  const rows = data?.data ?? [];

  const createMut = useMutation({
    mutationFn: d => behaviourApi.categories.create({ ...d, defaultPoints: d.defaultPoints ? Number(d.defaultPoints) : undefined }),
    onSuccess:  () => { setShowAdd(false); setForm({ name: '', type: 'demerit', defaultPoints: '', description: '' }); qc.invalidateQueries({ queryKey: ['behaviour', 'categories'] }); },
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create' }),
  });

  const removeMut = useMutation({
    mutationFn: id => behaviourApi.categories.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['behaviour', 'categories'] }),
  });

  function submit(ev) {
    ev.preventDefault();
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (Object.keys(e).length) { setErrors(e); return; }
    createMut.mutate(form);
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{rows.length} custom categor{rows.length !== 1 ? 'ies' : 'y'}</p>
        <button onClick={() => setShowAdd(s => !s)} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
          <Plus size={14} />Add Category
        </button>
      </div>
      <AnimatePresence>
        {showAdd && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <form onSubmit={submit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-800">New Category</h3>
              {errors._server && <div className="flex items-center gap-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-lg border border-red-200"><AlertTriangle size={13} />{errors._server}</div>}
              <div className="grid grid-cols-2 gap-4">
                <FField label="Name *" error={errors.name}><input value={form.name} onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setErrors({}); }} placeholder="e.g. Punctuality" className={iCls(errors.name)} /></FField>
                <FField label="Type"><select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className={iCls()}><option value="merit">Merit</option><option value="demerit">Demerit</option><option value="both">Both</option></select></FField>
                <FField label="Default Points"><input type="number" value={form.defaultPoints} onChange={e => setForm(f => ({ ...f, defaultPoints: e.target.value }))} placeholder="-5" className={iCls()} /></FField>
                <FField label="Description"><input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional" className={iCls()} /></FField>
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowAdd(false)} className="text-sm font-medium text-slate-600 px-4 py-2">Cancel</button>
                <button type="submit" disabled={createMut.isPending} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  {createMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                  {createMut.isPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-20 animate-pulse" />)}</div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : rows.length === 0 ? (
        <EmptyMsg icon={<Tag size={36} />} title="No custom categories" subtitle="Built-in BPS matrix categories are always available. Add custom ones here." />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map(c => (
            <div key={c._id ?? c.id} className="group bg-white rounded-xl border border-slate-200 p-4 hover:shadow-sm hover:border-slate-300 transition-all">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{c.name}</span>
                    <TypeBadge type={c.type} />
                  </div>
                  {c.description && <p className="text-xs text-slate-500 mt-1">{c.description}</p>}
                  {c.defaultPoints != null && (
                    <p className={`text-xs font-bold mt-2 ${Number(c.defaultPoints) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {Number(c.defaultPoints) > 0 ? '+' : ''}{c.defaultPoints} pts default
                    </p>
                  )}
                </div>
                <button onClick={() => { if (confirm(`Delete "${c.name}"?`)) removeMut.mutate(c._id ?? c.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                  <X size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* ── Shared helpers ─────────────────────────────────────────── */
function StatCard({ icon, label, value, valueColor, bg }) {
  return (
    <div className={`${bg} rounded-xl border border-slate-200 p-4 flex items-center gap-3`}>
      <div className="shrink-0">{icon}</div>
      <div>
        <p className={`text-xl font-bold ${valueColor}`}>{value}</p>
        <p className="text-xs text-slate-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function PaginationBar({ page, totalPages, total, limit, onPage }) {
  const start = (page - 1) * limit + 1;
  const end   = Math.min(page * limit, total);
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
      <p className="text-xs text-slate-500">{total > 0 ? `${start}–${end} of ${total}` : '0 results'}</p>
      <div className="flex items-center gap-1">
        <button onClick={() => onPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronLeft size={14} /></button>
        <span className="text-xs text-slate-500 px-2">{page} / {totalPages}</span>
        <button onClick={() => onPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

function EmptyMsg({ icon, title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-slate-400">
      <div className="mb-3 opacity-40">{icon}</div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle && <p className="text-xs mt-1 text-center max-w-xs">{subtitle}</p>}
    </div>
  );
}

function ErrState({ msg, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <AlertTriangle size={24} className="text-red-400" />
      <p className="text-sm text-slate-500">{msg ?? 'Failed to load'}</p>
      {onRetry && <button onClick={onRetry} className="text-xs font-medium text-slate-700 underline">Retry</button>}
    </div>
  );
}

function FField({ label, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-700">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
function iCls(error) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${error ? 'border-red-300' : 'border-slate-200 focus:border-slate-400'} bg-white focus:outline-none focus:ring-2 ${error ? 'focus:ring-red-500/20' : 'focus:ring-slate-900/10'} text-slate-800 placeholder-slate-400 transition`;
}
