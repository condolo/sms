/**
 * Parent Portal Dashboard
 * Layout: Sidebar + Main, with real per-page navigation — each sidebar
 * item renders its own focused page (not an anchor-scroll within one
 * long page, which read as "nothing happens" when clicked). Overview is
 * a condensed at-a-glance summary; every other item is the full section.
 *
 * Sidebar brand (name/logo/badge colour) and every avatar/button accent
 * inherit the signed-in parent's own school via session.school +
 * useSchoolTheme — same pattern as the admin Sidebar.jsx, not hardcoded
 * to one school's colours. Semantic status colours (success/warning/
 * error on fee/attendance/exam badges) are intentionally untouched —
 * those encode meaning, not brand.
 *
 * Nav items are gated by the school's own moduleConfig (Settings →
 * Modules) via buildModuleConfigMap, same source of truth the admin
 * Sidebar.jsx reads — a module the school has turned off (or never
 * enabled) simply doesn't show here either, instead of a fixed list
 * every school sees regardless of what they've actually configured.
 *
 * Sidebar collapses to an icon rail on desktop (localStorage-persisted,
 * same convention as AppShell.jsx's admin sidebar) and becomes an
 * off-canvas drawer below the lg breakpoint.
 *
 * Data: all fetched from /api/parent-portal/* (unchanged).
 */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '@/store/auth.js';
import { useSchoolTheme } from '@/hooks/useSchoolTheme.js';
import { buildModuleConfigMap } from '@/config/moduleNav.js';
import {
  Activity, AlertCircle, Bell, BookCheck, Calendar,
  CheckCircle, Download, FileText, GraduationCap,
  Lock, LogOut, MessageSquare, Send, Star, Wallet,
  ChevronDown, ChevronLeft, ChevronRight, MonitorPlay, MapPin, BookOpen, CalendarCheck,
  Menu, X, TrendingUp, LifeBuoy, KeyRound, Eye, EyeOff, Loader2,
} from 'lucide-react';
import NotificationBell from '@/components/layout/NotificationBell.jsx';
import FloatingHelp from '@/components/help/FloatingHelp.jsx';
import MessagesPanel from './components/MessagesPanel.jsx';
import { messages as messagesApi, parentMessaging, auth as authApi } from '@/api/client.js';

/* ── API helpers ────────────────────────────────────────────────── */
const API_BASE = import.meta.env.VITE_API_BASE || '';
async function _fetch(path) {
  const res  = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  const json = await res.json();
  if (res.status === 401) {
    const err = new Error(json.error?.message || 'Session expired — please sign in again');
    err.code = 'auth_expired';
    throw err;
  }
  /* A 403 is not an expired session. Portal access can be blocked for
     reasons the parent/student must simply see (e.g. account unavailability
     after a lapsed subscription) — logging them out here hid that message
     and dropped them on the school-search screen. */
  if (res.status === 403) {
    const err = new Error(json.error?.message || 'Unable to access this account. Please contact your school administrator.');
    err.code = json.error?.code || 'forbidden';
    throw err;
  }
  if (!json.success) throw new Error(json.error?.message || 'Request failed');
  return json.data;
}
async function _downloadRC(rcId, label) {
  const res = await fetch(`${API_BASE}/api/report-cards/${rcId}/pdf`, { credentials: 'include' });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Download failed'); }
  const blob = await res.blob();
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `report-${label}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}
async function _downloadSnapshot(childId, weekStart, label) {
  const res = await fetch(`${API_BASE}/api/parent-portal/weekly-snapshot/${childId}/${weekStart}/pdf`, { credentials: 'include' });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Download failed'); }
  const blob = await res.blob();
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `weekly-snapshot-${label}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Pure helpers ───────────────────────────────────────────────── */
function _greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
function _fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function _weekday(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short' });
}
function _daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86_400_000);
}
function _timeToMins(t = '') {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function _nowMins() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}
function _initials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 2) || '??';
}

/* ── Sidebar nav definitions — `module` keys into the school's own
   moduleConfig (Settings → Modules). null = always shown (core, not a
   toggleable feature). ── */
const MY_CHILD_NAV = [
  { id: 'overview',   label: 'Overview',         Icon: CheckCircle, module: null },
  { id: 'grades',     label: 'Grades & Reports',  Icon: BookCheck,   module: 'grades' },
  { id: 'attendance', label: 'Attendance',        Icon: Activity,    module: 'attendance' },
  { id: 'fees',       label: 'Fee Statements',    Icon: Wallet,      module: 'finance' },
  { id: 'timetable',  label: 'Timetable',         Icon: Calendar,    module: 'timetable' },
  { id: 'library',    label: 'Library',           Icon: BookOpen,    module: 'library' },
];
const SCHOOL_NAV = [
  { id: 'messages',      label: 'Messages',            Icon: MessageSquare, module: 'messages' },
  { id: 'calendar',      label: 'School Calendar',     Icon: CalendarCheck, module: 'events' },
  { id: 'behaviour',     label: 'Behaviour & Rewards',  Icon: Star,          module: 'behaviour' },
  { id: 'announcements', label: 'Announcements',       Icon: Bell,          module: null },
];

/* ── Grade progress bar ─────────────────────────────────────────── */
function GradeBar({ id, label, pct, delay = 0 }) {
  const bar  = pct >= 80 ? 'bg-indigo-500' : pct >= 60 ? 'bg-indigo-400' : 'bg-amber-400';
  const text = pct >= 80 ? 'text-indigo-600' : pct >= 60 ? 'text-indigo-500' : 'text-amber-500';
  return (
    <div id={id}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] text-slate-600">{label}</span>
        <span className={`text-[12px] font-bold ${text}`}>{pct}%</span>
      </div>
      <div className="h-[7px] bg-slate-100 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${bar}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, delay, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

/* ── Behaviour badge ────────────────────────────────────────────── */
function BehaviourBadge({ level }) {
  if (!level) return null;
  const map = {
    gold:   ['🥇', 'text-amber-600',  'bg-amber-50',  'border-amber-200' ],
    silver: ['🥈', 'text-slate-500',  'bg-slate-50',  'border-slate-200' ],
    bronze: ['🥉', 'text-orange-500', 'bg-orange-50', 'border-orange-200'],
  };
  const [icon, tc, bg, bc] = map[level] ?? map.bronze;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${bg} ${tc} ${bc}`}>
      {icon} {level.charAt(0).toUpperCase() + level.slice(1)} Badge
    </span>
  );
}

/* ── Section card shell — every full page body is one or more of these ── */
function Card({ id, children, className = '' }) {
  return (
    <div id={id} className={`bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  );
}
function CardHeader({ icon: Icon, iconClass, title, right }) {
  return (
    <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {Icon && <Icon size={14} className={`flex-shrink-0 ${iconClass ?? 'text-slate-400'}`} />}
        <h2 className="text-[13px] font-bold text-slate-900 truncate">{title}</h2>
      </div>
      {right}
    </div>
  );
}

/* ── Overview quick-stat card — teaser into a full page ──────────── */
function QuickStat({ icon: Icon, label, value, valueColor, onClick, iconBg, iconColor }) {
  return (
    <button
      onClick={onClick}
      className="bg-white rounded-[10px] border border-slate-200 shadow-sm p-[14px] text-left hover:border-slate-300 hover:shadow transition flex items-center gap-3"
    >
      <div className={`w-9 h-9 rounded-[9px] flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        <Icon size={16} className={iconColor} />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.04em] truncate">{label}</div>
        <div className={`text-[17px] font-extrabold leading-tight ${valueColor ?? 'text-slate-900'}`}>{value}</div>
      </div>
    </button>
  );
}

/* ── Compose modal — recipients are a server-resolved category list,
   never a free-text address. The category options never include
   another parent, guardian, or student — see
   server/utils/parent-message-recipients.js for how each option is
   actually resolved.

   Hoisted to a top-level component (was a function nested inside
   ParentDashboard's own body) — reported directly: typing in the
   Subject/Message fields lost focus after every character, forcing a
   re-click before the next one. A function component defined inside
   another component's render gets a brand-new identity on every
   render; since every keystroke here called setComposeForm (state
   that lives in ParentDashboard), each keystroke re-rendered
   ParentDashboard, which redefined this function fresh, so React saw
   a different component type and unmounted+remounted the whole modal
   — destroying and recreating the <input>/<textarea> DOM nodes, which
   is what drops focus. Same fix already applied to MessagesPanel. ── */
function ComposeMessageModal({ open, mode, sent, recipientOptions, form, onFormChange, error, sending, onClose, onSend, primary }) {
  if (!open) return null;
  return (
    <AnimatePresence>
      <motion.div key="compose-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <motion.div key="compose-dialog" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">{mode === 'reply' ? 'Reply' : 'New Message'}</h3>
            <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
              <X size={16} />
            </button>
          </div>

          {sent ? (
            <div className="px-5 py-8 text-center">
              <CheckCircle size={28} className="text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-medium text-slate-800">Message sent</p>
              <button onClick={onClose} className="mt-4 text-[12px] font-semibold px-4 py-2 rounded-lg text-white" style={{ background: primary }}>
                Done
              </button>
            </div>
          ) : (
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">To</label>
                {mode === 'reply' && (
                  <p className="text-[11px] text-slate-400 mt-0.5">Choose who should receive your reply — the school decides who is reachable for your child.</p>
                )}
                {recipientOptions === null ? (
                  <div className="h-9 rounded-lg bg-slate-100 animate-pulse mt-1" />
                ) : recipientOptions.length === 0 ? (
                  <p className="text-[12px] text-slate-400 mt-1">No one is set up to receive messages for this child yet — contact the school office directly.</p>
                ) : (
                  <select
                    className="w-full mt-1 text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1"
                    value={form.category}
                    onChange={e => onFormChange(f => ({ ...f, category: e.target.value }))}
                  >
                    <option value="">Select who to message…</option>
                    {recipientOptions.map(opt => (
                      <option key={opt.key} value={opt.key}>{opt.label}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Subject</label>
                <input
                  className="w-full mt-1 text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1"
                  value={form.subject}
                  onChange={e => onFormChange(f => ({ ...f, subject: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Message</label>
                <textarea
                  rows={4}
                  className="w-full mt-1 text-[13px] border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1"
                  value={form.body}
                  onChange={e => onFormChange(f => ({ ...f, body: e.target.value }))}
                />
              </div>
              {error && <p className="text-[12px] text-red-600">{error}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={onClose} className="text-[12px] font-medium text-slate-500 px-3 py-2 rounded-lg hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={onSend}
                  disabled={sending || recipientOptions === null || recipientOptions.length === 0}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-white px-4 py-2 rounded-lg disabled:opacity-50"
                  style={{ background: primary }}
                >
                  <Send size={12} /> {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/* Reported directly 2026-10-28: "parents dont have that clickable
   profile to update or change their password" — the self-service
   POST /api/auth/change-password route already works for any
   authenticated role (confirmed: no role check at all in that route,
   just authMiddleware scoped to the caller's own userId/schoolId), and
   the staff-facing ProfilePage.jsx already has a form calling it —
   there was simply no equivalent anywhere in either portal shell, since
   neither has a /profile page at all (they're separate top-level routes,
   /parent-dashboard and /student-dashboard, with no nested "profile"
   route under them). A self-contained modal, not a new page, for the
   same reason ComposeMessageModal above is one: no portal-wide "second
   page" concept to hook into.

   Hoisted to a top-level component for the exact reason documented on
   ComposeMessageModal above — a function defined inside the main
   component's body gets a new identity every render, which would
   unmount/remount this modal (dropping input focus) on every keystroke. */
function ChangePasswordModal({ open, currentPw, newPw, confirmPw, onCurrentChange, onNewChange, onConfirmChange, showPws, onToggleShow, banner, saving, onClose, onSubmit, primary }) {
  if (!open) return null;
  return (
    <AnimatePresence>
      <motion.div key="pw-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <motion.div key="pw-dialog" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <KeyRound size={14} className="text-slate-400" /> Change Password
            </h3>
            <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
              <X size={16} />
            </button>
          </div>

          <form onSubmit={onSubmit} className="px-5 py-4 space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Current password</label>
              <input
                type={showPws ? 'text' : 'password'} autoComplete="current-password" autoFocus
                className="w-full mt-1 text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1"
                value={currentPw} onChange={e => onCurrentChange(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">New password</label>
              <input
                type={showPws ? 'text' : 'password'} autoComplete="new-password"
                className="w-full mt-1 text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1"
                value={newPw} onChange={e => onNewChange(e.target.value)}
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Confirm new password</label>
              <input
                type={showPws ? 'text' : 'password'} autoComplete="new-password"
                className="w-full mt-1 text-[13px] border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1"
                value={confirmPw} onChange={e => onConfirmChange(e.target.value)}
              />
            </div>
            <button type="button" onClick={onToggleShow} className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-slate-600">
              {showPws ? <EyeOff size={12} /> : <Eye size={12} />} {showPws ? 'Hide' : 'Show'} passwords
            </button>

            {banner?.msg && (
              <p className={`text-[12px] ${banner.type === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>{banner.msg}</p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="text-[12px] font-medium text-slate-500 px-3 py-2 rounded-lg hover:bg-slate-50">
                Cancel
              </button>
              <button
                type="submit" disabled={saving}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-white px-4 py-2 rounded-lg disabled:opacity-50"
                style={{ background: primary }}
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />} {saving ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </form>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/* ══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════════ */
export default function ParentDashboard() {
  const navigate = useNavigate();
  const logout   = useAuthStore(s => s.logout);
  const session  = useAuthStore(s => s.session);
  const mainRef  = useRef(null);

  const [children,      setChildren]      = useState([]);
  const [activeChildId, setActiveChildId] = useState(null);
  const [childData,     setChildData]     = useState(null);
  const [familySummary, setFamilySummary] = useState(null);
  const [loadingList,   setLoadingList]   = useState(true);
  const [loadingChild,  setLoadingChild]  = useState(false);
  const [downloading,   setDownloading]   = useState(null);
  const [dlError,       setDlError]       = useState('');
  const [latestWeek,    setLatestWeek]    = useState(null); // most recent Weekly Snapshot for activeChildId, or undefined if none generated yet
  const [inboxMessages, setInboxMessages] = useState(null); // real /api/messages inbox — per parent, not per child
  const [inboxLoading,  setInboxLoading]  = useState(false);
  const [inboxTotal,    setInboxTotal]    = useState(0);
  const [inboxPage,     setInboxPage]     = useState(1);
  const [sentMessages,  setSentMessages]  = useState(null); // what the parent has written to the school
  const [sentLoading,   setSentLoading]   = useState(false);
  const [sentTotal,     setSentTotal]     = useState(0);
  const [sentPage,      setSentPage]      = useState(1);
  const [msgTab,        setMsgTab]        = useState('inbox');
  const [msgUnreadOnly, setMsgUnreadOnly] = useState(false);
  const [openMessageId, setOpenMessageId] = useState(null); // the one message expanded in place
  // Reported directly: "the parent cannot message the school... select
  // whom they want to message... but not fellow parents." Compose state
  // for the new send flow — recipients are a server-resolved category
  // list (never a raw address the parent types), scoped to activeChildId.
  const [composeOpen,     setComposeOpen]     = useState(false);
  const [composeMode,     setComposeMode]     = useState('new'); // 'new' | 'reply'
  const [recipientOptions, setRecipientOptions] = useState(null); // null = loading
  const [composeForm,     setComposeForm]     = useState({ category: '', subject: '', body: '' });
  const [composeSending,  setComposeSending]  = useState(false);
  const [composeError,    setComposeError]    = useState('');
  const [composeSent,     setComposeSent]     = useState(false);
  // Self-service password change — see ChangePasswordModal's own comment above.
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [currentPw,   setCurrentPw]   = useState('');
  const [newPw,       setNewPw]       = useState('');
  const [confirmPw,   setConfirmPw]   = useState('');
  const [pwShow,      setPwShow]      = useState(false);
  const [pwSaving,    setPwSaving]    = useState(false);
  const [pwBanner,    setPwBanner]    = useState({ type: '', msg: '' });
  const [initError,     setInitError]     = useState('');
  const [activePage,    setActivePage]    = useState('overview');
  const [childMenuOpen, setChildMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed,     setCollapsed]     = useState(() => {
    try { return localStorage.getItem('parent-sidebar-collapsed') === 'true'; } catch { return false; }
  });

  const parentName = session?.user?.name ?? session?.user?.firstName ?? '';

  /* ── Per-school branding — same pattern as Sidebar.jsx (admin shell) ── */
  const school          = session?.school;
  const { primary, accent } = useSchoolTheme();
  const schoolBrandName = school?.name ?? 'Parent Portal';
  const schoolInitial   = schoolBrandName.trim().charAt(0).toUpperCase() || 'M';
  const schoolLogoUrl   = school?.logoUrl ?? null;
  const avatarGradient  = `linear-gradient(135deg, ${primary}, ${accent})`;

  /* ── Which nav items does this school actually have switched on?
     Same moduleConfig/buildModuleConfigMap the admin Sidebar.jsx reads
     — a module a school never enabled (or explicitly disabled) doesn't
     get a Parent Portal section either, instead of every school seeing
     a fixed list regardless of what they've configured. */
  const moduleCfgMap = buildModuleConfigMap(school?.moduleConfig);
  const isModuleEnabled = (key) => !key || (moduleCfgMap[key]?.enabled ?? true);
  const myChildNav = MY_CHILD_NAV.filter(n => isModuleEnabled(n.module));
  const schoolNav  = SCHOOL_NAV.filter(n => isModuleEnabled(n.module));

  function toggleCollapsed() {
    setCollapsed(c => {
      const next = !c;
      try { localStorage.setItem('parent-sidebar-collapsed', String(next)); } catch { /* ignore */ }
      return next;
    });
  }

  /* ── Auth guard ── */
  useEffect(() => {
    if (!session?.user) { navigate('/login', { replace: true }); return; }
    const role = session.user?.role;
    if (role !== 'parent' && role !== 'guardian') { navigate('/dashboard', { replace: true }); return; }
  }, []);

  /* ── Load children list + family summary ── */
  useEffect(() => {
    if (!session?.user) return;
    Promise.all([
      _fetch('/api/parent-portal/children'),
      _fetch('/api/parent-portal/family-summary').catch(() => null),
    ]).then(([list, summary]) => {
      setChildren(list);
      setFamilySummary(summary);
      if (list.length > 0) setActiveChildId(list[0].id);
      setLoadingList(false);
    }).catch(e => {
      if (e.code === 'auth_expired') { logout(); navigate('/login', { replace: true }); return; }
      setInitError(e.message);
      setLoadingList(false);
    });
  }, []);

  /* ── Load child data when active child changes ── */
  useEffect(() => {
    if (!activeChildId) return;
    setLoadingChild(true);
    setChildData(null);
    _fetch(`/api/parent-portal/dashboard/${activeChildId}`)
      .then(d  => { setChildData(d); setLoadingChild(false); })
      .catch(e => {
        if (e.code === 'auth_expired') { logout(); navigate('/login', { replace: true }); return; }
        setLoadingChild(false);
      });
  }, [activeChildId]);

  /* ── Load this child's most recent Weekly Snapshot (independent of the
     dashboard payload — its own endpoint, per the confirmed self-service
     architecture) ── */
  useEffect(() => {
    if (!activeChildId) return;
    setLatestWeek(null);
    _fetch(`/api/parent-portal/weekly-snapshot/${activeChildId}/weeks`)
      .then(({ weeks }) => setLatestWeek(weeks?.[0] ?? undefined))
      .catch(() => setLatestWeek(undefined)); // no snapshot yet, or transient error — card simply hides
  }, [activeChildId]);

  /* ── Real messages inbox (/api/messages) — reported directly: the
     bell shows a notification but it "can't open." The Messages page
     was previously showing the school's announcements feed instead of
     the actual messages the bell/badge count are about — different
     collection, different question entirely. Loaded once per parent
     (not per child, a parent has one inbox regardless of which child
     is selected) the first time the Messages page is opened. */
  function loadInbox(page = 1, append = false) {
    setInboxLoading(true);
    messagesApi.list({ tab: 'inbox', limit: 20, page })
      .then(r => {
        const rows = r?.data ?? [];
        setInboxMessages(prev => (append && Array.isArray(prev) ? [...prev, ...rows] : rows));
        setInboxTotal(r?.pagination?.total ?? 0);
        setInboxPage(page);
      })
      .catch(() => { if (!append) setInboxMessages([]); })
      .finally(() => setInboxLoading(false));
  }
  function loadSent(page = 1, append = false) {
    setSentLoading(true);
    messagesApi.list({ tab: 'sent', limit: 20, page })
      .then(r => {
        const rows = r?.data ?? [];
        setSentMessages(prev => (append && Array.isArray(prev) ? [...prev, ...rows] : rows));
        setSentTotal(r?.pagination?.total ?? 0);
        setSentPage(page);
      })
      .catch(() => { if (!append) setSentMessages([]); })
      .finally(() => setSentLoading(false));
  }
  function markMessageRead(m) {
    if (m.isRead?.[session?.user?.id]) return;
    setInboxMessages(prev => prev?.map(x => (x.id === m.id ? { ...x, isRead: { ...x.isRead, [session?.user?.id]: true } } : x)) ?? prev);
    // Keep the sidebar/Overview badge (familySummary.unreadMessages) in
    // step too — it's fetched once at mount, not re-derived from
    // inboxMessages, so it would otherwise stay stale until a reload.
    setFamilySummary(prev => prev ? { ...prev, unreadMessages: Math.max(0, (prev.unreadMessages ?? 0) - 1) } : prev);
    messagesApi.markRead(m.id)
      .then(() => window.dispatchEvent(new Event('messages:read')))
      .catch(() => {});
  }
  /* Expanding a message IS reading it — the old list had no way to open
     a message at all, so opening one now marks it read and expands it in
     place (a route change per message is friction on a phone). */
  function toggleMessage(m) {
    const willOpen = openMessageId !== m.id;
    setOpenMessageId(willOpen ? m.id : null);
    if (willOpen) markMessageRead(m);
  }
  function replyToMessage(m) {
    openCompose({ subject: m.subject ? `Re: ${m.subject}` : 'Re: ' });
  }

  /* `prefill` carries a subject when the parent is replying to a message
     it just read. The recipient is still chosen by the parent from the
     server-resolved category list — a parent can only ever reach staff,
     never another parent. */
  function openCompose(prefill = {}) {
    const p = (prefill && typeof prefill === 'object' && 'subject' in prefill) ? prefill : {};
    setComposeForm({ category: '', subject: p.subject ?? '', body: '' });
    setComposeError('');
    setComposeSent(false);
    setComposeMode(p.subject ? 'reply' : 'new');
    setComposeOpen(true);
    setRecipientOptions(null);
    parentMessaging.recipients(activeChildId)
      .then(r => setRecipientOptions(r?.data ?? []))
      .catch(() => setRecipientOptions([]));
  }
  function sendCompose() {
    if (!composeForm.category)        { setComposeError('Choose who to message'); return; }
    if (!composeForm.subject.trim())  { setComposeError('Subject is required'); return; }
    if (!composeForm.body.trim())     { setComposeError('Message is required'); return; }
    setComposeSending(true);
    setComposeError('');
    parentMessaging.send({
      childId:  activeChildId,
      category: composeForm.category,
      subject:  composeForm.subject.trim(),
      body:     composeForm.body.trim(),
    })
      .then(() => {
        setComposeSent(true);
        setComposeForm({ category: '', subject: '', body: '' });
        // If the parent is looking at what they've sent, show it there.
        if (msgTab === 'sent') loadSent(1);
      })
      .catch(err => setComposeError(err.message || 'Could not send — please try again.'))
      .finally(() => setComposeSending(false));
  }

  function handleLogout() { logout(); navigate('/login', { replace: true }); }

  /* Same validation/flow as the staff-facing ProfilePage.jsx's own
     change-password handler — not reusing it directly (that page's
     logic is written as an inline function tied to its own state, not
     an exported helper), kept in exact parity so behaviour matches. */
  function handlePasswordChange(e) {
    e.preventDefault();
    if (!currentPw) { setPwBanner({ type: 'error', msg: 'Current password is required.' }); return; }
    if (newPw.length < 8) { setPwBanner({ type: 'error', msg: 'New password must be at least 8 characters.' }); return; }
    if (newPw !== confirmPw) { setPwBanner({ type: 'error', msg: 'Passwords do not match.' }); return; }
    setPwSaving(true);
    setPwBanner({ type: '', msg: '' });
    authApi.changePassword({ currentPassword: currentPw, newPassword: newPw })
      .then(() => {
        setPwBanner({ type: 'success', msg: 'Password changed successfully. Use your new password next time you sign in.' });
        setCurrentPw(''); setNewPw(''); setConfirmPw('');
      })
      .catch(err => setPwBanner({ type: 'error', msg: err.message || 'Failed to change password.' }))
      .finally(() => setPwSaving(false));
  }

  /* Real page switching, not an anchor-scroll within one long page —
     reported directly: clicking a nav item "just moves slightly" on a
     single scrolling page read as "nothing happened." Each item now
     renders its own focused page. */
  function goToPage(pageId) {
    setActivePage(pageId);
    setMobileNavOpen(false);
    if (mainRef.current) mainRef.current.scrollTo({ top: 0 });
    if (pageId === 'messages') loadInbox();
  }

  /* ── Loading state ── */
  if (loadingList) return (
    <div id="parent-portal-loading" className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Loading parent dashboard…</p>
      </div>
    </div>
  );

  /* ── Error state ── */
  if (initError) return (
    <div id="parent-portal-error" className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-red-100 p-8 max-w-md text-center">
        <AlertCircle size={32} className="text-red-400 mx-auto mb-3" />
        <p className="text-slate-700 font-medium mb-1">
          {initError.startsWith('Unable to access') ? 'Unable to access account' : 'Could not load dashboard'}
        </p>
        <p className="text-sm text-slate-400 mb-4">
          {initError.startsWith('Unable to access') ? 'Please contact your school administrator.' : initError}
        </p>
        <button onClick={handleLogout} className="text-sm text-amber-600 hover:underline">Sign out</button>
      </div>
    </div>
  );

  /* ── Derived values ── */
  const activeChild   = children.find(c => c.id === activeChildId) ?? children[0] ?? null;
  const d             = childData;
  const portalConfig  = d?.school?.portalConfig ?? {};
  const rcThreshold   = portalConfig.reportCardFeeThreshold ?? 100;
  const rcLocked      = rcThreshold > 0 && (d?.feeClearancePct ?? 100) < rcThreshold;
  // Reported directly: "Pay Fees via M-Pesa should not appear if the
  // school hasn't enabled this payment gateway" — was unconditional.
  // Defaults to hidden (not shown) while d is still null/loading, so
  // there's never a flash of a button that then disappears once the
  // real flag arrives.
  const mpesaEnabled  = d?.school?.mpesaEnabled === true;

  const childInitials = _initials(activeChild?.name ?? '');
  const nowMins       = _nowMins();
  const activeSlot    = d?.timetableToday?.find(s => _timeToMins(s.startTime) <= nowMins && nowMins < _timeToMins(s.endTime)) ?? null;
  const nextSlot      = d?.timetableToday?.find(s => _timeToMins(s.startTime) > nowMins) ?? null;

  /* Behaviour */
  const { totalPoints = 0, badgeLevel, latestReward, latestComment } = d?.behaviourSummary ?? {};

  /* My Average — the latest published report card's real average. Used to
     be computed from lessonsCoverage (curriculum coverage % — how much of
     the syllabus has been taught, not how the child actually did), shown
     on this exact stat card as if it were an academic average. A parent
     has no permission to read live Markbook marks at all (see server/
     utils/repairPermissions.js), so this is the one real number available
     — never anything provisional. */
  const myAvg = d?.reportCards?.[0]?.averageScore ?? null;

  /* Fee balance display */
  const feePaid    = (d?.feeBalance ?? 0) <= 0;
  const feeDisplay = feePaid ? 'KSh 0' : `KSh ${(d?.feeBalance ?? 0).toLocaleString()}`;

  /* Unread messages count */
  const unreadCount = familySummary?.unreadMessages ?? 0;

  /* Term label */
  const termLabel = d?.school?.currentTerm
    ? `${d.school.currentTerm} · ${d.school.academicYear ?? ''}`
    : d?.school?.academicYear ?? 'Current Term';

  /* ════════════════════════════════════════════════════════════════
     PAGE BODIES — each is the full section for its nav item. Built as
     closures over `d` etc. rather than extracted components, matching
     this file's existing single-component convention.
     ════════════════════════════════════════════════════════════════ */

  function OverviewPage() {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <QuickStat
            icon={Activity} label="Attendance" value={`${d.attendance?.percentage ?? 0}%`}
            iconBg="bg-emerald-50" iconColor="text-emerald-600"
            onClick={() => goToPage('attendance')}
          />
          <QuickStat
            icon={BookCheck} label="Average" value={myAvg != null ? `${myAvg}%` : '—'}
            iconBg="bg-indigo-50" iconColor="text-indigo-600"
            onClick={() => goToPage('grades')}
          />
          <QuickStat
            icon={Wallet} label="Fee Balance" value={feeDisplay} valueColor={feePaid ? 'text-emerald-600' : 'text-red-600'}
            iconBg="bg-amber-50" iconColor="text-amber-600"
            onClick={() => goToPage('fees')}
          />
          <QuickStat
            icon={MessageSquare} label="Messages" value={unreadCount > 0 ? `${unreadCount} unread` : 'Up to date'}
            valueColor={unreadCount > 0 ? 'text-amber-600' : 'text-slate-900'}
            iconBg="bg-sky-50" iconColor="text-sky-600"
            onClick={() => goToPage('messages')}
          />
        </div>

        {isModuleEnabled('timetable') && d.timetableToday?.length > 0 && (
          <Card id="section-timetable">
            <CardHeader
              icon={Calendar} iconClass="text-sky-500" title="Today's Timetable"
              right={<span className="text-[11px] text-slate-400">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span>}
            />
            {d.school?.emergencyOnlineMode && (
              <div id="emergency-online-banner" className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-50 border border-sky-200">
                <MonitorPlay size={12} className="text-sky-600 flex-shrink-0" />
                <p className="text-[11px] font-semibold text-sky-700">Emergency Online Learning — all lessons are online today</p>
              </div>
            )}
            <div id="timetable-slots" className="divide-y divide-slate-50">
              {d.timetableToday.slice(0, 4).map((slot, i) => {
                const start = _timeToMins(slot.startTime);
                const end   = _timeToMins(slot.endTime);
                const isNow  = start <= nowMins && nowMins < end;
                const isNext = !activeSlot && slot === nextSlot;
                return (
                  <div key={`tt-${slot.id ?? i}`} className={`flex items-center gap-3 px-4 py-3 ${isNow ? 'bg-amber-50 border-l-[3px] border-l-amber-500' : isNext ? 'bg-slate-50' : ''}`}>
                    <div className="text-center min-w-[60px] flex-shrink-0">
                      {isNow ? <div className="text-[10px] font-bold text-amber-700 uppercase">NOW</div> : isNext ? <div className="text-[10px] font-bold text-slate-500 uppercase">NEXT</div> : null}
                      <div className="text-[10px] text-slate-400">{slot.startTime}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] font-bold truncate ${isNow ? 'text-slate-900' : 'text-slate-700'}`}>{slot.subjectName}</p>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">{[slot.room, slot.teacherName].filter(Boolean).join(' · ')}</p>
                    </div>
                  </div>
                );
              })}
            </div>
            {d.timetableToday.length > 4 && (
              <button onClick={() => goToPage('timetable')} className="w-full text-[11px] font-medium text-indigo-600 hover:text-indigo-700 py-2.5 border-t border-slate-100">
                View full timetable →
              </button>
            )}
          </Card>
        )}

        {latestWeek && (
          <Card id="section-weekly-snapshot">
            <CardHeader icon={CalendarCheck} iconClass="text-sky-500" title="This Week's Snapshot" />
            <div className="px-[18px] py-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold text-slate-700">Week of {latestWeek.weekStart} – {latestWeek.weekEnd}</p>
                <p className="text-[10px] text-slate-400">Topics, assignments, attendance, behaviour, and more</p>
              </div>
              <button
                onClick={() => {
                  setDlError('');
                  setDownloading(`snap-${latestWeek.weekStart}`);
                  _downloadSnapshot(activeChildId, latestWeek.weekStart, `${activeChild?.name ?? 'child'}-${latestWeek.weekStart}`)
                    .catch(e => setDlError(e.message))
                    .finally(() => setDownloading(null));
                }}
                disabled={downloading === `snap-${latestWeek.weekStart}`}
                className="flex items-center gap-1 text-[10px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-2.5 py-1 rounded-full transition disabled:opacity-50 shrink-0"
              >
                {downloading === `snap-${latestWeek.weekStart}` ? <span className="w-3 h-3 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /> : <Download size={10} />}
                {downloading === `snap-${latestWeek.weekStart}` ? 'Saving…' : 'PDF'}
              </button>
            </div>
          </Card>
        )}

        {/* Reported directly: the Overview should show the school calendar
            inline (same live d.upcomingEvents the dedicated "School
            Calendar" tab already uses — see CalendarPage below — not just
            reachable by clicking into a separate tab), matching the
            Student Portal's own Overview, which already shows its events
            section inline rather than behind a tab. */}
        {isModuleEnabled('events') && d.upcomingEvents?.length > 0 && (
          <Card id="section-calendar-teaser">
            <CardHeader
              icon={Calendar} iconClass="text-blue-500" title="School Calendar"
              right={<span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2.5 py-[5px] rounded-full">{d.upcomingEvents.length} upcoming</span>}
            />
            <div className="divide-y divide-slate-50">
              {d.upcomingEvents.slice(0, 3).map((ev, i) => {
                const days = _daysUntil(ev.date);
                return (
                  <div key={`cal-teaser-${ev.id ?? i}`} className="flex items-center gap-3 px-[18px] py-3">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ev.color ?? primary }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-slate-800 truncate">{ev.title}</p>
                      <p className="text-[11px] text-slate-400">{_weekday(ev.date)}, {_fmtDate(ev.date)}</p>
                    </div>
                    <span className="text-[11px] text-slate-400 flex-shrink-0">{days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`}</span>
                  </div>
                );
              })}
            </div>
            <button onClick={() => goToPage('calendar')} className="w-full text-[11px] font-medium text-indigo-600 hover:text-indigo-700 py-2.5 border-t border-slate-100">
              View full calendar →
            </button>
          </Card>
        )}

        {isModuleEnabled('grades') && d.upcomingExams?.length > 0 && (
          <Card id="section-exams-teaser">
            <CardHeader
              icon={FileText} iconClass="text-rose-500" title="Upcoming Exams"
              right={<span className="text-[11px] font-semibold text-rose-600 bg-rose-50 px-2.5 py-[5px] rounded-full">{d.upcomingExams.length} scheduled</span>}
            />
            <div className="divide-y divide-slate-50">
              {d.upcomingExams.slice(0, 2).map((ex, i) => {
                const days = _daysUntil(ex.date);
                return (
                  <div key={`exam-teaser-${ex.id ?? i}`} className="flex items-center gap-3 px-[18px] py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-slate-800 truncate">{ex.subjectName}</p>
                      <p className="text-[11px] text-slate-400">{_weekday(ex.date)}, {_fmtDate(ex.date)}</p>
                    </div>
                    <span className="text-[11px] text-slate-400 flex-shrink-0">{days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`}</span>
                  </div>
                );
              })}
            </div>
            <button onClick={() => goToPage('grades')} className="w-full text-[11px] font-medium text-indigo-600 hover:text-indigo-700 py-2.5 border-t border-slate-100">
              View Grades & Reports →
            </button>
          </Card>
        )}
      </div>
    );
  }

  function GradesPage() {
    return (
      <div className="space-y-4">
        <Card id="section-grades">
          <CardHeader
            title={`${activeChild?.name?.split(' ')[0] ?? 'Child'}'s Grades — ${termLabel}`}
            right={activeChild?.className && (
              <span id="grades-class-badge" className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2.5 py-[5px] rounded-full shrink-0">{activeChild.className}</span>
            )}
          />
          <div id="grades-list" className="px-[18px] py-3.5 space-y-3.5">
            {!d.subjectMarks?.length ? (
              <p id="grades-empty" className="text-[12px] text-slate-400 text-center py-4">No published report card yet</p>
            ) : (
              d.subjectMarks.map((sub, i) => (
                <GradeBar key={`grade-${sub.subjectId ?? i}`} id={`grade-bar-${sub.subjectId ?? i}`} label={sub.grade ? `${sub.subjectName} · ${sub.grade}` : sub.subjectName} pct={sub.finalScore ?? 0} delay={i * 0.07} />
              ))
            )}
            {myAvg != null && d.subjectMarks?.length > 0 && (
              <div id="grades-avg-note" className="mt-2 text-[11px] text-slate-500 px-3 py-2 bg-slate-50 rounded-[7px]">
                Overall average: <span className="font-bold text-indigo-600">{myAvg}%</span>
              </div>
            )}
          </div>
        </Card>

        {/* Term-over-term trend — returned by the API (academicTrend) but
            previously rendered nowhere at all. */}
        {d.academicTrend?.length > 1 && (
          <Card id="section-academic-trend">
            <CardHeader icon={TrendingUp} iconClass="text-indigo-500" title="Term-over-Term Trend" />
            <div className="px-[18px] py-3.5 flex items-end gap-2.5 overflow-x-auto">
              {d.academicTrend.map((t, i) => (
                <div key={`trend-${i}`} className="flex flex-col items-center gap-1.5 flex-shrink-0 w-14">
                  <div className="h-20 w-full bg-slate-50 rounded-md flex items-end overflow-hidden">
                    <div className="w-full bg-indigo-400 rounded-sm" style={{ height: `${Math.min(100, t.average ?? 0)}%` }} />
                  </div>
                  <span className="text-[11px] font-bold text-slate-700">{t.average}%</span>
                  <span className="text-[9px] text-slate-400 text-center leading-tight">{t.label}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {d.reportCards?.length > 0 && (
          <Card id="section-reports">
            <CardHeader
              icon={FileText} iconClass="text-violet-500" title="Report Cards"
              right={rcLocked && <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2.5 py-[5px] rounded-full">Fee-locked</span>}
            />
            <div className="px-[18px] py-4">
              {rcLocked && (
                <div id="rc-locked-notice" className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800 mb-4">
                  <Lock size={11} className="mt-0.5 flex-shrink-0 text-amber-500" />
                  <span>Locked — <strong>{d.feeClearancePct}%</strong> fees cleared, minimum <strong>{rcThreshold}%</strong> required.</span>
                </div>
              )}
              {dlError && <p id="dl-error-msg" className="text-[11px] text-red-600 mb-3">{dlError}</p>}
              <div className="grid sm:grid-cols-2 gap-2.5">
                {d.reportCards.map(rc => {
                  const rcId = rc.id ?? rc._id?.toString();
                  const lbl  = `${rc.academicYear}-T${rc.termNumber}`;
                  const busy = downloading === rcId;
                  return (
                    <div key={`rc-${rcId}`} id={`report-card-${rcId}`} className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${rcLocked ? 'bg-slate-100' : 'bg-violet-50'}`}>
                        {rcLocked ? <Lock size={12} className="text-slate-400" /> : <GraduationCap size={12} className="text-violet-600" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-semibold text-slate-700">{rc.academicYear} · Term {rc.termNumber}</p>
                        {rc.averageScore != null && <p className="text-[10px] text-slate-400">Avg: {rc.averageScore}%</p>}
                      </div>
                      {rcLocked ? (
                        <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">Locked</span>
                      ) : (
                        <button
                          id={`download-rc-${rcId}`}
                          onClick={() => { setDlError(''); setDownloading(rcId); _downloadRC(rcId, lbl).catch(e => setDlError(e.message)).finally(() => setDownloading(null)); }}
                          disabled={busy}
                          className="flex items-center gap-1 text-[10px] font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 px-2.5 py-1 rounded-full transition disabled:opacity-50"
                        >
                          {busy ? <span className="w-3 h-3 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /> : <Download size={10} />}
                          {busy ? 'Saving…' : 'PDF'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        )}

        {d.upcomingExams?.length > 0 && (
          <Card id="section-exams">
            <CardHeader
              icon={FileText} iconClass="text-rose-500" title="Upcoming Exams"
              right={<span className="text-[11px] font-semibold text-rose-600 bg-rose-50 px-2.5 py-[5px] rounded-full">{d.upcomingExams.length} scheduled</span>}
            />
            <div id="exams-list" className="divide-y divide-slate-50">
              {d.upcomingExams.map((ex, i) => {
                const days = _daysUntil(ex.date);
                const urg  = days === 0 ? 'text-red-600 bg-red-50' : days != null && days <= 3 ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-50';
                return (
                  <div key={`exam-${ex.id ?? i}`} id={`exam-item-${ex.id ?? i}`} className="flex items-center gap-3 px-[18px] py-3">
                    <div className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center text-center flex-shrink-0 ${urg}`}>
                      <p className="text-sm font-bold leading-none">{days === 0 ? '!' : (days ?? '?')}</p>
                      {days != null && days > 0 && <p className="text-[9px]">day{days !== 1 ? 's' : ''}</p>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-slate-800 truncate">{ex.subjectName}</p>
                      <p className="text-[11px] text-slate-400">{_weekday(ex.date)}, {_fmtDate(ex.date)}{ex.startTime ? ` · ${ex.startTime}` : ''}{ex.type ? ` · ${ex.type}` : ''}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {d.lessonsCoverage?.length > 0 && (
          <Card id="section-curriculum">
            <CardHeader icon={BookCheck} iconClass="text-indigo-500" title="Curriculum Coverage" />
            <div id="curriculum-list" className="px-[18px] py-4 space-y-4">
              {d.lessonsCoverage.map((sub, i) => (
                <div key={`cov-${sub.subjectId ?? i}`} id={`coverage-subject-${sub.subjectId ?? i}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <span className="text-[13px] font-medium text-slate-800">{sub.subjectName}</span>
                      <span className="text-[10px] text-slate-400 ml-2">{sub.coveredTopics}/{sub.totalTopics} topics</span>
                    </div>
                    <span className={`text-[12px] font-bold ${sub.percentage >= 80 ? 'text-emerald-600' : sub.percentage >= 50 ? 'text-amber-600' : 'text-red-500'}`}>{sub.percentage}%</span>
                  </div>
                  <GradeBar id={`coverage-bar-${sub.subjectId ?? i}`} label="" pct={sub.percentage ?? 0} delay={i * 0.07} />
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    );
  }

  function AttendancePage() {
    return (
      <Card id="section-attendance">
        <CardHeader
          icon={Activity} iconClass="text-emerald-500" title="Attendance"
          right={<span id="attendance-pct-badge" className={`text-[11px] font-semibold px-2.5 py-[5px] rounded-full ${(d.attendance?.percentage ?? 0) >= 80 ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50'}`}>{d.attendance?.percentage ?? 0}% this term</span>}
        />
        <div className="px-[18px] py-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { id: 'att-present', label: 'Present',    value: d.attendance?.present ?? 0, color: 'bg-emerald-500', text: 'text-emerald-600' },
            { id: 'att-absent',  label: 'Absent',     value: d.attendance?.absent  ?? 0, color: 'bg-red-400',     text: 'text-red-600'     },
            { id: 'att-late',    label: 'Late',       value: d.attendance?.late    ?? 0, color: 'bg-amber-400',   text: 'text-amber-600'   },
            { id: 'att-total',   label: 'Total Days', value: d.attendance?.total   ?? 0, color: 'bg-slate-300',   text: 'text-slate-700'   },
          ].map(({ id, label, value, color, text }) => (
            <div key={id} id={id} className="text-center">
              <div className={`text-[22px] font-extrabold ${text}`}>{value}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
              <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                <div className={`h-full rounded-full ${color}`} style={{ width: d.attendance?.total ? `${Math.round((value / d.attendance.total) * 100)}%` : '0%' }} />
              </div>
            </div>
          ))}
        </div>
        {d.recentAttendance?.length > 0 && (
          <div id="recent-attendance-list" className="px-[18px] pb-4 space-y-1.5 border-t border-slate-100 pt-3">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.04em] mb-2">Recent Records</p>
            {d.recentAttendance.map((rec, i) => (
              <div key={`att-rec-${rec.id ?? i}`} id={`att-rec-${rec.id ?? i}`} className="flex items-center justify-between">
                <span className="text-[11px] text-slate-500">{rec.date ? new Date(rec.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '—'}</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${rec.status === 'present' ? 'bg-emerald-50 text-emerald-700' : rec.status === 'absent' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{rec.status}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  function FeesPage() {
    return (
      <Card id="section-fees">
        <CardHeader
          title={`Fee Statement — ${termLabel}`}
          right={<span id="fee-status-badge" className={`text-[11px] font-semibold px-2.5 py-[5px] rounded-full ${feePaid ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 'text-red-700 bg-red-50 border border-red-200'}`}>{feePaid ? 'Cleared' : 'Balance Due'}</span>}
        />
        <p className="px-[18px] pt-3.5 text-[11px] text-slate-400 -mb-1">{d.school?.name ?? 'School'} · {d.school?.academicYear ?? ''}</p>
        <div className="px-[18px] py-3.5">
          {d.feeBreakdown?.length > 0 ? (
            <table className="w-full text-[12px] mb-4" id="fee-breakdown-table">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-[0.04em]">Item</th>
                  <th className="text-right py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-[0.04em]">Amount</th>
                  <th className="text-right py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-[0.04em]">Paid</th>
                  <th className="text-right py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-[0.04em]">Balance</th>
                </tr>
              </thead>
              <tbody>
                {d.feeBreakdown.map((item, i) => (
                  <tr key={`fee-item-${item.id ?? i}`} id={`fee-item-${item.id ?? i}`} className="border-b border-slate-50 last:border-0">
                    <td className="py-2.5 text-slate-700">{item.label ?? item.name}</td>
                    <td className="py-2.5 text-right text-slate-700">KSh {(item.amount ?? 0).toLocaleString()}</td>
                    <td className="py-2.5 text-right font-semibold text-emerald-600">KSh {(item.paid ?? item.amount ?? 0).toLocaleString()}</td>
                    <td className="py-2.5 text-right font-semibold text-emerald-600">{(item.balance ?? 0) === 0 ? 'Nil' : `KSh ${item.balance.toLocaleString()}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div id="fee-summary-view" className="space-y-2 mb-4">
              <div className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-[12px] text-slate-600">Total Fees</span>
                <span className="text-[12px] font-semibold text-slate-800">{d.termFeeTotal ? `KSh ${d.termFeeTotal.toLocaleString()}` : '—'}</span>
              </div>
              <div className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-[12px] text-slate-600">Amount Paid</span>
                <span className="text-[12px] font-semibold text-emerald-600">{d.termFeeTotal && d.feeBalance != null ? `KSh ${(d.termFeeTotal - d.feeBalance).toLocaleString()}` : '—'}</span>
              </div>
              <div className="flex items-center justify-between py-2">
                <span className="text-[12px] text-slate-600">Outstanding Balance</span>
                <span className={`text-[12px] font-bold ${feePaid ? 'text-emerald-600' : 'text-red-600'}`}>{feeDisplay}</span>
              </div>
            </div>
          )}

          {feePaid ? (
            <div id="fee-cleared-notice" className="bg-emerald-50 rounded-[8px] px-3.5 py-2.5 border border-emerald-200">
              <div className="text-[12px] font-bold text-emerald-700">✓ All fees paid for this term</div>
              {d.recentPayments?.[0] && (
                <div className="text-[11px] text-emerald-600 mt-1">
                  Last payment: KSh {(d.recentPayments[0].amount ?? 0).toLocaleString()}
                  {d.recentPayments[0].paidAt ? ` via M-Pesa on ${_fmtDate(d.recentPayments[0].paidAt)}` : ''}
                  {d.recentPayments[0].mpesaCode ? ` · Ref: ${d.recentPayments[0].mpesaCode}` : ''}
                </div>
              )}
            </div>
          ) : (
            <div id="fee-balance-notice" className="bg-red-50 rounded-[8px] px-3.5 py-2.5 border border-red-200">
              <div className="text-[12px] font-bold text-red-700">Outstanding: {feeDisplay}</div>
              {d.nextFeeDueDate && <div className="text-[11px] text-red-600 mt-1">Due by {_fmtDate(d.nextFeeDueDate)}</div>}
              {mpesaEnabled && <p className="text-[11px] text-red-600 mt-2">Use the "Pay Fees via M-Pesa" button above to clear this balance.</p>}
            </div>
          )}

          {d.recentPayments?.length > 0 && (
            <div id="recent-payments-list" className="mt-4 border-t border-slate-100 pt-3 space-y-2">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.04em] mb-2">Recent Payments</p>
              {d.recentPayments.map((p, i) => (
                <div key={`payment-${p.id ?? i}`} id={`payment-item-${p.id ?? i}`} className="flex items-center justify-between">
                  <div>
                    <p className="text-[12px] font-semibold text-slate-800">KSh {(p.amount ?? 0).toLocaleString()}</p>
                    {p.mpesaCode && <p className="text-[10px] text-slate-400 font-mono">{p.mpesaCode}</p>}
                  </div>
                  <span className="text-[11px] text-slate-400">{p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    );
  }

  function TimetablePage() {
    return (
      <Card id="section-timetable-full">
        <CardHeader
          icon={Calendar} iconClass="text-sky-500" title="Today's Timetable"
          right={<span className="text-[11px] text-slate-400">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span>}
        />
        {d.school?.emergencyOnlineMode && (
          <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-50 border border-sky-200">
            <MonitorPlay size={12} className="text-sky-600 flex-shrink-0" />
            <p className="text-[11px] font-semibold text-sky-700">Emergency Online Learning — all lessons are online today</p>
          </div>
        )}
        {!d.timetableToday?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Calendar size={22} className="mb-2 opacity-40" />
            <p className="text-[12px]">No lessons scheduled today</p>
          </div>
        ) : (
          <div id="timetable-slots-full" className="divide-y divide-slate-50">
            {d.timetableToday.map((slot, i) => {
              const start = _timeToMins(slot.startTime);
              const end   = _timeToMins(slot.endTime);
              const isNow  = start <= nowMins && nowMins < end;
              const isNext = !activeSlot && slot === nextSlot;
              return (
                <div key={`tt-full-${slot.id ?? i}`} className={`flex items-center gap-3 px-4 py-3 ${isNow ? 'bg-amber-50 border-l-[3px] border-l-amber-500' : isNext ? 'bg-slate-50' : ''}`}>
                  <div className="text-center min-w-[60px] flex-shrink-0">
                    {isNow ? <div className="text-[10px] font-bold text-amber-700 uppercase">NOW</div> : isNext ? <div className="text-[10px] font-bold text-slate-500 uppercase">NEXT</div> : null}
                    <div className="text-[10px] text-slate-400">{slot.startTime}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-[13px] font-bold truncate ${isNow ? 'text-slate-900' : 'text-slate-700'}`}>{slot.subjectName}</p>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5 flex items-center gap-1">{slot.room && <><MapPin size={9} />{slot.room}</>}{slot.teacherName ? ` · ${slot.teacherName}` : ''}</p>
                  </div>
                  {isNow && <span className="text-[11px] font-semibold text-amber-600 bg-amber-100 px-2.5 py-[4px] rounded-full flex-shrink-0">In progress</span>}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    );
  }

  function LibraryPage() {
    return (
      <Card id="section-library">
        <CardHeader
          icon={BookOpen} iconClass="text-blue-500" title="Borrowed Books"
          right={d.borrowedBooks?.length > 0 && <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2.5 py-[5px] rounded-full">{d.borrowedBooks.length} out</span>}
        />
        {!d.borrowedBooks?.length ? (
          <p className="text-[12px] text-slate-400 text-center py-8">No books currently borrowed</p>
        ) : (
          <div id="library-loans-list" className="divide-y divide-slate-50">
            {d.borrowedBooks.map((loan, i) => {
              const days = _daysUntil(loan.dueDate);
              const isLost = loan.status === 'lost';
              const isOverdue = !isLost && days != null && days < 0;
              const urg = isLost ? 'text-slate-600 bg-slate-100' : isOverdue ? 'text-red-600 bg-red-50' : days != null && days <= 3 ? 'text-amber-600 bg-amber-50' : 'text-emerald-600 bg-emerald-50';
              return (
                <div key={loan.id ?? i} className="flex items-center gap-3 px-[18px] py-3">
                  <div className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center text-center flex-shrink-0 ${urg}`}>
                    <p className="text-sm font-bold leading-none">{isLost ? '!' : isOverdue ? '!' : (days ?? '?')}</p>
                    {!isLost && days != null && days > 0 && <p className="text-[9px]">day{days !== 1 ? 's' : ''}</p>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800 truncate">{loan.bookTitle}</p>
                    <p className="text-[11px] text-slate-400">{isLost ? 'Reported lost — see the library for next steps' : isOverdue ? `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}` : days === 0 ? 'Due today' : `Due ${_fmtDate(loan.dueDate)}`}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    );
  }

  function MessagesPage() {
    // Real /api/messages inbox — previously this page showed the
    // announcements feed instead, a different collection entirely from
    // what the bell/notification badge actually counts. Reported
    // directly: "see the notification but can't open" — clicking the
    // bell's notification landed here, which showed something else.
    const myUserId  = session?.user?.id;
    const isSent    = msgTab === 'sent';
    const source    = isSent ? sentMessages : inboxMessages;
    const loading   = isSent ? sentLoading : inboxLoading;
    const total     = isSent ? sentTotal : inboxTotal;
    const allRows   = Array.isArray(source) ? source : [];
    const unreadCount = allRows.filter(m => !m.isRead?.[myUserId]).length;
    // "Unread only" filters the loaded page; the count badge always
    // reflects everything in the inbox, not the filtered view.
    const rows      = (!isSent && msgUnreadOnly) ? allRows.filter(m => !m.isRead?.[myUserId]) : allRows;
    const hasMore   = allRows.length < total;

    return (
      <>
      <MessagesPanel
        tab={msgTab}
        onTabChange={(t) => {
          setMsgTab(t);
          setOpenMessageId(null);
          if (t === 'sent' && sentMessages === null) loadSent();
        }}
        messages={rows}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={() => (isSent ? loadSent(sentPage + 1, true) : loadInbox(inboxPage + 1, true))}
        total={total}
        myUserId={myUserId}
        primary={primary}
        openId={openMessageId}
        onToggle={toggleMessage}
        onCompose={() => openCompose()}
        onReply={replyToMessage}
        unreadOnly={msgUnreadOnly}
        onUnreadOnlyChange={setMsgUnreadOnly}
        unreadCount={unreadCount}
      />
      <ComposeMessageModal
        open={composeOpen}
        mode={composeMode}
        sent={composeSent}
        recipientOptions={recipientOptions}
        form={composeForm}
        onFormChange={setComposeForm}
        error={composeError}
        sending={composeSending}
        onClose={() => setComposeOpen(false)}
        onSend={sendCompose}
        primary={primary}
      />
      </>
    );
  }

  function CalendarPage() {
    return (
      <Card id="section-calendar">
        <CardHeader icon={Calendar} iconClass="text-blue-500" title="School Calendar" />
        {!d.upcomingEvents?.length ? (
          <p className="text-[12px] text-slate-400 text-center py-8">No upcoming events</p>
        ) : (
          <div id="events-list" className="divide-y divide-slate-50">
            {d.upcomingEvents.map((ev, i) => {
              const days = _daysUntil(ev.date);
              return (
                <div key={`ev-${ev.id ?? i}`} id={`event-item-${ev.id ?? i}`} className="flex items-center gap-3 px-[18px] py-3">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: ev.color ?? primary }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-slate-800 truncate">{ev.title}</p>
                    <p className="text-[11px] text-slate-400">{_weekday(ev.date)}, {_fmtDate(ev.date)}</p>
                  </div>
                  <span className="text-[11px] text-slate-400 flex-shrink-0">{days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`}</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    );
  }

  function BehaviourPage() {
    return (
      <Card id="section-behaviour">
        <CardHeader icon={Star} iconClass="text-amber-500" title="Behaviour & Rewards" />
        <div className="px-[18px] py-4 flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0">
            <span className="text-lg font-extrabold text-amber-600">+{totalPoints}</span>
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-slate-800">Behaviour Points</p>
            <BehaviourBadge level={badgeLevel} />
            {latestReward && (
              <div className="mt-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide">Latest Reward</p>
                <p className="text-[12px] font-medium text-slate-800 mt-0.5">{latestReward.title || latestReward.category || 'Reward'}</p>
              </div>
            )}
            {latestComment?.description && (
              <div className="mt-2 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Teacher Comment</p>
                <p className="text-[11px] text-slate-700 italic mt-0.5">"{latestComment.description}"</p>
              </div>
            )}
          </div>
        </div>
      </Card>
    );
  }

  function AnnouncementsPage() {
    return (
      <Card id="section-announcements">
        <CardHeader icon={Bell} iconClass="text-amber-500" title="Announcements" />
        {!d.announcements?.length ? (
          <p className="text-[12px] text-slate-400 text-center py-8">No announcements yet</p>
        ) : (
          <div id="announcements-list" className="divide-y divide-slate-50">
            {d.announcements.map((ann, i) => (
              <div key={`full-ann-${ann.id ?? i}`} id={`full-announcement-${ann.id ?? i}`} className="px-[18px] py-3.5">
                <p className="text-[13px] font-semibold text-slate-800 mb-0.5">{ann.title}</p>
                {ann.body && <p className="text-[12px] text-slate-500 leading-relaxed">{ann.body}</p>}
                <p className="text-[10px] text-slate-400 mt-1.5">{_fmtDate(ann.createdAt)}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    );
  }

  const PAGE_BODIES = {
    overview: OverviewPage, grades: GradesPage, attendance: AttendancePage, fees: FeesPage,
    timetable: TimetablePage, library: LibraryPage, messages: MessagesPage,
    calendar: CalendarPage, behaviour: BehaviourPage, announcements: AnnouncementsPage,
  };
  // A page whose module got disabled mid-session (or a stale activePage
  // from before this change) falls back to Overview rather than a blank
  // screen — same fail-safe default as landing on an unknown route.
  const ActivePageBody = PAGE_BODIES[activePage] ?? OverviewPage;
  const activeNavItem  = [...myChildNav, ...schoolNav].find(n => n.id === activePage);
  const activePageLabel = activeNavItem?.label ?? 'Overview';

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */
  return (
    <div id="parent-portal-root" className="flex h-screen overflow-hidden bg-[#f8fafc]">

      {/* ══ MOBILE SIDEBAR BACKDROP ══════════════════════════════ */}
      {mobileNavOpen && (
        <div id="parent-sidebar-backdrop" className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* ══ SIDEBAR ══════════════════════════════════════════════ */}
      <aside
        id="parent-sidebar"
        className={`fixed lg:static inset-y-0 left-0 z-40 w-[220px] ${collapsed ? 'lg:w-[72px]' : 'lg:w-[220px]'} flex flex-col flex-shrink-0 h-full transition-all duration-200 lg:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{ background: '#1c1917' }}
      >

        {/* Brand */}
        <div id="sidebar-brand" className={`py-5 border-b flex items-center ${collapsed ? 'lg:justify-center lg:px-2' : 'justify-between px-4'}`} style={{ borderColor: '#292524' }}>
          <div className={`flex items-center gap-2.5 min-w-0 ${collapsed ? 'lg:gap-0' : ''}`}>
            {schoolLogoUrl ? (
              <img src={schoolLogoUrl} alt={schoolBrandName} id="sidebar-logo-icon" className="w-[34px] h-[34px] rounded-[8px] object-contain bg-white/10 p-0.5 flex-shrink-0" />
            ) : (
              <div id="sidebar-logo-icon" className="w-[34px] h-[34px] rounded-[8px] flex items-center justify-center text-white font-extrabold text-base flex-shrink-0" style={{ background: avatarGradient }}>
                {schoolInitial}
              </div>
            )}
            <div className={`min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
              <div id="sidebar-brand-name" className="text-white font-bold text-[15px] leading-tight truncate">{schoolBrandName}</div>
              <div className="text-[11px] mt-0.5" style={{ color: '#fcd34d' }}>Parent Portal</div>
            </div>
          </div>
          <button id="sidebar-mobile-close" onClick={() => setMobileNavOpen(false)} className="lg:hidden flex-shrink-0 p-1 text-slate-400 hover:text-white" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        {/* Desktop collapse toggle */}
        <button
          id="sidebar-collapse-toggle"
          onClick={toggleCollapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={`hidden lg:flex items-center gap-2 px-2.5 py-2 mx-2 mt-2 rounded-[7px] text-[11px] font-medium transition-colors hover:bg-white/5 ${collapsed ? 'justify-center' : ''}`}
          style={{ color: '#a8a29e' }}
        >
          {collapsed ? <ChevronRight size={14} /> : <><ChevronLeft size={14} /> Collapse</>}
        </button>

        {/* Navigation */}
        <nav id="sidebar-nav" className="flex-1 px-2 py-3 overflow-y-auto">

          {!collapsed && (
            <p className="text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-2 mb-1 hidden lg:block" style={{ color: '#fcd34d' }}>My Child</p>
          )}
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-2 mb-1 lg:hidden" style={{ color: '#fcd34d' }}>My Child</p>

          {myChildNav.map(({ id, label, Icon }) => (
            <button
              key={id}
              id={`nav-btn-section-${id}`}
              onClick={() => goToPage(id)}
              title={label}
              className={`w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-[7px] mb-[1px] text-[13px] font-medium transition-colors text-left ${collapsed ? 'lg:justify-center' : ''}`}
              style={activePage === id ? { background: '#292524', color: '#fff' } : { color: '#fde68a' }}
            >
              <Icon size={15} className="flex-shrink-0 opacity-85" />
              <span className={`flex-1 ${collapsed ? 'lg:hidden' : ''}`}>{label}</span>
              {id === 'messages' && unreadCount > 0 && (
                <span id="sidebar-messages-badge" className={`bg-red-500 text-white text-[10px] font-bold px-[6px] py-[1px] rounded-full leading-snug ${collapsed ? 'lg:hidden' : ''}`}>
                  {unreadCount}
                </span>
              )}
            </button>
          ))}

          {!collapsed && (
            <p className="text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-2 mt-3 mb-1 hidden lg:block" style={{ color: '#fcd34d' }}>School</p>
          )}
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-2 mt-3 mb-1 lg:hidden" style={{ color: '#fcd34d' }}>School</p>

          {schoolNav.map(({ id, label, Icon }) => (
            <button
              key={id}
              id={`nav-btn-section-${id}`}
              onClick={() => goToPage(id)}
              title={label}
              className={`w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-[7px] mb-[1px] text-[13px] font-medium transition-colors text-left ${collapsed ? 'lg:justify-center' : ''}`}
              style={activePage === id ? { background: '#292524', color: '#fff' } : { color: '#fde68a' }}
            >
              <Icon size={15} className="flex-shrink-0 opacity-85" />
              <span className={collapsed ? 'lg:hidden' : ''}>{label}</span>
            </button>
          ))}
        </nav>

        {/* User footer */}
        <div id="sidebar-footer" className="px-2 py-3 border-t" style={{ borderColor: '#292524' }}>
          {/* Multi-child switcher */}
          {children.length > 1 && !collapsed && (
            <div className="relative mb-2 lg:block hidden">
              <button id="child-switcher-btn" onClick={() => setChildMenuOpen(o => !o)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[7px] text-left transition-colors" style={{ background: '#292524' }}>
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0" style={{ background: avatarGradient }}>
                  {_initials(activeChild?.name ?? '')}
                </div>
                <span className="flex-1 text-[11px] font-medium truncate" style={{ color: '#fde68a' }}>{activeChild?.name ?? 'Select child'}</span>
                <ChevronDown size={12} style={{ color: '#fcd34d' }} />
              </button>
              {childMenuOpen && (
                <div id="child-switcher-menu" className="absolute bottom-full left-0 right-0 mb-1 rounded-[8px] border overflow-hidden shadow-xl z-50" style={{ background: '#292524', borderColor: '#44403c' }}>
                  {children.map(child => (
                    <button key={child.id} id={`child-menu-item-${child.id}`} onClick={() => { setActiveChildId(child.id); setChildMenuOpen(false); }} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[#3c3835]">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0" style={{ background: avatarGradient }}>
                        {_initials(child.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold text-white truncate">{child.name}</div>
                        <div className="text-[10px] truncate" style={{ color: '#a8a29e' }}>{child.className}</div>
                      </div>
                      {child.id === activeChildId && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: primary }} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {children.length > 1 && collapsed && (
            <button
              onClick={() => setActiveChildId(children[(children.findIndex(c => c.id === activeChildId) + 1) % children.length].id)}
              title="Switch child"
              className="hidden lg:flex w-full items-center justify-center mb-2 py-1.5 rounded-[7px] hover:bg-white/5"
            >
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ background: avatarGradient }}>
                {_initials(activeChild?.name ?? '')}
              </div>
            </button>
          )}

          {/* Parent identity */}
          <div className={`flex items-center gap-2.5 px-2.5 py-2 rounded-[7px] ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
            <div id="sidebar-parent-avatar" className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ background: avatarGradient }}>
              {_initials(parentName)}
            </div>
            <div className={`flex-1 min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
              <div className="text-white text-[12px] font-semibold truncate">{parentName || 'Parent'}</div>
              <div className="text-[10px] truncate" style={{ color: '#fcd34d' }}>
                {children.length === 1 && activeChild ? `Parent · ${activeChild.name?.split(' ')[0]}` : `${children.length} children`}
              </div>
            </div>
            <button id="sidebar-change-password-btn" onClick={() => { setPwBanner({ type: '', msg: '' }); setPwModalOpen(true); }} title="Change Password" className={`flex-shrink-0 transition-colors hover:text-amber-300 ${collapsed ? 'lg:hidden' : ''}`} style={{ color: '#a8a29e' }}>
              <KeyRound size={14} />
            </button>
            <button id="sidebar-support-btn" onClick={() => navigate('/support')} title="Support" className={`flex-shrink-0 transition-colors hover:text-amber-300 ${collapsed ? 'lg:hidden' : ''}`} style={{ color: '#a8a29e' }}>
              <LifeBuoy size={14} />
            </button>
            <button id="sidebar-logout-btn" onClick={handleLogout} title="Sign out" className={`flex-shrink-0 transition-colors hover:text-red-400 ${collapsed ? 'lg:hidden' : ''}`} style={{ color: '#a8a29e' }}>
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ══ MAIN AREA ═════════════════════════════════════════════ */}
      <div id="parent-main-wrapper" className="flex-1 flex flex-col overflow-hidden">

        {/* Topbar */}
        <header id="parent-topbar" className="bg-white border-b border-slate-200 min-h-14 flex flex-wrap items-center px-3 sm:px-6 py-2 gap-2 sm:gap-4 flex-shrink-0">
          <button id="sidebar-mobile-open" onClick={() => setMobileNavOpen(true)} className="lg:hidden flex-shrink-0 p-1.5 -ml-1 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100" aria-label="Open menu">
            <Menu size={20} />
          </button>
          <h1 id="topbar-greeting" className="text-[14px] sm:text-[16px] font-bold text-slate-900 flex-1 min-w-0 truncate">
            {_greeting()}{parentName ? `, ${parentName.split(' ')[0]}` : ''} 👋
          </h1>
          <span id="topbar-term-badge" className="hidden sm:inline text-[12px] font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full whitespace-nowrap">{termLabel}</span>
          <NotificationBell myUserId={session?.user?.id} onSelect={() => goToPage('messages')} />
          <div className="flex items-center gap-2 w-full sm:w-auto order-last sm:order-none">
            {mpesaEnabled && (
              <button
                id="btn-pay-fees"
                onClick={() => goToPage('fees')}
                className="flex-1 sm:flex-initial px-3 sm:px-3.5 py-[7px] rounded-[7px] bg-slate-100 text-slate-600 text-[11px] sm:text-[12px] font-semibold hover:bg-slate-200 transition whitespace-nowrap"
              >
                Pay Fees via M-Pesa
              </button>
            )}
            <button
              id="btn-message-school"
              onClick={() => { goToPage('messages'); openCompose(); }}
              className="flex-1 sm:flex-initial px-3 sm:px-3.5 py-[7px] rounded-[7px] text-white text-[11px] sm:text-[12px] font-semibold transition hover:opacity-90 whitespace-nowrap"
              style={{ background: accent }}
            >
              Message School
            </button>
          </div>
        </header>

        {/* Scrollable content */}
        <main id="parent-main-content" ref={mainRef} className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4" onClick={() => childMenuOpen && setChildMenuOpen(false)}>

          {/* Page title (not shown for Overview — its own greeting bar already orients) */}
          {activePage !== 'overview' && (
            <h2 id="active-page-title" className="text-base font-bold text-slate-800">{activePageLabel}</h2>
          )}

          {/* Child banner — shown on every page, same identity strip.
              Wraps on a phone: the child's identity takes the full width
              on one line and the three stats drop underneath, instead of
              squeezing the name into a 90px column next to them. */}
          {activeChild && (
            <div id="child-banner" className="rounded-xl p-[18px] flex flex-wrap items-center gap-x-[18px] gap-y-3 border" style={{ background: 'linear-gradient(135deg, #1c1917, #292524)', borderColor: '#44403c' }}>
              <div className="flex items-center gap-[14px] min-w-0 flex-1 basis-full sm:basis-auto">
                <div id="child-banner-avatar" className="w-[52px] h-[52px] rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0" style={{ background: avatarGradient }}>
                  {childInitials}
                </div>
                <div className="min-w-0">
                  <div id="child-banner-name" className="text-white font-bold text-base leading-tight truncate">{activeChild.name}</div>
                  <div id="child-banner-meta" className="text-[12px] mt-1 leading-snug" style={{ color: '#a8a29e' }}>
                    {activeChild.className}
                    {activeChild.admissionNumber ? ` · Adm. No. ${activeChild.admissionNumber}` : ''}
                    {d?.school?.name ? ` · ${d.school.name}` : ''}
                  </div>
                </div>
              </div>
              <div className="flex gap-5 flex-shrink-0 w-full sm:w-auto justify-between sm:justify-end">
                <div id="child-banner-attendance" className="text-center flex-1 sm:flex-none">
                  {/* A child with no attendance records yet is not "0%",
                      it is "nothing to show" — the old code painted the
                      absence of data in the same brand colour as a real
                      zero, which read as a failing child. */}
                  <div className="text-[20px] font-extrabold" style={{ color: d?.attendance?.total ? primary : '#a8a29e' }}>
                    {d?.attendance?.total ? `${d.attendance.percentage}%` : '—'}
                  </div>
                  <div className="text-[10px]" style={{ color: '#a8a29e' }}>Attendance</div>
                </div>
                <div id="child-banner-average" className="text-center flex-1 sm:flex-none">
                  <div className={`text-[20px] font-extrabold ${myAvg != null ? 'text-green-400' : 'text-stone-500'}`}>{myAvg != null ? `${myAvg}%` : '—'}</div>
                  <div className="text-[10px]" style={{ color: '#a8a29e' }}>Average</div>
                </div>
                <div id="child-banner-balance" className="text-center flex-1 sm:flex-none">
                  {/* Cleared = calm, outstanding = needs attention. The
                      old colours were inverted (a cleared balance showed
                      in alarm orange), and the Overview card showed the
                      same number in the opposite colours. */}
                  <div className="text-[20px] font-extrabold" style={{ color: !d ? '#a8a29e' : feePaid ? '#34d399' : '#f87171' }}>{d ? feeDisplay : '—'}</div>
                  <div className="text-[10px]" style={{ color: '#a8a29e' }}>Balance</div>
                </div>
              </div>
            </div>
          )}

          {/* Loading child data spinner */}
          {loadingChild && (
            <div id="child-loading-spinner" className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Active page body */}
          {d && !loadingChild && (
            <AnimatePresence mode="wait">
              <motion.div
                key={`page-${activePage}-${activeChildId}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <ActivePageBody />
              </motion.div>
            </AnimatePresence>
          )}

        </main>
      </div>
      {/* end MAIN AREA */}

      <ChangePasswordModal
        open={pwModalOpen}
        currentPw={currentPw} newPw={newPw} confirmPw={confirmPw}
        onCurrentChange={setCurrentPw} onNewChange={setNewPw} onConfirmChange={setConfirmPw}
        showPws={pwShow} onToggleShow={() => setPwShow(s => !s)}
        banner={pwBanner} saving={pwSaving}
        onClose={() => setPwModalOpen(false)}
        onSubmit={handlePasswordChange}
        primary={primary}
      />
    </div>
  );
}
