/**
 * ResetPassword — the page a forgot-password link lands on.
 *
 * The link is `…/reset-password?ticket=<single-use>&school=<slug>`; the ticket
 * is the entire authorization, so this page holds no logic about WHO the user
 * is — it just collects a new password and spends the ticket.
 *
 * On success it deliberately does NOT sign the user in. A reset proves control
 * of an inbox, not knowledge of the password; signing in with the new one is
 * what confirms it actually worked.
 */
import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { auth as authApi, APIError } from '@/api/client.js';
import { Spinner } from '@/components/ui/Spinner.jsx';
import { storeSchoolSlug } from '@/utils/schoolDetect.js';
import { AlertTriangle, CheckCircle2, KeyRound } from 'lucide-react';

export default function ResetPassword() {
  const [params]   = useSearchParams();
  const navigate   = useNavigate();

  const ticket = params.get('ticket') || '';
  const school = params.get('school') || '';

  // The API client sends X-School-Slug from storage/subdomain; the link may
  // land on the bare host, so pin the slug the link carried.
  if (school) storeSchoolSlug(school);

  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [error,    setError]    = useState('');
  const [done,     setDone]     = useState(false);
  const [loading,  setLoading]  = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }

    setLoading(true); setError('');
    try {
      await authApi.resetPassword({ ticket, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Could not reset your password. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-7">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center">
            <KeyRound size={17} className="text-indigo-600" />
          </div>
          <div>
            <h1 className="text-[17px] font-bold text-slate-900 leading-tight">Choose a new password</h1>
            <p className="text-[12px] text-slate-500">Msingi</p>
          </div>
        </div>

        {/* No ticket => the page was opened without a link (bookmark, typo). */}
        {!ticket && !done && (
          <div id="reset-no-ticket" className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">This link is incomplete</p>
              <p className="text-sm text-amber-700 mt-0.5">
                Open the reset link from your email exactly as it arrived, or request a new one.
              </p>
              <button type="button" onClick={() => navigate('/login', { replace: true })}
                className="mt-2 text-sm font-semibold text-amber-800 hover:underline">
                Go to sign in
              </button>
            </div>
          </div>
        )}

        {done && (
          <div id="reset-done" className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-600" />
              <p className="text-sm font-semibold text-emerald-800">Password changed</p>
            </div>
            <p className="text-sm text-emerald-700 mt-1">
              You can sign in with your new password now. Any other device that was signed in
              has been signed out.
            </p>
            <button type="button" onClick={() => navigate('/login', { replace: true })}
              className="mt-3 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
              Go to sign in
            </button>
          </div>
        )}

        {ticket && !done && (
          <>
            {error && (
              <div id="reset-error" className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 mb-4">
                <AlertTriangle size={15} className="text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}

            <form onSubmit={onSubmit} className="space-y-4">
              <div className="form-group">
                <label htmlFor="reset-password" className="form-label">New password</label>
                <input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  className="form-input w-full"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="reset-confirm" className="form-label">Confirm new password</label>
                <input
                  id="reset-confirm"
                  type="password"
                  autoComplete="new-password"
                  className="form-input w-full"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat it"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {loading ? <><Spinner size="sm" /> Saving…</> : 'Set new password'}
              </button>

              <p className="text-[12px] text-slate-400 text-center">
                Links expire an hour after they are sent and work only once.
              </p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
