/**
 * Msingi — Student Portal Dashboard
 * Redesigned: Mission Control layout — answers the 7 daily questions at a glance.
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '@/store/auth.js';
import {
  BookCheck, Calendar, CheckCircle, Clock, Download, FileText,
  GraduationCap, LogOut, Wallet, AlertCircle, BookOpen,
  MonitorPlay, Play, Lock, Cake, Star, Award, Zap,
  Bell, ChevronRight, TrendingUp, TrendingDown, Minus,
  Users, MapPin, MessageSquare, Activity,
} from 'lucide-react';

/* ── Constants ──────────────────────────────────────────────── */
const INDIGO  = '#4f46e5';
const EMERALD = '#10b981';
const AMBER   = '#f59e0b';
const RED     = '#ef4444';

const EVENT_COLORS = {
  exam: RED, term: INDIGO, meeting: '#3b82f6',
  sports: EMERALD, cultural: AMBER, training: '#06b6d4',
  academic: '#6366f1', break: '#94a3b8', general: '#64748b',
};

/* ── API ────────────────────────────────────────────────────── */
const API_BASE = import.meta.env.VITE_API_BASE || '';
async function _fetch(path) {
  const res  = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  const json = await res.json();
  if (res.status === 401 || res.status === 403) {
    const err = new Error(json.error?.message || 'Session expired — please sign in again');
    err.code = 'auth_expired';
    throw err;
  }
  if (!json.success) throw new Error(json.error?.message || 'Failed to load');
  return json.data;
}

/* ── Helpers ────────────────────────────────────────────────── */
function _fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
function _daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr) - new Date()) / 86400000);
  return diff;
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
function _findActiveSlot(slots = []) {
  const now = _nowMins();
  return slots.find(s => _timeToMins(s.startTime) <= now && now < _timeToMins(s.endTime)) ?? null;
}
function _findNextSlot(slots = []) {
  const now = _nowMins();
  return slots.find(s => _timeToMins(s.startTime) > now) ?? null;
}

async function _downloadReport(rcId, label) {
  const res = await fetch(`${API_BASE}/api/report-cards/${rcId}/pdf`, {
    credentials: 'include',
  });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || 'Download failed'); }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `report-card-${label}.pdf`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ── Sub-components ─────────────────────────────────────────── */

function AttRing({ pct = 0, size = 72, stroke = 7 }) {
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

function ProgressBar({ pct = 0, color = 'bg-indigo-500' }) {
  return (
    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <motion.div className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }} animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }} />
    </div>
  );
}

function Badge({ level }) {
  if (!level) return null;
  const map = {
    gold:   { label: 'Gold',   bg: 'bg-amber-50',  text: 'text-amber-600',  border: 'border-amber-200',  icon: '🥇' },
    silver: { label: 'Silver', bg: 'bg-slate-50',  text: 'text-slate-500',  border: 'border-slate-200',  icon: '🥈' },
    bronze: { label: 'Bronze', bg: 'bg-orange-50', text: 'text-orange-500', border: 'border-orange-200', icon: '🥉' },
  };
  const { label, bg, text, border, icon } = map[level] ?? map.bronze;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${bg} ${text} ${border}`}>
      {icon} {label} Badge
    </span>
  );
}

function SectionCard({ title, icon: Icon, iconColor = 'text-indigo-500', children, action }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
        <Icon size={14} className={iconColor} />
        <h2 className="text-sm font-semibold text-slate-800 flex-1">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

function SnapshotCard({ icon: Icon, label, value, sub, bg, iconColor, valueColor }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl p-3.5 border border-slate-100 ${bg ?? 'bg-white'}`}>
      <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 ${iconColor ?? 'bg-indigo-50'}`}>
        <Icon size={13} className={valueColor ?? 'text-indigo-600'} />
      </div>
      <p className={`text-lg font-bold ${valueColor ?? 'text-slate-900'}`}>{value}</p>
      <p className="text-[11px] font-medium text-slate-500 mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN DASHBOARD
   ══════════════════════════════════════════════════════════════ */
export default function StudentDashboard() {
  const navigate = useNavigate();
  const logout   = useAuthStore(s => s.logout);
  const session  = useAuthStore(s => s.session);

  const [data,        setData]        = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [bdayData,    setBdayData]    = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [dlError,     setDlError]     = useState('');

  useEffect(() => {
    if (!session?.user)                    { navigate('/login',     { replace: true }); return; }
    if (session.user?.role !== 'student')   { navigate('/dashboard', { replace: true }); return; }
    _fetch('/api/student-portal/dashboard')
      .then(d  => { setData(d); setLoading(false); })
      .catch(e => {
        if (e.code === 'auth_expired') { logout(); navigate('/login', { replace: true }); return; }
        setError(e.message); setLoading(false);
      });
    _fetch('/api/birthdays/today').then(setBdayData).catch(() => {});
  }, []);

  /* ── Loading ── */
  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Loading your dashboard…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-red-100 p-8 max-w-md text-center">
        <AlertCircle size={32} className="text-red-400 mx-auto mb-3" />
        <p className="text-slate-700 font-medium mb-1">Could not load dashboard</p>
        <p className="text-sm text-slate-400">{error}</p>
        <button onClick={() => { logout(); navigate('/login', { replace: true }); }}
          className="mt-4 text-sm text-indigo-600 hover:underline">Sign out</button>
      </div>
    </div>
  );

  /* ── Destructure ── */
  const {
    student, school, attendance, feeBalance, feeClearancePct, nextFeeDueDate,
    lessonsCoverage, timetableToday, reportCards,
    classTeacher, behaviourSummary, upcomingExams, announcements, upcomingEvents,
  } = data;

  const portalConfig   = school?.portalConfig ?? {};
  const showFees       = portalConfig.studentCanSeeFees ?? false;
  const rcThreshold    = portalConfig.reportCardFeeThreshold ?? 100;
  const rcLocked       = rcThreshold > 0 && (feeClearancePct ?? 100) < rcThreshold;

  /* Birthday */
  const myFirstName   = student.firstName ?? student.name?.split(' ')[0] ?? '';
  const bdayStudents  = bdayData?.students ?? [];
  const bdayUpcoming  = bdayData?.upcoming ?? [];
  const isMeBirthday  = bdayStudents.some(s => s.firstName?.toLowerCase() === myFirstName.toLowerCase());
  const classmates    = bdayStudents.filter(s => s.firstName?.toLowerCase() !== myFirstName.toLowerCase());

  /* Timetable helpers */
  const activeSlot = _findActiveSlot(timetableToday);
  const nextSlot   = _findNextSlot(timetableToday);

  /* Attendance colour */
  const attColor = attendance.percentage >= 80 ? 'text-emerald-600'
    : attendance.percentage >= 60 ? 'text-amber-600' : 'text-red-600';

  /* Fee badge */
  const feePaid    = feeBalance <= 0;
  const feeDisplay = feePaid ? 'Cleared' : `KSh ${feeBalance.toLocaleString()}`;

  /* Behaviour */
  const { totalPoints = 0, badgeLevel, latestReward, latestComment } = behaviourSummary ?? {};

  function handleLogout() { logout(); navigate('/login', { replace: true }); }

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Sticky header ─────────────────────────────────────── */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">M</div>
            <span className="text-sm font-bold text-slate-900">Msingi</span>
            <span className="text-slate-300 mx-1">·</span>
            <span className="text-xs font-medium text-slate-500">Student Portal</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 hidden sm:block">{student.admissionNumber}</span>
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 transition px-2 py-1.5 rounded-lg hover:bg-red-50">
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* ── Birthday banner ───────────────────────────────────── */}
        <AnimatePresence>
          {isMeBirthday && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="bg-gradient-to-r from-pink-500 to-rose-500 rounded-2xl p-5 text-white flex items-center gap-4">
              <div className="text-4xl">🎂</div>
              <div>
                <p className="text-lg font-bold">Happy Birthday, {myFirstName}!</p>
                <p className="text-pink-100 text-sm mt-0.5">Wishing you a wonderful day. Everyone here celebrates you today! 🎉</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Hero ──────────────────────────────────────────────── */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
          className="bg-gradient-to-br from-indigo-600 via-indigo-700 to-indigo-900 rounded-2xl p-6 text-white relative overflow-hidden">
          {/* decorative circles */}
          <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-white/5" />
          <div className="absolute -bottom-10 -right-4 w-48 h-48 rounded-full bg-white/5" />

          <p className="text-indigo-300 text-[11px] font-semibold uppercase tracking-widest mb-1">
            {school?.name}
          </p>
          <h1 className="text-2xl font-bold mb-0.5 relative">
            {_greeting()}, {myFirstName || student.name.split(' ')[0]} 👋
          </h1>
          <p className="text-indigo-200 text-sm mb-4 relative">
            {student.className || 'No class'} · {student.admissionNumber}
          </p>

          <div className="flex flex-wrap gap-3 text-xs relative">
            <div className="flex items-center gap-1.5 bg-white/10 rounded-lg px-3 py-1.5">
              <Calendar size={11} className="text-indigo-300" />
              <span className="text-indigo-100">{school?.academicYear}</span>
            </div>
            {classTeacher && (
              <div className="flex items-center gap-1.5 bg-white/10 rounded-lg px-3 py-1.5">
                <Users size={11} className="text-indigo-300" />
                <span className="text-indigo-100">Class Teacher: {classTeacher}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 bg-white/10 rounded-lg px-3 py-1.5">
              <Clock size={11} className="text-indigo-300" />
              <span className="text-indigo-100">
                {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
              </span>
            </div>
          </div>
        </motion.div>

        {/* ── Today's Snapshot ──────────────────────────────────── */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <SnapshotCard
            icon={BookOpen} label="Classes Today" value={timetableToday.length}
            sub={activeSlot ? `Now: ${activeSlot.subjectName}` : nextSlot ? `Next: ${nextSlot.subjectName}` : 'None active'}
            iconColor="bg-indigo-50" valueColor="text-indigo-700"
          />
          <SnapshotCard
            icon={CheckCircle} label="Attendance" value={`${attendance.percentage}%`}
            sub={`${attendance.present} present`}
            iconColor={attendance.percentage >= 80 ? 'bg-emerald-50' : 'bg-amber-50'}
            valueColor={attendance.percentage >= 80 ? 'text-emerald-600' : attendance.percentage >= 60 ? 'text-amber-600' : 'text-red-600'}
          />
          <SnapshotCard
            icon={Wallet} label="Fees" value={feeDisplay}
            sub={nextFeeDueDate && !feePaid ? `Due ${_fmtDate(nextFeeDueDate)}` : feePaid ? 'All clear' : undefined}
            iconColor={feePaid ? 'bg-emerald-50' : 'bg-amber-50'}
            valueColor={feePaid ? 'text-emerald-600' : 'text-amber-600'}
          />
          <SnapshotCard
            icon={Award} label="Behaviour" value={`+${totalPoints}`}
            sub={badgeLevel ? `${badgeLevel.charAt(0).toUpperCase() + badgeLevel.slice(1)} badge` : 'No badge yet'}
            iconColor="bg-violet-50" valueColor="text-violet-700"
          />
          <SnapshotCard
            icon={FileText} label="Upcoming Exams" value={upcomingExams?.length ?? 0}
            sub={upcomingExams?.[0] ? `Next: ${_fmtDate(upcomingExams[0].date)}` : 'None scheduled'}
            iconColor="bg-rose-50" valueColor="text-rose-600"
          />
          <SnapshotCard
            icon={GraduationCap} label="Report Cards" value={reportCards.length}
            sub="published"
            iconColor="bg-blue-50" valueColor="text-blue-600"
          />
        </div>

        {/* ── Main two-column grid ──────────────────────────────── */}
        <div className="grid lg:grid-cols-5 gap-5">

          {/* ── Left column (wider) ── */}
          <div className="lg:col-span-3 space-y-5">

            {/* Today's Timetable */}
            <SectionCard title="Today's Timetable" icon={Calendar} iconColor="text-sky-500"
              action={
                <span className="text-[11px] text-slate-400">
                  {new Date().toLocaleDateString('en-GB', { weekday: 'long' })}
                </span>
              }>
              {school?.emergencyOnlineMode && (
                <div className="mx-4 mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-50 border border-sky-200">
                  <MonitorPlay size={12} className="text-sky-600 shrink-0" />
                  <p className="text-[11px] font-semibold text-sky-700">Emergency Online Learning — all lessons are online today</p>
                </div>
              )}

              {timetableToday.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                  <Calendar size={22} className="mb-2 opacity-40" />
                  <p className="text-xs">No lessons scheduled today</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50 px-1 py-1">
                  {timetableToday.map((slot, i) => {
                    const nowMins   = _nowMins();
                    const start     = _timeToMins(slot.startTime);
                    const end       = _timeToMins(slot.endTime);
                    const isNow     = start <= nowMins && nowMins < end;
                    const isNext    = !activeSlot && slot === nextSlot;
                    const isPast    = end <= nowMins;

                    return (
                      <div key={i}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl mx-1 my-0.5 transition
                          ${isNow  ? 'bg-indigo-50 border border-indigo-200' : ''}
                          ${isNext ? 'bg-amber-50 border border-amber-200'   : ''}
                          ${isPast && !isNow ? 'opacity-50' : ''}`}>
                        <div className="text-center shrink-0 w-14">
                          <p className={`text-[10px] font-bold ${isNow ? 'text-indigo-700' : 'text-slate-600'}`}>{slot.startTime}</p>
                          <p className="text-[10px] text-slate-400">{slot.endTime}</p>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm font-semibold truncate ${isNow ? 'text-indigo-800' : 'text-slate-800'}`}>
                              {slot.subjectName}
                            </p>
                            {isNow  && <span className="text-[9px] font-bold text-white bg-indigo-500 px-1.5 py-0.5 rounded-full shrink-0">NOW</span>}
                            {isNext && <span className="text-[9px] font-bold text-white bg-amber-400 px-1.5 py-0.5 rounded-full shrink-0">NEXT</span>}
                          </div>
                          {slot.teacherName && <p className="text-[11px] text-slate-400 truncate">{slot.teacherName}</p>}
                        </div>
                        {slot.room && !slot.meetingLink && (
                          <div className="flex items-center gap-1 text-[10px] text-slate-400 shrink-0">
                            <MapPin size={9} /> {slot.room}
                          </div>
                        )}
                        {slot.meetingLink && (
                          <a href={slot.meetingLink} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 shrink-0 px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-semibold transition">
                            <Play size={9} /> Join
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            {/* Curriculum Coverage */}
            {lessonsCoverage.length > 0 && (
              <SectionCard title="Curriculum Coverage" icon={BookCheck} iconColor="text-indigo-500">
                <div className="px-5 py-4 space-y-4">
                  {lessonsCoverage.map(sub => (
                    <div key={sub.subjectId}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div>
                          <span className="text-sm font-medium text-slate-800">{sub.subjectName}</span>
                          <span className="text-[10px] text-slate-400 ml-2">{sub.coveredTopics}/{sub.totalTopics} topics</span>
                        </div>
                        <span className={`text-xs font-bold ${
                          sub.percentage >= 80 ? 'text-emerald-600' :
                          sub.percentage >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                          {sub.percentage}%
                        </span>
                      </div>
                      <ProgressBar pct={sub.percentage}
                        color={sub.percentage >= 80 ? 'bg-emerald-500' : sub.percentage >= 50 ? 'bg-amber-400' : 'bg-red-400'} />
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Report Cards */}
            {reportCards.length > 0 && (
              <SectionCard title="Report Cards" icon={FileText} iconColor="text-violet-500">
                <div className="px-5 py-4">
                  {rcLocked && (
                    <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3 mb-4 text-xs text-amber-800">
                      <Lock size={12} className="mt-0.5 shrink-0 text-amber-500" />
                      <span>
                        Report cards locked — <strong>{feeClearancePct}%</strong> fees cleared, minimum <strong>{rcThreshold}%</strong> required.
                      </span>
                    </div>
                  )}
                  {dlError && <p className="text-[11px] text-red-600 mb-3">{dlError}</p>}
                  <div className="grid sm:grid-cols-2 gap-2.5">
                    {reportCards.map(rc => {
                      const label = `${rc.academicYear}-T${rc.termNumber}`;
                      const busy  = downloading === rc.id;
                      return (
                        <div key={rc.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${rcLocked ? 'bg-slate-100' : 'bg-violet-50'}`}>
                            {rcLocked ? <Lock size={13} className="text-slate-400" /> : <GraduationCap size={13} className="text-violet-600" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-slate-700">{rc.academicYear} · Term {rc.termNumber}</p>
                            {rc.averageScore != null && <p className="text-[10px] text-slate-400">Avg: {rc.averageScore}%</p>}
                          </div>
                          {rcLocked
                            ? <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">Locked</span>
                            : (
                              <button
                                onClick={() => {
                                  setDlError('');
                                  setDownloading(rc.id);
                                  _downloadReport(rc.id, label)
                                    .catch(e => setDlError(e.message))
                                    .finally(() => setDownloading(null));
                                }}
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

          </div>

          {/* ── Right column ── */}
          <div className="lg:col-span-2 space-y-5">

            {/* Upcoming Exams */}
            {upcomingExams?.length > 0 && (
              <SectionCard title="Upcoming Exams" icon={FileText} iconColor="text-rose-500">
                <div className="divide-y divide-slate-50">
                  {upcomingExams.map((ex, i) => {
                    const days = _daysUntil(ex.date);
                    const urgentColor = days === 0 ? 'text-red-600 bg-red-50' : days <= 3 ? 'text-amber-600 bg-amber-50' : 'text-slate-500 bg-slate-50';
                    return (
                      <div key={i} className="flex items-center gap-3 px-5 py-3">
                        <div className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center shrink-0 text-center ${urgentColor}`}>
                          <p className="text-sm font-bold leading-none">{days === 0 ? 'Today' : days}</p>
                          {days > 0 && <p className="text-[9px] font-medium">day{days !== 1 ? 's' : ''}</p>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{ex.subjectName}</p>
                          <p className="text-[11px] text-slate-400">
                            {_weekday(ex.date)}, {_fmtDate(ex.date)}
                            {ex.startTime ? ` · ${ex.startTime}` : ''}
                          </p>
                        </div>
                        {ex.type && (
                          <span className="text-[9px] font-semibold text-slate-400 uppercase bg-slate-100 px-2 py-0.5 rounded-full shrink-0">
                            {ex.type}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </SectionCard>
            )}

            {/* Attendance Detail */}
            <SectionCard title="Attendance" icon={Activity} iconColor="text-emerald-500">
              <div className="px-5 py-4">
                <div className="flex items-center gap-5 mb-4">
                  <div className="relative shrink-0">
                    <AttRing pct={attendance.percentage} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className={`text-sm font-bold ${attColor}`}>{attendance.percentage}%</p>
                    </div>
                  </div>
                  <div className="flex-1 space-y-2">
                    {[
                      { label: 'Present', value: attendance.present,  color: 'bg-emerald-500' },
                      { label: 'Absent',  value: attendance.absent,   color: 'bg-red-400' },
                      { label: 'Late',    value: attendance.late ?? 0, color: 'bg-amber-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label}>
                        <div className="flex justify-between text-[11px] mb-0.5">
                          <span className="text-slate-500">{label}</span>
                          <span className="font-semibold text-slate-700">{value ?? 0}</span>
                        </div>
                        <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${color}`}
                            style={{ width: attendance.total ? `${Math.round(((value ?? 0) / attendance.total) * 100)}%` : '0%' }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-center text-slate-400">{attendance.total} school days recorded this term</p>
              </div>
            </SectionCard>

            {/* Behaviour & Rewards */}
            <SectionCard title="Behaviour &amp; Rewards" icon={Star} iconColor="text-amber-500">
              <div className="px-5 py-4">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
                    <p className="text-lg font-bold text-amber-600">+{totalPoints}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Behaviour Points</p>
                    <Badge level={badgeLevel} />
                  </div>
                </div>

                {latestReward && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl px-3.5 py-3 mb-3">
                    <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-0.5">Latest Reward</p>
                    <p className="text-sm font-medium text-slate-800">{latestReward.title || latestReward.category || 'Reward'}</p>
                    {latestReward.date && <p className="text-[10px] text-slate-400 mt-0.5">{_fmtDate(latestReward.date)}</p>}
                  </div>
                )}

                {latestComment?.description && (
                  <div className="bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-3">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-0.5">Latest Comment</p>
                    <p className="text-xs text-slate-700 italic">"{latestComment.description}"</p>
                  </div>
                )}

                {!latestReward && !latestComment?.description && (
                  <p className="text-xs text-slate-400 text-center py-2">No behaviour records yet</p>
                )}
              </div>
            </SectionCard>

            {/* Classmates Birthdays */}
            {(classmates.length > 0 || bdayUpcoming.length > 0) && (
              <SectionCard title="Classmate Birthdays" icon={Cake} iconColor="text-rose-400"
                action={classmates.length > 0
                  ? <span className="text-[10px] font-bold text-white bg-rose-400 px-2 py-0.5 rounded-full">{classmates.length} today</span>
                  : null}>
                <div className="px-4 py-3 space-y-2">
                  {classmates.slice(0, 4).map(s => (
                    <div key={s.id} className="flex items-center gap-2.5 p-2.5 bg-rose-50 rounded-xl border border-rose-100">
                      <div className="w-8 h-8 rounded-full bg-rose-400 flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {s.firstName?.[0] ?? '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{s.firstName} {s.lastName}</p>
                        <p className="text-[10px] font-medium text-rose-500">🎂 Turning {s.age} today!</p>
                      </div>
                    </div>
                  ))}
                  {classmates.length > 4 && (
                    <p className="text-center text-[10px] font-semibold text-rose-400">+{classmates.length - 4} more today</p>
                  )}
                  {bdayUpcoming.slice(0, 3).map(s => (
                    <div key={s.id} className="flex items-center gap-2.5 p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                      <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-xs font-bold shrink-0">
                        {s.firstName?.[0] ?? '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-700 truncate">{s.firstName} {s.lastName}</p>
                        <p className="text-[10px] text-slate-400">in {s.daysUntil} day{s.daysUntil !== 1 ? 's' : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* Upcoming Events */}
            {upcomingEvents?.length > 0 && (
              <SectionCard title="School Events" icon={Calendar} iconColor="text-blue-500">
                <div className="divide-y divide-slate-50">
                  {upcomingEvents.map((ev, i) => {
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
            {announcements?.length > 0 && (
              <SectionCard title="Announcements" icon={Bell} iconColor="text-amber-500">
                <div className="divide-y divide-slate-50">
                  {announcements.map((ann, i) => (
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

        {/* ── Quick Actions ──────────────────────────────────────── */}
        <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Quick Actions</p>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
            {[
              { icon: Download,      label: 'Download Report',   action: () => reportCards[0] && !rcLocked && _downloadReport(reportCards[0].id, `${reportCards[0].academicYear}-T${reportCards[0].termNumber}`) },
              { icon: Calendar,      label: 'Timetable',         action: () => window.scrollTo({ top: 0, behavior: 'smooth' }) },
              { icon: Activity,      label: 'Attendance',        action: null },
              { icon: FileText,      label: 'Results',           action: null },
              { icon: MessageSquare, label: 'Messages',          action: null },
              { icon: Star,          label: 'Behaviour',         action: null },
              { icon: BookOpen,      label: 'Curriculum',        action: null },
              { icon: GraduationCap, label: 'Profile',           action: null },
            ].map(({ icon: Icon, label, action }) => (
              <button key={label} onClick={action ?? undefined}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50 transition group ${!action ? 'opacity-50 cursor-default' : ''}`}>
                <div className="w-8 h-8 rounded-lg bg-slate-100 group-hover:bg-indigo-100 flex items-center justify-center transition">
                  <Icon size={14} className="text-slate-600 group-hover:text-indigo-600 transition" />
                </div>
                <p className="text-[10px] font-medium text-slate-500 group-hover:text-indigo-600 transition text-center leading-tight">{label}</p>
              </button>
            ))}
          </div>
        </div>

      </main>
    </div>
  );
}

/* ── Greeting helper (outside component to avoid re-creation) ── */
function _greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
