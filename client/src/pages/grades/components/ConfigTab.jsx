/* ============================================================
   ConfigTab — assessment types (full CRUD), template, schedule
   Admin only.
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, CheckCircle2, Loader2, Save, Plus, Trash2,
  ClipboardList, TrendingUp, Info,
} from 'lucide-react';
import { assessment as api } from '@/api/client.js';
import {
  DEFAULT_CUSTOM_TYPES, VALID_TYPE_COLORS, COLOR_PILL,
  TERM_NUMBERS, _round,
} from '../constants.js';
import { Skeleton, Toast, SelField, iCls, TypePill } from './GradesPrimitives.jsx';

/* ── Color dot selector ─────────────────────────────────────── */
function ColorDot({ color, selected, onClick }) {
  const bg = (COLOR_PILL[color] ?? '').split(' ')[0] || 'bg-slate-100';
  return (
    <button
      type="button"
      onClick={onClick}
      title={color}
      className={`w-4 h-4 rounded-full border transition ${bg} ${
        selected ? 'ring-2 ring-offset-1 ring-slate-700 scale-125' : 'hover:scale-110 border-transparent'
      }`}
    />
  );
}

/* ── Single editable type row ───────────────────────────────── */
function TypeRow({ type, onChange, onDelete, deleting }) {
  return (
    <div className="grid grid-cols-[auto_1fr_80px_68px_auto_32px] gap-2 items-center py-2 px-3 rounded-xl bg-slate-50 border border-slate-100">
      {/* Key chip (immutable — it's the DB identifier) */}
      <TypePill type={type.key} color={type.color} />

      {/* Label */}
      <input
        type="text"
        value={type.label}
        onChange={e => onChange({ ...type, label: e.target.value })}
        placeholder="Label"
        maxLength={100}
        className={`${iCls()} text-xs py-1.5`}
      />

      {/* Weight % */}
      <div className="relative">
        <input
          type="number"
          min="0"
          max="100"
          step="1"
          value={type.weight}
          onChange={e => onChange({ ...type, weight: Number(e.target.value) })}
          className={`${iCls()} pr-6 text-right text-xs py-1.5`}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">%</span>
      </div>

      {/* Instances per term */}
      <select
        value={type.instances}
        onChange={e => onChange({ ...type, instances: Number(e.target.value) })}
        className={`${iCls()} text-xs py-1.5`}
      >
        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}×</option>)}
      </select>

      {/* Color dots */}
      <div className="flex gap-0.5 flex-wrap max-w-[108px]">
        {VALID_TYPE_COLORS.map(c => (
          <ColorDot key={c} color={c} selected={type.color === c} onClick={() => onChange({ ...type, color: c })} />
        ))}
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        disabled={deleting}
        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
        title={`Delete ${type.key}`}
      >
        {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
      </button>
    </div>
  );
}

/* ── Add type inline form ───────────────────────────────────── */
const EMPTY_NEW = { key: '', label: '', weight: 0, instances: 1, color: 'sky' };

function AddTypeForm({ onAdd, adding }) {
  const [form, setForm] = useState(EMPTY_NEW);
  const [err,  setErr]  = useState('');

  function handleAdd() {
    const key = form.key.toUpperCase().trim();
    if (!key)                          { setErr('Key is required'); return; }
    if (!/^[A-Z0-9_]+$/.test(key))    { setErr('Key: uppercase letters, digits, or underscores only'); return; }
    if (!form.label.trim())            { setErr('Label is required'); return; }
    setErr('');
    onAdd({ ...form, key }, () => setForm(EMPTY_NEW));
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-200">
      <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
        <Plus size={12} /> Add new assessment type
      </p>
      {err && (
        <p className="text-xs text-red-500 mb-2 flex items-center gap-1">
          <AlertTriangle size={11} /> {err}
        </p>
      )}
      <div className="grid grid-cols-[80px_1fr_80px_68px_auto_auto] gap-2 items-center">
        {/* Key */}
        <input
          type="text"
          value={form.key}
          onChange={e => setForm(p => ({ ...p, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
          placeholder="KEY"
          maxLength={10}
          className={`${iCls()} text-xs py-1.5 font-mono`}
        />
        {/* Label */}
        <input
          type="text"
          value={form.label}
          onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
          placeholder="Label e.g. Quiz"
          maxLength={100}
          className={`${iCls()} text-xs py-1.5`}
        />
        {/* Weight */}
        <div className="relative">
          <input
            type="number"
            min="0"
            max="100"
            step="1"
            value={form.weight}
            onChange={e => setForm(p => ({ ...p, weight: Number(e.target.value) }))}
            className={`${iCls()} pr-6 text-right text-xs py-1.5`}
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">%</span>
        </div>
        {/* Instances */}
        <select
          value={form.instances}
          onChange={e => setForm(p => ({ ...p, instances: Number(e.target.value) }))}
          className={`${iCls()} text-xs py-1.5`}
        >
          {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}×</option>)}
        </select>
        {/* Color */}
        <div className="flex gap-0.5 flex-wrap max-w-[108px]">
          {VALID_TYPE_COLORS.map(c => (
            <ColorDot key={c} color={c} selected={form.color === c} onClick={() => setForm(p => ({ ...p, color: c }))} />
          ))}
        </div>
        {/* Add button */}
        <button
          onClick={handleAdd}
          disabled={adding}
          className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition whitespace-nowrap"
        >
          {adding ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
          Add
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Main ConfigTab component
   ══════════════════════════════════════════════════════════════ */
export default function ConfigTab() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);

  /* ── Config query ───────────────────────────────────────── */
  const { data: configData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['assessment', 'config'],
    queryFn:  () => api.getConfig(),
    staleTime: 5 * 60_000,
  });
  const cfg = configData?.data ?? {};

  /* ── Draft state ────────────────────────────────────────── */
  const [draftTypes,    setDraftTypes]    = useState(null);   // null = use DB value
  const [draftTemplate, setDraftTemplate] = useState(null);

  const activeTypes    = draftTypes    ?? cfg.customTypes ?? DEFAULT_CUSTOM_TYPES;
  const activeTemplate = draftTemplate ?? cfg.reportTemplate ?? 'detailed';

  const totalWeight = activeTypes.reduce((s, t) => s + Number(t.weight || 0), 0);
  const weightOk    = Math.abs(totalWeight - 100) < 0.01;

  /* ── Mutations ──────────────────────────────────────────── */

  /** Save all edits (labels, weights, instances, colors) + template in one go */
  const { mutate: saveAll, isPending: saving } = useMutation({
    mutationFn: () => Promise.all([
      api.saveTypes({ customTypes: activeTypes }),
      api.updateConfig({ reportTemplate: activeTemplate }),
    ]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'config'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'report'] });
      setDraftTypes(null);
      setDraftTemplate(null);
      setToast({ msg: 'Configuration saved.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save configuration.', type: 'error' }),
  });

  /** Add a new type immediately — goes straight to DB */
  const { mutate: addType, isPending: adding } = useMutation({
    mutationFn: data => api.addType(data),
    onSuccess: (_res, _vars, ctx) => {
      qc.invalidateQueries({ queryKey: ['assessment', 'config'] });
      setDraftTypes(null);   // let fresh config drive the list
      ctx?.resetForm?.();
      setToast({ msg: 'Assessment type added.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to add type.', type: 'error' }),
  });

  /** Delete a type immediately — DB enforces no-marks guard */
  const [deletingKey, setDeletingKey] = useState(null);
  const { mutate: deleteType } = useMutation({
    mutationFn: key => api.deleteType(key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'config'] });
      setDraftTypes(null);
      setDeletingKey(null);
      setToast({ msg: 'Assessment type removed.', type: 'success' });
    },
    onError: err => {
      setDeletingKey(null);
      setToast({ msg: err?.message ?? 'Failed to delete type.', type: 'error' });
    },
  });

  function handleDeleteType(key) {
    setDeletingKey(key);
    deleteType(key);
  }

  function handleAddType(typeData, resetForm) {
    addType(typeData, { onSuccess: () => resetForm?.() });
  }

  function updateRow(key, updatedType) {
    setDraftTypes(prev => {
      const base = prev ?? cfg.customTypes ?? DEFAULT_CUSTOM_TYPES;
      return base.map(t => t.key === key ? updatedType : t);
    });
  }

  /* ── Schedule ───────────────────────────────────────────── */
  const { data: schedData, refetch: refetchSched } = useQuery({
    queryKey: ['assessment', 'schedule'],
    queryFn:  () => api.getSchedule(),
    staleTime: 60_000,
  });
  const schedules = schedData?.data ?? [];

  const EMPTY_SCHED = { termNumber: 1, assessmentType: activeTypes[0]?.key ?? 'CA', instance: 1, dateFrom: '', dateTo: '' };
  const [newSched, setNewSched] = useState(EMPTY_SCHED);

  const { mutate: saveSched, isPending: savingSched } = useMutation({
    mutationFn: () => api.upsertSchedule(newSched),
    onSuccess:  () => { refetchSched(); setNewSched({ ...EMPTY_SCHED }); },
    onError:    err => setToast({ msg: err?.message ?? 'Failed to save schedule.', type: 'error' }),
  });
  const { mutate: delSched } = useMutation({
    mutationFn: id => api.deleteSchedule(id),
    onSuccess:  () => refetchSched(),
  });

  /* ── Loading / error ────────────────────────────────────── */
  if (isLoading) return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}</div>;
  if (isError) return (
    <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
      <AlertTriangle size={20} className="text-red-400" />
      <p className="text-sm text-slate-600">{error?.message ?? 'Failed to load config.'}</p>
      <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
    </div>
  );

  const TEMPLATE_OPTIONS = [
    { key: 'detailed', Icon: ClipboardList, title: 'Template A — Detailed', desc: 'Shows all assessment scores per term with ET reference columns and blended final grade.' },
    { key: 'summary',  Icon: TrendingUp,    title: 'Template B — Summary',  desc: 'Shows term averages only (T1, T2, T3) with equal-weight final average.' },
  ];

  return (
    <div className="space-y-4">
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* ══ Assessment Types (full CRUD) ══════════════════════ */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-0.5">Assessment Types</h3>
        <p className="text-xs text-slate-400 mb-4">
          Add, rename, reweight, or delete assessment components. Weights must total 100%.
          Use <strong>Save configuration</strong> to apply label/weight/color edits.
          Adding and deleting are immediate.
        </p>

        {/* Column headers */}
        <div className="grid grid-cols-[auto_1fr_80px_68px_auto_32px] gap-2 items-center px-3 mb-1">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Type</span>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Label</span>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-right pr-2">Weight</span>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-center">/Term</span>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Color</span>
          <span />
        </div>

        {/* Rows */}
        <div className="space-y-1.5">
          {activeTypes.map(type => (
            <TypeRow
              key={type.key}
              type={type}
              onChange={updated => updateRow(type.key, updated)}
              onDelete={() => handleDeleteType(type.key)}
              deleting={deletingKey === type.key}
            />
          ))}
        </div>

        {/* Weight total */}
        <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-sm border ${
          weightOk
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          {weightOk ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          Total: <strong>{_round(totalWeight)}%</strong>
          {!weightOk && <span className="ml-1 text-xs">— must equal exactly 100% before saving</span>}
        </div>

        {/* Info card */}
        <div className="mt-3 flex items-start gap-2 p-3 bg-slate-50 border border-slate-100 rounded-lg text-xs text-slate-500">
          <Info size={13} className="mt-0.5 shrink-0 text-slate-400" />
          <span>
            <strong className="text-slate-700">Key</strong> is a permanent short code (e.g. "CA", "QZ") — the DB identifier, cannot be changed after creation.
            Types with existing marks <strong className="text-slate-700">cannot be deleted</strong> until all their marks are removed.
            <strong className="text-slate-700"> /Term</strong> controls how many instances appear per term (e.g. CA×2 creates "CA 1" and "CA 2").
          </span>
        </div>

        {/* Add form */}
        <AddTypeForm onAdd={handleAddType} adding={adding} />
      </div>

      {/* ══ Report Card Template ══════════════════════════════ */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-4">Report Card Template</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {TEMPLATE_OPTIONS.map(({ key, Icon, title, desc }) => (
            <button key={key} onClick={() => setDraftTemplate(key)}
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

      {/* ══ Save button ══════════════════════════════════════ */}
      <div className="flex justify-end">
        <button
          onClick={() => saveAll()}
          disabled={saving || !weightOk}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save configuration'}
        </button>
      </div>

      {/* ══ Assessment Schedule ══════════════════════════════ */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-1">Assessment Schedule</h3>
        <p className="text-xs text-slate-400 mb-4">Set date windows — teachers are reminded automatically when an assessment opens.</p>
        <div className="flex flex-wrap gap-3 items-end p-4 bg-slate-50 rounded-xl border border-slate-100 mb-4">
          <SelField label="Term" value={String(newSched.termNumber)} placeholder=""
            onChange={v => setNewSched(p => ({ ...p, termNumber: Number(v) }))}
            options={TERM_NUMBERS.map(n => ({ value: String(n), label: `Term ${n}` }))} />
          <SelField label="Type" value={newSched.assessmentType} placeholder=""
            onChange={v => setNewSched(p => ({ ...p, assessmentType: v, instance: 1 }))}
            options={activeTypes.map(t => ({ value: t.key, label: `${t.key} — ${t.label}` }))} />
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
              {schedules.map(s => {
                const typeInfo = activeTypes.find(t => t.key === s.assessmentType);
                return (
                  <tr key={s.id ?? s._id} className="hover:bg-slate-50 transition">
                    <td className="px-3 py-2.5">
                      <TypePill type={s.assessmentType} color={typeInfo?.color} />
                      {s.instance > 1 && (
                        <span className="ml-1.5 text-xs text-slate-600">{s.assessmentType} {s.instance}</span>
                      )}
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
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
