import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { Spinner } from '@/components/ui/Spinner.jsx';
import useAuthStore from '@/store/auth.js';
import { auth as authApi, publicApi, APIError } from '@/api/client.js';
import { detectSchool, storeSchoolSlug } from '@/utils/schoolDetect.js';
import { Loader2 as Loader2Icon, Search } from 'lucide-react';

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
  { role: 'Student',         email: 'demo-student',             color: '#db2777', bg: '#fdf2f8', badge: 'Student view'  },
];
const DEMO_PASSWORD = 'Demo2025!';

/* ── Social login buttons — Google and Microsoft OAuth ─────────
   Only shown when the respective env vars are configured.
   We detect this by trying a HEAD request (or just always show
   and let the server return 503 if not configured).
   The slug is forwarded as a query param so the callback knows
   which school to resolve the user against.
───────────────────────────────────────────────────────────── */
function SocialLoginButtons({ slug, primary }) {
  const base = import.meta.env.VITE_API_BASE || '';
  const slugParam = slug ? `?slug=${encodeURIComponent(slug)}` : '';

  return (
    <div className="mt-5">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-slate-50 px-3 text-slate-400">or continue with</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        {/* Google */}
        <a
          href={`${base}/api/auth/google${slugParam}`}
          className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:shadow"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Google
        </a>

        {/* Microsoft */}
        <a
          href={`${base}/api/auth/microsoft${slugParam}`}
          className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:shadow"
        >
          <svg className="h-4 w-4" viewBox="0 0 23 23" aria-hidden>
            <path fill="#f25022" d="M1 1h10v10H1z"/>
            <path fill="#00a4ef" d="M12 1h10v10H12z"/>
            <path fill="#7fba00" d="M1 12h10v10H1z"/>
            <path fill="#ffb900" d="M12 12h10v10H12z"/>
          </svg>
          Microsoft
        </a>
      </div>
    </div>
  );
}

function DemoPanel({ onPick }) {
  return (
    <div className="mt-8 pt-7 border-t border-slate-200">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-3 text-center">
        Quick login — explore as any role
      </p>
      <div className="grid grid-cols-2 gap-2">
        {DEMO_ACCOUNTS.map(({ role, email, color, bg, badge }) => (
          <button
            key={email}
            type="button"
            onClick={() => onPick(email, DEMO_PASSWORD)}
            className="flex flex-col items-start rounded-xl px-3 py-2.5 text-left transition-all hover:scale-[1.02] hover:shadow-md active:scale-100"
            style={{ background: bg, border: `1px solid ${color}30` }}
          >
            {/* Avatar + badge row */}
            <div className="flex items-center justify-between w-full mb-1.5">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                style={{ background: color }}
              >
                {role[0]}
              </div>
              <span
                className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
                style={{ background: `${color}18`, color }}
              >
                {badge}
              </span>
            </div>
            {/* Label */}
            <p className="text-xs font-semibold text-slate-800 leading-tight">{role}</p>
            <p className="text-[9px] text-slate-400 truncate w-full mt-0.5">{email}</p>
          </button>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 text-center mt-3">
        Password: <span className="font-mono font-semibold text-slate-500">{DEMO_PASSWORD}</span>
        {' · '}Demo data resets periodically.
      </p>
    </div>
  );
}

/* ── Keyframes injected directly so they're guaranteed to be available
   regardless of CSS bundle caching / loading order ──────────────────── */
const LOGIN_KEYFRAMES = `
  @keyframes msingiGradientShift {
    0%   { background-position: 0% 50%; }
    50%  { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
  }
  @keyframes msingiFloat1 {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50%       { transform: translateY(-24px) rotate(6deg); }
  }
  @keyframes msingiFloat2 {
    0%, 100% { transform: translateY(0px) rotate(0deg); }
    50%       { transform: translateY(18px) rotate(-4deg); }
  }
  @keyframes msingiFloat3 {
    0%, 100% { transform: translateY(0px) scale(1); }
    33%       { transform: translateY(-14px) scale(1.04); }
    66%       { transform: translateY(10px) scale(0.97); }
  }
`;

/* ══════════════════════════════════════════════════════════════
   SCHOOL FINDER — shown at msingi.io/login when no school slug
   is detected. As the visitor types, matching schools appear in
   a dropdown; clicking one redirects to that school's login.
   ══════════════════════════════════════════════════════════════ */
function SchoolFinderPage() {
  const navigate = useNavigate();

  const [query,       setQuery]       = useState('');
  const [suggestions, setSuggestions] = useState([]);   // [{slug,name,shortName,logoUrl,primaryColor}]
  const [searching,   setSearching]   = useState(false);
  const [showDrop,    setShowDrop]    = useState(false);
  const [notFound,    setNotFound]    = useState(false);
  const [error,       setError]       = useState('');
  const [going,       setGoing]       = useState(false);

  const debounceRef = useRef(null);
  const inputRef    = useRef(null);
  const dropRef     = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function onClickOutside(e) {
      if (dropRef.current && !dropRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowDrop(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Debounced search as user types
  function handleInput(e) {
    const val = e.target.value;
    setQuery(val);
    setNotFound(false);
    setError('');
    setSuggestions([]);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (val.trim().length < 2) { setShowDrop(false); return; }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res  = await fetch(`/api/public/schools/search?q=${encodeURIComponent(val.trim())}`);
        const data = await res.json();
        setSuggestions(data.schools || []);
        setShowDrop(true);
        setNotFound((data.schools || []).length === 0);
      } catch {
        /* ignore network blips */
      } finally {
        setSearching(false);
      }
    }, 300);
  }

  function pickSchool(slug) {
    storeSchoolSlug(slug);
    setGoing(true);
    navigate(`/login?school=${slug}`, { replace: true });
  }

  // Fallback: parse a slug from a typed URL / slug string
  function _parseSlug(raw) {
    return raw.trim().toLowerCase()
      .replace(/^https?:\/\//i, '')
      .replace(/\.msingi\.io.*$/, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    // If there's exactly one suggestion, go straight to it
    if (suggestions.length === 1) { pickSchool(suggestions[0].slug); return; }

    const slug = _parseSlug(query);
    if (!slug) { setError('Enter your school name or web address.'); return; }
    setGoing(true); setError(''); setNotFound(false);
    try {
      const res = await fetch(`/api/public/school-info?slug=${slug}`);
      if (!res.ok) { setNotFound(true); setGoing(false); return; }
      storeSchoolSlug(slug);
      navigate(`/login?school=${slug}`, { replace: true });
    } catch {
      setError('Could not connect. Please try again.');
      setGoing(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center px-4 py-12">
      {/* Wordmark */}
      <div className="flex items-center gap-2.5 mb-10">
        <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-black text-base shadow-lg">M</div>
        <span className="text-xl font-bold text-slate-900 tracking-tight">Msingi</span>
      </div>

      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900 mb-1.5">Find your school</h1>
          <p className="text-sm text-slate-500">Start typing your school name and select it from the list.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-sm text-red-700">{error}</div>
          )}

          {/* Search input + dropdown */}
          <div className="relative">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wide">
              School name or address
            </label>

            <div className="relative">
              {searching
                ? <Loader2Icon size={14} className="animate-spin absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                : <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              }
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={handleInput}
                onFocus={() => suggestions.length > 0 && setShowDrop(true)}
                className="w-full text-sm border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-slate-50 focus:bg-white transition-colors"
                placeholder="e.g. Greenwood Academy"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                disabled={going}
              />
            </div>

            {/* Autocomplete dropdown */}
            {showDrop && (
              <div
                ref={dropRef}
                className="absolute z-20 w-full mt-1 bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden"
              >
                {suggestions.length > 0 ? (
                  suggestions.map(s => (
                    <button
                      key={s.slug}
                      type="button"
                      onMouseDown={() => pickSchool(s.slug)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
                    >
                      {/* Mini logo / initial */}
                      <div
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                        style={{ background: s.primaryColor || '#4f46e5' }}
                      >
                        {s.logoUrl
                          ? <img src={s.logoUrl} alt="" className="w-8 h-8 rounded-lg object-contain" />
                          : (s.shortName || s.name || '?')[0].toUpperCase()
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{s.name}</p>
                        <p className="text-[11px] text-slate-400">{s.slug}.msingi.io</p>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-3 text-sm text-slate-500">
                    No schools found for <strong>"{query}"</strong>
                    <p className="text-xs text-slate-400 mt-0.5">Try a shorter name, or contact your administrator.</p>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={going || !query.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {going
              ? <><Loader2Icon size={14} className="animate-spin" /> Going…</>
              : <><Search size={14} /> Find School</>
            }
          </button>
        </form>
      </div>

      {/* Quick links */}
      <div className="mt-6 flex flex-col items-center gap-2.5 text-xs text-slate-400">
        <button
          onClick={() => pickSchool('demo')}
          className="text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
        >
          Explore the demo school →
        </button>
        <span>·</span>
        <Link to="/contact" className="hover:text-slate-600 transition-colors">New school? Contact us →</Link>
        <Link to="/" className="hover:text-slate-600 transition-colors">← Back to msingi.io</Link>
      </div>
    </div>
  );
}

export default function Login() {
  const navigate           = useNavigate();
  const location           = useLocation();
  const setSession         = useAuthStore((s) => s.setSession);
  const isAuthenticated    = useAuthStore((s) => !!s.session?.token);

  // Role-aware default destination
  function _defaultDest(role) {
    if (role === 'student') return '/student-dashboard';
    if (role === 'parent' || role === 'guardian') return '/parent-dashboard';
    return '/dashboard';
  }

  const from = location.state?.from?.pathname ?? null; // null = use role-based default

  // Detect school from subdomain / query param
  const { slug, isSchool } = detectSchool();
  const { branding, loadingBranding } = useSchoolBranding(slug);

  // Redirect if already logged in
  useEffect(() => {
    if (isAuthenticated) {
      const role = useAuthStore.getState().session?.user?.role;
      navigate(from || _defaultDest(role), { replace: true });
    }
  }, [isAuthenticated, from, navigate]);

  // ── OAuth redirect handler — reads ?code= from Google/Microsoft callback ──
  // The server issues a 30-second single-use exchange code instead of a JWT
  // so the token never appears in browser history, server logs, or Referer headers.
  useEffect(() => {
    const params     = new URLSearchParams(location.search);
    const oauthCode  = params.get('code');
    const oauthError = params.get('error');

    if (oauthError) {
      const errorMessages = {
        google_denied:         'Google sign-in was cancelled.',
        microsoft_denied:      'Microsoft sign-in was cancelled.',
        google_not_configured: 'Google login is not enabled on this server.',
        google_failed:         'Google sign-in failed. Please try again.',
        microsoft_failed:      'Microsoft sign-in failed. Please try again.',
        school_not_found:      'School not found. Make sure you are using the correct portal URL.',
        account_inactive:      'Your account has been deactivated. Contact your school administrator.',
      };
      setError(errorMessages[oauthError] || 'Sign-in failed. Please try again.');
      window.history.replaceState({}, '', location.pathname);
      return;
    }

    if (oauthCode) {
      // Exchange the short-lived code for a full session (token + user + school)
      const schoolSlug = params.get('school') || slug;
      if (schoolSlug) storeSchoolSlug(schoolSlug);
      window.history.replaceState({}, '', location.pathname);

      fetch('/api/auth/exchange', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code: oauthCode }),
      })
        .then(r => r.json())
        .then(res => {
          if (!res.token || !res.user) throw new Error('Invalid exchange response');
          setSession({ token: res.token, user: res.user, school: res.school });
          navigate(from || _defaultDest(res.user?.role), { replace: true });
        })
        .catch(() => {
          setError('Sign-in session expired. Please try signing in again.');
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const [lockoutUntil, setLockoutUntil] = useState(null);  // ms timestamp
  const [countdown, setCountdown]       = useState(0);     // seconds

  // Countdown — ticks every second while lockoutUntil is in the future
  useEffect(() => {
    if (!lockoutUntil) return;
    const tick = () => {
      const rem = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (rem <= 0) { setLockoutUntil(null); setCountdown(0); setError(''); }
      else            { setCountdown(rem); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  function _fmt(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

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
      setSession({ token: res.token, user: res.user, school: res.school, absoluteExpiry: res.absoluteExpiry });
      navigate(from || _defaultDest(res.user?.role), { replace: true });
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
      const res = await authApi.login({ identifier: email.trim().toLowerCase(), password });

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

      setSession({ token: res.token, user: res.user, school: res.school, absoluteExpiry: res.absoluteExpiry });
      navigate(from || _defaultDest(res.user?.role), { replace: true });
    } catch (err) {
      if (err instanceof APIError && err.status === 429 && err.extra?.retryAfter) {
        setLockoutUntil(Date.now() + err.extra.retryAfter * 1000);
      }
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
      setSession({ token: res.token, user: res.user, school: res.school, absoluteExpiry: res.absoluteExpiry });
      navigate(from || _defaultDest(res.user?.role), { replace: true });
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
      setSession({ token: res.token, user: res.user, school: res.school, absoluteExpiry: res.absoluteExpiry });
      navigate(from || _defaultDest(res.user?.role), { replace: true });
    } catch (err) {
      setError(err instanceof APIError ? err.message : 'Password change failed.');
    } finally {
      setLoading(false);
    }
  }

  // ─── Error banner ────────────────────────────────────────────────────────────
  function ErrorBanner() {
    if (countdown > 0) {
      return (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-4 text-center">
          <p className="text-sm font-semibold text-red-700">Too many failed login attempts.</p>
          <p className="text-xs text-red-500 mt-0.5">Please try again in</p>
          <div className="font-mono text-3xl font-bold text-red-600 mt-2 tracking-widest">
            {_fmt(countdown)}
          </div>
        </div>
      );
    }
    if (!error) return null;
    return (
      <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
        <span className="shrink-0 mt-0.5">⚠</span>
        <span>{error}</span>
      </div>
    );
  }

  // ─── Left panel — animated gradient with floating shapes ───────────────────
  function LeftPanel() {
    // 4-stop gradient: primary → accent → primary (slightly transparent) → accent (slightly transparent)
    // This gives the slow-shift illusion from the competitor screenshots
    const g1 = primary;
    const g2 = accent;
    const g3 = primary + 'cc';   // ~80% opacity variant
    const g4 = accent  + '99';   // ~60% opacity variant

    return (
      <div
        className="hidden lg:flex lg:w-5/12 flex-col relative overflow-hidden"
        style={{
          background: `linear-gradient(-45deg, ${g1}, ${g2}, ${g3}, ${g4})`,
          backgroundSize: '400% 400%',
          animation: 'msingiGradientShift 12s ease infinite',
        }}
      >
        {/* ── Floating decorative blobs ───────────────────────── */}
        <div
          className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-white/8 blur-sm pointer-events-none"
          style={{ animation: 'msingiFloat1 9s ease-in-out infinite' }}
        />
        <div
          className="absolute top-1/3 -left-20 w-64 h-64 rounded-full bg-white/6 pointer-events-none"
          style={{ animation: 'msingiFloat2 11s ease-in-out infinite' }}
        />
        <div
          className="absolute bottom-24 right-10 w-40 h-40 rounded-full bg-white/10 pointer-events-none"
          style={{ animation: 'msingiFloat3 7s ease-in-out infinite' }}
        />
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 w-72 h-72 rounded-full bg-white/5 blur-md pointer-events-none"
          style={{ animation: 'msingiFloat1 14s ease-in-out infinite reverse' }}
        />

        {/* ── Content ─────────────────────────────────────────── */}
        <div className="relative flex flex-col justify-between h-full p-10">

          {/* Top — logo + school name */}
          <div className="flex flex-col items-center text-center pt-4">
            {/* Logo with soft glow ring */}
            <div className="relative mb-5">
              <div
                className="absolute inset-0 rounded-3xl blur-2xl scale-125 opacity-40 bg-white"
                aria-hidden="true"
              />
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt={shortName}
                  className="relative h-28 w-28 rounded-3xl object-contain bg-white/20 p-3 shadow-2xl"
                />
              ) : (
                <div
                  className="relative h-28 w-28 rounded-3xl bg-white/20 flex items-center justify-center text-white text-4xl font-black shadow-2xl select-none"
                >
                  {initials}
                </div>
              )}
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight leading-tight drop-shadow-sm">
              {schoolName}
            </h1>
            {branding?.tagline && (
              <p className="text-white/65 text-sm mt-2 italic font-light leading-relaxed max-w-xs">
                {branding.tagline}
              </p>
            )}
          </div>

          {/* Middle — contextual content */}
          <div>
            {slug === 'demo' ? (
              <>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-white/45 mb-4 text-center">
                  Interactive Demo
                </p>
                <blockquote className="text-xl font-light text-white/85 leading-relaxed mb-7 text-center">
                  "Explore the full Msingi platform — sign in as any role to see the system in action."
                </blockquote>
                <div className="space-y-2.5 bg-white/10 rounded-2xl p-4 backdrop-blur-sm">
                  {DEMO_ACCOUNTS.map(({ role, badge }) => (
                    <div key={role} className="flex items-center gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-white/50 flex-shrink-0" />
                      <span className="text-sm text-white/75">{role}</span>
                      <span className="text-[10px] text-white/40 ml-auto">{badge}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : isSchool ? (
              <>
                <blockquote className="text-xl font-light text-white/85 leading-relaxed mb-7 text-center">
                  "Your school management portal — students, staff, academics, and finance in one place."
                </blockquote>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Student Records', symbol: 'S' },
                    { label: 'Grades & Reports', symbol: 'G' },
                    { label: 'Finance', symbol: 'F' },
                  ].map(({ label, symbol }) => (
                    <div
                      key={label}
                      className="flex flex-col items-center gap-1.5 bg-white/10 rounded-xl p-3 backdrop-blur-sm"
                    >
                      <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center text-white text-xs font-bold">
                        {symbol}
                      </div>
                      <span className="text-[10px] text-white/70 text-center leading-tight">{label}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <blockquote className="text-xl font-light text-white/85 leading-relaxed text-center">
                "Empowering educators with the tools to inspire, track, and grow every learner."
              </blockquote>
            )}
          </div>

          {/* Bottom — powered by */}
          <p className="text-xs text-white/35 text-center">
            Powered by{' '}
            <span className="font-semibold text-white/55">Msingi</span>
            {' · '}© {new Date().getFullYear()} {isSchool ? schoolName : 'Msingi'}
          </p>
        </div>
      </div>
    );
  }

  // No school context — show the school finder instead of the login form
  if (!isSchool) {
    return <SchoolFinderPage />;
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
      {/* Guarantee keyframes are always in the document when this component renders */}
      <style>{LOGIN_KEYFRAMES}</style>
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
                  <label htmlFor="email" className="form-label">Email or admission number</label>
                  <input
                    id="email" type="text" autoComplete="username" required
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); clearError(); }}
                    className="form-input"
                    placeholder="you@school.edu or admission number"
                    disabled={loading || countdown > 0}
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
                      disabled={loading || countdown > 0}
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
                  disabled={loading || countdown > 0}
                >
                  {loading ? <><Spinner size="sm" /> Signing in…</> : 'Sign in →'}
                </button>
              </form>

              {/* ── Social login ── */}
              <SocialLoginButtons slug={slug} primary={primary} />

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
              <h2 className="text-2xl font-bold text-slate-800">Password expired 🔑</h2>
              <p className="mt-1 text-sm text-slate-500">
                Your password is more than 90 days old. Please choose a new one to continue.
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
