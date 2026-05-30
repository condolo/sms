/**
 * Msingi — Plans & Pricing Page
 * Per-student / per-term pricing model with three portal tiers.
 * Setup fee: KSh 30,000 – 50,000 (one-time, depends on size & modules).
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ArrowRight, Zap, Users, GraduationCap,
  BookCheck, BarChart3, Wallet, Clock, Shield, Star,
  ChevronDown, Phone,
} from 'lucide-react';

const EASE = [0.16, 1, 0.3, 1];
const fadeUp = {
  hidden:  { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};
const stagger = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.07 } },
};
const VP = { once: true, amount: 0.1 };

/* ── Portal tiers ────────────────────────────────────────────── */
const TIERS = [
  {
    key:     'base',
    name:    'Base',
    tagline: 'Full ERP for school staff',
    rate:    100,
    color:   'text-slate-700',
    ring:    'ring-slate-200',
    btn:     'bg-slate-900 text-white hover:bg-slate-700',
    badge:   null,
    includes: [
      'Admin & teacher dashboards',
      'Student records & profiles',
      'Attendance tracking',
      'Timetable management',
      'Exams, CA & assessment tools',
      'Lessons / syllabus tracker',
      'Finance, invoicing & payments',
      'Admissions pipeline',
      'Behaviour & discipline',
      'HR & staff management',
      'Library, transport & hostel',
      'Messaging & announcements',
      'Report cards & transcripts',
      'Role-based access control',
    ],
    portals: ['Admin', 'Teacher'],
  },
  {
    key:     'student',
    name:    'Student',
    tagline: 'Base + dedicated student portal',
    rate:    120,
    color:   'text-indigo-700',
    ring:    'ring-indigo-300',
    btn:     'bg-indigo-600 text-white hover:bg-indigo-700',
    badge:   null,
    includes: [
      'Everything in Base',
      'Student login accounts',
      'Student dashboard (lessons, timetable, grades)',
      'Attendance & fee balance view',
      'Report card access',
    ],
    portals: ['Admin', 'Teacher', 'Student'],
  },
  {
    key:     'family',
    name:    'Family',
    tagline: 'Student + parent portal included',
    rate:    160,
    color:   'text-violet-700',
    ring:    'ring-violet-300',
    btn:     'bg-violet-600 text-white hover:bg-violet-700',
    badge:   'Most popular',
    includes: [
      'Everything in Student',
      'Parent login accounts',
      'Parent dashboard (child progress, curriculum, fees)',
      'Real-time lesson coverage per subject',
      'Parent–teacher messaging',
      'Instant fee & payment notifications',
    ],
    portals: ['Admin', 'Teacher', 'Student', 'Parent'],
  },
];

/* ── All modules list ────────────────────────────────────────── */
const ALL_MODULES = [
  { icon: Users,         label: 'Student & Teacher Records' },
  { icon: Check,         label: 'Attendance Tracking' },
  { icon: BookCheck,     label: 'Lessons & Syllabus Tracker' },
  { icon: BarChart3,     label: 'Exams, CA & Grading' },
  { icon: Wallet,        label: 'Finance & Fee Management' },
  { icon: GraduationCap, label: 'Admissions Pipeline' },
  { icon: Clock,         label: 'Timetable Management' },
  { icon: Shield,        label: 'Behaviour & Discipline' },
  { icon: Star,          label: 'Report Cards & Transcripts' },
];

/* ── FAQ ─────────────────────────────────────────────────────── */
const FAQS = [
  {
    q: 'How does the per-student pricing work?',
    a: 'You pay per enrolled student at the start of each term. For example, a school with 300 students on the Family tier pays KSh 160 × 300 = KSh 48,000 per term.',
  },
  {
    q: 'What is the setup fee for?',
    a: 'The one-time setup fee (KSh 30,000 – 50,000) covers system onboarding, data configuration, staff training, and custom module setup. The exact amount depends on your student count and the modules you need.',
  },
  {
    q: 'Can we start on Base and upgrade later?',
    a: 'Yes. You can upgrade from Base to Student or Family at the start of any new term. All your existing data, settings, and history carry forward — no migration required.',
  },
  {
    q: 'Are there any hidden costs?',
    a: 'No. Your setup fee and per-student rate are the only costs. All future platform updates, new modules, and bug fixes are included at no extra charge.',
  },
  {
    q: 'What happens if we add more students mid-term?',
    a: 'Students added mid-term are billed pro-rata at your next term's invoice. We always use the term-start snapshot as the billing count.',
  },
  {
    q: 'Do you offer discounts for large schools?',
    a: 'Yes. Schools with over 500 students qualify for a negotiated rate. Contact us and we'll prepare a custom quote.',
  },
];

/* ── FAQ item ────────────────────────────────────────────────── */
function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-zinc-100 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 py-5 text-left"
      >
        <span className="text-sm font-semibold text-zinc-800">{q}</span>
        <ChevronDown size={16} className={`text-zinc-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden"
          >
            <p className="text-sm text-zinc-500 leading-relaxed pb-5">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Student count estimator ─────────────────────────────────── */
function PriceEstimator() {
  const [count,    setCount]    = useState(200);
  const [tier,     setTier]     = useState('family');
  const rates = { base: 100, student: 120, family: 160 };
  const termTotal   = count * rates[tier];
  const annualTotal = termTotal * 3;

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 md:p-8">
      <h3 className="text-base font-bold text-zinc-900 mb-1">Estimate your cost</h3>
      <p className="text-sm text-zinc-500 mb-6">Slide to match your school's size and choose a tier.</p>

      <div className="space-y-5">
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-semibold text-zinc-600 uppercase tracking-wide">Number of students</label>
            <span className="text-lg font-bold text-indigo-600">{count.toLocaleString()}</span>
          </div>
          <input
            type="range" min="50" max="2000" step="50"
            value={count} onChange={e => setCount(Number(e.target.value))}
            className="w-full accent-indigo-600"
          />
          <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
            <span>50</span><span>500</span><span>1,000</span><span>2,000</span>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-zinc-600 uppercase tracking-wide mb-2">Portal tier</label>
          <div className="grid grid-cols-3 gap-2">
            {TIERS.map(t => (
              <button
                key={t.key}
                onClick={() => setTier(t.key)}
                className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition-all ${
                  tier === t.key
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm shadow-indigo-500/20'
                    : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'
                }`}
              >
                {t.name}<br />
                <span className={`font-normal text-[10px] ${tier === t.key ? 'text-indigo-200' : 'text-zinc-400'}`}>
                  KSh {rates[t.key]}/student
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 bg-gradient-to-br from-indigo-50 to-violet-50 rounded-xl p-5">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-zinc-500 mb-0.5">Per term</p>
            <p className="text-3xl font-bold text-zinc-900">KSh {termTotal.toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-500 mb-0.5">Annual estimate (3 terms)</p>
            <p className="text-lg font-semibold text-indigo-600">KSh {annualTotal.toLocaleString()}</p>
          </div>
        </div>
        <p className="text-[11px] text-zinc-400 mt-3">
          + one-time setup fee of KSh {count <= 200 ? '30,000' : count <= 500 ? '35,000' : count <= 1000 ? '42,000' : '50,000'}
        </p>
      </div>
    </div>
  );
}

/* ── Main page ───────────────────────────────────────────────── */
export default function Plans() {
  const navigate = useNavigate();
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, []);

  return (
    <div className="min-h-screen bg-white text-zinc-900 antialiased">

      {/* ── NAVBAR ── */}
      <nav className="fixed top-0 left-0 right-0 w-full z-50 bg-white/80 backdrop-blur-xl border-b border-zinc-100/80">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-sm shadow-indigo-500/30">M</div>
            <span className="text-[15px] font-bold text-zinc-900 tracking-tight">Msingi</span>
          </Link>
          <div className="hidden md:flex items-center gap-7 text-sm text-zinc-500">
            <button onClick={() => navigate('/#modules')} className="hover:text-zinc-900 transition-colors">Modules</button>
            <Link to="/plans"   className="font-semibold text-zinc-900 transition-colors">Pricing</Link>
            <Link to="/contact" className="hover:text-zinc-900 transition-colors">Contact</Link>
          </div>
          <Link to="/contact" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 transition-colors shadow-sm">
            Book Demo
          </Link>
        </div>
      </nav>
      <div className="h-16" />

      {/* ── HERO ── */}
      <section className="max-w-4xl mx-auto px-6 lg:px-8 pt-16 pb-12 text-center">
        <motion.div initial="hidden" animate="visible" variants={stagger}>
          <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-4">
            Simple, Transparent Pricing
          </motion.p>
          <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl font-bold tracking-tighter text-zinc-900 leading-[1.06] mb-5">
            Pay only for what<br />
            <span className="text-indigo-600">your school actually uses.</span>
          </motion.h1>
          <motion.p variants={fadeUp} className="text-lg text-zinc-500 max-w-2xl mx-auto leading-relaxed">
            One-time setup fee. Then KSh 100–160 per student per term — choose whether
            you need student and parent portals or just the staff dashboard.
          </motion.p>
        </motion.div>
      </section>

      {/* ── TIER CARDS ── */}
      <section className="max-w-7xl mx-auto px-6 lg:px-8 pb-16">
        <motion.div
          initial="hidden" animate="visible" variants={stagger}
          className="grid grid-cols-1 sm:grid-cols-3 gap-5"
        >
          {TIERS.map(({ key, name, tagline, rate, color, ring, btn, badge, includes, portals }) => (
            <motion.div
              key={key}
              variants={fadeUp}
              className={`relative rounded-2xl bg-white ring-1 ${ring} p-6 flex flex-col ${
                key === 'family' ? 'shadow-xl shadow-violet-900/10' : 'shadow-sm'
              }`}
            >
              {badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1 text-[10px] font-bold text-white uppercase tracking-widest shadow-sm">
                    <Zap size={9} /> {badge}
                  </span>
                </div>
              )}

              <div className="mb-4">
                <h2 className={`text-xl font-bold mb-1 ${color}`}>{name}</h2>
                <p className="text-sm text-zinc-500">{tagline}</p>
              </div>

              {/* Price */}
              <div className="mb-5 pb-5 border-b border-zinc-100">
                <div className="flex items-end gap-1.5">
                  <span className="text-3xl font-bold text-zinc-900">KSh {rate}</span>
                  <span className="text-sm text-zinc-400 mb-1">/ student / term</span>
                </div>
                {/* Portal badges */}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {portals.map(p => (
                    <span key={p} className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-zinc-100 text-zinc-600">
                      {p}
                    </span>
                  ))}
                </div>
              </div>

              {/* Features */}
              <ul className="flex-1 space-y-2.5 mb-6">
                {includes.map(f => (
                  <li key={f} className={`flex items-start gap-2 text-xs ${f === 'Everything in Base' || f === 'Everything in Student' ? 'font-semibold text-zinc-700' : 'text-zinc-600'}`}>
                    <Check size={12} className="text-emerald-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                    {f}
                  </li>
                ))}
              </ul>

              <button
                onClick={() => navigate(`/contact?tier=${key}`)}
                className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all ${btn}`}
              >
                Get started
                <ArrowRight size={14} />
              </button>
            </motion.div>
          ))}
        </motion.div>

        {/* Setup fee note */}
        <motion.div
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="mt-6 text-center"
        >
          <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-800">
            <Zap size={14} className="text-amber-500 shrink-0" />
            <span>
              <strong>One-time setup fee:</strong> KSh 30,000 – 50,000 depending on student count and modules required.
            </span>
          </div>
        </motion.div>
      </section>

      {/* ── ESTIMATOR + ALL MODULES ── */}
      <section className="bg-zinc-50 border-y border-zinc-100 py-16">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">

            {/* Estimator */}
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-2">Pricing calculator</motion.p>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold tracking-tight text-zinc-900 mb-6">
                Know your exact cost<br />before you commit.
              </motion.h2>
              <motion.div variants={fadeUp}>
                <PriceEstimator />
              </motion.div>
            </motion.div>

            {/* What's in every plan */}
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-2">All tiers include</motion.p>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold tracking-tight text-zinc-900 mb-6">
                The full Msingi<br />module suite. Always.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-sm text-zinc-500 mb-6 leading-relaxed">
                Every tier — even Base — includes access to all Msingi modules. The tier only
                controls <strong className="text-zinc-700">who can log in</strong>: staff only, or staff + students, or staff + students + parents.
              </motion.p>
              <motion.ul variants={stagger} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {ALL_MODULES.map(({ icon: Icon, label }) => (
                  <motion.li
                    key={label}
                    variants={fadeUp}
                    className="flex items-center gap-3 bg-white rounded-xl border border-zinc-100 px-4 py-3 shadow-sm"
                  >
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                      <Icon size={14} className="text-indigo-600" />
                    </div>
                    <span className="text-xs font-medium text-zinc-700">{label}</span>
                  </motion.li>
                ))}
              </motion.ul>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="py-16 max-w-4xl mx-auto px-6 lg:px-8">
        <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger} className="text-center mb-12">
          <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">How it works</motion.p>
          <motion.h2 variants={fadeUp} className="text-2xl font-bold tracking-tight text-zinc-900">
            From sign-up to live in days.
          </motion.h2>
        </motion.div>

        <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger} className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {[
            { step: '01', title: 'Book a demo',         desc: 'We walk you through every module and understand your school's needs.' },
            { step: '02', title: 'Setup & onboarding',  desc: 'We configure your school, import data, and train your staff. Setup fee applies.' },
            { step: '03', title: 'Go live',             desc: 'Your school goes live. All staff, students, and parents can log in.' },
            { step: '04', title: 'Billed each term',    desc: 'Pay per student at the start of each term. No surprises.' },
          ].map(({ step, title, desc }) => (
            <motion.div key={step} variants={fadeUp} className="text-center">
              <div className="w-10 h-10 rounded-full bg-indigo-600 text-white text-xs font-bold flex items-center justify-center mx-auto mb-3">
                {step}
              </div>
              <h3 className="text-sm font-semibold text-zinc-800 mb-1">{title}</h3>
              <p className="text-xs text-zinc-500 leading-relaxed">{desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ── FAQ ── */}
      <section className="bg-zinc-50 border-t border-zinc-100 py-16">
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger} className="text-center mb-10">
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">FAQ</motion.p>
            <motion.h2 variants={fadeUp} className="text-2xl font-bold tracking-tight text-zinc-900">Common questions</motion.h2>
          </motion.div>
          <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={VP} className="bg-white rounded-2xl border border-zinc-200 shadow-sm px-6">
            {FAQS.map((f, i) => <FaqItem key={i} {...f} />)}
          </motion.div>
        </div>
      </section>

      {/* ── BOTTOM CTA ── */}
      <section className="py-20 bg-white text-center">
        <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger} className="max-w-2xl mx-auto px-6">
          <motion.h2 variants={fadeUp} className="text-3xl font-bold tracking-tight text-zinc-900 mb-4">
            Ready to bring your school online?
          </motion.h2>
          <motion.p variants={fadeUp} className="text-base text-zinc-500 mb-8 leading-relaxed">
            Book a 30-minute guided demo — no commitment required.
            We'll walk through every module and give you a tailored quote.
          </motion.p>
          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/contact"
              className="group inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-7 py-3.5 text-sm font-semibold text-white hover:bg-zinc-700 transition-all shadow-lg shadow-zinc-900/15"
            >
              Book a Demo
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <a
              href="tel:+254700000000"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-7 py-3.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 transition-all"
            >
              <Phone size={14} />
              Call us
            </a>
          </motion.div>
          <motion.p variants={fadeUp} className="text-xs text-zinc-400 mt-5">
            All schools currently onboard on full enterprise access · No credit card required
          </motion.p>
        </motion.div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-zinc-100 py-8 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-400">
          <Link to="/" className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center text-white text-[9px] font-bold">M</div>
            <span className="font-bold text-zinc-900">Msingi</span>
            <span className="ml-1">· The School Operating System</span>
          </Link>
          <p>© {new Date().getFullYear()} Msingi. All rights reserved.</p>
          <div className="flex gap-5">
            <a href="mailto:hello@msingi.io" className="hover:text-zinc-700 transition-colors">hello@msingi.io</a>
            <Link to="/contact" className="hover:text-zinc-700 transition-colors">Contact</Link>
            <a href="/platform" className="opacity-40 hover:opacity-70 transition-opacity">⚙</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
