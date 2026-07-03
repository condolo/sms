/**
 * Msingi — Contact / Discovery Session Page (v2)
 */
import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, CheckCircle, MessageCircle, Building2, Users, GraduationCap, DollarSign, Briefcase } from 'lucide-react';
import { fadeUp, stagger, VP } from '@/utils/animations';
import PublicNav    from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';
import FloatingActions from '@/components/landing/FloatingActions';
import { useWaUrl } from '@/hooks/useWaUrl';

const WHO_WE_WORK_WITH = [
  { Icon: Building2,     label: 'School owners and directors'                          },
  { Icon: GraduationCap, label: 'Principals and academic heads'                        },
  { Icon: DollarSign,    label: 'Finance and bursary departments'                      },
  { Icon: Briefcase,     label: 'Administrative and operations teams'                  },
  { Icon: Users,         label: 'Growing institutions seeking scalable infrastructure' },
];

const CONTACT_REASONS = [
  'Book a 30-minute discovery session',
  'Explore implementation and onboarding',
  'Discuss your school\'s specific workflow',
  'Get pricing for your student count',
  'Understand data migration from your current system',
];

const INQUIRY_OPTIONS = [
  'Book a discovery session',
  'Explore institutional onboarding',
  'Discuss pricing',
  'Data migration questions',
  'Curriculum or feature questions',
  'Partnership enquiry',
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

const PLAN_INQUIRY_MAP = {
  core:       'Explore institutional onboarding',
  standard:   'Explore institutional onboarding',
  premium:    'Book a discovery session',
  enterprise: 'Data migration questions',
};

export default function Contact() {
  const waUrl          = useWaUrl();
  const [searchParams] = useSearchParams();
  const planParam      = searchParams.get('plan');
  const defaultInquiry = PLAN_INQUIRY_MAP[planParam] || '';

  const [form, setForm] = useState({
    name: '', institution: '', role: '', email: '', phone: '',
    inquiry: defaultInquiry,
    message: planParam
      ? `I'm interested in the ${planParam.charAt(0).toUpperCase() + planParam.slice(1)} plan.`
      : '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [sending,   setSending]   = useState(false);

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, []);

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.name || !form.institution || !form.email) return;
    setSending(true);

    const subject = encodeURIComponent(`Msingi Enquiry — ${form.institution}`);
    const body    = encodeURIComponent(
      `Name: ${form.name}\nInstitution: ${form.institution}\nRole: ${form.role}\n` +
      `Email: ${form.email}\nPhone: ${form.phone}\nInquiry: ${form.inquiry}\n\n${form.message}`
    );

    await new Promise(r => setTimeout(r, 800));
    setSending(false);
    setSubmitted(true);
    window.location.href = `mailto:hello@msingi.io?subject=${subject}&body=${body}`;
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Book a Discovery Session | Msingi</title>
        <meta name="description" content="Book a 30-minute discovery session with Msingi. No demo pressure. A conversation about your school — led by educators, not salespeople." />
        <link rel="canonical" href="https://msingi.io/contact" />
        <meta property="og:type"        content="website" />
        <meta property="og:url"         content="https://msingi.io/contact" />
        <meta property="og:title"       content="Book a Discovery Session | Msingi" />
        <meta property="og:description" content="30 minutes. No commitment. A conversation about your school." />
        <meta property="og:image"       content="https://msingi.io/images/og-contact.png" />
        <meta name="twitter:card"        content="summary" />
        <meta name="twitter:title"       content="Book a Discovery Session | Msingi" />
        <meta name="twitter:description" content="30 minutes. No commitment. A conversation about your school." />
      </Helmet>

      <BreadcrumbSchema items={[{ name: 'Contact', href: '/contact' }]} />

      <PublicNav />

      <main>
        {/* Hero */}
        <section className="pt-32 pb-16 bg-white border-b border-slate-100">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" animate="visible" variants={stagger(0.08)} className="max-w-3xl">
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
                Get in touch
              </motion.p>
              <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl font-bold tracking-tighter text-slate-900 leading-[1.05] mb-5">
                Talk to someone who knows<br />
                <span className="text-slate-400">what you are building.</span>
              </motion.h1>
              <motion.p variants={fadeUp} className="text-lg text-slate-500 leading-relaxed">
                Our discovery sessions are led by educators, not salespeople. We ask about your school. You ask about us. No demo pressure. No commitment required.
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* Main content */}
        <section className="py-16 bg-white">
          <div className="max-w-7xl mx-auto px-6 lg:px-8">
            <div className="grid lg:grid-cols-5 gap-12 xl:gap-20">

              {/* Left: Context */}
              <motion.div
                initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.08)}
                className="lg:col-span-2 space-y-10"
              >
                <motion.div variants={fadeUp}>
                  <p className="text-sm text-slate-500 leading-relaxed mb-4">
                    Every school we work with gets a named implementation contact before signing anything. The discovery session is the start of that relationship — not a sales funnel.
                  </p>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    Most schools are live within 30 days. We handle the data migration.
                  </p>
                </motion.div>

                {/* Who we work with */}
                <motion.div variants={fadeUp}>
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-5">We work with</p>
                  <div className="space-y-3">
                    {WHO_WE_WORK_WITH.map(({ Icon, label }) => (
                      <div key={label} className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0">
                          <Icon size={14} />
                        </div>
                        <span className="text-sm text-slate-700">{label}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>

                {/* What we discuss */}
                <motion.div variants={fadeUp}>
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-5">In a session we cover</p>
                  <div className="space-y-2.5">
                    {CONTACT_REASONS.map(reason => (
                      <div key={reason} className="flex items-start gap-3">
                        <div className="w-4 h-4 rounded-full bg-slate-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <CheckCircle size={9} className="text-white" />
                        </div>
                        <span className="text-sm text-slate-600">{reason}</span>
                      </div>
                    ))}
                  </div>
                </motion.div>

                {/* Direct contact */}
                <motion.div variants={fadeUp} className="border-t border-slate-100 pt-8 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Or reach us directly</p>
                  <a href="mailto:hello@msingi.io"
                    className="flex items-center gap-3 text-sm text-slate-600 hover:text-slate-900 transition-colors">
                    <span className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-[11px] font-bold">@</span>
                    hello@msingi.io
                  </a>
                  <a href={waUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 text-sm text-slate-600 hover:text-slate-900 transition-colors">
                    <span className="w-8 h-8 rounded-lg bg-[#25D366]/10 flex items-center justify-center">
                      <MessageCircle size={14} className="text-[#25D366]" />
                    </span>
                    WhatsApp us
                  </a>
                </motion.div>
              </motion.div>

              {/* Right: Form */}
              <motion.div
                initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={VP} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="lg:col-span-3"
              >
                <AnimatePresence mode="wait">
                  {submitted ? (
                    <motion.div
                      key="success"
                      initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
                      className="rounded-2xl border border-emerald-100 bg-emerald-50 p-12 text-center"
                    >
                      <div className="w-14 h-14 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-emerald-500/25">
                        <CheckCircle size={26} className="text-white" />
                      </div>
                      <h3 className="text-xl font-bold text-slate-900 mb-2">We'll be in touch.</h3>
                      <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
                        Your enquiry has been received. We typically respond within one business day. For faster response, reach us on WhatsApp.
                      </p>
                      <a href={waUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-6 py-3 text-sm font-semibold text-white hover:opacity-90 transition-all shadow-sm">
                        <MessageCircle size={15} />
                        Chat on WhatsApp
                      </a>
                    </motion.div>
                  ) : (
                    <motion.form
                      key="form"
                      onSubmit={handleSubmit}
                      className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm space-y-5"
                    >
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">Discovery session request</p>
                        <h2 className="text-lg font-bold text-slate-900">Tell us about your school</h2>
                      </div>

                      {/* Name + Institution */}
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Full name <span className="text-red-400">*</span></label>
                          <input type="text" name="name" value={form.name} onChange={handleChange} required
                            placeholder="Dr. Jane Mwangi"
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">School name <span className="text-red-400">*</span></label>
                          <input type="text" name="institution" value={form.institution} onChange={handleChange} required
                            placeholder="Your school name"
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition" />
                        </div>
                      </div>

                      {/* Role */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Your role</label>
                        <select name="role" value={form.role} onChange={handleChange}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition">
                          <option value="">Select your role…</option>
                          {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>

                      {/* Email + Phone */}
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email address <span className="text-red-400">*</span></label>
                          <input type="email" name="email" value={form.email} onChange={handleChange} required
                            placeholder="jane@yourschool.ac.ke"
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Phone / WhatsApp</label>
                          <input type="tel" name="phone" value={form.phone} onChange={handleChange}
                            placeholder="+254 700 000 000"
                            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition" />
                        </div>
                      </div>

                      {/* Inquiry type */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">What are you interested in?</label>
                        <select name="inquiry" value={form.inquiry} onChange={handleChange}
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition">
                          <option value="">Select an option…</option>
                          {INQUIRY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </div>

                      {/* Message */}
                      <div>
                        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Additional context</label>
                        <textarea name="message" value={form.message} onChange={handleChange} rows={4}
                          placeholder="Tell us about your school — student count, current systems, what's not working, or anything else that matters…"
                          className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 transition resize-none" />
                      </div>

                      {/* Submit */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 pt-2">
                        <button type="submit"
                          disabled={sending || !form.name || !form.institution || !form.email}
                          className="group inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-600 disabled:opacity-40 transition-all shadow-sm">
                          {sending
                            ? <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            : <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
                          }
                          {sending ? 'Sending…' : 'Send enquiry'}
                        </button>
                      </div>

                      <p className="text-xs text-slate-400">
                        By submitting you agree to our <Link to="/privacy" className="underline hover:text-slate-700">privacy policy</Link>. We'll only use your details to respond to your enquiry.
                      </p>
                    </motion.form>
                  )}
                </AnimatePresence>
              </motion.div>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
      <FloatingActions />
    </div>
  );
}
