/* ============================================================
   PayrollSettingsModal — Payroll Settings (Payroll Phase 1, Step 4
   completion): allowance/deduction type catalogues, statutory
   deductions visibility, payroll approval chain.

   Deliberately does NOT let a school edit PAYE/NSSF/SHIF/Housing-Levy
   rates — per docs/audits/HR_PAYROLL_ARCHITECTURAL_REVIEW.md §3/§9,
   those are platform/country-level truth (server/utils/statutory/
   kenya.js), never a per-school setting. This screen shows the live
   rates the server is actually applying (GET /hr/payroll-config's
   read-only `statutory` block) so "statutory deductions" stops being
   an opaque on/off toggle, without ever letting the numbers drift
   per-school.

   Props:
     teachers     []   — for the approval chain's "specific person" picker
     customRoles  []   — for the approval chain's "role" picker
     onClose      fn
   ============================================================ */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, Save, Loader2, ShieldCheck, Info } from 'lucide-react';
import { hr as hrApi } from '@/api/client.js';
import { useToast } from '@/hooks/useToast.jsx';

// Mirrors HRPage.jsx's own BUILT_IN_STAFF_ROLES (kept local — this modal
// only needs {key,label}, not the color classes HRPage's staff cards use).
const BUILT_IN_STAFF_ROLES = [
  { key: 'admin',                label: 'Admin' },
  { key: 'deputy_principal',     label: 'Deputy Principal' },
  { key: 'section_head',         label: 'Section Head' },
  { key: 'teacher',              label: 'Teacher' },
  { key: 'exams_officer',        label: 'Exams Officer' },
  { key: 'timetabler',           label: 'Timetabler' },
  { key: 'admissions_officer',   label: 'Admissions Officer' },
  { key: 'finance',              label: 'Finance' },
  { key: 'hr',                   label: 'HR' },
  { key: 'discipline_committee', label: 'Discipline Committee' },
  { key: 'front_office',         label: 'Front Office' },
];

function slugify(label) {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (/^[a-z]/.test(base) ? base : `t_${base}`) || 'type';
}
function uniqueKey(label, existingKeys) {
  const base = slugify(label);
  if (!existingKeys.has(base)) return base;
  let n = 2;
  while (existingKeys.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}
function emptyStep() { return { assigneeType: 'role', assigneeValue: '' }; }
function fmtPct(n) { return `${(n * 100).toFixed(2)}%`; }

/* ── Allowance/deduction type catalogue editor ─────────────────
   `key` is immutable once a row exists (only ever set at creation,
   auto-derived from the label) — payroll records itemize against the
   key (allowanceItems[].type), not the label, so letting a key change
   underneath an existing itemized entry would silently re-point it at
   a different meaning. Removing a row still in use is blocked
   server-side (PUT /hr/payroll-config's dependency guard). */
function TypeCatalogueEditor({ title, hint, types, onChange }) {
  function updateLabel(i, label) {
    onChange(types.map((t, idx) => idx === i ? { ...t, label } : t));
  }
  function removeType(i) {
    onChange(types.filter((_, idx) => idx !== i));
  }
  function addType() {
    const existingKeys = new Set(types.map(t => t.key));
    const key = uniqueKey('New Type', existingKeys);
    onChange([...types, { key, label: 'New Type' }]);
  }
  const fCls = 'flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40';
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
      <p className="text-xs text-slate-500 mt-0.5 mb-2.5">{hint}</p>
      <div className="space-y-1.5">
        {types.map((t, i) => (
          <div key={t.key} className="flex items-center gap-2">
            <input value={t.label} onChange={e => updateLabel(i, e.target.value)} className={fCls} />
            <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[10px] font-mono text-slate-400">{t.key}</span>
            <button onClick={() => removeType(i)}
              className="shrink-0 text-slate-400 hover:text-red-600 p-1"><Trash2 size={13} /></button>
          </div>
        ))}
      </div>
      <button onClick={addType} className="mt-2 text-xs font-semibold text-violet-600 hover:underline flex items-center gap-1">
        <Plus size={12} /> Add type
      </button>
    </div>
  );
}

function AssigneePicker({ value, customRoles, teachers, onChange }) {
  const [kind, val] = value.assigneeValue ? [value.assigneeType, value.assigneeValue] : [value.assigneeType, ''];
  const fCls = 'rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400/40';
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

/* ── Statutory deductions — live, read-only ───────────────────── */
function StatutorySection({ statutory, defaultApplyStatutory, onToggle }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-800">Statutory Deductions</h4>
      <p className="text-xs text-slate-500 mt-0.5 mb-2.5">
        PAYE, NSSF, SHIF, and the Housing Levy are set by national law, not per-school — they
        cannot be edited here. This shows exactly what the server is applying today.
      </p>

      <label className="flex items-start gap-2.5 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50">
        <input type="checkbox" checked={defaultApplyStatutory} onChange={e => onToggle(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-400" />
        <span>
          <span className="block text-sm font-medium text-slate-800">Apply statutory deductions by default</span>
          <span className="block text-xs text-slate-500 mt-0.5">
            New payroll records auto-compute PAYE/NSSF/SHIF/Housing-Levy unless overridden per-record.
            Turn off if this school runs payroll through an external bureau.
          </span>
        </span>
      </label>

      {!statutory ? null : !statutory.supported ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800">
          <Info size={14} className="shrink-0 mt-0.5" />
          <span>
            No statutory calculator is registered for this school's country{statutory.country ? ` (${statutory.country})` : ''} yet —
            statutory deductions will not be auto-computed, regardless of the toggle above.
            Currently supported: {statutory.supportedCountries?.join(', ') || 'none'}.
          </span>
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-slate-200 overflow-hidden">
          <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
            <ShieldCheck size={13} className="text-emerald-600" />
            <span className="text-xs font-semibold text-slate-700">{statutory.country} statutory rates</span>
            <span className="text-[10px] text-slate-400">effective {statutory.effectiveFrom}</span>
          </div>
          <div className="p-3 space-y-2 text-xs">
            <div className="flex justify-between"><span className="text-slate-500">NSSF (employee)</span><span className="font-medium text-slate-800">{fmtPct(statutory.nssf.employeeRate)} up to KES {statutory.nssf.upperEarningsLimit.toLocaleString()}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">SHIF (SHA)</span><span className="font-medium text-slate-800">{fmtPct(statutory.shif.rate)} (min KES {statutory.shif.minimumMonthly})</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Housing Levy (employee)</span><span className="font-medium text-slate-800">{fmtPct(statutory.housingLevy.employeeRate)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">PAYE personal relief</span><span className="font-medium text-slate-800">KES {statutory.paye.personalReliefMonthly.toLocaleString()}/mo</span></div>
            <div className="pt-1.5 border-t border-slate-100">
              <span className="text-slate-500">PAYE bands</span>
              <div className="mt-1 space-y-0.5">
                {statutory.paye.bands.map((b, i) => {
                  const prev = statutory.paye.bands[i - 1]?.upTo ?? 0;
                  return (
                    <div key={i} className="flex justify-between text-slate-500">
                      <span>{prev.toLocaleString()} – {b.upTo === null || b.upTo > 1e12 ? '∞' : b.upTo.toLocaleString()}</span>
                      <span className="font-medium text-slate-700">{fmtPct(b.rate)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="px-3 pb-2.5 text-[10px] text-slate-400 leading-relaxed">{statutory.source}</p>
        </div>
      )}
    </div>
  );
}

export default function PayrollSettingsModal({ teachers, customRoles, onClose }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: cfgData, isLoading } = useQuery({
    queryKey: ['hr', 'payroll', 'config'],
    queryFn:  () => hrApi.payroll.config.get(),
  });
  const cfg = cfgData?.data;

  const [allowanceTypes, setAllowanceTypes] = useState(null);
  const [deductionTypes, setDeductionTypes] = useState(null);
  const [defaultApplyStatutory, setDefaultApplyStatutory] = useState(null);

  // Seeds local editable state once the config first loads; deliberately
  // does NOT re-seed on every refetch (e.g. after Save) so an in-progress
  // edit in one section is never clobbered by a save in another.
  useEffect(() => {
    if (!cfg || allowanceTypes !== null) return;
    setAllowanceTypes(cfg.allowanceTypes.map(t => ({ ...t })));
    setDeductionTypes(cfg.deductionTypes.map(t => ({ ...t })));
    setDefaultApplyStatutory(cfg.defaultApplyStatutory);
  }, [cfg, allowanceTypes]);

  const { mutate: savePolicy, isPending: savingPolicy } = useMutation({
    mutationFn: () => hrApi.payroll.config.save({ allowanceTypes, deductionTypes, defaultApplyStatutory }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'config'] });
      setAllowanceTypes(res?.data?.allowanceTypes?.map(t => ({ ...t })) ?? allowanceTypes);
      setDeductionTypes(res?.data?.deductionTypes?.map(t => ({ ...t })) ?? deductionTypes);
      toast.success('Payroll policy saved.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to save payroll policy.'),
  });

  /* Approval chain — mirrors the report-cards Settings panel's
     WorkflowSection pattern: min 1 step (no leave-style "≥2 + fixed
     trailing step" business rule — that's leave-specific), inline
     edit, its own save action (separate config surface server-side). */
  const { data: chainData, isLoading: chainLoading } = useQuery({
    queryKey: ['hr', 'payroll', 'workflow-config'],
    queryFn:  () => hrApi.payroll.workflowConfig.get(),
  });
  const chainConfig = chainData?.data?.steps?.length ? chainData.data : null;
  const [editingChain, setEditingChain] = useState(false);
  const [steps, setSteps] = useState([]);

  function startEditingChain() {
    setSteps(chainConfig?.steps?.length ? chainConfig.steps.map(s => ({ ...s })) : [emptyStep()]);
    setEditingChain(true);
  }
  function updateStep(i, next) { setSteps(s => s.map((st, idx) => idx === i ? next : st)); }
  function addStep() { setSteps(s => [...s, emptyStep()]); }
  function removeStep(i) { setSteps(s => s.filter((_, idx) => idx !== i)); }

  const { mutate: saveChain, isPending: savingChain } = useMutation({
    mutationFn: () => hrApi.payroll.workflowConfig.save({
      steps: steps.map((s, idx) => ({ order: idx + 1, assigneeType: s.assigneeType, assigneeValue: s.assigneeValue, fallback: s.fallback ?? null })),
      notifyOnly: [],
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'payroll', 'workflow-config'] });
      setEditingChain(false);
      toast.success('Payroll approval chain saved.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to save chain.'),
  });
  const chainIncomplete = steps.length < 1 || steps.some(s => !s.assigneeValue);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-bold text-slate-900">Payroll Settings</h2>
            <p className="text-xs text-slate-500 mt-0.5">Allowance/deduction types, statutory visibility, and approval chain.</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={16} /></button>
        </div>

        {isLoading || !allowanceTypes ? (
          <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-16">
            <Loader2 size={16} className="animate-spin" /> Loading payroll settings…
          </div>
        ) : (
          <div className="p-5 space-y-6">
            <TypeCatalogueEditor
              title="Allowance Types"
              hint="Used when itemizing a payroll record's allowances instead of a single flat number."
              types={allowanceTypes}
              onChange={setAllowanceTypes}
            />
            <TypeCatalogueEditor
              title="Deduction Types"
              hint="Non-statutory deductions (loans, advances, etc.) — statutory deductions are computed separately below."
              types={deductionTypes}
              onChange={setDeductionTypes}
            />

            <div className="flex justify-end">
              <button onClick={() => savePolicy()} disabled={savingPolicy}
                className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                {savingPolicy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {savingPolicy ? 'Saving…' : 'Save Payroll Policy'}
              </button>
            </div>

            <div className="pt-1 border-t border-slate-100" />

            <StatutorySection
              statutory={cfg?.statutory}
              defaultApplyStatutory={defaultApplyStatutory}
              onToggle={setDefaultApplyStatutory}
            />

            <div className="pt-1 border-t border-slate-100" />

            <div>
              <div className="flex items-start justify-between gap-4 mb-1">
                <div>
                  <h4 className="text-sm font-semibold text-slate-800">Payroll Approval Chain</h4>
                  <p className="text-xs text-slate-500 mt-0.5 max-w-md">
                    When configured, confirming a draft payroll record requires this chain's steps to
                    clear first. Schools with no chain keep today's direct HR-confirm behavior.
                  </p>
                </div>
                {!editingChain && !chainLoading && (
                  <button onClick={startEditingChain}
                    className="shrink-0 flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    {chainConfig ? 'Edit chain' : 'Configure chain'}
                  </button>
                )}
              </div>

              {chainLoading ? (
                <div className="flex items-center gap-2 text-slate-400 text-xs py-3"><Loader2 size={13} className="animate-spin" /> Loading…</div>
              ) : !editingChain ? (
                chainConfig ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {chainConfig.steps.map((s, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5 text-xs font-medium bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2.5 py-1">
                        <span className="w-4 h-4 rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                        {s.assigneeType === 'role'
                          ? (BUILT_IN_STAFF_ROLES.find(r => r.key === s.assigneeValue)?.label ?? customRoles.find(r => r.key === s.assigneeValue)?.label ?? s.assigneeValue)
                          : (teachers.find(t => (t.userId ?? t.id ?? t._id) === s.assigneeValue)?.name ?? 'Person')}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 mt-2">No approval chain configured — payroll records confirm directly.</p>
                )
              ) : (
                <div className="mt-2 space-y-2">
                  {steps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2.5">
                      <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                      <AssigneePicker value={step} customRoles={customRoles} teachers={teachers} onChange={next => updateStep(i, next)} />
                      <button onClick={() => removeStep(i)} disabled={steps.length <= 1}
                        className="text-slate-400 hover:text-red-600 p-1 disabled:opacity-30 disabled:cursor-not-allowed shrink-0"><Trash2 size={14} /></button>
                    </div>
                  ))}
                  <button onClick={addStep} className="text-xs font-semibold text-violet-600 hover:underline flex items-center gap-1">
                    <Plus size={12} /> Add step
                  </button>
                  <div className="flex justify-end gap-2 pt-1">
                    <button onClick={() => setEditingChain(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
                    <button onClick={() => saveChain()} disabled={chainIncomplete || savingChain}
                      className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
                      {savingChain ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      {savingChain ? 'Saving…' : 'Save chain'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
