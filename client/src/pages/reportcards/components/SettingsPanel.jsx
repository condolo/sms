/* ============================================================
   Report Cards — Settings panel (RCE5)

   Six sub-tabs, each wrapping a server capability that already
   existed (RCE1 toggles, RC7 subject-comments toggle, RC8 approval
   chain, RC9 publication policy, RC11 template registry, the older
   Kindergarten competency-band templates) but had no client UI here
   until now:
     General            -> academicConfig (RCE1 report toggles)
     Comments            -> assessment_config.subjectTeacherCommentsEnabled
                             (RC7) + Comment Bank CRUD (moved from
                             ExamsPage's Configuration tab, not duplicated)
     Workflow             -> report-cards workflow-config (RC8)
     Publication Policy   -> report-cards publication-policy (RC9)
     Templates             -> report-card-templates registry (RC11)
     Kindergarten           -> rc-templates (competency bands, a separate,
                                already-live, pre-RCE feature — moved here
                                from the generic Settings page, not
                                duplicated, so all report-card-shaped
                                settings live under one module; kept
                                distinctly named/tabbed from "Templates"
                                above since the two are unrelated APIs)
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import {
  Loader2, Save, Plus, Trash2, MessageSquare, Search, Tag,
  ListChecks, ShieldCheck, LayoutTemplate, SlidersHorizontal, X, Star, Baby,
} from 'lucide-react';
import {
  academicConfig as academicConfigApi,
  assessment as assessmentApi,
  commentBanks as banksApi,
  reportCards as reportCardsApi,
  reportCardTemplates as templatesApi,
  teachers as teachersApi,
  settings as settingsApi,
} from '@/api/client.js';
import { Skeleton, Toast } from '../../grades/components/GradesPrimitives.jsx';
import RCTemplatesSection from './RCTemplatesSection.jsx';

const SUB_TABS = [
  { id: 'general',      label: 'General',            icon: SlidersHorizontal },
  { id: 'comments',     label: 'Comments',            icon: MessageSquare },
  { id: 'workflow',     label: 'Workflow',            icon: ListChecks },
  { id: 'policy',       label: 'Publication Policy',  icon: ShieldCheck },
  { id: 'templates',    label: 'Templates',           icon: LayoutTemplate },
  { id: 'kindergarten', label: 'Kindergarten',        icon: Baby },
];

export default function SettingsPanel() {
  const [subTab, setSubTab] = useState('general');
  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {SUB_TABS.map(t => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap transition ${
                active ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={13} />
              {t.label}
            </button>
          );
        })}
      </div>

      {subTab === 'general'      && <GeneralSection />}
      {subTab === 'comments'     && <CommentsSection />}
      {subTab === 'workflow'     && <WorkflowSection />}
      {subTab === 'policy'       && <PublicationPolicySection />}
      {subTab === 'templates'    && <TemplatesSection />}
      {subTab === 'kindergarten' && <RCTemplatesSection />}
    </div>
  );
}

/* ── Shared toggle row ─────────────────────────────────────── */
function ToggleRow({ label, description, checked, onToggle }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-slate-800">{label}</p>
        {description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-teal-400 cursor-pointer
          ${checked ? 'bg-teal-700' : 'bg-slate-200'}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform
            ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`}
        />
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   General — RCE1's report-card display toggles (academic_config)
   ══════════════════════════════════════════════════════════════ */
const GENERAL_TOGGLES = [
  { key: 'rankingEnabled',        label: 'Class Ranking',                description: 'Compute and rank students within their class by average score.' },
  { key: 'showRankOnReport',      label: 'Show Rank on Report Card',      description: "Display the student's class rank on their report card (only when ranking is enabled)." },
  { key: 'showAttendanceSummary', label: 'Show Attendance Summary',       description: 'Display a Present / Absent / Total Days summary block.' },
  { key: 'showGPA',                label: 'Show GPA',                     description: 'Display a computed GPA alongside the average score.' },
  { key: 'showClassAverage',      label: 'Show Average Score',            description: "Display the student's average score in the summary bar." },
  { key: 'showDeviation',          label: 'Show Term-over-Term Deviation', description: "Display how each subject's score moved compared to the previous term." },
  { key: 'showBehaviour',          label: 'Show Behaviour Summary',       description: 'Display a Merits / Demerits / Net Points block.' },
  { key: 'showClassTeacherRemark', label: "Show Class Teacher's Remark",  description: "Display the class teacher's written remark block." },
  { key: 'showPrincipalRemark',    label: "Show Principal's Comment",     description: "Display the principal's written comment block." },
];

function GeneralSection() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);
  const [draft, setDraft] = useState({});

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['academic-config'],
    queryFn:  () => academicConfigApi.get(),
    staleTime: 60_000,
  });
  const cfg = data?.data ?? {};
  const active = { ...cfg, ...draft };

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => academicConfigApi.update(draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['academic-config'] });
      setDraft({});
      setToast({ msg: 'Settings saved.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save settings.', type: 'error' }),
  });

  if (isLoading) return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;
  if (isError) return <ErrorCard onRetry={refetch} />;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="h-6 mb-2">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>
      <h3 className="text-sm font-semibold text-slate-800 mb-1">What appears on the report card</h3>
      <p className="text-xs text-slate-400 mb-2">These apply to the new layouts (Subject + Comment Together, Subjects First Comments After). The legacy layout is frozen and ignores them.</p>
      <div>
        {GENERAL_TOGGLES.map(t => (
          <ToggleRow
            key={t.key}
            label={t.label}
            description={t.description}
            checked={active[t.key] !== false}
            onToggle={() => setDraft(d => ({ ...d, [t.key]: !(active[t.key] !== false) }))}
          />
        ))}
      </div>
      <div className="flex justify-end mt-4">
        <button
          onClick={() => save()}
          disabled={saving || Object.keys(draft).length === 0}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Comments — RC7 Subject Teacher Comments toggle (moved from
   ExamsPage's Configuration tab) + Comment Bank CRUD (moved, not
   duplicated).
   ══════════════════════════════════════════════════════════════ */
function CommentsSection() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['assessment', 'config'],
    queryFn:  () => assessmentApi.getConfig(),
    staleTime: 60_000,
  });
  const cfg = data?.data ?? {};
  const enabled = cfg.subjectTeacherCommentsEnabled !== false;

  const { mutate: toggle, isPending: saving } = useMutation({
    mutationFn: (next) => assessmentApi.updateConfig({ subjectTeacherCommentsEnabled: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assessment', 'config'] });
      setToast({ msg: 'Setting saved.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save.', type: 'error' }),
  });

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="h-6 mb-1">
          <AnimatePresence>
            {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
          </AnimatePresence>
        </div>
        {isLoading ? (
          <Skeleton className="h-10" />
        ) : isError ? (
          <ErrorCard onRetry={refetch} />
        ) : (
          <ToggleRow
            label="Subject Teacher Comments"
            description="When enabled, teachers can write a per-subject comment during Mark Entry, and it appears on the report card. Disabling it removes the field from Mark Entry entirely and hides the section from every report card — no placeholder, no trace."
            checked={enabled}
            onToggle={() => !saving && toggle(!enabled)}
          />
        )}
      </div>

      <CommentBankSection />
    </div>
  );
}

const COMMENT_CATEGORIES = [
  { key: 'academic',   label: 'Academic' },
  { key: 'behaviour',  label: 'Behaviour' },
  { key: 'general',    label: 'General' },
  { key: 'subject',    label: 'Subject-specific' },
];

const iCls = () => 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/30';

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
              <select value={newCat} onChange={e => setNewCat(e.target.value)} className={iCls()}>
                {COMMENT_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
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

      <div className="flex gap-2 mb-3">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search comments…" className={`${iCls()} pl-8 text-xs`} />
        </div>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className={`${iCls()} w-40 text-xs`}>
          <option value="">All categories</option>
          {COMMENT_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>

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
              <button onClick={() => deleteComment(c.id)}
                className="shrink-0 p-1 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition opacity-0 group-hover:opacity-100"
                title="Delete">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Workflow — RC8 report-comment approval chain. Structurally the
   same builder HR uses for its leave-approval chain (same
   workflow-config.js engine underneath), but report comments have no
   fixed trailing "final confirmation" step and a minimum of 1 step
   (report-cards.js's REPORT_COMMENT_MIN_STEPS), not 2.
   ══════════════════════════════════════════════════════════════ */
const BUILT_IN_STAFF_ROLES = [
  { key: 'admin',              label: 'Admin' },
  { key: 'deputy_principal',   label: 'Deputy Principal' },
  { key: 'section_head',       label: 'Section Head' },
  { key: 'teacher',            label: 'Teacher' },
  { key: 'exams_officer',      label: 'Exams Officer' },
  { key: 'class_teacher',      label: 'Class Teacher' },
];

function emptyStep() { return { assigneeType: 'role', assigneeValue: '' }; }

function AssigneePicker({ value, customRoles, teachers, onChange }) {
  const [kind, val] = value.assigneeValue ? [value.assigneeType, value.assigneeValue] : [value.assigneeType, ''];
  const fCls = 'rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-400/40';
  return (
    <div className="flex gap-2 flex-1">
      <select value={kind} onChange={e => onChange({ ...value, assigneeType: e.target.value, assigneeValue: '' })} className={fCls}>
        <option value="role">Role</option>
        <option value="user">Specific person</option>
      </select>
      {kind === 'role' ? (
        <select value={val} onChange={e => onChange({ ...value, assigneeValue: e.target.value })} className={`${fCls} flex-1`}>
          <option value="">Select a role…</option>
          {BUILT_IN_STAFF_ROLES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          {customRoles.map(r => <option key={r.key} value={r.key}>{r.label} (custom)</option>)}
        </select>
      ) : (
        <select value={val} onChange={e => onChange({ ...value, assigneeValue: e.target.value })} className={`${fCls} flex-1`}>
          <option value="">Select a person…</option>
          {teachers.map(t => {
            const id = t.userId ?? t.id ?? t._id;
            return <option key={id} value={id}>{t.name ?? `${t.firstName} ${t.lastName}`}</option>;
          })}
        </select>
      )}
    </div>
  );
}

function WorkflowSection() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(false);

  const { data: cfgData, isLoading, isError, refetch } = useQuery({
    queryKey: ['reportCards', 'workflow-config'],
    queryFn:  () => reportCardsApi.workflowConfig.get(),
  });
  const config = (cfgData?.data?.steps?.length ? cfgData.data : null);

  const { data: teachersData } = useQuery({ queryKey: ['teachers'], queryFn: () => teachersApi.list({ limit: 100 }) });
  const teachers = teachersData?.data ?? [];

  const { data: customRolesData } = useQuery({ queryKey: ['settings', 'custom-roles'], queryFn: () => settingsApi.customRoles.list() });
  const customRoles = customRolesData?.data ?? (Array.isArray(customRolesData) ? customRolesData : []);

  const [steps, setSteps] = useState(() => (config?.steps?.length ? config.steps.map(s => ({ ...s })) : [emptyStep()]));

  function startEditing() {
    setSteps(config?.steps?.length ? config.steps.map(s => ({ ...s })) : [emptyStep()]);
    setEditing(true);
  }
  function updateStep(i, next) { setSteps(s => s.map((st, idx) => idx === i ? next : st)); }
  function addStep() { setSteps(s => [...s, emptyStep()]); }
  function removeStep(i) { setSteps(s => s.filter((_, idx) => idx !== i)); }

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => reportCardsApi.workflowConfig.save({
      steps: steps.map((s, idx) => ({ order: idx + 1, assigneeType: s.assigneeType, assigneeValue: s.assigneeValue, fallback: s.fallback ?? null })),
      notifyOnly: [],
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reportCards', 'workflow-config'] });
      setEditing(false);
      setToast({ msg: 'Approval chain saved.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save chain.', type: 'error' }),
  });

  const incomplete = steps.length < 1 || steps.some(s => !s.assigneeValue);

  if (isLoading) return <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>;
  if (isError) return <ErrorCard onRetry={refetch} />;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="h-6 mb-1">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Report Comment Approval Chain</h3>
          <p className="text-xs text-slate-500 leading-relaxed max-w-xl">
            When configured, a report card's Class Teacher / Principal remark is instead collected through this
            sequential chain — each step's assignee writes a remark and hands off to the next, until the chain
            completes. Schools that leave this unconfigured keep the plain Class Teacher / Principal remark fields.
          </p>
        </div>
        {!editing && (
          <button onClick={startEditing}
            className="shrink-0 flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            {config ? 'Edit chain' : 'Configure chain'}
          </button>
        )}
      </div>

      {!editing ? (
        config ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {config.steps.map((s, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 text-xs font-medium bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-2.5 py-1">
                <span className="w-4 h-4 rounded-full bg-teal-600 text-white text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                {s.assigneeType === 'role'
                  ? (BUILT_IN_STAFF_ROLES.find(r => r.key === s.assigneeValue)?.label ?? customRoles.find(r => r.key === s.assigneeValue)?.label ?? s.assigneeValue)
                  : (teachers.find(t => (t.userId ?? t.id ?? t._id) === s.assigneeValue)?.name ?? 'Person')}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 mt-3">No approval chain configured — reports use the plain Class Teacher / Principal remark fields.</p>
        )
      ) : (
        <div className="mt-3 space-y-2">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2.5">
              <span className="w-6 h-6 rounded-full bg-teal-100 text-teal-700 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
              <AssigneePicker value={step} customRoles={customRoles} teachers={teachers} onChange={next => updateStep(i, next)} />
              <button onClick={() => removeStep(i)} disabled={steps.length <= 1}
                className="text-slate-400 hover:text-red-600 p-1 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={addStep} className="text-xs font-semibold text-teal-700 hover:underline flex items-center gap-1">
            <Plus size={12} /> Add step
          </button>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setEditing(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <X size={13} className="inline mr-1" /> Cancel
            </button>
            <button onClick={() => save()} disabled={incomplete || saving}
              className="flex items-center gap-1.5 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? 'Saving…' : 'Save chain'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Publication Policy — RC9's 3-checkbox completeness gate on
   POST /publish.
   ══════════════════════════════════════════════════════════════ */
const POLICY_FIELDS = [
  { key: 'require_moderation_complete',       label: 'Require moderation to be complete',        description: 'Block publishing until every mark for the class/term has passed moderation.' },
  { key: 'require_subject_comments_complete', label: 'Require subject comments to be complete',  description: 'Block publishing until every subject on the report has a teacher comment (only enforced when Subject Teacher Comments is enabled).' },
  { key: 'require_report_remarks_complete',   label: 'Require report-level remarks to be complete', description: "Block publishing until the Class Teacher's Remark and Principal's Comment (or the approval chain, if configured) are filled in." },
];

function PublicationPolicySection() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['reportCards', 'publication-policy'],
    queryFn:  () => reportCardsApi.publicationPolicy.get(),
  });
  const policy = data?.data ?? {};

  const { mutate: toggle, isPending: saving } = useMutation({
    mutationFn: (patch) => reportCardsApi.publicationPolicy.update(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reportCards', 'publication-policy'] });
      setToast({ msg: 'Publication policy saved.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save.', type: 'error' }),
  });

  if (isLoading) return <div className="space-y-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;
  if (isError) return <ErrorCard onRetry={refetch} />;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="h-6 mb-1">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>
      <h3 className="text-sm font-semibold text-slate-800 mb-1">What must be complete before publishing</h3>
      <p className="text-xs text-slate-400 mb-2">Enforced server-side on every POST /publish — a batch that fails a required gate is rejected with the specific reason.</p>
      <div>
        {POLICY_FIELDS.map(f => (
          <ToggleRow
            key={f.key}
            label={f.label}
            description={f.description}
            checked={policy[f.key] === true}
            onToggle={() => !saving && toggle({ [f.key]: !(policy[f.key] === true) })}
          />
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   Templates — RC11 report_card_templates registry. A radio-style
   default picker + basic CRUD over the 3 built layouts; Kindergarten
   is shown disabled ("coming soon") per the Template Engine plan's
   explicit decision to ship the two data-only layouts first.
   ══════════════════════════════════════════════════════════════ */
const LAYOUT_OPTIONS = [
  { key: 'legacy_tabular',       label: 'Legacy Tabular',                    disabled: true,  hint: 'Frozen — never offered for a new default.' },
  { key: 'subject_paired',       label: 'Subject + Comment Together',        disabled: false, hint: '"Light International" style.' },
  { key: 'marks_then_comments',  label: 'Subjects First, Comments After',    disabled: false, hint: 'A clean marks grid, comments together afterward.' },
  { key: 'kindergarten',         label: 'Kindergarten (competency bands)',   disabled: true,  hint: 'Coming soon.' },
];

function TemplatesSection() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newLayout, setNewLayout] = useState('subject_paired');

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['reportCardTemplates'],
    queryFn:  () => templatesApi.list(),
  });
  const templates = data?.data ?? [];

  const { mutate: create, isPending: savingNew } = useMutation({
    mutationFn: () => templatesApi.create({ name: newName.trim(), layoutKey: newLayout, isDefault: templates.length === 0 }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reportCardTemplates'] });
      setCreating(false);
      setNewName('');
      setToast({ msg: 'Template created.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to create template.', type: 'error' }),
  });

  const { mutate: setDefault } = useMutation({
    mutationFn: (id) => templatesApi.update(id, { isDefault: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reportCardTemplates'] });
      setToast({ msg: 'Default template updated.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to set default.', type: 'error' }),
  });

  const { mutate: remove } = useMutation({
    mutationFn: (id) => templatesApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reportCardTemplates'] });
      setToast({ msg: 'Template deleted.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Cannot delete this template.', type: 'error' }),
  });

  if (isLoading) return <div className="space-y-3">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-16" />)}</div>;
  if (isError) return <ErrorCard onRetry={refetch} />;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="h-6 mb-1">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 mb-1">Report Card Templates</h3>
          <p className="text-xs text-slate-500">Which layout renders a school's report cards. New publishes use the current default; a published report keeps the layout it was published with, forever.</p>
        </div>
        <button onClick={() => setCreating(c => !c)}
          className="shrink-0 flex items-center gap-1.5 border border-slate-200 hover:border-slate-400 text-slate-600 hover:text-slate-900 text-xs font-medium px-3 py-1.5 rounded-lg transition">
          <Plus size={12} /> New template
        </button>
      </div>

      {creating && (
        <div className="mb-4 p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Name</label>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Term Report — Secondary" className={iCls()} />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 block mb-1">Layout</label>
            <div className="grid sm:grid-cols-2 gap-2">
              {LAYOUT_OPTIONS.map(o => (
                <button key={o.key} type="button" disabled={o.disabled}
                  onClick={() => setNewLayout(o.key)}
                  className={`text-left rounded-lg border p-2.5 transition text-xs ${
                    o.disabled ? 'opacity-40 cursor-not-allowed border-slate-200'
                    : newLayout === o.key ? 'border-teal-600 bg-teal-50' : 'border-slate-200 hover:border-slate-300'
                  }`}>
                  <p className="font-semibold text-slate-800">{o.label}{o.disabled && <span className="ml-1 text-slate-400 font-normal">(coming soon)</span>}</p>
                  <p className="text-slate-500 mt-0.5">{o.hint}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setCreating(false); setNewName(''); }} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg transition">Cancel</button>
            <button onClick={() => create()} disabled={savingNew || !newName.trim()}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition">
              {savingNew ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
              {savingNew ? 'Saving…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-8">
          No templates yet — new reports fall back to the built-in default ("Subject + Comment Together").
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {templates.map(t => {
            const layout = LAYOUT_OPTIONS.find(o => o.key === t.layoutKey);
            return (
              <div key={t.id} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <button onClick={() => !t.isDefault && setDefault(t.id)} disabled={t.isDefault}
                    title={t.isDefault ? 'Default template' : 'Set as default'}
                    className={`shrink-0 ${t.isDefault ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}>
                    <Star size={16} fill={t.isDefault ? 'currentColor' : 'none'} />
                  </button>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{t.name}</p>
                    <p className="text-xs text-slate-400">{layout?.label ?? t.layoutKey}{t.isDefault && ' · Default'}</p>
                  </div>
                </div>
                <button onClick={() => remove(t.id)} disabled={t.isDefault}
                  title={t.isDefault ? 'Set another template as default first' : 'Delete'}
                  className="shrink-0 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition disabled:opacity-30 disabled:cursor-not-allowed">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Shared error card ─────────────────────────────────────── */
function ErrorCard({ onRetry }) {
  return (
    <div className="bg-white border border-red-200 rounded-xl p-6 flex flex-col items-center gap-2">
      <p className="text-sm text-slate-600">Failed to load.</p>
      <button onClick={onRetry} className="text-xs font-medium text-slate-700 underline">Retry</button>
    </div>
  );
}
