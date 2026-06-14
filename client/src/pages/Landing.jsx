/**
 * Msingi — Landing Page
 * 7-section flow: Hero → Conviction → Ecosystem → Showcase → Plans → Trust → CTA + Footer
 */
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight, CheckCircle, CheckCircle2, ChevronRight,
  Globe, Layers, Lock, MessageCircle, ShieldCheck,
} from 'lucide-react';
import { schoolPortalUrl, storeSchoolSlug } from '@/utils/schoolDetect.js';
import { ECOSYSTEM_NODES, CONVICTION_PAIRS, SHOWCASE_TAB_DATA, WA_URL } from '@/data/landingData';
import { CMS_DEFAULTS } from '@/data/landingData';
import { EASE, fadeUp, stagger, VP } from '@/utils/animations';
import { getLandingCMS, getPlatformSettings } from '@/utils/landingCMS';
import GradientHeroBG        from '@/components/landing/GradientHeroBG';
import DashboardMockup       from '@/components/landing/DashboardMockup';
import ReportGovernanceMockup from '@/components/landing/ReportGovernanceMockup';
import FeeRegisterMockup     from '@/components/landing/FeeRegisterMockup';
import ModulePreviewPanel    from '@/components/landing/ModulePreviewPanel';
import PlansSection          from '@/components/landing/PlansSection';
import FloatingActions       from '@/components/landing/FloatingActions';
import SocialLinks           from '@/components/landing/SocialLinks';

// Wire showcase tab data to their mockup components
const SHOWCASE_TABS = SHOWCASE_TAB_DATA.map((tab, i) => ({
  ...tab,
  Mockup: [DashboardMockup, ReportGovernanceMockup, FeeRegisterMockup][i],
}));

const NAV_LINKS = [
  { label: 'Platform',       href: '#ecosystem' },
  { label: 'Solutions',      href: '#showcase'  },
  { label: 'Plans',          href: '#plans'     },
  { label: 'Infrastructure', href: '#trust'     },
];

const TRUST_SIGNALS = [
  '99.9% uptime SLA', 'Automated daily backups', 'Full audit log on all actions',
  'Tenant data isolation', 'RBAC at API layer', 'Immutable academic records', 'M-Pesa STK Push & Paybill',
];

const PILLAR_CARDS = [
  { Icon: Layers,      title: 'Tenant isolation',       desc: "Every school's data is architecturally isolated at the database layer. No cross-tenant reads, no data bleed." },
  { Icon: ShieldCheck, title: 'Role-based governance',  desc: 'Granular, per-module permissions enforced server-side. Teachers see their classes. Parents see their children.' },
  { Icon: Lock,        title: 'Permanent audit trail',  desc: 'Every login, grade entry, payment, and approval is permanently logged with attribution, timestamp, and context.' },
  { Icon: Globe,       title: 'Multi-curriculum native', desc: 'CBC, Cambridge, IB, British, American, and fully custom frameworks — built into the academic engine from day one.' },
];

const FOOTER_PLATFORM = ['Students', 'Attendance', 'Grades & Exams', 'Finance', 'Timetable', 'Reports', 'E-Learning', 'Analytics'];
const FOOTER_SOLUTIONS = ['School Directors', 'Teaching Staff', 'Parents', 'Students'];
const FOOTER_COMPANY   = [
  { label: 'Plans & Pricing', href: '#plans'   },
  { label: 'Infrastructure',  href: '#trust'   },
  { label: 'Contact Us',      href: '/contact' },
];

export default function Landing() {
  const [schoolInput,  setSchoolInput]  = useState('');
  const [finding,      setFinding]      = useState(false);
  const [findError,    setFindError]    = useState('');
  const [socialLinks,  setSocialLinks]  = useState({});
  const [navScrolled,  setNavScrolled]  = useState(false);
  const [showcaseTab,  setShowcaseTab]  = useState(0);
  const [cms,          setCms]          = useState(CMS_DEFAULTS);
  const [activeModule, setActiveModule] = useState(null);

  const closePanel = useCallback(() => setActiveModule(null), []);

  useEffect(() => {
    getLandingCMS().then(c => setCms(c));
    getPlatformSettings().then(s => setSocialLinks(s.socialLinks || {}));
    function onScroll() { setNavScrolled(window.scrollY > 20); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function goToSchool(slug) {
    storeSchoolSlug(slug);
    window.open(schoolPortalUrl(slug), '_blank', 'noopener,noreferrer');
  }

  async function handleFindSchool(e) {
    e.preventDefault();
    const slug = schoolInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (!slug) return;
    setFinding(true); setFindError('');
    try {
      const res = await fetch(`/api/public/school-info?slug=${slug}`);
      if (!res.ok) { setFindError(`No school found for "${slug}".`); setFinding(false); return; }
      goToSchool(slug);
    } catch {
      setFindError('Could not connect. Please try again.');
      setFinding(false);
    }
  }

  const ActiveMockup = SHOWCASE_TABS[showcaseTab].Mockup;

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">

      {activeModule && (
        <ModulePreviewPanel node={activeModule} onClose={closePanel} onNavigate={setActiveModule} />
      )}

      {/* ── Animated top stripe ─────────────────── */}
      <motion.div
        className="fixed top-0 inset-x-0 z-[60] h-[3px]"
        style={{ background: 'linear-gradient(90deg,#4f46e5,#7c3aed,#0ea5e9,#4f46e5)', backgroundSize: '200% 100%' }}
        animate={{ backgroundPosition: ['0% 0%', '-200% 0%'] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
      />

      {/* ── Navbar ──────────────────────────────── */}
      <motion.nav
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className={`fixed top-[3px] inset-x-0 z-50 transition-all duration-300 ${
          navScrolled ? 'bg-white/95 backdrop-blur-md shadow-sm border-b border-indigo-100/60' : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link to="/" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold shadow-sm group-hover:shadow-indigo-500/40 group-hover:scale-105 transition-all">M</div>
            <span className="text-sm font-bold text-slate-900 tracking-tight">Msingi</span>
          </Link>

          <div className="hidden md:flex items-center gap-1">
            {NAV_LINKS.map(({ label, href }) => (
              <a key={label} href={href}
                className="relative px-3.5 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50/60 transition-all">
                {label}
              </a>
            ))}
            <div className="ml-2 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-100">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
              <span className="text-[10px] font-semibold text-emerald-700 hidden lg:block">Platform Live</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Link to="/login" className="hidden sm:block px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
              Login
            </Link>
            <Link to="/contact"
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-all shadow-md shadow-indigo-600/25 hover:shadow-indigo-500/40 hover:-translate-y-px">
              Book Demo
            </Link>
          </div>
        </div>
      </motion.nav>

      <div className="h-[67px]" />

      {/* ══ 1. HERO ═════════════════════════════════ */}
      <section className="relative max-w-7xl mx-auto px-6 lg:px-8 pt-20 pb-16 overflow-hidden">
        <div className="absolute inset-0 -z-10 pointer-events-none" style={{ height: '110%' }}>
          <GradientHeroBG />
          <div className="absolute inset-0 bg-gradient-to-b from-white/40 via-white/20 to-white/95" />
        </div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }}
          className="flex justify-center mb-8">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 backdrop-blur-sm px-3.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            {cms.hero.tagline}
          </div>
        </motion.div>

        <motion.div initial="hidden" animate="visible" variants={stagger(0.07)} className="text-center max-w-4xl mx-auto">
          <motion.h1 variants={fadeUp}
            className="text-5xl sm:text-6xl lg:text-[72px] font-bold tracking-tighter text-slate-900 leading-[1.04] mb-6">
            {cms.hero.headline.split('\n').map((line, i, arr) => (
              i < arr.length - 1
                ? <span key={i}>{line}<br /></span>
                : <span key={i} className="text-indigo-600">{line}</span>
            ))}
          </motion.h1>

          <motion.p variants={fadeUp} className="text-lg sm:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed mb-3">
            {cms.hero.subheadline}
          </motion.p>

          <motion.p variants={fadeUp} className="text-base text-slate-400 italic mb-10">
            {cms.hero.italic}
          </motion.p>

          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/contact"
              className="group inline-flex items-center gap-2 rounded-xl bg-slate-900 px-7 py-3.5 text-sm font-semibold text-white hover:bg-slate-700 transition-all shadow-lg shadow-slate-900/20">
              Book a Demo
              <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <button onClick={() => goToSchool('demo')}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 backdrop-blur-sm px-7 py-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all">
              Explore the Platform
              <ChevronRight size={15} className="text-slate-400" />
            </button>
          </motion.div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 48, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.25, ease: EASE }} className="mt-16 relative">
          <div className="absolute -inset-x-4 top-0 h-40 bg-gradient-to-b from-indigo-50/40 via-transparent to-transparent -z-10" />
          <DashboardMockup />
        </motion.div>
      </section>

      {/* ── Trust band ──────────────────────────── */}
      <section className="py-10 bg-white border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-400 mb-6">
            {cms.trust.tagline}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 lg:gap-14">
            {(cms.trust.schools || []).map(name => (
              <span key={name} className="text-slate-300 font-bold text-sm tracking-widest uppercase select-none">{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ══ 2. CONVICTION ═══════════════════════════ */}
      <section className="py-20 sm:py-28 bg-slate-50 border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
            <motion.div variants={fadeUp} className="mb-12">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">The Leadership Gap</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
                The information exists.<br />
                <span className="text-slate-400">Leaders rarely see it when it matters.</span>
              </h2>
            </motion.div>

            <div className="space-y-3">
              {(cms.conviction || CONVICTION_PAIRS).map(({ before, after }, i) => (
                <motion.div key={i} variants={fadeUp}
                  className="grid sm:grid-cols-[1fr_auto_1fr] gap-3 sm:gap-5 items-center">
                  <div className="flex items-start gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3.5">
                    <div className="w-4 h-4 rounded-full border-2 border-slate-300 shrink-0 mt-0.5" />
                    <p className="text-sm text-slate-500 leading-snug">{before}</p>
                  </div>
                  <div className="hidden sm:flex items-center justify-center">
                    <ArrowRight size={16} className="text-indigo-400" />
                  </div>
                  <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3.5">
                    <div className="w-4 h-4 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                      <CheckCircle size={9} className="text-white" />
                    </div>
                    <p className="text-sm font-medium text-slate-800 leading-snug">{after}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ══ 3. ECOSYSTEM ════════════════════════════ */}
      <section id="ecosystem" className="py-24 sm:py-32 bg-slate-950 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()} className="text-center mb-16">
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Platform Architecture</motion.p>
            <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4 leading-tight">
              {cms.ecosystem.heading}
            </motion.h2>
            <motion.p variants={fadeUp} className="text-base text-slate-400 max-w-xl mx-auto leading-relaxed">
              {cms.ecosystem.subheading}
            </motion.p>
            <motion.p variants={fadeUp} className="text-xs text-slate-600 mt-3 flex items-center justify-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-600 animate-pulse" />
              Click any module to explore its features
            </motion.p>
          </motion.div>

          <div className="relative rounded-3xl border border-slate-800/60 bg-slate-900/40 p-6 sm:p-8 lg:p-10">
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-indigo-950/30 via-transparent to-slate-950/30 pointer-events-none" />
            <motion.div
              initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.045)}
              className="relative grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-y-8 gap-x-4 sm:gap-x-6">
              {ECOSYSTEM_NODES.filter(n => (cms.ecosystem.enabledNodes || []).includes(n.label)).map((node) => (
                <motion.button
                  key={node.label}
                  variants={fadeUp}
                  onClick={() => setActiveModule(node)}
                  aria-label={`Preview ${node.label} module`}
                  className={`flex flex-col items-center gap-2.5 group cursor-pointer rounded-2xl p-2 -m-2 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${
                    activeModule?.label === node.label ? 'opacity-100' : 'hover:opacity-100 opacity-85'
                  }`}>
                  <div className={`w-12 h-12 rounded-2xl ${node.color} flex items-center justify-center shadow-lg group-hover:scale-110 group-hover:shadow-xl transition-all duration-200 ${
                    activeModule?.label === node.label ? 'ring-2 ring-white/50 scale-110' : ''
                  }`}>
                    <node.Icon size={22} className="text-white" />
                  </div>
                  <p className="text-xs font-semibold text-white text-center leading-tight">{node.label}</p>
                  <p className="text-[10px] text-slate-500 text-center leading-tight">{cms.ecosystem.nodeDescs?.[node.label] ?? node.desc}</p>
                </motion.button>
              ))}
            </motion.div>
          </div>

          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="text-center text-slate-600 text-sm mt-8 font-medium tracking-wide">
            No data re-entry. No reconciliation. No manual handoff.
          </motion.p>
        </div>
      </section>

      {/* ══ 4. SHOWCASE ═════════════════════════════ */}
      <section id="showcase" className="py-24 sm:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()} className="mb-12">
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Platform Intelligence</motion.p>
            <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 leading-tight">
              Three ways leaders see<br />
              <span className="text-slate-400">what was invisible before.</span>
            </motion.h2>
          </motion.div>

          <div className="flex items-center gap-2 mb-10 flex-wrap">
            {SHOWCASE_TABS.map((tab, i) => (
              <button key={tab.id} onClick={() => setShowcaseTab(i)}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                  showcaseTab === i ? 'bg-slate-900 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700'
                }`}>
                <tab.Icon size={14} />
                {tab.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={showcaseTab}
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="grid lg:grid-cols-[1fr_2fr] gap-10 lg:gap-16 items-start">
              <div className="lg:pt-4">
                <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-5 leading-tight">
                  {SHOWCASE_TABS[showcaseTab].headline}
                </h3>
                <ul className="space-y-3.5">
                  {SHOWCASE_TABS[showcaseTab].bullets.map((b, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-slate-900 flex items-center justify-center shrink-0 mt-0.5">
                        <CheckCircle size={10} className="text-white" />
                      </div>
                      <p className="text-sm text-slate-600 leading-relaxed">{b}</p>
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  <Link to="/contact" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900 hover:text-indigo-600 transition-colors">
                    See it in a demo <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
              <div><ActiveMockup /></div>
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      {/* ══ 5. PLANS ════════════════════════════════ */}
      <PlansSection />

      {/* ══ 6. TRUST / INFRASTRUCTURE ═══════════════ */}
      <section id="trust" className="py-24 sm:py-32 bg-slate-950">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-4">Trust Architecture</motion.p>
            <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4 leading-tight">
              Built for institutional trust.<br />
              <span className="text-slate-500">Not a startup experiment.</span>
            </motion.h2>
            <motion.p variants={fadeUp} className="text-base text-slate-400 max-w-xl mb-6 leading-relaxed">
              School directors are asked to trust a platform with their most sensitive operational and academic data.
              Msingi is engineered specifically for that responsibility.
            </motion.p>

            <motion.div variants={fadeUp} className="flex flex-wrap gap-2.5 mb-14">
              {TRUST_SIGNALS.map(t => (
                <span key={t} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-slate-700 text-xs text-slate-400 font-medium">
                  <CheckCircle2 size={10} className="text-emerald-500" />{t}
                </span>
              ))}
            </motion.div>

            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.08)}
              className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {PILLAR_CARDS.map(({ Icon, title, desc }, i) => (
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
          </motion.div>
        </div>
      </section>

      {/* ══ 7. FINAL CTA ════════════════════════════ */}
      <section className="py-24 sm:py-32 bg-white">
        <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-6">The next step</motion.p>
            <motion.h2 variants={fadeUp}
              className="text-4xl sm:text-5xl lg:text-[56px] font-bold tracking-tighter text-slate-900 leading-[1.05] mb-6">
              Give your leadership team<br />the clarity they need.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-base text-slate-400 leading-relaxed mb-3 max-w-lg mx-auto">
              The institutions running on Msingi don't patch workflows with WhatsApp groups and spreadsheets.
              They have the intelligence to act quickly, govern carefully, and lead with confidence.
            </motion.p>
            <motion.blockquote variants={fadeUp} className="text-sm italic text-slate-400 border-l-2 border-slate-200 pl-4 text-left max-w-md mx-auto mb-10">
              "Our principal now makes the same decisions in minutes that used to take a week of follow-up emails."
              <cite className="block mt-1 not-italic font-medium text-slate-500 text-xs">— School Director, Greenwood Academy</cite>
            </motion.blockquote>
            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link to="/contact"
                className="group inline-flex items-center gap-2 rounded-xl bg-slate-900 px-8 py-4 text-sm font-semibold text-white hover:bg-slate-700 transition-all shadow-lg shadow-slate-900/20">
                Book a Demo <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <button onClick={() => goToSchool('demo')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-8 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all">
                Explore the Platform <ChevronRight size={15} className="text-slate-400" />
              </button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────── */}
      <footer className="bg-slate-950 text-slate-400">
        <div className="h-px bg-gradient-to-r from-transparent via-indigo-800/60 to-transparent" />

        <div className="max-w-7xl mx-auto px-6 lg:px-8 pt-16 pb-10">
          <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-10 lg:gap-6">

            {/* Brand + school finder */}
            <div className="lg:col-span-2">
              <Link to="/" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="inline-flex items-center gap-2.5 mb-4 group">
                <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white text-sm font-bold shadow-lg shadow-indigo-900/50 group-hover:scale-105 transition-transform">M</div>
                <span className="text-lg font-bold text-white tracking-tight">Msingi</span>
              </Link>
              <p className="text-sm text-slate-500 leading-relaxed mb-5 max-w-xs">
                Decision Intelligence for Educational Leaders. Real-time visibility across admissions, academics, attendance, and finance — all in one institution-grade platform.
              </p>
              <div className="mb-8">
                <SocialLinks links={socialLinks} />
              </div>

              {/* School finder */}
              <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
                <p className="text-xs font-semibold text-slate-300 mb-0.5">Already have a school account?</p>
                <p className="text-[11px] text-slate-600 mb-3">Enter your school slug to access your portal.</p>
                <form onSubmit={handleFindSchool} className="flex gap-2">
                  <input type="text" value={schoolInput}
                    onChange={(e) => { setSchoolInput(e.target.value); setFindError(''); }}
                    placeholder="e.g. greenwood-academy"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition" />
                  <button type="submit" disabled={finding || !schoolInput.trim()}
                    className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 transition-colors">
                    {finding ? '…' : 'Go'}
                  </button>
                </form>
                {findError && <p className="mt-2 text-xs text-red-400">{findError}</p>}
              </div>
            </div>

            {/* Platform links */}
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-5">Platform</h4>
              <ul className="space-y-3">
                {FOOTER_PLATFORM.map(item => (
                  <li key={item}><a href="#ecosystem" className="text-sm text-slate-500 hover:text-white transition-colors">{item}</a></li>
                ))}
              </ul>
            </div>

            {/* Solutions + Company */}
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-5">Solutions</h4>
              <ul className="space-y-3 mb-8">
                {FOOTER_SOLUTIONS.map(item => (
                  <li key={item}><a href="#showcase" className="text-sm text-slate-500 hover:text-white transition-colors">{item}</a></li>
                ))}
              </ul>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-5">Company</h4>
              <ul className="space-y-3">
                {FOOTER_COMPANY.map(({ label, href }) => (
                  <li key={label}><a href={href} className="text-sm text-slate-500 hover:text-white transition-colors">{label}</a></li>
                ))}
              </ul>
            </div>

            {/* Get in touch */}
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-5">Get in touch</h4>
              <div className="space-y-3 mb-8">
                <a href="mailto:hello@msingi.io"
                  className="flex items-center gap-2.5 text-sm text-slate-500 hover:text-white transition-colors group">
                  <span className="w-8 h-8 rounded-lg bg-slate-800 group-hover:bg-slate-700 flex items-center justify-center flex-shrink-0 text-[11px] font-bold transition-colors">@</span>
                  hello@msingi.io
                </a>
                <a href={WA_URL} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2.5 text-sm text-slate-500 hover:text-white transition-colors group">
                  <span className="w-8 h-8 rounded-lg bg-slate-800 group-hover:bg-[#25D366]/20 flex items-center justify-center flex-shrink-0 transition-colors">
                    <MessageCircle size={13} className="text-[#25D366]" />
                  </span>
                  WhatsApp us
                </a>
              </div>
              <Link to="/contact"
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition-all shadow-lg shadow-indigo-900/40 hover:-translate-y-px">
                Book a Demo <ArrowRight size={13} />
              </Link>
              <div className="mt-6 flex items-start gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800">
                <ShieldCheck size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-slate-600 leading-relaxed">
                  HTTPS · AES-256 encrypted backups · Tenant data isolation · Full audit trail
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-800/60">
          <div className="max-w-7xl mx-auto px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-slate-700">© {new Date().getFullYear()} Msingi. All rights reserved.</p>
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-slate-700">All systems operational</span>
            </div>
            <div className="flex gap-5 text-xs text-slate-700">
              <Link to="/privacy" className="hover:text-slate-400 transition-colors">Privacy Policy</Link>
              <Link to="/terms"   className="hover:text-slate-400 transition-colors">Terms of Service</Link>
            </div>
          </div>
        </div>
      </footer>

      <FloatingActions />
    </div>
  );
}
