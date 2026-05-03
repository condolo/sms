import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner.jsx';
import useAuthStore from '@/store/auth.js';
import { auth as authApi, APIError } from '@/api/client.js';

export default function Login() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const setSession     = useAuthStore((s) => s.setSession);
  const isAuthenticated = useAuthStore((s) => !!s.session?.token);

  const from = location.state?.from?.pathname ?? '/dashboard';

  // If already logged in, redirect immediately
  useEffect(() => {
    if (isAuthenticated) navigate(from, { replace: true });
  }, [isAuthenticated, from, navigate]);

  // ─── Form state ─────────────────────────────────────────────────────────────
  const [mode, setMode]       = useState('login');       // 'login' | 'change-password'
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [pwToken, setPwToken] = useState(null);  // from password-expired response

  function clearError() { setError(''); }

  // ─── Login submit ────────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');

    try {
      const res = await authApi.login({ email: email.trim().toLowerCase(), password });

      // Server returns { passwordExpired: true, token } when forced reset is needed
      if (res?.passwordExpired) {
        setPwToken(res.token);
        setMode('change-password');
        setLoading(false);
        return;
      }

      setSession({ token: res.token, user: res.user });
      navigate(from, { replace: true });
    } catch (err) {
      setError(
        err instanceof APIError
          ? err.message
          : 'Unable to sign in. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  // ─── Change password submit ───────────────────────────────────────────────
  async function handleChangePassword(e) {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await authApi.changePassword({
        token:       pwToken,
        newPassword,
        confirmPassword,
      });
      setSession({ token: res.token, user: res.user });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Password change failed.');
    } finally {
      setLoading(false);
    }
  }

  // ─── UI ──────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-3/5 flex-col justify-between bg-sidebar-bg p-12">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white font-bold">
            IL
          </span>
          <span className="text-xl font-semibold text-white">InnoLearn</span>
        </div>

        <div>
          <blockquote className="text-2xl font-light text-white/90 leading-relaxed">
            "Empowering educators with the tools to inspire, track, and grow every learner."
          </blockquote>
          <div className="mt-8 flex gap-6">
            {[
              { label: 'Students managed', value: '50k+' },
              { label: 'Schools on platform', value: '200+' },
              { label: 'Uptime', value: '99.9%' },
            ].map((stat) => (
              <div key={stat.label}>
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-sm text-white/60 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-white/40">© {new Date().getFullYear()} InnoLearn. All rights reserved.</p>
      </div>

      {/* Right panel — form */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 bg-slate-50">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2 mb-8">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white font-bold text-sm">
              IL
            </span>
            <span className="font-semibold text-slate-800">InnoLearn</span>
          </div>

          {mode === 'login' ? (
            <>
              <h2 className="text-2xl font-bold text-slate-800">Welcome back</h2>
              <p className="mt-1 text-sm text-slate-500">Sign in to your school account</p>

              <form onSubmit={handleLogin} className="mt-8 space-y-4">
                {error && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
                    <span className="shrink-0 mt-0.5">⚠</span>
                    <span>{error}</span>
                  </div>
                )}

                <div>
                  <label htmlFor="email" className="form-label">Email address</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); clearError(); }}
                    className="form-input"
                    placeholder="you@school.edu"
                    disabled={loading}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="password" className="form-label !mb-0">Password</label>
                  </div>
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); clearError(); }}
                    className="form-input"
                    placeholder="••••••••"
                    disabled={loading}
                  />
                </div>

                <button type="submit" className="btn-primary w-full justify-center py-2.5" disabled={loading}>
                  {loading ? <><Spinner size="sm" /> Signing in…</> : 'Sign in'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-slate-800">Set a new password</h2>
              <p className="mt-1 text-sm text-slate-500">
                Your password has expired. Please choose a new one to continue.
              </p>

              <form onSubmit={handleChangePassword} className="mt-8 space-y-4">
                {error && (
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
                    <span className="shrink-0 mt-0.5">⚠</span>
                    <span>{error}</span>
                  </div>
                )}

                <div>
                  <label htmlFor="new-password" className="form-label">New password</label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    value={newPassword}
                    onChange={(e) => { setNewPassword(e.target.value); clearError(); }}
                    className="form-input"
                    placeholder="At least 8 characters"
                    disabled={loading}
                  />
                </div>

                <div>
                  <label htmlFor="confirm-password" className="form-label">Confirm password</label>
                  <input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); clearError(); }}
                    className="form-input"
                    placeholder="Repeat your new password"
                    disabled={loading}
                  />
                </div>

                <button type="submit" className="btn-primary w-full justify-center py-2.5" disabled={loading}>
                  {loading ? <><Spinner size="sm" /> Updating…</> : 'Update password & sign in'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
