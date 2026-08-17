/* ============================================================
   MedicalPage — Medical Centre (Module 1, milestone 3: Clinic Visits)
   Two tabs: Log Visit (student picker + visit form), Visits (timeline)
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HeartPulse, ClipboardList, Search, X, Loader2, CheckCircle2,
  AlertTriangle, ChevronLeft, ChevronRight, Trash2, Home, Ambulance, ShieldAlert,
  BarChart3, CalendarDays, TrendingUp,
} from 'lucide-react';
import { medical as medicalApi, students as studentsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

const LIMIT = 20;

export default function MedicalPage() {
  const [tab, setTab] = useState('log');
  const can = useAuthStore(s => s.can);
  const canRecord = can('medical', 'create');
  // A teacher gets ONLY the medical__alerts sub-grant, never the base
  // 'medical' key — _deriveApiPerms() persists sub-keyed grants as their
  // own top-level entry in permissions, so this reads exactly like any
  // other feature check, no special client-side subKey plumbing needed.
  const canSeeAlerts  = can('medical', 'read') || can('medical__alerts', 'read');
  const canSeeReports = can('medical', 'read'); // reports use the module-level grant, not a sub-grant — see medical.js

  const TABS = [
    ...(canRecord ? [{ id: 'log', label: 'Log Visit', icon: HeartPulse }] : []),
    { id: 'visits', label: 'Visits', icon: ClipboardList },
    ...(canSeeAlerts ? [{ id: 'alerts', label: 'Alerts', icon: ShieldAlert }] : []),
    ...(canSeeReports ? [{ id: 'reports', label: 'Reports', icon: BarChart3 }] : []),
  ];
  const activeTab = TABS.some(t => t.id === tab) ? tab : (TABS[0]?.id ?? 'visits');

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-xl mx-auto">
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Medical Centre</h1>
          <p className="text-sm text-slate-500 mt-0.5">Clinic visits and the student medical timeline</p>
        </div>
      </div>

      <div className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-screen-xl mx-auto flex gap-0 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  active ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-5">
        <AnimatePresence mode="wait">
          {activeTab === 'log'     && <LogVisitTab key="log" />}
          {activeTab === 'visits'  && <VisitsTab key="visits" />}
          {activeTab === 'alerts'  && <AlertsTab key="alerts" />}
          {activeTab === 'reports' && <ReportsTab key="reports" />}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   LOG VISIT — student search → visit form
   ══════════════════════════════════════════════════════════════ */
function LogVisitTab() {
  const qc = useQueryClient();
  const [sid, setSid]     = useState('');
  const [sName, setSName] = useState('');
  const [stuSearch, setStuSearch] = useState('');
  const [toast, setToast] = useState(null);

  const [form, setForm] = useState({
    complaint: '', observation: '', actionTaken: '', medicationGiven: '',
    returnedToClass: false, sentHome: false, referred: false, referredTo: '', notes: '',
  });
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const { data: stuData } = useQuery({
    queryKey: ['students', 'search', stuSearch],
    queryFn:  () => studentsApi.list({ search: stuSearch, limit: 12, status: 'active' }),
    enabled:  stuSearch.length >= 2,
    staleTime: 30_000,
  });
  const stuResults = stuData?.data ?? [];

  const mutation = useMutation({
    mutationFn: data => medicalApi.visits.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['medical', 'visits'] });
      setToast({ type: 'success', student: sName });
      reset();
      setTimeout(() => setToast(null), 5000);
    },
    onError: err => setToast({ type: 'error', msg: err?.message ?? 'Failed to log visit' }),
  });

  function reset() {
    setSid(''); setSName(''); setStuSearch('');
    setForm({ complaint: '', observation: '', actionTaken: '', medicationGiven: '', returnedToClass: false, sentHome: false, referred: false, referredTo: '', notes: '' });
  }

  const canSubmit = !!sid && form.complaint.trim().length > 0 && (!form.referred || form.referredTo.trim().length > 0);

  function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    mutation.mutate({ studentId: sid, studentName: sName, ...form });
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4 max-w-2xl">
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className={`rounded-xl border px-4 py-3 text-sm font-medium flex items-start gap-3 ${
              toast.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
            <span>{toast.type === 'success' ? `Visit logged for ${toast.student}.` : toast.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Student</h3>
        {sid ? (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
            <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 text-xs font-bold">{sName[0]}</div>
            <span className="flex-1 text-sm font-medium text-slate-800">{sName}</span>
            <button type="button" onClick={() => { setSid(''); setSName(''); setStuSearch(''); }} className="text-slate-400 hover:text-red-500 transition"><X size={14} /></button>
          </div>
        ) : (
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={stuSearch}
              onChange={e => setStuSearch(e.target.value)}
              placeholder="Search student by name or admission number…"
              className="w-full text-sm pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400"
            />
            {stuResults.length > 0 && (
              <div className="mt-2 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {stuResults.map(s => {
                  const id = s.id ?? s._id;
                  return (
                    <button
                      key={id} type="button"
                      onClick={() => { setSid(id); setSName(`${s.firstName} ${s.lastName}`); setStuSearch(''); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition flex items-center justify-between"
                    >
                      <span className="text-slate-800">{s.firstName} {s.lastName}</span>
                      <span className="text-xs text-slate-400">{s.admissionNumber}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={submit} className="space-y-4">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Visit Details</h3>
          <FField label="Complaint" required>
            <input className={iCls()} value={form.complaint} onChange={e => set('complaint', e.target.value)} placeholder="e.g. Headache, stomach ache…" />
          </FField>
          <FField label="Observation">
            <textarea rows={2} className={`${iCls()} resize-none`} value={form.observation} onChange={e => set('observation', e.target.value)} />
          </FField>
          <FField label="Action taken">
            <textarea rows={2} className={`${iCls()} resize-none`} value={form.actionTaken} onChange={e => set('actionTaken', e.target.value)} />
          </FField>
          <FField label="Medication given">
            <input className={iCls()} value={form.medicationGiven} onChange={e => set('medicationGiven', e.target.value)} placeholder="e.g. Paracetamol 500mg" />
          </FField>
          <div className="flex flex-wrap gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.returnedToClass} onChange={e => set('returnedToClass', e.target.checked)} className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/10" />
              Returned to class
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.sentHome} onChange={e => set('sentHome', e.target.checked)} className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/10" />
              Sent home
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={form.referred} onChange={e => set('referred', e.target.checked)} className="rounded border-slate-300 text-slate-900 focus:ring-slate-900/10" />
              Referred
            </label>
          </div>
          {form.referred && (
            <FField label="Referred to" required>
              <input className={iCls()} value={form.referredTo} onChange={e => set('referredTo', e.target.value)} placeholder="e.g. City Hospital, family doctor…" />
            </FField>
          )}
          <FField label="Notes">
            <textarea rows={2} className={`${iCls()} resize-none`} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </FField>
        </div>

        <button
          type="submit"
          disabled={!canSubmit || mutation.isPending}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <HeartPulse size={13} />}
          {mutation.isPending ? 'Saving…' : 'Log visit'}
        </button>
      </form>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════
   VISITS — the clinic's timeline
   ══════════════════════════════════════════════════════════════ */
function VisitsTab() {
  const qc = useQueryClient();
  const can = useAuthStore(s => s.can);
  const canDelete = can('medical', 'delete');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['medical', 'visits', { page, search }],
    queryFn:  () => medicalApi.visits.list({ page, limit: LIMIT, search: search || undefined }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data ?? [];
  const pagination = data?.pagination ?? {};
  const totalPages = pagination.pages ?? 1;
  const total      = pagination.total ?? rows.length;

  const deleteMutation = useMutation({
    mutationFn: id => medicalApi.visits.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['medical', 'visits'] }),
  });

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      <div className="relative max-w-sm">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          placeholder="Search by student or complaint…"
          className="w-full text-sm pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-16 animate-pulse" />)}</div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <AlertTriangle size={24} className="text-red-400" />
          <p className="text-sm text-slate-500">{error?.message ?? 'Failed to load'}</p>
          <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <ClipboardList size={36} className="mb-3 opacity-40" />
          <p className="text-sm font-medium text-slate-600">No visits recorded</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Student</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Complaint</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Outcome</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                {canDelete && <th className="px-4 py-3 w-10" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(v => (
                <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{v.studentName ?? v.studentId}</td>
                  <td className="px-4 py-3 text-slate-600 max-w-[240px]"><span className="block truncate">{v.complaint}</span></td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <div className="flex items-center gap-1.5">
                      {v.sentHome && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"><Home size={11} /> Sent home</span>}
                      {v.referred && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200"><Ambulance size={11} /> Referred</span>}
                      {!v.sentHome && !v.referred && v.returnedToClass && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Returned to class</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">{v.date ? new Date(v.date).toLocaleDateString('en-GB') : '—'}</td>
                  {canDelete && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => { if (confirm('Remove this visit record?')) deleteMutation.mutate(v.id); }}
                        className="text-slate-300 hover:text-red-500 transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
            <p className="text-xs text-slate-500">{total} result{total !== 1 ? 's' : ''}</p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronLeft size={14} /></button>
              <span className="text-xs text-slate-500 px-2">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ALERTS — condition flags only, never the full medical profile.
   Scoped server-side to the requester's own classes for teachers.
   ══════════════════════════════════════════════════════════════ */
function AlertsTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['medical', 'alerts'],
    queryFn:  () => medicalApi.alerts.list(),
    staleTime: 60_000,
  });
  const alerts = data?.data ?? [];
  const noAssignments = data?.pagination?.noAssignments === true;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-14 animate-pulse" />)}</div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <AlertTriangle size={24} className="text-red-400" />
          <p className="text-sm text-slate-500">{error?.message ?? 'Failed to load'}</p>
          <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
        </div>
      ) : alerts.length === 0 && noAssignments ? (
        // Distinct from "checked and there are none": no classes are
        // assigned to this account at all, so nothing was actually checked.
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <AlertTriangle size={36} className="mb-3 opacity-40" />
          <p className="text-sm font-medium text-slate-600">No classes assigned to your account yet</p>
          <p className="text-xs mt-1 text-center max-w-xs">
            Your role has permission to view medical alerts, but no classes are assigned to you.
            Ask your school admin to assign classes, or adjust this role's data visibility in Settings → Roles &amp; Permissions.
          </p>
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <ShieldAlert size={36} className="mb-3 opacity-40" />
          <p className="text-sm font-medium text-slate-600">No critical alerts</p>
          <p className="text-xs mt-1 text-center max-w-xs">No student in your classes has a flagged critical condition on file.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {alerts.map(a => (
            <div key={a.studentId} className="px-4 py-3 flex items-start gap-3">
              <ShieldAlert size={16} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-slate-800">{a.studentName}{a.className ? <span className="text-slate-400 font-normal"> — {a.className}</span> : null}</p>
                <p className="text-xs text-red-700 mt-0.5">
                  {[a.severeAllergy && 'Severe allergy', a.hasAsthma && 'Asthma', a.hasEpilepsy && 'Epilepsy', a.otherCriticalAlert].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════
   REPORTS — simple operational counts, no advanced analytics
   ══════════════════════════════════════════════════════════════ */
function ReportsTab() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['medical', 'reports'],
    queryFn:  () => medicalApi.reports.summary(),
    staleTime: 60_000,
  });
  const r = data?.data;

  if (isLoading) {
    return <div className="grid grid-cols-2 md:grid-cols-4 gap-3">{[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-24 animate-pulse" />)}</div>;
  }
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <AlertTriangle size={24} className="text-red-400" />
        <p className="text-sm text-slate-500">{error?.message ?? 'Failed to load'}</p>
        <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-5">
      <div className="grid grid-cols-2 gap-3 max-w-sm">
        <StatCard icon={<CalendarDays size={16} />} label="Visits Today" value={r.visitsToday} />
        <StatCard icon={<TrendingUp size={16} />} label="Visits This Month" value={r.visitsThisMonth} />
      </div>

      <p className="text-xs text-slate-400">Common Conditions and Frequent Visitors cover {r.periodFrom} to {r.periodTo}.</p>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Common Conditions</h3>
          {r.commonConditions.length === 0 ? (
            <p className="text-sm text-slate-400">No visits recorded this period.</p>
          ) : (
            <ul className="space-y-2">
              {r.commonConditions.map(c => (
                <li key={c.complaint} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700 truncate">{c.complaint}</span>
                  <span className="text-slate-400 font-medium shrink-0 ml-3">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Frequent Visitors</h3>
          {r.frequentVisitors.length === 0 ? (
            <p className="text-sm text-slate-400">No visits recorded this period.</p>
          ) : (
            <ul className="space-y-2">
              {r.frequentVisitors.map(v => (
                <li key={v.studentId} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700 truncate">{v.studentName ?? v.studentId}</span>
                  <span className="text-slate-400 font-medium shrink-0 ml-3">{v.visitCount} visit{v.visitCount !== 1 ? 's' : ''}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
      <div className="text-slate-400">{icon}</div>
      <div className="text-2xl font-semibold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

/* ── Shared field helpers (self-contained — Medical Centre is its own
   module, deliberately not importing Behaviour's primitives) ──────── */
function FField({ label, required, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-600">{label}{required && <span className="text-red-400"> *</span>}</label>
      {children}
    </div>
  );
}
function iCls() {
  return 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 placeholder-slate-400 transition';
}
