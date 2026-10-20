/**
 * Msingi — Request a demo (/demo)
 *
 * Step 1: request form (Turnstile + server-side rate limits)
 * Step 2: 6-digit email OTP (double opt-in — nothing is provisioned before it)
 * Step 3: tenant provisioned → login URL + credentials-by-email notice
 *
 * The demo tenant is a real, isolated school that expires after 7 days
 * (DEMO_TRIAL_DAYS). Credentials are emailed once and are unique per tenant.
 */
import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowRight, CheckCircle2, Loader2, Mail, ShieldCheck, Clock3 } from 'lucide-react';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import TurnstileWidget from '@/components/landing/TurnstileWidget';

const ROLES = ['School owner / director', 'Principal / head teacher', 'Deputy / academic head', 'Finance / bursar', 'ICT / operations', 'Other'];
const SIZES = ['Under 200 students', '200 – 500 students', '500 – 1,000 students', '1,000 – 3,000 students', 'Over 3,000 students'];

const INITIAL = { name: '', schoolName: '', role: '', email: '', phone: '', schoolSize: '' };

export default function DemoRequest() {
  const [step, setStep] = useState('form'); // form | otp | done | review
  const [form, setForm] = useState(INITIAL);
  const [otp, setOtp] = useState('');
  const [requestId, setRequestId] = useState('');
  const [result, setResult] = useState(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const turnstileRef = useRef(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submitRequest(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/demo/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, turnstileToken }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json?.error?.message || 'Could not submit the request.');
      setRequestId(json.data.id);
      setStep('otp');
    } catch (err) {
      setError(err.message);
      turnstileRef.current?.reset();
      setTurnstileToken('');
    } finally {
      setBusy(false);
    }
  }

  async function submitOtp(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/demo/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: requestId, email: form.email, code: otp.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json?.error?.message || 'Could not verify the code.');

      if (json.data.status === 'pending_review') {
        setStep('review');
      } else {
        setResult(json.data);
        setStep('done');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError('');
    try {
      const res = await fetch('/api/demo/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: requestId, email: form.email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) throw new Error(json?.error?.message || 'Could not resend the code.');
      setError('A new code is on its way.');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <Helmet>
        <title>Request a demo — Msingi</title>
        <meta name="description" content="Explore a real, isolated Msingi school workspace for 7 days. Request a demo and get credentials by email." />
      </Helmet>
      <PublicNav />
      <main className="min-h-screen bg-slate-50 pt-24 pb-20">
        <div className="max-w-2xl mx-auto px-5">
          <div className="text-center mb-8">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600 mb-2">7-day sandbox</p>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-900">See your school running on Msingi</h1>
            <p className="mt-3 text-slate-600">
              We create a private workspace with realistic school data — fees, attendance, results, timetables — and email the logins.
              No installation, no card.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 md:p-8">
            {step === 'form' && (
              <form onSubmit={submitRequest} className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Your name">
                    <input required value={form.name} onChange={set('name')} className={inputCls} placeholder="Jane Wanjiru" />
                  </Field>
                  <Field label="School name">
                    <input required value={form.schoolName} onChange={set('schoolName')} className={inputCls} placeholder="Riverside Academy" />
                  </Field>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Your role">
                    <select value={form.role} onChange={set('role')} className={inputCls}>
                      <option value="">Select a role</option>
                      {ROLES.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </Field>
                  <Field label="School size">
                    <select value={form.schoolSize} onChange={set('schoolSize')} className={inputCls}>
                      <option value="">Select size</option>
                      {SIZES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </Field>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Field label="Work email">
                    <input required type="email" value={form.email} onChange={set('email')} className={inputCls} placeholder="you@school.ac.ke" />
                  </Field>
                  <Field label="Phone (optional)">
                    <input value={form.phone} onChange={set('phone')} className={inputCls} placeholder="+254 7xx xxx xxx" />
                  </Field>
                </div>

                <TurnstileWidget
                  ref={turnstileRef}
                  onVerify={setTurnstileToken}
                  onExpire={() => setTurnstileToken('')}
                />

                {error && <p className="text-sm text-rose-600">{error}</p>}

                <button type="submit" disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3 font-semibold text-white disabled:opacity-60">
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />}
                  {busy ? 'Sending your code…' : 'Continue'}
                </button>
                <p className="text-xs text-slate-500 text-center">
                  We email a 6-digit code first — the workspace is only created after you confirm your inbox.
                </p>
              </form>
            )}

            {step === 'otp' && (
              <form onSubmit={submitOtp} className="space-y-4">
                <div className="flex items-center gap-2 text-slate-700">
                  <Mail size={18} className="text-indigo-600" />
                  <p className="text-sm">Enter the 6-digit code sent to <strong>{form.email}</strong></p>
                </div>
                <input
                  autoFocus inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
                  value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  className="w-full text-center text-3xl tracking-[0.5em] font-bold rounded-xl border border-slate-300 py-4 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="000000"
                />
                {error && <p className={`text-sm ${error.includes('on its way') ? 'text-emerald-600' : 'text-rose-600'}`}>{error}</p>}
                <button type="submit" disabled={busy || otp.length !== 6}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3 font-semibold text-white disabled:opacity-60">
                  {busy ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
                  {busy ? 'Building your workspace…' : 'Verify and create my demo'}
                </button>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <button type="button" onClick={() => { setStep('form'); setError(''); }} className="underline">Change details</button>
                  <button type="button" onClick={resend} className="underline">Resend code</button>
                </div>
              </form>
            )}

            {step === 'review' && (
              <div className="text-center py-6">
                <Clock3 size={38} className="mx-auto text-amber-500" />
                <h2 className="mt-3 text-xl font-semibold text-slate-900">Request received</h2>
                <p className="mt-2 text-sm text-slate-600">
                  Your email is verified. A demo specialist will approve and email the logins within one business day.
                </p>
                <Link to="/contact" className="mt-5 inline-flex items-center gap-2 text-indigo-600 font-medium">Talk to us sooner <ArrowRight size={16} /></Link>
              </div>
            )}

            {step === 'done' && (
              <div className="text-center py-4">
                <CheckCircle2 size={42} className="mx-auto text-emerald-500" />
                <h2 className="mt-3 text-2xl font-bold text-slate-900">Your demo is ready</h2>
                <p className="mt-2 text-sm text-slate-600">
                  We emailed every role login and the shared password to <strong>{form.email}</strong>.
                </p>
                <a href={result?.loginUrl || '/login'}
                  className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-3 font-semibold text-white">
                  Open the demo <ArrowRight size={18} />
                </a>
                <p className="mt-4 text-xs text-slate-500">
                  Active until {result?.expiresAt ? new Date(result.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '7 days from now'}.
                  Fictional data only — safe to click everything.
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
      <PublicFooter />
    </>
  );
}

const inputCls = 'w-full rounded-xl border border-slate-300 px-4 py-2.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}
