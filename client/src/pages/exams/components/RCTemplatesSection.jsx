/* ============================================================
   RCTemplatesSection — competency-based report card templates for
   Kindergarten / early-childhood classes. Admin-only. Accessed from
   Exams' own top-level "Kindergarten Templates" tab (ExamsPage.jsx),
   alongside Configuration — moved there from Report Cards (2026-10-13),
   raised directly: the template defines the Markbook's indicator-entry
   structure (performance bands, which subjects use it), so it belongs
   with the rest of assessment configuration, not with report-card
   generation — Report Cards only ever CONSUMES a template via
   resolveRcTemplate, it never configured one. (Before that it had
   already moved out of Settings entirely, after an earlier move had
   only gotten it as far as a Settings sub-tab — see git history for
   that step.) Still its own API/data model (`/rc-templates`), not
   merged with RC11's layoutKey registry — see the Report Card Template
   Engine plan's explicit decision to defer a real Kindergarten
   renderer/scoring UI (that deferral was about the RENDERER, not
   about where this config screen lives).

   Indicator TEXT moved OUT of this screen (2026-10-19, direct
   request): "whoever is setting the template is like an admin, he
   doesn't know all the indicators per subject, and these indicators
   vary depending on what content was set." This screen still assigns
   WHICH subjects use indicator-based entry and their performance
   bands — genuinely school-wide, admin-owned config — but the actual
   "Able to..." competency text is now added by the subject teacher
   directly in the Markbook (IndicatorMarkbook.jsx), scoped per
   class+subject+term so it can vary with whatever was actually
   taught. See server/routes/indicator-marks.js's header for the full
   rationale and the new /definitions endpoints.

   Schema extensions (2026-10, same milestone), confirmed against real
   competency-band report samples rather than assumed: an optional
   per-subject `performanceBands` override (SubjectEditor's toggle —
   the same band label can be worth a different score in a different
   subject), and `sectionId`/`isDefault` section-scoping (the "Default
   for a whole section" picker below "Assign to Classes") — mirrors
   grade-scale.js's resolveGradeScale convention via
   server/utils/rc-template-scale.js's resolveRcTemplate, rather than
   a third scoping pattern.
   ============================================================ */
import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, X, Save, Trash2, Loader2, CheckCircle2, AlertTriangle,
  ChevronDown, ChevronUp, LayoutTemplate, Pencil,
  BookOpen, Tag, ToggleLeft, ToggleRight, Info, Eye,
} from 'lucide-react';
import { rcTemplates as api, classes as classesApi, subjects as subjectsApi, classSubjects as classSubjectsApi } from '@/api/client.js';
import { useSections } from '@/hooks/useSections.js';

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
    sectionId: null,
    isDefault: false,
    performanceBands: [
      { _uid: uid(), label: 'Excellent',   defaultScore: 10, grade: 'A', color: 'emerald' },
      { _uid: uid(), label: 'Good',        defaultScore: 8,  grade: 'B', color: 'blue'    },
      { _uid: uid(), label: 'In Progress', defaultScore: 6,  grade: 'C', color: 'amber'   },
    ],
    subjects: [],
    display: { showScore: true, showGrade: true, showSubjectAvg: true, showOverallAvg: true },
    // Band-only scoring (2026-10-23, direct request): off by default — a
    // teacher types a score as before unless a template (or a specific
    // subject within it) opts in. See SubjectEditor's own override below.
    bandOnlyScoring: false,
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

/* Every band the server will accept needs a non-empty label AND grade
   (BandSchema: `grade: z.string().min(1)...`) — reported directly: a
   template update 422'd with a raw "performanceBands.3.grade — String
   must contain at least 1 character(s)" after adding 2 new bands and
   not yet typing their grade. addBand() seeds `grade: ''`, and nothing
   client-side ever checked that before hitting Save, so the only
   feedback was that cryptic server message, pointing at an array index
   rather than a visible row. Used to both gate Save and highlight the
   exact empty inputs inline. */
function bandsIncomplete(bands) {
  return (bands ?? []).some(b => !b.label?.trim() || !b.grade?.trim());
}

/* ── BandRow ─────────────────────────────────────────────────── */
function BandRow({ band, onChange, onRemove }) {
  const labelEmpty = !band.label?.trim();
  const gradeEmpty = !band.grade?.trim();
  return (
    <div className="grid grid-cols-[1fr_72px_54px_auto_28px] gap-2 items-center py-1.5 px-2 rounded-lg bg-slate-50 border border-slate-100">
      <input
        type="text" value={band.label}
        onChange={e => onChange({ ...band, label: e.target.value })}
        placeholder="e.g. Excellent"
        maxLength={60}
        title={labelEmpty ? 'Required — every band needs a label' : undefined}
        className={`text-sm border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 ${
          labelEmpty ? 'border-red-300 focus:ring-red-400/40 bg-red-50/40' : 'border-slate-200 focus:ring-indigo-400/40'
        }`}
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
        title={gradeEmpty ? 'Required — every band needs a grade' : undefined}
        className={`text-sm font-bold text-center border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 ${
          gradeEmpty ? 'border-red-300 focus:ring-red-400/40 bg-red-50/40' : 'border-slate-200 focus:ring-indigo-400/40'
        }`}
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

/* ── SubjectEditor ───────────────────────────────────────────── */
function SubjectEditor({ subject, templateBands, templateBandOnly, subjectOptions, onChange, onRemove }) {
  const [expanded, setExpanded] = useState(true);
  const hasOverride = Array.isArray(subject.performanceBands);
  // Band-only override — undefined means "inherit the template's own
  // bandOnlyScoring," same convention as the bands override above.
  const bandOnlyHasOverride = subject.bandOnlyScoring != null;
  const effectiveBandOnly = bandOnlyHasOverride ? subject.bandOnlyScoring : templateBandOnly;

  // Linked to a real subjects-collection record (required, 2026-10) —
  // without this there is no teaching_assignments row to check, so
  // nothing could scope WHO may enter marks for this template subject.
  function selectSubject(subjectId) {
    const s = subjectOptions.find(o => (o.id ?? o._id) === subjectId);
    onChange({ ...subject, subjectId, name: s?.name ?? '' });
  }

  // Confirmed against a real sample (2026-10) — the same band label can
  // be worth a different score in different subjects (e.g. Science's
  // "Excellent" ≠ Literacy's "Excellent" in the same report). Off by
  // default (undefined, not an empty array — the server treats those
  // differently: undefined means "use the template's bands," an empty
  // array would mean "this subject has zero bands").
  function toggleOverride() {
    if (hasOverride) {
      onChange({ ...subject, performanceBands: undefined });
    } else {
      onChange({
        ...subject,
        performanceBands: templateBands.map(b => ({ ...b, _uid: uid(), id: undefined })),
      });
    }
  }
  function addBand() {
    onChange({
      ...subject,
      performanceBands: [...subject.performanceBands, { _uid: uid(), label: '', defaultScore: 5, grade: '', color: 'slate' }],
    });
  }
  function updateBand(uId, updated) {
    onChange({ ...subject, performanceBands: subject.performanceBands.map(b => b._uid === uId ? updated : b) });
  }
  function removeBand(uId) {
    onChange({ ...subject, performanceBands: subject.performanceBands.filter(b => b._uid !== uId) });
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {/* Subject header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-slate-50">
        <BookOpen size={13} className="text-slate-400 shrink-0" />
        <select
          value={subject.subjectId ?? ''}
          onChange={e => selectSubject(e.target.value)}
          className="flex-1 text-sm font-medium bg-transparent border-0 focus:outline-none text-slate-800"
        >
          <option value="" disabled>Select a subject…</option>
          {subjectOptions.map(s => {
            const sId = s.id ?? s._id;
            return <option key={sId} value={sId}>{s.name}</option>;
          })}
        </select>
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

      {/* Indicators are no longer configured here (2026-10-19, direct
          request) — the admin doesn't know every subject's actual
          content for the term, and it varies, so indicator TEXT is now
          added directly by the subject teacher in the Markbook. This
          panel only assigns the subject to competency-based entry and
          its (optional) performance-band override. */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-0.5">
          <p className="text-xs text-slate-400 italic py-2 text-center">
            Learning indicators for this subject are added by the subject teacher directly in the Markbook — not here.
          </p>

          {/* Per-subject band override */}
          <div className="mt-3 pt-3 border-t border-slate-100">
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-xs text-slate-500 group-hover:text-slate-700 transition">
                Use different performance bands for {subject.name || 'this subject'}
              </span>
              <button
                type="button"
                onClick={toggleOverride}
                className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors shrink-0 ${
                  hasOverride ? 'bg-indigo-600' : 'bg-slate-200'
                }`}
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                  hasOverride ? 'translate-x-4' : 'translate-x-0.5'
                }`} />
              </button>
            </label>

            {hasOverride && (
              <div className="mt-2 space-y-1.5">
                {subject.performanceBands.map(band => (
                  <BandRow key={band._uid} band={band} onChange={updated => updateBand(band._uid, updated)} onRemove={() => removeBand(band._uid)} />
                ))}
                <button
                  type="button" onClick={addBand}
                  className="flex items-center gap-1.5 text-[11px] text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-2 py-1 rounded-lg border border-slate-200 transition"
                >
                  <Plus size={10} /> Add band for this subject
                </button>
                {bandsIncomplete(subject.performanceBands) && (
                  <p className="text-[11px] text-red-600">Every band needs both a label and a grade (highlighted above) before you can save.</p>
                )}
              </div>
            )}
          </div>

          {/* Per-subject band-only override — independent of the bands
              override above: a subject can use its own band LIST while
              still typing scores, or use the template's bands while
              skipping the number entirely. Starts as "inherit the
              template"; touching it sets an explicit value for this
              subject from then on, same as every other per-subject
              override on this screen. */}
          <div className="mt-3 pt-3 border-t border-slate-100">
            <label className="flex items-center justify-between cursor-pointer group">
              <span className="text-xs text-slate-500 group-hover:text-slate-700 transition">
                Band-only entry for {subject.name || 'this subject'} — no number typed, just the band
                {!bandOnlyHasOverride && <span className="ml-1 text-slate-400">(following template)</span>}
              </span>
              <button
                type="button"
                onClick={() => onChange({ ...subject, bandOnlyScoring: !effectiveBandOnly })}
                className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors shrink-0 ${
                  effectiveBandOnly ? 'bg-indigo-600' : 'bg-slate-200'
                }`}
                title="Toggling sets an explicit value for this subject, independent of the template from then on"
              >
                <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                  effectiveBandOnly ? 'translate-x-4' : 'translate-x-0.5'
                }`} />
              </button>
            </label>
          </div>
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
function TemplateSlideOver({ initial, classes, subjectOptions, onSave, onClose, saving }) {
  const isNew = !initial?.id;
  const { sections } = useSections();
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
        // Keep as undefined when the subject has no override — distinct
        // from an empty array, which the server reads as "zero bands,"
        // not "use the template's."
        performanceBands: s.performanceBands?.length
          ? s.performanceBands.map(b => ({ ...b, _uid: b.id || uid() }))
          : undefined,
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
      subjects: [...f.subjects, { _uid: uid(), subjectId: '', name: '', order: f.subjects.length, indicators: [] }],
    }));
  }
  function updateSubject(uId, updated) {
    setForm(f => ({ ...f, subjects: f.subjects.map(s => s._uid === uId ? updated : s) }));
  }
  function removeSubject(uId) {
    setForm(f => ({ ...f, subjects: f.subjects.filter(s => s._uid !== uId) }));
  }

  /* ── Load subjects from curriculum (class_subjects) — the class(es)
     already assigned above (Assign to Classes) have a real curriculum;
     this is a one-time "starting point" pull, not an ongoing sync, so a
     subject later removed from curriculum never silently deletes
     indicators an admin already configured here. Only ADDS subjects not
     already present (matched by subjectId) — never removes or
     overwrites. Needs at least one specific classId (not just a section
     default) since that's what class_subjects is keyed on. */
  const [loadingCurriculum, setLoadingCurriculum] = useState(false);
  const [curriculumMsg, setCurriculumMsg] = useState('');
  async function loadFromCurriculum() {
    if (form.classIds.length === 0 || loadingCurriculum) return;
    setLoadingCurriculum(true);
    setCurriculumMsg('');
    try {
      const results = await Promise.all(form.classIds.map(id => classSubjectsApi.list({ classId: id })));
      const bySubjectId = new Map();
      for (const res of results) {
        for (const link of res?.data ?? []) {
          if (link.subject?.id && !bySubjectId.has(link.subject.id)) bySubjectId.set(link.subject.id, link.subject);
        }
      }
      let added = 0;
      setForm(f => {
        const existingIds = new Set(f.subjects.map(s => s.subjectId));
        const toAdd = [...bySubjectId.values()].filter(s => !existingIds.has(s.id));
        added = toAdd.length;
        if (toAdd.length === 0) return f;
        return {
          ...f,
          subjects: [
            ...f.subjects,
            ...toAdd.map((s, i) => ({ _uid: uid(), subjectId: s.id, name: s.name, order: f.subjects.length + i, indicators: [] })),
          ],
        };
      });
      setCurriculumMsg(added > 0 ? `Added ${added} subject${added === 1 ? '' : 's'} from curriculum.` : 'Every curriculum subject is already listed below.');
    } catch {
      setCurriculumMsg('Could not load curriculum — try again.');
    } finally {
      setLoadingCurriculum(false);
    }
  }

  /* ── Scope the "Add subject" dropdown to the assigned class(es)' real
     curriculum, live — reported directly: picking a subject offered every
     subject in the whole school, not just the ones this class/these
     classes actually teach. Same source as "Load from curriculum" above,
     kept reactive (re-fetches whenever classIds changes) rather than a
     one-shot button click, since this has to stay correct as the admin
     ticks classes on/off above. Falls back to the full school-wide list
     only when zero classes are assigned yet (a pure section-default
     template has no single class curriculum to scope against — there is
     no stream-level curriculum concept anywhere in this codebase either;
     class_subjects is keyed on classId only, so "subjects for this
     stream" is really "subjects for this class," identical across every
     stream of it). */
  const { data: curriculumLinksData } = useQuery({
    queryKey: ['rc-template-curriculum-scope', form.classIds],
    queryFn:  () => Promise.all(form.classIds.map(id => classSubjectsApi.list({ classId: id }))),
    enabled:  form.classIds.length > 0,
    staleTime: 60_000,
  });
  const curriculumSubjectIds = useMemo(() => {
    if (form.classIds.length === 0) return null; // null = no scope, show every subject
    const ids = new Set();
    for (const res of curriculumLinksData ?? []) {
      for (const link of res?.data ?? []) {
        if (link.subject?.id) ids.add(link.subject.id);
      }
    }
    return ids;
  }, [curriculumLinksData, form.classIds.length]);
  const scopedSubjectOptions = curriculumSubjectIds
    ? subjectOptions.filter(s => curriculumSubjectIds.has(s.id ?? s._id))
    : subjectOptions;
  // A subject already picked before its class was changed (or before this
  // scoping existed) must stay visible/selected in its own row even if it
  // has since fallen out of scope — never silently hide an existing choice.
  function optionsForRow(subjectId) {
    if (!curriculumSubjectIds || !subjectId || curriculumSubjectIds.has(subjectId)) return scopedSubjectOptions;
    const current = subjectOptions.find(s => (s.id ?? s._id) === subjectId);
    return current ? [current, ...scopedSubjectOptions] : scopedSubjectOptions;
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

  // Template bands plus every subject's own override bands (if any) —
  // the server validates both arrays the same way, so Save must gate on
  // both, not just the template-level list.
  const bandsAreIncomplete = bandsIncomplete(form.performanceBands)
    || form.subjects.some(s => s.performanceBands && bandsIncomplete(s.performanceBands));

  /* ── Submit ── */
  function handleSubmit(e) {
    e.preventDefault();
    if (!form.name.trim())              return;
    if (form.performanceBands.length === 0) return;
    if (bandsAreIncomplete)             return; // every band needs a label AND a grade — see bandsIncomplete()
    if (form.isDefault && !form.sectionId) return; // same guard as the server
    if (form.subjects.some(s => !s.subjectId)) return; // every subject must be linked to a real one

    // Strip _uid before sending to server
    const payload = {
      ...form,
      performanceBands: form.performanceBands.map(({ _uid, ...b }) => b),
      subjects: form.subjects.map(({ _uid, ...s }) => ({
        ...s,
        indicators: s.indicators.map(({ _uid: _i, ...i }) => i),
        performanceBands: s.performanceBands?.map(({ _uid: _b, ...b }) => b),
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
              {isNew ? 'New Kindergarten Template' : `Edit: ${initial.name}`}
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

          {/* ── Assign to Classes — moved here, right after naming the
             template (2026-10-14): reported directly, the admin should
             pick WHICH class(es) this template is for before picking
             subjects, not after — so the subject picker below can be
             scoped to the real curriculum of whatever's chosen here,
             instead of offering every subject in the school. ── */}
          <Section title="Assign to Classes" icon={LayoutTemplate} defaultOpen>
            {/* Section default — resolves for EVERY class in the section
                that isn't explicitly listed below, same convention the
                RC11 layout-template registry already uses (section
                default → explicit override wins). Mirrors grade scales:
                set once for "Kindergarten," new KG classes pick it up
                automatically, no need to remember to add them below. */}
            <div className="mb-4 pb-4 border-b border-slate-100 space-y-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Default for a whole section (optional)</label>
                <select
                  value={form.sectionId ?? ''}
                  onChange={e => setForm(f => ({ ...f, sectionId: e.target.value || null, isDefault: e.target.value ? f.isDefault : false }))}
                  className={iCls()}
                >
                  <option value="">No section default — assign to specific classes only</option>
                  {sections.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              {form.sectionId && (
                <label className="flex items-center justify-between py-1 cursor-pointer group">
                  <span className="text-xs text-slate-500 group-hover:text-slate-700 transition">
                    Make this the default — applies to every class in this section, except classes listed below in another template
                  </span>
                  <button
                    type="button"
                    onClick={() => setForm(f => ({ ...f, isDefault: !f.isDefault }))}
                    className={`relative inline-flex h-4.5 w-8 items-center rounded-full transition-colors shrink-0 ${
                      form.isDefault ? 'bg-indigo-600' : 'bg-slate-200'
                    }`}
                  >
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                      form.isDefault ? 'translate-x-4' : 'translate-x-0.5'
                    }`} />
                  </button>
                </label>
              )}
            </div>

            <p className="text-xs text-slate-400 -mt-1 mb-3">
              Select which SPECIFIC classes will use this template — these win over any section default above. A class can only have one active template.
              {' '}Picking a class here scopes the subject picker further down to that class's own curriculum.
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

          {/* ── Performance Bands ── */}
          <Section title="Performance Bands" icon={Tag} defaultOpen>
            <p className="text-xs text-slate-400 -mt-1 mb-2">
              When a teacher selects a band, the default score auto-fills. Grade is the letter assigned.
            </p>

            {/* Band-only scoring (2026-10-23, direct request) — off by
                default. A subject can override this independently
                (SubjectEditor below), same convention as its own bands. */}
            <div className="mb-3 pb-3 border-b border-slate-100">
              <ToggleSwitch
                label="Band-only entry — teachers pick a band, no score is typed. The subject's grade comes from the band itself, not a numeric percentage."
                checked={form.bandOnlyScoring}
                onChange={v => setForm(f => ({ ...f, bandOnlyScoring: v }))}
              />
            </div>

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
            {bandsIncomplete(form.performanceBands) && (
              <p className="text-xs text-red-600 mt-1.5">Every band needs both a label and a grade (highlighted above) before you can save.</p>
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

          {/* ── Subjects (competency-based entry) ── */}
          <Section title="Subjects" icon={BookOpen} defaultOpen>
            <p className="text-xs text-slate-400 -mt-1 mb-3">
              Add the subjects that use competency-band entry for this class. The subject teacher adds the actual "Able to…" indicators directly in the Markbook each term — not here, since only they know what was actually taught.
              {form.classIds.length === 0
                ? ' Assign a class above (Assign to Classes) to scope this list to its real curriculum, or add subjects manually here.'
                : curriculumSubjectIds?.size === 0
                  ? ' The class(es) assigned above have no subjects in their curriculum yet — set that up in Subjects & Departments, or add one manually below.'
                  : ' Scoped to the curriculum of the class(es) assigned above.'}
            </p>
            <div className="space-y-2">
              {form.subjects.map(subj => (
                <SubjectEditor
                  key={subj._uid}
                  subject={subj}
                  templateBands={form.performanceBands}
                  templateBandOnly={form.bandOnlyScoring}
                  subjectOptions={optionsForRow(subj.subjectId)}
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
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <button
                type="button" onClick={addSubject}
                className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-200 transition"
              >
                <Plus size={12} /> Add subject
              </button>
              <button
                type="button" onClick={loadFromCurriculum}
                disabled={loadingCurriculum || form.classIds.length === 0}
                title={form.classIds.length === 0 ? 'Assign at least one class below first' : "Add every subject in the assigned classes' curriculum that isn't already listed here"}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                {loadingCurriculum ? <Loader2 size={12} className="animate-spin" /> : <BookOpen size={12} />} Load from curriculum
              </button>
              {curriculumMsg && <span className="text-xs text-slate-400">{curriculumMsg}</span>}
            </div>
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
            disabled={saving || !form.name.trim() || form.performanceBands.length === 0 || bandsAreIncomplete || (form.isDefault && !form.sectionId) || form.subjects.some(s => !s.subjectId)}
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
function TemplateCard({ template, sectionMap, onEdit, onDelete, deleting }) {
  const subjectCount   = template.subjects?.length ?? 0;
  const classCount     = template.classIds?.length ?? 0;
  const sectionName    = template.sectionId ? Object.values(sectionMap ?? {}).find(s => s.id === template.sectionId)?.name : null;

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
            {template.isDefault && sectionName && (
              <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border text-indigo-700 bg-indigo-50 border-indigo-200">
                Default for {sectionName}
              </span>
            )}
            {template.bandOnlyScoring && (
              <span className="inline-flex items-center text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border text-purple-700 bg-purple-50 border-purple-200">
                Band-only
              </span>
            )}
          </div>
          {template.description && (
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{template.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
            <span>{subjectCount} subject{subjectCount !== 1 ? 's' : ''}</span>
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
  const { sectionMap } = useSections();
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

  const { data: subjData } = useQuery({
    queryKey:  ['subjects', { limit: 500 }],
    queryFn:   () => subjectsApi.list({ limit: 500 }),
    staleTime: 5 * 60_000,
  });
  const subjectOptions = (subjData?.data ?? []).map(s => ({ ...s, id: s.id || s._id?.toString() }));

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
            <h3 className="text-sm font-semibold text-slate-800">Kindergarten Templates</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Define competency-based report card templates for early-childhood and KG classes.
              Each template specifies the performance bands and which subjects use indicator-based entry — subject teachers add the actual indicators each term, directly in the Markbook.
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
                  sectionMap={sectionMap}
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
            subjectOptions={subjectOptions}
            onSave={handleSave}
            onClose={() => setEditTarget(undefined)}
            saving={saving}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
