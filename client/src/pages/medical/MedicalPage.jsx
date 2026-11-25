/* ============================================================
   MedicalPage — Medical Centre (Module 1, milestone 3: Clinic Visits)
   Log Visit, Visits (open one for everything recorded), Alerts, Reports,
   Settings — each shown only to those allowed (GET /medical/access).
   ============================================================ */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  HeartPulse, ClipboardList, Search, X, Loader2, CheckCircle2,
  AlertTriangle, ChevronLeft, ChevronRight, Trash2, Home, Ambulance, ShieldAlert,
  BarChart3, CalendarDays, TrendingUp, Settings as SettingsIcon,
} from 'lucide-react';
import { medical as medicalApi, students as studentsApi } from '@/api/client.js';

const LIMIT = 20;

export default function MedicalPage() {
  const [tab, setTab] = useState('log');
  // What this person may do here, from the server: the same rule every route uses.
  const { data: accessData, isLoading: accessLoading, isError: accessFailed, refetch: retryAccess } = useQuery({
    queryKey: ['medical', 'access'],
    queryFn:  () => medicalApi.access(),
    staleTime: 60_000,
  });
  const access = accessData?.data ?? {};

  const TABS = [
    ...(access.record   ? [{ id: 'log', label: 'Log Visit', icon: HeartPulse }] : []),
    ...(access.visits   ? [{ id: 'visits', label: 'Visits', icon: ClipboardList }] : []),
    ...(access.alerts   ? [{ id: 'alerts', label: 'Alerts', icon: ShieldAlert }] : []),
    ...(access.reports  ? [{ id: 'reports', label: 'Reports', icon: BarChart3 }] : []),
    ...(access.settings ? [{ id: 'settings', label: 'Settings', icon: SettingsIcon }] : []),
  ];
  const activeTab = TABS.some(t => t.id === tab) ? tab : (TABS[0]?.id ?? null);

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
          {accessLoading && <div key="loading" className="flex justify-center py-24"><Loader2 size={20} className="animate-spin text-slate-400" /></div>}
          {accessFailed && <p key="failed" className="text-sm text-slate-500 text-center py-24">The Medical Centre could not be loaded. <button onClick={() => retryAccess()} className="underline">Try again</button></p>}
          {accessData && !activeTab && <p key="none" className="text-sm text-slate-500 text-center py-24">Nothing in the Medical Centre is open to your role. Ask your school admin (Settings → Roles &amp; Permissions → Medical Centre).</p>}
          {activeTab === 'log'     && <LogVisitTab key="log" access={access} />}
          {activeTab === 'visits'  && <VisitsTab key="visits" access={access} />}
          {activeTab === 'alerts'  && <AlertsTab key="alerts" />}
          {activeTab === 'reports' && <ReportsTab key="reports" />}
          {activeTab === 'settings' && <MedicalSettingsTab key="settings" />}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   LOG VISIT — student search → visit form
   ══════════════════════════════════════════════════════════════ */
function LogVisitTab({ access }) {
  const qc = useQueryClient();
  const [sid, setSid]     = useState('');
  const [sName, setSName] = useState('');
  const [stuSearch, setStuSearch] = useState('');
  const [toast, setToast] = useState(null);

  const EMPTY = {
    complaint: '', observation: '', actionTaken: '', medicationGiven: '',
    returnedToClass: false, sentHome: false, referred: false, referredTo: '', notes: '', clinicNotes: '',
  };
  const [form, setForm] = useState(EMPTY);
  const { data: setData } = useQuery({ queryKey: ['medical', 'settings'], queryFn: () => medicalApi.settings.get(), staleTime: 60_000 });
  const parentsSeeNotes = setData?.data?.parentsSeeNotes;
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
    setForm(EMPTY);
  }

  const canSubmit = !!sid && form.complaint.trim().length > 0 && (!form.referred || form.referredTo.trim().length > 0);

  function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    const { clinicNotes, ...rest } = form;
    mutation.mutate({ studentId: sid, studentName: sName, ...rest, ...(clinicNotes.trim() ? { clinicNotes } : {}) });
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
          <FField label={parentsSeeNotes === undefined ? 'Notes' : parentsSeeNotes ? 'Notes (parents can read this)' : 'Notes (not shown to parents)'}>
            <textarea rows={2} className={`${iCls()} resize-none`} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </FField>
          {access.clinicNotes?.write && (
            <FField label="Clinic-only notes (never shown to parents)">
              <textarea rows={2} className={`${iCls()} resize-none`} value={form.clinicNotes} onChange={e => set('clinicNotes', e.target.value)} />
            </FField>
          )}
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
   VISITS — the clinic's timeline; open one to see everything logged
   ══════════════════════════════════════════════════════════════ */
function Outcome({ v }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {v.sentHome && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"><Home size={11} /> Sent home</span>}
      {v.referred && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200"><Ambulance size={11} /> Referred</span>}
      {!v.sentHome && !v.referred && v.returnedToClass && <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">Returned to class</span>}
    </div>
  );
}
const fmtDay = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-GB') : '—');
const fmtLogged = (t) => (t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm text-slate-800 whitespace-pre-wrap break-words mt-0.5">{value || <span className="text-slate-300">Not recorded</span>}</dd>
    </div>
  );
}

/* Everything logged at one visit, then the student's other visits. */
function VisitDetails({ visitId, onOpen, onClose, access }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['medical', 'visit', visitId],
    queryFn:  () => medicalApi.visits.get(visitId),
  });
  const v = data?.data;
  const { data: histData, isError: histFailed } = useQuery({
    queryKey: ['medical', 'visits', 'student', v?.studentId],
    queryFn:  () => medicalApi.visits.list({ studentId: v.studentId, limit: 100 }),
    enabled:  !!v?.studentId,
  });
  const others = (histData?.data ?? []).filter(x => x.id !== visitId);
  const { data: setData } = useQuery({ queryKey: ['medical', 'settings'], queryFn: () => medicalApi.settings.get(), staleTime: 60_000 });
  const parentsSeeNotes = setData?.data?.parentsSeeNotes;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Clinic visit">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/30" />
      <div className="relative w-full max-w-lg h-full bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 truncate">{v?.studentName ?? 'Clinic visit'}</h2>
            {v && <p className="text-xs text-slate-500 mt-0.5">{fmtDay(v.date)}{v.time ? ` · ${v.time}` : ''}</p>}
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100" aria-label="Close"><X size={16} /></button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 size={20} className="animate-spin text-slate-400" /></div>
        ) : isError ? (
          <div className="text-center py-16 space-y-2">
            <p className="text-sm text-slate-500">{error?.message ?? 'This visit could not be opened.'}</p>
            <button onClick={() => refetch()} className="text-xs font-medium text-slate-700 underline">Try again</button>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-5">
            <Outcome v={v} />
            <dl className="space-y-4">
              <Detail label="Complaint" value={v.complaint} />
              <Detail label="Observation" value={v.observation} />
              <Detail label="Action taken" value={v.actionTaken} />
              <Detail label="Medication given" value={v.medicationGiven} />
              {v.referred && <Detail label="Referred to" value={v.referredTo} />}
              <Detail label={parentsSeeNotes === undefined ? 'Notes' : parentsSeeNotes ? 'Notes (parents can read this)' : 'Notes (not shown to parents)'} value={v.notes} />
              {access.clinicNotes?.read && <Detail label="Clinic-only notes (never shown to parents)" value={v.clinicNotes} />}
            </dl>
            <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
              <Detail label="Recorded by" value={v.recordedByName} />
              <Detail label="Logged at" value={fmtLogged(v.createdAt)} />
            </div>

            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Other visits by this student{others.length ? ` (${others.length})` : ''}</h3>
              {histFailed ? (
                <p className="text-xs text-red-600">The other visits could not be loaded.</p>
              ) : others.length === 0 ? (
                <p className="text-xs text-slate-400">No other visits on record.</p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
                  {others.map(x => (
                    <li key={x.id}>
                      <button type="button" onClick={() => onOpen(x.id)} className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-3">
                        <span className="text-sm text-slate-700 truncate">{x.complaint}</span>
                        <span className="text-xs text-slate-400 shrink-0">{fmtDay(x.date)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* Find one student's visits: names only, from the Medical Centre's own list. */
function StudentFilter({ student, setStudent }) {
  const [q, setQ] = useState('');
  const { data } = useQuery({
    queryKey: ['medical', 'students', q],
    queryFn:  () => medicalApi.students(q),
    enabled:  q.trim().length >= 2,
    staleTime: 30_000,
  });
  const results = q.trim().length >= 2 ? (data?.data ?? []) : [];
  if (student) {
    return (
      <span className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-800">
        {student.name}
        <button type="button" onClick={() => setStudent(null)} aria-label="Show all students" className="text-slate-400 hover:text-red-500"><X size={13} /></button>
      </span>
    );
  }
  return (
    <div className="relative w-full sm:w-56">
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="One student…" aria-label="Show one student's visits"
        className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 placeholder-slate-400" />
      {results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full min-w-[16rem] bg-white border border-slate-200 rounded-lg shadow-lg divide-y divide-slate-100 max-h-60 overflow-y-auto">
          {results.map(s => (
            <button key={s.id} type="button" onClick={() => { setStudent(s); setQ(''); }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between gap-3">
              <span className="text-slate-800 truncate">{s.name}</span>
              <span className="text-xs text-slate-400 shrink-0">{s.admissionNumber}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VisitsTab({ access }) {
  const qc = useQueryClient();
  const canDelete = !!access.remove;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [student, setStudent] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [openId, setOpenId] = useState(null);
  const filter = { search: search || undefined, studentId: student?.id, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined };
  const isFiltered = Object.values(filter).some(Boolean);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['medical', 'visits', { page, ...filter }],
    queryFn:  () => medicalApi.visits.list({ page, limit: LIMIT, ...filter }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data ?? [];
  const pagination = data?.pagination ?? {};
  const totalPages = pagination.pages ?? 1;
  const total      = pagination.total ?? rows.length;

  const deleteMutation = useMutation({
    mutationFn: id => medicalApi.visits.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['medical', 'visits'] }),
    onError:    err => window.alert(err?.message ?? 'The visit could not be removed.'),
  });
  const first = (fn) => (v) => { fn(v); setPage(1); };
  const dateCls = 'text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/10';

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => first(setSearch)(e.target.value)}
            placeholder="Search by student or complaint…"
            className="w-full text-sm pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400"
          />
        </div>
        <StudentFilter student={student} setStudent={first(setStudent)} />
        <label className="flex items-center gap-1.5 text-xs text-slate-500">From <input type="date" value={dateFrom} max={dateTo || undefined} onChange={e => first(setDateFrom)(e.target.value)} className={dateCls} /></label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">To <input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => first(setDateTo)(e.target.value)} className={dateCls} /></label>
        {isFiltered && (
          <button type="button" onClick={() => { setSearch(''); setStudent(null); setDateFrom(''); setDateTo(''); setPage(1); }} className="text-xs text-slate-500 underline">Clear</button>
        )}
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
          <p className="text-sm font-medium text-slate-600">{isFiltered ? 'No visits match' : 'No visits recorded'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <p className="px-4 py-2 text-xs text-slate-400 border-b border-slate-100">Open a visit to see everything recorded.</p>
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
                <tr key={v.id} onClick={() => setOpenId(v.id)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <button type="button" onClick={e => { e.stopPropagation(); setOpenId(v.id); }} className="text-left hover:underline">{v.studentName ?? v.studentId}</button>
                  </td>
                  <td className="px-4 py-3 text-slate-600 max-w-[240px]"><span className="block truncate">{v.complaint}</span></td>
                  <td className="px-4 py-3 hidden sm:table-cell"><Outcome v={v} /></td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400 whitespace-nowrap">{fmtDay(v.date)}</td>
                  {canDelete && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={e => { e.stopPropagation(); if (confirm('Remove this visit record?')) deleteMutation.mutate(v.id); }}
                        aria-label="Remove this visit record"
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
      {openId && <VisitDetails visitId={openId} onOpen={setOpenId} onClose={() => setOpenId(null)} access={access} />}
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SETTINGS — what parents see of a clinic visit
   ══════════════════════════════════════════════════════════════ */
function MedicalSettingsTab() {
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['medical', 'settings'], queryFn: () => medicalApi.settings.get() });
  const save = useMutation({
    mutationFn: (patch) => medicalApi.settings.update(patch),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['medical', 'settings'] }),
    onError:    err => window.alert(err?.message ?? 'The setting could not be saved.'),
  });
  if (isLoading) return <div className="bg-white border border-slate-200 rounded-xl h-32 animate-pulse" />;
  if (isError) return <p className="text-sm text-slate-500">The settings could not be loaded. <button onClick={() => refetch()} className="underline">Try again</button></p>;
  const s = data.data;
  const ROWS = [
    ['parentsSeeNotes', 'Parents can read the visit notes', 'The Notes field on Clinic Visits in the parent portal. Clinic-only notes are never shown to parents.'],
    ['alertShowsComplaint', 'Name the complaint in the alert to parents', 'The alert can show on a locked phone. Off: the alert only says a visit was logged, and the parent opens Msingi to read it.'],
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 max-w-2xl">
      {ROWS.map(([key, label, help]) => (
        <label key={key} className="flex items-start gap-3 px-5 py-4 cursor-pointer">
          <input type="checkbox" checked={!!s[key]} disabled={save.isPending} onChange={e => save.mutate({ [key]: e.target.checked })} className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900/10" />
          <span>
            <span className="block text-sm font-medium text-slate-800">{label}</span>
            <span className="block text-xs text-slate-500 mt-0.5">{help}</span>
          </span>
        </label>
      ))}
      <p className="px-5 py-3 text-xs text-slate-400">Who can see visits, clinic-only notes and the student medical profile is set in Settings → Roles &amp; Permissions → Medical Centre.</p>
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
