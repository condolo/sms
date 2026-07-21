/**
 * Msingi — Group Director / CEO Dashboard
 * Standalone page (no AppShell/sidebar) for the read-only 'group_director'
 * role: a merged analytics view across every school in the account's
 * organization, automatically — nothing else. This role has no settings
 * or per-school operational access (enforced server-side by RBAC, not by
 * this page — this page just has nothing else to link to).
 * Data: GET /api/analytics/group.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, Users, Wallet, GraduationCap, ShieldAlert, Building2 } from 'lucide-react';
import useAuthStore from '@/store/auth.js';

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

function _money(n) {
  if (n == null) return '—';
  return 'KES ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 0 });
}
function _pct(n) { return n == null ? '—' : `${n}%`; }

function SummaryCard({ icon: Icon, label, value, sub, tone = 'indigo' }) {
  const toneMap = {
    indigo: 'bg-indigo-50 text-indigo-600',
    green:  'bg-green-50 text-green-600',
    amber:  'bg-amber-50 text-amber-600',
    red:    'bg-red-50 text-red-600',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${toneMap[tone]}`}>
          <Icon size={16} />
        </div>
      </div>
      <div className="text-2xl font-semibold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400">{sub}</div>}
    </div>
  );
}

export default function GroupDashboard() {
  const navigate = useNavigate();
  const logout   = useAuthStore(s => s.logout);
  const session  = useAuthStore(s => s.session);

  const [days, setDays]       = useState(30);
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    _fetch(`/api/analytics/group?days=${days}`)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => {
        if (cancelled) return;
        if (e.code === 'auth_expired') { logout(); navigate('/login', { replace: true }); return; }
        setError(e.message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleLogout() { logout(); navigate('/login', { replace: true }); }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Group Overview</h1>
          <p className="text-xs text-gray-400">{session?.user?.name || 'Director'} · merged view across every school in your organization</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            id="group-days-select"
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button
            id="group-logout-btn"
            onClick={handleLogout}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-100"
          >
            <LogOut size={14} /> Log out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {loading && (
          <div className="text-center text-gray-400 py-20">Loading group analytics…</div>
        )}

        {!loading && error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-4 max-w-lg mx-auto">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            <p className="text-sm text-gray-400 mb-6">
              {data.meta.schoolCount} school{data.meta.schoolCount === 1 ? '' : 's'} · last {data.meta.days} days
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <SummaryCard
                icon={Wallet} tone="green" label="Fee Collection"
                value={_pct(data.combined.feeExposure.collectionRate)}
                sub={`${_money(data.combined.feeExposure.totalOutstanding)} outstanding`}
              />
              <SummaryCard
                icon={Users} tone={data.combined.attendance.atRiskPct > 15 ? 'amber' : 'indigo'} label="Avg Attendance"
                value={_pct(data.combined.attendance.avgRate)}
                sub={`${data.combined.attendance.atRiskCount} students at risk`}
              />
              <SummaryCard
                icon={GraduationCap} tone="indigo" label="Avg Academic Score"
                value={_pct(data.combined.academic.avgScore)}
                sub={`${data.combined.academic.studentCount} students tracked`}
              />
              <SummaryCard
                icon={ShieldAlert} tone={data.combined.behaviour.demerits > data.combined.behaviour.merits ? 'red' : 'indigo'} label="Behaviour Incidents"
                value={data.combined.behaviour.total}
                sub={`${data.combined.behaviour.merits} merits · ${data.combined.behaviour.demerits} demerits`}
              />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2">
                <Building2 size={16} className="text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-700">By School</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 uppercase tracking-wide border-b border-gray-100">
                      <th className="px-5 py-3">School</th>
                      <th className="px-5 py-3">Collection Rate</th>
                      <th className="px-5 py-3">Attendance</th>
                      <th className="px-5 py-3">Academic Avg</th>
                      <th className="px-5 py-3">Incidents</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.schools.map(s => {
                      const avgAttendance = s.snapshot.attendanceRisk.length
                        ? Math.round((s.snapshot.attendanceRisk.reduce((sum, c) => sum + c.avgRate * c.totalStudents, 0)
                            / Math.max(s.snapshot.attendanceRisk.reduce((sum, c) => sum + c.totalStudents, 0), 1)) * 10) / 10
                        : null;
                      const avgAcademic = s.snapshot.academicHealth.length
                        ? Math.round((s.snapshot.academicHealth.reduce((sum, c) => sum + c.avgScore * c.studentCount, 0)
                            / Math.max(s.snapshot.academicHealth.reduce((sum, c) => sum + c.studentCount, 0), 1)) * 10) / 10
                        : null;
                      const incidents = s.snapshot.behaviourHeatmap.reduce((sum, c) => sum + c.total, 0);
                      return (
                        <tr key={s.schoolId} className="border-b border-gray-50 last:border-0">
                          <td className="px-5 py-3 font-medium text-gray-800">{s.schoolName}</td>
                          <td className="px-5 py-3 text-gray-600">{_pct(s.snapshot.feeExposure.collectionRate)}</td>
                          <td className="px-5 py-3 text-gray-600">{avgAttendance != null ? `${avgAttendance}%` : '—'}</td>
                          <td className="px-5 py-3 text-gray-600">{avgAcademic != null ? `${avgAcademic}%` : '—'}</td>
                          <td className="px-5 py-3 text-gray-600">{incidents}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
