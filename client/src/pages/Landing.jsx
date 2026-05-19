/**
 * Msingi — Landing Page v5.0
 * "The Digital Operating System for Modern Schools"
 *
 * Design language: Enterprise SaaS — Stripe / Linear / Vercel / Ramp
 * Sections: Navbar · Hero + Dashboard Mockup · Pain Points · Trust Band ·
 *           Platform Modules · Academic Records · Infrastructure · CTA · Footer
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity, AlertCircle, ArrowRight, ArrowUp, Award, BarChart3,
  Calendar, CheckCircle, ChevronRight, ClipboardList, DollarSign,
  FileText, GraduationCap, Globe, Layers, Lock, MessageCircle,
  MessageSquare, ShieldCheck, TrendingUp, UserCheck, Users, Zap,
} from 'lucide-react';
import { schoolPortalUrl, storeSchoolSlug } from '@/utils/schoolDetect.js';

/* WhatsApp config */
const WA_NUMBER  = '254769024153';
const WA_MESSAGE = encodeURIComponent('Hello Msingi, I would like to learn more about the platform.');
const WA_URL     = `https://wa.me/${WA_NUMBER}?text=${WA_MESSAGE}`;

/* ─────────────────────────────────────────────────────────────────
   ANIMATION VARIANTS
───────────────────────────────────────────────────────────────── */
const EASE = [0.16, 1, 0.3, 1];

const fadeUp = {
  hidden:  { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.65, ease: EASE } },
};

const fadeIn = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5, ease: 'easeOut' } },
};

const stagger = (delay = 0.09) => ({
  hidden:  {},
  visible: { transition: { staggerChildren: delay } },
});

const VP = { once: true, amount: 0.18 };

/* ─────────────────────────────────────────────────────────────────
   DASHBOARD MOCKUP  — hero visual, built entirely in Tailwind
   Looks like the actual Msingi institutional dashboard in a
   macOS-style browser chrome.
───────────────────────────────────────────────────────────────── */
const SIDEBAR_NAV = [
  { Icon: Activity,      label: 'Dashboard',  active: true  },
  { Icon: Users,         label: 'Students',   active: false },
  { Icon: GraduationCap, label: 'Academics',  active: false },
  { Icon: DollarSign,    label: 'Finance',    active: false },
  { Icon: FileText,      label: 'Reports',    active: false },
  { Icon: MessageSquare, label: 'Messages',   active: false },
];

const KPI_CARDS = [
  { label: 'Total Students',    value: '1,247', delta: '+23 this term',       Icon: Users,        accent: 'text-indigo-600', bg: 'bg-indigo-50'  },
  { label: 'Avg. Attendance',   value: '94.2%', delta: '↑ 2.1% vs last term', Icon: Calendar,     accent: 'text-emerald-600', bg: 'bg-emerald-50' },
  { label: 'Outstanding Fees',  value: 'KSh 284k', delta: '38 invoices open', Icon: DollarSign,   accent: 'text-amber-600',  bg: 'bg-amber-50'   },
  { label: 'Reports Published', value: '3 of 4', delta: '1 in progress',      Icon: FileText,     accent: 'text-violet-600', bg: 'bg-violet-50'  },
];

const YEAR_BARS = [
  { label: 'Year 7',  pct: 87 },
  { label: 'Year 8',  pct: 79 },
  { label: 'Year 9',  pct: 72 },
  { label: 'Year 10', pct: 81 },
  { label: 'Year 11', pct: 76 },
];

const ACTIVITY = [
  { Icon: CheckCircle, accent: 'text-emerald-500', bg: 'bg-emerald-50', text: 'Report card published',  sub: 'Year 7 · Term 2',       time: '2m ago' },
  { Icon: DollarSign,  accent: 'text-indigo-500',  bg: 'bg-indigo-50',  text: 'Fee payment recorded',  sub: 'S. Kimani · KSh 4,500',  time: '8m ago' },
  { Icon: UserCheck,   accent: 'text-violet-500',  bg: 'bg-violet-50',  text: 'Admission enrolled',    sub: 'J. Osei — Year 7A',      time: '1h ago' },
  { Icon: AlertCircle, accent: 'text-amber-500',   bg: 'bg-amber-50',   text: 'Attendance flagged',    sub: 'Class 9B · 82%',         time: '2h ago' },
];

function DashboardMockup() {
  return (
    <div className="rounded-2xl overflow-hidden border border-zinc-200/80 shadow-2xl shadow-zinc-900/10 bg-white select-none pointer-events-none">

      {/* ── Browser chrome ── */}
      <div className="bg-zinc-900 px-4 py-3 flex items-center gap-3">
        <div className="flex gap-1.5">
          <div className="w-3 h-3 rounded-full bg-red-400/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
          <div className="w-3 h-3 rounded-full bg-green-400/80" />
        </div>
        <div className="flex-1 flex justify-center">
          <div className="bg-zinc-800 rounded-md px-5 py-1 text-xs text-zinc-400 font-mono tracking-tight">
            app.msingi.io / dashboard
          </div>
        </div>
        <div className="w-[52px]" />
      </div>

      {/* ── App shell ── */}
      <div className="flex" style={{ height: '420px' }}>

        {/* Sidebar */}
        <div className="w-[54px] bg-zinc-900 flex flex-col items-center py-4 gap-1 flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold mb-3">M</div>
          {SIDEBAR_NAV.map(({ Icon, label, active }) => (
            <div
              key={label}
              title={label}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                active ? 'bg-indigo-600 text-white' : 'text-zinc-500'
              }`}
            >
              <Icon size={15} />
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 bg-zinc-50 flex flex-col overflow-hidden">

          {/* Top bar */}
          <div className="bg-white border-b border-zinc-100 px-5 py-3 flex items-center justify-between flex-shrink-0">
            <div>
              <p className="text-[10px] text-zinc-400 font-medium tracking-wide uppercase">Greenwood Academy</p>
              <p className="text-sm font-semibold text-zinc-800">Dashboard</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-400 bg-zinc-100 rounded px-2 py-1 font-medium">Term 2 · 2025–26</span>
              <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-[10px] font-bold">PM</div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 p-4 overflow-hidden">

            {/* KPI row */}
            <div className="grid grid-cols-4 gap-2.5 mb-4">
              {KPI_CARDS.map(({ label, value, delta, Icon, accent, bg }) => (
                <div key={label} className="bg-white rounded-xl p-3 border border-zinc-100 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-zinc-400 font-medium leading-tight">{label}</span>
                    <div className={`w-5 h-5 rounded-md ${bg} ${accent} flex items-center justify-center flex-shrink-0`}>
                      <Icon size={11} />
                    </div>
                  </div>
                  <p className="text-base font-bold text-zinc-800 leading-none mb-1">{value}</p>
                  <p className="text-[10px] text-zinc-400">{delta}</p>
                </div>
              ))}
            </div>

            {/* Lower grid: chart + activity */}
            <div className="grid grid-cols-3 gap-2.5">

              {/* Academic performance */}
              <div className="col-span-2 bg-white rounded-xl p-4 border border-zinc-100 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-[9px] text-zinc-400 font-medium uppercase tracking-widest mb-0.5">Academic Performance</p>
                    <p className="text-xs font-semibold text-zinc-800">Year Group Summary · Term 2</p>
                  </div>
                  <span className="text-[10px] text-indigo-600 font-medium">View report →</span>
                </div>
                <div className="space-y-2.5">
                  {YEAR_BARS.map(({ label, pct }) => (
                    <div key={label} className="flex items-center gap-3">
                      <span className="text-[10px] text-zinc-500 w-12 font-medium flex-shrink-0">{label}</span>
                      <div className="flex-1 bg-zinc-100 rounded-full h-1.5">
                        <div className="bg-indigo-500 h-1.5 rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] font-semibold text-zinc-600 w-8 text-right flex-shrink-0">{pct}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Activity feed */}
              <div className="bg-white rounded-xl p-4 border border-zinc-100 shadow-sm">
                <p className="text-[9px] text-zinc-400 font-medium uppercase tracking-widest mb-0.5">Recent Activity</p>
                <p className="text-xs font-semibold text-zinc-800 mb-3">Live updates</p>
                <div className="space-y-3">
                  {ACTIVITY.map(({ Icon, accent, bg, text, sub, time }, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className={`w-5 h-5 rounded-md ${bg} ${accent} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <Icon size={10} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-[10px] font-medium text-zinc-700 truncate leading-tight">{text}</p>
                        <p className="text-[10px] text-zinc-400 truncate">{sub}</p>
                        <p className="text-[9px] text-zinc-300 mt-0.5">{time}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   REPORT CARD MOCKUP  — shown in academic records section
───────────────────────────────────────────────────────────────── */
const REPORT_STUDENTS = [
  { name: 'Amara Osei',    avg: '87%', grade: 'A',  status: 'published' },
  { name: 'James Liu',     avg: '79%', grade: 'B+', status: 'published' },
  { name: 'Sofia Mendes',  avg: '72%', grade: 'B',  status: 'published' },
  { name: 'David Kimani',  avg: '91%', grade: 'A+', status: 'published' },
  { name: 'Grace Waweru',  avg: '68%', grade: 'B−', status: 'review'    },
];

const AUDIT_TRAIL = [
  { event: 'Published by Principal Mwangi',           time: 'Today, 09:41'      },
  { event: 'Approved by Deputy Kariuki',               time: 'Today, 09:15'      },
  { event: 'Submitted for review — 28 reports',        time: 'Yesterday, 16:32'  },
];

function ReportCardMockup() {
  return (
    <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl overflow-hidden">
      <div className="bg-zinc-900 px-4 py-2.5 flex items-center gap-2">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/70" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
        </div>
        <span className="text-[10px] text-zinc-500 ml-2 font-mono">Report Cards · Year 7 · Term 2</span>
      </div>

      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <p className="text-[10px] text-zinc-400 uppercase tracking-widest font-medium mb-1">Year 7 · Term 2 · 2025–26</p>
            <p className="text-base font-semibold text-zinc-900">Report Cards</p>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">Published</span>
        </div>

        {/* Student rows */}
        <div className="space-y-1 mb-5">
          {REPORT_STUDENTS.map(({ name, avg, grade, status }) => (
            <div key={name} className="flex items-center justify-between rounded-lg px-3 py-2 hover:bg-zinc-50">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  {name[0]}
                </div>
                <span className="text-sm font-medium text-zinc-800">{name}</span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-sm text-zinc-400">{avg}</span>
                <span className="w-8 text-center text-xs font-bold text-zinc-800 bg-zinc-100 rounded py-0.5">{grade}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                  status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}>
                  {status === 'published' ? '✓ Published' : '⟳ In review'}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Audit trail */}
        <div className="border-t border-zinc-100 pt-4">
          <p className="text-[10px] text-zinc-400 font-medium uppercase tracking-widest mb-2">Audit Trail</p>
          <div className="space-y-2">
            {AUDIT_TRAIL.map(({ event, time }) => (
              <div key={event} className="flex items-start gap-2 text-xs">
                <div className="w-1 h-1 rounded-full bg-zinc-300 mt-1.5 flex-shrink-0" />
                <span className="flex-1 text-zinc-500">{event}</span>
                <span className="text-zinc-300 flex-shrink-0 text-[10px]">{time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   FLOATING ACTIONS  — WhatsApp + scroll-to-top
   Fixed bottom-right, always visible on landing.
───────────────────────────────────────────────────────────────── */
function FloatingActions() {
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    function onScroll() { setShowTop(window.scrollY > 400); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">

      {/* Scroll to top */}
      <AnimatePresence>
        {showTop && (
          <motion.button
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            transition={{ duration: 0.2 }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="Scroll to top"
            className="w-10 h-10 rounded-full bg-white border border-zinc-200 shadow-md flex items-center justify-center text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-all"
          >
            <ArrowUp size={16} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* WhatsApp */}
      <a
        href={WA_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat on WhatsApp"
        className="group flex items-center gap-2.5 rounded-full bg-[#25D366] px-4 py-3 shadow-lg shadow-green-500/30 hover:shadow-xl hover:shadow-green-500/40 transition-all"
      >
        <MessageCircle size={18} className="text-white flex-shrink-0" />
        <span className="text-sm font-semibold text-white pr-1 max-w-0 group-hover:max-w-[120px] overflow-hidden whitespace-nowrap transition-all duration-300 ease-out">
          WhatsApp Support
        </span>
      </a>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   LANDING PAGE
───────────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────────
   SOCIAL ICONS  — inline SVG, no extra dependency
───────────────────────────────────────────────────────────────── */
function XIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/>
    </svg>
  );
}
function LinkedInIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );
}
function FacebookIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  );
}
function InstagramIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
    </svg>
  );
}
function YouTubeIcon({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  );
}

/* Fetch platform social links once */
let _cachedSettings = null;
async function getPlatformSettings() {
  if (_cachedSettings) return _cachedSettings;
  try {
    const res = await fetch('/api/platform/settings');
    if (res.ok) { _cachedSettings = await res.json(); return _cachedSettings; }
  } catch { /* fall through */ }
  return {};
}

/* ─────────────────────────────────────────────────────────────────
   SOCIAL FOOTER ROW — shared between Landing and Contact
───────────────────────────────────────────────────────────────── */
function SocialLinks({ links = {} }) {
  const socials = [
    { key: 'twitter',   Icon: XIcon,         label: 'X / Twitter' },
    { key: 'linkedin',  Icon: LinkedInIcon,  label: 'LinkedIn'    },
    { key: 'facebook',  Icon: FacebookIcon,  label: 'Facebook'    },
    { key: 'instagram', Icon: InstagramIcon, label: 'Instagram'   },
    { key: 'youtube',   Icon: YouTubeIcon,   label: 'YouTube'     },
  ].filter(({ key }) => links[key]);

  if (!socials.length) return null;

  return (
    <div className="flex items-center gap-4">
      {socials.map(({ key, Icon, label }) => (
        <a
          key={key}
          href={links[key]}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          className="text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          <Icon size={16} />
        </a>
      ))}
    </div>
  );
}

export default function Landing() {
  const [schoolInput,   setSchoolInput]   = useState('');
  const [finding,       setFinding]       = useState(false);
  const [findError,     setFindError]     = useState('');
  const [socialLinks,   setSocialLinks]   = useState({});

  useEffect(() => {
    getPlatformSettings().then(s => setSocialLinks(s.socialLinks || {}));
  }, []);

  function goToSchool(slug) {
    storeSchoolSlug(slug);
    window.location.href = schoolPortalUrl(slug);
  }

  async function handleFindSchool(e) {
    e.preventDefault();
    const slug = schoolInput.trim().toLowerCase().replace(/\s+/g, '-');
    if (!slug) return;
    setFinding(true); setFindError('');
    try {
      const res = await fetch(`/api/public/school-info?slug=${slug}`);
      if (!res.ok) {
        setFindError(`No school found for "${slug}". Check the name and try again.`);
        setFinding(false);
        return;
      }
      goToSchool(slug);
    } catch {
      setFindError('Could not connect. Please try again.');
      setFinding(false);
    }
  }

  return (
    <div className="min-h-screen bg-white text-zinc-900 antialiased overflow-x-hidden">

      {/* ══════════════════════════════════════════
          NAVBAR
      ══════════════════════════════════════════ */}
      <motion.nav
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE }}
        className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-zinc-100/80"
      >
        <div className="max-w-7xl mx-auto px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-xs font-bold tracking-tight shadow-sm shadow-indigo-500/30">
              M
            </div>
            <span className="text-[15px] font-bold text-zinc-900 tracking-tight">Msingi</span>
          </div>

          {/* Nav links */}
          <div className="hidden md:flex items-center gap-7 text-sm text-zinc-500">
            <a href="#modules" className="hover:text-zinc-900 transition-colors">Modules</a>
            <Link to="/contact" className="hover:text-zinc-900 transition-colors">Contact</Link>
          </div>

          {/* CTAs */}
          <div className="flex items-center gap-3">
            <Link
              to="/contact"
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 transition-colors shadow-sm"
            >
              Book Demo
            </Link>
          </div>
        </div>
      </motion.nav>

      {/* ══════════════════════════════════════════
          HERO
      ══════════════════════════════════════════ */}
      <section className="max-w-7xl mx-auto px-6 lg:px-8 pt-20 pb-16">

        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: EASE }}
          className="flex justify-center mb-8"
        >
          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-600 shadow-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            The Digital Operating System for Modern Schools
          </div>
        </motion.div>

        {/* Headline block */}
        <motion.div
          initial="hidden"
          animate="visible"
          variants={stagger(0.07)}
          className="text-center max-w-4xl mx-auto"
        >
          <motion.h1
            variants={fadeUp}
            className="text-5xl sm:text-6xl lg:text-[72px] font-bold tracking-tighter text-zinc-900 leading-[1.04] mb-6"
          >
            The Operating System
            <br />
            <span className="text-indigo-600">for Modern Schools.</span>
          </motion.h1>

          <motion.p variants={fadeUp} className="text-lg sm:text-xl text-zinc-500 max-w-2xl mx-auto leading-relaxed mb-3">
            Msingi unifies academics, finance, communication, reporting, and institutional
            workflows into one scalable platform designed for modern schools.
          </motion.p>

          <motion.p variants={fadeUp} className="text-base text-zinc-400 italic mb-10">
            Most school systems digitize tasks. Msingi structures institutions.
          </motion.p>

          {/* CTAs */}
          <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/contact"
              className="group inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-7 py-3.5 text-sm font-semibold text-white hover:bg-zinc-700 transition-all shadow-lg shadow-zinc-900/20"
            >
              Book a Demo
              <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
            </Link>
            <button
              onClick={() => goToSchool('innolearn')}
              className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-7 py-3.5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 transition-all"
            >
              Explore the Platform
              <ChevronRight size={15} className="text-zinc-400" />
            </button>
          </motion.div>
        </motion.div>

        {/* ── Dashboard Mockup ── */}
        <motion.div
          initial={{ opacity: 0, y: 48, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.25, ease: EASE }}
          className="mt-16 relative"
        >
          {/* Ambient glow */}
          <div className="absolute -inset-x-4 top-0 h-40 bg-gradient-to-b from-indigo-50/50 via-white/0 to-transparent -z-10" />
          <DashboardMockup />
        </motion.div>
      </section>

      {/* ══════════════════════════════════════════
          PAIN POINTS → TRANSFORMATION
      ══════════════════════════════════════════ */}
      <section className="py-24 sm:py-32 bg-zinc-50 border-y border-zinc-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">

          <motion.div
            initial="hidden" whileInView="visible" viewport={VP} variants={fadeUp}
            className="text-center mb-16"
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-4">The Problem</p>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 leading-tight">
              Schools are running on
              <br />
              <span className="text-zinc-400">disconnected infrastructure.</span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-10 lg:gap-20 items-start">

            {/* Problems */}
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-7">Today's reality</p>
              {[
                {
                  label: 'Fragmented systems everywhere',
                  desc:  'Fee software, attendance registers, grade spreadsheets, and report tools — all disconnected, all requiring manual reconciliation.',
                },
                {
                  label: 'Everything done manually',
                  desc:  'Report cards assembled by hand. Attendance compiled from paper registers. Fees tracked in Excel. Admissions managed via WhatsApp.',
                },
                {
                  label: 'Zero institutional visibility',
                  desc:  'No real-time view of student progress, financial health, or operational performance. Decisions made on outdated information.',
                },
                {
                  label: 'Workflow chaos',
                  desc:  'Approval chains, admission pipelines, and staff workflows routed through email and messaging apps — with no accountability trail.',
                },
                {
                  label: 'No audit infrastructure',
                  desc:  'No version control on grades. No governance on report changes. No log of who did what, when — just institutional trust with no verification.',
                },
              ].map(({ label, desc }, i) => (
                <motion.div key={i} variants={fadeUp} className="flex gap-4 mb-7">
                  <div className="w-5 h-5 rounded-full border-2 border-zinc-300 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-zinc-800 mb-1">{label}</p>
                    <p className="text-sm text-zinc-500 leading-relaxed">{desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>

            {/* Resolution */}
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <p className="text-xs font-semibold text-indigo-600 uppercase tracking-widest mb-7">With Msingi</p>
              {[
                {
                  label: 'One unified operational platform',
                  desc:  'Academics, finance, communication, HR, and reporting all connected — one data layer, one login, one source of institutional truth.',
                },
                {
                  label: 'Automated institutional workflows',
                  desc:  'Report generation, fee invoicing, admissions tracking, and timetabling run with precision — no manual assembly required.',
                },
                {
                  label: 'Real-time operational visibility',
                  desc:  'Directors see attendance, finances, and academic performance in a live dashboard. Decisions made on current data.',
                },
                {
                  label: 'Structured process architecture',
                  desc:  'Role-based workflows, approval chains, and escalation paths are built into the platform — not bolted on via email.',
                },
                {
                  label: 'Immutable audit infrastructure',
                  desc:  'Every action logged. Every record versioned. Every grade traceable. Built for institutional accountability from the ground up.',
                },
              ].map(({ label, desc }, i) => (
                <motion.div key={i} variants={fadeUp} className="flex gap-4 mb-7">
                  <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm shadow-indigo-300">
                    <CheckCircle size={10} className="text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-800 mb-1">{label}</p>
                    <p className="text-sm text-zinc-500 leading-relaxed">{desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          TRUST BAND
      ══════════════════════════════════════════ */}
      <section className="py-14 bg-white border-b border-zinc-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-zinc-400 mb-8">
            Built for modern schools that require operational clarity and institutional accountability
          </p>
          <div className="flex flex-wrap items-center justify-center gap-8 lg:gap-14">
            {['Greenwood Academy', 'Sunrise School', 'TestSync Academy', 'MLA', 'Westbrook College', 'Horizon Institute'].map((name) => (
              <span key={name} className="text-zinc-300 font-bold text-sm tracking-widest uppercase select-none">
                {name}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          PLATFORM MODULES GRID
      ══════════════════════════════════════════ */}
      <section id="modules" className="py-24 sm:py-32 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">

          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
            <motion.div variants={fadeUp}>
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-4">Platform</p>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 max-w-xl mb-16 leading-tight">
                Every dimension of school
                <br />operations. In one platform.
              </h2>
            </motion.div>

            <motion.div
              initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.07)}
              className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {[
                {
                  Icon:  GraduationCap,
                  label: 'Academics',
                  title: 'Institutional-grade academic infrastructure.',
                  desc:  'Multi-curriculum grading (CBC, Cambridge, IB, custom), subject management, year group configuration, and academic history — built for how schools actually teach.',
                  accent: 'text-indigo-600', bg: 'bg-indigo-50',
                },
                {
                  Icon:  DollarSign,
                  label: 'Finance',
                  title: 'Complete financial control and visibility.',
                  desc:  'Fee structures, invoice generation, payment recording, and financial reporting. Know exactly where every shilling stands — in real time.',
                  accent: 'text-emerald-600', bg: 'bg-emerald-50',
                },
                {
                  Icon:  ClipboardList,
                  label: 'Admissions',
                  title: 'Structured intake, enquiry to enrolment.',
                  desc:  'Full pipeline management across enquiry, assessment, offer, and enrolment stages — with automatic student record creation on admission.',
                  accent: 'text-violet-600', bg: 'bg-violet-50',
                },
                {
                  Icon:  MessageSquare,
                  label: 'Communication',
                  title: 'Unified, accountable institutional messaging.',
                  desc:  'Role-based messaging between staff, parents, and students. Announcements, direct messages, and notifications — all in one auditable channel.',
                  accent: 'text-sky-600', bg: 'bg-sky-50',
                },
                {
                  Icon:  BarChart3,
                  label: 'Reporting',
                  title: 'Reports that reflect institutional truth.',
                  desc:  'Structured report card generation with grading, moderation, multi-stage approval workflows, and publication history. Designed for academic integrity.',
                  accent: 'text-amber-600', bg: 'bg-amber-50',
                },
                {
                  Icon:  TrendingUp,
                  label: 'Analytics',
                  title: 'Operational intelligence for school leadership.',
                  desc:  'Real-time dashboards for attendance trends, academic performance, financial health, and institutional KPIs — built for directors, not spreadsheet operators.',
                  accent: 'text-rose-600', bg: 'bg-rose-50',
                },
              ].map(({ Icon, label, title, desc, accent, bg }, i) => (
                <motion.div
                  key={i}
                  variants={fadeUp}
                  className="group rounded-2xl border border-zinc-100 bg-white p-7 hover:border-zinc-200 hover:shadow-lg hover:shadow-zinc-900/5 transition-all duration-300 cursor-default"
                >
                  <div className={`w-9 h-9 rounded-xl ${bg} ${accent} flex items-center justify-center mb-5 shadow-sm`}>
                    <Icon size={18} />
                  </div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-2">{label}</p>
                  <h3 className="text-[15px] font-semibold text-zinc-900 mb-3 leading-snug">{title}</h3>
                  <p className="text-sm text-zinc-500 leading-relaxed">{desc}</p>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          ACADEMIC RECORDS & TRUST
      ══════════════════════════════════════════ */}
      <section className="py-24 sm:py-32 bg-zinc-50 border-y border-zinc-100">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 xl:gap-24 items-center">

            {/* Copy */}
            <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
              <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-4">
                Academic Integrity
              </motion.p>
              <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 mb-6 leading-tight">
                Academic records that
                <br />institutions can trust.
              </motion.h2>
              <motion.p variants={fadeUp} className="text-base text-zinc-500 leading-relaxed mb-10">
                Msingi treats academic records as legally sensitive institutional data.
                Every grade entry, report card publication, and mark modification is
                logged, versioned, and attributable — building the audit infrastructure
                modern schools require.
              </motion.p>

              {[
                { Icon: ShieldCheck, title: 'Immutable grade records',       desc: 'Marks can be corrected with full audit trail — no silent overwrites, no data loss, no ambiguity.' },
                { Icon: FileText,    title: 'Structured report workflows',   desc: 'Teacher entry → HOD review → moderation → principal approval → publication. Enforced by the platform.' },
                { Icon: Lock,        title: 'Role-based academic access',    desc: 'Teachers see their classes. Heads see their departments. Principals see everything. Enforced server-side.' },
                { Icon: Award,       title: 'Historical transcript safety',  desc: 'Academic records are archived per term and year — never modified after publication. Transcripts stay true.' },
              ].map(({ Icon, title, desc }, i) => (
                <motion.div key={i} variants={fadeUp} className="flex gap-4 mb-6">
                  <div className="w-8 h-8 rounded-lg bg-white border border-zinc-200 flex items-center justify-center flex-shrink-0 shadow-sm">
                    <Icon size={14} className="text-zinc-600" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-zinc-800 mb-1">{title}</p>
                    <p className="text-sm text-zinc-500 leading-relaxed">{desc}</p>
                  </div>
                </motion.div>
              ))}
            </motion.div>

            {/* Report card mockup */}
            <motion.div
              initial={{ opacity: 0, x: 32 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={VP}
              transition={{ duration: 0.7, ease: EASE }}
            >
              <ReportCardMockup />
            </motion.div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          INFRASTRUCTURE / SECURITY  (dark section)
      ══════════════════════════════════════════ */}
      <section className="py-24 sm:py-32 bg-zinc-950">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">

          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
            <motion.p variants={fadeUp} className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">
              Infrastructure
            </motion.p>
            <motion.h2 variants={fadeUp} className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-4 leading-tight">
              Enterprise-grade infrastructure.
              <br />
              <span className="text-zinc-500">Not a startup experiment.</span>
            </motion.h2>
            <motion.p variants={fadeUp} className="text-base text-zinc-400 max-w-2xl mb-16 leading-relaxed">
              Msingi is built to carry the operational weight of real institutions — with the
              security, isolation, and reliability that school owners and directors require
              before trusting their data to any platform.
            </motion.p>

            <motion.div
              initial="hidden" whileInView="visible" viewport={VP} variants={stagger(0.07)}
              className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {[
                { Icon: Layers,      title: 'Full tenant isolation',           desc: "Every school's data is completely isolated. No cross-tenant access, no data bleed — ever." },
                { Icon: ShieldCheck, title: 'Role-based access control',       desc: 'Granular, per-module permissions enforced at the API layer — not just hidden in the UI.' },
                { Icon: Lock,        title: 'Immutable audit logs',            desc: 'Every login, grade entry, payment, and deletion is permanently logged and traceable.' },
                { Icon: Activity,    title: 'Cloud infrastructure',            desc: 'Hosted on enterprise cloud with automated backups, zero-downtime deployments, and global uptime.' },
                { Icon: Zap,         title: 'Built to scale',                  desc: 'From 100 to 5,000 students — Msingi scales without reconfiguration, re-setup, or migration.' },
                { Icon: Globe,       title: 'Multi-curriculum, multi-context', desc: 'CBC, Cambridge, IB, British, American, and fully custom grading frameworks — all supported natively.' },
              ].map(({ Icon, title, desc }, i) => (
                <motion.div
                  key={i}
                  variants={fadeUp}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 hover:border-zinc-700 hover:bg-zinc-900 transition-all duration-300 cursor-default"
                >
                  <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center mb-4">
                    <Icon size={15} className="text-zinc-400" />
                  </div>
                  <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
                  <p className="text-sm text-zinc-500 leading-relaxed">{desc}</p>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FINAL CTA
      ══════════════════════════════════════════ */}
      <section className="py-24 sm:py-32 bg-white">
        <div className="max-w-3xl mx-auto px-6 lg:px-8 text-center">
          <motion.div initial="hidden" whileInView="visible" viewport={VP} variants={stagger()}>
            <motion.h2
              variants={fadeUp}
              className="text-4xl sm:text-5xl lg:text-[56px] font-bold tracking-tighter text-zinc-900 leading-[1.05] mb-6"
            >
              Build a smarter school
              <br />infrastructure.
            </motion.h2>
            <motion.p variants={fadeUp} className="text-lg text-zinc-500 max-w-xl mx-auto mb-10 leading-relaxed">
              Move beyond fragmented systems and manage your institution from one
              connected operational platform.
            </motion.p>
            <motion.div variants={fadeUp} className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/contact"
                className="group inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-8 py-4 text-sm font-semibold text-white hover:bg-zinc-700 transition-all shadow-xl shadow-zinc-900/15"
              >
                Book a Demo
                <ArrowRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <button
                onClick={() => goToSchool('innolearn')}
                className="inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-8 py-4 text-sm font-semibold text-zinc-600 hover:bg-zinc-50 transition-all"
              >
                Explore the platform
                <ChevronRight size={15} className="text-zinc-400" />
              </button>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FIND SCHOOL
      ══════════════════════════════════════════ */}
      <section id="find-school" className="bg-zinc-50 border-t border-zinc-100 py-14">
        <div className="max-w-md mx-auto px-6 text-center">
          <p className="text-sm font-semibold text-zinc-800 mb-1">Already have a school account?</p>
          <p className="text-xs text-zinc-400 mb-5">Enter your school name to go to your dedicated portal.</p>
          <form onSubmit={handleFindSchool} className="flex gap-2">
            <input
              type="text"
              value={schoolInput}
              onChange={(e) => { setSchoolInput(e.target.value); setFindError(''); }}
              placeholder="e.g. greenwood-academy"
              className="flex-1 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/20 transition shadow-sm"
            />
            <button
              type="submit"
              disabled={finding || !schoolInput.trim()}
              className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-40 transition-colors"
            >
              {finding ? '…' : 'Go'}
            </button>
          </form>
          {findError && <p className="mt-3 text-xs text-red-500">{findError}</p>}
        </div>
      </section>

      {/* ══════════════════════════════════════════
          FOOTER
      ══════════════════════════════════════════ */}
      <footer className="border-t border-zinc-100 py-10 bg-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-5">
            {/* Brand */}
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">M</div>
              <span className="text-sm font-bold text-zinc-900">Msingi</span>
              <span className="text-xs text-zinc-400 ml-1">· The School Operating System</span>
            </div>

            {/* Social icons */}
            <SocialLinks links={socialLinks} />

            {/* Links */}
            <div className="flex gap-5 text-xs text-zinc-400">
              <a href="mailto:hello@msingi.io" className="hover:text-zinc-700 transition-colors">hello@msingi.io</a>
              <Link to="/contact" className="hover:text-zinc-700 transition-colors">Contact</Link>
              {/* Platform admin — discreet, footer-only */}
              <a href="/platform" className="hover:text-zinc-700 transition-colors opacity-40 hover:opacity-70">⚙</a>
            </div>
          </div>
          <p className="text-xs text-zinc-400 text-center mt-6">© {new Date().getFullYear()} Msingi. All rights reserved.</p>
        </div>
      </footer>

      {/* ══════════════════════════════════════════
          FLOATING ACTIONS  (WhatsApp + scroll top)
      ══════════════════════════════════════════ */}
      <FloatingActions />
    </div>
  );
}
