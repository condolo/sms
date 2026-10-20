/* ============================================================
   Settings → Users · Invite slide-over
   Split out of SettingsPage.jsx (2026-10) so the Users tab file
   stays about the Users tab. Behaviour unchanged.
   ============================================================ */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { X, Mail, Loader2, AlertTriangle } from 'lucide-react';
import { settings as settingsApi } from '@/api/client.js';
import { roleLabel } from '@/utils/roleLabels.js';
import { SYSTEM_ROLES, FField, iCls } from './SettingsPrimitives.jsx';

export default function InviteSlideOver({ customRoles = [], hiddenSystemRoles = [], roleLabels = {}, onClose, onInvited }) {
  const [email, setEmail] = useState('');
  const [role,  setRole]  = useState('teacher');
  const [name,  setName]  = useState('');
  const [errors, setErrors] = useState({});

  const { mutate, isPending } = useMutation({
    mutationFn: () => settingsApi.users.invite({ email, role, name }),
    onSuccess:  () => onInvited(),
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
            <div className="flex items-start gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />{errors._server}
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
              {/* System roles: exclude superadmin (can't be invited) and school-hidden roles */}
              {SYSTEM_ROLES
                .filter(r => r !== 'superadmin' && !hiddenSystemRoles.includes(r))
                .map(r => (
                  <option key={r} value={r}>{roleLabel(r, roleLabels)}</option>
                ))
              }
              {customRoles.length > 0 && (
                <optgroup label="── Custom Roles ──">
                  {customRoles.map(cr => (
                    <option key={cr.key} value={cr.key}>{cr.label}</option>
                  ))}
                </optgroup>
              )}
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
