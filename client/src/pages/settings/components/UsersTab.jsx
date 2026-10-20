/* ============================================================
   Settings → Users tab

   Redesigned (2026-10): server-side filtering + pagination, a KPI
   row describing the school's account population, a denser table
   with avatars/joined dates, and a proper "Removed accounts" panel
   that paginates too.

   Filtering and pagination are done SERVER-SIDE (see
   server/routes/settings.js GET /api/settings/users) so the table
   stays fast on a school with hundreds of accounts, and so the
   "Showing X–Y of Z" count is the real filtered count rather than
   a number derived from a list that was already truncated.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Users, UserPlus, Search, X, Check, Pencil, KeyRound, Trash2,
  Archive, RefreshCcw, AlertTriangle, Loader2, ChevronDown, UserCheck,
  GraduationCap, UserRound, ShieldCheck, RotateCcw,
} from 'lucide-react';
import { settings as settingsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { STAFF_ROLE_KEYS, roleLabel } from '@/utils/roleLabels.js';
import { Toast, RolePill, SYSTEM_ROLES, PROTECTED_ROLES, USER_ROLE_GROUPS, initialsOf } from './SettingsPrimitives.jsx';
import PaginationBar from './PaginationBar.jsx';
import InviteSlideOver from './InviteSlideOver.jsx';
import ResetPasswordModal from './ResetPasswordModal.jsx';

/* ── Avatar tint palette ──────────────────────────────────────── */
const AVATAR_TINTS = [
  'bg-violet-100 text-violet-700',
  'bg-blue-100   text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100  text-amber-700',
  'bg-rose-100   text-rose-700',
  'bg-cyan-100   text-cyan-700',
  'bg-indigo-100 text-indigo-700',
];
function tintFor(seed = '') {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_TINTS[h % AVATAR_TINTS.length];
}

/* ── Debounce a fast-changing value (the search box) ──────────── */
function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/* ── Stat card ────────────────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, sub, tone = 'slate', onClick, active }) {
  const tones = {
    slate:   'bg-slate-100   text-slate-600',
    violet:  'bg-violet-100  text-violet-600',
    blue:    'bg-blue-100    text-blue-600',
    amber:   'bg-amber-100   text-amber-600',
    emerald: 'bg-emerald-100 text-emerald-600',
  };
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      type={onClick ? 'button' : undefined}
      className={`text-left bg-white border rounded-xl px-4 py-3 flex items-center gap-3 transition ${
        active ? 'border-slate-900 ring-1 ring-slate-900/10' : 'border-slate-200'
      } ${onClick ? 'hover:border-slate-300 hover:shadow-sm cursor-pointer' : ''}`}
    >
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tones[tone]}`}>
        <Icon size={16} />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-bold text-slate-800 leading-tight tabular-nums">{value ?? '—'}</span>
        <span className="block text-[11px] text-slate-500 truncate">{label}</span>
        {sub && <span className="block text-[10px] text-slate-400 truncate">{sub}</span>}
      </span>
    </Tag>
  );
}

export default function UsersTab() {
  const qc = useQueryClient();
  const can        = useAuthStore(s => s.can.bind(s));
  const sessionRole = useAuthStore(s => s.session?.user?.role ?? '');
  const canManage  = can('settings') || sessionRole === 'admin' || sessionRole === 'superadmin';

  const [toast, setToast]             = useState(null);
  const [showInvite, setShowInvite]   = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);
  const [roleFilter, setRoleFilter]   = useState('');
  const [search, setSearch]           = useState('');
  const [page, setPage]               = useState(1);
  const [limit, setLimit]             = useState(25);
  const [removedPage, setRemovedPage] = useState(1);

  const [resetPwdUser, setResetPwdUser] = useState(null);
  const [editingUserId, setEditingUserId] = useState(null);
  const [editNameVal,   setEditNameVal]   = useState('');
  const [editingRoleId, setEditingRoleId] = useState(null);

  const debouncedSearch = useDebounced(search, 300);

  /* Reset to page 1 whenever the result set changes shape */
  useEffect(() => { setPage(1); }, [debouncedSearch, roleFilter, limit]);

  /* ── Users (paginated, server-filtered) ───────────────────── */
  const {
    data: usersData, isLoading, isError, error, refetch,
    isFetching,
  } = useQuery({
    queryKey: ['settings', 'users', 'list', { page, limit, role: roleFilter, q: debouncedSearch }],
    queryFn:  () => settingsApi.users.list({
      page, limit,
      ...(roleFilter && { role: roleFilter }),
      ...(debouncedSearch && { q: debouncedSearch }),
    }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const users       = usersData?.data ?? [];
  const pagination  = usersData?.pagination;
  const stats       = usersData?.stats;
  const totalUsers  = pagination?.total ?? 0;

  /* ── Removed accounts ──────────────────────────────────────── */
  const { data: removedData, isLoading: removedLoading } = useQuery({
    queryKey: ['settings', 'users', 'removed', { page: removedPage, limit }],
    queryFn:  () => settingsApi.users.listRemoved({ page: removedPage, limit }),
    enabled:  showRemoved,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const removedUsers    = removedData?.data ?? [];
  const removedTotal    = removedData?.pagination?.total ?? stats?.removedTotal ?? 0;
  const removedPages    = removedData?.pagination?.pages ?? 1;

  /* ── School doc — hiddenSystemRoles + role renames ─────────── */
  const { data: schoolData } = useQuery({
    queryKey: ['settings', 'school'],
    queryFn:  () => settingsApi.school.get(),
    staleTime: 60_000,
  });
  const hiddenSystemRoles = schoolData?.data?.hiddenSystemRoles ?? [];
  const roleLabels        = schoolData?.data?.roleLabels ?? {};

  /* ── Custom roles so filter + pills stay in sync ────────────── */
  const { data: crData } = useQuery({
    queryKey: ['settings', 'custom-roles'],
    queryFn:  () => settingsApi.customRoles.list(),
    staleTime: 60_000,
  });
  const customRoles = crData?.data ?? [];

  const roleGroups = useMemo(() => [
    ...USER_ROLE_GROUPS.map(g => (g.value ? { ...g, label: roleLabel(g.value, roleLabels) } : g)),
    ...customRoles.map(cr => ({ value: cr.key, label: cr.label })),
  ], [roleLabels, customRoles]);

  /* ── KPI numbers ───────────────────────────────────────────── */
  const byRole = stats?.byRole ?? {};
  const countRoles = (keys) => keys.reduce((sum, k) => sum + (byRole[k] ?? 0), 0);
  const staffCount    = countRoles(STAFF_ROLE_KEYS);
  const studentCount  = byRole.student ?? 0;
  const parentCount   = byRole.parent ?? 0;
  const adminCount    = countRoles(['admin', 'superadmin']);
  const customCount   = Object.keys(byRole).filter(k => !SYSTEM_ROLES.includes(k)).reduce((s, k) => s + byRole[k], 0);

  /* ── Mutations ─────────────────────────────────────────────── */
  const { mutate: reactivateUser, isPending: reactivating } = useMutation({
    mutationFn: id => settingsApi.users.reactivate(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['settings', 'users'] });
      const d = res?.data;
      setToast({
        msg: d?.emailSent
          ? `${d.name} reactivated — a new temporary password was emailed to them.`
          : `${d?.name ?? 'User'} reactivated. New temporary password: ${d?.password} (email failed to send — share this manually).`,
        type: 'success',
      });
    },
    onError: err => setToast({ msg: err?.message ?? 'Reactivate failed.', type: 'error' }),
  });

  const { mutate: removeUser } = useMutation({
    mutationFn: id => settingsApi.users.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'users'] });
      setToast({ msg: 'User removed.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Remove failed.', type: 'error' }),
  });

  const { mutate: saveName, isPending: savingName } = useMutation({
    mutationFn: ({ id, name }) => settingsApi.users.update(id, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'users'] });
      setEditingUserId(null);
      setToast({ msg: 'Name updated.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to update name.', type: 'error' }),
  });

  const { mutate: saveRole, isPending: savingRole } = useMutation({
    mutationFn: ({ id, role }) => settingsApi.users.update(id, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'users'] });
      setEditingRoleId(null);
      setToast({ msg: 'Role updated. User session revoked — they must log in again.', type: 'success' });
    },
    onError: err => {
      setEditingRoleId(null);
      setToast({ msg: err?.message ?? 'Failed to update role.', type: 'error' });
    },
  });

  /* Roles available to assign — excludes superadmin (platform-level) */
  const assignableRoles = useMemo(() => [
    ...SYSTEM_ROLES.filter(r => r !== 'superadmin').map(r => ({ value: r, label: roleLabel(r, roleLabels) })),
    ...customRoles.map(cr => ({ value: cr.key, label: cr.label })),
  ], [roleLabels, customRoles]);

  function confirmRemove(u) {
    if (!window.confirm(`Remove ${u.name ?? u.email} from this school? They will lose access immediately.`)) return;
    removeUser(u.id ?? u._id);
  }

  function startEditName(u) {
    setEditingUserId(u.id ?? u._id);
    setEditNameVal(u.name ?? '');
  }

  function commitNameEdit(u) {
    const trimmed = editNameVal.trim();
    if (!trimmed || trimmed === u.name) { setEditingUserId(null); return; }
    saveName({ id: u.id ?? u._id, name: trimmed });
  }

  const hasFilter = !!(roleFilter || debouncedSearch);

  return (
    <div className="space-y-4">
      {/* Toast */}
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 w-9 h-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0">
            <Users size={17} />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 tracking-tight">Users</h2>
            <p className="text-sm text-slate-500">
              Everyone with access to this school. Change a role, reset a password, or remove an account.
            </p>
          </div>
        </div>

        {canManage && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowRemoved(v => !v); setRemovedPage(1); }}
              className={`flex items-center gap-1.5 border text-sm font-medium px-3 py-2 rounded-lg transition ${
                showRemoved
                  ? 'border-slate-300 bg-slate-100 text-slate-700'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Archive size={13} /> Removed
              {removedTotal > 0 && (
                <span className="ml-0.5 rounded-full bg-slate-200 text-slate-600 px-1.5 text-[10px] font-semibold tabular-nums">
                  {removedTotal}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowInvite(true)}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-3 py-2 rounded-lg transition"
            >
              <UserPlus size={13} /> Invite user
            </button>
          </div>
        )}
      </div>

      {/* ── KPI row ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard icon={UserCheck} label="Active accounts" value={stats?.activeTotal ?? '—'} tone="violet" />
        <StatCard icon={ShieldCheck} label="Staff" value={staffCount} tone="blue" sub={`${adminCount} admin`} />
        <StatCard icon={GraduationCap} label="Students" value={studentCount} tone="amber" />
        <StatCard icon={UserRound} label="Parents" value={parentCount} tone="emerald" />
        <StatCard
          icon={RotateCcw}
          label="Custom roles"
          value={customCount}
          tone="slate"
          sub={customRoles.length ? `${customRoles.length} defined` : 'none defined'}
        />
      </div>

      {/* ── Removed accounts panel ────────────────────────────── */}
      <AnimatePresence initial={false}>
        {showRemoved && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200/70 flex items-start gap-2">
                <Archive size={14} className="text-slate-400 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-slate-700">
                    Removed accounts {removedTotal > 0 && <span className="text-slate-400 font-normal">({removedTotal})</span>}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    A removed account still holds its email — reactivate one instead of inviting the same address again.
                  </p>
                </div>
              </div>

              {removedLoading ? (
                <div className="space-y-2 p-3">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />)}
                </div>
              ) : removedUsers.length === 0 ? (
                <p className="text-xs text-slate-400 px-4 py-4">No removed accounts.</p>
              ) : (
                <>
                  <div className="divide-y divide-slate-100">
                    {removedUsers.map(u => (
                      <div key={u.id ?? u._id} className="flex items-center justify-between gap-3 bg-white px-4 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${tintFor(u.email ?? u.name ?? '')}`}>
                            {initialsOf(u.name ?? u.email)}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{u.name ?? u.email}</p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {u.email}{u.updatedAt ? ` · removed ${new Date(u.updatedAt).toLocaleDateString()}` : ''}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => reactivateUser(u.id ?? u._id)}
                          disabled={reactivating}
                          className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 px-2.5 py-1.5 rounded-lg transition"
                        >
                          <RefreshCcw size={12} /> Reactivate
                        </button>
                      </div>
                    ))}
                  </div>
                  {removedPages > 1 && (
                    <PaginationBar
                      page={removedPage}
                      totalPages={removedPages}
                      total={removedTotal}
                      limit={limit}
                      onPage={setRemovedPage}
                      itemLabel="removed accounts"
                      limitOptions={[]}
                    />
                  )}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Filter bar ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name or email…"
            aria-label="Search users by name or email"
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400 transition"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <div className="relative">
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            aria-label="Filter by role"
            className="appearance-none rounded-lg border border-slate-200 bg-white pl-3 pr-8 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400 transition"
          >
            {roleGroups.map(g => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {hasFilter && (
          <button
            onClick={() => { setRoleFilter(''); setSearch(''); }}
            className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition"
          >
            <X size={12} /> Clear
          </button>
        )}

        {isFetching && !isLoading && (
          <span className="flex items-center gap-1.5 text-xs text-slate-400">
            <Loader2 size={12} className="animate-spin" /> Updating…
          </span>
        )}
      </div>

      {/* ── Table ─────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-slate-50 last:border-0">
              <div className="w-8 h-8 rounded-full bg-slate-100 animate-pulse shrink-0" />
              <div className="h-3 w-40 bg-slate-100 rounded animate-pulse" />
              <div className="h-3 w-48 bg-slate-50 rounded animate-pulse ml-auto hidden sm:block" />
              <div className="h-5 w-20 bg-slate-100 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="bg-white border border-red-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <AlertTriangle size={20} className="text-red-400" />
          <p className="text-sm text-slate-600">{error?.message}</p>
          <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
        </div>
      ) : users.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-14 flex flex-col items-center gap-3">
          <span className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center">
            <Users size={20} className="text-slate-300" />
          </span>
          <p className="text-sm font-medium text-slate-700">
            {hasFilter ? 'No users match these filters' : 'No users yet'}
          </p>
          <p className="text-xs text-slate-400 max-w-xs text-center">
            {hasFilter
              ? 'Try a different search term or clear the role filter.'
              : 'Invite your team to get started.'}
          </p>
          {hasFilter && (
            <button
              onClick={() => { setRoleFilter(''); setSearch(''); }}
              className="mt-1 text-xs font-medium text-violet-600 hover:text-violet-700 underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/60">
                  <th className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5">User</th>
                  <th className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5 hidden md:table-cell">Email</th>
                  <th className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5">Role</th>
                  <th className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wider px-4 py-2.5 hidden lg:table-cell">Joined</th>
                  {canManage && <th className="px-4 py-2.5 w-10" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {users.map(u => {
                  const uid       = u.id ?? u._id;
                  const isEditing = editingUserId === uid;
                  const display    = u.name ?? u.email ?? '—';
                  return (
                    <tr key={uid} className="hover:bg-slate-50/70 transition group">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${tintFor(u.email ?? display)}`}>
                            {initialsOf(display)}
                          </span>
                          <div className="min-w-0">
                            {isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  autoFocus
                                  value={editNameVal}
                                  onChange={e => setEditNameVal(e.target.value)}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') commitNameEdit(u);
                                    if (e.key === 'Escape') setEditingUserId(null);
                                  }}
                                  className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40"
                                />
                                <button
                                  onClick={() => commitNameEdit(u)}
                                  disabled={savingName}
                                  className="p-1 text-emerald-500 hover:bg-emerald-50 rounded transition"
                                  title="Save name"
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  onClick={() => setEditingUserId(null)}
                                  className="p-1 text-slate-400 hover:bg-slate-100 rounded transition"
                                  title="Cancel"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            ) : (
                              <>
                                <p className="font-medium text-slate-800 truncate max-w-[180px] sm:max-w-none">{display}</p>
                                <p className="text-[11px] text-slate-400 truncate md:hidden">{u.email}</p>
                              </>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs hidden md:table-cell truncate max-w-[220px]">{u.email}</td>
                      <td className="px-4 py-2.5">
                        {canManage && editingRoleId === uid ? (
                          <select
                            autoFocus
                            defaultValue={u.role}
                            disabled={savingRole}
                            onChange={e => {
                              const newRole = e.target.value;
                              if (newRole !== u.role) saveRole({ id: uid, role: newRole });
                              else setEditingRoleId(null);
                            }}
                            onBlur={() => setEditingRoleId(null)}
                            className="rounded border border-violet-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400/40"
                          >
                            {assignableRoles.map(r => (
                              <option key={r.value} value={r.value}>{r.label}</option>
                            ))}
                          </select>
                        ) : (
                          <button
                            onClick={() => canManage && !PROTECTED_ROLES.has(u.role) && setEditingRoleId(uid)}
                            className={canManage && !PROTECTED_ROLES.has(u.role) ? 'cursor-pointer hover:opacity-80 transition' : 'cursor-default'}
                            title={canManage && !PROTECTED_ROLES.has(u.role) ? 'Click to change role' : undefined}
                          >
                            <RolePill role={u.role} customRoles={customRoles} roleLabels={roleLabels} />
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-400 hidden lg:table-cell whitespace-nowrap">
                        {u.createdAt ? new Date(u.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                      </td>
                      {canManage && (
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
                            <button
                              onClick={() => startEditName(u)}
                              className="p-1.5 text-slate-300 hover:text-violet-500 hover:bg-violet-50 rounded-lg transition"
                              title="Edit name"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => setResetPwdUser(u)}
                              className="p-1.5 text-slate-300 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition"
                              title="Set password"
                            >
                              <KeyRound size={13} />
                            </button>
                            <button
                              onClick={() => confirmRemove(u)}
                              className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                              title="Remove user"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <PaginationBar
            page={page}
            totalPages={pagination?.pages ?? 1}
            total={totalUsers}
            limit={limit}
            onPage={setPage}
            onLimit={(n) => setLimit(n)}
            itemLabel="users"
          />
        </div>
      )}

      {/* Invite slide-over */}
      <AnimatePresence>
        {showInvite && (
          <InviteSlideOver
            customRoles={customRoles}
            hiddenSystemRoles={hiddenSystemRoles}
            roleLabels={roleLabels}
            onClose={() => setShowInvite(false)}
            onInvited={() => {
              setShowInvite(false);
              qc.invalidateQueries({ queryKey: ['settings', 'users'] });
              setToast({ msg: 'Invitation sent.', type: 'success' });
            }}
          />
        )}
      </AnimatePresence>

      {/* Reset password modal */}
      <AnimatePresence>
        {resetPwdUser && (
          <ResetPasswordModal user={resetPwdUser} onClose={() => setResetPwdUser(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}
