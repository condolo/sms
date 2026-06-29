/* ============================================================
   ConfigTab — assessment types (full CRUD), grade scales, template, schedule
   Admin only.
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import {
  AlertTriangle, CheckCircle2, Loader2, Save, Plus, Trash2,
  ClipboardList, TrendingUp, Info, Star, ChevronDown, ChevronUp,
  GraduationCap, MessageSquare, Search, Tag, Lock, LockOpen,
} from 'lucide-react';
import { assessment as api, commentBanks as banksApi } from '@/api/client.js';
import {
  DEFAULT_CUSTOM_TYPES, VALID_TYPE_COLORS, COLOR_PILL,
  DEFAULT_GRADE_SCALE, TERM_NUMBERS, _round,
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
   Grade Scales Section
   ══════════════════════════════════════════════════════════════ */
const EMPTY_BAND = { min: 0, grade: '', points: 0, label: '' };

/** Single editable band row */
function BandRow({ band, onChange, onDelete, rowIdx }) {
  return (
    <div className="grid grid-cols-[72px_64px_64px_1fr_28px] gap-2 items-center py-1.5 px-2 rounded-lg bg-slate-50 border border-slate-100">
      <div className="relative">
        <input
          type="number" min="0" max="100" step="1"
          value={band.min}
          onChange={e => onChange({ ...band, min: Number(e.target.value) })}
          className={`${iCls()} text-right text-xs py-1 pr-6`}
        />
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] pointer-events-none">%</span>
      </div>
      <input
        type="text"
        value={band.grade}
        onChange={e => onChange({ ...band, grade: e.target.value.toUpperCase().slice(0, 6) })}
        placeholder="A+"
        maxLength={6}
        className={`${iCls()} text-xs py-1 font-bold text-center`}
      />
      <input
        type="number" min="0" max="100" step="1"
        value={band.points}
        onChange={e => onChange({ ...band, points: Number(e.target.value) })}
        placeholder="0"
        className={`${iCls()} text-xs py-1 text-right`}
      />
      <input
        type="text"
        value={band.label}
        onChange={e => onChange({ ...band, label: e.target.value })}
        placeholder="e.g. Excellent"
        maxLength={60}
        className={`${iCls()} text-xs py-1`}
      />
      <button
        onClick={onDelete}
        className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition"
        title="Remove band"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

/** Inline band editor — shown/hidden per scale card */
function BandEditor({ scale, onSave, saving }) {
  const [bands, setBands] = useState(() =>
    scale.bands?.length
      ? [...scale.bands].sort((a, b) => b.min - a.min)
      : [...DEFAULT_GRADE_SCALE]
  );
  const [err, setErr] = useState('');

  function addBand() {
    setBands(prev => [...prev, { ...EMPTY_BAND }]);
  }

  function updateBand(idx, updated) {
    setBands(prev => prev.map((b, i) => i === idx ? updated : b));
  }

  function removeBand(idx) {
    setBands(prev => prev.filter((_, i) => i !== idx));
  }

  function handleSave() {
    setErr('');
    if (bands.length === 0) { setErr('At least one band is required'); return; }
    const grades = bands.map(b => b.grade.trim().toUpperCase());
    const empty  = grades.filter(g => !g);
    if (empty.length)         { setErr('All bands need a grade letter'); return; }
    if (new Set(grades).size !== grades.length) { setErr('Grade letters must be unique'); return; }
    const mins = bands.map(b => b.min);
    if (new Set(mins).size !== mins.length) { setErr('Band minimums must be unique'); return; }
    if (!bands.some(b => b.min === 0))      { setErr('One band must start at 0% (covers the lowest scores)'); return; }
    const clean = bands.map(b => ({ min: b.min, grade: b.grade.trim().toUpperCase(), points: Number(b.points) || 0, label: b.label?.trim() || '' }));
    onSave(clean);
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-3 space-y-2">
      {/* Column headers */}
      <div className="grid grid-cols-[72px_64px_64px_1fr_28px] gap-2 px-2">
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-right">Min %</span>
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-center">Grade</span>
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-right">Points</span>
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Label</span>
        <span />
      </div>

      <div className="space-y-1">
        {[...bands].sort((a, b) => b.min - a.min).map((band, idx) => (
          <BandRow
            key={idx}
            band={band}
            rowIdx={idx}
            onChange={updated => updateBand(bands.indexOf(band), updated)}
            onDelete={() => removeBand(bands.indexOf(band))}
          />
        ))}
      </div>

      {err && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <AlertTriangle size={11} /> {err}
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={addBand}
          className="flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 transition"
        >
          <Plus size={11} /> Add band
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition"
        >
          {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
          {saving ? 'Saving…' : 'Save bands'}
        </button>
      </div>
    </div>
  );
}

function GradeScalesSection({ toast: setToast }) {
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newScaleName, setNewScaleName] = useState('');
  const [addErr, setAddErr] = useState('');

  const { data: scalesData, isLoading, refetch } = useQuery({
    queryKey: ['assessment', 'grade-scales'],
    queryFn:  () => api.getGradeScales(),
    staleTime: 5 * 60_000,
  });
  const scales = scalesData?.data ?? [];

  /** Create a new scale (bands can be edited after creation) */
  const { mutate: createScale, isPending: creating } = useMutation({
    mutationFn: data => api.createGradeScale(data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['assessment', 'grade-scales'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'config'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'report'] });
      const created = res?.data;
      setShowAddForm(false);
      setNewScaleName('');
      setExpandedId(created?.id ?? null);
      setToast({ msg: 'Grade scale created. Edit the bands below.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to create scale.', type: 'error' }),
  });

  /** Save bands for an existing scale */
  const [savingId, setSavingId] = useState(null);
  const { mutate: updateScale } = useMutation({
    mutationFn: ({ id, data }) => api.updateGradeScale(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'grade-scales'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'config'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'report'] });
      setSavingId(null);
      setToast({ msg: 'Grade scale saved.', type: 'success' });
    },
    onError: err => {
      setSavingId(null);
      setToast({ msg: err?.message ?? 'Failed to save scale.', type: 'error' });
    },
  });

  /** Set a scale as the school default */
  const { mutate: setDefault } = useMutation({
    mutationFn: id => api.updateGradeScale(id, { isDefault: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'grade-scales'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'config'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'report'] });
      setToast({ msg: 'Default scale updated.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to set default.', type: 'error' }),
  });

  /** Delete a scale */
  const [deletingId, setDeletingId] = useState(null);
  const { mutate: deleteScale } = useMutation({
    mutationFn: id => api.deleteGradeScale(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'grade-scales'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'config'] });
      qc.invalidateQueries({ queryKey: ['assessment', 'report'] });
      setDeletingId(null);
      setToast({ msg: 'Grade scale deleted.', type: 'success' });
    },
    onError: err => {
      setDeletingId(null);
      setToast({ msg: err?.message ?? 'Failed to delete scale.', type: 'error' });
    },
  });

  function handleCreate() {
    setAddErr('');
    const name = newScaleName.trim();
    if (!name) { setAddErr('Scale name is required'); return; }
    createScale({
      name,
      isDefault: scales.length === 0,
      bands: DEFAULT_GRADE_SCALE,
    });
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Grading Scales</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Define how percentage scores map to grade letters (A*, A, B+, …). Each section of the school can have its own scale.
            The <strong className="text-slate-600">default scale</strong> applies to all report cards unless a section-specific one is set.
          </p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="shrink-0 flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 px-2.5 py-1.5 rounded-lg transition"
          >
            <Plus size={12} /> New scale
          </button>
        )}
      </div>

      {/* ── Add scale inline form ── */}
      {showAddForm && (
        <div className="mt-3 p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-end gap-2 flex-wrap">
          <div className="flex flex-col gap-1 flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-slate-600">Scale name</label>
            <input
              type="text"
              value={newScaleName}
              onChange={e => setNewScaleName(e.target.value)}
              placeholder="e.g. Standard KCSE, Primary School, Grade 6–8"
              maxLength={100}
              className={iCls()}
              autoFocus
            />
            {addErr && <p className="text-[11px] text-red-500 flex items-center gap-1"><AlertTriangle size={10} />{addErr}</p>}
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition"
          >
            {creating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            Create
          </button>
          <button
            onClick={() => { setShowAddForm(false); setNewScaleName(''); setAddErr(''); }}
            className="text-xs text-slate-500 hover:text-slate-700 px-2 py-2"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ── Loading ── */}
      {isLoading && <div className="mt-3 space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}

      {/* ── No scales yet ── */}
      {!isLoading && scales.length === 0 && !showAddForm && (
        <div className="mt-4 rounded-xl border-2 border-dashed border-slate-200 p-6 flex flex-col items-center gap-2 text-center">
          <GraduationCap size={20} className="text-slate-300" />
          <p className="text-sm text-slate-500 font-medium">No grading scales configured</p>
          <p className="text-xs text-slate-400">Create a scale to show letter grades on report cards. A built-in fallback scale will be used until you set one up.</p>
          <button onClick={() => setShowAddForm(true)}
            className="mt-1 flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900 border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition">
            <Plus size={11} /> Create first scale
          </button>
        </div>
      )}

      {/* ── Scale cards ── */}
      {!isLoading && scales.length > 0 && (
        <div className="mt-4 space-y-2">
          {scales.map(scale => {
            const isExpanded = expandedId === scale.id;
            return (
              <div key={scale.id} className={`rounded-xl border transition ${scale.isDefault ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white'}`}>
                {/* Scale header row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{scale.name}</p>
                    {scale.isDefault && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-indigo-700 bg-indigo-100 border border-indigo-200 rounded px-1.5 py-0.5">
                        <Star size={8} className="fill-indigo-500 stroke-indigo-500" /> Default
                      </span>
                    )}
                    {scale.sectionId && (
                      <span className="shrink-0 text-[10px] text-slate-500 bg-slate-100 border border-slate-200 rounded px-1.5 py-0.5">{scale.sectionId}</span>
                    )}
                    <span className="shrink-0 text-[10px] text-slate-400">{scale.bands?.length ?? 0} bands</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {!scale.isDefault && (
                      <button
                        onClick={() => setDefault(scale.id)}
                        title="Set as default"
                        className="text-xs text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 border border-transparent hover:border-indigo-200 px-2 py-1 rounded-lg transition"
                      >
                        Set default
                      </button>
                    )}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : scale.id)}
                      className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 px-2 py-1 rounded-lg transition"
                    >
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      {isExpanded ? 'Collapse' : 'Edit bands'}
                    </button>
                    {!scale.isDefault && (
                      <button
                        onClick={() => { setDeletingId(scale.id); deleteScale(scale.id); }}
                        disabled={deletingId === scale.id}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                        title="Delete scale"
                      >
                        {deletingId === scale.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Band preview pills (collapsed) */}
                {!isExpanded && scale.bands?.length > 0 && (
                  <div className="flex flex-wrap gap-1 px-4 pb-3">
                    {[...scale.bands].sort((a, b) => b.min - a.min).map((band, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-[10px] font-semibold bg-white border border-slate-200 rounded px-1.5 py-0.5 text-slate-600">
                        <span className="font-bold text-slate-800">{band.grade}</span>
                        <span className="text-slate-400">≥{band.min}%</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* Expanded band editor */}
                {isExpanded && (
                  <div className="px-4 pb-4">
                    <BandEditor
                      key={scale.id}
                      scale={scale}
                      saving={savingId === scale.id}
                      onSave={(bands) => {
                        setSavingId(scale.id);
                        updateScale({ id: scale.id, data: { bands } });
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Info note */}
      <div className="mt-4 flex items-start gap-2 p-3 bg-slate-50 border border-slate-100 rounded-lg text-xs text-slate-500">
        <Info size={13} className="mt-0.5 shrink-0 text-slate-400" />
        <span>
          Grades appear as a dedicated column on report cards alongside the percentage score.
          Each band needs a unique <strong className="text-slate-700">min %</strong> threshold and <strong className="text-slate-700">grade letter</strong>.
          One band must start at <strong className="text-slate-700">0%</strong> to cover all scores.
          <strong className="text-slate-700"> Points</strong> are optional GPA-style numeric values.
        </span>
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
  const [newSched,     setNewSched]     = useState(EMPTY_SCHED);
  const [unlockId,     setUnlockId]     = useState(null);
  const [unlockReason, setUnlockReason] = useState('');

  const { mutate: saveSched, isPending: savingSched } = useMutation({
    mutationFn: () => api.upsertSchedule(newSched),
    onSuccess:  () => { refetchSched(); setNewSched({ ...EMPTY_SCHED }); },
    onError:    err => setToast({ msg: err?.message ?? 'Failed to save schedule.', type: 'error' }),
  });
  const { mutate: delSched } = useMutation({
    mutationFn: id => api.deleteSchedule(id),
    onSuccess:  () => refetchSched(),
  });

  const [lockingId, setLockingId] = useState(null);
  const { mutate: lockSched } = useMutation({
    mutationFn: ({ id, note }) => api.lockSchedule(id, { note }),
    onSuccess: () => {
      refetchSched();
      setLockingId(null);
      setToast({ msg: 'Schedule entry locked. Teachers can no longer enter marks.', type: 'success' });
    },
    onError: err => {
      setLockingId(null);
      setToast({ msg: err?.message ?? 'Failed to lock schedule entry.', type: 'error' });
    },
  });

  const [unlockingId, setUnlockingId] = useState(null);
  const { mutate: unlockSched } = useMutation({
    mutationFn: ({ id, reason }) => api.unlockSchedule(id, { reason }),
    onSuccess: () => {
      refetchSched();
      setUnlockingId(null);
      setUnlockId(null);
      setUnlockReason('');
      setToast({ msg: 'Schedule entry unlocked. Mark entry is now open.', type: 'success' });
    },
    onError: err => {
      setUnlockingId(null);
      setToast({ msg: err?.message ?? 'Failed to unlock schedule entry.', type: 'error' });
    },
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

      {/* ══ Grading Scales ════════════════════════════════════ */}
      <GradeScalesSection toast={setToast} />

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
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">Assessment</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">Term</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">From</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">To</th>
                  <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">Status</th>
                  <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schedules.map(s => {
                  const typeInfo = activeTypes.find(t => t.key === s.assessmentType);
                  const sid = s.id ?? s._id;
                  return (
                    <tr key={sid} className={`hover:bg-slate-50 transition ${s.isLocked ? 'bg-red-50/30' : ''}`}>
                      <td className="px-3 py-2.5">
                        <TypePill type={s.assessmentType} color={typeInfo?.color} />
                        {s.instance > 1 && (
                          <span className="ml-1.5 text-xs text-slate-600">{s.assessmentType} {s.instance}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">Term {s.termNumber}</td>
                      <td className="px-3 py-2.5 text-slate-500 text-xs font-mono">{s.dateFrom}</td>
                      <td className="px-3 py-2.5 text-slate-500 text-xs font-mono">{s.dateTo}</td>
                      <td className="px-3 py-2.5">
                        {s.isLocked ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-100 border border-red-200 rounded-full px-2 py-0.5">
                            <Lock size={9} /> Locked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                            Open
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {s.isLocked ? (
                            <button
                              onClick={() => { setUnlockId(sid); setUnlockReason(''); }}
                              className="flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 px-2 py-1 rounded-lg transition"
                              title="Unlock this schedule entry"
                            >
                              <LockOpen size={11} /> Unlock
                            </button>
                          ) : (
                            <button
                              onClick={() => { setLockingId(sid); lockSched({ id: sid, note: '' }); }}
                              disabled={lockingId === sid}
                              className="flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg transition disabled:opacity-50"
                              title="Lock this schedule entry (blocks mark entry)"
                            >
                              {lockingId === sid ? <Loader2 size={10} className="animate-spin" /> : <Lock size={10} />}
                              Lock
                            </button>
                          )}
                          {!s.isLocked && (
                            <button onClick={() => delSched(sid)}
                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Unlock confirmation dialog */}
            {unlockId && (
              <div className="mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 space-y-3">
                <div className="flex items-center gap-2">
                  <LockOpen size={14} className="text-amber-600 shrink-0" />
                  <p className="text-sm font-semibold text-amber-800">Unlock schedule entry</p>
                </div>
                <p className="text-xs text-amber-700">Provide a reason for unlocking. This will be recorded in the audit log.</p>
                <input
                  type="text"
                  value={unlockReason}
                  onChange={e => setUnlockReason(e.target.value)}
                  placeholder="Reason for unlocking (e.g. marks correction approved by principal)"
                  className="w-full text-sm px-3 py-2 rounded-lg border border-amber-300 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400/30"
                  autoFocus
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => { setUnlockId(null); setUnlockReason(''); }}
                    className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { setUnlockingId(unlockId); unlockSched({ id: unlockId, reason: unlockReason }); }}
                    disabled={!unlockReason.trim() || unlockingId === unlockId}
                    className="flex items-center gap-1.5 bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition"
                  >
                    {unlockingId === unlockId ? <Loader2 size={11} className="animate-spin" /> : <LockOpen size={11} />}
                    Confirm unlock
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Comment Banks ──────────────────────────────────────────── */}
      <CommentBankSection />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Comment Bank — pre-written remark templates for report cards
   ══════════════════════════════════════════════════════════════ */
const COMMENT_CATEGORIES = [
  { key: 'academic',   label: 'Academic' },
  { key: 'behaviour',  label: 'Behaviour' },
  { key: 'general',    label: 'General' },
  { key: 'subject',    label: 'Subject-specific' },
];

function CommentBankSection() {
  const qc = useQueryClient();
  const [search,   setSearch]   = useState('');
  const [catFilter,setCatFilter] = useState('');
  const [newText,  setNewText]  = useState('');
  const [newCat,   setNewCat]   = useState('general');
  const [adding,   setAdding]   = useState(false);
  const [toast,    setToast]    = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ['comment-banks', { category: catFilter, q: search }],
    queryFn:  () => banksApi.list({ category: catFilter || undefined, q: search || undefined }),
    staleTime: 60_000,
  });
  const comments = data?.data ?? [];

  const { mutate: createComment, isPending: creating } = useMutation({
    mutationFn: () => banksApi.create({ text: newText.trim(), category: newCat }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comment-banks'] });
      setNewText('');
      setAdding(false);
      setToast({ msg: 'Comment added.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to add comment.', type: 'error' }),
  });

  const { mutate: deleteComment } = useMutation({
    mutationFn: (id) => banksApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['comment-banks'] });
      setToast({ msg: 'Comment deleted.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to delete.', type: 'error' }),
  });

  const catColorMap = {
    academic:  'bg-blue-50 text-blue-700 border-blue-200',
    behaviour: 'bg-amber-50 text-amber-700 border-amber-200',
    general:   'bg-slate-100 text-slate-600 border-slate-200',
    subject:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <AnimatePresence>
        {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
      </AnimatePresence>

      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquare size={15} className="text-slate-500" />
            <p className="text-sm font-semibold text-slate-800">Comment Bank</p>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">Pre-written remarks teachers can insert into report cards</p>
        </div>
        <button
          onClick={() => setAdding(a => !a)}
          className="flex items-center gap-1.5 border border-slate-200 hover:border-slate-400 text-slate-600 hover:text-slate-900 text-xs font-medium px-3 py-1.5 rounded-lg transition"
        >
          <Plus size={12} /> Add comment
        </button>
      </div>

      {/* Add form */}
      {adding && (
        <div className="mb-4 p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-medium text-slate-600 block mb-1">Comment text</label>
              <textarea
                value={newText}
                onChange={e => setNewText(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="e.g. shows excellent understanding of concepts and works diligently…"
                className={`${iCls()} resize-none`}
              />
              <span className="text-[10px] text-slate-400">{newText.length}/500</span>
            </div>
            <div className="w-36">
              <label className="text-xs font-medium text-slate-600 block mb-1">Category</label>
              <select
                value={newCat}
                onChange={e => setNewCat(e.target.value)}
                className={iCls()}
              >
                {COMMENT_CATEGORIES.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAdding(false); setNewText(''); }}
              className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg transition">
              Cancel
            </button>
            <button
              onClick={() => createComment()}
              disabled={creating || !newText.trim()}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition"
            >
              {creating ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              {creating ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search comments…"
            className={`${iCls()} pl-8 text-xs`}
          />
        </div>
        <select
          value={catFilter}
          onChange={e => setCatFilter(e.target.value)}
          className={`${iCls()} w-40 text-xs`}
        >
          <option value="">All categories</option>
          {COMMENT_CATEGORIES.map(c => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : comments.length === 0 ? (
        <div className="py-8 text-center text-sm text-slate-400 flex flex-col items-center gap-2">
          <MessageSquare size={20} className="text-slate-200" />
          {search || catFilter ? 'No comments match your search.' : 'No comments yet — add one above.'}
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {comments.map(c => (
            <div key={c.id} className="flex items-start justify-between gap-3 py-2.5 group">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 leading-snug">{c.text}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${catColorMap[c.category] ?? catColorMap.general}`}>
                    <Tag size={8} />{COMMENT_CATEGORIES.find(x => x.key === c.category)?.label ?? c.category}
                  </span>
                </div>
              </div>
              <button
                onClick={() => deleteComment(c.id)}
                className="shrink-0 p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition opacity-0 group-hover:opacity-100"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
