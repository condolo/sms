/* ============================================================
   UsersPermissionsSlideOver — "Users & Permissions" without leaving the
   dashboard.

   Two jobs an admin used to have to go to Settings for:
     • inviting/activating people        (settings:users)
     • editing role & per-user grants    (settings:permissions)

   The panels are the SAME components the Settings page renders — UsersTab
   directly, RolesTab lazily out of the settings module — so there is one
   implementation of each and no chance of the two doors disagreeing about
   what a grant means. Each tab is shown only for the grant the server would
   actually accept, mirroring settings.js's own gates.
   ============================================================ */
import { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, ShieldCheck, Users, X } from 'lucide-react';
import clsx from 'clsx';
import useAuthStore from '@/store/auth.js';
import UsersTab from '@/pages/settings/components/UsersTab.jsx';

/* Lazy: the settings page is a big module and the dashboard should not carry
   it just because this panel can be opened. */
const RolesTab = lazy(() =>
  import('@/pages/settings/SettingsPage.jsx').then(m => ({ default: m.RolesTab })));

function PanelFallback() {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-slate-400">
      <Loader2 size={16} className="animate-spin" /> Loading…
    </div>
  );
}

export default function UsersPermissionsSlideOver({ open, onClose }) {
  const can      = useAuthStore(s => s.can.bind(s));
  const userRole = useAuthStore(s => s.session?.user?.role ?? '');
  const isAdmin  = ['admin', 'superadmin'].includes(userRole);

  const canUsers = isAdmin || can('settings', 'users');
  const canPerms = isAdmin || can('settings', 'permissions');

  const tabs = [
    canUsers && { id: 'users', label: 'Users', Icon: Users },
    canPerms && { id: 'roles', label: 'Roles & Permissions', Icon: ShieldCheck },
  ].filter(Boolean);

  const [tab, setTab] = useState(tabs[0]?.id ?? 'users');

  /* Opening the panel should always land on a tab this role may see, even if
     the grant changed while the page was open. */
  useEffect(() => {
    if (!open) return;
    if (!tabs.some(t => t.id === tab)) setTab(tabs[0]?.id ?? 'users');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canUsers, canPerms]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-5xl flex-col bg-slate-50 shadow-2xl"
          >
            {/* Header */}
            <div className="relative shrink-0 overflow-hidden bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-5 text-white">
              <div className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/10" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10">
                    <ShieldCheck size={19} />
                  </span>
                  <div>
                    <h2 className="text-lg font-bold">Users &amp; Permissions</h2>
                    <p className="mt-0.5 text-xs text-white/70">
                      Manage who can sign in, and exactly what each role or person may do.
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-xl bg-white/10 p-2 text-white/80 transition hover:bg-white/20 hover:text-white"
                  aria-label="Close users and permissions"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Tabs */}
            {tabs.length > 1 && (
              <div className="shrink-0 border-b border-slate-200 bg-white px-6 pt-3">
                <div className="flex gap-1 rounded-xl bg-slate-100/80 p-1">
                  {tabs.map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={clsx(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition',
                        tab === id ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                      )}
                    >
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {tabs.length === 0 ? (
                <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                    <ShieldCheck size={22} />
                  </div>
                  <p className="text-sm font-semibold text-slate-700">No access to this panel</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Managing users needs “Manage Users / Invites”, and editing grants
                    needs “Manage Roles &amp; Permissions”.
                  </p>
                </div>
              ) : tab === 'users' ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <UsersTab />
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <Suspense fallback={<PanelFallback />}>
                    <RolesTab />
                  </Suspense>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
