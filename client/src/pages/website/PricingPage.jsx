import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { fadeUp, stagger, VP } from '@/utils/animations';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const TIERS = [
  {
    name: 'Base',
    price: 150,
    desc: 'Full platform for administration and teaching staff.',
    features: [
      'All 22 modules (admin + teacher access)',
      'Attendance, Grades, Finance, Admissions',
      'Report card generation (CBC, CAIE, IB, custom)',
      'M-Pesa Paybill integration',
      'Staff HR management',
      'Timetable builder',
      'Analytics & Reports',
      'Full audit trail',
      'RBAC — role-based access control',
      'Data export (CSV, PDF)',
    ],
    highlight: false,
    cta: 'Book a Demo',
  },
  {
    name: 'Student Portal',
    price: 200,
    desc: 'Adds a branded student portal to the Base plan.',
    features: [
      'Everything in Base',
      'Student self-service portal',
      'Students view timetable, grades, attendance',
      'E-learning module access',
      'Assignment submissions',
      'Digital growth profile',
    ],
    highlight: true,
    cta: 'Book a Demo',
  },
  {
    name: 'Family Portal',
    price: 250,
    desc: 'Adds a parent-facing portal for full family visibility.',
    features: [
      'Everything in Student Portal',
      'Parent portal with live dashboard',
      'Attendance alerts to parents',
      'Fee statements & M-Pesa receipts',
      'Report card delivery to parents',
      'School notices & announcements',
    ],
    highlight: false,
    cta: 'Book a Demo',
  },
];

const FAQS = [
  { q: 'Is pricing per student or per school?', a: 'Per student, per term. A school with 400 students on the Base plan pays KES 60,000 per term.' },
  { q: 'What does "per term" mean if our school runs four terms?', a: 'You are billed at the start of each active term. If your school runs four terms, you pay four times per year.' },
  { q: 'Are there setup or onboarding fees?', a: 'No setup fee. Implementation and data migration are included for all new schools.' },
  { q: 'Can we start on Base and upgrade later?', a: 'Yes. You can upgrade at the start of any term. Your data carries forward — nothing is lost.' },
  { q: 'What happens to our data if we leave?', a: 'Your data belongs to your school. You can export everything at any time in standard formats. We do not hold data hostage.' },
  { q: 'Is there a contract lock-in?', a: 'No long-term contract is required. Schools commit term by term. Most stay because the platform works, not because they have to.' },
];

export default function PricingPage() {
  const [students, setStudents] = useState(400);

  const PRICING_SCHEMA = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Pricing | Msingi — KES 150 per student per term</title>
        <meta name="description" content="Transparent, per-student pricing. KES 150 (Base) / KES 200 (Student Portal) / KES 250 (Family Portal) per student per term. No setup fee. No lock-in." />
        <link rel="canonical" href="https://msingi.io/pricing" />
        <meta property="og:title" content="Msingi Pricing — Transparent, No Surprises" />
        <meta property="og:url" content="https://msingi.io/pricing" />
        <script type="application/ld+json">{JSON.stringify(PRICING_SCHEMA)}</script>
      </Helmet>

      <BreadcrumbSchema items={[{ name: 'Pricing', href: '/pricing' }]} />
      <PublicNav />

      <main>
        {/* Hero */}
        <section className="pt-32 pb-16 bg-slate-50 border-b border-slate-100">
          <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
            <motion.div initial="hidden" animate="visible" variants={stagger(0.08)}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">Pricing</motion.p>
              <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl font-bold tracking-tighter text-slate-900 mb-4">
                Transparent pricing. No surprises. No lock-in.
              </motion.h1>
              <motion.p variants={fadeUp} className="text-lg text-slate-500 leading-relaxed">
                KES 150 per student per term. That is the base price. Everything included in it is listed below.
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* Tier cards */}
        <section className="py-20">
          <div className="max-w-6xl mx-auto px-6 lg:px-8">
            <div className="grid lg:grid-cols-3 gap-6">
              {TIERS.map(tier => (
                <motion.div key={tier.name}
                  initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={VP}
                  transition={{ duration: 0.4 }}
                  className={`rounded-2xl border p-8 flex flex-col ${
                    tier.highlight
                      ? 'border-indigo-300 bg-indigo-50 ring-2 ring-indigo-200'
                      : 'border-slate-200 bg-white'
                  }`}>
                  {tier.highlight && (
                    <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 mb-3">Most popular</p>
                  )}
                  <h2 className="text-xl font-bold text-slate-900 mb-1">{tier.name}</h2>
                  <p className="text-sm text-slate-500 mb-5">{tier.desc}</p>
                  <div className="mb-6">
                    <span className="text-4xl font-bold text-slate-900">KES {tier.price}</span>
                    <span className="text-slate-400 text-sm ml-2">/ student / term</span>
                  </div>
                  <ul className="space-y-3 mb-8 flex-1">
                    {tier.features.map(f => (
                      <li key={f} className="flex items-start gap-2.5 text-sm text-slate-600">
                        <CheckCircle2 size={15} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Link to="/contact"
                    className={`inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-all ${
                      tier.highlight
                        ? 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/25'
                        : 'bg-slate-900 text-white hover:bg-slate-700'
                    }`}>
                    {tier.cta} <ArrowRight size={14} />
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Cost estimator */}
        <section className="py-16 bg-slate-50 border-y border-slate-100">
          <div className="max-w-2xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-2">Estimate your cost</motion.h2>
              <motion.p variants={fadeUp} className="text-slate-500 mb-8 text-sm">Drag to set your student count. Multiply by your number of terms for annual cost.</motion.p>
              <motion.div variants={fadeUp} className="bg-white rounded-2xl border border-slate-200 p-8">
                <div className="mb-6">
                  <div className="flex justify-between items-baseline mb-3">
                    <label className="text-sm font-medium text-slate-700">Students enrolled</label>
                    <span className="text-2xl font-bold text-slate-900">{students.toLocaleString()}</span>
                  </div>
                  <input type="range" min={50} max={3000} step={50} value={students}
                    onChange={e => setStudents(Number(e.target.value))}
                    className="w-full accent-indigo-600" />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>50</span><span>3,000</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-100">
                  {TIERS.map(tier => (
                    <div key={tier.name} className={`rounded-xl p-4 text-center ${tier.highlight ? 'bg-indigo-50 border border-indigo-200' : 'bg-slate-50'}`}>
                      <p className="text-xs font-semibold text-slate-500 mb-1">{tier.name}</p>
                      <p className="text-xl font-bold text-slate-900">KES {(students * tier.price).toLocaleString()}</p>
                      <p className="text-xs text-slate-400 mt-0.5">per term</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-20">
          <div className="max-w-3xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.h2 variants={fadeUp} className="text-2xl font-bold text-slate-900 mb-10">Pricing questions, answered directly.</motion.h2>
              <div className="space-y-6">
                {FAQS.map(({ q, a }, i) => (
                  <motion.div key={i} variants={fadeUp} className="border-b border-slate-200 pb-6 last:border-0">
                    <p className="text-sm font-semibold text-slate-900 mb-2">{q}</p>
                    <p className="text-sm text-slate-500 leading-relaxed">{a}</p>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
