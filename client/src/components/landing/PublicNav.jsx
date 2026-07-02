import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X, ChevronDown } from 'lucide-react';
import { EASE } from '@/utils/animations';

const NAV = [
  {
    label: 'Why Msingi',
    href: '/why',
    children: [
      { label: 'Why We Exist',        href: '/why'      },
      { label: 'The Msingi Difference', href: '/difference' },
      { label: 'Why Schools Choose Us', href: '/why-choose' },
      { label: 'Founder Story',        href: '/about'    },
      { label: 'Vision Roadmap',       href: '/roadmap'  },
    ],
  },
  {
    label: 'Platform',
    href: '/platform',
    children: [
      { label: 'Platform Overview',    href: '/platform'        },
      { label: 'For Principals',       href: '/solutions/principal'   },
      { label: 'For Teachers',         href: '/solutions/teacher'     },
      { label: 'For Finance',          href: '/solutions/finance'     },
      { label: 'For Parents',          href: '/solutions/parent'      },
      { label: 'For Admissions',       href: '/solutions/admissions'  },
      { label: 'Implementation',       href: '/implementation'  },
    ],
  },
  { label: 'Pricing',   href: '/pricing'  },
  { label: 'Security',  href: '/security' },
  { label: 'About',     href: '/about'    },
];

export default function PublicNav() {
  const [scrolled,    setScrolled]    = useState(false);
  const [mobileOpen,  setMobileOpen]  = useState(false);
  const [openDropdown, setOpenDropdown] = useState(null);
  const location = useLocation();

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 20);
      if (window.scrollY > 10) setMobileOpen(false);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
    setOpenDropdown(null);
  }, [location.pathname]);

  return (
    <motion.nav
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled || mobileOpen
          ? 'bg-white/96 backdrop-blur-md shadow-sm border-b border-slate-200/60'
          : 'bg-white/80 backdrop-blur-sm'
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 group flex-shrink-0">
          <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center text-white text-[10px] font-bold group-hover:bg-indigo-600 transition-colors">M</div>
          <span className="text-sm font-bold text-slate-900 tracking-tight">Msingi</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden lg:flex items-center gap-1">
          {NAV.map(item => (
            <div key={item.label} className="relative"
              onMouseEnter={() => item.children && setOpenDropdown(item.label)}
              onMouseLeave={() => setOpenDropdown(null)}
            >
              {item.children ? (
                <>
                  <button className="flex items-center gap-1 px-3.5 py-2 rounded-lg text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all">
                    {item.label}
                    <ChevronDown size={13} className={`transition-transform ${openDropdown === item.label ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {openDropdown === item.label && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full left-0 mt-1 w-52 bg-white rounded-xl shadow-lg border border-slate-200/80 py-2 z-50"
                      >
                        {item.children.map(child => (
                          <Link key={child.href} to={child.href}
                            className="block px-4 py-2.5 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors">
                            {child.label}
                          </Link>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </>
              ) : (
                <Link to={item.href}
                  className={`px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                    location.pathname === item.href
                      ? 'text-slate-900 bg-slate-100'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}>
                  {item.label}
                </Link>
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMobileOpen(o => !o)}
            aria-label="Toggle menu"
            className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center text-slate-600 hover:bg-slate-100 transition-colors">
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <Link to="/login"
            className="hidden lg:block px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors">
            Login
          </Link>
          <Link to="/contact"
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-600 transition-all shadow-sm">
            Book a Demo
          </Link>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key="mobile"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="lg:hidden overflow-hidden border-t border-slate-100 bg-white"
          >
            <div className="px-5 py-4 flex flex-col gap-1">
              {NAV.map(item => (
                <div key={item.label}>
                  <Link to={item.href}
                    className="block px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors">
                    {item.label}
                  </Link>
                  {item.children && (
                    <div className="pl-4 mt-0.5 mb-1 space-y-0.5">
                      {item.children.slice(1).map(child => (
                        <Link key={child.href} to={child.href}
                          className="block px-3 py-2 rounded-lg text-sm text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors">
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="h-px bg-slate-100 my-2" />
              <Link to="/login" className="block px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50">Login</Link>
              <Link to="/contact" className="block rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white text-center hover:bg-indigo-600 transition-all">
                Book a Demo
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.nav>
  );
}
