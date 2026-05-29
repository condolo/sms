/* ============================================================
   AwardTab — 4-step award wizard: student → type → behaviour → confirm
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Search, X, Loader2, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import {
  MATRIX, meritTotal, demeritTotal, studentStage, studentMilestone,
  nextMilestone, isSerious,
} from '../bpsConstants.js';
import { behaviour as behaviourApi, students as studentsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { MS_ICONS, StageBadge, MilestoneBadge, TypeBadge } from './BehaviourPrimitives.jsx';

const STEP_LABELS = ['Select Student', 'Merit or Demerit', 'Choose Behaviour', 'Confirm & Submit'];

export default function AwardTab() {
  const qc   = useQueryClient();
  const user = useAuthStore(s => s.session?.user);

  const [step, setStep]     = useState(1);
  const [sid,  setSid]      = useState('');
  const [sName, setSName]   = useState('');
  const [type, setType]     = useState('');
  const [catIdx, setCatIdx] = useState(0);
  const [item, setItem]     = useState(null);
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

  /* Student's existing incidents */
  const { data: stuIncData } = useQuery({
    queryKey: ['behaviour', 'incidents', 'student', sid],
    queryFn:  () => behaviourApi.incidents.list({ studentId: sid, limit: 500 }),
    enabled:  !!sid,
    staleTime: 60_000,
  });
  const stuLogs = stuIncData?.data ?? [];

  /* Computed state */
  const currentMerits  = meritTotal(stuLogs, sid);
  const currentDemerit = demeritTotal(stuLogs, sid);
  const currentStage   = studentStage(stuLogs, sid);
  const currentMs      = studentMilestone(stuLogs, sid);
  const pts            = item ? (type === 'merit' ? item.merit : item.demerit) : null;
  const newMerits      = type === 'merit'  && pts ? currentMerits  + pts         : currentMerits;
  const newDemerit     = type === 'demerit' && pts ? currentDemerit + Math.abs(pts) : currentDemerit;

  /* Stage / milestone previews */
  const fakeStuLogs  = pts && type === 'demerit'
    ? [...stuLogs, { studentId: sid, type: 'demerit', points: pts, date: new Date().toISOString(), status: 'active' }]
    : stuLogs;
  const newStage     = studentStage(fakeStuLogs, sid);
  const stageTrigger = newStage && newStage?.stage !== currentStage?.stage;

  const fakeMeritLogs = pts && type === 'merit'
    ? [...stuLogs, { studentId: sid, type: 'merit', points: pts, date: new Date().toISOString(), status: 'active' }]
    : stuLogs;
  const newMs     = studentMilestone(fakeMeritLogs, sid);
  const msTrigger = newMs && newMs?.badge !== currentMs?.badge;
  const nextMs    = nextMilestone(stuLogs, sid);

  const needsNote  = isSerious(pts);
  const canSubmit  = !!sid && !!type && !!item && pts !== null && (!needsNote || note.trim().length >= 10);

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

  function reset() {
    setStep(1); setSid(''); setSName(''); setType('');
    setCatIdx(0); setItem(null); setNote(''); setStuSearch('');
  }

  function submit() {
    if (!canSubmit) return;
    mutation.mutate({
      studentId:   sid,
      type,
      title:       item.label,
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
                  {toast.msTrigger   && <span className="ml-2 font-bold">{MS_ICONS[toast.newMs.badge]} Milestone: {toast.newMs.badge}!</span>}
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
                active ? 'bg-slate-900 text-white' :
                done   ? 'bg-emerald-100 text-emerald-700 cursor-pointer hover:bg-emerald-200' :
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
                      const id = s.id ?? s._id;
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

          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {catItems.map(it => {
              const p      = type === 'merit' ? it.merit : it.demerit;
              const active = item?.id === it.id;
              return (
                <button
                  key={it.id}
                  onClick={() => { setItem(it); setNote(''); setStep(4); }}
                  className={`w-full flex items-center justify-between gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                    active ? 'border-slate-800 bg-slate-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
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
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-lg transition-colors disabled:opacity-50 ${
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
