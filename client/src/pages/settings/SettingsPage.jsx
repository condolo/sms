/* ============================================================
   Settings — Premium Enterprise Rebuild
   /platform-audit: lucide icons, invite slide-over, currency +
   timezone fields, houses config, no old components, no alert()
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import {
  Building2, Users, User, Plus, X, Save, Loader2,
  CheckCircle2, AlertTriangle, Trash2, Mail, Phone,
  Globe, MapPin, Shield, UserPlus, Home, Palette,
  Eye, EyeOff, Lock, ShieldCheck, Database, Download,
  RefreshCcw, Info, Server, Check, Minus, ChevronDown,
} from 'lucide-react';
import { settings as settingsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

/* ── Tab config ─────────────────────────────────────────────── */
const TABS = [
  { id: 'school',  label: 'School',             Icon: Building2,  adminOnly: false },
  { id: 'users',   label: 'Users',              Icon: Users,       adminOnly: true  },
  { id: 'roles',   label: 'Roles & Permissions',Icon: ShieldCheck, adminOnly: true  },
  { id: 'system',  label: 'System',             Icon: Database,    adminOnly: true  },
  { id: 'account', label: 'Account',            Icon: User,        adminOnly: false },
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
   ROLES & PERMISSIONS TAB — editable sub-module RBAC matrix
   ══════════════════════════════════════════════════════════════ */

const PERM_MODULES = [
  { key: 'students',   label: 'Students', subs: [
    { key: 'list',    label: 'View Student List' },
    { key: 'profile', label: 'View Student Profile' },
    { key: 'create',  label: 'Add Student' },
    { key: 'edit',    label: 'Edit Student' },
    { key: 'delete',  label: 'Delete Student' },
    { key: 'export',  label: 'Export Students (CSV)' },
  ]},
  { key: 'teachers',   label: 'Teachers', subs: [
    { key: 'list',   label: 'View Teacher List' },
    { key: 'detail', label: 'View Teacher Profile' },
    { key: 'create', label: 'Add Teacher' },
    { key: 'edit',   label: 'Edit Teacher' },
    { key: 'delete', label: 'Delete Teacher' },
    { key: 'export', label: 'Export Teachers (CSV)' },
  ]},
  { key: 'classes',    label: 'Classes', subs: [
    { key: 'view',   label: 'View Classes' },
    { key: 'create', label: 'Create Class' },
    { key: 'edit',   label: 'Edit Class' },
    { key: 'delete', label: 'Delete Class' },
  ]},
  { key: 'attendance', label: 'Attendance', subs: [
    { key: 'view',   label: 'View Register' },
    { key: 'mark',   label: 'Mark Attendance' },
    { key: 'edit',   label: 'Edit Records' },
    { key: 'export', label: 'Export / Print Register' },
  ]},
  { key: 'finance',    label: 'Finance', subs: [
    { key: 'invoices',       label: 'View Invoices' },
    { key: 'create_invoice', label: 'Create Invoice' },
    { key: 'void_invoice',   label: 'Void Invoice' },
    { key: 'payments',       label: 'View Payments' },
    { key: 'record_payment', label: 'Record Payment' },
    { key: 'print',          label: 'Print Receipts / Invoices' },
  ]},
  { key: 'behaviour',  label: 'Behaviour (BPS)', subs: [
    { key: 'view',   label: 'View Incidents & BPS' },
    { key: 'create', label: 'Record Incident / Award Points' },
    { key: 'edit',   label: 'Edit Records' },
    { key: 'delete', label: 'Delete Records' },
  ]},
  { key: 'grades',     label: 'Grades & Exams', subs: [
    { key: 'view_grades',  label: 'View Grades' },
    { key: 'enter_marks',  label: 'Enter / Edit Marks' },
    { key: 'view_exams',   label: 'View Exams' },
    { key: 'create_exam',  label: 'Create / Edit Exam' },
    { key: 'export',       label: 'Export Grades (CSV)' },
  ]},
  { key: 'admissions', label: 'Admissions', subs: [
    { key: 'view',   label: 'View Pipeline' },
    { key: 'create', label: 'Add Applicant' },
    { key: 'edit',   label: 'Edit Applicant Details' },
    { key: 'move',   label: 'Move Pipeline Stage' },
    { key: 'delete', label: 'Delete Applicant' },
    { key: 'export', label: 'Export Applicants (CSV)' },
  ]},
  { key: 'messages',   label: 'Messages', subs: [
    { key: 'view',   label: 'View Messages' },
    { key: 'send',   label: 'Send Messages' },
    { key: 'delete', label: 'Delete Messages' },
  ]},
  { key: 'events',     label: 'Events & Calendar', subs: [
    { key: 'view',   label: 'View Events' },
    { key: 'create', label: 'Create Event' },
    { key: 'edit',   label: 'Edit Event' },
    { key: 'delete', label: 'Delete Event' },
    { key: 'export', label: 'Export Events (CSV)' },
  ]},
  { key: 'hr',         label: 'HR & Payroll', subs: [
    { key: 'staff',          label: 'View Staff Records' },
    { key: 'leave_view',     label: 'View Leave Requests' },
    { key: 'leave_approve',  label: 'Approve / Reject Leave' },
    { key: 'payroll_view',   label: 'View Payroll' },
    { key: 'payroll_export', label: 'Export Payroll (CSV)' },
    { key: 'documents',      label: 'Manage Staff Documents' },
  ]},
  { key: 'reports',    label: 'Reports & Analytics', subs: [
    { key: 'view',   label: 'View Reports' },
    { key: 'export', label: 'Export Reports (CSV)' },
  ]},
  { key: 'timetable',  label: 'Timetable', subs: [
    { key: 'view', label: 'View Timetable' },
    { key: 'edit', label: 'Edit Timetable' },
  ]},
  { key: 'subjects',   label: 'Subjects', subs: [
    { key: 'view',   label: 'View Subjects' },
    { key: 'create', label: 'Create Subject / Department' },
    { key: 'edit',   label: 'Edit Subject' },
    { key: 'delete', label: 'Delete Subject' },
  ]},
  { key: 'settings',   label: 'Settings', subs: [
    { key: 'school',      label: 'Edit School Settings' },
    { key: 'users',       label: 'Manage Users / Invites' },
    { key: 'permissions', label: 'Manage Roles & Permissions' },
    { key: 'system',      label: 'View System Info' },
  ]},
];

const PERM_ROLES = ['superadmin','admin','deputy','teacher','parent','student'];
const PERM_ROLE_LABELS = {
  superadmin:'Super Admin', admin:'Admin', deputy:'Deputy',
  teacher:'Teacher', parent:'Parent', student:'Student',
};
const PERM_ROLE_COLORS = {
  superadmin: { sel:'bg-red-600 text-white ring-red-600',        idle:'ring-slate-200 bg-white text-red-700'     },
  admin:      { sel:'bg-violet-600 text-white ring-violet-600',  idle:'ring-slate-200 bg-white text-violet-700'  },
  deputy:     { sel:'bg-indigo-600 text-white ring-indigo-600',  idle:'ring-slate-200 bg-white text-indigo-700'  },
  teacher:    { sel:'bg-blue-600 text-white ring-blue-600',      idle:'ring-slate-200 bg-white text-blue-700'    },
  parent:     { sel:'bg-emerald-600 text-white ring-emerald-600',idle:'ring-slate-200 bg-white text-emerald-700' },
  student:    { sel:'bg-amber-500 text-white ring-amber-500',    idle:'ring-slate-200 bg-white text-amber-700'   },
};

function _makeDefaultPerms() {
  const T = { v:true,  e:true,  d:true  };
  const V = { v:true,  e:false, d:false };
  const E = { v:true,  e:true,  d:false };
  const N = { v:false, e:false, d:false };
  const DEFS = {
    superadmin: ()      => T,
    admin:      ()      => T,
    deputy: (m, s) => {
      if (m==='finance'  && ['void_invoice','record_payment','payroll_view','payroll_export'].includes(s)) return N;
      if (m==='hr'       && ['payroll_view','payroll_export','documents'].includes(s)) return N;
      if (m==='settings' && s==='permissions') return N;
      return E;
    },
    teacher: (m, s) => {
      if (['finance','admissions','hr','settings'].includes(m)) return N;
      if (m==='attendance') return s==='edit' ? N : s==='export' ? V : E;
      if (m==='grades')     return ['enter_marks','create_exam'].includes(s) ? E : V;
      if (m==='behaviour')  return s==='create' ? E : V;
      if (m==='messages')   return s==='delete' ? N : E;
      return V;
    },
    parent: (m) => ['students','finance','attendance','grades','behaviour','events','messages'].includes(m) ? V : N,
    student:(m) => ['students','timetable','grades','events'].includes(m) ? V : N,
  };
  const perms = { byRole:{}, byUser:{} };
  PERM_ROLES.forEach(role => {
    perms.byRole[role] = {};
    PERM_MODULES.forEach(mod => mod.subs.forEach(sub => {
      perms.byRole[role][`${mod.key}__${sub.key}`] = DEFS[role](mod.key, sub.key);
    }));
  });
  return perms;
}

function _mergePerms(defaults, saved) {
  const out = JSON.parse(JSON.stringify(defaults));
  if (saved?.byRole) {
    Object.entries(saved.byRole).forEach(([role, cells]) => {
      if (!out.byRole[role]) out.byRole[role] = {};
      Object.entries(cells).forEach(([k,v]) => { out.byRole[role][k] = { ...out.byRole[role][k], ...v }; });
    });
  }
  if (saved?.byUser) out.byUser = JSON.parse(JSON.stringify(saved.byUser));
  return out;
}

function PChk({ checked, onChange, color }) {
  const ON  = { violet:'bg-violet-600 border-violet-600', amber:'bg-amber-500 border-amber-500', red:'bg-red-500 border-red-500' };
  const OFF = 'bg-white border-slate-300';
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={!onChange}
      className={`w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-all shrink-0 ${checked ? ON[color] : OFF} ${onChange ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
    >
      {checked && <Check size={9} className="text-white" strokeWidth={3} />}
    </button>
  );
}

function RolesTab() {
  const qc       = useQueryClient();
  const userRole = useAuthStore(s => s.session?.user?.role ?? '');
  const isAdmin  = ['admin','superadmin'].includes(userRole);

  const [mode,     setMode]     = useState('role');   // 'role' | 'user'
  const [selRole,  setSelRole]  = useState('admin');
  const [selUser,  setSelUser]  = useState(null);
  const [expanded, setExpanded] = useState({});
  const [perms,    setPerms]    = useState(null);
  const [dirty,    setDirty]    = useState(false);
  const [toast,    setToast]    = useState(null);

  /* Load school data (holds saved modulePermissions) */
  const { data: schoolData } = useQuery({
    queryKey: ['settings','school'],
    queryFn:  () => settingsApi.school.get(),
    staleTime: 30_000,
  });

  /* Load users for Per-User mode */
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['settings','users'],
    queryFn:  () => settingsApi.users.list(),
    enabled:  mode === 'user',
    staleTime: 60_000,
  });
  const users = usersData?.data ?? [];

  /* Initialise permission state once school data arrives */
  useEffect(() => {
    if (!schoolData) return;
    const saved = schoolData.data?.modulePermissions;
    setPerms(saved ? _mergePerms(_makeDefaultPerms(), saved) : _makeDefaultPerms());
  }, [schoolData]);

  /* Save mutation */
  const { mutate: savePerms, isPending: saving } = useMutation({
    mutationFn: () => settingsApi.school.update({ modulePermissions: perms }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings','school'] });
      setDirty(false);
      setToast({ msg: 'Permissions saved.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Save failed.', type: 'error' }),
  });

  /* Toggle a single V/E/D cell */
  function toggle(permKey, type) {
    if (!isAdmin) return;
    setPerms(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      if (mode === 'role') {
        if (!next.byRole[selRole]) next.byRole[selRole] = {};
        const cell = next.byRole[selRole][permKey] ?? { v:false, e:false, d:false };
        cell[type] = !cell[type];
        next.byRole[selRole][permKey] = cell;
      } else {
        /* Per-user: start from current effective value, toggle, store override */
        if (!next.byUser[selUser]) next.byUser[selUser] = {};
        const u        = users.find(x => (x._id ?? x.id) === selUser);
        const roleBase = u ? (next.byRole[u.role]?.[permKey] ?? { v:false,e:false,d:false }) : { v:false,e:false,d:false };
        const override = next.byUser[selUser][permKey];
        const current  = override ? { ...roleBase, ...override } : { ...roleBase };
        current[type]  = !current[type];
        next.byUser[selUser][permKey] = current;
      }
      return next;
    });
    setDirty(true);
  }

  /* Effective permission map for the selected entity */
  const effectiveMap = (() => {
    if (!perms) return {};
    if (mode === 'role') return perms.byRole[selRole] ?? {};
    if (!selUser) return {};
    const u = users.find(x => (x._id ?? x.id) === selUser);
    const base = u ? (perms.byRole[u.role] ?? {}) : {};
    const over = perms.byUser?.[selUser] ?? {};
    return Object.fromEntries(
      Object.entries(base).map(([k,v]) => [k, over[k] ? { ...v, ...over[k] } : v])
    );
  })();

  if (!perms) return (
    <div className="space-y-3 max-w-4xl">
      {[...Array(5)].map((_,i) => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}
    </div>
  );

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Toast */}
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
          {[['role','Global (By Role)'],['user','Per User']].map(([v,label]) => (
            <button key={v} onClick={() => setMode(v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${mode===v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >{label}</button>
          ))}
        </div>
        {isAdmin && dirty && (
          <button onClick={() => savePerms()} disabled={saving}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving…' : 'Save Permissions'}
          </button>
        )}
      </div>

      <div className="flex gap-4 items-start">

        {/* ── Left: entity selector ── */}
        <div className="shrink-0 w-44 space-y-1.5">
          {mode === 'role' ? (
            PERM_ROLES.map(r => {
              const c = PERM_ROLE_COLORS[r];
              return (
                <button key={r} onClick={() => setSelRole(r)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold text-left transition ring-1 ${selRole===r ? c.sel : c.idle}`}
                >
                  <ShieldCheck size={12} className="shrink-0" />
                  {PERM_ROLE_LABELS[r]}
                </button>
              );
            })
          ) : usersLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_,i) => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}</div>
          ) : users.length === 0 ? (
            <p className="text-xs text-slate-400 px-2 py-4 text-center">No users in school.</p>
          ) : (
            users.map(u => {
              const uid = u._id ?? u.id;
              const sel = selUser === uid;
              return (
                <button key={uid} onClick={() => setSelUser(uid)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition ring-1 ${sel ? 'ring-slate-800 bg-slate-900' : 'ring-slate-200 bg-white hover:bg-slate-50'}`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${sel ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {(u.name ?? u.email ?? '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${sel ? 'text-white' : 'text-slate-700'}`}>{u.name ?? u.email}</p>
                    <p className={`text-[10px] truncate capitalize ${sel ? 'text-white/60' : 'text-slate-400'}`}>{u.role}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* ── Right: permission tree ── */}
        <div className="flex-1 min-w-0 space-y-2">
          {(mode === 'role' && selRole) || (mode === 'user' && selUser) ? (
            <>
              {/* Legend */}
              <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-200 text-[11px]">
                <span className="font-semibold text-slate-600">Legend:</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-violet-600 inline-block" /><span className="text-slate-500">V = Visible</span></span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500 inline-block" /><span className="text-slate-500">E = Editable</span></span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500 inline-block" /><span className="text-slate-500">D = Deletable</span></span>
                {!isAdmin && <span className="ml-auto font-medium text-amber-600">Read-only — admin required to edit</span>}
                {mode === 'user' && selUser && (
                  <span className="ml-auto text-slate-400">Showing inherited role defaults + any user overrides</span>
                )}
              </div>

              {/* Module accordion rows */}
              {PERM_MODULES.map(mod => {
                const isOpen = expanded[mod.key] !== false; // default open
                return (
                  <div key={mod.key} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    {/* Module header */}
                    <button
                      type="button"
                      onClick={() => setExpanded(p => ({ ...p, [mod.key]: !isOpen }))}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition text-left"
                    >
                      <span className="text-sm font-semibold text-slate-800">{mod.label}</span>
                      <div className="flex items-center gap-2 text-slate-400">
                        <span className="text-xs">{mod.subs.length} sub-modules</span>
                        <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </div>
                    </button>

                    {/* Sub-module rows */}
                    {isOpen && (
                      <div className="border-t border-slate-100">
                        {/* Column headers */}
                        <div className="flex items-center px-4 py-1.5 bg-slate-50/70 border-b border-slate-100">
                          <span className="flex-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Sub-module</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="w-[18px] text-center text-[10px] font-bold text-violet-600">V</span>
                            <span className="w-[18px] text-center text-[10px] font-bold text-amber-500">E</span>
                            <span className="w-[18px] text-center text-[10px] font-bold text-red-500">D</span>
                          </div>
                        </div>

                        {mod.subs.map(sub => {
                          const pk   = `${mod.key}__${sub.key}`;
                          const cell = effectiveMap[pk] ?? { v:false, e:false, d:false };
                          return (
                            <div key={sub.key} className="flex items-center px-4 py-2.5 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition">
                              <span className="flex-1 text-sm text-slate-700">{sub.label}</span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <PChk checked={!!cell.v} color="violet" onChange={isAdmin ? () => toggle(pk,'v') : undefined} />
                                <PChk checked={!!cell.e} color="amber"  onChange={isAdmin ? () => toggle(pk,'e') : undefined} />
                                <PChk checked={!!cell.d} color="red"    onChange={isAdmin ? () => toggle(pk,'d') : undefined} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center gap-2">
              <ShieldCheck size={28} className="text-slate-300" />
              <p className="text-sm text-slate-400">Select a user from the list to view and configure their permissions.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SYSTEM TAB — system info + data management
   ══════════════════════════════════════════════════════════════ */
function SystemTab() {
  const school = useAuthStore(s => s.session?.school);
  const user   = useAuthStore(s => s.session?.user);
  const [exporting, setExporting] = useState(false);

  const planBadgeColor = {
    free:       'bg-slate-100 text-slate-600',
    starter:    'bg-blue-50 text-blue-700',
    premium:    'bg-violet-50 text-violet-700',
    enterprise: 'bg-amber-50 text-amber-700',
  };

  const plan = school?.plan ?? 'premium';

  async function handleExport() {
    setExporting(true);
    try {
      const { importExport } = await import('@/api/client.js');
      await importExport.exportCSV('students');
    } catch {
      /* silent — the browser will show the download or error */
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">

      {/* School info card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Server size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">System Information</h3>
        </div>
        <div className="grid grid-cols-2 gap-y-3 text-sm">
          {[
            ['School ID',    school?.id ?? school?.slug ?? '—'],
            ['Platform',     'Msingi School ERP'],
            ['Subscription', <span key="plan" className={`inline-flex px-2 py-0.5 text-[11px] font-semibold rounded-full capitalize ${planBadgeColor[plan] ?? planBadgeColor.premium}`}>{plan}</span>],
            ['Version',      'v4.9.13'],
            ['Timezone',     school?.timezone ?? 'Africa/Nairobi'],
            ['Currency',     school?.currency ?? 'KES'],
            ['Academic Year',school?.academicYear ?? '—'],
            ['Terms/Year',   school?.termsPerYear ?? 3],
          ].map(([label, value]) => (
            <div key={label} className="space-y-0.5">
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</p>
              <p className="text-sm font-medium text-slate-700">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Data management */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Database size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Data Management</h3>
        </div>
        <div className="space-y-3">
          <DataAction
            icon={<Download size={15} />}
            title="Export Students"
            desc="Download all active student records as a CSV file"
            buttonLabel={exporting ? 'Exporting…' : 'Export CSV'}
            buttonColor="bg-slate-900 hover:bg-slate-800"
            loading={exporting}
            onClick={handleExport}
          />
          <DataAction
            icon={<Download size={15} />}
            title="Export Teachers"
            desc="Download all teacher records as a CSV file"
            buttonLabel="Export CSV"
            buttonColor="bg-slate-900 hover:bg-slate-800"
            onClick={async () => {
              const { importExport } = await import('@/api/client.js');
              await importExport.exportCSV('teachers');
            }}
          />
          <div className="pt-1">
            <a
              href="/import-export"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-800 transition"
            >
              <RefreshCcw size={12} />
              Full Import / Export page →
            </a>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-white border border-red-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-red-100">
          <AlertTriangle size={14} className="text-red-400" />
          <h3 className="text-xs font-semibold text-red-500 uppercase tracking-wider">Danger Zone</h3>
        </div>
        <div className="bg-red-50 rounded-lg px-4 py-3 text-xs text-red-700 space-y-1">
          <p className="font-semibold">Destructive operations are managed by your Msingi account manager.</p>
          <p>To permanently delete school data, reset academic records, or deactivate your account, please contact support at support@msingi.io</p>
        </div>
      </div>
    </div>
  );
}

function DataAction({ icon, title, desc, buttonLabel, buttonColor, loading, onClick }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shrink-0 mt-0.5">
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700">{title}</p>
          <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
        </div>
      </div>
      <button
        onClick={onClick}
        disabled={loading}
        className={`shrink-0 flex items-center gap-1.5 ${buttonColor} disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition`}
      >
        {loading && <Loader2 size={12} className="animate-spin" />}
        {buttonLabel}
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════ */
export default function SettingsPage() {
  const [tab, setTab] = useState('school');
  const role = useAuthStore(s => s.session?.user?.role ?? '');
  const isAdmin = ['admin', 'superadmin'].includes(role);

  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="mb-5">
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Settings</h1>
            <p className="text-sm text-slate-500 mt-0.5">School profile, team management, permissions and system information</p>
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

      <div className="max-w-5xl mx-auto px-6 py-6">
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
            {tab === 'roles'   && <RolesTab />}
            {tab === 'system'  && <SystemTab />}
            {tab === 'account' && <AccountTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
