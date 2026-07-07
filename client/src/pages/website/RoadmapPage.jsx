import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2, Clock, Compass } from 'lucide-react';
import { fadeUp, stagger, VP } from '@/utils/animations';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const HORIZONS = [
  {
    label: 'Now — What is live today',
    Icon: CheckCircle2,
    color: 'bg-emerald-500',
    items: [
      'Student management & profiles',
      'Attendance (daily & per-period)',
      'Grades & examinations',
      'Report card generation (CBC, CAIE, IB, custom)',
      'Fee management & M-Pesa Paybill integration',
      'Admissions pipeline (Kanban)',
      'Timetable builder',
      'HR & staff management',
      'Parent & student portals',
      'Behaviour & discipline management',
      'E-learning module',
      'Analytics & reports',
      'Library, Hostel, Transport',
      'Growth profile (digital student portfolio)',
      'Report card signing with SHA-256 & QR verification',
      'RBAC — per-role and per-user permissions',
      'Full audit trail',
    ],
  },
  {
    label: 'Near — Next 12 months',
    Icon: Clock,
    color: 'bg-indigo-500',
    items: [
      'Multi-factor authentication',
      'Parent mobile app (iOS & Android)',
      'AI-assisted report card comments (teacher review required)',
      'Fee collection via M-Pesa STK Push (prompt-to-pay)',
      'Bursary & scholarship management module',
      'Cross-school analytics (for school networks)',
      'SMS notification gateway',
      'Calendar & events integration',
    ],
  },
  {
    label: 'Future — 3-year vision',
    Icon: Compass,
    color: 'bg-slate-500',
    items: [
      'Predictive attendance & early-warning system',
      'National assessment data integration (KNEC)',
      'Multi-school / group school management',
      'Curriculum planning & lesson banking',
      'Alumni & progression tracking',
      'Community & alumni giving portal',
      'Regional expansion: Nigeria, Ghana, South Africa',
    ],
  },
];

const PRINCIPLES = [
  { title: 'Schools before features', desc: 'Every item on this roadmap was requested by a school using Msingi today. We do not build speculatively.' },
  { title: 'Stability before velocity', desc: 'A reliable platform matters more than a fast one. New features ship when they are ready, not when a deadline demands them.' },
  { title: 'Backwards compatibility', desc: 'Schools that depend on Msingi cannot afford breaking changes. We version carefully and communicate far in advance.' },
];

export default function RoadmapPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Vision Roadmap | Msingi</title>
        <meta name="description" content="Where Msingi is going — and why. Current capabilities, near-term plans, and long-term vision for African school management." />
        <link rel="canonical" href="https://msingi.io/roadmap" />
        <meta property="og:title" content="Msingi Vision Roadmap" />
        <meta property="og:url" content="https://msingi.io/roadmap" />
      </Helmet>

      <BreadcrumbSchema items={[{ name: 'Vision Roadmap', href: '/roadmap' }]} />
      <PublicNav />

      <main>
        {/* Hero */}
        <section className="pt-32 pb-20 bg-slate-950">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" animate="visible" variants={stagger(0.08)}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-6">Vision Roadmap</motion.p>
              <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl font-bold tracking-tighter text-white leading-[1.07] mb-6">
                Where Msingi is going —{' '}
                <span className="text-slate-400">and why.</span>
              </motion.h1>
              <motion.p variants={fadeUp} className="text-lg text-slate-400 leading-relaxed max-w-2xl">
                Not a feature list. A direction. Every item here reflects a real school need — past, present, or upcoming.
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* Three horizons */}
        <section className="relative py-20 bg-white border-b border-slate-100 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-100/50 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-6xl mx-auto px-6 lg:px-8">
            <div className="grid lg:grid-cols-3 gap-8">
              {HORIZONS.map(({ label, Icon, color, items }) => (
                <motion.div key={label}
                  initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={VP}
                  transition={{ duration: 0.4 }}
                  className="border border-slate-200 rounded-2xl p-7">
                  <div className="flex items-center gap-2.5 mb-6">
                    <div className={`w-7 h-7 rounded-lg ${color} flex items-center justify-center`}>
                      <Icon size={13} className="text-white" />
                    </div>
                    <h2 className="text-sm font-semibold text-slate-900">{label}</h2>
                  </div>
                  <ul className="space-y-2.5">
                    {items.map(item => (
                      <li key={item} className="flex items-start gap-2.5 text-sm text-slate-600">
                        <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${color}`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Guiding principles */}
        <section className="relative py-20 bg-slate-50 border-b border-slate-100 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 right-1/4 w-96 h-96 bg-indigo-100/60 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-blue-100/50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-10">What guides our decisions.</motion.h2>
              <div className="grid sm:grid-cols-3 gap-6">
                {PRINCIPLES.map(p => (
                  <motion.div key={p.title} variants={fadeUp} className="bg-white border border-slate-200 rounded-xl p-6">
                    <h3 className="font-semibold text-slate-900 mb-2">{p.title}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed">{p.desc}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20 bg-slate-950">
          <div className="max-w-2xl mx-auto px-6 lg:px-8 text-center">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-3xl font-bold text-white mb-4">Shape the roadmap.</motion.h2>
              <motion.p variants={fadeUp} className="text-slate-400 mb-8">Schools that onboard early have direct input into what gets built next.</motion.p>
              <motion.div variants={fadeUp}>
                <Link to="/contact" className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 transition-all">
                  Enquire about early access <ArrowRight size={14} />
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
