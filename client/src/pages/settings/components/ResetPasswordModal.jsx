/* ============================================================
   Settings → Users · Set-password modal
   Admin sets a usable password for the user. They can use it
   immediately — no forced change on login. The platform's
   90-day rotation policy handles scheduled expiry.

   Split out of SettingsPage.jsx (2026-10). Behaviour unchanged.
   ============================================================ */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  KeyRound, Eye, EyeOff, Check, Copy, CheckCircle2,
  AlertTriangle, Loader2,
} from 'lucide-react';
import { settings as settingsApi } from '@/api/client.js';

export default function ResetPasswordModal({ user, onClose }) {
  const [result,     setResult]     = useState(null);
  const [copied,     setCopied]     = useState(false);
  const [errMsg,     setErrMsg]     = useState('');
  const [customPwd,  setCustomPwd]  = useState('');
  const [showPwd,    setShowPwd]    = useState(false);

  const { mutate, isPending } = useMutation({
    mutationFn: () => settingsApi.users.resetPassword(
      user.id ?? user._id,
      customPwd.trim() ? { password: customPwd.trim() } : {}
    ),
    onSuccess: res  => setResult(res?.data),
    onError:   err  => setErrMsg(err?.message ?? 'Failed to set password.'),
  });

  function copyPwd() {
    navigator.clipboard.writeText(result.password).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50"
        onClick={!result ? onClose : undefined}
      />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1,    opacity: 1 }}
        exit={{ scale: 0.95,    opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
      >
        {!result ? (
          /* ── Form ── */
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <KeyRound size={18} className="text-amber-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Set Password</h2>
                <p className="text-xs text-slate-500">{user.name ?? user.email}</p>
              </div>
            </div>

            <p className="text-sm text-slate-600">
              Set a new password for <strong>{user.name ?? user.email}</strong>. They can use it immediately — no forced change on login.
            </p>

            {/* Optional custom password */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Password <span className="text-slate-400 font-normal">(leave blank to auto-generate)</span>
              </label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={customPwd}
                  onChange={e => { setCustomPwd(e.target.value); setErrMsg(''); }}
                  placeholder="Type a password, or leave blank"
                  minLength={8}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {customPwd && customPwd.length < 8 && (
                <p className="text-xs text-amber-600 mt-1">Must be at least 8 characters</p>
              )}
            </div>

            <p className="text-xs text-slate-500">
              An email with the new password will be sent to{' '}
              <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{user.email}</span>
              {' '}— keep this dialog open in case the email doesn&apos;t arrive.
            </p>

            {errMsg && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errMsg}</p>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">
                Cancel
              </button>
              <button
                onClick={() => mutate()}
                disabled={isPending || (customPwd.length > 0 && customPwd.length < 8)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg transition"
              >
                {isPending && <Loader2 size={13} className="animate-spin" />}
                {isPending ? 'Saving…' : 'Set Password'}
              </button>
            </div>
          </div>
        ) : (
          /* ── Result ── */
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                <CheckCircle2 size={18} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Password Set</h2>
                <p className="text-xs text-slate-500">{result.name} · {result.email}</p>
              </div>
            </div>

            <p className="text-sm text-slate-600">Share this password securely with the user. They can log in with it immediately.</p>

            <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              <code className="flex-1 text-lg font-bold tracking-widest text-violet-700 font-mono break-all">
                {result.password}
              </code>
              <button
                onClick={copyPwd}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-white transition shrink-0"
              >
                {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            <div className={`rounded-lg px-3 py-2.5 text-xs flex items-start gap-2 ${result.emailSent ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              {result.emailSent ? (
                <><CheckCircle2 size={13} className="shrink-0 mt-0.5" /> Email with the new password sent to {result.email}.</>
              ) : (
                <><AlertTriangle size={13} className="shrink-0 mt-0.5" /> Email could not be sent — share this password directly with {result.name}.</>
              )}
            </div>

            <p className="text-[11px] text-slate-400">This password will not be shown again after you close this dialog.</p>

            <div className="flex justify-end pt-1">
              <button onClick={onClose} className="px-5 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition">
                Done
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </>
  );
}
