/* ============================================================
   HR & Staff — leave management, payroll overview, staff list
   Builds on /api/teachers + /api/hr for HR-specific data.
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Users, UserCheck, Clock, Wallet, Plus, Check, X,
  AlertCircle, Calendar, FolderOpen, Trash2, Edit2, Save,
  Download, ExternalLink, Loader2, Copy,
} from 'lucide-react';
import { hr as hrApi, teachers as teachersApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

/* ── Constants ──────────────────────────────────────────── */
const HR_ROLES    = ['superadmin','admin','hr'];
const DOC_TYPES   = { contract:'Contract', appraisal:'Appraisal', certificate:'Certificate', id_copy:'ID / Document', other:'Other' };
const DOC_COLORS  = { contract:'bg-blue-100 text-blue-700', appraisal:'bg-purple-100 text-purple-700', certificate:'bg-emerald-100 text-emerald-700', id_copy:'bg-amber-100 text-amber-700', other:'bg-slate-100 text-slate-600' };
const LEAVE_TYPES = { annual:'Annual Leave', sick:'Sick Leave', emergency:'Emergency', maternity:'Maternity', paternity:'Paternity', unpaid:'Unpaid Leave' };
const LEAVE_COLORS = { annual:'bg-blue-100 text-blue-700', sick:'bg-amber-100 text-amber-700', emergency:'bg-red-100 text-red-700', maternity:'bg-pink-100 text-pink-700', paternity:'bg-purple-100 text-purple-700', unpaid:'bg-slate-100 text-slate-600' };
const STATUS_COLORS = { pending:'bg-amber-100 text-amber-700', approved:'bg-emerald-100 text-emerald-700', rejected:'bg-red-100 text-red-600' };

/* ── Helpers ──────────────────────────────────────────────── */
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}
function fmtMoney(n, sym = 'KSh') {
  if (n == null) return '—';
  return `${sym} ${Number(n).toLocaleString()}`;
}
function initials(name = '') {
  return name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
}
function getPrevPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, '0')}`;
}
function fmtPeriodLabel(period) {
  try {
    return new Date(`${period}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  } catch { return period; }
}

/* ── Sub-components ─────────────────────────────────────── */
function StatCard({ label, value, sub, Icon, color }) {
  const colors = { violet:'bg-violet-50 text-violet-600', green:'bg-emerald-50 text-emerald-600', amber:'bg-amber-50 text-amber-600', red:'bg-red-50 text-red-600', blue:'bg-blue-50 text-blue-600' };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`rounded-lg p-2 ${colors[color] ?? colors.violet}`}><Icon size={16} /></div>
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function Badge({ cls, text }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{text}</span>;
}

/* ── Leave request form ─────────────────────────────────── */
function LeaveForm({ onClose, onSubmit }) {
  const [form, setForm] = useState({ type:'annual', startDate:'', endDate:'', reason:'' });
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">Submit Leave Request</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={16} /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Leave Type *</label>
            <select required value={form.type} onChange={e => set('type', e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40">
              {Object.entries(LEAVE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Start Date *</label>
              <input required type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">End Date *</label>
              <input required type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Reason</label>
            <textarea value={form.reason} onChange={e => set('reason', e.target.value)} rows={3} placeholder="Brief reason for leave…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 resize-none" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 flex items-center gap-1.5">
              <Check size={13} /> Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Document form ──────────────────────────────────────── */
function DocForm({ teachers, onClose, onSubmit, saving }) {
  const [form, setForm] = useState({ staffId:'', staffName:'', name:'', type:'contract', issuedDate:'', expiryDate:'', notes:'', fileUrl:'', status:'active' });
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function pickStaff(id) {
    const t = teachers.find(x => (x._id ?? x.id) === id);
    setForm(f => ({ ...f, staffId: id, staffName: t ? (t.name ?? `${t.firstName} ${t.lastName}`) : '' }));
  }
  const fCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">Add Staff Document</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={16} /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onSubmit(form); }} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Staff Member *</label>
            <select required value={form.staffId} onChange={e => pickStaff(e.target.value)} className={fCls}>
              <option value="">Select staff…</option>
              {teachers.map(t => (
                <option key={t._id ?? t.id} value={t._id ?? t.id}>{t.name ?? `${t.firstName} ${t.lastName}`}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Document Name *</label>
            <input required value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Employment Contract 2025" className={fCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Document Type *</label>
            <select value={form.type} onChange={e => set('type', e.target.value)} className={fCls}>
              {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Issue Date</label>
              <input type="date" value={form.issuedDate} onChange={e => set('issuedDate', e.target.value)} className={fCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Expiry Date</label>
              <input type="date" value={form.expiryDate} onChange={e => set('expiryDate', e.target.value)} className={fCls} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Document Link <span className="font-normal text-slate-400">(optional)</span></label>
            <input type="url" value={form.fileUrl} onChange={e => set('fileUrl', e.target.value)}
              placeholder="https://drive.google.com/… or OneDrive / Dropbox link" className={fCls} />
            <p className="text-[11px] text-slate-400 mt-1">Paste a shareable link to the document stored in Google Drive, OneDrive, or Dropbox.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any additional notes…" className={`${fCls} resize-none`} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <><span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Saving…</> : <><Save size={13} /> Save Document</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Payroll entry form ──────────────────────────────────── */
function PayrollForm({ teachers, defaultPeriod, record, sym, onClose, onSave, saving }) {
  const isEdit = !!record;
  const [form, setForm] = useState({
    staffId:     record?.staffId     ?? '',
    staffName:   record?.staffName   ?? '',
    payPeriod:   record?.payPeriod   ?? defaultPeriod,
    basicSalary: record?.basicSalary ?? '',
    allowances:  record?.allowances  ?? 0,
    deductions:  record?.deductions  ?? 0,
  });

  const gross = (Number(form.basicSalary) || 0) + (Number(form.allowances) || 0);
  const net   = gross - (Number(form.deductions) || 0);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function pickStaff(id) {
    const t = teachers.find(x => (x.userId ?? x._id ?? x.id) === id);
    set('staffId',   id);
    set('staffName', t ? (t.name ?? `${t.firstName} ${t.lastName}`) : '');
  }

  const fCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">{isEdit ? 'Edit Payroll Entry' : 'Add Payroll Entry'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={16} /></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); onSave({ ...form, basicSalary: Number(form.basicSalary), allowances: Number(form.allowances || 0), deductions: Number(form.deductions || 0) }); }}
          className="p-5 space-y-4">

          {/* Staff */}
          {isEdit ? (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Staff Member</label>
              <p className="text-sm font-medium text-slate-800 bg-slate-50 rounded-lg px-3 py-2">{record.staffName}</p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Staff Member *</label>
              <select required value={form.staffId} onChange={e => pickStaff(e.target.value)} className={fCls}>
                <option value="">Select staff…</option>
                {teachers.map(t => {
                  const val = t.userId ?? t._id ?? t.id;
                  return <option key={val} value={val}>{t.name ?? `${t.firstName} ${t.lastName}`}</option>;
                })}
              </select>
            </div>
          )}

          {/* Pay period */}
          {isEdit ? (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Pay Period</label>
              <p className="text-sm font-medium text-slate-800 bg-slate-50 rounded-lg px-3 py-2">{fmtPeriodLabel(record.payPeriod)}</p>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Pay Period *</label>
              <input required type="month" value={form.payPeriod} onChange={e => set('payPeriod', e.target.value)} className={fCls} />
            </div>
          )}

          {/* Salary fields */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Basic Salary *</label>
              <input required type="number" min="0" step="any" value={form.basicSalary}
                onChange={e => set('basicSalary', e.target.value)} className={fCls} placeholder="0" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Allowances</label>
              <input type="number" min="0" step="any" value={form.allowances}
                onChange={e => set('allowances', e.target.value)} className={fCls} placeholder="0" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Deductions</label>
              <input type="number" min="0" step="any" value={form.deductions}
                onChange={e => set('deductions', e.target.value)} className={fCls} placeholder="0" />
            </div>
          </div>

          {/* Live summary */}
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Gross</p>
              <p className="text-sm font-bold text-slate-800 mt-0.5">{sym} {gross.toLocaleString()}</p>
            </div>
            <div className="border-x border-slate-200">
              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Deductions</p>
              <p className="text-sm font-bold text-red-600 mt-0.5">− {sym} {(Number(form.deductions) || 0).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">Net Pay</p>
              <p className="text-sm font-bold text-emerald-700 mt-0.5">{sym} {net.toLocaleString()}</p>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={saving} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <><Loader2 size={13} className="animate-spin" /> Saving…</> : <><Save size={13} /> Save</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════ */
export default function HRPage() {
  const qc     = useQueryClient();
  const user   = useAuthStore(s => s.session?.user);
  const school = useAuthStore(s => s.session?.school);
  const sym    = school?.currencySymbol ?? 'KSh';
  const isHR   = HR_ROLES.includes(user?.role);

  const [tab, setTab]                 = useState('staff');
  const [showLeaveForm, setLeaveForm] = useState(false);
  const [payPeriod, setPayPeriod]     = useState(() => new Date().toISOString().slice(0, 7));
  const [showDocForm, setDocForm]     = useState(false);
  const [docStaffFilter, setDocStaff] = useState('');
  const [payrollModal, setPayrollModal] = useState(null); // null | { mode:'add'|'edit', record:null|{...} }
  const [deletingPayroll, setDeletingPayroll] = useState(null); // null | { staffId, period }

  /* ── Queries ── */
  const { data: summaryData } = useQuery({
    queryKey: ['hr','summary'],
    queryFn:  hrApi.summary,
    enabled:  isHR,
  });

  const { data: teachersData } = useQuery({
    queryKey: ['teachers'],
    queryFn:  () => teachersApi.list({ limit: 100 }),
  });

  const { data: leaveData } = useQuery({
    queryKey: ['hr','leave'],
    queryFn:  () => hrApi.leave.list({}),
  });

  const { data: payrollData, isLoading: payLoading } = useQuery({
    queryKey: ['hr','payroll', payPeriod],
    queryFn:  () => hrApi.payroll.list({ period: payPeriod }),
    enabled:  isHR,
    staleTime: 0,
  });

  const { data: docsData, isLoading: docsLoading } = useQuery({
    queryKey: ['hr','documents', docStaffFilter],
    queryFn:  () => hrApi.documents.list(docStaffFilter ? { staffId: docStaffFilter } : {}),
    enabled:  tab === 'documents' && isHR,
    staleTime: 60_000,
  });

  const teachers    = teachersData?.teachers ?? teachersData?.data ?? [];
  const leaves      = leaveData?.requests    ?? [];
  const payrollRecs = payrollData?.records   ?? [];
  const summary     = summaryData ?? {};

  const pendingLeaves = leaves.filter(l => l.status === 'pending');

  /* ── Mutations ── */
  const submitLeave = useMutation({
    mutationFn: hrApi.leave.submit,
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['hr','leave'] }); setLeaveForm(false); },
  });

  const createDoc = useMutation({
    mutationFn: hrApi.documents.create,
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['hr','documents'] }); setDocForm(false); },
  });

  const removeDoc = useMutation({
    mutationFn: id => hrApi.documents.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['hr','documents'] }),
  });

  const resolveLeave = useMutation({
    mutationFn: ({ id, status }) => hrApi.leave.resolve(id, { status }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['hr','leave'] }),
  });

  const savePayroll = useMutation({
    mutationFn: hrApi.payroll.save,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['hr','payroll'] });
      qc.invalidateQueries({ queryKey: ['hr','summary'] });
      setPayrollModal(null);
    },
  });

  const deletePayroll = useMutation({
    mutationFn: hrApi.payroll.remove,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['hr','payroll'] });
      qc.invalidateQueries({ queryKey: ['hr','summary'] });
      setDeletingPayroll(null);
    },
    onSettled: () => setDeletingPayroll(null),
  });

  const copyPayroll = useMutation({
    mutationFn: hrApi.payroll.copy,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['hr','payroll'] });
      qc.invalidateQueries({ queryKey: ['hr','summary'] });
    },
  });

  const docs = docsData?.documents ?? [];

  const TABS = [
    { id:'staff',     label:'Staff',     Icon: Users      },
    { id:'leave',     label:`Leave${pendingLeaves.length ? ` (${pendingLeaves.length})` : ''}`, Icon: Calendar },
    ...(isHR ? [{ id:'payroll',   label:'Payroll',   Icon: Wallet     }] : []),
    ...(isHR ? [{ id:'documents', label:'Documents', Icon: FolderOpen }] : []),
  ];

  const prevPeriod = getPrevPeriod(payPeriod);

  /* ── CSV export helper ── */
  function exportPayrollCSV() {
    const header = ['Staff','Basic Salary','Allowances','Gross Salary','Deductions','Net Pay'];
    const rows = payrollRecs.map(p => [
      p.staffName ?? '',
      p.basicSalary ?? 0,
      p.allowances  ?? 0,
      p.grossSalary ?? 0,
      p.deductions  ?? 0,
      p.netSalary   ?? 0,
    ]);
    const totRow = [
      'TOTAL',
      payrollRecs.reduce((s,r) => s+(r.basicSalary||0), 0),
      payrollRecs.reduce((s,r) => s+(r.allowances||0), 0),
      payrollRecs.reduce((s,r) => s+(r.grossSalary||0), 0),
      payrollRecs.reduce((s,r) => s+(r.deductions||0), 0),
      payrollRecs.reduce((s,r) => s+(r.netSalary||0), 0),
    ];
    const csv = [header, ...rows, totRow].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const el   = document.createElement('a');
    el.href = url; el.download = `payroll_${payPeriod}.csv`;
    el.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">HR & Staff</h1>
          <p className="text-slate-500 text-sm mt-0.5">Leave management, payroll, and staff overview.</p>
        </div>
        <div className="flex items-center gap-2">
          {tab === 'documents' && isHR && (
            <button onClick={() => setDocForm(true)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
              <Plus size={14} /> Add Document
            </button>
          )}
          <button onClick={() => setLeaveForm(true)} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 transition">
            <Plus size={14} /> Request Leave
          </button>
        </div>
      </div>

      {/* Stats (HR/admin only) */}
      {isHR && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard label="Total Staff"    value={summary.totalStaff ?? teachers.length} Icon={Users}      color="violet" />
          <StatCard label="Active"         value={summary.activeStaff ?? '—'}            Icon={UserCheck}  color="green"  />
          <StatCard label="On Leave"       value={summary.onLeave ?? '—'}                Icon={Clock}      color="amber"  />
          <StatCard label="Pending Leaves" value={summary.pendingLeaves ?? pendingLeaves.length} Icon={AlertCircle} color="red" />
          <StatCard label="Net Payroll"    value={fmtMoney(summary.totalNetPayroll, sym)} sub={fmtPeriodLabel(payPeriod)} Icon={Wallet} color="blue" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === t.id ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
            <t.Icon size={13} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── STAFF TAB ── */}
      {tab === 'staff' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teachers.length === 0 ? (
            <p className="col-span-3 text-center text-slate-400 text-sm py-16">No staff records found.</p>
          ) : teachers.map((t, i) => (
            <motion.div key={t.id ?? t._id} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay: i * 0.03 }}
              className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 font-bold text-sm">
                {initials(t.name ?? `${t.firstName} ${t.lastName}`)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 text-sm truncate">{t.name ?? `${t.firstName} ${t.lastName}`}</p>
                <p className="text-xs text-slate-500 truncate">{t.specialization || t.email}</p>
                <Badge cls={t.status === 'active' ? 'bg-emerald-100 text-emerald-700 mt-1' : 'bg-slate-100 text-slate-600 mt-1'} text={t.status ?? 'active'} />
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* ── LEAVE TAB ── */}
      {tab === 'leave' && (
        <div className="space-y-3">
          {leaves.length === 0 ? (
            <div className="text-center py-16">
              <Calendar size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500 text-sm">No leave requests yet.</p>
              <button onClick={() => setLeaveForm(true)} className="mt-3 text-violet-600 text-sm hover:underline">Submit your first request</button>
            </div>
          ) : (
            leaves.map((l, i) => (
              <motion.div key={l.id} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay: i * 0.04 }}
                className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge cls={LEAVE_COLORS[l.type] ?? 'bg-slate-100 text-slate-600'} text={LEAVE_TYPES[l.type] ?? l.type} />
                      <Badge cls={STATUS_COLORS[l.status] ?? 'bg-slate-100 text-slate-600'} text={l.status} />
                    </div>
                    <p className="font-medium text-slate-900 text-sm">{l.staffName}</p>
                    <p className="text-xs text-slate-500">{fmtDate(l.startDate)} – {fmtDate(l.endDate)} · {l.days} day{l.days !== 1 ? 's' : ''}</p>
                    {l.reason && <p className="text-xs text-slate-600 mt-1 italic">"{l.reason}"</p>}
                    {l.notes  && <p className="text-xs text-slate-500 mt-0.5">Note: {l.notes}</p>}
                  </div>
                  {isHR && l.status === 'pending' && (
                    <div className="flex gap-1.5 shrink-0">
                      <button onClick={() => resolveLeave.mutate({ id: l.id, status:'approved' })}
                        className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition">
                        <Check size={11} /> Approve
                      </button>
                      <button onClick={() => resolveLeave.mutate({ id: l.id, status:'rejected' })}
                        className="flex items-center gap-1 rounded-lg bg-red-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700 transition">
                        <X size={11} /> Reject
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))
          )}
        </div>
      )}

      {/* ── PAYROLL TAB ── */}
      {tab === 'payroll' && isHR && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            {/* Left: period picker */}
            <div className="flex items-center gap-3 flex-wrap">
              <label className="text-sm font-medium text-slate-700">Pay Period:</label>
              <input type="month" value={payPeriod} onChange={e => setPayPeriod(e.target.value)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40" />

              {/* Copy from previous period */}
              <button
                onClick={() => copyPayroll.mutate({ sourcePeriod: prevPeriod, targetPeriod: payPeriod })}
                disabled={copyPayroll.isPending}
                title={`Copy salary data from ${fmtPeriodLabel(prevPeriod)}`}
                className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition"
              >
                {copyPayroll.isPending
                  ? <Loader2 size={13} className="animate-spin" />
                  : <Copy size={13} />}
                Copy from {fmtPeriodLabel(prevPeriod)}
              </button>

              {copyPayroll.isSuccess && (
                <span className="text-xs text-emerald-600 font-medium">
                  {copyPayroll.data?.copied === 0
                    ? `Nothing to copy from ${fmtPeriodLabel(prevPeriod)}`
                    : `${copyPayroll.data?.copied} record(s) copied`}
                </span>
              )}
            </div>

            {/* Right: add + export */}
            <div className="flex items-center gap-2">
              <button onClick={() => setPayrollModal({ mode:'add', record: null })}
                className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 transition">
                <Plus size={13} /> Add Entry
              </button>
              {payrollRecs.length > 0 && (
                <button onClick={exportPayrollCSV}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">
                  <Download size={13} /> Export CSV
                </button>
              )}
            </div>
          </div>

          {/* Error from copy/save */}
          {copyPayroll.isError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
              {copyPayroll.error?.message ?? 'Copy failed'}
            </div>
          )}

          {/* Loading */}
          {payLoading ? (
            <div className="flex items-center justify-center gap-2 text-slate-400 text-sm py-12">
              <Loader2 size={16} className="animate-spin" /> Loading payroll…
            </div>
          ) : payrollRecs.length === 0 ? (
            <div className="text-center py-16">
              <Wallet size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500 text-sm font-medium">No payroll records for {fmtPeriodLabel(payPeriod)}</p>
              <p className="text-xs text-slate-400 mt-1 mb-4">
                Add entries manually or copy from a previous month.
              </p>
              <button onClick={() => setPayrollModal({ mode:'add', record: null })}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 transition">
                <Plus size={13} /> Add Entry
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="px-4 py-3 text-left">Staff</th>
                      <th className="px-4 py-3 text-right">Basic</th>
                      <th className="px-4 py-3 text-right">Allowances</th>
                      <th className="px-4 py-3 text-right">Gross</th>
                      <th className="px-4 py-3 text-right">Deductions</th>
                      <th className="px-4 py-3 text-right">Net Pay</th>
                      <th className="px-4 py-3 text-center w-20">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {payrollRecs.map(p => {
                      const isDeleting = deletingPayroll?.staffId === p.staffId && deletingPayroll?.period === p.payPeriod;
                      return (
                        <tr key={p.staffId} className="hover:bg-slate-50/70 transition group">
                          <td className="px-4 py-3 font-medium text-slate-900">{p.staffName}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{fmtMoney(p.basicSalary, sym)}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{fmtMoney(p.allowances, sym)}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{fmtMoney(p.grossSalary, sym)}</td>
                          <td className="px-4 py-3 text-right text-red-600">− {fmtMoney(p.deductions, sym)}</td>
                          <td className="px-4 py-3 text-right font-bold text-emerald-700">{fmtMoney(p.netSalary, sym)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition">
                              <button
                                onClick={() => setPayrollModal({ mode:'edit', record: p })}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition"
                                title="Edit">
                                <Edit2 size={13} />
                              </button>
                              <button
                                disabled={isDeleting || deletePayroll.isPending}
                                onClick={() => {
                                  if (confirm(`Remove ${p.staffName}'s payroll for ${fmtPeriodLabel(p.payPeriod)}?`)) {
                                    setDeletingPayroll({ staffId: p.staffId, period: p.payPeriod });
                                    deletePayroll.mutate({ staffId: p.staffId, period: p.payPeriod });
                                  }
                                }}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition"
                                title="Delete">
                                {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {/* Totals row */}
                    <tr className="bg-slate-50 font-semibold border-t border-slate-200">
                      <td className="px-4 py-3 text-slate-700">Total</td>
                      <td className="px-4 py-3 text-right">{fmtMoney(payrollRecs.reduce((s,r) => s+(r.basicSalary||0), 0), sym)}</td>
                      <td className="px-4 py-3 text-right">{fmtMoney(payrollRecs.reduce((s,r) => s+(r.allowances||0), 0), sym)}</td>
                      <td className="px-4 py-3 text-right">{fmtMoney(payrollRecs.reduce((s,r) => s+(r.grossSalary||0), 0), sym)}</td>
                      <td className="px-4 py-3 text-right text-red-600">− {fmtMoney(payrollRecs.reduce((s,r) => s+(r.deductions||0), 0), sym)}</td>
                      <td className="px-4 py-3 text-right text-emerald-700">{fmtMoney(payrollRecs.reduce((s,r) => s+(r.netSalary||0), 0), sym)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── DOCUMENTS TAB ── */}
      {tab === 'documents' && isHR && (
        <div className="space-y-4">
          {/* Filter by staff */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-700">Filter by staff:</label>
            <select value={docStaffFilter} onChange={e => setDocStaff(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40">
              <option value="">All staff</option>
              {teachers.map(t => (
                <option key={t._id ?? t.id} value={t._id ?? t.id}>
                  {t.name ?? `${t.firstName} ${t.lastName}`}
                </option>
              ))}
            </select>
          </div>

          {docsLoading ? (
            <div className="grid md:grid-cols-2 gap-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-white rounded-xl border border-slate-200 animate-pulse" />)}
            </div>
          ) : docs.length === 0 ? (
            <div className="text-center py-16">
              <FolderOpen size={32} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500 text-sm">No documents recorded yet.</p>
              <button onClick={() => setDocForm(true)} className="mt-3 text-violet-600 text-sm hover:underline">Add first document</button>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {docs.map((d, i) => {
                const isExpired = d.expiryDate && new Date(d.expiryDate) < new Date();
                return (
                  <motion.div key={d.id ?? d._id} initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay: i * 0.04 }}
                    className="bg-white rounded-xl border border-slate-200 p-4 group">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge cls={DOC_COLORS[d.type] ?? DOC_COLORS.other} text={DOC_TYPES[d.type] ?? d.type} />
                          {isExpired && <Badge cls="bg-red-100 text-red-600" text="Expired" />}
                        </div>
                        <p className="font-semibold text-slate-900 text-sm truncate">{d.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{d.staffName || 'Unknown staff'}</p>
                        <div className="flex gap-3 mt-2 text-xs text-slate-400">
                          {d.issuedDate && <span>Issued: {fmtDate(d.issuedDate)}</span>}
                          {d.expiryDate && <span className={isExpired ? 'text-red-500 font-medium' : ''}>Expires: {fmtDate(d.expiryDate)}</span>}
                        </div>
                        {d.notes && <p className="text-xs text-slate-500 mt-1.5 italic truncate">"{d.notes}"</p>}
                        {d.fileUrl && (
                          <a href={d.fileUrl} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-violet-600 hover:text-violet-700 hover:underline">
                            <ExternalLink size={11} /> View Document
                          </a>
                        )}
                      </div>
                      <button
                        onClick={() => { if (confirm(`Remove "${d.name}"?`)) removeDoc.mutate(d.id ?? d._id); }}
                        className="shrink-0 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition opacity-0 group-hover:opacity-100"
                        title="Remove document">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      {showLeaveForm && (
        <LeaveForm
          onClose={() => setLeaveForm(false)}
          onSubmit={form => submitLeave.mutate(form)}
        />
      )}

      {showDocForm && (
        <DocForm
          teachers={teachers}
          onClose={() => setDocForm(false)}
          onSubmit={data => createDoc.mutate(data)}
          saving={createDoc.isPending}
        />
      )}

      {payrollModal && (
        <PayrollForm
          teachers={teachers}
          defaultPeriod={payPeriod}
          record={payrollModal.record}
          sym={sym}
          onClose={() => setPayrollModal(null)}
          onSave={data => savePayroll.mutate(data)}
          saving={savePayroll.isPending}
        />
      )}
    </div>
  );
}
