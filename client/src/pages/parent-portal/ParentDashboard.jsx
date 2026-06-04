/**
 * Msingi — Parent Dashboard
 * Shown after login for role === 'parent' / 'guardian'
 */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import useAuthStore from '@/store/auth.js';
import {
  BookCheck, CheckCircle, ChevronDown, FileText,
  GraduationCap, LogOut, Users, Wallet, AlertCircle,
  TrendingUp, Receipt, Calendar,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE || '';

function _token() {
  return JSON.parse(localStorage.getItem('msingi_session') || '{}')?.token || '';
}

async function _fetch(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${_token()}` } });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message || 'Request failed');
  return json.data;
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

const ATT_STATUS_STYLE = {
  present: 'bg-emerald-50 text-emerald-700',
  absent:  'bg-red-50 text-red-700',
  late:    'bg-amber-50 text-amber-700',
};

export default function ParentDashboard() {
  const navigate = useNavigate();
  const logout   = useAuthStore(s => s.logout);

  const [children, setChildren]       = useState([]);
  const [activeChild, setActiveChild] = useState(null);
  const [childData,   setChildData]   = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [childOpen,   setChildOpen]   = useState(false);
  const [error,       setError]       = useState('');

  // Load children list
  useEffect(() => {
    _fetch('/api/parent-portal/children')
      .then(list => {
        setChildren(list);
        if (list.length > 0) { setActiveChild(list[0]); }
        setLoadingList(false);
      })
      .catch(e => { setError(e.message); setLoadingList(false); });
  }, []);

  // Load dashboard for active child
  useEffect(() => {
    if (!activeChild) return;
    setLoadingData(true); setChildData(null);
    _fetch(`/api/parent-portal/dashboard/${activeChild.id}`)
      .then(d => { setChildData(d); setLoadingData(false); })
      .catch(e => { setError(e.message); setLoadingData(false); });
  }, [activeChild]);

  function handleLogout() { logout(); navigate('/login', { replace: true }); }

  if (loadingList) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-slate-500">Loading parent dashboard…</p>
      </div>
    </div>
  );

  if (error && !children.length) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl border border-red-100 p-8 max-w-md text-center">
        <AlertCircle size={32} className="text-red-400 mx-auto mb-3" />
        <p className="text-slate-700 font-medium mb-1">Could not load dashboard</p>
        <p className="text-sm text-slate-400">{error}</p>
        <button onClick={handleLogout} className="mt-4 text-sm text-violet-600 hover:underline">Sign out</button>
      </div>
    </div>
  );

  const d = childData;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Header ────────────────────────────────────────── */}
      <header className="bg-white border-b border-slate-100 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-violet-600 flex items-center justify-center text-white text-[10px] font-bold">M</div>
            <span className="text-sm font-bold text-slate-900">Msingi</span>
            <span className="text-slate-300 text-xs mx-1">·</span>
            <span className="text-xs font-medium text-slate-500">Parent Portal</span>
          </div>
          <button onClick={handleLogout}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* ── Child selector ────────────────────────────────── */}
        {children.length > 1 && (
          <div className="relative">
            <button onClick={() => setChildOpen(p => !p)}
              className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 w-full sm:w-auto shadow-sm hover:border-violet-300 transition-colors">
              <div className="w-8 h-8 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                <Users size={14} className="text-violet-600" />
              </div>
              <div className="text-left">
                <p className="text-sm font-semibold text-slate-800">{activeChild?.name}</p>
                <p className="text-[11px] text-slate-400">{activeChild?.className} · {activeChild?.admissionNumber}</p>
              </div>
              <ChevronDown size={14} className={`ml-auto text-slate-400 transition-transform ${childOpen ? 'rotate-180' : ''}`} />
            </button>
            <AnimatePresence>
              {childOpen && (
                <motion.div initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}
                  className="absolute top-full mt-1 left-0 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 min-w-[260px]">
                  {children.map(c => (
                    <button key={c.id} onClick={() => { setActiveChild(c); setChildOpen(false); }}
                      className={`flex items-center gap-3 w-full px-4 py-2.5 text-left hover:bg-slate-50 transition-colors ${c.id === activeChild?.id ? 'bg-violet-50' : ''}`}>
                      <div className="w-7 h-7 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-violet-600">{c.name[0]}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-800">{c.name}</p>
                        <p className="text-[11px] text-slate-400">{c.className} · {c.admissionNumber}</p>
                      </div>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ── Welcome card ─────────────────────────────────── */}
        <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.4 }}
          className="bg-gradient-to-br from-violet-600 to-violet-800 rounded-2xl p-6 text-white">
          <p className="text-violet-200 text-xs font-semibold uppercase tracking-widest mb-1">{d?.school?.academicYear || '—'}</p>
          <h1 className="text-2xl font-bold mb-0.5">{activeChild?.name}</h1>
          <p className="text-violet-200 text-sm">{activeChild?.className} · {activeChild?.admissionNumber}</p>
        </motion.div>

        {loadingData && (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-violet-400 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {d && !loadingData && (
          <>
            {/* ── Stats row ───────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { icon: CheckCircle, label: 'Attendance', value: `${d.attendance.percentage}%`,
                  sub: `${d.attendance.present} of ${d.attendance.total} days present`,
                  color: d.attendance.percentage >= 80 ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50' },
                { icon: Wallet, label: 'Fee Balance', value: `KSh ${(d.feeBalance||0).toLocaleString()}`,
                  sub: d.feeBalance <= 0 ? 'All fees cleared' : 'Outstanding balance',
                  color: d.feeBalance <= 0 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50' },
                { icon: BookCheck, label: 'Subjects', value: d.lessonsCoverage.length,
                  sub: 'with curriculum tracking', color: 'text-violet-600 bg-violet-50' },
              ].map(({ icon: Icon, label, value, sub, color }) => (
                <div key={label} className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2.5 ${color}`}>
                    <Icon size={15} />
                  </div>
                  <p className="text-xl font-bold text-slate-900">{value}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">{label} · {sub}</p>
                </div>
              ))}
            </div>

            <div className="grid lg:grid-cols-2 gap-5">
              {/* ── Curriculum coverage ───────────────────── */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                  <BookCheck size={14} className="text-violet-500" />
                  <h2 className="text-sm font-semibold text-slate-800">Curriculum Coverage</h2>
                </div>
                {d.lessonsCoverage.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">No lesson data yet</p>
                ) : (
                  <div className="space-y-3.5">
                    {d.lessonsCoverage.map(sub => (
                      <div key={sub.subjectId}>
                        <div className="flex justify-between mb-1">
                          <span className="text-sm font-medium text-slate-700">{sub.subjectName}</span>
                          <span className={`text-xs font-bold ${sub.percentage >= 80 ? 'text-emerald-600' : sub.percentage >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                            {sub.percentage}%
                          </span>
                        </div>
                        <ProgressBar pct={sub.percentage} />
                        <p className="text-[10px] text-slate-400 mt-0.5">{sub.coveredTopics} of {sub.totalTopics} topics</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Recent attendance ─────────────────────── */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                  <Calendar size={14} className="text-sky-500" />
                  <h2 className="text-sm font-semibold text-slate-800">Recent Attendance</h2>
                  <div className="ml-auto flex gap-3 text-[11px]">
                    <span className="text-emerald-600 font-semibold">{d.attendance.present} present</span>
                    <span className="text-red-500 font-semibold">{d.attendance.absent} absent</span>
                    {d.attendance.late > 0 && <span className="text-amber-600 font-semibold">{d.attendance.late} late</span>}
                  </div>
                </div>
                {d.recentAttendance.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-6">No attendance records yet</p>
                ) : (
                  <div className="space-y-2">
                    {d.recentAttendance.map((rec, i) => (
                      <div key={i} className="flex items-center justify-between py-1.5">
                        <span className="text-sm text-slate-600">
                          {rec.date ? new Date(rec.date).toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' }) : '—'}
                        </span>
                        <span className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full capitalize ${ATT_STATUS_STYLE[rec.status] || 'bg-slate-100 text-slate-600'}`}>
                          {rec.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* ── Recent payments ───────────────────────────── */}
            {d.recentPayments?.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                  <Receipt size={14} className="text-emerald-500" />
                  <h2 className="text-sm font-semibold text-slate-800">Recent Payments</h2>
                </div>
                <div className="space-y-2">
                  {d.recentPayments.map((p, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-slate-800">KSh {(p.amount||0).toLocaleString()}</p>
                        {p.mpesaCode && <p className="text-[11px] text-slate-400 font-mono">{p.mpesaCode}</p>}
                      </div>
                      <span className="text-[11px] text-slate-400">
                        {p.paidAt ? new Date(p.paidAt).toLocaleDateString('en-GB', { day:'numeric', month:'short' }) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Report cards ──────────────────────────────── */}
            {d.reportCards?.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
                  <FileText size={14} className="text-violet-500" />
                  <h2 className="text-sm font-semibold text-slate-800">Report Cards</h2>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {d.reportCards.map((rc, i) => (
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
          </>
        )}
      </main>
    </div>
  );
}
