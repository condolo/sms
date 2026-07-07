import { Link } from 'react-router-dom';
import { ArrowRight, MessageCircle, ShieldCheck } from 'lucide-react';
import { useWaUrl } from '@/hooks/useWaUrl';

const COLS = [
  {
    heading: 'Product',
    links: [
      { label: 'Platform',          href: '/platform'       },
      { label: 'Pricing',           href: '/pricing'        },
      { label: 'Security',          href: '/security'       },
      { label: 'Implementation',    href: '/implementation' },
      { label: 'Vision Roadmap',    href: '/roadmap'        },
    ],
  },
  {
    heading: 'Solutions',
    links: [
      { label: 'For Principals',    href: '/solutions/principal'  },
      { label: 'For Teachers',      href: '/solutions/teacher'    },
      { label: 'For Finance',       href: '/solutions/finance'    },
      { label: 'For Parents',       href: '/solutions/parent'     },
      { label: 'For Admissions',    href: '/solutions/admissions' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'Why Msingi Exists', href: '/why'         },
      { label: 'Founder Story',     href: '/about'       },
      { label: 'Why Schools Choose Us', href: '/why-choose' },
      { label: 'The Msingi Difference', href: '/difference' },
      { label: 'Knowledge Centre',  href: '/knowledge'   },
      { label: 'Contact',           href: '/contact'     },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy Policy',    href: '/privacy'     },
      { label: 'Terms of Service',  href: '/terms'       },
      { label: 'Data Processing Agreement', href: '/legal/dpa' },
      { label: 'SLA',               href: '/legal/sla'   },
      { label: 'Accessibility',     href: '/legal/accessibility' },
      { label: 'Responsible AI',    href: '/legal/responsible-ai' },
    ],
  },
];

export default function PublicFooter() {
  const waUrl = useWaUrl();
  return (
    <footer className="bg-slate-950 text-slate-400">
      <div className="h-px bg-gradient-to-r from-transparent via-slate-800 to-transparent" />

      <div className="max-w-7xl mx-auto px-6 lg:px-8 pt-16 pb-10">
        <div className="grid md:grid-cols-2 lg:grid-cols-6 gap-10 lg:gap-6 mb-12">

          {/* Brand col — spans 2 */}
          <div className="lg:col-span-2">
            <Link to="/" className="inline-flex items-center gap-2.5 mb-5 group">
              <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white text-sm font-bold shadow-lg group-hover:scale-105 transition-transform">M</div>
              <span className="text-lg font-bold text-white tracking-tight">Msingi</span>
            </Link>
            <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-xs">
              School management built for Africa — attendance, grades, M-Pesa fees, admissions, report cards, and parent portals in one platform.
            </p>

            <div className="space-y-3 mb-6">
              <a href="mailto:support@msingi.io"
                className="flex items-center gap-3 text-sm text-slate-500 hover:text-white transition-colors group">
                <span className="w-8 h-8 rounded-lg bg-slate-800 group-hover:bg-slate-700 flex items-center justify-center text-[11px] font-bold transition-colors">@</span>
                support@msingi.io
              </a>
              <a href={waUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 text-sm text-slate-500 hover:text-white transition-colors group">
                <span className="w-8 h-8 rounded-lg bg-slate-800 group-hover:bg-[#25D366]/20 flex items-center justify-center transition-colors">
                  <MessageCircle size={13} className="text-[#25D366]" />
                </span>
                WhatsApp us
              </a>
            </div>

            <Link to="/contact"
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition-all shadow-lg shadow-indigo-900/40">
              Book a 30-min session <ArrowRight size={13} />
            </Link>

            <div className="mt-6 flex items-start gap-2 p-3 rounded-xl bg-slate-900 border border-slate-800">
              <ShieldCheck size={14} className="text-emerald-500 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-slate-600 leading-relaxed">
                African data residency · AES-256 backups · Tenant isolation · Full audit trail · Kenya DPA 2019
              </p>
            </div>
          </div>

          {/* Link cols */}
          {COLS.map(col => (
            <div key={col.heading}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-5">{col.heading}</p>
              <ul className="space-y-3">
                {col.links.map(link => (
                  <li key={link.href}>
                    <Link to={link.href} className="text-sm text-slate-500 hover:text-white transition-colors">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Partner school notice */}
        <div className="rounded-xl bg-slate-900 border border-slate-800 p-4 mb-8 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold text-emerald-400">Now Live</span>
          </div>
          <p className="text-xs text-slate-500">
            Msingi is live at <span className="text-slate-300 font-medium">Mascit Lab Academy</span> and actively onboarding partner schools for the 2026 academic year.{' '}
            <Link to="/contact" className="text-indigo-400 hover:text-indigo-300 transition-colors">Enquire about early access →</Link>
          </p>
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
            <Link to="/privacy" className="hover:text-slate-400 transition-colors">Privacy</Link>
            <Link to="/terms"   className="hover:text-slate-400 transition-colors">Terms</Link>
            <Link to="/security" className="hover:text-slate-400 transition-colors">Security</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
