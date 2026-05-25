/* ============================================================
   ConfigTab — assessment weights, instances, template, schedule
   Admin only.
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, CheckCircle2, Loader2, Save, Plus, Trash2,
  ClipboardList, TrendingUp,
} from 'lucide-react';
import { assessment as api } from '@/api/client.js';
import {
  ASSESSMENT_TYPES, TERM_NUMBERS, TYPE_LABELS, DEFAULT_WEIGHTS, _round,
} from '../constants.js';
import { Skeleton, Toast, SelField, iCls, TypePill } from './GradesPrimitives.jsx';

export default function ConfigTab() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);

  const { data: configData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['assessment', 'config'],
    queryFn:  () => api.getConfig(),
    staleTime: 5 * 60_000,
  });
  const cfg = configData?.data ?? {};

  const [weights,   setWeights]   = useState(null);
  const [template,  setTemplate]  = useState(null);
  const [instances, setInstances] = useState(null);

  const activeWeights   = weights   ?? cfg.weights        ?? DEFAULT_WEIGHTS;
  const activeTemplate  = template  ?? cfg.reportTemplate ?? 'detailed';
  const activeInstances = instances ?? cfg.instances       ?? { CA: 2, HW: 2 };

  const weightTotal = Object.values(activeWeights).reduce((s, n) => s + Number(n), 0);
  const weightOk    = Math.abs(weightTotal - 100) < 0.01;

  const { mutate: saveConfig, isPending: saving } = useMutation({
    mutationFn: () => api.updateConfig({
      weights: activeWeights, reportTemplate: activeTemplate, instances: activeInstances,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'config'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'report'] });
      setWeights(null); setTemplate(null); setInstances(null);
      setToast({ msg: 'Configuration saved.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save config.', type: 'error' }),
  });

  const { data: schedData, refetch: refetchSched } = useQuery({
    queryKey: ['assessment', 'schedule'],
    queryFn:  () => api.getSchedule(),
    staleTime: 60_000,
  });
  const schedules = schedData?.data ?? [];

  const EMPTY_SCHED = { termNumber: 1, assessmentType: 'CA', instance: 1, dateFrom: '', dateTo: '' };
  const [newSched, setNewSched] = useState(EMPTY_SCHED);

  const { mutate: saveSched, isPending: savingSched } = useMutation({
    mutationFn: () => api.upsertSchedule(newSched),
    onSuccess:  () => { refetchSched(); setNewSched(EMPTY_SCHED); },
    onError:    err => setToast({ msg: err?.message ?? 'Failed to save schedule.', type: 'error' }),
  });
  const { mutate: delSched } = useMutation({
    mutationFn: id => api.deleteSchedule(id),
    onSuccess:  () => refetchSched(),
  });

  if (isLoading) return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>;
  if (isError) return (
    <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
      <AlertTriangle size={20} className="text-red-400" />
      <p className="text-sm text-slate-600">{error?.message ?? 'Failed to load config.'}</p>
      <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
    </div>
  );

  const TEMPLATE_OPTIONS = [
    { key: 'detailed', Icon: ClipboardList, title: 'Template A — Detailed', desc: 'Shows CA, HW, MT, ET scores per term with ET reference columns and blended final grade.' },
    { key: 'summary',  Icon: TrendingUp,    title: 'Template B — Summary',  desc: 'Shows term averages only (T1, T2, T3) with equal-weight final average.' },
  ];

  return (
    <div className="space-y-4">
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* Assessment Weights */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Assessment Weights</h3>
        <p className="text-xs text-slate-400 mb-4">Must total exactly 100%.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {ASSESSMENT_TYPES.map(type => (
            <div key={type}>
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1.5">
                <TypePill type={type} />{TYPE_LABELS[type]}
              </label>
              <div className="relative">
                <input type="number" min="0" max="100" step="1"
                  value={activeWeights[type] ?? 0}
                  onChange={e => setWeights({ ...activeWeights, [type]: Number(e.target.value) })}
                  className={`${iCls()} pr-8 text-right`} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">%</span>
              </div>
            </div>
          ))}
        </div>
        <div className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${
          weightOk ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {weightOk ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          Total: <strong>{_round(weightTotal)}%</strong>
          {!weightOk && <span className="ml-1">— must equal exactly 100%</span>}
        </div>
      </div>

      {/* Instances per Term */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Assessment Instances per Term</h3>
        <p className="text-xs text-slate-400 mb-4">How many CA and HW assessments per term? Scores are averaged before weighting.</p>
        <div className="flex flex-wrap gap-6">
          {['CA', 'HW'].map(type => (
            <div key={type}>
              <label className="text-xs font-medium text-slate-600 mb-1.5 flex items-center gap-1.5">
                <TypePill type={type} />{TYPE_LABELS[type]}
              </label>
              <select value={activeInstances[type] ?? 2}
                onChange={e => setInstances({ ...activeInstances, [type]: Number(e.target.value) })}
                className={`${iCls()} w-32`}>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} per term</option>)}
              </select>
            </div>
          ))}
          <div>
            <label className="text-xs font-medium text-slate-500 mb-1.5 block">MT &amp; ET</label>
            <div className="w-32 text-sm px-3 py-2 rounded-lg border border-slate-100 bg-slate-50 text-slate-400 select-none">1 (fixed)</div>
          </div>
        </div>
      </div>

      {/* Report Card Template */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Report Card Template</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {TEMPLATE_OPTIONS.map(({ key, Icon, title, desc }) => (
            <button key={key} onClick={() => setTemplate(key)}
              className={`text-left rounded-xl border-2 p-4 transition ${
                activeTemplate === key ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:border-slate-300'
              }`}>
              <Icon size={18} className={`mb-2 ${activeTemplate === key ? 'text-slate-800' : 'text-slate-400'}`} />
              <p className="text-sm font-semibold text-slate-800">{title}</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{desc}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <button onClick={() => saveConfig()} disabled={saving || !weightOk}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save configuration'}
        </button>
      </div>

      {/* Assessment Schedule */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Assessment Schedule</h3>
        <p className="text-xs text-slate-400 mb-4">Set date windows — teachers are reminded automatically when an assessment opens.</p>
        <div className="flex flex-wrap gap-3 items-end p-4 bg-slate-50 rounded-xl border border-slate-100 mb-4">
          <SelField label="Term" value={String(newSched.termNumber)} placeholder=""
            onChange={v => setNewSched(p => ({ ...p, termNumber: Number(v) }))}
            options={TERM_NUMBERS.map(n => ({ value: String(n), label: `Term ${n}` }))} />
          <SelField label="Type" value={newSched.assessmentType} placeholder=""
            onChange={v => setNewSched(p => ({ ...p, assessmentType: v, instance: 1 }))}
            options={ASSESSMENT_TYPES.map(t => ({ value: t, label: t }))} />
          <SelField label="Instance" value={String(newSched.instance)} placeholder=""
            onChange={v => setNewSched(p => ({ ...p, instance: Number(v) }))}
            options={[1, 2, 3, 4].map(n => ({ value: String(n), label: String(n) }))} />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-600">From</label>
            <input type="date" value={newSched.dateFrom}
              onChange={e => setNewSched(p => ({ ...p, dateFrom: e.target.value }))} className={iCls()} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-600">To</label>
            <input type="date" value={newSched.dateTo}
              onChange={e => setNewSched(p => ({ ...p, dateTo: e.target.value }))} className={iCls()} />
          </div>
          <button onClick={() => saveSched()} disabled={savingSched || !newSched.dateFrom || !newSched.dateTo}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition self-end">
            {savingSched ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Add
          </button>
        </div>

        {schedules.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">No schedule entries yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">Assessment</th>
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">Term</th>
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">From</th>
                <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">To</th>
                <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {schedules.map(s => (
                <tr key={s.id ?? s._id} className="hover:bg-slate-50 transition">
                  <td className="px-3 py-2.5">
                    <TypePill type={s.assessmentType} />
                    <span className="ml-1.5 text-xs text-slate-600">{s.instance > 1 ? `${s.assessmentType} ${s.instance}` : ''}</span>
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">Term {s.termNumber}</td>
                  <td className="px-3 py-2.5 text-slate-500 text-xs font-mono">{s.dateFrom}</td>
                  <td className="px-3 py-2.5 text-slate-500 text-xs font-mono">{s.dateTo}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button onClick={() => delSched(s.id ?? s._id)}
                      className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
