/* ============================================================
   Public admissions enquiry form — /enquire/:slug

   The short form a parent fills in before they ever talk to the
   school. Deliberately minimal: every field is optional, and the
   only hard rule is that one way to reach the family exists
   (name, phone or email) — a lead nobody can call back is not a
   lead. The school enables this form in Settings; until then the
   route 404s and this page says so plainly.

   No authentication, no account, no file uploads. Branding comes
   from the same public school profile the login page uses.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { CheckCircle2, Loader2, School, AlertCircle, Send } from 'lucide-react';
import { publicApi } from '@/api/client.js';

const HEARD_ABOUT = [
  { value: 'word_of_mouth', label: 'Word of mouth / a friend' },
  { value: 'social_media',  label: 'Facebook, Instagram or WhatsApp' },
  { value: 'google',        label: 'Google search' },
  { value: 'event',         label: 'A school event or open day' },
  { value: 'referral',      label: 'Referred by a parent' },
  { value: 'walk_in',       label: 'Walked past / saw the sign' },
  { value: 'other',         label: 'Somewhere else' },
];

const inputCls =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400';

export default function EnquiryPage() {
  const { slug } = useParams();
  const [config, setConfig]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(null); // { ref, schoolName }
  const [error, setError]     = useState('');
  const startedAt = useRef(Date.now());

  const [form, setForm] = useState({
    parentName: '', parentPhone: '', parentEmail: '',
    learnerAge: '',
    applyingForClass: '',
    tourCompleted: 'unknown',
    assessmentCompleted: 'unknown',
    heardAbout: '', heardAboutOther: '',
    website: '', // honeypot
  });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    publicApi.enquiryConfig(slug)
      .then((data) => {
        if (!alive) return;
        setConfig(data);
        startedAt.current = Date.now();
      })
      .catch((err) => {
        if (alive) setLoadError(err?.message || 'This enquiry form is not available.');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  const brand = config?.school?.primaryColor || '#4f46e5';

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const contactReady = useMemo(
    () => Boolean(form.parentName.trim() || form.parentPhone.trim() || form.parentEmail.trim()),
    [form.parentName, form.parentPhone, form.parentEmail],
  );

  async function submit(ev) {
    ev.preventDefault();
    setError('');
    if (!contactReady) {
      setError('Please leave at least a name, a phone number or an email so the school can follow up.');
      return;
    }
    if (form.parentEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.parentEmail.trim())) {
      setError('That email address does not look right.');
      return;
    }
    setSending(true);
    try {
      const res = await publicApi.submitEnquiry(slug, {
        parentName:  form.parentName.trim(),
        parentPhone: form.parentPhone.trim(),
        parentEmail: form.parentEmail.trim(),
        learnerAge:  form.learnerAge === '' ? undefined : Number(form.learnerAge),
        applyingForClass: form.applyingForClass || '',
        tourCompleted:       form.tourCompleted === 'yes' ? true : form.tourCompleted === 'no' ? false : null,
        assessmentCompleted: form.assessmentCompleted === 'yes' ? true : form.assessmentCompleted === 'no' ? false : null,
        heardAbout:  form.heardAbout || null,
        heardAboutOther: form.heardAbout === 'other' ? form.heardAboutOther.trim() : '',
        website: form.website,
        startedAt: startedAt.current,
      });
      setSent(res);
    } catch (err) {
      setError(err?.message || 'Could not send your enquiry. Please try again.');
    } finally {
      setSending(false);
    }
  }

  /* ── Loading ─────────────────────────────────────────────── */
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-400">
        <Loader2 size={16} className="animate-spin mr-2" /> Loading…
      </div>
    );
  }

  /* ── Form not available (disabled / unknown school) ──────── */
  if (loadError || !config) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-5">
        <div className="max-w-md text-center">
          <AlertCircle size={28} className="mx-auto text-amber-500 mb-3" />
          <h1 className="text-lg font-bold text-slate-900">This enquiry form isn’t available</h1>
          <p className="text-sm text-slate-500 mt-2">
            {loadError || 'The school has not switched its enquiry form on yet.'} Please contact the school directly.
          </p>
        </div>
      </div>
    );
  }

  const school = config.school;

  /* ── Sent ────────────────────────────────────────────────── */
  if (sent) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-5">
        <Helmet><title>Enquiry sent — {school.name}</title></Helmet>
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center">
          <CheckCircle2 size={34} className="mx-auto text-emerald-500 mb-3" />
          <h1 className="text-lg font-bold text-slate-900">Thank you — your enquiry is with {school.shortName || school.name}</h1>
          <p className="text-sm text-slate-500 mt-2">
            The admissions team will be in touch. Your reference is <span className="font-mono font-semibold text-slate-700">{sent.ref}</span>.
          </p>
          <p className="text-xs text-slate-400 mt-4">
            If your enquiry is urgent, please call the school office directly.
          </p>
        </div>
      </div>
    );
  }

  /* ── Form ────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-slate-50">
      <Helmet><title>Enquire — {school.name}</title></Helmet>

      <header className="bg-white border-b border-slate-200">
        <div className="max-w-2xl mx-auto px-5 py-6 flex items-center gap-3">
          {school.logoUrl ? (
            <img src={school.logoUrl} alt="" className="h-11 w-11 rounded-xl object-cover" />
          ) : (
            <span className="h-11 w-11 rounded-xl flex items-center justify-center text-white" style={{ backgroundColor: brand }}>
              <School size={20} />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-base font-bold text-slate-900 truncate">{school.name}</h1>
            <p className="text-xs text-slate-400 truncate">
              {school.tagline || [school.city, school.country].filter(Boolean).join(', ') || 'Admissions enquiry'}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-5 py-8">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-slate-900">Enquire about a place</h2>
          <p className="text-sm text-slate-500 mt-1">
            Tell us a little about your child and we will get back to you. Nothing here is required — share only what you are comfortable with, but leave a phone number or email so we can reach you.
          </p>
        </div>

        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          {/* Honeypot — hidden from people, tempting to bots. */}
          <input
            type="text"
            name="website"
            value={form.website}
            onChange={(e) => set('website', e.target.value)}
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            className="hidden"
          />

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Your name</span>
              <input value={form.parentName} onChange={(e) => set('parentName', e.target.value)}
                placeholder="e.g. Jane Wanjiku" autoComplete="name" className={`${inputCls} mt-1.5`} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Phone number</span>
              <input type="tel" value={form.parentPhone} onChange={(e) => set('parentPhone', e.target.value)}
                placeholder="+254 …" autoComplete="tel" className={`${inputCls} mt-1.5`} />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Email address</span>
            <input type="email" value={form.parentEmail} onChange={(e) => set('parentEmail', e.target.value)}
              placeholder="you@example.com" autoComplete="email" className={`${inputCls} mt-1.5`} />
          </label>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Child’s age</span>
              <input type="number" min={2} max={25} inputMode="numeric" value={form.learnerAge}
                onChange={(e) => set('learnerAge', e.target.value)}
                placeholder="e.g. 7" className={`${inputCls} mt-1.5`} />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Class you are asking about</span>
              <select value={form.applyingForClass} onChange={(e) => set('applyingForClass', e.target.value)} className={`${inputCls} mt-1.5`}>
                <option value="">Not sure yet</option>
                {(config.classes || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Have you visited the school?</span>
              <select value={form.tourCompleted} onChange={(e) => set('tourCompleted', e.target.value)} className={`${inputCls} mt-1.5`}>
                <option value="unknown">Not sure / not yet</option>
                <option value="yes">Yes, I have had a tour</option>
                <option value="no">No, not yet</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Has your child sat an assessment?</span>
              <select value={form.assessmentCompleted} onChange={(e) => set('assessmentCompleted', e.target.value)} className={`${inputCls} mt-1.5`}>
                <option value="unknown">Not sure / not yet</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Where did you hear about {school.shortName || school.name}?</span>
            <select value={form.heardAbout} onChange={(e) => set('heardAbout', e.target.value)} className={`${inputCls} mt-1.5`}>
              <option value="">Prefer not to say</option>
              {HEARD_ABOUT.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          {form.heardAbout === 'other' && (
            <label className="block">
              <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Where?</span>
              <input value={form.heardAboutOther} onChange={(e) => set('heardAboutOther', e.target.value)}
                maxLength={160} placeholder="e.g. Church notice board" className={`${inputCls} mt-1.5`} />
            </label>
          )}

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3.5 py-3">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <button
            type="submit"
            disabled={sending}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
            style={{ backgroundColor: brand }}
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            {sending ? 'Sending…' : 'Send enquiry'}
          </button>

          <p className="text-[11px] text-slate-400 leading-relaxed text-center">
            Your details go only to {school.name}’s admissions team. They will use them to respond to this enquiry.
          </p>
        </form>
      </main>
    </div>
  );
}
