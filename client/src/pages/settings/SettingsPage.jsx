/* ============================================================
   Settings — Premium Enterprise Rebuild
   /platform-audit: lucide icons, invite slide-over, currency +
   timezone fields, houses config, no old components, no alert()
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Users, User, Plus, X, Save, Loader2,
  CheckCircle2, AlertTriangle, Trash2, Mail, Phone,
  Globe, MapPin, Shield, UserPlus, Home, Palette,
  Eye, EyeOff, Lock,
} from 'lucide-react';
import { settings as settingsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

/* ── Tab config ─────────────────────────────────────────────── */
const TABS = [
  { id: 'school',  label: 'School',  Icon: Building2 },
  { id: 'users',   label: 'Users',   Icon: Users      },
  { id: 'account', label: 'Account', Icon: User       },
];

/* ── Role pills ─────────────────────────────────────────────── */
const ROLE_PILL = {
  superadmin: 'bg-red-50 text-red-700 border-red-200',
  admin:      'bg-violet-50 text-violet-700 border-violet-200',
  deputy:     'bg-indigo-50 text-indigo-700 border-indigo-200',
  teacher:    'bg-blue-50 text-blue-700 border-blue-200',
  parent:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  student:    'bg-amber-50 text-amber-700 border-amber-200',
};
function RolePill({ role }) {
  const cls = ROLE_PILL[role] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex px-2 py-0.5 text-[11px] font-medium rounded border capitalize ${cls}`}>
      {role}
    </span>
  );
}

/* ── Shared primitives ───────────────────────────────────────── */
function iCls(err = false) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${err ? 'border-red-300 focus:ring-red-500/20' : 'border-slate-200 focus:border-slate-400 focus:ring-slate-900/10'} bg-white focus:outline-none focus:ring-2 text-slate-800 placeholder-slate-400 transition`;
}

function Toast({ msg, type = 'success', onDismiss }) {
  const isErr = type === 'error';
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border shadow-sm ${
        isErr ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }`}
    >
      {isErr ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
      {msg}
      <button onClick={onDismiss} className="ml-1 opacity-60 hover:opacity-100"><X size={11} /></button>
    </motion.div>
  );
}

function FField({ label, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

/* ── Currency + Timezone options ────────────────────────────── */
const CURRENCIES = [
  { value: 'KES', label: 'KES — Kenyan Shilling' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'NGN', label: 'NGN — Nigerian Naira' },
  { value: 'GHS', label: 'GHS — Ghanaian Cedi' },
  { value: 'UGX', label: 'UGX — Ugandan Shilling' },
  { value: 'TZS', label: 'TZS — Tanzanian Shilling' },
  { value: 'ZAR', label: 'ZAR — South African Rand' },
  { value: 'RWF', label: 'RWF — Rwandan Franc' },
];
const TIMEZONES = [
  { value: 'Africa/Nairobi',      label: 'Africa/Nairobi (EAT +3)' },
  { value: 'Africa/Lagos',        label: 'Africa/Lagos (WAT +1)' },
  { value: 'Africa/Accra',        label: 'Africa/Accra (GMT +0)' },
  { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (SAST +2)' },
  { value: 'Africa/Kampala',      label: 'Africa/Kampala (EAT +3)' },
  { value: 'Africa/Dar_es_Salaam', label: 'Africa/Dar es Salaam (EAT +3)' },
  { value: 'Africa/Kigali',       label: 'Africa/Kigali (CAT +2)' },
  { value: 'Europe/London',       label: 'Europe/London (GMT/BST)' },
  { value: 'America/New_York',    label: 'America/New_York (EST/EDT)' },
  { value: 'Asia/Dubai',          label: 'Asia/Dubai (GST +4)' },
];

/* ── House colors ────────────────────────────────────────────── */
const HOUSE_PALETTE = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316'];

/* ══════════════════════════════════════════════════════════════
   SCHOOL SETTINGS TAB
   ══════════════════════════════════════════════════════════════ */
function SchoolTab() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['settings', 'school'],
    queryFn:  () => settingsApi.school.get(),
    staleTime: 5 * 60_000,
  });
  const school = data?.data ?? {};

  const [form, setForm] = useState(null);
  const f = form ?? school;
  function set(k, v) { setForm(p => ({ ...(p ?? school), [k]: v })); }

  /* ── House management state ── */
  const houses    = Array.isArray(f.houses) ? f.houses : [];
  const [newName, setNewName]   = useState('');
  const [newColor, setNewColor] = useState(HOUSE_PALETTE[0]);

  function addHouse() {
    if (!newName.trim()) return;
    const h = { id: `house_${Date.now()}`, name: newName.trim(), color: newColor };
    set('houses', [...houses, h]);
    setNewName(''); setNewColor(HOUSE_PALETTE[houses.length % HOUSE_PALETTE.length]);
  }
  function removeHouse(id) {
    set('houses', houses.filter(h => (h.id ?? h.name) !== id));
  }

  const { mutate, isPending } = useMutation({
    mutationFn: d => settingsApi.school.update(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'school'] });
      setForm(null);
      setToast({ msg: 'School settings saved.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save.', type: 'error' }),
  });

  if (isLoading) return (
    <div className="space-y-3 max-w-2xl">
      {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}
    </div>
  );
  if (isError) return (
    <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2 max-w-2xl">
      <AlertTriangle size={20} className="text-red-400" />
      <p className="text-sm text-slate-600">{error?.message}</p>
      <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
    </div>
  );

  return (
    <form onSubmit={e => { e.preventDefault(); mutate(f); }} className="max-w-2xl space-y-4">
      {/* Toast */}
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* School information */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Building2 size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">School Information</h3>
        </div>
        <FField label="School name">
          <input value={f.name ?? ''} onChange={e => set('name', e.target.value)} className={iCls()} placeholder="e.g. Msingi Academy" />
        </FField>
        <FField label="Tagline / Description">
          <input value={f.tagline ?? ''} onChange={e => set('tagline', e.target.value)} className={iCls()} placeholder="Optional short description" />
        </FField>
        <div className="grid grid-cols-2 gap-3">
          <FField label="Email">
            <input type="email" value={f.email ?? ''} onChange={e => set('email', e.target.value)} className={iCls()} />
          </FField>
          <FField label="Phone">
            <input value={f.phone ?? ''} onChange={e => set('phone', e.target.value)} className={iCls()} />
          </FField>
        </div>
        <FField label="Address">
          <input value={f.address ?? ''} onChange={e => set('address', e.target.value)} className={iCls()} />
        </FField>
        <FField label="Website">
          <input type="url" value={f.website ?? ''} onChange={e => set('website', e.target.value)} className={iCls()} placeholder="https://" />
        </FField>
        <FField label="Country">
          <input value={f.country ?? ''} onChange={e => set('country', e.target.value)} className={iCls()} placeholder="e.g. Kenya" />
        </FField>
      </div>

      {/* Regional */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Globe size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Regional</h3>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FField label="Currency">
            <select value={f.currency ?? 'KES'} onChange={e => set('currency', e.target.value)} className={iCls()}>
              {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </FField>
          <FField label="Timezone">
            <select value={f.timezone ?? 'Africa/Nairobi'} onChange={e => set('timezone', e.target.value)} className={iCls()}>
              {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </select>
          </FField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FField label="Academic year label">
            <input value={f.academicYear ?? ''} onChange={e => set('academicYear', e.target.value)} className={iCls()} placeholder="e.g. 2024/25" />
          </FField>
          <FField label="Terms per year">
            <select value={f.termsPerYear ?? 3} onChange={e => set('termsPerYear', Number(e.target.value))} className={iCls()}>
              <option value={2}>2 terms</option>
              <option value={3}>3 terms</option>
              <option value={4}>4 terms (quarters)</option>
            </select>
          </FField>
        </div>
      </div>

      {/* Houses */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Home size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">House System</h3>
          <span className="ml-auto text-xs text-slate-400">{houses.length} configured</span>
        </div>
        <p className="text-xs text-slate-400">Houses are used in the Behaviour module leaderboard and assigned to students on their profile.</p>

        {/* Existing houses */}
        {houses.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {houses.map(h => (
              <div
                key={h.id ?? h.name}
                className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50"
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: h.color ?? '#94a3b8' }} />
                <span className="text-sm text-slate-700">{h.name}</span>
                <button
                  type="button"
                  onClick={() => removeHouse(h.id ?? h.name)}
                  className="p-0.5 text-slate-300 hover:text-red-500 transition"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add house row */}
        <div className="flex items-end gap-2 pt-1">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-medium text-slate-600">House name</label>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addHouse())}
              placeholder="e.g. Phoenix"
              className={iCls()}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">Colour</label>
            <div className="flex gap-1.5 items-center">
              <div className="flex gap-1">
                {HOUSE_PALETTE.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={`w-5 h-5 rounded-full transition ${newColor === c ? 'ring-2 ring-offset-1 ring-slate-900' : ''}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 p-0" title="Custom colour" />
            </div>
          </div>
          <button
            type="button"
            onClick={addHouse}
            disabled={!newName.trim()}
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-xs font-medium px-3 py-2 rounded-lg transition self-end"
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending || !form}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
        >
          {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {isPending ? 'Saving…' : 'Save settings'}
        </button>
        {form && (
          <button type="button" onClick={() => setForm(null)} className="text-sm text-slate-500 hover:text-slate-700 transition">
            Discard
          </button>
        )}
      </div>
    </form>
  );
}

/* ══════════════════════════════════════════════════════════════
   USERS TAB
   ══════════════════════════════════════════════════════════════ */
const INVITE_ROLES = ['teacher', 'deputy', 'admin', 'parent', 'student'];

function UsersTab() {
  const qc = useQueryClient();
  const can        = useAuthStore(s => s.can.bind(s));
  const sessionRole = useAuthStore(s => s.session?.user?.role ?? '');
  const canManage  = can('settings') || sessionRole === 'admin' || sessionRole === 'superadmin';
  const [showInvite, setShowInvite] = useState(false);
  const [toast, setToast] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['settings', 'users'],
    queryFn:  () => settingsApi.users.list(),
    staleTime: 60_000,
  });
  const users = data?.data ?? [];

  const { mutate: removeUser } = useMutation({
    mutationFn: id => settingsApi.users.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'users'] });
      setToast({ msg: 'User removed.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Remove failed.', type: 'error' }),
  });

  function confirmRemove(u) {
    if (!window.confirm(`Remove ${u.name ?? u.email} from this school? They will lose access immediately.`)) return;
    removeUser(u._id ?? u.id);
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Toast */}
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          {isLoading ? 'Loading…' : `${users.length} user${users.length !== 1 ? 's' : ''}`}
        </p>
        {canManage && (
          <button
            onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-3 py-2 rounded-lg transition"
          >
            <UserPlus size={13} /> Invite user
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      ) : isError ? (
        <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
          <AlertTriangle size={20} className="text-red-400" />
          <p className="text-sm text-slate-600">{error?.message}</p>
          <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
        </div>
      ) : users.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <Users size={24} className="text-slate-300" />
          <p className="text-sm text-slate-500">No users yet. Invite your team to get started.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Name</th>
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3 hidden sm:table-cell">Email</th>
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Role</th>
                {canManage && <th className="px-4 py-3 w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(u => (
                <tr key={u._id ?? u.id} className="hover:bg-slate-50 transition group">
                  <td className="px-4 py-3 font-medium text-slate-800">{u.name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs hidden sm:table-cell">{u.email}</td>
                  <td className="px-4 py-3"><RolePill role={u.role} /></td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => confirmRemove(u)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite slide-over */}
      <AnimatePresence>
        {showInvite && (
          <InviteSlideOver
            onClose={() => setShowInvite(false)}
            onInvited={() => {
              setShowInvite(false);
              qc.invalidateQueries({ queryKey: ['settings', 'users'] });
              setToast({ msg: 'Invitation sent.', type: 'success' });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function InviteSlideOver({ onClose, onInvited }) {
  const [email, setEmail] = useState('');
  const [role,  setRole]  = useState('teacher');
  const [name,  setName]  = useState('');
  const [errors, setErrors] = useState({});

  const { mutate, isPending } = useMutation({
    mutationFn: () => settingsApi.users.invite({ email, role, name }),
    onSuccess:  onInvited,
    onError:    err => setErrors({ _server: err?.message ?? 'Invite failed.' }),
  });

  function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!email.trim()) errs.email = 'Email is required.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    mutate();
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Invite User</h2>
            <p className="text-xs text-slate-400 mt-0.5">Send an invite to your team</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={14} />{errors._server}
            </div>
          )}
          <FField label="Full name (optional)" error={errors.name}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Their display name" className={iCls(!!errors.name)} />
          </FField>
          <FField label="Email address *" error={errors.email}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="teacher@school.com" className={iCls(!!errors.email)} autoFocus />
          </FField>
          <FField label="Role">
            <select value={role} onChange={e => setRole(e.target.value)} className={iCls()}>
              {INVITE_ROLES.map(r => (
                <option key={r} value={r} className="capitalize">{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
          </FField>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition">Cancel</button>
          <button
            onClick={submit}
            disabled={isPending}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
            {isPending ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   ACCOUNT TAB
   ══════════════════════════════════════════════════════════════ */
function AccountTab() {
  const patchUser   = useAuthStore(s => s.patchUser);
  const user        = useAuthStore(s => s.session?.user);
  const [name, setName] = useState(user?.name ?? '');
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwVisible, setPwVisible] = useState(false);
  const [toast, setToast] = useState(null);
  const [pwError, setPwError] = useState('');

  const { mutate: saveName, isPending: savingName } = useMutation({
    mutationFn: () => settingsApi.update({ name }),
    onSuccess: () => {
      patchUser({ name });
      setToast({ msg: 'Display name updated.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save name.', type: 'error' }),
  });

  const { mutate: changePassword, isPending: changingPw } = useMutation({
    mutationFn: () => settingsApi.update({ currentPassword: pwForm.current, newPassword: pwForm.next }),
    onSuccess: () => {
      setPwForm({ current: '', next: '', confirm: '' });
      setToast({ msg: 'Password updated successfully.', type: 'success' });
      setPwError('');
    },
    onError: err => setToast({ msg: err?.message ?? 'Password change failed.', type: 'error' }),
  });

  function submitPw(e) {
    e.preventDefault();
    if (pwForm.next !== pwForm.confirm) {
      setPwError('New passwords do not match.');
      return;
    }
    if (pwForm.next.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    setPwError('');
    changePassword();
  }

  return (
    <div className="max-w-md space-y-4">
      {/* Toast */}
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* Who you are */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <User size={18} className="text-slate-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">{user?.name ?? user?.email ?? '—'}</p>
            <p className="text-xs text-slate-400">{user?.email}</p>
          </div>
          <RolePill role={user?.role} />
        </div>
      </div>

      {/* Display name */}
      <form
        onSubmit={e => { e.preventDefault(); saveName(); }}
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <User size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Display Name</h3>
        </div>
        <FField label="Your name">
          <input value={name} onChange={e => setName(e.target.value)} className={iCls()} required />
        </FField>
        <button
          type="submit"
          disabled={savingName || !name.trim() || name === (user?.name ?? '')}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          {savingName ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {savingName ? 'Saving…' : 'Update name'}
        </button>
      </form>

      {/* Change password */}
      <form
        onSubmit={submitPw}
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Lock size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Change Password</h3>
          <button
            type="button"
            onClick={() => setPwVisible(v => !v)}
            className="ml-auto text-slate-400 hover:text-slate-600 transition"
          >
            {pwVisible ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>

        {pwError && (
          <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200">
            <AlertTriangle size={13} />{pwError}
          </div>
        )}

        {[
          { label: 'Current password', key: 'current', minLength: 1 },
          { label: 'New password',     key: 'next',    minLength: 8 },
          { label: 'Confirm new password', key: 'confirm', minLength: 8 },
        ].map(({ label, key, minLength }) => (
          <FField key={key} label={label}>
            <input
              type={pwVisible ? 'text' : 'password'}
              value={pwForm[key]}
              onChange={e => { setPwForm(f => ({ ...f, [key]: e.target.value })); setPwError(''); }}
              required
              minLength={minLength}
              className={iCls(pwError && key !== 'current')}
            />
          </FField>
        ))}

        <button
          type="submit"
          disabled={changingPw || !pwForm.current || !pwForm.next || !pwForm.confirm}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          {changingPw ? <Loader2 size={13} className="animate-spin" /> : <Shield size={13} />}
          {changingPw ? 'Updating…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════ */
export default function SettingsPage() {
  const [tab, setTab] = useState('school');
  const role = useAuthStore(s => s.session?.user?.role ?? '');
  const canManageUsers = ['admin', 'superadmin'].includes(role);

  const visibleTabs = TABS.filter(t => t.id !== 'users' || canManageUsers);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <div className="mb-5">
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Settings</h1>
            <p className="text-sm text-slate-500 mt-0.5">School profile, team members and your account</p>
          </div>
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {visibleTabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                  tab === id
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {tab === 'school'  && <SchoolTab />}
            {tab === 'users'   && <UsersTab />}
            {tab === 'account' && <AccountTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
