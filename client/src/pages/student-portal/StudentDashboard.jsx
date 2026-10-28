/**
 * Student Portal Dashboard
 * Layout: Sidebar + Main. Sidebar brand (name/logo/badge colour) inherits
 * the signed-in student's own school via session.school + useSchoolTheme —
 * same pattern as the admin Sidebar.jsx, not hardcoded to any one school.
 * Sidebar becomes an off-canvas drawer below the lg breakpoint.
 * Data: all fetched from /api/student-portal/dashboard (unchanged).
 */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '@/store/auth.js';
import { useSchoolTheme } from '@/hooks/useSchoolTheme.js';
import {
  LayoutDashboard, Calendar, BookCheck, CheckCircle, Clock,
  Download, GraduationCap, LogOut, AlertCircle,
  BookOpen, Lock, Bell, MessageSquare, Activity, Star,
  MapPin, Play, MonitorPlay, CalendarCheck, Menu, X, LifeBuoy,
  KeyRound, Eye, EyeOff, Loader2,
} from 'lucide-react';
import NotificationBell from '@/components/layout/NotificationBell.jsx';
import FloatingHelp from '@/components/help/FloatingHelp.jsx';
import { auth as authApi } from '@/api/client.js';

/* ── API ────────────────────────────────────────────────────────── */
const API_BASE = import.meta.env.VITE_API_BASE || '';
async function _fetch(path) {
  const res  = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  const json = await res.json();
  if (res.status === 401) {
    const err = new Error(json.error?.message || 'Session expired — please sign in again');
    err.code = 'auth_expired';
    throw err;
  }
  /* A 403 is a real access answer, not an expired session — show its
     (deliberately neutral) message instead of forcing a logout. */
  if (res.status === 403) {
    const err = new Error(json.error?.message || 'Unable to access this account. Please contact your school administrator.');
    err.code = json.error?.code || 'forbidden';
    throw err;
  }
  if (!json.success) throw new Error(json.error?.message || 'Failed to load');
  return json.data;
}

async function _downloadReport(rcId, label) {
  const res = await fetch(`${API_BASE}/api/report-cards/${rcId}/pdf`, { credentials: 'include' });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Download failed'); }
  const blob = await res.blob();
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `report-card-${label}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function _downloadSnapshot(weekStart, label) {
  const res = await fetch(`${API_BASE}/api/student-portal/weekly-snapshot/${weekStart}/pdf`, { credentials: 'include' });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Download failed'); }
  const blob = await res.blob();
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `weekly-snapshot-${label}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Helpers ────────────────────────────────────────────────────── */
function _greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function _fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function _daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date()) / 86_400_000);
}
function _weekday(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-GB', { weekday: 'short' });
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

/* ── Sidebar nav items ──────────────────────────────────────────── */
const MY_SPACE_NAV = [
  { id: 'section-dashboard',   label: 'Dashboard',    Icon: LayoutDashboard },
  { id: 'section-timetable',   label: 'My Timetable', Icon: Calendar        },
  { id: 'section-grades',      label: 'My Grades',    Icon: BookCheck       },
  { id: 'section-attendance',  label: 'Attendance',   Icon: Activity        },
  { id: 'section-messages',    label: 'Messages',     Icon: MessageSquare   },
];
const LEARNING_NAV = [
  { id: 'section-lessons',     label: 'Lesson Notes', Icon: BookOpen      },
  { id: 'section-exams',       label: 'Exams',        Icon: CalendarCheck },
];

/* ── Stat card ──────────────────────────────────────────────────── */
function StatCard({ id, iconBg, Icon, iconColor, label, value, valueColor, sub, subHighlight }) {
  return (
    <div id={id} className="bg-white rounded-[10px] border border-slate-200 shadow-sm p-[18px]">
      <div className={`w-[38px] h-[38px] rounded-[9px] flex items-center justify-center mb-3 ${iconBg}`}>
        <Icon size={18} className={iconColor} />
      </div>
      <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-[0.04em] mb-2">{label}</div>
      <div className={`text-[26px] font-extrabold leading-none ${valueColor ?? 'text-slate-900'}`}>{value}</div>
      <div className="text-[12px] text-slate-500 mt-1.5">
        {subHighlight && <span className="font-semibold">{subHighlight} </span>}
        {sub}
      </div>
    </div>
  );
}

/* ── Progress bar (animated) ────────────────────────────────────── */
function GradeBar({ id, label, pct, delay = 0 }) {
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 60 ? 'bg-indigo-500' : 'bg-amber-400';
  const textColor = pct >= 80 ? 'text-emerald-600' : pct >= 60 ? 'text-indigo-600' : 'text-amber-500';
  return (
    <div id={id}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[12px] text-slate-600">{label}</span>
        <span className={`text-[12px] font-bold ${textColor}`}>{pct}%</span>
      </div>
      <div className="h-[7px] bg-slate-100 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.7, delay, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

/* Reported directly 2026-10-28: "parents dont have that clickable
   profile to update or change their password" — same gap on the
   Student Portal, same fix. POST /api/auth/change-password already
   works for any authenticated role (no role check at all, just
   authMiddleware scoped to the caller's own userId/schoolId); there
   was simply nowhere in this portal to reach it, since there's no
   /profile route nested under /student-dashboard. A self-contained
   modal, not a new page — same reasoning as ParentDashboard.jsx's own
   identical addition.

   Hoisted to a top-level component (not nested inside the main
   component's body) for the same reason ParentDashboard.jsx's
   ComposeMessageModal is — a function defined inside a render body gets
   a new identity every render, which would unmount/remount this modal
   and drop input focus on every keystroke. */
function ChangePasswordModal({ open, currentPw, newPw, confirmPw, onCurrentChange, onNewChange, onConfirmChange, showPws, onToggleShow, banner, saving, onClose, onSubmit }) {
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
                className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-emerald-700 hover:bg-emerald-800 px-4 py-2 rounded-lg disabled:opacity-50 transition"
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
export default function StudentDashboard() {
  const navigate    = useNavigate();
  const logout      = useAuthStore(s => s.logout);
  const session     = useAuthStore(s => s.session);
  const mainRef     = useRef(null);

  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [activeNav,   setActiveNav]   = useState('section-dashboard');
  const [downloading, setDownloading] = useState(null);
  const [dlError,     setDlError]     = useState('');
  const [latestWeek,  setLatestWeek]  = useState(null); // most recent Weekly Snapshot, or undefined if none generated yet
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Self-service password change — see ChangePasswordModal's own comment above.
  const [pwModalOpen, setPwModalOpen] = useState(false);
  const [currentPw,   setCurrentPw]   = useState('');
  const [newPw,       setNewPw]       = useState('');
  const [confirmPw,   setConfirmPw]   = useState('');
  const [pwShow,      setPwShow]      = useState(false);
  const [pwSaving,    setPwSaving]    = useState(false);
  const [pwBanner,    setPwBanner]    = useState({ type: '', msg: '' });

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

  /* ── Per-school branding — same pattern as Sidebar.jsx (admin shell) ── */
  const authSchool      = session?.school;
  const { primary, accent } = useSchoolTheme();
  const schoolBrandName = authSchool?.name ?? 'Student Portal';
  const schoolInitial   = schoolBrandName.trim().charAt(0).toUpperCase() || 'M';
  const schoolLogoUrl   = authSchool?.logoUrl ?? null;

  /* ── Auth guard + fetch ── */
  useEffect(() => {
    if (!session?.user)                  { navigate('/login',     { replace: true }); return; }
    if (session.user?.role !== 'student') { navigate('/dashboard', { replace: true }); return; }
    _fetch('/api/student-portal/dashboard')
      .then(d  => { setData(d); setLoading(false); })
      .catch(e => {
        if (e.code === 'auth_expired') { logout(); navigate('/login', { replace: true }); return; }
        setError(e.message); setLoading(false);
      });
    // Independent of the dashboard payload — its own endpoint, per the
    // confirmed self-service architecture (weekly-snapshots.js's shared
    // read logic, reached here via student-portal.js's RBAC-bypassed route).
    _fetch('/api/student-portal/weekly-snapshot/weeks')
      .then(({ weeks }) => setLatestWeek(weeks?.[0] ?? undefined))
      .catch(() => setLatestWeek(undefined));
  }, []);

  /* ── Scroll to section helper ──
     scrollIntoView (not el.offsetTop math) — robust regardless of any
     transformed/positioned ancestor between the anchor and mainRef, and
     regardless of the topbar's height offsetting main from the document
     origin. See ParentDashboard.jsx's scrollToSection for the full story. */
  function scrollToSection(sectionId) {
    setActiveNav(sectionId);
    setMobileNavOpen(false);
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ── Scroll-spy — keep the sidebar highlight in sync with the section
     actually in view. Without this the highlight went stale the moment a
     student scrolled by hand (it only ever changed on a nav click).
     The dashboard is a two-column grid, so DOM order ≠ nav order: pick
     whichever nav-linked section's top edge has passed the scroll
     container's top edge and sits closest to it, rather than trusting
     either list's order. Depends on `data` because the section anchors
     only exist once the dashboard payload has rendered (this component
     returns a spinner before that, so mainRef is null on first mount). ── */
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const ids = [...MY_SPACE_NAV, ...LEARNING_NAV].map(n => n.id);

    function onScroll() {
      const mainTop = main.getBoundingClientRect().top;
      let best = null;
      let bestDelta = -Infinity; // largest delta that has still passed the top edge
      let closest = ids[0];
      let closestAbs = Infinity; // fallback: nearest to the top edge either way
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const delta = el.getBoundingClientRect().top - mainTop;
        const abs = Math.abs(delta);
        if (abs < closestAbs) { closestAbs = abs; closest = id; }
        if (delta <= 12 && delta > bestDelta) { bestDelta = delta; best = id; }
      }
      const next = best ?? closest;
      setActiveNav(prev => (prev === next ? prev : next));
    }

    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, [data]);

  /* ── Loading state ── */
  if (loading) return (
    <div id="student-portal-loading" className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Loading your dashboard…</p>
      </div>
    </div>
  );

  /* ── Error state ── */
  if (error) return (
    <div id="student-portal-error" className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-red-100 p-8 max-w-md text-center">
        <AlertCircle size={32} className="text-red-400 mx-auto mb-3" />
        <p className="text-slate-700 font-medium mb-1">
          {error.startsWith('Unable to access') ? 'Unable to access account' : 'Could not load dashboard'}
        </p>
        <p className="text-sm text-slate-400 mb-4">
          {error.startsWith('Unable to access') ? 'Please contact your school administrator.' : error}
        </p>
        <button onClick={() => { logout(); navigate('/login', { replace: true }); }}
          className="text-sm text-emerald-600 hover:underline">Sign out</button>
      </div>
    </div>
  );

  /* ── Destructure API response ── */
  const {
    student, school, attendance, feeBalance, feeClearancePct, nextFeeDueDate,
    lessonsCoverage, subjectMarks, timetableToday, reportCards,
    classTeacher, behaviourSummary, upcomingExams, announcements, upcomingEvents,
    borrowedBooks,
  } = data;

  /* ── Derived values ── */
  const portalConfig   = school?.portalConfig ?? {};
  const rcThreshold    = portalConfig.reportCardFeeThreshold ?? 100;
  const rcLocked       = rcThreshold > 0 && (feeClearancePct ?? 100) < rcThreshold;

  const firstName  = student.firstName ?? student.name?.split(' ')[0] ?? student.name ?? 'Student';
  const initials   = _initials(student.name);
  const nowMins    = _nowMins();
  const activeSlot = timetableToday.find(s => _timeToMins(s.startTime) <= nowMins && nowMins < _timeToMins(s.endTime)) ?? null;
  const nextSlot   = timetableToday.find(s => _timeToMins(s.startTime) > nowMins) ?? null;

  /* My Average — the latest published report card's real average. Used
     to be computed from lessonsCoverage (curriculum coverage % — how much
     of the syllabus has been taught, not how the student actually did),
     which showed on this exact stat card as if it were an academic
     average. A student/parent has no permission to read live Markbook
     marks at all (see server/utils/repairPermissions.js), so this is the
     one real number available to them — never anything provisional. */
  const myAvg = reportCards[0]?.averageScore ?? null;

  /* Fee display — feeBalance is null when portalConfig.studentCanSeeFees
     is off (Security Baseline Register, CFG-09); null <= 0 is true in JS,
     which previously made an unpaid-but-hidden balance render as "Cleared"
     the moment the server started correctly withholding it. Currently
     unused in this file's JSX, but fixed here rather than left wrong for
     whoever reaches for it next. */
  const feesVisible = feeBalance !== null;
  const feePaid     = feesVisible && feeBalance <= 0;
  const feeDisplay  = !feesVisible ? null : feePaid ? 'Cleared' : `KSh ${feeBalance.toLocaleString()}`;

  /* Behaviour */
  const { totalPoints = 0, badgeLevel } = behaviourSummary ?? {};

  /* Current term label */
  const termLabel = school?.currentTerm
    ? `${school.currentTerm} · ${school.academicYear ?? ''}`
    : school?.academicYear ?? 'Current Term';

  function handleLogout() { logout(); navigate('/login', { replace: true }); }

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */
  return (
    <div id="student-portal-root" className="flex h-screen overflow-hidden bg-[#f8fafc]">

      {/* ══ MOBILE SIDEBAR BACKDROP ══════════════════════════════ */}
      {mobileNavOpen && (
        <div
          id="student-sidebar-backdrop"
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* ══ SIDEBAR ══════════════════════════════════════════════ */}
      <aside
        id="student-sidebar"
        className={`fixed lg:static inset-y-0 left-0 z-40 w-[220px] bg-[#064e3b] flex flex-col flex-shrink-0 h-full transition-transform duration-200 lg:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >

        {/* Brand */}
        <div id="sidebar-brand" className="px-4 py-5 border-b border-[#065f46] flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            {schoolLogoUrl ? (
              <img
                src={schoolLogoUrl}
                alt={schoolBrandName}
                id="sidebar-logo-icon"
                className="w-[34px] h-[34px] rounded-[8px] object-contain bg-white/10 p-0.5 flex-shrink-0"
              />
            ) : (
              <div
                id="sidebar-logo-icon"
                className="w-[34px] h-[34px] rounded-[8px] flex items-center justify-center text-white font-extrabold text-base flex-shrink-0"
                style={{ background: `linear-gradient(135deg, ${primary}, ${accent})` }}
              >
                {schoolInitial}
              </div>
            )}
            <div className="min-w-0">
              <div id="sidebar-brand-name" className="text-white font-bold text-[15px] leading-tight truncate">{schoolBrandName}</div>
              <div className="text-[11px] text-emerald-300 mt-0.5">Student Portal</div>
            </div>
          </div>
          <button
            id="sidebar-mobile-close"
            onClick={() => setMobileNavOpen(false)}
            className="lg:hidden flex-shrink-0 p-1 text-emerald-300 hover:text-white"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav id="sidebar-nav" className="flex-1 px-2 py-3 overflow-y-auto">

          <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-[0.06em] px-2 py-2 mb-1">
            My Space
          </p>

          {MY_SPACE_NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              id={`nav-btn-${id}`}
              onClick={() => scrollToSection(id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-[7px] mb-[1px] text-[13px] font-medium transition-colors text-left
                ${activeNav === id
                  ? 'bg-[#065f46] text-white'
                  : 'text-emerald-200 hover:bg-[#065f46]/60 hover:text-white'
                }`}
            >
              <Icon size={15} className="flex-shrink-0 opacity-85" />
              <span className="flex-1">{label}</span>
              {/* Messages badge — only shown when there are unread announcements */}
              {id === 'section-messages' && announcements?.length > 0 && (
                <span
                  id="sidebar-messages-badge"
                  className="bg-red-500 text-white text-[10px] font-bold px-[6px] py-[1px] rounded-full leading-snug"
                >
                  {announcements.length}
                </span>
              )}
            </button>
          ))}

          <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-[0.06em] px-2 py-2 mt-3 mb-1">
            Learning
          </p>

          {LEARNING_NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              id={`nav-btn-${id}`}
              onClick={() => scrollToSection(id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-[7px] mb-[1px] text-[13px] font-medium transition-colors text-left
                ${activeNav === id
                  ? 'bg-[#065f46] text-white'
                  : 'text-emerald-200 hover:bg-[#065f46]/60 hover:text-white'
                }`}
            >
              <Icon size={15} className="flex-shrink-0 opacity-85" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {/* User footer */}
        <div id="sidebar-footer" className="px-2 py-3 border-t border-[#065f46]">
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-[7px]">
            <div
              id="sidebar-user-avatar"
              className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
            >
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-[12px] font-semibold truncate">{student.name}</div>
              <div className="text-emerald-400 text-[10px] truncate">
                {student.className ? `${student.className} · Student` : 'Student'}
              </div>
            </div>
            <button
              id="sidebar-change-password-btn"
              onClick={() => { setPwBanner({ type: '', msg: '' }); setPwModalOpen(true); }}
              title="Change Password"
              className="text-emerald-500 hover:text-emerald-300 transition flex-shrink-0"
            >
              <KeyRound size={14} />
            </button>
            <button
              id="sidebar-support-btn"
              onClick={() => navigate('/support')}
              title="Support"
              className="text-emerald-500 hover:text-emerald-300 transition flex-shrink-0"
            >
              <LifeBuoy size={14} />
            </button>
            <button
              id="sidebar-logout-btn"
              onClick={handleLogout}
              title="Sign out"
              className="text-emerald-500 hover:text-red-400 transition flex-shrink-0"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ══ MAIN AREA ═════════════════════════════════════════════ */}
      <div id="student-main-wrapper" className="flex-1 flex flex-col overflow-hidden">

        {/* Topbar */}
        <header id="student-topbar" className="bg-white border-b border-slate-200 min-h-14 flex flex-wrap items-center px-3 sm:px-6 py-2 gap-2 sm:gap-4 flex-shrink-0">
          <button
            id="sidebar-mobile-open"
            onClick={() => setMobileNavOpen(true)}
            className="lg:hidden flex-shrink-0 p-1.5 -ml-1 text-slate-500 hover:text-slate-800 rounded-lg hover:bg-slate-100"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <h1 id="topbar-greeting" className="text-[14px] sm:text-[16px] font-bold text-slate-900 flex-1 min-w-0 truncate">
            {_greeting()}, {firstName} 👋
          </h1>
          <span id="topbar-term-badge" className="hidden sm:inline text-[12px] font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full whitespace-nowrap">
            {termLabel}
          </span>
          <NotificationBell myUserId={session.user?.id} onSelect={() => scrollToSection('section-messages')} />
          <div className="flex items-center gap-2 w-full sm:w-auto order-last sm:order-none">
            <button
              id="btn-report-card"
              onClick={() => scrollToSection('section-grades')}
              className="flex-1 sm:flex-initial px-3 sm:px-3.5 py-[7px] rounded-[7px] bg-slate-100 text-slate-600 text-[11px] sm:text-[12px] font-semibold hover:bg-slate-200 transition whitespace-nowrap"
            >
              My Report Card
            </button>
            <button
              id="btn-view-timetable"
              onClick={() => scrollToSection('section-timetable')}
              className="flex-1 sm:flex-initial px-3 sm:px-3.5 py-[7px] rounded-[7px] bg-emerald-600 text-white text-[11px] sm:text-[12px] font-semibold hover:bg-emerald-700 transition whitespace-nowrap"
            >
              View Timetable
            </button>
          </div>
        </header>

        {/* Scrollable content */}
        <main
          id="student-main-content"
          ref={mainRef}
          className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4"
        >

          {/* ── Stat cards ─────────────────────────────────────── */}
          <div id="section-dashboard" className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">

            <StatCard
              id="stat-card-average"
              iconBg="bg-emerald-50"
              Icon={BookCheck}
              iconColor="text-emerald-600"
              label="My Average"
              value={myAvg != null ? `${myAvg}%` : '—'}
              valueColor="text-emerald-600"
              subHighlight={null}
              sub={myAvg != null ? 'This term' : 'No data yet'}
            />

            <StatCard
              id="stat-card-attendance"
              iconBg="bg-green-50"
              Icon={CheckCircle}
              iconColor="text-green-600"
              label="Attendance"
              value={`${attendance.percentage ?? 0}%`}
              valueColor="text-slate-900"
              subHighlight={null}
              sub={`${attendance.present ?? 0}/${attendance.total ?? 0} days present`}
            />

            <StatCard
              id="stat-card-exams"
              iconBg="bg-amber-50"
              Icon={Clock}
              iconColor="text-amber-500"
              label="Exams Due"
              value={upcomingExams?.length ?? 0}
              valueColor={upcomingExams?.length > 0 ? 'text-amber-500' : 'text-slate-900'}
              subHighlight={null}
              sub={
                upcomingExams?.[0]
                  ? `Next: ${upcomingExams[0].subjectName} · ${_weekday(upcomingExams[0].date)}`
                  : 'None scheduled'
              }
            />

            <StatCard
              id="stat-card-rank"
              iconBg="bg-blue-50"
              Icon={GraduationCap}
              iconColor="text-blue-600"
              label="Class Rank"
              value={student.classRank ? `#${student.classRank}` : '—'}
              valueColor="text-blue-600"
              subHighlight={null}
              sub={
                student.classSize && student.className
                  ? `of ${student.classSize} in ${student.className}`
                  : student.className ?? 'Your class'
              }
            />
          </div>

          {/* ── Two-column grid ────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:[grid-template-columns:1fr_380px] gap-3.5">

            {/* LEFT: Today's Schedule */}
            <div id="section-timetable" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="text-[13px] font-bold text-slate-900">Today's Schedule</h2>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {new Date().toLocaleDateString('en-GB', { weekday: 'long' })}
                    {student.className ? ` · ${student.className}` : ''}
                  </p>
                </div>
                {activeSlot && (
                  <span
                    id="timetable-live-badge"
                    className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-[5px] rounded-full"
                  >
                    In Session
                  </span>
                )}
              </div>

              {/* Emergency online mode banner */}
              {school?.emergencyOnlineMode && (
                <div id="emergency-online-banner" className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-50 border border-sky-200">
                  <MonitorPlay size={12} className="text-sky-600 flex-shrink-0" />
                  <p className="text-[11px] font-semibold text-sky-700">
                    Emergency Online Learning — all lessons are online today
                  </p>
                </div>
              )}

              {timetableToday.length === 0 ? (
                <div id="timetable-empty" className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <Calendar size={22} className="mb-2 opacity-40" />
                  <p className="text-[12px]">No lessons scheduled today</p>
                </div>
              ) : (
                <div id="timetable-slots" className="divide-y divide-slate-50">
                  {timetableToday.map((slot, i) => {
                    const start = _timeToMins(slot.startTime);
                    const end   = _timeToMins(slot.endTime);
                    const isNow  = start <= nowMins && nowMins < end;
                    const isNext = !activeSlot && slot === nextSlot;

                    return (
                      <div
                        key={`slot-${slot.id ?? i}`}
                        id={`timetable-slot-${slot.id ?? i}`}
                        className={`flex items-center gap-3 px-4 py-3 transition-colors
                          ${isNow  ? 'bg-emerald-50 border-l-[3px] border-l-emerald-500' : ''}
                          ${isNext ? 'bg-amber-50'   : ''}
                        `}
                      >
                        {/* Time column */}
                        <div className="text-center min-w-[60px] flex-shrink-0">
                          {isNow ? (
                            <>
                              <div className="text-[10px] font-bold text-emerald-700 uppercase tracking-wide">NOW</div>
                              <div className="text-[10px] text-slate-400">{slot.startTime}</div>
                            </>
                          ) : isNext ? (
                            <>
                              <div className="text-[10px] font-bold text-amber-600 uppercase tracking-wide">NEXT</div>
                              <div className="text-[10px] text-slate-400">{slot.startTime}</div>
                            </>
                          ) : (
                            <div className="text-[10px] text-slate-400">{slot.startTime}</div>
                          )}
                        </div>

                        {/* Subject + room */}
                        <div className="flex-1 min-w-0">
                          <p className={`text-[13px] font-bold truncate ${isNow ? 'text-slate-900' : 'text-slate-700'}`}>
                            {slot.subjectName}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">
                            {[slot.room, slot.teacherName].filter(Boolean).join(' · ')}
                          </p>
                        </div>

                        {/* Badges / join button */}
                        {isNow && !slot.meetingLink && (
                          <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-100 px-2.5 py-[4px] rounded-full flex-shrink-0">
                            Live
                          </span>
                        )}
                        {slot.meetingLink && (
                          <a
                            id={`join-btn-slot-${slot.id ?? i}`}
                            href={slot.meetingLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-semibold transition"
                          >
                            <Play size={9} /> Join
                          </a>
                        )}
                        {slot.room && !slot.meetingLink && !isNow && (
                          <div className="flex items-center gap-1 text-[10px] text-slate-400 flex-shrink-0">
                            <MapPin size={9} /> {slot.room}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* RIGHT column */}
            <div className="flex flex-col gap-3.5">

              {/* My Grades */}
              <div id="section-grades" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="text-[13px] font-bold text-slate-900">My Grades — {termLabel}</h2>
                  {student.className && (
                    <span
                      id="grades-class-badge"
                      className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2.5 py-[5px] rounded-full"
                    >
                      {student.className}
                    </span>
                  )}
                </div>

                <div id="grades-list" className="px-[18px] py-3.5 space-y-3.5">
                  {/* subjectMarks — the student's real per-subject scores from their
                     most recently PUBLISHED report card. Used to show curriculum
                     coverage % here instead (mislabeled as grades) — that data is
                     still shown, correctly labelled, in Curriculum Coverage below. */}
                  {subjectMarks.length === 0 ? (
                    <p id="grades-empty" className="text-[12px] text-slate-400 text-center py-4">
                      No published report card yet
                    </p>
                  ) : (
                    subjectMarks.map((sub, i) => (
                      <GradeBar
                        key={`grade-${sub.subjectId ?? i}`}
                        id={`grade-bar-${sub.subjectId ?? i}`}
                        label={sub.grade ? `${sub.subjectName} · ${sub.grade}` : sub.subjectName}
                        pct={sub.finalScore ?? 0}
                        delay={i * 0.07}
                      />
                    ))
                  )}

                  {/* Report card download — shown below grades */}
                  {reportCards.length > 0 && (
                    <div id="report-cards-section" className="pt-2 border-t border-slate-100 space-y-2">
                      {rcLocked && (
                        <div id="rc-locked-notice" className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800">
                          <Lock size={11} className="mt-0.5 flex-shrink-0 text-amber-500" />
                          <span>
                            Reports locked — <strong>{feeClearancePct}%</strong> fees cleared,{' '}
                            minimum <strong>{rcThreshold}%</strong> required.
                          </span>
                        </div>
                      )}
                      {dlError && (
                        <p id="dl-error-msg" className="text-[11px] text-red-600">{dlError}</p>
                      )}
                      {reportCards.map(rc => {
                        const label = `${rc.academicYear}-T${rc.termNumber}`;
                        const busy  = downloading === rc.id;
                        return (
                          <div
                            key={`rc-${rc.id}`}
                            id={`report-card-${rc.id}`}
                            className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 bg-slate-50"
                          >
                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${rcLocked ? 'bg-slate-100' : 'bg-violet-50'}`}>
                              {rcLocked
                                ? <Lock size={12} className="text-slate-400" />
                                : <GraduationCap size={12} className="text-violet-600" />
                              }
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-semibold text-slate-700">
                                {rc.academicYear} · Term {rc.termNumber}
                              </p>
                              {rc.averageScore != null && (
                                <p className="text-[10px] text-slate-400">Avg: {rc.averageScore}%</p>
                              )}
                            </div>
                            {rcLocked ? (
                              <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                                Locked
                              </span>
                            ) : (
                              <button
                                id={`download-rc-${rc.id}`}
                                onClick={() => {
                                  setDlError('');
                                  setDownloading(rc.id);
                                  _downloadReport(rc.id, label)
                                    .catch(e => setDlError(e.message))
                                    .finally(() => setDownloading(null));
                                }}
                                disabled={busy}
                                className="flex items-center gap-1 text-[10px] font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 px-2.5 py-1 rounded-full transition disabled:opacity-50"
                              >
                                {busy
                                  ? <span className="w-3 h-3 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
                                  : <Download size={10} />
                                }
                                {busy ? 'Saving…' : 'PDF'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* This Week's Snapshot — auto-generated every Saturday
                 (weekly-snapshot-cron.js). `latestWeek === undefined`
                 means "checked, none generated yet" vs. `null` = "still
                 loading" — the card only appears once there's something
                 real to show. */}
              {latestWeek && (
                <div id="section-weekly-snapshot" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center gap-2">
                    <CalendarCheck size={14} className="text-sky-500" />
                    <h2 className="text-[13px] font-bold text-slate-900">This Week's Snapshot</h2>
                  </div>
                  <div className="px-[18px] py-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[12px] font-semibold text-slate-700">
                        Week of {latestWeek.weekStart} – {latestWeek.weekEnd}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        Topics, assignments, attendance, behaviour, and more
                      </p>
                    </div>
                    <button
                      id="download-weekly-snapshot"
                      onClick={() => {
                        setDlError('');
                        setDownloading(`snap-${latestWeek.weekStart}`);
                        _downloadSnapshot(latestWeek.weekStart, latestWeek.weekStart)
                          .catch(e => setDlError(e.message))
                          .finally(() => setDownloading(null));
                      }}
                      disabled={downloading === `snap-${latestWeek.weekStart}`}
                      className="flex items-center gap-1 text-[10px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border border-sky-200 px-2.5 py-1 rounded-full transition disabled:opacity-50 shrink-0"
                    >
                      {downloading === `snap-${latestWeek.weekStart}`
                        ? <span className="w-3 h-3 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                        : <Download size={10} />
                      }
                      {downloading === `snap-${latestWeek.weekStart}` ? 'Saving…' : 'PDF'}
                    </button>
                  </div>
                </div>
              )}

              {/* Upcoming Exams — id matches the sidebar's "Exams" nav item
                  (was section-assignments, which mislabelled this card). */}
              <div id="section-exams" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="text-[13px] font-bold text-slate-900">Upcoming Exams</h2>
                  {upcomingExams?.length > 0 && (
                    <span
                      id="exams-count-badge"
                      className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2.5 py-[5px] rounded-full"
                    >
                      {upcomingExams.length} scheduled
                    </span>
                  )}
                </div>

                <div id="exams-list" className="px-[18px] py-3.5">
                  {!upcomingExams?.length ? (
                    <p id="exams-empty" className="text-[12px] text-slate-400 text-center py-4">
                      No upcoming exams
                    </p>
                  ) : (
                    <div className="space-y-3.5">
                      {upcomingExams.map((ex, i) => {
                        const days = _daysUntil(ex.date);
                        const dotColor = days === 0 ? '#ef4444' : days != null && days <= 3 ? '#f59e0b' : '#22c55e';
                        return (
                          <div
                            key={`exam-${ex.id ?? i}`}
                            id={`exam-item-${ex.id ?? i}`}
                            className="flex items-start gap-3"
                          >
                            <div
                              className="w-2 h-2 rounded-full mt-[5px] flex-shrink-0"
                              style={{ background: dotColor }}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-semibold text-slate-800">{ex.subjectName}</p>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {_weekday(ex.date)}, {_fmtDate(ex.date)}
                                {days === 0
                                  ? ' · Today'
                                  : days === 1
                                  ? ' · Tomorrow'
                                  : days != null
                                  ? ` · ${days} days left`
                                  : ''}
                                {ex.type ? ` · ${ex.type}` : ''}
                                {ex.startTime ? ` · ${ex.startTime}` : ''}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Borrowed Books */}
              <div id="section-library" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between">
                  <h2 className="text-[13px] font-bold text-slate-900">Borrowed Books</h2>
                  {borrowedBooks?.length > 0 && (
                    <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2.5 py-[5px] rounded-full">
                      {borrowedBooks.length} out
                    </span>
                  )}
                </div>
                <div className="px-[18px] py-3.5">
                  {!borrowedBooks?.length ? (
                    <p className="text-[12px] text-slate-400 text-center py-4">No books currently borrowed</p>
                  ) : (
                    <div className="space-y-3.5">
                      {borrowedBooks.map((loan, i) => {
                        const days = _daysUntil(loan.dueDate);
                        const isLost = loan.status === 'lost';
                        const isOverdue = !isLost && days != null && days < 0;
                        const dotColor = isLost ? '#64748b' : isOverdue ? '#ef4444' : days != null && days <= 3 ? '#f59e0b' : '#22c55e';
                        return (
                          <div key={loan.id ?? i} className="flex items-start gap-3">
                            <div className="w-2 h-2 rounded-full mt-[5px] flex-shrink-0" style={{ background: dotColor }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-[12px] font-semibold text-slate-800 truncate">{loan.bookTitle}</p>
                              <p className="text-[11px] text-slate-400 mt-0.5">
                                {isLost
                                  ? 'Reported lost — see the library for next steps'
                                  : isOverdue
                                  ? `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} — return as soon as possible`
                                  : days === 0
                                  ? 'Due today'
                                  : `Due ${_fmtDate(loan.dueDate)} · ${days} day${days === 1 ? '' : 's'} left`}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

            </div>
            {/* end RIGHT column */}
          </div>
          {/* end two-column grid */}

          {/* ── Attendance detail ───────────────────────────────── */}
          <div id="section-attendance" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center gap-2">
              <Activity size={14} className="text-emerald-500" />
              <h2 className="text-[13px] font-bold text-slate-900">Attendance Detail</h2>
            </div>
            <div className="px-[18px] py-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { id: 'att-present', label: 'Present',  value: attendance.present ?? 0,  color: 'bg-emerald-500', text: 'text-emerald-600' },
                { id: 'att-absent',  label: 'Absent',   value: attendance.absent  ?? 0,  color: 'bg-red-400',     text: 'text-red-600'     },
                { id: 'att-late',    label: 'Late',     value: attendance.late    ?? 0,  color: 'bg-amber-400',   text: 'text-amber-600'   },
                { id: 'att-total',   label: 'Total Days', value: attendance.total ?? 0,  color: 'bg-slate-300',   text: 'text-slate-700'   },
              ].map(({ id, label, value, color, text }) => (
                <div key={id} id={id} className="text-center">
                  <div className={`text-[22px] font-extrabold ${text}`}>{value}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
                  <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${color}`}
                      style={{ width: attendance.total ? `${Math.round((value / attendance.total) * 100)}%` : '0%' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Curriculum / Lesson coverage ──────────────────────
              Always rendered (never gated on `lessonsCoverage.length`)
              so the sidebar's "Lesson Notes" item always has a scroll
              target — an empty section with an empty state is far less
              confusing than a nav click that silently does nothing. */}
          <div id="section-lessons" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center gap-2">
              <BookOpen size={14} className="text-indigo-500" />
              <h2 className="text-[13px] font-bold text-slate-900">Curriculum Coverage</h2>
            </div>
            {lessonsCoverage.length === 0 ? (
              <p id="coverage-empty" className="text-[12px] text-slate-400 text-center py-6">
                No curriculum coverage recorded yet
              </p>
            ) : (
              <div id="coverage-list" className="px-[18px] py-4 space-y-4">
                {lessonsCoverage.map((sub, i) => (
                  <div key={`cov-${sub.subjectId ?? i}`} id={`coverage-subject-${sub.subjectId ?? i}`}>
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <span className="text-[13px] font-medium text-slate-800">{sub.subjectName}</span>
                        <span className="text-[10px] text-slate-400 ml-2">
                          {sub.coveredTopics}/{sub.totalTopics} topics
                        </span>
                      </div>
                      <span className={`text-[12px] font-bold ${
                        sub.percentage >= 80 ? 'text-emerald-600' :
                        sub.percentage >= 50 ? 'text-amber-600'   : 'text-red-500'
                      }`}>
                        {sub.percentage}%
                      </span>
                    </div>
                    <GradeBar
                      id={`coverage-bar-${sub.subjectId ?? i}`}
                      label=""
                      pct={sub.percentage ?? 0}
                      delay={i * 0.07}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Announcements / Messages ───────────────────────────
              Always rendered (never gated on `announcements.length`) so
              the sidebar's "Messages" item and the notification bell's
              onSelect target always resolve. */}
          <div id="section-messages" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell size={14} className="text-amber-500" />
                <h2 className="text-[13px] font-bold text-slate-900">Announcements</h2>
              </div>
              {announcements?.length > 0 && (
                <span
                  id="announcements-count-badge"
                  className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2.5 py-[5px] rounded-full"
                >
                  {announcements.length} new
                </span>
              )}
            </div>
            {!announcements?.length ? (
              <p id="announcements-empty" className="text-[12px] text-slate-400 text-center py-6">
                No announcements right now
              </p>
            ) : (
              <div id="announcements-list" className="divide-y divide-slate-50">
                {announcements.map((ann, i) => (
                  <div key={`ann-${ann.id ?? i}`} id={`announcement-${ann.id ?? i}`} className="px-[18px] py-3.5">
                    <p className="text-[13px] font-semibold text-slate-800 mb-0.5">{ann.title}</p>
                    {ann.body && (
                      <p className="text-[12px] text-slate-500 line-clamp-2 leading-relaxed">{ann.body}</p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-1.5">{_fmtDate(ann.createdAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Upcoming school events ───────────────────────────── */}
          {upcomingEvents?.length > 0 && (
            <div id="section-events" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center gap-2">
                <Calendar size={14} className="text-blue-500" />
                <h2 className="text-[13px] font-bold text-slate-900">School Events</h2>
              </div>
              <div id="events-list" className="divide-y divide-slate-50">
                {upcomingEvents.map((ev, i) => {
                  const days = _daysUntil(ev.date);
                  return (
                    <div key={`ev-${ev.id ?? i}`} id={`event-${ev.id ?? i}`} className="flex items-center gap-3 px-[18px] py-3">
                      <div
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: ev.color ?? '#6366f1' }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-slate-800 truncate">{ev.title}</p>
                        <p className="text-[11px] text-slate-400">
                          {_weekday(ev.date)}, {_fmtDate(ev.date)}
                        </p>
                      </div>
                      <span className="text-[11px] text-slate-400 flex-shrink-0">
                        {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Behaviour & Rewards ──────────────────────────────── */}
          {behaviourSummary && (
            <div id="section-behaviour" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center gap-2">
                <Star size={14} className="text-amber-500" />
                <h2 className="text-[13px] font-bold text-slate-900">Behaviour &amp; Rewards</h2>
              </div>
              <div className="px-[18px] py-4 flex items-center gap-4">
                <div
                  id="behaviour-points-badge"
                  className="w-14 h-14 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0"
                >
                  <span className="text-lg font-extrabold text-amber-600">+{totalPoints}</span>
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-slate-800">Behaviour Points</p>
                  {badgeLevel && (
                    <span
                      id="behaviour-badge-level"
                      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-600 border-amber-200 mt-1"
                    >
                      {badgeLevel === 'gold' ? '🥇' : badgeLevel === 'silver' ? '🥈' : '🥉'}
                      {badgeLevel.charAt(0).toUpperCase() + badgeLevel.slice(1)} Badge
                    </span>
                  )}
                  {!badgeLevel && (
                    <p className="text-[11px] text-slate-400 mt-0.5">No badge yet</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Bottom spacer */}
          <div className="h-4" />

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
      />
    </div>
  );
}
