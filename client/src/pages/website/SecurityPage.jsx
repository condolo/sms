import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldCheck, Lock, Globe, Server, Eye, FileText, Brain } from 'lucide-react';
import { fadeUp, stagger, VP } from '@/utils/animations';
import PublicNav from '@/components/landing/PublicNav';
import PublicFooter from '@/components/landing/PublicFooter';
import BreadcrumbSchema from '@/components/landing/BreadcrumbSchema';

const PILLARS = [
  {
    Icon: Server,
    title: 'Uptime & reliability',
    points: ['99.9% uptime SLA', 'Automated daily encrypted backups', 'Multi-region infrastructure', 'Defined incident response procedure', 'Transparent status reporting'],
  },
  {
    Icon: Lock,
    title: 'Data governance',
    points: ['Tenant data isolation at database layer', 'African data residency — data stays in Africa', 'Role-based access control (RBAC)', 'Per-user permission overrides', 'Immutable academic records', 'Full, permanent audit log'],
  },
  {
    Icon: Eye,
    title: 'Access control',
    points: ['Granular per-module permissions', 'Server-side RBAC enforcement', 'No client-side permission bypass', 'JWT-based session management', 'Configurable session timeout', 'Multi-factor authentication (roadmap)'],
  },
  {
    Icon: Globe,
    title: 'Compliance',
    points: ['Kenya Data Protection Act 2019', 'Nigeria NDPR', 'South Africa POPIA', 'GDPR (EU data subjects)', 'Data Processing Agreement available', 'Responsible AI statement'],
  },
];

const DOCS = [
  { label: 'Data Processing Agreement', href: '/legal/dpa' },
  { label: 'Service Level Agreement',   href: '/legal/sla' },
  { label: 'Privacy Policy',            href: '/privacy'   },
  { label: 'Terms of Service',          href: '/terms'     },
  { label: 'Responsible AI',            href: '/legal/responsible-ai' },
  { label: 'Accessibility Statement',   href: '/legal/accessibility'  },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <Helmet>
        <title>Security & Trust Centre | Msingi</title>
        <meta name="description" content="Msingi's Trust Centre — uptime SLA, data governance, African data residency, RBAC, compliance (Kenya DPA, NDPR, POPIA, GDPR), and responsible AI." />
        <link rel="canonical" href="https://msingi.io/security" />
        <meta property="og:title" content="Msingi Security & Trust Centre" />
        <meta property="og:url" content="https://msingi.io/security" />
      </Helmet>

      <BreadcrumbSchema items={[{ name: 'Trust Centre', href: '/security' }]} />
      <PublicNav />

      <main>
        {/* Hero */}
        <section className="pt-32 pb-20 bg-slate-950">
          <div className="max-w-4xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" animate="visible" variants={stagger(0.08)}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-6 flex items-center gap-2">
                <ShieldCheck size={12} className="text-emerald-500" /> Trust Centre
              </motion.p>
              <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl lg:text-[54px] font-bold tracking-tighter text-white leading-[1.07] mb-6">
                Security is not a feature.{' '}
                <span className="text-slate-400">It is the foundation.</span>
              </motion.h1>
              <motion.p variants={fadeUp} className="text-lg text-slate-400 leading-relaxed max-w-2xl">
                Your school's data belongs to your school. It always has. It always will. Everything below explains how we protect it.
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* Pillars */}
        <section className="relative py-20 bg-white border-b border-slate-100 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-100/50 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-6xl mx-auto px-6 lg:px-8">
            <div className="grid sm:grid-cols-2 gap-6">
              {PILLARS.map(({ Icon, title, points }) => (
                <motion.div key={title}
                  initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={VP}
                  transition={{ duration: 0.4 }}
                  className="border border-slate-200 rounded-2xl p-7">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center">
                      <Icon size={16} className="text-white" />
                    </div>
                    <h2 className="font-semibold text-slate-900 capitalize">{title}</h2>
                  </div>
                  <ul className="space-y-2.5">
                    {points.map(p => (
                      <li key={p} className="flex items-start gap-2.5 text-sm text-slate-600">
                        <ShieldCheck size={13} className="text-emerald-500 flex-shrink-0 mt-0.5" />
                        {p}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Responsible AI */}
        <section className="relative py-20 bg-slate-50 border-b border-slate-100 overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-0 right-1/4 w-96 h-96 bg-indigo-100/60 rounded-full blur-3xl" />
            <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-blue-100/50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-3xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.div variants={fadeUp} className="flex items-center gap-3 mb-5">
                <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center">
                  <Brain size={16} className="text-white" />
                </div>
                <h2 className="font-semibold text-slate-900">Responsible AI statement</h2>
              </motion.div>
              <motion.div variants={fadeUp} className="space-y-4 text-sm text-slate-600 leading-relaxed">
                <p>Msingi uses AI to assist with specific, bounded tasks: generating draft report card comments, surfacing attendance patterns, and flagging anomalies in fee collection. AI does not make decisions — it makes suggestions that a human reviews before anything is saved or sent.</p>
                <p>No student data is sent to third-party AI providers without explicit school consent. All AI-assisted features can be disabled by the school administrator.</p>
                <p>We do not use student data to train models. We do not build profiles of individual students for purposes other than supporting their education at their school.</p>
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* Legal docs */}
        <section className="relative py-20 bg-white overflow-hidden">
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-indigo-100/50 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-blue-50 rounded-full blur-3xl" />
          </div>
          <div className="relative max-w-3xl mx-auto px-6 lg:px-8">
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.div variants={fadeUp} className="flex items-center gap-3 mb-6">
                <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center">
                  <FileText size={16} className="text-white" />
                </div>
                <h2 className="font-semibold text-slate-900">Legal documentation</h2>
              </motion.div>
              <motion.div variants={fadeUp} className="grid sm:grid-cols-2 gap-3">
                {DOCS.map(doc => (
                  <Link key={doc.href} to={doc.href}
                    className="flex items-center gap-3 p-4 border border-slate-200 rounded-xl hover:border-slate-400 hover:bg-slate-50 transition-all text-sm font-medium text-slate-700">
                    <FileText size={14} className="text-slate-400 flex-shrink-0" />
                    {doc.label}
                  </Link>
                ))}
              </motion.div>
            </motion.div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
