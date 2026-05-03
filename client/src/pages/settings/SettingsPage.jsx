import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settings as settingsApi } from '@/api/client.js';
import { PageSpinner, Spinner } from '@/components/ui/Spinner.jsx';
import { ErrorState } from '@/components/ui/EmptyState.jsx';
import useAuthStore from '@/store/auth.js';

const TABS = ['school', 'users', 'account'];

export default function SettingsPage() {
  const [tab, setTab] = useState('school');

  return (
    <div className="space-y-6 animate-fade-in">
      <h2 className="text-xl font-bold text-slate-800">Settings</h2>

      <div className="flex gap-2 border-b border-surface-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition capitalize ${tab === t ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'school'  && <SchoolSettingsTab />}
      {tab === 'users'   && <UsersTab />}
      {tab === 'account' && <AccountTab />}
    </div>
  );
}

function SchoolSettingsTab() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['settings', 'school'],
    queryFn:  () => settingsApi.school.get(),
  });
  const school = data?.data ?? {};

  const [form, setForm]   = useState(null);
  const [saved, setSaved] = useState(false);

  const f = form ?? school;
  function set(k, v) { setForm((prev) => ({ ...(prev ?? school), [k]: v })); }

  const { mutate, isPending } = useMutation({
    mutationFn: (d) => settingsApi.school.update(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'school'] });
      setForm(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  if (isLoading) return <PageSpinner message="Loading settings…" />;
  if (isError)   return <ErrorState message={error?.message} onRetry={refetch} />;

  return (
    <form onSubmit={(e) => { e.preventDefault(); mutate(f); }} className="max-w-xl space-y-5">
      <div className="card space-y-4">
        <h3 className="text-sm font-semibold text-slate-700">School Information</h3>
        {[
          { label: 'School name',    key: 'name' },
          { label: 'Email',          key: 'email',  type: 'email' },
          { label: 'Phone',          key: 'phone' },
          { label: 'Address',        key: 'address' },
          { label: 'Website',        key: 'website', type: 'url' },
        ].map(({ label, key, type = 'text' }) => (
          <div key={key}>
            <label className="form-label">{label}</label>
            <input
              type={type}
              className="form-input"
              value={f[key] ?? ''}
              onChange={(e) => set(key, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={isPending || !form}>
          {isPending ? <><Spinner size="sm" /> Saving…</> : 'Save changes'}
        </button>
        {saved && <span className="text-sm text-green-600 font-medium">✓ Saved</span>}
      </div>
    </form>
  );
}

function UsersTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['settings', 'users'],
    queryFn:  () => settingsApi.users.list(),
  });
  const users = data?.data ?? [];

  if (isLoading) return <PageSpinner message="Loading users…" />;
  if (isError)   return <ErrorState message={error?.message} onRetry={refetch} />;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{users.length} user{users.length !== 1 ? 's' : ''}</p>
        <button className="btn-primary btn-sm">+ Invite user</button>
      </div>
      <div className="card !p-0 overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u._id}>
                <td className="font-medium">{u.name}</td>
                <td className="text-slate-500">{u.email}</td>
                <td className="capitalize text-slate-600">{u.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AccountTab() {
  const patchUser = useAuthStore((s) => s.patchUser);
  const user      = useAuthStore((s) => s.session?.user);
  const [name, setName]     = useState(user?.name ?? '');
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [saved, setSaved]   = useState('');

  const { mutate: saveName, isPending: savingName } = useMutation({
    mutationFn: () => settingsApi.update({ name }),
    onSuccess:  () => { patchUser({ name }); setSaved('name'); setTimeout(() => setSaved(''), 3000); },
  });

  const { mutate: changePassword, isPending: changingPw, error: pwError } = useMutation({
    mutationFn: () => settingsApi.update({ currentPassword: pwForm.current, newPassword: pwForm.next }),
    onSuccess:  () => { setPwForm({ current: '', next: '', confirm: '' }); setSaved('pw'); setTimeout(() => setSaved(''), 3000); },
  });

  return (
    <div className="max-w-md space-y-8">
      {/* Name */}
      <form onSubmit={(e) => { e.preventDefault(); saveName(); }} className="card space-y-4">
        <h3 className="text-sm font-semibold text-slate-700">Display name</h3>
        <input value={name} onChange={(e) => setName(e.target.value)} className="form-input" required />
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary btn-sm" disabled={savingName}>
            {savingName ? 'Saving…' : 'Update name'}
          </button>
          {saved === 'name' && <span className="text-sm text-green-600">✓ Saved</span>}
        </div>
      </form>

      {/* Password */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (pwForm.next !== pwForm.confirm) return alert('Passwords do not match.');
          changePassword();
        }}
        className="card space-y-4"
      >
        <h3 className="text-sm font-semibold text-slate-700">Change password</h3>
        {pwError && <p className="text-sm text-red-600">{pwError.message}</p>}
        {[
          { label: 'Current password', key: 'current' },
          { label: 'New password',     key: 'next' },
          { label: 'Confirm password', key: 'confirm' },
        ].map(({ label, key }) => (
          <div key={key}>
            <label className="form-label">{label}</label>
            <input
              type="password"
              className="form-input"
              value={pwForm[key]}
              onChange={(e) => setPwForm((f) => ({ ...f, [key]: e.target.value }))}
              required
              minLength={key === 'current' ? 1 : 8}
            />
          </div>
        ))}
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary btn-sm" disabled={changingPw}>
            {changingPw ? <><Spinner size="xs" /> Changing…</> : 'Change password'}
          </button>
          {saved === 'pw' && <span className="text-sm text-green-600">✓ Password updated</span>}
        </div>
      </form>
    </div>
  );
}
