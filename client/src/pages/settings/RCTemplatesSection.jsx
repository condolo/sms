/* ============================================================
   RCTemplatesSection — competency-based report card templates
   Admin-only. Accessed from Settings → Report Templates tab.
   ============================================================ */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, X, Save, Trash2, Loader2, CheckCircle2, AlertTriangle,
  ChevronDown, ChevronUp, LayoutTemplate, Pencil, GripVertical,
  BookOpen, Tag, ToggleLeft, ToggleRight, Info, Eye,
} from 'lucide-react';
import { rcTemplates as api, classes as classesApi } from '@/api/client.js';

/* ── Tiny helpers ────────────────────────────────────────────── */
const uid = () => Math.random().toString(36).slice(2, 11);

const iCls = () =>
  'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400/40 bg-white';

const BAND_COLORS = ['emerald', 'blue', 'amber', 'red', 'purple', 'slate', 'orange', 'teal', 'indigo', 'rose'];

const BAND_PILL = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue:    'bg-blue-50    text-blue-700    border-blue-200',
  amber:   'bg-amber-50   text-amber-700   border-amber-200',
  red:     'bg-red-50     text-red-700     border-red-200',
  purple:  'bg-purple-50  text-purple-700  border-purple-200',
  slate:   'bg-slate-100  text-slate-700   border-slate-200',
  orange:  'bg-orange-50  text-orange-700  border-orange-200',
  teal:    'bg-teal-50    text-teal-700    border-teal-200',
  indigo:  'bg-indigo-50  text-indigo-700  border-indigo-200',
  rose:    'bg-rose-50    text-rose-700    border-rose-200',
};

const BAND_DOT = {
  emerald: 'bg-emerald-500',
  blue:    'bg-blue-500',
  amber:   'bg-amber-500',
  red:     'bg-red-500',
  purple:  'bg-purple-500',
  slate:   'bg-slate-400',
  orange:  'bg-orange-500',
  teal:    'bg-teal-500',
  indigo:  'bg-indigo-500',
  rose:    'bg-rose-500',
};

function emptyTemplate() {
  return {
    name: '',
    description: '',
    status: 'draft',
    classIds: [],
    performanceBands: [
      { _uid: uid(), label: 'Excellent',   defaultScore: 10, grade: 'A', color: 'emerald' },
      { _uid: uid(), label: 'Good',        defaultScore: 8,  grade: 'B', color: 'blue'    },
      { _uid: uid(), label: 'In Progress', defaultScore: 6,  grade: 'C', color: 'amber'   },
    ],
    subjects: [],
    display: { showScore: true, showGrade: true, showSubjectAvg: true, showOverallAvg: true },
  };
}

/* ── Toast ───────────────────────────────────────────────────── */
function Toast({ msg, type, onDismiss }) {
  const isErr = type === 'error';
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium shadow-sm ${
        isErr ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }`}
    >
      {isErr ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      {msg}
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100"><X size={12} /></button>
    </motion.div>
  );
}

/* ── ColorDot picker ─────────────────────────────────────────── */
function ColorPicker({ value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1">
      {BAND_COLORS.map(c => (
        <button
          key={c} type="button" onClick={() => onChange(c)}
          title={c}
          className={`w-4 h-4 rounded-full border-2 transition ${BAND_DOT[c] ?? 'bg-slate-400'} ${
            value === c ? 'border-slate-800 scale-125' : 'border-transparent hover:scale-110'
          }`}
        />
      ))}
    </div>
  );
}

/* ── BandRow ─────────────────────────────────────────────────── */
function BandRow({ band, onChange, onRemove }) {
  return (
    <div className="grid grid-cols-[1fr_72px_54px_auto_28px] gap-2 items-center py-1.5 px-2 rounded-lg bg-slate-50 border border-slate-100">
      <input
        type="text" value={band.label}
        onChange={e => onChange({ ...band, label: e.target.value })}
        placeholder="e.g. Excellent"
        maxLength={60}
        className="text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
      />
      <div className="relative">
        <input
          type="number" min="0" max="100" step="1"
          value={band.defaultScore}
          onChange={e => onChange({ ...band, defaultScore: Number(e.target.value) })}
          className="w-full text-sm text-right border border-slate-200 rounded-lg px-2 py-1.5 pr-5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
        />
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 text-[10px] pointer-events-none">pts</span>
      </div>
      <input
        type="text" value={band.grade}
        onChange={e => onChange({ ...band, grade: e.target.value.toUpperCase().slice(0, 6) })}
        placeholder="A"
        maxLength={6}
        className="text-sm font-bold text-center border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
      />
      <ColorPicker value={band.color} onChange={color => onChange({ ...band, color })} />
      <button
        type="button" onClick={onRemove}
        className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition"
        title="Remove band"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

/* ── IndicatorRow ────────────────────────────────────────────── */
function IndicatorRow({ indicator, onChange, onRemove }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <GripVertical size={13} className="mt-2.5 text-slate-300 shrink-0" />
      <input
        type="text"
        value={indicator.text}
        onChange={e => onChange({ ...indicator, text: e.target.value })}
        placeholder="e.g. Able to identify and name the five senses"
        maxLength={400}
        className="flex-1 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
      />
      <button
        type="button" onClick={onRemove}
        className="mt-1.5 p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition shrink-0"
        title="Remove indicator"
      >
        <X size={11} />
      </button>
    </div>
  );
}

/* ── SubjectEditor ───────────────────────────────────────────── */
function SubjectEditor({ subject, onChange, onRemove }) {
  const [expanded, setExpanded] = useState(true);

  function addIndicator() {
    onChange({
      ...subject,
      indicators: [...subject.indicators, { _uid: uid(), text: '', order: subject.indicators.length }],
    });
  }

  function updateIndicator(uId, updated) {
    onChange({ ...subject, indicators: subject.indicators.map(i => i._uid === uId ? updated : i) });
  }

  function removeIndicator(uId) {
    onChange({ ...subject, indicators: subject.indicators.filter(i => i._uid !== uId) });
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {/* Subject header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50">
        <BookOpen size={13} className="text-slate-400 shrink-0" />
        <input
          type="text"
          value={subject.name}
          onChange={e => onChange({ ...subject, name: e.target.value })}
          placeholder="Subject name e.g. Science"
          maxLength={100}
          className="flex-1 text-sm font-medium bg-transparent border-0 focus:outline-none text-slate-800 placeholder:text-slate-400"
        />
        <span className="text-[10px] text-slate-400">{subject.indicators.length} indicator{subject.indicators.length !== 1 ? 's' : ''}</span>
        <button
          type="button" onClick={() => setExpanded(e => !e)}
          className="p-1 text-slate-400 hover:text-slate-700 rounded transition"
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        <button
          type="button" onClick={onRemove}
          className="p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded transition"
          title="Remove subject"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Indicators */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-0.5">
          {subject.indicators.length === 0 && (
            <p className="text-xs text-slate-400 italic py-2 text-center">No indicators yet — add one below</p>
          )}
          {subject.indicators.map(ind => (
            <IndicatorRow
              key={ind._uid}
              indicator={ind}
              onChange={updated => updateIndicator(ind._uid, updated)}
              onRemove={() => removeIndicator(ind._uid)}
            />
          ))}
          <button
            type="button"
            onClick={addIndicator}
            className="mt-1 flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg transition"
          >
            <Plus size={11} /> Add indicator
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Section accordion ───────────────────────────────────────── */
function Section({ title, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          {Icon && <Icon size={14} className="text-slate-500" />}
          {title}
        </span>
        {open ? <ChevronUp size={13} className="text-slate-400" /> : <ChevronDown size={13} className="text-slate-400" />}
      </button>
      {open && <div className="px-4 py-4 space-y-3">{children}</div>}
    </div>
  );
}

/* ── ToggleSwitch ────────────────────────────────────────────── */
function ToggleSwitch({ label, checked, onChange }) {
  return (
    <label className="flex items-center justify-between py-1.5 cursor-pointer group">
      <span className="text-sm text-slate-600 group-hover:text-slate-800 transition">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-indigo-600' : 'bg-slate-200'
        }`}
      >
        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4.5' : 'translate-x-0.5'
        }`} />
      </button>
    </label>
  );
}

/* ── TemplateSlideOver ───────────────────────────────────────── */
function TemplateSlideOver({ initial, classes, onSave, onClose, saving }) {
  const isNew = !initial?.id;
  const [form, setForm] = useState(() => {
    if (!initial) return emptyTemplate();
    // Normalize bands and subjects from DB (add _uid for React key)
    return {
      ...initial,
      performanceBands: (initial.performanceBands ?? []).map(b => ({ ...b, _uid: b.id || uid() })),
      subjects: (initial.subjects ?? []).map(s => ({
        ...s,
        _uid: s.id || uid(),
        indicators: (s.indicators ?? []).map(i => ({ ...i, _uid: i.id || uid() })),
      })),
    };
  });

  /* ── Band helpers ── */
  function addBand() {
    setForm(f => ({
      ...f,
      performanceBands: [
        ...f.performanceBands,
        { _uid: uid(), label: '', defaultScore: 5, grade: '', color: 'slate' },
      ],
    }));
  }
  function updateBand(uId, updated) {
    setForm(f => ({ ...f, performanceBands: f.performanceBands.map(b => b._uid === uId ? updated : b) }));
  }
  function removeBand(uId) {
    setForm(f => ({ ...f, performanceBands: f.performanceBands.filter(b => b._uid !== uId) }));
  }

  /* ── Subject helpers ── */
  function addSubject() {
    setForm(f => ({
      ...f,
      subjects: [...f.subjects, { _uid: uid(), name: '', order: f.subjects.length, indicators: [] }],
    }));
  }
  function updateSubject(uId, updated) {
    setForm(f => ({ ...f, subjects: f.subjects.map(s => s._uid === uId ? updated : s) }));
  }
  function removeSubject(uId) {
    setForm(f => ({ ...f, subjects: f.subjects.filter(s => s._uid !== uId) }));
  }

  /* ── Class toggle ── */
  function toggleClass(classId) {
    setForm(f => {
      const has = f.classIds.includes(classId);
      return { ...f, classIds: has ? f.classIds.filter(id => id !== classId) : [...f.classIds, classId] };
    });
  }

  /* ── Display toggle ── */
  function toggleDisplay(key) {
    setForm(f => ({ ...f, display: { ...f.display, [key]: !f.display[key] } }));
  }

  /* ── Submit ── */
  function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim())              return;
    if (form.performanceBands.length === 0) return;

    // Strip _uid before sending to server
    const payload = {
      ...form,
      performanceBands: form.performanceBands.map(({ _uid, ...b }) => b),
      subjects: form.subjects.map(({ _uid, ...s }) => ({
        ...s,
        indicators: s.indicators.map(({ _uid: _i, ...i }) => i),
      })),
    };
    onSave(payload);
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
      />
      {/* Panel */}
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 35 }}
        className="fixed inset-y-0 right-0 w-full max-w-2xl bg-white shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <LayoutTemplate size={16} className="text-indigo-600" />
            <h2 className="text-base font-semibold text-slate-900">
              {isNew ? 'New Report Card Template' : `Edit: ${initial.name}`}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* ── Basic Info ── */}
          <Section title="Basic Information" icon={Tag} defaultOpen>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Template name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. KG Competency Report"
                  maxLength={150}
                  required
                  className={iCls()}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional — describe when this template is used"
                  maxLength={500}
                  rows={2}
                  className={`${iCls()} resize-none`}
                />
              </div>
              {/* Status toggle */}
              <div className="flex items-center justify-between py-1 border-t border-slate-100">
                <div>
                  <p className="text-sm font-medium text-slate-700">Status</p>
                  <p className="text-xs text-slate-400">Active templates are available for assessment entry</p>
                </div>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, status: f.status === 'active' ? 'draft' : 'active' }))}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${
                    form.status === 'active'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-50 text-slate-500 border-slate-200'
                  }`}
                >
                  {form.status === 'active' ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                  {form.status === 'active' ? 'Active' : 'Draft'}
                </button>
              </div>
            </div>
          </Section>

          {/* ── Performance Bands ── */}
          <Section title="Performance Bands" icon={Tag} defaultOpen>
            <p className="text-xs text-slate-400 -mt-1 mb-2">
              When a teacher selects a band, the default score auto-fills. Grade is the letter assigned.
            </p>

            {/* Column headers */}
            <div className="grid grid-cols-[1fr_72px_54px_auto_28px] gap-2 px-2 mb-1">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Band label</span>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-right">Score</span>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide text-center">Grade</span>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Colour</span>
              <span />
            </div>

            <div className="space-y-1.5">
              {form.performanceBands.map(band => (
                <BandRow
                  key={band._uid}
                  band={band}
                  onChange={updated => updateBand(band._uid, updated)}
                  onRemove={() => removeBand(band._uid)}
                />
              ))}
            </div>

            {form.performanceBands.length === 0 && (
              <p className="text-xs text-slate-400 italic text-center py-2">At least one band is required</p>
            )}

            <button
              type="button" onClick={addBand}
              className="mt-2 flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg border border-slate-200 transition"
            >
              <Plus size={11} /> Add band
            </button>

            {/* Preview */}
            {form.performanceBands.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Preview</p>
                <div className="flex flex-wrap gap-1.5">
                  {form.performanceBands.map(b => (
                    <span
                      key={b._uid}
                      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border ${
                        BAND_PILL[b.color] ?? BAND_PILL.slate
                      }`}
                    >
                      {b.label || '—'}
                      {b.grade && <span className="opacity-60">→ {b.grade}</span>}
                      <span className="opacity-50">({b.defaultScore}pts)</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* ── Subjects & Indicators ── */}
          <Section title="Subjects & Learning Indicators" icon={BookOpen} defaultOpen>
            <p className="text-xs text-slate-400 -mt-1 mb-3">
              Add subjects and the specific "Able to…" competencies assessed under each.
            </p>
            <div className="space-y-2">
              {form.subjects.map(subj => (
                <SubjectEditor
                  key={subj._uid}
                  subject={subj}
                  onChange={updated => updateSubject(subj._uid, updated)}
                  onRemove={() => removeSubject(subj._uid)}
                />
              ))}
            </div>
            {form.subjects.length === 0 && (
              <div className="text-center py-4 rounded-xl border-2 border-dashed border-slate-200">
                <BookOpen size={18} className="mx-auto text-slate-300 mb-1" />
                <p className="text-xs text-slate-400">No subjects yet — add your first subject below</p>
              </div>
            )}
            <button
              type="button" onClick={addSubject}
              className="mt-2 flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-200 transition"
            >
              <Plus size={12} /> Add subject
            </button>
          </Section>

          {/* ── Assign to Classes ── */}
          <Section title="Assign to Classes" icon={LayoutTemplate} defaultOpen={false}>
            <p className="text-xs text-slate-400 -mt-1 mb-3">
              Select which classes will use this template. A class can only have one active template.
            </p>
            {classes.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No classes found — create classes first.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {classes.map(cls => {
                  const active = form.classIds.includes(cls.id ?? cls._id?.toString());
                  const cId    = cls.id ?? cls._id?.toString();
                  return (
                    <button
                      key={cId}
                      type="button"
                      onClick={() => toggleClass(cId)}
                      className={`text-left px-3 py-2 rounded-lg border text-sm transition ${
                        active
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-700 font-medium'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      {cls.name}
                      {active && <span className="ml-1 text-indigo-400">✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </Section>

          {/* ── Display Options ── */}
          <Section title="Display Options" icon={Eye} defaultOpen={false}>
            <p className="text-xs text-slate-400 -mt-1 mb-1">
              Choose which columns appear on the printed report card.
            </p>
            <div className="divide-y divide-slate-100">
              <ToggleSwitch label="Show raw score column"    checked={form.display.showScore}      onChange={() => toggleDisplay('showScore')} />
              <ToggleSwitch label="Show grade column"        checked={form.display.showGrade}      onChange={() => toggleDisplay('showGrade')} />
              <ToggleSwitch label="Show subject average"     checked={form.display.showSubjectAvg} onChange={() => toggleDisplay('showSubjectAvg')} />
              <ToggleSwitch label="Show overall average"     checked={form.display.showOverallAvg} onChange={() => toggleDisplay('showOverallAvg')} />
            </div>
          </Section>

          {/* Info note */}
          <div className="flex items-start gap-2 p-3 bg-slate-50 border border-slate-100 rounded-lg text-xs text-slate-500">
            <Info size={13} className="mt-0.5 shrink-0 text-slate-400" />
            <span>
              Set status to <strong className="text-slate-700">Active</strong> once the template is ready — teachers can only use active templates.
              Draft templates are invisible to teachers.
            </span>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between shrink-0 bg-white">
          <button
            type="button" onClick={onClose}
            className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2 rounded-lg hover:bg-slate-100 transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !form.name.trim() || form.performanceBands.length === 0}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving…' : isNew ? 'Create template' : 'Save changes'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ── TemplateCard ────────────────────────────────────────────── */
function TemplateCard({ template, onEdit, onDelete, deleting }) {
  const subjectCount   = template.subjects?.length ?? 0;
  const indicatorCount = (template.subjects ?? []).reduce((s, sub) => s + (sub.indicators?.length ?? 0), 0);
  const classCount     = template.classIds?.length ?? 0;

  return (
    <div className={`rounded-xl border transition ${
      template.status === 'active' ? 'border-emerald-200 bg-emerald-50/20' : 'border-slate-200 bg-white'
    }`}>
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-800 truncate">{template.name}</p>
            <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
              template.status === 'active'
                ? 'text-emerald-700 bg-emerald-100 border-emerald-200'
                : 'text-slate-500 bg-slate-100 border-slate-200'
            }`}>
              {template.status === 'active' ? 'Active' : 'Draft'}
            </span>
          </div>
          {template.description && (
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{template.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
            <span>{subjectCount} subject{subjectCount !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>{indicatorCount} indicator{indicatorCount !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>{classCount} class{classCount !== 1 ? 'es' : ''} assigned</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onEdit(template)}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition"
          >
            <Pencil size={11} /> Edit
          </button>
          <button
            onClick={() => onDelete(template.id)}
            disabled={deleting}
            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
            title="Delete template"
          >
            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          </button>
        </div>
      </div>

      {/* Band preview */}
      {(template.performanceBands ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 pb-3">
          {template.performanceBands.map((b, i) => (
            <span key={i} className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded border ${
              BAND_PILL[b.color] ?? BAND_PILL.slate
            }`}>
              {b.label}
              {b.grade && <span className="opacity-60">→ {b.grade}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Main export
   ══════════════════════════════════════════════════════════════ */
export default function RCTemplatesSection() {
  const qc = useQueryClient();
  const [toast,      setToast]      = useState(null);
  const [editTarget, setEditTarget] = useState(undefined); // undefined = closed, null = new, obj = edit
  const [deletingId, setDeletingId] = useState(null);

  /* ── Data ── */
  const { data: tmplData, isLoading } = useQuery({
    queryKey:  ['rc-templates'],
    queryFn:   () => api.list(),
    staleTime: 2 * 60_000,
  });
  const templates = tmplData?.data ?? [];

  const { data: clsData } = useQuery({
    queryKey:  ['classes', { limit: 200 }],
    queryFn:   () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60_000,
  });
  const classes = (clsData?.data ?? []).map(c => ({ ...c, id: c.id || c._id?.toString() }));

  /* ── Mutations ── */
  const { mutate: createTmpl, isPending: creating } = useMutation({
    mutationFn: data => api.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rc-templates'] });
      setEditTarget(undefined);
      setToast({ msg: 'Template created.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to create template.', type: 'error' }),
  });

  const { mutate: updateTmpl, isPending: updating } = useMutation({
    mutationFn: ({ id, data }) => api.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rc-templates'] });
      setEditTarget(undefined);
      setToast({ msg: 'Template saved.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save template.', type: 'error' }),
  });

  const { mutate: deleteTmpl } = useMutation({
    mutationFn: id => api.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rc-templates'] });
      setDeletingId(null);
      setToast({ msg: 'Template deleted.', type: 'success' });
    },
    onError: err => {
      setDeletingId(null);
      setToast({ msg: err?.message ?? 'Failed to delete template.', type: 'error' });
    },
  });

  function handleSave(payload) {
    if (editTarget?.id) {
      updateTmpl({ id: editTarget.id, data: payload });
    } else {
      createTmpl(payload);
    }
  }

  function handleDelete(id) {
    setDeletingId(id);
    deleteTmpl(id);
  }

  const saving = creating || updating;

  return (
    <div className="space-y-4">
      {/* Toast */}
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* Header card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Report Card Templates</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Define competency-based report card templates for early-childhood and KG classes.
              Each template specifies the performance bands, subjects, and learning indicators teachers assess.
            </p>
          </div>
          <button
            onClick={() => setEditTarget(null)}
            className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 px-3 py-1.5 rounded-lg transition"
          >
            <Plus size={12} /> New template
          </button>
        </div>

        {/* Template list */}
        <div className="mt-5">
          {isLoading ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-20 rounded-xl bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : templates.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-slate-200 p-8 flex flex-col items-center gap-2 text-center">
              <LayoutTemplate size={22} className="text-slate-300" />
              <p className="text-sm text-slate-500 font-medium">No templates yet</p>
              <p className="text-xs text-slate-400">
                Create a template to start using competency-based assessments for KG and early-childhood classes.
              </p>
              <button
                onClick={() => setEditTarget(null)}
                className="mt-2 flex items-center gap-1.5 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition"
              >
                <Plus size={11} /> Create first template
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map(t => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  onEdit={tmpl => setEditTarget(tmpl)}
                  onDelete={handleDelete}
                  deleting={deletingId === t.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Slide-over */}
      <AnimatePresence>
        {editTarget !== undefined && (
          <TemplateSlideOver
            initial={editTarget}
            classes={classes}
            onSave={handleSave}
            onClose={() => setEditTarget(undefined)}
            saving={saving}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
