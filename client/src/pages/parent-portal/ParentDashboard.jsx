/**
 * Msingi — Parent Portal Dashboard
 * Layout: Sidebar + Main — matches the Msingi parent portal design.
 * Data: all fetched from /api/parent-portal/* (unchanged).
 * UI only — zero functional or API changes.
 */
import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '@/store/auth.js';
import {
  Activity, AlertCircle, Award, Bell, BookCheck, Calendar,
  CheckCircle, Clock, Download, FileText, GraduationCap,
  Lock, LogOut, MessageSquare, Receipt, Star, Wallet,
  ChevronDown, MonitorPlay, MapPin,
} from 'lucide-react';

/* ── API helpers ────────────────────────────────────────────────── */
const API_BASE = import.meta.env.VITE_API_BASE || '';
async function _fetch(path) {
  const res  = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  const json = await res.json();
  if (res.status === 401 || res.status === 403) {
    const err = new Error(json.error?.message || 'Session expired — please sign in again');
    err.code = 'auth_expired';
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

/* ── Sidebar nav definitions ────────────────────────────────────── */
const MY_CHILD_NAV = [
  { id: 'section-overview',    label: 'Overview',         Icon: CheckCircle   },
  { id: 'section-grades',      label: 'Grades & Reports', Icon: BookCheck     },
  { id: 'section-attendance',  label: 'Attendance',       Icon: Activity      },
  { id: 'section-fees',        label: 'Fee Statements',   Icon: Wallet        },
  { id: 'section-messages',    label: 'Messages',         Icon: MessageSquare },
];
const SCHOOL_NAV = [
  { id: 'section-calendar',      label: 'School Calendar', Icon: Calendar },
  { id: 'section-announcements', label: 'Announcements',   Icon: Bell     },
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
  const [initError,     setInitError]     = useState('');
  const [activeNav,     setActiveNav]     = useState('section-overview');
  const [childMenuOpen, setChildMenuOpen] = useState(false);

  const parentName = session?.user?.name ?? session?.user?.firstName ?? '';

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

  function handleLogout() { logout(); navigate('/login', { replace: true }); }

  function scrollToSection(sectionId) {
    setActiveNav(sectionId);
    const el = document.getElementById(sectionId);
    if (el && mainRef.current) {
      mainRef.current.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' });
    }
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
        <p className="text-slate-700 font-medium mb-1">Could not load dashboard</p>
        <p className="text-sm text-slate-400 mb-4">{initError}</p>
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

  const childInitials = _initials(activeChild?.name ?? '');
  const nowMins       = _nowMins();
  const activeSlot    = d?.timetableToday?.find(s => _timeToMins(s.startTime) <= nowMins && nowMins < _timeToMins(s.endTime)) ?? null;
  const nextSlot      = d?.timetableToday?.find(s => _timeToMins(s.startTime) > nowMins) ?? null;

  /* Behaviour */
  const { totalPoints = 0, badgeLevel, latestReward, latestComment } = d?.behaviourSummary ?? {};

  /* My Average from lessonsCoverage */
  const myAvg = d?.lessonsCoverage?.length > 0
    ? Math.round(d.lessonsCoverage.reduce((sum, s) => sum + s.percentage, 0) / d.lessonsCoverage.length)
    : null;

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
     RENDER
     ════════════════════════════════════════════════════════════════ */
  return (
    <div id="parent-portal-root" className="flex h-screen overflow-hidden bg-[#f8fafc]">

      {/* ══ SIDEBAR ══════════════════════════════════════════════ */}
      <aside id="parent-sidebar" className="w-[220px] flex flex-col flex-shrink-0" style={{ background: '#1c1917' }}>

        {/* Brand */}
        <div id="sidebar-brand" className="px-4 py-5 border-b" style={{ borderColor: '#292524' }}>
          <div className="flex items-center gap-2.5">
            <div
              id="sidebar-logo-icon"
              className="w-[34px] h-[34px] rounded-[8px] flex items-center justify-center text-white font-extrabold text-base flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
            >
              M
            </div>
            <div>
              <div className="text-white font-bold text-[15px] leading-tight">Msingi</div>
              <div className="text-[11px] mt-0.5" style={{ color: '#fcd34d' }}>Parent Portal</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav id="sidebar-nav" className="flex-1 px-2 py-3 overflow-y-auto">

          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-2 mb-1" style={{ color: '#fcd34d' }}>
            My Child
          </p>

          {MY_CHILD_NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              id={`nav-btn-${id}`}
              onClick={() => scrollToSection(id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-[7px] mb-[1px] text-[13px] font-medium transition-colors text-left`}
              style={activeNav === id
                ? { background: '#292524', color: '#fff' }
                : { color: '#fde68a' }
              }
            >
              <Icon size={15} className="flex-shrink-0 opacity-85" />
              <span className="flex-1">{label}</span>
              {id === 'section-messages' && unreadCount > 0 && (
                <span
                  id="sidebar-messages-badge"
                  className="bg-red-500 text-white text-[10px] font-bold px-[6px] py-[1px] rounded-full leading-snug"
                >
                  {unreadCount}
                </span>
              )}
            </button>
          ))}

          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-2 mt-3 mb-1" style={{ color: '#fcd34d' }}>
            School
          </p>

          {SCHOOL_NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              id={`nav-btn-${id}`}
              onClick={() => scrollToSection(id)}
              className="w-full flex items-center gap-2.5 px-2.5 py-[8px] rounded-[7px] mb-[1px] text-[13px] font-medium transition-colors text-left"
              style={activeNav === id
                ? { background: '#292524', color: '#fff' }
                : { color: '#fde68a' }
              }
            >
              <Icon size={15} className="flex-shrink-0 opacity-85" />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        {/* User footer */}
        <div id="sidebar-footer" className="px-2 py-3 border-t" style={{ borderColor: '#292524' }}>
          {/* Multi-child switcher */}
          {children.length > 1 && (
            <div className="relative mb-2">
              <button
                id="child-switcher-btn"
                onClick={() => setChildMenuOpen(o => !o)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[7px] text-left transition-colors"
                style={{ background: '#292524' }}
              >
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
                >
                  {_initials(activeChild?.name ?? '')}
                </div>
                <span className="flex-1 text-[11px] font-medium truncate" style={{ color: '#fde68a' }}>
                  {activeChild?.name ?? 'Select child'}
                </span>
                <ChevronDown size={12} style={{ color: '#fcd34d' }} />
              </button>
              {childMenuOpen && (
                <div
                  id="child-switcher-menu"
                  className="absolute bottom-full left-0 right-0 mb-1 rounded-[8px] border overflow-hidden shadow-xl z-50"
                  style={{ background: '#292524', borderColor: '#44403c' }}
                >
                  {children.map(child => (
                    <button
                      key={child.id}
                      id={`child-menu-item-${child.id}`}
                      onClick={() => { setActiveChildId(child.id); setChildMenuOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[#3c3835]"
                    >
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0"
                        style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
                      >
                        {_initials(child.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-semibold text-white truncate">{child.name}</div>
                        <div className="text-[10px] truncate" style={{ color: '#a8a29e' }}>{child.className}</div>
                      </div>
                      {child.id === activeChildId && (
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Parent identity */}
          <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-[7px]">
            <div
              id="sidebar-parent-avatar"
              className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
            >
              {_initials(parentName)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-white text-[12px] font-semibold truncate">{parentName || 'Parent'}</div>
              <div className="text-[10px] truncate" style={{ color: '#fcd34d' }}>
                {children.length === 1 && activeChild
                  ? `Parent · ${activeChild.name?.split(' ')[0]}`
                  : `${children.length} children`}
              </div>
            </div>
            <button
              id="sidebar-logout-btn"
              onClick={handleLogout}
              title="Sign out"
              className="flex-shrink-0 transition-colors hover:text-red-400"
              style={{ color: '#a8a29e' }}
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>
      </aside>

      {/* ══ MAIN AREA ═════════════════════════════════════════════ */}
      <div id="parent-main-wrapper" className="flex-1 flex flex-col overflow-hidden">

        {/* Topbar */}
        <header id="parent-topbar" className="bg-white border-b border-slate-200 h-14 flex items-center px-6 gap-4 flex-shrink-0">
          <h1 id="topbar-greeting" className="text-[16px] font-bold text-slate-900 flex-1">
            {_greeting()}{parentName ? `, ${parentName.split(' ')[0]}` : ''} 👋
          </h1>
          <span id="topbar-term-badge" className="text-[12px] font-medium text-slate-500 bg-slate-100 px-3 py-1 rounded-full whitespace-nowrap">
            {termLabel}
          </span>
          <div className="flex items-center gap-2">
            <button
              id="btn-pay-fees"
              onClick={() => scrollToSection('section-fees')}
              className="px-3.5 py-[7px] rounded-[7px] bg-slate-100 text-slate-600 text-[12px] font-semibold hover:bg-slate-200 transition"
            >
              Pay Fees via M-Pesa
            </button>
            <button
              id="btn-message-school"
              onClick={() => scrollToSection('section-messages')}
              className="px-3.5 py-[7px] rounded-[7px] text-white text-[12px] font-semibold transition hover:opacity-90"
              style={{ background: '#d97706' }}
            >
              Message School
            </button>
          </div>
        </header>

        {/* Scrollable content */}
        <main
          id="parent-main-content"
          ref={mainRef}
          className="flex-1 overflow-y-auto p-5 space-y-4"
          onClick={() => childMenuOpen && setChildMenuOpen(false)}
        >

          {/* ── Section anchor: Overview ── */}
          <div id="section-overview" />

          {/* ── Child banner card ───────────────────────────────── */}
          {activeChild && (
            <div
              id="child-banner"
              className="rounded-xl p-[18px] flex items-center gap-[18px] border"
              style={{ background: 'linear-gradient(135deg, #1c1917, #292524)', borderColor: '#44403c' }}
            >
              <div
                id="child-banner-avatar"
                className="w-[52px] h-[52px] rounded-full flex items-center justify-center text-white text-xl font-bold flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
              >
                {childInitials}
              </div>
              <div className="flex-1 min-w-0">
                <div id="child-banner-name" className="text-white font-bold text-base leading-tight">
                  {activeChild.name}
                </div>
                <div id="child-banner-meta" className="text-[12px] mt-1" style={{ color: '#a8a29e' }}>
                  {activeChild.className}
                  {activeChild.admissionNumber ? ` · Adm. No. ${activeChild.admissionNumber}` : ''}
                  {d?.school?.name ? ` · ${d.school.name}` : ''}
                </div>
              </div>
              <div className="flex gap-5 flex-shrink-0">
                <div id="child-banner-attendance" className="text-center">
                  <div className="text-[20px] font-extrabold" style={{ color: '#f59e0b' }}>
                    {d ? `${d.attendance?.percentage ?? 0}%` : '—'}
                  </div>
                  <div className="text-[10px]" style={{ color: '#a8a29e' }}>Attendance</div>
                </div>
                <div id="child-banner-average" className="text-center">
                  <div className="text-[20px] font-extrabold text-green-400">
                    {myAvg != null ? `${myAvg}%` : '—'}
                  </div>
                  <div className="text-[10px]" style={{ color: '#a8a29e' }}>Average</div>
                </div>
                <div id="child-banner-balance" className="text-center">
                  <div className="text-[20px] font-extrabold" style={{ color: feePaid ? '#fb923c' : '#f87171' }}>
                    {d ? feeDisplay : '—'}
                  </div>
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

          {/* ── Main content (only when child data loaded) ──────── */}
          {d && !loadingChild && (
            <AnimatePresence mode="wait">
              <motion.div
                key={`child-view-${activeChildId}`}
                id={`child-view-${activeChildId}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >

                {/* ── Two-column grid ─────────────────────────────── */}
                <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 380px' }}>

                  {/* LEFT: Fee Statement */}
                  <div id="section-fees" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between">
                      <div>
                        <h2 className="text-[13px] font-bold text-slate-900">Fee Statement — {termLabel}</h2>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {d.school?.name ?? 'School'} · {d.school?.academicYear ?? ''}
                        </p>
                      </div>
                      <span
                        id="fee-status-badge"
                        className={`text-[11px] font-semibold px-2.5 py-[5px] rounded-full ${
                          feePaid
                            ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                            : 'text-red-700 bg-red-50 border border-red-200'
                        }`}
                      >
                        {feePaid ? 'Cleared' : 'Balance Due'}
                      </span>
                    </div>

                    {/* Fee breakdown table */}
                    <div className="px-[18px] py-3.5">
                      {d.feeBreakdown?.length > 0 ? (
                        /* Structured breakdown if API provides it */
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
                              <tr
                                key={`fee-item-${item.id ?? i}`}
                                id={`fee-item-${item.id ?? i}`}
                                className="border-b border-slate-50 last:border-0"
                              >
                                <td className="py-2.5 text-slate-700">{item.label ?? item.name}</td>
                                <td className="py-2.5 text-right text-slate-700">
                                  KSh {(item.amount ?? 0).toLocaleString()}
                                </td>
                                <td className="py-2.5 text-right font-semibold text-emerald-600">
                                  KSh {(item.paid ?? item.amount ?? 0).toLocaleString()}
                                </td>
                                <td className="py-2.5 text-right font-semibold text-emerald-600">
                                  {(item.balance ?? 0) === 0 ? 'Nil' : `KSh ${item.balance.toLocaleString()}`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      ) : (
                        /* Summary view when no breakdown — show balance and payments */
                        <div id="fee-summary-view" className="space-y-2 mb-4">
                          <div className="flex items-center justify-between py-2 border-b border-slate-50">
                            <span className="text-[12px] text-slate-600">Total Fees</span>
                            <span className="text-[12px] font-semibold text-slate-800">
                              {d.termFeeTotal
                                ? `KSh ${d.termFeeTotal.toLocaleString()}`
                                : '—'
                              }
                            </span>
                          </div>
                          <div className="flex items-center justify-between py-2 border-b border-slate-50">
                            <span className="text-[12px] text-slate-600">Amount Paid</span>
                            <span className="text-[12px] font-semibold text-emerald-600">
                              {d.termFeeTotal && d.feeBalance != null
                                ? `KSh ${(d.termFeeTotal - d.feeBalance).toLocaleString()}`
                                : '—'
                              }
                            </span>
                          </div>
                          <div className="flex items-center justify-between py-2">
                            <span className="text-[12px] text-slate-600">Outstanding Balance</span>
                            <span className={`text-[12px] font-bold ${feePaid ? 'text-emerald-600' : 'text-red-600'}`}>
                              {feeDisplay}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Cleared / balance notice */}
                      {feePaid ? (
                        <div
                          id="fee-cleared-notice"
                          className="bg-emerald-50 rounded-[8px] px-3.5 py-2.5 border border-emerald-200"
                        >
                          <div className="text-[12px] font-bold text-emerald-700">✓ All fees paid for this term</div>
                          {d.recentPayments?.[0] && (
                            <div className="text-[11px] text-emerald-600 mt-1">
                              Last payment: KSh {(d.recentPayments[0].amount ?? 0).toLocaleString()}
                              {d.recentPayments[0].paidAt
                                ? ` via M-Pesa on ${_fmtDate(d.recentPayments[0].paidAt)}`
                                : ''}
                              {d.recentPayments[0].mpesaCode
                                ? ` · Ref: ${d.recentPayments[0].mpesaCode}`
                                : ''}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div
                          id="fee-balance-notice"
                          className="bg-red-50 rounded-[8px] px-3.5 py-2.5 border border-red-200"
                        >
                          <div className="text-[12px] font-bold text-red-700">
                            Outstanding: {feeDisplay}
                          </div>
                          {d.nextFeeDueDate && (
                            <div className="text-[11px] text-red-600 mt-1">
                              Due by {_fmtDate(d.nextFeeDueDate)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Recent payments list */}
                      {d.recentPayments?.length > 0 && (
                        <div id="recent-payments-list" className="mt-4 border-t border-slate-100 pt-3 space-y-2">
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.04em] mb-2">
                            Recent Payments
                          </p>
                          {d.recentPayments.map((p, i) => (
                            <div
                              key={`payment-${p.id ?? i}`}
                              id={`payment-item-${p.id ?? i}`}
                              className="flex items-center justify-between"
                            >
                              <div>
                                <p className="text-[12px] font-semibold text-slate-800">
                                  KSh {(p.amount ?? 0).toLocaleString()}
                                </p>
                                {p.mpesaCode && (
                                  <p className="text-[10px] text-slate-400 font-mono">{p.mpesaCode}</p>
                                )}
                              </div>
                              <span className="text-[11px] text-slate-400">
                                {p.paidAt
                                  ? new Date(p.paidAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                                  : '—'
                                }
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* RIGHT column */}
                  <div className="flex flex-col gap-3.5">

                    {/* Grades */}
                    <div id="section-grades" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                      <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between">
                        <h2 className="text-[13px] font-bold text-slate-900">
                          {activeChild?.name?.split(' ')[0]}'s Grades — {termLabel}
                        </h2>
                        {activeChild?.className && (
                          <span
                            id="grades-class-badge"
                            className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2.5 py-[5px] rounded-full"
                          >
                            {activeChild.className}
                          </span>
                        )}
                      </div>
                      <div id="grades-list" className="px-[18px] py-3.5 space-y-3.5">
                        {!d.lessonsCoverage?.length ? (
                          <p id="grades-empty" className="text-[12px] text-slate-400 text-center py-4">
                            No grade data available yet
                          </p>
                        ) : (
                          d.lessonsCoverage.map((sub, i) => (
                            <GradeBar
                              key={`grade-${sub.subjectId ?? i}`}
                              id={`grade-bar-${sub.subjectId ?? i}`}
                              label={sub.subjectName}
                              pct={sub.percentage ?? 0}
                              delay={i * 0.07}
                            />
                          ))
                        )}
                        {myAvg != null && d.lessonsCoverage?.length > 0 && (
                          <div
                            id="grades-class-avg-note"
                            className="mt-2 text-[11px] text-slate-500 px-3 py-2 bg-slate-50 rounded-[7px]"
                          >
                            Overall average: <span className="font-bold text-indigo-600">{myAvg}%</span>
                            {d.classAverage != null && (
                              <> · Class average: <span className="font-bold">{d.classAverage}%</span></>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Recent Messages / Announcements */}
                    <div id="section-messages" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                      <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between">
                        <h2 className="text-[13px] font-bold text-slate-900">Recent School Messages</h2>
                        {unreadCount > 0 && (
                          <span
                            id="messages-unread-badge"
                            className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2.5 py-[5px] rounded-full"
                          >
                            {unreadCount} unread
                          </span>
                        )}
                      </div>
                      <div id="messages-list" className="px-[18px] py-3.5">
                        {!d.announcements?.length ? (
                          <p id="messages-empty" className="text-[12px] text-slate-400 text-center py-4">
                            No messages yet
                          </p>
                        ) : (
                          <div className="space-y-3.5">
                            {d.announcements.map((ann, i) => {
                              const isFirst = i === 0;
                              return (
                                <div
                                  key={`ann-${ann.id ?? i}`}
                                  id={`announcement-${ann.id ?? i}`}
                                  className="flex items-start gap-3"
                                >
                                  <div
                                    className="w-2 h-2 rounded-full mt-[5px] flex-shrink-0"
                                    style={{ background: isFirst ? '#4f46e5' : '#22c55e' }}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-[12px] font-semibold text-slate-800 leading-snug">
                                      {ann.title}
                                    </p>
                                    {ann.body && (
                                      <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">{ann.body}</p>
                                    )}
                                    <p className="text-[10px] text-slate-400 mt-1">
                                      {ann.createdAt
                                        ? new Date(ann.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                                        : '—'}
                                      {isFirst && unreadCount > 0 && (
                                        <> · <span className="font-semibold text-amber-500">Unread</span></>
                                      )}
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

                {/* ── Attendance detail ────────────────────────────── */}
                <div id="section-attendance" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity size={14} className="text-emerald-500" />
                      <h2 className="text-[13px] font-bold text-slate-900">Attendance</h2>
                    </div>
                    <span
                      id="attendance-pct-badge"
                      className={`text-[11px] font-semibold px-2.5 py-[5px] rounded-full ${
                        (d.attendance?.percentage ?? 0) >= 80
                          ? 'text-emerald-700 bg-emerald-50'
                          : 'text-amber-700 bg-amber-50'
                      }`}
                    >
                      {d.attendance?.percentage ?? 0}% this term
                    </span>
                  </div>
                  <div className="px-[18px] py-4 grid grid-cols-4 gap-4">
                    {[
                      { id: 'att-present',  label: 'Present',   value: d.attendance?.present  ?? 0, color: 'bg-emerald-500', text: 'text-emerald-600' },
                      { id: 'att-absent',   label: 'Absent',    value: d.attendance?.absent   ?? 0, color: 'bg-red-400',     text: 'text-red-600'     },
                      { id: 'att-late',     label: 'Late',      value: d.attendance?.late     ?? 0, color: 'bg-amber-400',   text: 'text-amber-600'   },
                      { id: 'att-total',    label: 'Total Days', value: d.attendance?.total   ?? 0, color: 'bg-slate-300',   text: 'text-slate-700'   },
                    ].map(({ id, label, value, color, text }) => (
                      <div key={id} id={id} className="text-center">
                        <div className={`text-[22px] font-extrabold ${text}`}>{value}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{label}</div>
                        <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${color}`}
                            style={{
                              width: d.attendance?.total
                                ? `${Math.round((value / d.attendance.total) * 100)}%`
                                : '0%',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Recent attendance records */}
                  {d.recentAttendance?.length > 0 && (
                    <div id="recent-attendance-list" className="px-[18px] pb-4 space-y-1.5 border-t border-slate-100 pt-3">
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-[0.04em] mb-2">Recent Records</p>
                      {d.recentAttendance.map((rec, i) => (
                        <div
                          key={`att-rec-${rec.id ?? i}`}
                          id={`att-rec-${rec.id ?? i}`}
                          className="flex items-center justify-between"
                        >
                          <span className="text-[11px] text-slate-500">
                            {rec.date
                              ? new Date(rec.date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
                              : '—'
                            }
                          </span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize
                            ${rec.status === 'present' ? 'bg-emerald-50 text-emerald-700'
                            : rec.status === 'absent'  ? 'bg-red-50 text-red-700'
                            : 'bg-amber-50 text-amber-700'}`}>
                            {rec.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ── Today's timetable ─────────────────────────────── */}
                {d.timetableToday?.length > 0 && (
                  <div id="section-timetable" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Calendar size={14} className="text-sky-500" />
                        <h2 className="text-[13px] font-bold text-slate-900">Today's Timetable</h2>
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                    {d.school?.emergencyOnlineMode && (
                      <div id="emergency-online-banner" className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-50 border border-sky-200">
                        <MonitorPlay size={12} className="text-sky-600 flex-shrink-0" />
                        <p className="text-[11px] font-semibold text-sky-700">Emergency Online Learning — all lessons are online today</p>
                      </div>
                    )}
                    <div id="timetable-slots" className="divide-y divide-slate-50">
                      {d.timetableToday.map((slot, i) => {
                        const start = _timeToMins(slot.startTime);
                        const end   = _timeToMins(slot.endTime);
                        const isNow  = start <= nowMins && nowMins < end;
                        const isNext = !activeSlot && slot === nextSlot;
                        return (
                          <div
                            key={`tt-${slot.id ?? i}`}
                            id={`timetable-slot-${slot.id ?? i}`}
                            className={`flex items-center gap-3 px-4 py-3 transition-colors
                              ${isNow  ? 'bg-amber-50 border-l-[3px] border-l-amber-500' : ''}
                              ${isNext ? 'bg-slate-50' : ''}
                            `}
                          >
                            <div className="text-center min-w-[60px] flex-shrink-0">
                              {isNow
                                ? <div className="text-[10px] font-bold text-amber-700 uppercase">NOW</div>
                                : isNext
                                ? <div className="text-[10px] font-bold text-slate-500 uppercase">NEXT</div>
                                : null
                              }
                              <div className="text-[10px] text-slate-400">{slot.startTime}</div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-[13px] font-bold truncate ${isNow ? 'text-slate-900' : 'text-slate-700'}`}>
                                {slot.subjectName}
                              </p>
                              <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                {[slot.room, slot.teacherName].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            {isNow && (
                              <span className="text-[11px] font-semibold text-amber-600 bg-amber-100 px-2.5 py-[4px] rounded-full flex-shrink-0">
                                In progress
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Curriculum coverage ──────────────────────────── */}
                {d.lessonsCoverage?.length > 0 && (
                  <div id="section-curriculum" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center gap-2">
                      <BookCheck size={14} className="text-indigo-500" />
                      <h2 className="text-[13px] font-bold text-slate-900">Curriculum Coverage</h2>
                    </div>
                    <div id="curriculum-list" className="px-[18px] py-4 space-y-4">
                      {d.lessonsCoverage.map((sub, i) => (
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
                  </div>
                )}

                {/* ── Report cards ─────────────────────────────────── */}
                {d.reportCards?.length > 0 && (
                  <div id="section-reports" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-violet-500" />
                        <h2 className="text-[13px] font-bold text-slate-900">Report Cards</h2>
                      </div>
                      {rcLocked && (
                        <span className="text-[11px] font-semibold text-amber-600 bg-amber-50 px-2.5 py-[5px] rounded-full">
                          Fee-locked
                        </span>
                      )}
                    </div>
                    <div className="px-[18px] py-4">
                      {rcLocked && (
                        <div id="rc-locked-notice" className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800 mb-4">
                          <Lock size={11} className="mt-0.5 flex-shrink-0 text-amber-500" />
                          <span>
                            Locked — <strong>{d.feeClearancePct}%</strong> fees cleared,{' '}
                            minimum <strong>{rcThreshold}%</strong> required.
                          </span>
                        </div>
                      )}
                      {dlError && <p id="dl-error-msg" className="text-[11px] text-red-600 mb-3">{dlError}</p>}
                      <div className="grid sm:grid-cols-2 gap-2.5">
                        {d.reportCards.map(rc => {
                          const rcId = rc.id ?? rc._id?.toString();
                          const lbl  = `${rc.academicYear}-T${rc.termNumber}`;
                          const busy = downloading === rcId;
                          return (
                            <div
                              key={`rc-${rcId}`}
                              id={`report-card-${rcId}`}
                              className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-slate-200 bg-slate-50"
                            >
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${rcLocked ? 'bg-slate-100' : 'bg-violet-50'}`}>
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
                                  id={`download-rc-${rcId}`}
                                  onClick={() => {
                                    setDlError('');
                                    setDownloading(rcId);
                                    _downloadRC(rcId, lbl)
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
                    </div>
                  </div>
                )}

                {/* ── Upcoming exams ────────────────────────────────── */}
                {d.upcomingExams?.length > 0 && (
                  <div id="section-exams" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-rose-500" />
                        <h2 className="text-[13px] font-bold text-slate-900">Upcoming Exams</h2>
                      </div>
                      <span className="text-[11px] font-semibold text-rose-600 bg-rose-50 px-2.5 py-[5px] rounded-full">
                        {d.upcomingExams.length} scheduled
                      </span>
                    </div>
                    <div id="exams-list" className="divide-y divide-slate-50">
                      {d.upcomingExams.map((ex, i) => {
                        const days = _daysUntil(ex.date);
                        const urg  = days === 0 ? 'text-red-600 bg-red-50' : days != null && days <= 3 ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-50';
                        return (
                          <div
                            key={`exam-${ex.id ?? i}`}
                            id={`exam-item-${ex.id ?? i}`}
                            className="flex items-center gap-3 px-[18px] py-3"
                          >
                            <div className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center text-center flex-shrink-0 ${urg}`}>
                              <p className="text-sm font-bold leading-none">
                                {days === 0 ? '!' : (days ?? '?')}
                              </p>
                              {days != null && days > 0 && (
                                <p className="text-[9px]">day{days !== 1 ? 's' : ''}</p>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-semibold text-slate-800 truncate">{ex.subjectName}</p>
                              <p className="text-[11px] text-slate-400">
                                {_weekday(ex.date)}, {_fmtDate(ex.date)}
                                {ex.startTime ? ` · ${ex.startTime}` : ''}
                                {ex.type ? ` · ${ex.type}` : ''}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── School events / calendar ──────────────────────── */}
                {d.upcomingEvents?.length > 0 && (
                  <div id="section-calendar" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center gap-2">
                      <Calendar size={14} className="text-blue-500" />
                      <h2 className="text-[13px] font-bold text-slate-900">School Calendar</h2>
                    </div>
                    <div id="events-list" className="divide-y divide-slate-50">
                      {d.upcomingEvents.map((ev, i) => {
                        const days = _daysUntil(ev.date);
                        return (
                          <div
                            key={`ev-${ev.id ?? i}`}
                            id={`event-item-${ev.id ?? i}`}
                            className="flex items-center gap-3 px-[18px] py-3"
                          >
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

                {/* ── Behaviour & Rewards ──────────────────────────── */}
                {d.behaviourSummary && (
                  <div id="section-behaviour" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center gap-2">
                      <Star size={14} className="text-amber-500" />
                      <h2 className="text-[13px] font-bold text-slate-900">Behaviour &amp; Rewards</h2>
                    </div>
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
                            <p className="text-[12px] font-medium text-slate-800 mt-0.5">
                              {latestReward.title || latestReward.category || 'Reward'}
                            </p>
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
                  </div>
                )}

                {/* ── Full announcements ────────────────────────────── */}
                {d.announcements?.length > 0 && (
                  <div id="section-announcements" className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center gap-2">
                      <Bell size={14} className="text-amber-500" />
                      <h2 className="text-[13px] font-bold text-slate-900">Announcements</h2>
                    </div>
                    <div id="announcements-list" className="divide-y divide-slate-50">
                      {d.announcements.map((ann, i) => (
                        <div
                          key={`full-ann-${ann.id ?? i}`}
                          id={`full-announcement-${ann.id ?? i}`}
                          className="px-[18px] py-3.5"
                        >
                          <p className="text-[13px] font-semibold text-slate-800 mb-0.5">{ann.title}</p>
                          {ann.body && (
                            <p className="text-[12px] text-slate-500 leading-relaxed">{ann.body}</p>
                          )}
                          <p className="text-[10px] text-slate-400 mt-1.5">{_fmtDate(ann.createdAt)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Bottom spacer */}
                <div className="h-4" />

              </motion.div>
            </AnimatePresence>
          )}

        </main>
      </div>
      {/* end MAIN AREA */}

    </div>
  );
}
