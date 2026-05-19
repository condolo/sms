import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner.jsx';
import useAuthStore from '@/store/auth.js';
import { auth as authApi, publicApi, APIError } from '@/api/client.js';
import { detectSchool, storeSchoolSlug } from '@/utils/schoolDetect.js';

/* ── School branding hook ──────────────────────────────────────
   Fetches public school info once on mount. Used to brand the
   login page before the user has authenticated.
*/
function useSchoolBranding(slug) {
  const [branding, setBranding] = useState(null);
  const [loadingBranding, setLoadingBranding] = useState(!!slug);

  useEffect(() => {
    if (!slug) { setLoadingBranding(false); return; }
    setLoadingBranding(true);
    publicApi.schoolInfo(slug)
      .then(data => { setBranding(data); setLoadingBranding(false); })
      .catch(() => { setBranding(null); setLoadingBranding(false); });
  }, [slug]);

  return { branding, loadingBranding };
}

/* ── OTP mode state ────────────────────────────────────────────── */
const MODES = {
  LOGIN:           'login',
  OTP:             'otp',
  CHANGE_PASSWORD: 'change-password',
};

/* ── Demo Quick-Login panel ─────────────────────────────────────────────────
   Only rendered when the school slug is "demo".
   Each card one-click fills credentials and auto-submits.
─────────────────────────────────────────────────────────────────────────── */
const DEMO_ACCOUNTS = [
  { role: 'Administrator',   email: 'admin@demo.msingi.io',     color: '#4f46e5', bg: '#eef2ff', badge: 'Full access'   },
  { role: 'Deputy Principal',email: 'principal@demo.msingi.io', color: '#0891b2', bg: '#ecfeff', badge: 'Academic lead' },
  { role: 'Teacher',         email: 'teacher@demo.msingi.io',   color: '#059669', bg: '#ecfdf5', badge: 'Classroom'     },
  { role: 'Finance Officer', email: 'finance@demo.msingi.io',   color: '#d97706', bg: '#fffbeb', badge: 'Finance'       },
  { role: 'Parent',          email: 'parent@demo.msingi.io',    color: '#7c3aed', bg: '#f5f3ff', badge: 'Guardian view' },
  { role: 'Student',         email: 'student@demo.msingi.io',   color: '#db2777', bg: '#fdf2f8', badge: 'Student view'  },
];
const DEMO_PASSWORD = 'Demo2025!';

function DemoPanel({ onPick }) {
  return (
    <div className="mt-8 pt-7 border-t border-slate-200">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3 text-center">
        Quick login — explore as any role
      </p>
      <div className="grid grid-cols-1 gap-2">
        {DEMO_ACCOUNTS.map(({ role, email, color, bg, badge }) => (
          <button
            key={email}
            type="button"
            onClick={() => onPick(email, DEMO_PASSWORD)}
            className="flex items-center gap-3 rounded-xl px-4 py-2.5 text-left transition-all hover:scale-[1.01] hover:shadow-md active:scale-100"
            style={{ background: bg, border: `1px solid ${color}22` }}
          >
            {/* Avatar */}
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
              style={{ background: color }}
            >
              {role[0]}
            </div>
            {/* Label */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 leading-tight">{role}</p>
              <p className="text-[10px] text-slate-400 truncate">{email}</p>
            </div>
            {/* Badge */}
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ background: `${color}18`, color }}
            >
              {badge}
            </span>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 text-center mt-3">
        Password: <span className="font-mono font-semibold text-slate-500">{DEMO_PASSWORD}</span>
        {' · '}Demo data only, resets periodically.
      </p>
    </div>
  );
}

export default function Login() {
  const navigate           = useNavigate();
  const location           = useLocation();
  const setSession         = useAuthStore((s) => s.setSession);
  const isAuthenticated    = useAuthStore((s) => !!s.session?.token);

  const from = location.state?.from?.pathname ?? '/dashboard';

  // Detect school from subdomain / query param
  const { slug, isSchool } = detectSchool();
  const { branding, loadingBranding } = useSchoolBranding(slug);

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) navigate(from, { replace: true });
  }, [isAuthenticated, from, navigate]);

  // Persist slug so returning users are recognised
  useEffect(() => {
    if (slug) storeSchoolSlug(slug);
  }, [slug]);

  // ─── Form state ─────────────────────────────────────────────────────────────
  const [mode, setMode]               = useState(MODES.LOGIN);
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp]                 = useState('');
  const [pendingMfa, setPendingMfa]   = useState(null); // { userId, schoolId }
  const [pendingPw, setPendingPw]     = useState(null);  // { userId, schoolId, reason }
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  function clearError() { setError(''); }

  // ─── Branding helpers ────────────────────────────────────────────────────────
  const schoolName   = branding?.name     || (slug ? slug.toUpperCase() : 'Msingi');
  const shortName    = branding?.shortName || schoolName;
  const logoUrl      = branding?.logoUrl   || null;
  const primary      = branding?.primaryColor || '#4f46e5';
  const accent       = branding?.accentColor  || '#7c3aed';
  const initials     = shortName.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  // ─── Demo quick-login — fills credentials and submits ────────────────────────
  async function handleQuickLogin(demoEmail, demoPassword) {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login({ email: demoEmail.toLowerCase(), password: demoPassword });
      if (res?.mfaRequired) { setPendingMfa({ userId: res.userId, schoolId: res.schoolId }); setMode(MODES.OTP); setLoading(false); return; }
      if (res?.passwordExpired) { setPendingPw({ userId: res.userId, schoolId: res.schoolId, reason: res.reason }); setMode(MODES.CHANGE_PASSWORD); setLoading(false); return; }
      setSession({ token: res.token, user: res.user, school: res.school });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Demo login failed — please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ─── Login ──────────────────────────────────────────────────────────────────
  async function handleLogin(e) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true); setError('');
    try {
      const res = await authApi.login({ email: email.trim().toLowerCase(), password });

      // 2FA required
      if (res?.mfaRequired) {
        setPendingMfa({ userId: res.userId, schoolId: res.schoolId });
        setMode(MODES.OTP);
        setLoading(false);
        return;
      }

      // Password expired or first-login change required
      if (res?.passwordExpired) {
        setPendingPw({ userId: res.userId, schoolId: res.schoolId, reason: res.reason });
        setMode(MODES.CHANGE_PASSWORD);
        setLoading(false);
        return;
      }

      setSession({ token: res.token, user: res.user, school: res.school });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ─── OTP verify ─────────────────────────────────────────────────────────────
  async function handleOtp(e) {
    e.preventDefault();
    if (!otp.trim()) return;
    setLoading(true); setError('');
    try {
      const res = await authApi.verifyOtp({
        userId:   pendingMfa.userId,
        schoolId: pendingMfa.schoolId,
        otp:      otp.trim(),
      });
      setSession({ token: res.token, user: res.user, school: res.school });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Invalid code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ─── Force password change ───────────────────────────────────────────────────
  async function handleChangePassword(e) {
    e.preventDefault();
    if (newPassword.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true); setError('');
    try {
      const res = await authApi.forceChange({
        userId:      pendingPw.userId,
        schoolId:    pendingPw.schoolId,
        newPassword,
      });
      setSession({ token: res.token, user: res.user, school: res.school });
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Password change failed.');
    } finally {
      setLoading(false);
    }
  }

  // ─── Error banner ────────────────────────────────────────────────────────────
  function ErrorBanner() {
    if (!error) return null;
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
        <span className="shrink-0 mt-0.5">⚠</span>
        <span>{error}</span>
      </div>
    );
  }

  // ─── Left panel ─────────────────────────────────────────────────────────────
  function LeftPanel() {
    return (
      <div
        className="hidden lg:flex lg:w-5/12 flex-col justify-between p-10"
        style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
      >
        {/* School logo / identity */}
        <div className="flex items-center gap-4">
          {logoUrl ? (
            <img src={logoUrl} alt={shortName} className="h-14 w-14 rounded-2xl object-contain bg-white/10 p-1" />
          ) : (
            <div
              className="flex h-14 w-14 items-center justify-center rounded-2xl text-white font-bold text-xl"
              style={{ background: 'rgba(255,255,255,0.2)' }}
            >
              {initials}
            </div>
          )}
          <div>
            <p className="text-white font-bold text-xl leading-tight">{schoolName}</p>
            {slug && <p className="text-white/60 text-sm mt-0.5">Powered by Msingi</p>}
          </div>
        </div>

        {/* Tagline / content */}
        <div>
          {slug === 'demo' ? (
            <>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/50 mb-4">Interactive Demo</p>
              <blockquote className="text-2xl font-light text-white/90 leading-relaxed mb-8">
                "Explore the full Msingi platform — sign in as any role to see the system in action."
              </blockquote>
              <div className="space-y-3">
                {DEMO_ACCOUNTS.map(({ role, badge }) => (
                  <div key={role} className="flex items-center gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/40 flex-shrink-0" />
                    <span className="text-sm text-white/70">{role}</span>
                    <span className="text-xs text-white/40 ml-auto">{badge}</span>
                  </div>
                ))}
              </div>
            </>
          ) : isSchool ? (
            <>
              <blockquote className="text-2xl font-light text-white/90 leading-relaxed">
                "Your school management portal — students, staff, academics, and finance in one place."
              </blockquote>
              <div className="mt-8 flex gap-8">
                {[
                  { label: 'Student Records', icon: '🎓' },
                  { label: 'Grades & Reports', icon: '📊' },
                  { label: 'Finance Tracking', icon: '💳' },
                ].map((f) => (
                  <div key={f.label} className="flex items-center gap-2">
                    <span className="text-xl">{f.icon}</span>
                    <span className="text-sm text-white/80">{f.label}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <blockquote className="text-2xl font-light text-white/90 leading-relaxed">
              "Empowering educators with the tools to inspire, track, and grow every learner."
            </blockquote>
          )}
        </div>

        <p className="text-xs text-white/40">
          © {new Date().getFullYear()} {isSchool ? schoolName : 'Msingi'}. All rights reserved.
        </p>
      </div>
    );
  }

  // Loading skeleton while branding loads
  if (loadingBranding) {
    return (
      <div className="min-h-full flex items-center justify-center bg-slate-50">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-full flex">
      <LeftPanel />

      {/* Right panel — form */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 bg-slate-50">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 mb-8">
            {logoUrl ? (
              <img src={logoUrl} alt={shortName} className="h-9 w-9 rounded-xl object-contain" />
            ) : (
              <div
                className="flex h-9 w-9 items-center justify-center rounded-xl text-white font-bold text-sm"
                style={{ background: primary }}
              >
                {initials}
              </div>
            )}
            <span className="font-semibold text-slate-800">{shortName}</span>
          </div>

          {/* ── LOGIN MODE ─────────────────────────────────────────── */}
          {mode === MODES.LOGIN && (
            <>
              <h2 className="text-2xl font-bold text-slate-800">Welcome back 👋</h2>
              <p className="mt-1 text-sm text-slate-500">
                Sign in to <span className="font-medium text-slate-700">{schoolName}</span>
              </p>

              <form onSubmit={handleLogin} className="mt-8 space-y-4">
                <ErrorBanner />

                <div>
                  <label htmlFor="email" className="form-label">Email address</label>
                  <input
                    id="email" type="email" autoComplete="email" required
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
                  <div className="relative">
                    <input
                      id="password" type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password" required
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); clearError(); }}
                      className="form-input pr-10"
                      placeholder="••••••••"
                      disabled={loading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute inset-y-0 right-3 flex items-center text-slate-400 hover:text-slate-600"
                      tabIndex={-1}
                    >
                      {showPassword ? '🙈' : '👁'}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
                  disabled={loading}
                >
                  {loading ? <><Spinner size="sm" /> Signing in…</> : 'Sign in →'}
                </button>
              </form>

              <p className="mt-6 text-center text-xs text-slate-400">
                Powered by{' '}
                <a href="https://msingi.io" className="hover:underline" style={{ color: primary }}>
                  Msingi
                </a>
              </p>

              {/* Quick-login cards — only on the demo school */}
              {slug === 'demo' && <DemoPanel onPick={handleQuickLogin} />}
            </>
          )}

          {/* ── OTP MODE ───────────────────────────────────────────── */}
          {mode === MODES.OTP && (
            <>
              <h2 className="text-2xl font-bold text-slate-800">Check your email 📬</h2>
              <p className="mt-1 text-sm text-slate-500">
                A 6-digit code was sent to <strong>{email}</strong>. Enter it below.
              </p>

              <form onSubmit={handleOtp} className="mt-8 space-y-4">
                <ErrorBanner />

                <div>
                  <label htmlFor="otp" className="form-label">Verification code</label>
                  <input
                    id="otp" type="text" inputMode="numeric" pattern="\d{6}"
                    maxLength={6} required autoFocus
                    value={otp}
                    onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '')); clearError(); }}
                    className="form-input text-center text-2xl tracking-[0.5em] font-mono"
                    placeholder="000000"
                    disabled={loading}
                  />
                </div>

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
                  disabled={loading || otp.length !== 6}
                >
                  {loading ? <><Spinner size="sm" /> Verifying…</> : 'Verify code →'}
                </button>

                <button
                  type="button"
                  onClick={() => { setMode(MODES.LOGIN); setOtp(''); clearError(); }}
                  className="w-full text-sm text-slate-500 hover:text-slate-700 py-1"
                >
                  ← Back to sign in
                </button>
              </form>
            </>
          )}

          {/* ── CHANGE PASSWORD MODE ────────────────────────────────── */}
          {mode === MODES.CHANGE_PASSWORD && (
            <>
              <h2 className="text-2xl font-bold text-slate-800">
                {pendingPw?.reason === 'first_login' ? 'Set your password 🔐' : 'Password expired 🔑'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {pendingPw?.reason === 'first_login'
                  ? 'Welcome! Your administrator set a temporary password. Choose your own to continue.'
                  : 'Your password has expired. Please choose a new one to continue.'}
              </p>

              <form onSubmit={handleChangePassword} className="mt-8 space-y-4">
                <ErrorBanner />

                <div>
                  <label htmlFor="new-password" className="form-label">New password</label>
                  <input
                    id="new-password" type="password" autoComplete="new-password"
                    required minLength={8}
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
                    id="confirm-password" type="password" autoComplete="new-password"
                    required
                    value={confirmPassword}
                    onChange={(e) => { setConfirmPassword(e.target.value); clearError(); }}
                    className="form-input"
                    placeholder="Repeat your new password"
                    disabled={loading}
                  />
                </div>

                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
                  disabled={loading}
                >
                  {loading ? <><Spinner size="sm" /> Saving…</> : 'Set password & sign in →'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
