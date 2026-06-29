/**
 * Msingi — Parent Portal Dashboard
 * Family-first design: all children visible at once, one click to drill into a child.
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '@/store/auth.js';
import {
  Activity, AlertCircle, Award, Bell, BookCheck, Calendar,
  CheckCircle, Clock, Download, FileText, GraduationCap,
  Lock, LogOut, MapPin, MessageSquare, Receipt,
  Star, TrendingUp, Wallet, ChevronRight, MonitorPlay,
} from 'lucide-react';

/* ── Constants ────────────────────────────────────────────── */
const VIOLET  = '#7c3aed';
const EMERALD = '#10b981';
const AMBER   = '#f59e0b';
const RED     = '#ef4444';

const CHILD_PALETTE = [
  { bg: 'bg-violet-500', light: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200'  },
  { bg: 'bg-sky-500',    light: 'bg-sky-50',     text: 'text-sky-700',     border: 'border-sky-200'     },
  { bg: 'bg-emerald-500',light: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  { bg: 'bg-rose-500',   light: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200'    },
  { bg: 'bg-amber-500',  light: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200'   },
];
const EVENT_COLORS = {
  exam:'#ef4444', term:'#7c3aed', meeting:'#3b82f6',
  sports:'#10b981', cultural:'#f59e0b', training:'#06b6d4',
  academic:'#6366f1', break:'#94a3b8', general:'#64748b',
};

/* ── API helpers ──────────────────────────────────────────── */
const API_BASE = import.meta.env.VITE_API_BASE || '';
function _token() { return useAuthStore.getState().session?.token || ''; }
async function _fetch(path) {
  const res  = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${_token()}` } });
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
  const res = await fetch(`${API_BASE}/api/report-cards/${rcId}/pdf`, {
    headers: { Authorization: `Bearer ${_token()}` },
  });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Download failed'); }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `report-${label}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Pure helpers ─────────────────────────────────────────── */
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
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}
function _timeToMins(t = '') {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function _nowMins() { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); }

/* ── Sub-components ───────────────────────────────────────── */

function AttRing({ pct = 0, size = 64, stroke = 6 }) {
  const r    = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const off  = circ - (pct / 100) * circ;
  const color = pct >= 80 ? EMERALD : pct >= 60 ? AMBER : RED;
  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.9s ease' }} />
    </svg>
  );
}

function ProgressBar({ pct = 0 }) {
  const color = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <motion.div className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }} animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }} />
    </div>
  );
}

function SectionCard({ title, icon: Icon, iconColor = 'text-violet-500', children, badge }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
        <Icon size={14} className={iconColor} />
        <h3 className="text-sm font-semibold text-slate-800 flex-1">{title}</h3>
        {badge}
      </div>
      {children}
    </div>
  );
}

function BehaviourBadge({ level }) {
  if (!level) return null;
  const m = { gold: ['🥇','text-amber-600','bg-amber-50','border-amber-200'], silver: ['🥈','text-slate-500','bg-slate-50','border-slate-200'], bronze: ['🥉','text-orange-500','bg-orange-50','border-orange-200'] };
  const [icon, tc, bg, bc] = m[level] ?? m.bronze;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${bg} ${tc} ${bc}`}>
      {icon} {level.charAt(0).toUpperCase() + level.slice(1)}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */
export default function ParentDashboard() {
  const navigate = useNavigate();
  const logout   = useAuthStore(s => s.logout);
  const session  = useAuthStore(s => s.session);

  const [children,       setChildren]       = useState([]);
  const [activeChildId,  setActiveChildId]  = useState(null);
  const [childData,      setChildData]      = useState(null);
  const [familySummary,  setFamilySummary]  = useState(null);
  const [loadingList,    setLoadingList]    = useState(true);
  const [loadingChild,   setLoadingChild]   = useState(false);
  const [downloading,    setDownloading]    = useState(null);
  const [dlError,        setDlError]        = useState('');
  const [initError,      setInitError]      = useState('');

  const parentName = session?.user?.name ?? session?.user?.firstName ?? '';

  /* ── Auth guard ── */
  useEffect(() => {
    if (!session?.token) { navigate('/login', { replace: true }); return; }
    const role = session.user?.role;
    if (role !== 'parent' && role !== 'guardian') { navigate('/dashboard', { replace: true }); return; }
  }, []);

  /* ── Load children list + family summary in parallel ── */
  useEffect(() => {
    if (!session?.token) return;
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
      setInitError(e.message); setLoadingList(false);
    });
  }, []);

  /* ── Load child dashboard when active child changes ── */
  useEffect(() => {
    if (!activeChildId) return;
    setLoadingChild(true);
    setChildData(null);
    _fetch(`/api/parent-portal/dashboard/${activeChildId}`)
      .then(d => { setChildData(d); setLoadingChild(false); })
      .catch(e => {
        if (e.code === 'auth_expired') { logout(); navigate('/login', { replace: true }); return; }
        setLoadingChild(false);
      });
  }, [activeChildId]);

  function handleLogout() { logout(); navigate('/login', { replace: true }); }

  /* ── Loading / error screens ── */
  if (loadingList) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Loading parent dashboard…</p>
      </div>
    </div>
  );
  if (initError) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-red-100 p-8 max-w-md text-center">
        <AlertCircle size={32} className="text-red-400 mx-auto mb-3" />
        <p className="text-slate-700 font-medium mb-1">Could not load dashboard</p>
        <p className="text-sm text-slate-400">{initError}</p>
        <button onClick={handleLogout} className="mt-4 text-sm text-violet-600 hover:underline">Sign out</button>
      </div>
    </div>
  );

  /* ── Derived values ── */
  const activeChild = children.find(c => c.id === activeChildId) ?? children[0] ?? null;
  const d = childData;
  const portalConfig    = d?.school?.portalConfig ?? {};
  const rcThreshold     = portalConfig.reportCardFeeThreshold ?? 100;
  const rcLocked        = rcThreshold > 0 && (d?.feeClearancePct ?? 100) < rcThreshold;

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Sticky header ──────────────────────────────────── */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-white text-[10px] font-bold">M</div>
            <span className="text-sm font-bold text-slate-900">Msingi</span>
            <span className="text-slate-300 mx-1">·</span>
            <span className="text-xs font-medium text-slate-500">Parent Portal</span>
          </div>
          <div className="flex items-center gap-3">
            {(familySummary?.unreadMessages ?? 0) > 0 && (
              <div className="relative">
                <MessageSquare size={16} className="text-slate-400" />
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-violet-600 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                  {familySummary.unreadMessages}
                </span>
              </div>
            )}
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 transition px-2 py-1.5 rounded-lg hover:bg-red-50">
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* ── Hero ────────────────────────────────────────────── */}
        <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.4 }}
          className="bg-gradient-to-br from-violet-600 via-violet-700 to-violet-900 rounded-2xl p-6 text-white relative overflow-hidden">
          <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-white/5" />
          <div className="absolute -bottom-10 -right-4 w-48 h-48 rounded-full bg-white/5" />
          <p className="text-violet-300 text-[11px] font-semibold uppercase tracking-widest mb-1 relative">
            {d?.school?.name ?? ''}
          </p>
          <h1 className="text-2xl font-bold mb-0.5 relative">
            {_greeting()}{parentName ? `, ${parentName.split(' ')[0]}` : ''} 👋
          </h1>
          <p className="text-violet-200 text-sm relative">
            {children.length} {children.length === 1 ? 'child' : 'children'} · {d?.school?.academicYear ?? ''}
          </p>
        </motion.div>

        {/* ── Family summary strip ──────────────────────────────── */}
        {familySummary && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                icon: Wallet, label: 'Total Balance',
                value: familySummary.totalBalance > 0 ? `KSh ${familySummary.totalBalance.toLocaleString()}` : 'All Cleared',
                sub: familySummary.totalBalance > 0 ? 'outstanding' : '✓ no debt',
                iconBg: familySummary.totalBalance > 0 ? 'bg-red-50' : 'bg-emerald-50',
                valColor: familySummary.totalBalance > 0 ? 'text-red-600' : 'text-emerald-600',
              },
              {
                icon: CheckCircle, label: 'Present Today',
                value: `${familySummary.presentToday}/${familySummary.childrenCount}`,
                sub: 'children at school',
                iconBg: familySummary.presentToday === familySummary.childrenCount ? 'bg-emerald-50' : 'bg-amber-50',
                valColor: familySummary.presentToday === familySummary.childrenCount ? 'text-emerald-600' : 'text-amber-600',
              },
              {
                icon: Calendar, label: 'Upcoming Events',
                value: familySummary.upcomingEvents,
                sub: 'scheduled',
                iconBg: 'bg-violet-50', valColor: 'text-violet-700',
              },
              {
                icon: MessageSquare, label: 'Messages',
                value: familySummary.unreadMessages,
                sub: familySummary.unreadMessages === 0 ? 'all read' : 'unread',
                iconBg: familySummary.unreadMessages > 0 ? 'bg-amber-50' : 'bg-slate-50',
                valColor: familySummary.unreadMessages > 0 ? 'text-amber-600' : 'text-slate-500',
              },
            ].map(({ icon: Icon, label, value, sub, iconBg, valColor }) => (
              <motion.div key={label} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }}
                className="bg-white border border-slate-200 rounded-xl p-3.5">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 ${iconBg}`}>
                  <Icon size={13} className={valColor} />
                </div>
                <p className={`text-lg font-bold ${valColor}`}>{value}</p>
                <p className="text-[11px] font-medium text-slate-500 mt-0.5">{label}</p>
                <p className="text-[10px] text-slate-400">{sub}</p>
              </motion.div>
            ))}
          </div>
        )}

        {/* ── Children cards ────────────────────────────────────── */}
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            {children.length === 1 ? 'Your Child' : 'Your Children'}
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {children.map((child, idx) => {
              const pal      = CHILD_PALETTE[idx % CHILD_PALETTE.length];
              const isActive = child.id === activeChildId;
              return (
                <motion.button key={child.id}
                  onClick={() => setActiveChildId(child.id)}
                  whileTap={{ scale: 0.98 }}
                  className={`text-left rounded-2xl border-2 p-4 transition-all ${
                    isActive
                      ? `${pal.border} ${pal.light} shadow-sm`
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-xl ${pal.bg} flex items-center justify-center text-white font-bold text-sm shrink-0`}>
                      {child.name?.[0] ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{child.name}</p>
                      <p className="text-[11px] text-slate-400 truncate">{child.className} · {child.admissionNumber}</p>
                    </div>
                    {isActive && (
                      <ChevronRight size={14} className={pal.text} />
                    )}
                  </div>
                  {/* Mini stats — only show if we have data for this child */}
                  {isActive && d && (
                    <div className="grid grid-cols-2 gap-2 mt-1">
                      <div className={`rounded-lg px-2 py-1.5 ${pal.light}`}>
                        <p className={`text-xs font-bold ${pal.text}`}>{d.attendance.percentage}%</p>
                        <p className="text-[10px] text-slate-400">Attendance</p>
                      </div>
                      <div className={`rounded-lg px-2 py-1.5 ${d.feeBalance > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
                        <p className={`text-xs font-bold ${d.feeBalance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {d.feeBalance > 0 ? `KSh ${d.feeBalance.toLocaleString()}` : 'Cleared'}
                        </p>
                        <p className="text-[10px] text-slate-400">Balance</p>
                      </div>
                    </div>
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* ── Child detail panel ──────────────────────────────────── */}
        {loadingChild && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-violet-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {d && !loadingChild && activeChild && (() => {
          const palIdx = children.findIndex(c => c.id === activeChildId);
          const pal    = CHILD_PALETTE[palIdx % CHILD_PALETTE.length];

          /* Derived */
          const attColor = d.attendance.percentage >= 80 ? 'text-emerald-600' : d.attendance.percentage >= 60 ? 'text-amber-600' : 'text-red-600';
          const { totalPoints = 0, badgeLevel, latestReward, latestComment } = d.behaviourSummary ?? {};
          const nowMins = _nowMins();
          const activeSlot = d.timetableToday?.find(s => _timeToMins(s.startTime) <= nowMins && nowMins < _timeToMins(s.endTime)) ?? null;
          const nextSlot   = d.timetableToday?.find(s => _timeToMins(s.startTime) > nowMins) ?? null;

          return (
            <AnimatePresence mode="wait">
              <motion.div key={activeChildId}
                initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
                className="space-y-5">

                {/* Child header */}
                <div className={`rounded-2xl p-4 border ${pal.border} ${pal.light}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-12 h-12 rounded-xl ${pal.bg} flex items-center justify-center text-white font-bold text-lg shrink-0`}>
                      {activeChild.name?.[0] ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h2 className="text-base font-bold text-slate-900">{activeChild.name}</h2>
                      <p className="text-xs text-slate-500">
                        {activeChild.className} · {activeChild.admissionNumber}
                        {d.classTeacher ? ` · ${d.classTeacher}` : ''}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold ${attColor}`}>{d.attendance.percentage}%</p>
                      <p className="text-[10px] text-slate-400">attendance</p>
                    </div>
                  </div>
                </div>

                {/* Snapshot strip */}
                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                  {[
                    { icon: Clock,         label: 'Today',      value: d.timetableToday?.length ?? 0, sub: activeSlot ? `Now: ${activeSlot.subjectName?.split(' ')[0]}` : nextSlot ? 'Next up' : 'No lessons', bg: 'bg-violet-50', vc: 'text-violet-700' },
                    { icon: CheckCircle,   label: 'Attendance', value: `${d.attendance.percentage}%`, sub: `${d.attendance.present} days`, bg: d.attendance.percentage >= 80 ? 'bg-emerald-50' : 'bg-amber-50', vc: d.attendance.percentage >= 80 ? 'text-emerald-600' : 'text-amber-600' },
                    { icon: Wallet,        label: 'Fees',       value: d.feeBalance > 0 ? `KSh ${d.feeBalance.toLocaleString()}` : 'Cleared', sub: d.nextFeeDueDate && d.feeBalance > 0 ? `Due ${_fmtDate(d.nextFeeDueDate)}` : d.feeBalance <= 0 ? '✓ paid' : '', bg: d.feeBalance <= 0 ? 'bg-emerald-50' : 'bg-red-50', vc: d.feeBalance <= 0 ? 'text-emerald-600' : 'text-red-600' },
                    { icon: Award,         label: 'Behaviour',  value: `+${totalPoints}`, sub: badgeLevel ?? 'no badge', bg: 'bg-amber-50', vc: 'text-amber-600' },
                    { icon: FileText,      label: 'Exams',      value: d.upcomingExams?.length ?? 0, sub: d.upcomingExams?.[0] ? _fmtDate(d.upcomingExams[0].date) : 'none', bg: 'bg-rose-50', vc: 'text-rose-600' },
                    { icon: GraduationCap, label: 'Reports',    value: d.reportCards?.length ?? 0,   sub: 'published', bg: 'bg-blue-50', vc: 'text-blue-600' },
                  ].map(({ icon: Icon, label, value, sub, bg, vc }) => (
                    <div key={label} className={`rounded-xl p-3 border border-slate-100 ${bg}`}>
                      <Icon size={12} className={`mb-1.5 ${vc}`} />
                      <p className={`text-base font-bold leading-tight ${vc}`}>{value}</p>
                      <p className="text-[10px] font-medium text-slate-500 mt-0.5">{label}</p>
                      <p className="text-[9px] text-slate-400 truncate">{sub}</p>
                    </div>
                  ))}
                </div>

                {/* Two-column content grid */}
                <div className="grid lg:grid-cols-5 gap-5">

                  {/* ── Left (wider) ── */}
                  <div className="lg:col-span-3 space-y-5">

                    {/* Today's Timetable */}
                    <SectionCard title="Today's Timetable" icon={Calendar} iconColor="text-sky-500"
                      badge={<span className="text-[11px] text-slate-400">{new Date().toLocaleDateString('en-GB', { weekday:'long' })}</span>}>
                      {d.school?.emergencyOnlineMode && (
                        <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-50 border border-sky-200">
                          <MonitorPlay size={12} className="text-sky-600 shrink-0" />
                          <p className="text-[11px] font-semibold text-sky-700">Emergency Online Learning — all lessons are online</p>
                        </div>
                      )}
                      {!d.timetableToday?.length ? (
                        <p className="text-xs text-slate-400 text-center py-8">No lessons today</p>
                      ) : (
                        <div className="divide-y divide-slate-50 px-1 py-1">
                          {d.timetableToday.map((slot, i) => {
                            const start  = _timeToMins(slot.startTime);
                            const end    = _timeToMins(slot.endTime);
                            const isNow  = start <= nowMins && nowMins < end;
                            const isNext = !activeSlot && slot === nextSlot;
                            const isPast = end <= nowMins;
                            return (
                              <div key={i} className={`flex items-center gap-3 px-4 py-2.5 rounded-xl mx-1 my-0.5
                                ${isNow ? 'bg-violet-50 border border-violet-200' : ''}
                                ${isNext ? 'bg-amber-50 border border-amber-200' : ''}
                                ${isPast && !isNow ? 'opacity-50' : ''}`}>
                                <div className="text-center shrink-0 w-12">
                                  <p className={`text-[10px] font-bold ${isNow ? 'text-violet-700' : 'text-slate-600'}`}>{slot.startTime}</p>
                                  <p className="text-[10px] text-slate-400">{slot.endTime}</p>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5">
                                    <p className={`text-sm font-semibold truncate ${isNow ? 'text-violet-800' : 'text-slate-800'}`}>{slot.subjectName}</p>
                                    {isNow  && <span className="text-[9px] font-bold text-white bg-violet-500 px-1.5 py-0.5 rounded-full shrink-0">NOW</span>}
                                    {isNext && <span className="text-[9px] font-bold text-white bg-amber-400 px-1.5 py-0.5 rounded-full shrink-0">NEXT</span>}
                                  </div>
                                  {slot.teacherName && <p className="text-[11px] text-slate-400 truncate">{slot.teacherName}</p>}
                                </div>
                                {slot.room && <div className="flex items-center gap-1 text-[10px] text-slate-400 shrink-0"><MapPin size={9}/>{slot.room}</div>}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </SectionCard>

                    {/* Academic Trend */}
                    {d.academicTrend?.length > 0 && (
                      <SectionCard title="Academic Trend" icon={TrendingUp} iconColor="text-emerald-500">
                        <div className="px-5 py-4">
                          <div className="flex items-end gap-2 h-24">
                            {d.academicTrend.map((t, i) => {
                              const h = Math.round((t.average / 100) * 100);
                              const color = t.average >= 75 ? 'bg-emerald-400' : t.average >= 50 ? 'bg-amber-400' : 'bg-red-400';
                              return (
                                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                  <p className="text-[10px] font-bold text-slate-600">{t.average}%</p>
                                  <div className={`w-full rounded-t-lg ${color} transition-all`} style={{ height: `${h}%`, minHeight: '8px' }} />
                                  <p className="text-[9px] text-slate-400 text-center leading-tight">{t.label}</p>
                                </div>
                              );
                            })}
                          </div>
                          {d.academicTrend.length >= 2 && (() => {
                            const last  = d.academicTrend[d.academicTrend.length - 1].average;
                            const prev  = d.academicTrend[d.academicTrend.length - 2].average;
                            const delta = last - prev;
                            return (
                              <p className={`text-xs mt-3 font-medium ${delta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% from last term
                              </p>
                            );
                          })()}
                        </div>
                      </SectionCard>
                    )}

                    {/* Curriculum Coverage */}
                    {d.lessonsCoverage?.length > 0 && (
                      <SectionCard title="Curriculum Coverage" icon={BookCheck} iconColor="text-violet-500">
                        <div className="px-5 py-4 space-y-4">
                          {d.lessonsCoverage.map(sub => (
                            <div key={sub.subjectId}>
                              <div className="flex items-center justify-between mb-1.5">
                                <div>
                                  <span className="text-sm font-medium text-slate-800">{sub.subjectName}</span>
                                  <span className="text-[10px] text-slate-400 ml-2">{sub.coveredTopics}/{sub.totalTopics} topics</span>
                                </div>
                                <span className={`text-xs font-bold ${sub.percentage >= 80 ? 'text-emerald-600' : sub.percentage >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                                  {sub.percentage}%
                                </span>
                              </div>
                              <ProgressBar pct={sub.percentage} />
                            </div>
                          ))}
                        </div>
                      </SectionCard>
                    )}

                    {/* Report Cards */}
                    {d.reportCards?.length > 0 && (
                      <SectionCard title="Report Cards" icon={FileText} iconColor="text-violet-500">
                        <div className="px-5 py-4">
                          {rcLocked && (
                            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-4 text-xs text-amber-800">
                              <Lock size={12} className="mt-0.5 shrink-0 text-amber-500" />
                              <span>Locked — <strong>{d.feeClearancePct}%</strong> fees cleared, <strong>{rcThreshold}%</strong> required.</span>
                            </div>
                          )}
                          {dlError && <p className="text-[11px] text-red-600 mb-3">{dlError}</p>}
                          <div className="grid sm:grid-cols-2 gap-2.5">
                            {d.reportCards.map(rc => {
                              const rcId  = rc.id || rc._id?.toString();
                              const label = `${rc.academicYear}-T${rc.termNumber}`;
                              const busy  = downloading === rcId;
                              return (
                                <div key={rcId} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200">
                                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${rcLocked ? 'bg-slate-100' : 'bg-violet-50'}`}>
                                    {rcLocked ? <Lock size={12} className="text-slate-400" /> : <GraduationCap size={12} className="text-violet-600" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-slate-700">{rc.academicYear} · Term {rc.termNumber}</p>
                                    {rc.averageScore != null && <p className="text-[10px] text-slate-400">Avg: {rc.averageScore}%</p>}
                                  </div>
                                  {rcLocked
                                    ? <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">Locked</span>
                                    : (
                                      <button
                                        onClick={() => { setDlError(''); setDownloading(rcId); _downloadRC(rcId, label).catch(e => setDlError(e.message)).finally(() => setDownloading(null)); }}
                                        disabled={busy}
                                        className="flex items-center gap-1 text-[10px] font-semibold text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 px-2.5 py-1 rounded-full transition disabled:opacity-50">
                                        {busy ? <span className="w-3 h-3 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" /> : <Download size={10} />}
                                        {busy ? 'Saving…' : 'PDF'}
                                      </button>
                                    )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </SectionCard>
                    )}

                    {/* Recent Payments */}
                    {d.recentPayments?.length > 0 && (
                      <SectionCard title="Recent Payments" icon={Receipt} iconColor="text-emerald-500">
                        <div className="divide-y divide-slate-50">
                          {d.recentPayments.map((p, i) => (
                            <div key={i} className="flex items-center justify-between px-5 py-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-800">KSh {(p.amount||0).toLocaleString()}</p>
                                {p.mpesaCode && <p className="text-[11px] text-slate-400 font-mono">{p.mpesaCode}</p>}
                              </div>
                              <span className="text-[11px] text-slate-400">
                                {p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-GB', { day:'numeric', month:'short' }) : '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      </SectionCard>
                    )}

                  </div>

                  {/* ── Right column ── */}
                  <div className="lg:col-span-2 space-y-5">

                    {/* Upcoming Exams */}
                    {d.upcomingExams?.length > 0 && (
                      <SectionCard title="Upcoming Exams" icon={FileText} iconColor="text-rose-500">
                        <div className="divide-y divide-slate-50">
                          {d.upcomingExams.map((ex, i) => {
                            const days = _daysUntil(ex.date);
                            const urg  = days === 0 ? 'text-red-600 bg-red-50' : days <= 3 ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-50';
                            return (
                              <div key={i} className="flex items-center gap-3 px-5 py-3">
                                <div className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center text-center shrink-0 ${urg}`}>
                                  <p className="text-sm font-bold leading-none">{days === 0 ? '!' : days}</p>
                                  {days > 0 && <p className="text-[9px]">day{days !== 1 ? 's' : ''}</p>}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold text-slate-800 truncate">{ex.subjectName}</p>
                                  <p className="text-[11px] text-slate-400">{_weekday(ex.date)}, {_fmtDate(ex.date)}{ex.startTime ? ` · ${ex.startTime}` : ''}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </SectionCard>
                    )}

                    {/* Attendance Detail */}
                    <SectionCard title="Attendance" icon={Activity} iconColor="text-emerald-500">
                      <div className="px-5 py-4">
                        <div className="flex items-center gap-4 mb-4">
                          <div className="relative shrink-0">
                            <AttRing pct={d.attendance.percentage} />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <p className={`text-xs font-bold ${attColor}`}>{d.attendance.percentage}%</p>
                            </div>
                          </div>
                          <div className="flex-1 space-y-2">
                            {[
                              { label:'Present', v: d.attendance.present,  color:'bg-emerald-500' },
                              { label:'Absent',  v: d.attendance.absent,   color:'bg-red-400' },
                              { label:'Late',    v: d.attendance.late ?? 0, color:'bg-amber-400' },
                            ].map(({ label, v, color }) => (
                              <div key={label}>
                                <div className="flex justify-between text-[11px] mb-0.5">
                                  <span className="text-slate-500">{label}</span>
                                  <span className="font-semibold text-slate-700">{v ?? 0}</span>
                                </div>
                                <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${color}`}
                                    style={{ width: d.attendance.total ? `${Math.round(((v??0)/d.attendance.total)*100)}%` : '0%' }} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                        {/* Recent records */}
                        {d.recentAttendance?.length > 0 && (
                          <div className="space-y-1.5 border-t border-slate-100 pt-3">
                            {d.recentAttendance.map((rec, i) => (
                              <div key={i} className="flex items-center justify-between">
                                <span className="text-[11px] text-slate-500">
                                  {rec.date ? new Date(rec.date).toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' }) : '—'}
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
                    </SectionCard>

                    {/* Behaviour */}
                    <SectionCard title="Behaviour &amp; Rewards" icon={Star} iconColor="text-amber-500">
                      <div className="px-5 py-4">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
                            <p className="text-base font-bold text-amber-600">+{totalPoints}</p>
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-800">Behaviour Points</p>
                            <BehaviourBadge level={badgeLevel} />
                          </div>
                        </div>
                        {latestReward && (
                          <div className="bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 mb-2.5">
                            <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-0.5">Latest Reward</p>
                            <p className="text-sm font-medium text-slate-800">{latestReward.title || latestReward.category || 'Reward'}</p>
                            {latestReward.date && <p className="text-[10px] text-slate-400 mt-0.5">{_fmtDate(latestReward.date)}</p>}
                          </div>
                        )}
                        {latestComment?.description && (
                          <div className="bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5">
                            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Teacher Comment</p>
                            <p className="text-xs text-slate-700 italic">"{latestComment.description}"</p>
                          </div>
                        )}
                        {!latestReward && !latestComment?.description && (
                          <p className="text-xs text-slate-400 text-center py-2">No behaviour records yet</p>
                        )}
                      </div>
                    </SectionCard>

                    {/* Upcoming Events */}
                    {d.upcomingEvents?.length > 0 && (
                      <SectionCard title="School Events" icon={Calendar} iconColor="text-blue-500">
                        <div className="divide-y divide-slate-50">
                          {d.upcomingEvents.map((ev, i) => {
                            const days  = _daysUntil(ev.date);
                            const color = EVENT_COLORS[ev.category] ?? EVENT_COLORS.general;
                            return (
                              <div key={i} className="flex items-center gap-3 px-5 py-3">
                                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-slate-800 truncate">{ev.title}</p>
                                  <p className="text-[11px] text-slate-400">{_weekday(ev.date)}, {_fmtDate(ev.date)}</p>
                                </div>
                                <span className="text-[10px] text-slate-400 shrink-0">
                                  {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </SectionCard>
                    )}

                    {/* Announcements */}
                    {d.announcements?.length > 0 && (
                      <SectionCard title="Announcements" icon={Bell} iconColor="text-amber-500">
                        <div className="divide-y divide-slate-50">
                          {d.announcements.map((ann, i) => (
                            <div key={i} className="px-5 py-3.5">
                              <p className="text-sm font-semibold text-slate-800 mb-0.5">{ann.title}</p>
                              {ann.body && <p className="text-[11px] text-slate-500 line-clamp-2">{ann.body}</p>}
                              <p className="text-[10px] text-slate-400 mt-1">{_fmtDate(ann.createdAt)}</p>
                            </div>
                          ))}
                        </div>
                      </SectionCard>
                    )}

                  </div>
                </div>

                {/* ── Quick Actions ── */}
                <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Quick Actions</p>
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {[
                      { icon: Download,      label: 'Report Card',  fn: () => { const rc = d.reportCards?.[0]; if (rc && !rcLocked) _downloadRC(rc.id || rc._id?.toString(), `${rc.academicYear}-T${rc.termNumber}`); } },
                      { icon: MessageSquare, label: 'Message',      fn: null },
                      { icon: Wallet,        label: 'Pay Fees',     fn: null },
                      { icon: Activity,      label: 'Attendance',   fn: null },
                      { icon: Star,          label: 'Behaviour',    fn: null },
                      { icon: GraduationCap, label: 'Profile',      fn: null },
                    ].map(({ icon: Icon, label, fn }) => (
                      <button key={label} onClick={fn ?? undefined}
                        className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border border-slate-100 hover:border-violet-200 hover:bg-violet-50 transition group ${!fn ? 'opacity-50 cursor-default' : ''}`}>
                        <div className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-violet-100 flex items-center justify-center transition">
                          <Icon size={14} className="text-slate-600 group-hover:text-violet-600 transition" />
                        </div>
                        <p className="text-[10px] font-medium text-slate-500 group-hover:text-violet-600 transition text-center">{label}</p>
                      </button>
                    ))}
                  </div>
                </div>

              </motion.div>
            </AnimatePresence>
          );
        })()}

      </main>
    </div>
  );
}
