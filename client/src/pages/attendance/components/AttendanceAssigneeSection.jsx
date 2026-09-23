/* ============================================================
   AttendanceAssigneeSection — a reusable {role|user} assignment card,
   used by AttendanceSettingsPanel.jsx for both the Attendance Conflict
   Resolver and the Absentee Alert Recipient. Same {assigneeType,
   assigneeValue} + workflow-config.js primitive Behaviour Officer's own
   picker uses (CategoriesTab.jsx) — factored out here since Attendance
   now needs the identical picker twice rather than duplicating it.
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Save, Loader2 } from 'lucide-react';
import { teachers as teachersApi, settings as settingsApi } from '@/api/client.js';
import { useToast } from '@/hooks/useToast.jsx';

function iCls() {
  return 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 placeholder-slate-400 transition';
}

export default function AttendanceAssigneeSection({
  title, description, accent = 'sky', queryKey, roleOptions, getConfig, saveConfig, emptyLabel, savedLabel,
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: cfgData, isLoading } = useQuery({ queryKey, queryFn: getConfig });
  const currentStep = cfgData?.data?.steps?.[0] ?? null;

  const { data: teachersData } = useQuery({
    queryKey: [...queryKey, 'teachers'],
    queryFn:  () => teachersApi.list({ limit: 200 }),
  });
  const teachers = teachersData?.teachers ?? teachersData?.data ?? [];

  const { data: customRolesData } = useQuery({
    queryKey: [...queryKey, 'custom-roles'],
    queryFn:  () => settingsApi.customRoles.list(),
  });
  const customRoles = customRolesData?.data ?? [];

  const [assigneeType, setAssigneeType]   = useState(currentStep?.assigneeType ?? 'role');
  const [assigneeValue, setAssigneeValue] = useState(currentStep?.assigneeValue ?? '');
  const [editing, setEditing] = useState(false);

  function startEditing() {
    setAssigneeType(currentStep?.assigneeType ?? 'role');
    setAssigneeValue(currentStep?.assigneeValue ?? '');
    setEditing(true);
  }

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: (steps) => saveConfig(steps),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      setEditing(false);
      toast.success(savedLabel ?? 'Saved.');
    },
    onError: err => toast.error(err?.message ?? 'Failed to save.'),
  });

  function currentLabel() {
    if (!currentStep) return null;
    if (currentStep.assigneeType === 'role') {
      return roleOptions.find(r => r.key === currentStep.assigneeValue)?.label
        ?? customRoles.find(r => r.key === currentStep.assigneeValue)?.label
        ?? currentStep.assigneeValue;
    }
    const t = teachers.find(t => (t.userId ?? t.id ?? t._id) === currentStep.assigneeValue);
    return t ? (t.name ?? `${t.firstName} ${t.lastName}`) : 'Unknown person';
  }

  const accentClasses = {
    sky:   { badge: 'bg-sky-50 text-sky-700 border-sky-200',       link: 'text-sky-600',   btn: 'bg-sky-600 hover:bg-sky-700' },
    amber: { badge: 'bg-amber-50 text-amber-700 border-amber-200', link: 'text-amber-600', btn: 'bg-amber-600 hover:bg-amber-700' },
  }[accent] ?? { badge: 'bg-sky-50 text-sky-700 border-sky-200', link: 'text-sky-600', btn: 'bg-sky-600 hover:bg-sky-700' };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck size={14} className="text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      <p className="text-xs text-slate-500">{description}</p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-slate-400 text-xs py-2"><Loader2 size={13} className="animate-spin" /> Loading…</div>
      ) : !editing ? (
        <div className="flex items-center justify-between gap-3">
          {currentStep ? (
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-2.5 py-1 border ${accentClasses.badge}`}>
              {currentLabel()}{currentStep.assigneeType === 'role' ? ' (role)' : ''}
            </span>
          ) : (
            <span className="text-xs text-slate-400">{emptyLabel}</span>
          )}
          <button onClick={startEditing} className={`shrink-0 text-xs font-semibold hover:underline ${accentClasses.link}`}>
            {currentStep ? 'Change' : 'Assign'}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select value={assigneeType} onChange={e => { setAssigneeType(e.target.value); setAssigneeValue(''); }} className={iCls()}>
              <option value="role">Role</option>
              <option value="user">Specific person</option>
            </select>
            {assigneeType === 'role' ? (
              <select value={assigneeValue} onChange={e => setAssigneeValue(e.target.value)} className={`${iCls()} flex-1`}>
                <option value="">Select a role…</option>
                {roleOptions.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                {customRoles.map(r => <option key={r.key} value={r.key}>{r.label} (custom)</option>)}
              </select>
            ) : (
              <select value={assigneeValue} onChange={e => setAssigneeValue(e.target.value)} className={`${iCls()} flex-1`}>
                <option value="">Select a person…</option>
                {teachers.map(t => {
                  const id = t.userId ?? t.id ?? t._id;
                  return <option key={id} value={id}>{t.name ?? `${t.firstName} ${t.lastName}`}</option>;
                })}
              </select>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(false)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
            {currentStep && (
              <button onClick={() => save([])} disabled={saving}
                className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
                Remove assignment
              </button>
            )}
            <button onClick={() => save([{ assigneeType, assigneeValue }])} disabled={saving || !assigneeValue}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${accentClasses.btn}`}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
