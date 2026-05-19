/**
 * Msingi — Plans & Pricing Page
 * Full module comparison table across Core / Standard / Premium / Enterprise
 * CTA at the bottom of each plan column links to the contact/registration flow.
 */
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, Minus, ArrowRight, Zap } from 'lucide-react';

const EASE = [0.16, 1, 0.3, 1];
const fadeUp = {
  hidden:  { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};
const stagger = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.06 } },
};
const VP = { once: true, amount: 0.1 };

/* ── Plan definitions ──────────────────────────────────────────────────────── */
const PLANS = [
  {
    key:      'core',
    name:     'Core',
    tagline:  'Foundation for every school',
    color:    'text-zinc-700',
    ring:     'ring-zinc-200',
    badge:    null,
    cta:      'Get started',
    ctaStyle: 'bg-zinc-900 text-white hover:bg-zinc-700',
  },
  {
    key:      'standard',
    name:     'Standard',
    tagline:  'For growing institutions',
    color:    'text-indigo-700',
    ring:     'ring-indigo-200',
    badge:    null,
    cta:      'Get started',
    ctaStyle: 'bg-indigo-600 text-white hover:bg-indigo-700',
  },
  {
    key:      'premium',
    name:     'Premium',
    tagline:  'Complete school operations',
    color:    'text-violet-700',
    ring:     'ring-violet-300',
    badge:    'Most popular',
    cta:      'Get started',
    ctaStyle: 'bg-violet-600 text-white hover:bg-violet-700',
  },
  {
    key:      'enterprise',
    name:     'Enterprise',
    tagline:  'For large & multi-campus schools',
    color:    'text-emerald-700',
    ring:     'ring-emerald-200',
    badge:    null,
    cta:      'Contact sales',
    ctaStyle: 'bg-emerald-600 text-white hover:bg-emerald-700',
  },
];

/* ── Feature rows — groups + individual features ───────────────────────────
   each feature: { label, plans: Set of plan keys that include it }
   Plans are cumulative: enterprise ⊃ premium ⊃ standard ⊃ core
────────────────────────────────────────────────────────────────────────── */
const all  = new Set(['core','standard','premium','enterprise']);
const std  = new Set(['standard','premium','enterprise']);
const prem = new Set(['premium','enterprise']);
const ent  = new Set(['enterprise']);

const FEATURE_GROUPS = [
  {
    group: 'Student & Academic Management',
    features: [
      { label: 'Student records & profiles',         plans: all  },
      { label: 'Admissions pipeline (enquiry → enrolment)', plans: all  },
      { label: 'Teacher & staff management',         plans: all  },
      { label: 'Class & subject configuration',      plans: all  },
      { label: 'Grade & mark entry',                 plans: all  },
      { label: 'Curriculum & subject management',    plans: all  },
    ],
  },
  {
    group: 'Attendance & Communication',
    features: [
      { label: 'Daily attendance tracking',          plans: all  },
      { label: 'Institutional messaging',            plans: all  },
      { label: 'School events calendar',             plans: all  },
      { label: 'Behaviour & discipline records',     plans: std  },
    ],
  },
  {
    group: 'Academic Infrastructure',
    features: [
      { label: 'Timetable management',               plans: std  },
      { label: 'Examinations management',            plans: std  },
      { label: 'CA / HW / MT / ET assessment tools', plans: std  },
      { label: 'Key stages & houses',                plans: std  },
      { label: 'School sections (KG, Primary, Secondary, A-Level)', plans: std },
      { label: 'Data import & export (Excel / CSV)', plans: std  },
    ],
  },
  {
    group: 'Finance & Reporting',
    features: [
      { label: 'Fee structures & invoicing',         plans: prem },
      { label: 'Payment recording & tracking',       plans: prem },
      { label: 'Financial reports & summaries',      plans: prem },
      { label: 'Report cards & transcripts',         plans: prem },
      { label: 'Multi-stage report approval workflow',plans: prem },
      { label: 'Academic analytics dashboard',       plans: prem },
      { label: 'Custom roles & permissions',         plans: prem },
    ],
  },
  {
    group: 'Enterprise & Scale',
    features: [
      { label: 'REST API access',                    plans: ent  },
      { label: 'Single sign-on (SSO)',               plans: ent  },
      { label: 'Multi-campus management',            plans: ent  },
      { label: 'White-label branding',               plans: ent  },
      { label: 'Advanced analytics & reporting',     plans: ent  },
      { label: 'Priority support & SLA',             plans: ent  },
      { label: 'Dedicated account manager',          plans: ent  },
    ],
  },
];

/* ── Check / dash cell ─────────────────────────────────────────────────── */
function Cell({ included, highlighted }) {
  if (included) {
    return (
      <div className="flex justify-center">
        <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
          highlighted ? 'bg-violet-100' : 'bg-emerald-50'
        }`}>
          <Check size={11} className={highlighted ? 'text-violet-600' : 'text-emerald-600'} strokeWidth={2.5} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-center">
      <Minus size={14} className="text-zinc-300" strokeWidth={1.5} />
    </div>
  );
}

export default function Plans() {
  const navigate = useNavigate();

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, []);

  function handleCTA(planKey) {
    navigate(`/contact?plan=${planKey}`);
  }

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
            <Link to="/plans"   className="font-semibold text-zinc-900 transition-colors">Plans</Link>
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
            Institutional Plans
          </motion.p>
          <motion.h1 variants={fadeUp} className="text-4xl sm:text-5xl font-bold tracking-tighter text-zinc-900 leading-[1.06] mb-5">
            Every school deserves a
            <br /><span className="text-indigo-600">proper digital foundation.</span>
          </motion.h1>
          <motion.p variants={fadeUp} className="text-lg text-zinc-500 max-w-2xl mx-auto leading-relaxed">
            Choose the plan that fits your institution's size and operational needs.
            All plans include the core infrastructure — upgrade when you need more.
          </motion.p>
        </motion.div>
      </section>

      {/* ── PLAN CARDS ── */}
      <section className="max-w-7xl mx-auto px-6 lg:px-8 pb-16">
        <motion.div
          initial="hidden" animate="visible" variants={stagger}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {PLANS.map(({ key, name, tagline, color, ring, badge, cta, ctaStyle }) => (
            <motion.div
              key={key}
              variants={fadeUp}
              className={`relative rounded-2xl bg-white ring-1 ${ring} p-6 flex flex-col ${
                key === 'premium' ? 'shadow-xl shadow-violet-900/10' : 'shadow-sm'
              }`}
            >
              {badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1 text-[10px] font-bold text-white uppercase tracking-widest shadow-sm">
                    <Zap size={9} />
                    {badge}
                  </span>
                </div>
              )}

              <div className="mb-5">
                <h2 className={`text-lg font-bold mb-1 ${color}`}>{name}</h2>
                <p className="text-sm text-zinc-500 leading-snug">{tagline}</p>
              </div>

              <div className="flex-1 mb-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">Includes</p>
                <ul className="space-y-2">
                  {FEATURE_GROUPS.flatMap(g => g.features)
                    .filter(f => f.plans.has(key))
                    .slice(0, 6)
                    .map(f => (
                      <li key={f.label} className="flex items-start gap-2 text-xs text-zinc-600">
                        <Check size={12} className="text-emerald-500 flex-shrink-0 mt-0.5" strokeWidth={2.5} />
                        {f.label}
                      </li>
                    ))}
                  {FEATURE_GROUPS.flatMap(g => g.features).filter(f => f.plans.has(key)).length > 6 && (
                    <li className="text-xs text-zinc-400 pl-5">
                      + {FEATURE_GROUPS.flatMap(g => g.features).filter(f => f.plans.has(key)).length - 6} more features
                    </li>
                  )}
                </ul>
              </div>

              <button
                onClick={() => handleCTA(key)}
                className={`w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all ${ctaStyle}`}
              >
                {cta}
                <ArrowRight size={14} />
              </button>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* ── FULL COMPARISON TABLE ── */}
      <section className="bg-zinc-50 border-y border-zinc-100 py-16">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">

          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger} className="text-center mb-10">
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-3">Full Comparison</motion.p>
            <motion.h2 variants={fadeUp} className="text-2xl font-bold tracking-tight text-zinc-900">
              Module availability by plan
            </motion.h2>
          </motion.div>

          <div className="overflow-x-auto rounded-2xl border border-zinc-200 shadow-sm bg-white">
            <table className="w-full min-w-[640px] border-collapse">

              {/* Header */}
              <thead>
                <tr className="border-b border-zinc-100">
                  <th className="text-left px-6 py-4 text-sm font-semibold text-zinc-500 w-[40%]">Module / Feature</th>
                  {PLANS.map(p => (
                    <th key={p.key} className={`px-4 py-4 text-center text-sm font-bold ${p.color} ${p.key === 'premium' ? 'bg-violet-50/60' : ''}`}>
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>

              {/* Body — grouped rows */}
              <tbody>
                {FEATURE_GROUPS.map((group, gi) => (
                  <>
                    {/* Group header row */}
                    <tr key={`g-${gi}`} className="bg-zinc-50 border-t border-b border-zinc-100">
                      <td colSpan={5} className="px-6 py-2.5 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                        {group.group}
                      </td>
                    </tr>

                    {/* Feature rows */}
                    {group.features.map((feat, fi) => (
                      <tr
                        key={`f-${gi}-${fi}`}
                        className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60 transition-colors"
                      >
                        <td className="px-6 py-3 text-sm text-zinc-700">{feat.label}</td>
                        {PLANS.map(p => (
                          <td key={p.key} className={`px-4 py-3 ${p.key === 'premium' ? 'bg-violet-50/30' : ''}`}>
                            <Cell included={feat.plans.has(p.key)} highlighted={p.key === 'premium'} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                ))}
              </tbody>

              {/* CTA footer row */}
              <tfoot>
                <tr className="border-t-2 border-zinc-100 bg-zinc-50">
                  <td className="px-6 py-5 text-sm font-semibold text-zinc-500">Ready to get started?</td>
                  {PLANS.map(({ key, name, cta, ctaStyle }) => (
                    <td key={key} className={`px-4 py-5 text-center ${key === 'premium' ? 'bg-violet-50/30' : ''}`}>
                      <button
                        onClick={() => handleCTA(key)}
                        className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold transition-all ${ctaStyle}`}
                      >
                        {cta}
                        <ArrowRight size={11} />
                      </button>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Note below table */}
          <p className="text-xs text-zinc-400 text-center mt-5">
            All plans include dedicated school portal, tenant isolation, audit logs, role-based access control, and unlimited users.
            Pricing is institutional — contact us for a quote tailored to your school's size.
          </p>
        </div>
      </section>

      {/* ── BOTTOM CTA ── */}
      <section className="py-20 bg-white text-center">
        <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger} className="max-w-2xl mx-auto px-6">
          <motion.h2 variants={fadeUp} className="text-3xl font-bold tracking-tight text-zinc-900 mb-4">
            Not sure which plan fits?
          </motion.h2>
          <motion.p variants={fadeUp} className="text-base text-zinc-500 mb-8 leading-relaxed">
            Book a guided demo and our team will walk you through every module,
            answer your questions, and recommend the right plan for your institution's needs.
          </motion.p>
          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/contact"
              className="group inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-7 py-3.5 text-sm font-semibold text-white hover:bg-zinc-700 transition-all shadow-lg shadow-zinc-900/15"
            >
              Book a Demo
              <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <Link
              to="/contact?plan=enterprise"
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-7 py-3.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 transition-all"
            >
              Talk to sales
            </Link>
          </motion.div>
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
