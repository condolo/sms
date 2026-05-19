/**
 * Msingi — Contact Page
 * Enterprise-grade contact page matching the landing page aesthetic.
 */
import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, ArrowRight, ArrowUp, CheckCircle, MessageCircle,
  Building2, Users, GraduationCap, DollarSign, Briefcase,
} from 'lucide-react';

/* ─── Social icon SVGs (no extra dependency) ─────────────────── */
function XIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
    </svg>
  );
}
function LinkedInIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );
}
function FacebookIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  );
}
function InstagramIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
    </svg>
  );
}
function YouTubeIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  );
}

/* Fetch platform settings once, shared cache */
let _cachedSettings = null;
async function getPlatformSettings() {
  if (_cachedSettings) return _cachedSettings;
  try {
    const res = await fetch('/api/platform/settings');
    if (res.ok) { _cachedSettings = await res.json(); return _cachedSettings; }
  } catch { /* fall through */ }
  return {};
}

function SocialLinks({ links = {} }) {
  const socials = [
    { key: 'twitter',   Icon: XIcon,         label: 'X / Twitter' },
    { key: 'linkedin',  Icon: LinkedInIcon,  label: 'LinkedIn'    },
    { key: 'facebook',  Icon: FacebookIcon,  label: 'Facebook'    },
    { key: 'instagram', Icon: InstagramIcon, label: 'Instagram'   },
    { key: 'youtube',   Icon: YouTubeIcon,   label: 'YouTube'     },
  ].filter(({ key }) => links[key]);

  if (!socials.length) return null;

  return (
    <div className="flex items-center gap-4">
      {socials.map(({ key, Icon, label }) => (
        <a
          key={key}
          href={links[key]}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className="text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          <Icon size={16} />
        </a>
      ))}
    </div>
  );
}

const EASE = [0.16, 1, 0.3, 1];

const fadeUp = {
  hidden:  { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE } },
};

const stagger = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.08 } },
};

const VP = { once: true, amount: 0.2 };

const WHO_WE_WORK_WITH = [
  { Icon: Building2,     label: 'School owners and directors'          },
  { Icon: GraduationCap, label: 'Principals and academic heads'        },
  { Icon: DollarSign,    label: 'Finance and bursary departments'      },
  { Icon: Briefcase,     label: 'Administrative and operations teams'  },
  { Icon: Users,         label: 'Growing institutions seeking scalable infrastructure' },
];

const CONTACT_REASONS = [
  'Request a platform demonstration',
  'Explore institutional onboarding',
  'Discuss custom operational workflows',
  'Learn about academic reporting infrastructure',
  'Understand deployment and support options',
];

const INQUIRY_OPTIONS = [
  'Request a platform demonstration',
  'Explore institutional onboarding',
  'Discuss custom operational workflows',
  'Academic reporting infrastructure',
  'Deployment and support options',
  'Other',
];

const ROLE_OPTIONS = [
  'School Owner / Director',
  'Principal / Head Teacher',
  'Academic Head / HOD',
  'Finance / Bursar',
  'Administrator',
  'IT Lead',
  'Other',
];

/* WhatsApp link helper */
const WA_NUMBER = '254769024153';
const WA_MESSAGE = encodeURIComponent(
  'Hello Msingi, I would like to learn more about the platform for my institution.'
);
const WA_URL = `https://wa.me/${WA_NUMBER}?text=${WA_MESSAGE}`;

const PLAN_INQUIRY_MAP = {
  core:       'Explore institutional onboarding',
  standard:   'Explore institutional onboarding',
  premium:    'Request a platform demonstration',
  enterprise: 'Deployment and support options',
};

export default function Contact() {
  const [searchParams]            = useSearchParams();
  const planParam                 = searchParams.get('plan');
  const defaultInquiry            = PLAN_INQUIRY_MAP[planParam] || '';

  const [form, setForm]           = useState({ name: '', institution: '', role: '', email: '', phone: '', inquiry: defaultInquiry, message: planParam ? `I'm interested in the ${planParam.charAt(0).toUpperCase() + planParam.slice(1)} plan.` : '' });
  const [submitted, setSubmitted] = useState(false);
  const [sending,   setSending]   = useState(false);
  const [socialLinks, setSocialLinks] = useState({});

  const [showTop, setShowTop] = useState(false);

  /* Scroll to top on mount + fetch social links */
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    getPlatformSettings().then(s => setSocialLinks(s.socialLinks || {}));
    function onScroll() { setShowTop(window.scrollY > 300); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name || !form.institution || !form.email) return;
    setSending(true);

    /* Build a mailto body as fallback; in production wire to /api/contact */
    const subject = encodeURIComponent(`Msingi Enquiry — ${form.institution}`);
    const body    = encodeURIComponent(
      `Name: ${form.name}\nInstitution: ${form.institution}\nRole: ${form.role}\n` +
      `Email: ${form.email}\nPhone: ${form.phone}\nInquiry: ${form.inquiry}\n\n${form.message}`
    );

    /* Short delay for UX, then show success */
    await new Promise(r => setTimeout(r, 800));
    setSending(false);
    setSubmitted(true);

    /* Open mailto as secondary action */
    window.location.href = `mailto:hello@msingi.io?subject=${subject}&body=${body}`;
  }

  return (
    <div className="min-h-screen bg-white text-zinc-900 antialiased">

      {/* ── NAVBAR ── */}
      <nav className="fixed top-0 left-0 right-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-zinc-100/80">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-sm shadow-indigo-500/30">
              M
            </div>
            <span className="text-[15px] font-bold text-zinc-900 tracking-tight">Msingi</span>
          </Link>
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-zinc-500 hover:text-zinc-900 transition-colors"
          >
            <ArrowLeft size={15} />
            Back to home
          </Link>
        </div>
      </nav>

      {/* Spacer for fixed navbar */}
      <div className="h-16" />

      {/* ── HERO ── */}
      <section className="max-w-7xl mx-auto px-6 lg:px-8 pt-20 pb-16">
        <motion.div
          initial="hidden" animate="visible" variants={stagger}
          className="max-w-3xl"
        >
          <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-4">
            Get in Touch
          </motion.p>
          <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl font-bold tracking-tighter text-zinc-900 leading-[1.05] mb-6">
            Built for schools that
            <br />
            <span className="text-indigo-600">need more than software.</span>
          </motion.h1>
          <motion.p variants={fadeUp} className="text-lg text-zinc-500 leading-relaxed">
            Msingi is built for schools that require more than disconnected tools and routine
            administration. We help institutions centralise academics, finance, communication,
            reporting, and operational workflows into one secure, scalable platform.
          </motion.p>
        </motion.div>
      </section>

      {/* ── MAIN CONTENT ── */}
      <section className="max-w-7xl mx-auto px-6 lg:px-8 pb-24">
        <div className="grid lg:grid-cols-5 gap-12 xl:gap-20">

          {/* ── LEFT: Context ── */}
          <motion.div
            initial="hidden" whileInView="visible" viewport={VP} variants={stagger}
            className="lg:col-span-2 space-y-10"
          >
            {/* Mission statement */}
            <motion.div variants={fadeUp}>
              <p className="text-sm text-zinc-500 leading-relaxed mb-4">
                Whether you are exploring digital transformation for the first time or looking to
                replace rigid legacy systems, our team is ready to help you evaluate how Msingi
                can support your institution's operational goals.
              </p>
              <p className="text-sm text-zinc-500 leading-relaxed">
                At Msingi, we believe modern schools require more than software — they require a
                reliable digital foundation for institutional growth, accountability, and
                operational clarity.
              </p>
            </motion.div>

            {/* Who we work with */}
            <motion.div variants={fadeUp}>
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-5">We work closely with</p>
              <div className="space-y-3">
                {WHO_WE_WORK_WITH.map(({ Icon, label }) => (
                  <div key={label} className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                      <Icon size={14} />
                    </div>
                    <span className="text-sm text-zinc-700">{label}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Contact for */}
            <motion.div variants={fadeUp}>
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-5">Contact us to</p>
              <div className="space-y-2.5">
                {CONTACT_REASONS.map((reason) => (
                  <div key={reason} className="flex items-start gap-3">
                    <div className="w-4 h-4 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle size={9} className="text-white" />
                    </div>
                    <span className="text-sm text-zinc-600">{reason}</span>
                  </div>
                ))}
              </div>
            </motion.div>

          </motion.div>

          {/* ── RIGHT: Contact form ── */}
          <motion.div
            initial={{ opacity: 0, y: 32 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={VP}
            transition={{ duration: 0.7, ease: EASE }}
            className="lg:col-span-3"
          >
            {submitted ? (
              /* ── Success state ── */
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-12 text-center">
                <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-emerald-500/25">
                  <CheckCircle size={26} className="text-white" />
                </div>
                <h3 className="text-xl font-bold text-zinc-900 mb-2">We'll be in touch.</h3>
                <p className="text-sm text-zinc-500 max-w-sm mx-auto mb-6">
                  Your enquiry has been received. Our team typically responds within one business day.
                  For immediate assistance, reach us directly on WhatsApp.
                </p>
                <a
                  href={WA_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-green-500 px-6 py-3 text-sm font-semibold text-white hover:bg-green-600 transition-colors shadow-sm"
                >
                  <MessageCircle size={15} />
                  Chat on WhatsApp
                </a>
              </div>
            ) : (
              /* ── Form ── */
              <form
                onSubmit={handleSubmit}
                className="rounded-2xl border border-zinc-100 bg-white p-8 shadow-sm space-y-5"
              >
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-1">Send us a message</p>
                  <h2 className="text-lg font-bold text-zinc-900">Tell us about your institution</h2>
                </div>

                {/* Name + Institution */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Full name <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      name="name"
                      value={form.name}
                      onChange={handleChange}
                      required
                      placeholder="Dr. Jane Mwangi"
                      className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Institution <span className="text-red-400">*</span></label>
                    <input
                      type="text"
                      name="institution"
                      value={form.institution}
                      onChange={handleChange}
                      required
                      placeholder="Greenwood Academy"
                      className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition"
                    />
                  </div>
                </div>

                {/* Role */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Your role</label>
                  <select
                    name="role"
                    value={form.role}
                    onChange={handleChange}
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition"
                  >
                    <option value="">Select your role…</option>
                    {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>

                {/* Email + Phone */}
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Email address <span className="text-red-400">*</span></label>
                    <input
                      type="email"
                      name="email"
                      value={form.email}
                      onChange={handleChange}
                      required
                      placeholder="jane@greenwood.ac.ke"
                      className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Phone / WhatsApp</label>
                    <input
                      type="tel"
                      name="phone"
                      value={form.phone}
                      onChange={handleChange}
                      placeholder="+254 700 000 000"
                      className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition"
                    />
                  </div>
                </div>

                {/* Inquiry type */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">What are you interested in?</label>
                  <select
                    name="inquiry"
                    value={form.inquiry}
                    onChange={handleChange}
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition"
                  >
                    <option value="">Select an option…</option>
                    {INQUIRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>

                {/* Message */}
                <div>
                  <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Additional context</label>
                  <textarea
                    name="message"
                    value={form.message}
                    onChange={handleChange}
                    rows={4}
                    placeholder="Tell us about your school — size, current systems, what challenges you're facing, or any specific requirements…"
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition resize-none"
                  />
                </div>

                {/* Submit */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={sending || !form.name || !form.institution || !form.email}
                    className="group inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-6 py-3 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 transition-all shadow-sm"
                  >
                    {sending ? (
                      <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                    )}
                    {sending ? 'Sending…' : 'Send enquiry'}
                  </button>

                </div>

                <p className="text-xs text-zinc-400">
                  By submitting you agree to our privacy policy. We'll only use your details to respond to your enquiry.
                </p>
              </form>
            )}
          </motion.div>
        </div>
      </section>

      {/* ── FLOATING ACTIONS — WhatsApp circle + scroll-to-top ── */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        <AnimatePresence>
          {showTop && (
            <motion.button
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.2 }}
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              aria-label="Scroll to top"
              className="w-10 h-10 rounded-full bg-white border border-zinc-200 shadow-md flex items-center justify-center text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-all"
            >
              <ArrowUp size={16} />
            </motion.button>
          )}
        </AnimatePresence>
        <a
          href={WA_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat on WhatsApp"
          className="w-12 h-12 rounded-full bg-[#25D366] flex items-center justify-center shadow-lg shadow-green-500/30 hover:scale-110 hover:shadow-xl hover:shadow-green-500/40 transition-all"
        >
          <MessageCircle size={22} className="text-white" />
        </a>
      </div>

      {/* ── FOOTER ── */}
      <footer className="border-t border-zinc-100 py-10 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
            {/* Brand */}
            <Link to="/" className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">M</div>
              <span className="text-sm font-bold text-zinc-900">Msingi</span>
              <span className="text-xs text-zinc-400 ml-1">· The School Operating System</span>
            </Link>

            {/* Social icons */}
            <SocialLinks links={socialLinks} />

            {/* Links */}
            <div className="flex gap-5 text-xs text-zinc-400">
              <a href="mailto:hello@msingi.io" className="hover:text-zinc-700 transition-colors">hello@msingi.io</a>
              <a href={WA_URL} target="_blank" rel="noopener noreferrer" className="hover:text-zinc-700 transition-colors">WhatsApp</a>
            </div>
          </div>
          <p className="text-xs text-zinc-400 text-center mt-6">© {new Date().getFullYear()} Msingi. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
