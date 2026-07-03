/**
 * Msingi — Homepage (Website v2)
 * Narrative-first: purpose → morning hook → platform → solutions → pricing → trust → CTA
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, CheckCircle2, ChevronRight,
  Globe, Layers, Lock, ShieldCheck, Menu, X,
} from 'lucide-react';
import { ECOSYSTEM_NODES } from '@/data/landingData';
import { EASE, fadeUp, stagger, VP } from '@/utils/animations';
import { schoolPortalUrl, storeSchoolSlug } from '@/utils/schoolDetect.js';
import { getLandingCMS, getPlatformSettings } from '@/utils/landingCMS';
import { CMS_DEFAULTS } from '@/data/landingData';
import PublicNav    from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import DashboardMockup from '@/components/landing/DashboardMockup';
import PlansSection    from '@/components/landing/PlansSection';
import FloatingActions from '@/components/landing/FloatingActions';
import ModulePreviewPanel from '@/components/landing/ModulePreviewPanel';

const MORNING_MOMENTS = [
  { time: '6:45 AM', action: 'The term register is already updated.' },
  { time: '7:02 AM', action: 'Attendance marks begin arriving from classrooms.' },
  { time: '7:18 AM', action: 'Three fee payments reconcile automatically from M-Pesa.' },
  { time: '7:31 AM', action: 'The CBC report card drafts are ready for teacher review.' },
  { time: '7:45 AM', action: 'The principal opens one dashboard. The school is visible.' },
];

const TRUST_SIGNALS = [
  '99.9% uptime SLA',
  'Automated daily backups',
  'Full audit trail on all actions',
  'Tenant data isolation',
  'RBAC at API layer',
  'Immutable academic records',
  'M-Pesa STK Push & Paybill',
  'African data residency',
];

const INFRA_PILLARS = [
  {
    Icon: Layers,
    title: 'Tenant isolation',
    desc: "Every school's data is architecturally isolated at the database layer. No cross-tenant reads. No data bleed.",
  },
  {
    Icon: ShieldCheck,
    title: 'Role-based governance',
    desc: 'Granular, per-module permissions enforced server-side. Teachers see their classes. Parents see their children.',
  },
  {
    Icon: Lock,
    title: 'Permanent audit trail',
    desc: 'Every login, grade entry, payment, and approval is permanently logged with attribution, timestamp, and context.',
  },
  {
    Icon: Globe,
    title: 'Multi-curriculum native',
    desc: 'CBC, CAIE, IB, British, American, and custom frameworks — built into the academic engine from day one.',
  },
];

const STAKEHOLDERS = [
  { role: 'Principals',      href: '/solutions/principal',  line: 'One dashboard. Every department. Real time.' },
  { role: 'Teachers',        href: '/solutions/teacher',    line: 'Mark attendance in 90 seconds. Grade faster.' },
  { role: 'Finance officers',href: '/solutions/finance',    line: 'M-Pesa reconciliation in minutes, not mornings.' },
  { role: 'Parents',         href: '/solutions/parent',     line: 'Know how your child is doing before report day.' },
  { role: 'Admissions',      href: '/solutions/admissions', line: 'From enquiry to enrolled in one workflow.' },
];

const SOFTWARE_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Msingi',
  applicationCategory: 'EducationalApplication',
  operatingSystem: 'All',
  url: 'https://msingi.io',
  description: 'School management platform for African schools — attendance, grades, M-Pesa fees, admissions, report cards, and parent portals in one connected system.',
  offers: [
    { '@type': 'Offer', name: 'Base',           price: '150.00', priceCurrency: 'KES', description: 'KES 150 per student per term — full admin & teacher access' },
    { '@type': 'Offer', name: 'Student Portal', price: '200.00', priceCurrency: 'KES', description: 'KES 200 per student per term — adds student portal' },
    { '@type': 'Offer', name: 'Family Portal',  price: '250.00', priceCurrency: 'KES', description: 'KES 250 per student per term — adds parent portal' },
  ],
  audience: { '@type': 'EducationalAudience', educationalRole: 'administrator' },
  provider: {
    '@type': 'Organization',
    name: 'Msingi',
    url: 'https://msingi.io',
    logo: 'https://msingi.io/favicon.svg',
    email: 'hello@msingi.io',
    areaServed: ['KE', 'UG', 'TZ', 'RW'],
    founder: { '@type': 'Person', name: 'Collins Ndolo' },
  },
};

const ORG_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Msingi',
  url: 'https://msingi.io',
  logo: 'https://msingi.io/favicon.svg',
  email: 'hello@msingi.io',
  description: 'School management platform built for East African schools — CBC, CAIE, IB, M-Pesa, attendance, grades, admissions, and parent portals in one institution-grade system.',
  areaServed: ['Kenya', 'Uganda', 'Tanzania', 'Rwanda'],
  founder: { '@type': 'Person', name: 'Collins Ndolo', jobTitle: 'Founder' },
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'sales',
    email: 'hello@msingi.io',
    availableLanguage: ['English', 'Swahili'],
  },
};

export default function Landing() {
  const [cms,          setCms]          = useState(CMS_DEFAULTS);
  const [activeModule, setActiveModule] = useState(null);
  const [activeMoment, setActiveMoment] = useState(0);

  const closePanel = useCallback(() => setActiveModule(null), []);

  useEffect(() => {
    getLandingCMS().then(c => setCms(c));
  }, []);

  // Cycle through morning moments
  useEffect(() => {
    const id = setInterval(() => setActiveMoment(i => (i + 1) % MORNING_MOMENTS.length), 2800);
    return () => clearInterval(id);
  }, []);

  function goToSchool(slug) {
    storeSchoolSlug(slug);
    window.open(schoolPortalUrl(slug), '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Msingi | School Management Platform Built for Africa</title>
        <meta name="description" content="The school management platform built for Africa — by someone who taught here. CBC, CAIE, IB, M-Pesa, attendance, grades, report cards, and parent portals in one connected system." />
        <meta name="keywords" content="school management system Africa, school ERP Kenya, CBC school software, M-Pesa school fees, school management Kenya, school ERP Uganda Tanzania, student portal Africa, school admissions software" />
        <link rel="canonical" href="https://msingi.io/" />
        <meta property="og:type"        content="website" />
        <meta property="og:url"         content="https://msingi.io/" />
        <meta property="og:title"       content="Msingi | School Management Platform Built for Africa" />
        <meta property="og:description" content="The school management platform built for Africa — by someone who taught here. CBC, CAIE, IB, M-Pesa, attendance, grades, and parent portals in one system." />
        <meta property="og:image"       content="https://msingi.io/images/og-landing.png" />
        <meta property="og:site_name"   content="Msingi" />
        <meta name="twitter:card"        content="summary_large_image" />
        <meta name="twitter:title"       content="Msingi | School Management Platform Built for Africa" />
        <meta name="twitter:description" content="CBC, CAIE, IB, M-Pesa, attendance, grades, report cards, and parent portals in one connected school platform." />
        <meta name="twitter:image"       content="https://msingi.io/images/og-landing.png" />
        <script type="application/ld+json">{JSON.stringify(SOFTWARE_SCHEMA)}</script>
        <script type="application/ld+json">{JSON.stringify(ORG_SCHEMA)}</script>
      </Helmet>

      {activeModule && (
        <ModulePreviewPanel node={activeModule} onClose={closePanel} onNavigate={setActiveModule} />
      )}

      <PublicNav />

      <main>

        {/* ══ 1. HERO ══════════════════════════════════════════════════════════ */}
        <section className="relative pt-32 pb-20 bg-slate-950 overflow-hidden">
          {/* Subtle background texture */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-900/20 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-indigo-950/40 rounded-full blur-3xl" />
          </div>

          <div className="relative max-w-5xl mx-auto px-6 lg:px-8 text-center">
            <motion.div initial="hidden" animate="visible" variants={stagger(0.07)}>

              {/* Purpose-first label */}
              <motion.div variants={fadeUp} className="flex justify-center mb-8">
                <Link to="/why"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/60 backdrop-blur-sm px-4 py-1.5 text-xs font-medium text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-all">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                  Built by an educator who taught in these schools
                  <ChevronRight size={12} className="text-slate-600" />
                </Link>
              </motion.div>

              <motion.h1 variants={fadeUp}
                className="text-5xl sm:text-6xl lg:text-[72px] font-bold tracking-tighter text-white leading-[1.03] mb-6">
                The school management platform
                <br />
                <span className="text-slate-400">built for Africa.</span>
              </motion.h1>

              <motion.p variants={fadeUp} className="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed mb-3">
                22 connected modules. One institutional record. CBC, CAIE, IB, M-Pesa — native.
              </motion.p>
              <motion.p variants={fadeUp} className="text-base text-slate-500 italic mb-10">
                Not adapted for Africa. Built for it.
              </motion.p>

              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link to="/contact"
                  className="group inline-flex items-center gap-2 rounded-xl bg-white px-7 py-3.5 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-all shadow-lg">
                  Book a 30-min session
                  <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
                </Link>
                <button onClick={() => goToSchool('demo')}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-7 py-3.5 text-sm font-semibold text-slate-300 hover:border-slate-500 hover:text-white transition-all">
                  Explore the platform
                  <ChevronRight size={15} className="text-slate-600" />
                </button>
              </motion.div>
            </motion.div>

            {/* Dashboard mockup */}
            <motion.div
              initial={{ opacity: 0, y: 48, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.9, delay: 0.3, ease: EASE }}
              className="mt-16">
              <DashboardMockup />
            </motion.div>
          </div>
        </section>

        {/* ══ 2. MORNING NARRATIVE ════════════════════════════════════════════ */}
        <section className="py-20 bg-white border-b border-slate-100">
          <div className="max-w-5xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                A new term begins
              </motion.p>
              <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight mb-10">
                Before the first student arrives,<br />
                <span className="text-slate-400">Msingi has already done its work.</span>
              </motion.h2>
            </motion.div>

            <div className="grid lg:grid-cols-2 gap-12 items-start">
              {/* Animated timeline */}
              <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.08)}
                className="space-y-3">
                {MORNING_MOMENTS.map((m, i) => (
                  <motion.div key={i} variants={fadeUp}
                    onClick={() => setActiveMoment(i)}
                    className={`flex gap-4 p-4 rounded-xl cursor-pointer transition-all duration-300 ${
                      activeMoment === i
                        ? 'bg-slate-900 border border-slate-700'
                        : 'bg-slate-50 border border-slate-100 hover:bg-slate-100'
                    }`}>
                    <span className={`text-xs font-mono font-semibold flex-shrink-0 mt-0.5 ${
                      activeMoment === i ? 'text-indigo-400' : 'text-slate-400'
                    }`}>
                      {m.time}
                    </span>
                    <p className={`text-sm leading-snug ${
                      activeMoment === i ? 'text-white font-medium' : 'text-slate-600'
                    }`}>
                      {m.action}
                    </p>
                  </motion.div>
                ))}
              </motion.div>

              {/* Narrative text */}
              <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}
                className="space-y-5 text-base text-slate-600 leading-relaxed">
                <motion.p variants={fadeUp}>
                  Every morning, before the first lesson begins, a school leader is already making dozens of decisions. Admissions. Attendance. Parent queries. Teacher coverage. Fee balances.
                </motion.p>
                <motion.p variants={fadeUp}>
                  The information needed to make those decisions exists — in registers, in spreadsheets, in WhatsApp threads, in the finance office. It exists everywhere except where it needs to be: in one place, in real time.
                </motion.p>
                <motion.p variants={fadeUp}>
                  Msingi is that one place.
                </motion.p>
                <motion.div variants={fadeUp}>
                  <Link to="/why"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-indigo-600 transition-colors">
                    Read why we built it <ArrowRight size={13} />
                  </Link>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ══ 3. PLATFORM — MODULE ECOSYSTEM ═════════════════════════════════ */}
        <section id="platform" className="py-24 sm:py-32 bg-slate-950 overflow-hidden">
          <div className="max-w-7xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()} className="mb-16">
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">
                Platform
              </motion.p>
              <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4 leading-tight">
                22 modules. One record. No reconciliation.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-base text-slate-400 max-w-xl leading-relaxed">
                Data entered once flows everywhere it needs to be — without re-entry, without a spreadsheet to bridge the gap.
              </motion.p>
              <motion.div variants={fadeUp} className="mt-5">
                <Link to="/platform"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-white transition-colors">
                  See the full platform overview <ArrowRight size={13} />
                </Link>
              </motion.div>
            </motion.div>

            <div className="relative rounded-3xl border border-slate-800/60 bg-slate-900/40 p-6 sm:p-8 lg:p-10">
              <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-950/30 via-transparent to-slate-950/30 pointer-events-none" />
              <motion.div
                initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.04)}
                className="relative grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-y-8 gap-x-4 sm:gap-x-6">
                {ECOSYSTEM_NODES.map(node => (
                  <motion.button
                    key={node.label}
                    variants={fadeUp}
                    onClick={() => setActiveModule(node)}
                    aria-label={`Preview ${node.label} module`}
                    className={`flex flex-col items-center gap-2.5 group cursor-pointer rounded-2xl p-2 -m-2 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                      activeModule?.label === node.label ? 'opacity-100' : 'hover:opacity-100 opacity-80'
                    }`}>
                    <div className={`w-12 h-12 rounded-2xl ${node.color} flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:shadow-xl transition-all duration-200 ${
                      activeModule?.label === node.label ? 'ring-2 ring-white/50 scale-110' : ''
                    }`}>
                      <node.Icon size={22} className="text-white" />
                    </div>
                    <p className="text-xs font-semibold text-white text-center leading-tight">{node.label}</p>
                    <p className="text-[10px] text-slate-500 text-center leading-tight">{node.desc}</p>
                  </motion.button>
                ))}
              </motion.div>
            </div>

            <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
              transition={{ delay: 0.5, duration: 0.6 }}
              className="text-center text-slate-600 text-sm mt-8 font-medium tracking-wide">
              Click any module to explore its features
            </motion.p>
          </div>
        </section>

        {/* ══ 4. CURRICULUM STRIP ════════════════════════════════════════════ */}
        <section className="py-12 bg-white border-b border-slate-100">
          <div className="max-w-5xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}
              className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 flex-shrink-0">
                Curriculum support
              </motion.p>
              <motion.div variants={fadeUp} className="flex flex-wrap gap-3">
                {['CBC', 'CAIE', 'IB', 'British', 'American', 'WASSCE', 'Custom'].map(c => (
                  <span key={c} className="px-3.5 py-1.5 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 bg-slate-50">
                    {c}
                  </span>
                ))}
              </motion.div>
              <motion.div variants={fadeUp} className="sm:ml-auto flex-shrink-0">
                <Link to="/platform" className="text-xs font-semibold text-slate-400 hover:text-slate-700 transition-colors">
                  No extra charge →
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* ══ 5. SOLUTIONS ───────────────────────────────────────────────────── */}
        <section id="solutions" className="py-24 sm:py-28 bg-slate-50 border-b border-slate-100">
          <div className="max-w-5xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
                Solutions
              </motion.p>
              <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight mb-12">
                Different people. Different outcomes.<br />
                <span className="text-slate-400">One platform.</span>
              </motion.h2>

              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {STAKEHOLDERS.map((s, i) => (
                  <motion.div key={i} variants={fadeUp}>
                    <Link to={s.href}
                      className="group flex flex-col gap-2 p-5 bg-white border border-slate-200 rounded-2xl hover:border-slate-400 hover:shadow-sm transition-all">
                      <p className="text-sm font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                        {s.role}
                      </p>
                      <p className="text-sm text-slate-500 leading-relaxed flex-1">{s.line}</p>
                      <span className="text-xs font-semibold text-slate-400 group-hover:text-indigo-500 transition-colors flex items-center gap-1 mt-1">
                        See how it works <ArrowRight size={11} />
                      </span>
                    </Link>
                  </motion.div>
                ))}
                {/* Overflow card */}
                <motion.div variants={fadeUp}>
                  <Link to="/platform"
                    className="group flex flex-col gap-2 p-5 bg-slate-900 border border-slate-800 rounded-2xl hover:bg-slate-800 transition-all">
                    <p className="text-sm font-semibold text-white">Full platform overview</p>
                    <p className="text-sm text-slate-400 leading-relaxed flex-1">22 modules. How they connect. What they replace.</p>
                    <span className="text-xs font-semibold text-slate-500 group-hover:text-slate-300 transition-colors flex items-center gap-1 mt-1">
                      Explore <ArrowRight size={11} />
                    </span>
                  </Link>
                </motion.div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ══ 6. PRICING TEASER ══════════════════════════════════════════════ */}
        <section id="pricing" className="py-20 sm:py-24 bg-white border-b border-slate-100">
          <div className="max-w-5xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Pricing</motion.p>
              <motion.h2 variants={fadeUp} className="text-3xl font-bold tracking-tight text-slate-900 mb-3">
                Transparent pricing. No surprises.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-slate-500 mb-10 max-w-lg">
                Per student, per term. Published, not negotiated. No setup fee. No lock-in.
              </motion.p>

              <motion.div variants={fadeUp} className="grid sm:grid-cols-3 gap-4 mb-8">
                {[
                  { name: 'Base',           price: 'KES 150', note: 'Admin + teacher access' },
                  { name: 'Student Portal', price: 'KES 200', note: 'Adds student portal', highlight: true },
                  { name: 'Family Portal',  price: 'KES 250', note: 'Adds parent portal' },
                ].map(tier => (
                  <div key={tier.name}
                    className={`rounded-2xl border p-6 ${
                      tier.highlight
                        ? 'border-indigo-200 bg-indigo-50'
                        : 'border-slate-200 bg-slate-50'
                    }`}>
                    <p className="text-xs font-semibold text-slate-500 mb-2">{tier.name}</p>
                    <p className="text-3xl font-bold text-slate-900 mb-1">{tier.price}</p>
                    <p className="text-xs text-slate-400">per student · per term</p>
                    <p className="text-xs text-slate-500 mt-3">{tier.note}</p>
                  </div>
                ))}
              </motion.div>

              <motion.div variants={fadeUp}>
                <Link to="/pricing"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-indigo-600 transition-colors">
                  See full pricing and estimate your cost <ArrowRight size={13} />
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* ══ 7. PLANS SECTION (existing component, keep for full plan detail) */}
        <PlansSection />

        {/* ══ 8. TRUST / INFRASTRUCTURE ══════════════════════════════════════ */}
        <section id="security" className="py-24 sm:py-32 bg-slate-950">
          <div className="max-w-7xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Security</motion.p>
              <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4 leading-tight">
                Built for institutional trust.<br />
                <span className="text-slate-500">Not a startup experiment.</span>
              </motion.h2>
              <motion.p variants={fadeUp} className="text-base text-slate-400 max-w-xl mb-6 leading-relaxed">
                Schools are asked to trust a platform with their most sensitive operational and academic data. Msingi is engineered for that responsibility.
              </motion.p>

              <motion.div variants={fadeUp} className="flex flex-wrap gap-2.5 mb-12">
                {TRUST_SIGNALS.map(t => (
                  <span key={t} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-700 text-xs text-slate-400 font-medium">
                    <CheckCircle2 size={10} className="text-emerald-500" />{t}
                  </span>
                ))}
              </motion.div>

              <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.07)}
                className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                {INFRA_PILLARS.map(({ Icon, title, desc }, i) => (
                  <motion.div key={i} variants={fadeUp}
                    className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 hover:border-slate-700 hover:bg-slate-900 transition-all duration-300">
                    <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center mb-4">
                      <Icon size={15} className="text-slate-400" />
                    </div>
                    <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
                  </motion.div>
                ))}
              </motion.div>

              <motion.div variants={fadeUp}>
                <Link to="/security"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-white transition-colors">
                  Visit the Trust Centre <ArrowRight size={13} />
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* ══ 9. HONEST SOCIAL PROOF ════════════════════════════════════════ */}
        <section className="py-16 bg-white border-b border-slate-100">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}
              className="flex flex-col sm:flex-row gap-8 items-start sm:items-center">
              <motion.div variants={fadeUp} className="flex-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Where Msingi is live</p>
                <p className="text-2xl font-bold text-slate-900 mb-2">
                  Live at Mascit Lab Academy.
                </p>
                <p className="text-slate-500 text-sm leading-relaxed">
                  We are actively onboarding partner schools for the 2026 academic year. Early schools have direct input into the product roadmap.
                </p>
              </motion.div>
              <motion.div variants={fadeUp} className="flex-shrink-0">
                <Link to="/contact"
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-600 transition-all">
                  Enquire about early access <ArrowRight size={14} />
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* ══ 10. FINAL CTA ═════════════════════════════════════════════════ */}
        <section className="py-24 sm:py-32 bg-slate-50">
          <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-6">
                The next step
              </motion.p>
              <motion.h2 variants={fadeUp}
                className="text-4xl sm:text-5xl font-bold tracking-tighter text-slate-900 leading-[1.05] mb-6">
                A 30-minute session.<br />No commitment required.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-base text-slate-500 leading-relaxed mb-3 max-w-lg mx-auto">
                Our discovery sessions are led by educators, not salespeople. We ask about your school. You ask about us. No demo pressure.
              </motion.p>
              <motion.p variants={fadeUp} className="text-sm text-slate-400 mb-10 max-w-sm mx-auto">
                Every school gets a named implementation contact before signing anything.
              </motion.p>
              <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link to="/contact"
                  className="group inline-flex items-center gap-2 rounded-xl bg-slate-900 px-8 py-4 text-sm font-semibold text-white hover:bg-indigo-600 transition-all shadow-lg">
                  Book a discovery session
                  <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
                </Link>
                <button onClick={() => goToSchool('demo')}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-8 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-all">
                  Explore the platform <ChevronRight size={15} className="text-slate-400" />
                </button>
              </motion.div>
            </motion.div>
          </div>
        </section>

      </main>

      <PublicFooter />
      <FloatingActions />
    </div>
  );
}
