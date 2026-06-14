import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, ChevronRight } from 'lucide-react';
import { PORTAL_TIERS_LANDING } from '@/data/landingData';
import { fadeUp, stagger, VP } from '@/utils/animations';

export default function PlansSection() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section id="plans" className="py-24 sm:py-32 bg-slate-50 border-y border-slate-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">

        <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()} className="text-center mb-14">
          <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Pricing</motion.p>
          <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 mb-4 leading-tight">
            Per student, per term.<br />
            <span className="text-slate-400">Choose who gets a portal.</span>
          </motion.h2>
          <motion.p variants={fadeUp} className="text-base text-slate-500 max-w-xl mx-auto">
            Every tier unlocks the full ERP — all modules, all data, complete audit trail.
            The tier only determines which portals your students and parents can log in to.
          </motion.p>
        </motion.div>

        <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.1)}
          className="grid md:grid-cols-3 gap-5 mb-8">
          {PORTAL_TIERS_LANDING.map((tier) => (
            <motion.div key={tier.name} variants={fadeUp}
              className={`relative rounded-2xl p-7 flex flex-col ${
                tier.dark
                  ? 'bg-slate-900 text-white ring-2 ring-indigo-500 shadow-xl shadow-indigo-500/10'
                  : 'bg-white border border-slate-200 shadow-sm'
              }`}>

              {tier.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-indigo-500 text-white text-[10px] font-bold px-3 py-1 rounded-full tracking-wide uppercase">
                    {tier.badge}
                  </span>
                </div>
              )}

              <div className="mb-4">
                <h3 className={`text-xl font-bold mb-1 ${tier.dark ? 'text-white' : 'text-slate-900'}`}>{tier.name}</h3>
                <p className={`text-sm leading-snug ${tier.dark ? 'text-slate-400' : 'text-slate-500'}`}>{tier.tagline}</p>
              </div>

              <div className="mb-5">
                <span className={`text-4xl font-bold tracking-tight ${tier.dark ? 'text-white' : 'text-slate-900'}`}>
                  KSh {tier.rate}
                </span>
                <span className={`text-sm ml-1.5 ${tier.dark ? 'text-slate-400' : 'text-slate-500'}`}>/ student / term</span>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-5">
                {tier.portals.map(p => (
                  <span key={p} className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    tier.dark ? 'bg-slate-800 text-slate-300' : 'bg-slate-100 text-slate-600'
                  }`}>{p}</span>
                ))}
              </div>

              <ul className="space-y-2 mb-6 flex-1">
                {tier.features.map((f, i) => (
                  <li key={i} className="flex items-center gap-2.5">
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                      tier.dark ? 'bg-indigo-500' : 'bg-slate-900'
                    }`}>
                      <CheckCircle size={9} className="text-white" />
                    </div>
                    <span className={`text-sm ${tier.dark ? 'text-slate-300' : 'text-slate-600'}`}>{f}</span>
                  </li>
                ))}
              </ul>

              <Link to="/contact"
                className={`w-full text-center rounded-xl py-3 text-sm font-semibold transition-all ${
                  tier.dark
                    ? 'bg-indigo-500 text-white hover:bg-indigo-400'
                    : 'bg-slate-900 text-white hover:bg-slate-700'
                }`}>
                {tier.cta} →
              </Link>
            </motion.div>
          ))}
        </motion.div>

        <div className="text-center mb-5">
          <Link to="/plans"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
            Calculate your school cost with the interactive estimator
            <ChevronRight size={14} />
          </Link>
        </div>

        <div className="text-center mb-6">
          <button onClick={() => setExpanded(p => !p)}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors">
            <ChevronRight size={15} className={`transition-transform duration-300 ${expanded ? 'rotate-90' : ''}`} />
            {expanded ? 'Hide setup fee details' : 'View one-time setup fee bands'}
          </button>
        </div>

        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.35 }}
              className="overflow-hidden"
            >
              <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm max-w-2xl mx-auto">
                <h4 className="font-bold text-slate-900 mb-2">One-time setup fee: from KSh 45,000</h4>
                <p className="text-sm text-slate-500 mb-4">
                  Varies by student count and data migration scope.
                  Final amount agreed during the onboarding call.
                </p>
                <div className="grid sm:grid-cols-2 gap-2.5">
                  {[
                    { band: 'Up to 200 students',  fee: 'KSh 45,000' },
                    { band: '201 – 500 students',   fee: 'KSh 50,000' },
                    { band: '501 – 1,000 students', fee: 'KSh 60,000' },
                    { band: 'Over 1,000 students',  fee: 'KSh 75,000' },
                  ].map(({ band, fee }) => (
                    <div key={band} className="flex justify-between items-center bg-slate-50 rounded-xl px-4 py-3 text-sm">
                      <span className="text-slate-600">{band}</span>
                      <span className="font-bold text-slate-900">{fee}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-4">
                  Setup includes data migration, staff training, and full onboarding support.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          className="text-center text-xs text-slate-400 mt-8">
          All tiers include every module · Billed at term start · Tenant data isolation · Role-based access control · Full audit trail
        </motion.p>
      </div>
    </section>
  );
}
