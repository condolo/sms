/**
 * Msingi — Student Dashboard
 * Shown after login for role === 'student'
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '@/store/auth.js';
import {
  BookCheck, Calendar, CheckCircle, Clock, FileText,
  GraduationCap, LogOut, TrendingUp, User, Wallet,
  AlertCircle, BookOpen, ChevronRight, MonitorPlay, Play, Lock,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || '';

function _token() {
  return JSON.parse(localStorage.getItem('msingi_session') || '{}')?.token || '';
}

async function _fetch(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${_token()}` },
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Failed to load');
  return json.data;
}

/* ── Attendance ring ─────────────────────────────────────────── */
function AttRing({ pct = 0, size = 80, stroke = 8 }) {
  const r   = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const off  = circ - (pct / 100) * circ;
  const color = pct >= 80 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';
  return (
    <svg width={size} height={size} className="rotate-[-90deg]">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
    </svg>
  );
}

/* ── Progress bar ─────────────────────────────────────────────── */
function ProgressBar({ pct = 0, color = 'bg-indigo-500' }) {
  return (
    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
      <motion.div
        className={`h-full rounded-full ${color}`}
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />
    </div>
  );
}

/* ── Day badge ────────────────────────────────────────────────── */
const DAY_COLORS = {
  Monday:'bg-blue-50 text-blue-700', Tuesday:'bg-violet-50 text-violet-700',
  Wednesday:'bg-emerald-50 text-emerald-700', Thursday:'bg-amber-50 text-amber-700',
  Friday:'bg-rose-50 text-rose-700',
};

export default function StudentDashboard() {
  const navigate   = useNavigate();
  const logout     = useAuthStore(s => s.logout);
  const session    = useAuthStore(s => s.session);

  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    _fetch('/api/student-portal/dashboard')
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  function handleLogout() { logout(); navigate('/login', { replace: true }); }

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
        <button onClick={handleLogout} className="mt-4 text-sm text-indigo-600 hover:underline">Sign out</button>
      </div>
    </div>
  );

  const { student, school, attendance, feeBalance, lessonsCoverage, timetableToday, reportCards } = data;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">M</div>
            <span className="text-sm font-bold text-slate-900">Msingi</span>
            <span className="text-slate-300 text-xs mx-1">·</span>
            <span className="text-xs font-medium text-slate-500">Student Portal</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 hidden sm:block">{student.admissionNumber}</span>
            <button onClick={handleLogout}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50">
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* ── Welcome card ──────────────────────────────────── */}
        <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.4 }}
          className="bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-2xl p-6 text-white">
          <p className="text-indigo-200 text-xs font-semibold uppercase tracking-widest mb-1">{school?.academicYear}</p>
          <h1 className="text-2xl font-bold mb-0.5">Hello, {student.name.split(' ')[0]} 👋</h1>
          <p className="text-indigo-200 text-sm">{student.className || 'No class assigned'} · {student.admissionNumber}</p>
        </motion.div>

        {/* ── Stats row ─────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: CheckCircle,    label: 'Attendance',   value: `${attendance.percentage}%`, sub: `${attendance.present} / ${attendance.total} days`, color: 'text-emerald-600 bg-emerald-50' },
            { icon: Wallet,         label: 'Fee Balance',  value: `KSh ${(feeBalance||0).toLocaleString()}`, sub: feeBalance <= 0 ? 'Fully paid' : 'Outstanding', color: feeBalance <= 0 ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50' },
            { icon: BookCheck,      label: 'Subjects',     value: lessonsCoverage.length, sub: 'in curriculum', color: 'text-indigo-600 bg-indigo-50' },
            { icon: FileText,       label: 'Report Cards', value: reportCards.length, sub: 'published', color: 'text-violet-600 bg-violet-50' },
          ].map(({ icon: Icon, label, value, sub, color }) => (
            <motion.div key={label} initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.35 }}
              className="bg-white border border-slate-200 rounded-xl p-4">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2.5 ${color}`}>
                <Icon size={15} />
              </div>
              <p className="text-xl font-bold text-slate-900">{value}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{label} · {sub}</p>
            </motion.div>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-5">
          {/* ── Lessons coverage ──────────────────────────── */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
              <BookCheck size={14} className="text-indigo-500" />
              <h2 className="text-sm font-semibold text-slate-800">Curriculum Coverage</h2>
            </div>
            {lessonsCoverage.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No lesson data yet</p>
            ) : (
              <div className="space-y-3.5">
                {lessonsCoverage.map(sub => (
                  <div key={sub.subjectId}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium text-slate-700">{sub.subjectName}</span>
                      <span className={`text-xs font-bold ${sub.percentage >= 80 ? 'text-emerald-600' : sub.percentage >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                        {sub.percentage}%
                      </span>
                    </div>
                    <ProgressBar pct={sub.percentage}
                      color={sub.percentage >= 80 ? 'bg-emerald-500' : sub.percentage >= 50 ? 'bg-amber-400' : 'bg-red-400'} />
                    <p className="text-[10px] text-slate-400 mt-0.5">{sub.coveredTopics} of {sub.totalTopics} topics covered</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Today's timetable ─────────────────────────── */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
              <Calendar size={14} className="text-sky-500" />
              <h2 className="text-sm font-semibold text-slate-800">Today</h2>
              <span className="ml-auto text-[11px] text-slate-400">
                {new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'short' })}
              </span>
            </div>

            {/* Emergency Online Learning Mode banner */}
            {school?.emergencyOnlineMode && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-sky-50 border border-sky-200 mb-3">
                <MonitorPlay size={13} className="text-sky-600 shrink-0" />
                <p className="text-[11px] font-semibold text-sky-700">Emergency Online Learning — all lessons are online today</p>
              </div>
            )}

            {timetableToday.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-6">No lessons scheduled today</p>
            ) : (
              <div className="space-y-2.5">
                {timetableToday.map((slot, i) => (
                  <div key={i} className="rounded-xl bg-slate-50 border border-slate-100 overflow-hidden">
                    <div className="flex items-center gap-3 p-3">
                      {/* Time column */}
                      <div className="text-center shrink-0 w-14">
                        <p className="text-[10px] font-semibold text-slate-600">{slot.startTime}</p>
                        <p className="text-[10px] text-slate-400">{slot.endTime}</p>
                      </div>
                      {/* Subject + teacher */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{slot.subjectName}</p>
                        {slot.teacherName && (
                          <p className="text-[11px] text-slate-400 truncate">{slot.teacherName}</p>
                        )}
                      </div>
                      {/* Room badge */}
                      {slot.room && !slot.meetingLink && (
                        <span className="text-[10px] text-slate-400 shrink-0">{slot.room}</span>
                      )}
                      {/* Join button */}
                      {slot.meetingLink && (
                        <a
                          href={slot.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[11px] font-semibold transition"
                        >
                          <Play size={9} />
                          Join {slot.platform === 'zoom' ? 'Zoom' : slot.platform === 'meet' ? 'Meet' : 'Class'}
                        </a>
                      )}
                    </div>
                    {/* Passcode row (only shown when present) */}
                    {slot.meetingPasscode && (
                      <div className="flex items-center gap-1.5 px-3 pb-2.5 text-[10px] text-slate-500">
                        <Lock size={9} className="text-slate-400 shrink-0" />
                        Passcode: <span className="font-mono font-bold text-slate-700">{slot.meetingPasscode}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Report cards ──────────────────────────────────── */}
        {reportCards.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
              <FileText size={14} className="text-violet-500" />
              <h2 className="text-sm font-semibold text-slate-800">Report Cards</h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {reportCards.map((rc, i) => (
                <div key={i} className="flex items-center gap-3 p-3.5 rounded-xl border border-slate-200">
                  <div className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
                    <GraduationCap size={15} className="text-violet-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-700">{rc.academicYear} · Term {rc.termNumber}</p>
                    {rc.grade && <p className="text-xs text-slate-400">Grade: <span className="font-bold text-slate-700">{rc.grade}</span></p>}
                  </div>
                  <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">Published</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
