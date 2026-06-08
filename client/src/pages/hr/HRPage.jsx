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
  Download, ExternalLink, Loader2, Copy, Search, ChevronRight,
  ShieldCheck, CreditCard, UserPlus,
} from 'lucide-react';
import { hr as hrApi, teachers as teachersApi, departments as deptsApi, subjects as subjectsApi, settings as settingsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import StaffFormModal   from './StaffFormModal.jsx';
import StaffDetailPanel from './StaffDetailPanel.jsx';

/* ── Constants ──────────────────────────────────────────── */
const HR_ROLES    = ['superadmin','admin','hr'];
const DOC_TYPES   = { contract:'Contract', appraisal:'Appraisal', certificate:'Certificate', id_copy:'ID / Document', other:'Other' };
const DOC_COLORS  = { contract:'bg-blue-100 text-blue-700', appraisal:'bg-purple-100 text-purple-700', certificate:'bg-emerald-100 text-emerald-700', id_copy:'bg-amber-100 text-amber-700', other:'bg-slate-100 text-slate-600' };
const LEAVE_TYPES = { annual:'Annual Leave', sick:'Sick Leave', emergency:'Emergency', maternity:'Maternity', paternity:'Paternity', unpaid:'Unpaid Leave' };
const LEAVE_COLORS = { annual:'bg-blue-100 text-blue-700', sick:'bg-amber-100 text-amber-700', emergency:'bg-red-100 text-red-700', maternity:'bg-pink-100 text-pink-700', paternity:'bg-purple-100 text-purple-700', unpaid:'bg-slate-100 text-slate-600' };
const STATUS_COLORS   = { pending:'bg-amber-100 text-amber-700', approved:'bg-emerald-100 text-emerald-700', rejected:'bg-red-100 text-red-600' };
const PAYROLL_STATUS  = { draft:'bg-slate-100 text-slate-600', confirmed:'bg-blue-100 text-blue-700', paid:'bg-emerald-100 text-emerald-700' };

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
    const t = teachers.find(x => (x.id ?? x._id) === id);
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
                <option key={t.id ?? t._id} value={t.id ?? t._id}>{t.name ?? `${t.firstName} ${t.lastName}`}</option>
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
    const t = teachers.find(x => (x.userId ?? x.id ?? x._id) === id);
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
                  const val = t.userId ?? t.id ?? t._id;
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

/* ── staffType → suggested system role ─────────────────── */
const STAFF_TYPE_ROLE_HINT = {
  teacher:       'teacher',
  administrator: 'admin',
  hr:            'admin',
  finance:       'teacher',
  librarian:     'teacher',
  counselor:     'teacher',
  it:            'teacher',
  security:      'teacher',
  other:         'teacher',
};

const SYSTEM_ROLES = [
  { value: 'admin',   label: 'Admin — full school management access' },
  { value: 'deputy',  label: 'Deputy — deputy principal access' },
  { value: 'teacher', label: 'Teacher — classroom and gradebook access' },
];

/* ── Create login account modal ─────────────────────────── */
function CreateLoginModal({ staff, customRoles = [], onClose, onConfirm, saving }) {
  const suggestedRole = STAFF_TYPE_ROLE_HINT[staff?.staffType] ?? 'teacher';
  const [role, setRole] = useState(suggestedRole);

  // Combine built-in roles + custom roles
  const allRoles = [
    ...SYSTEM_ROLES,
    ...customRoles.map(cr => ({ value: cr.key, label: cr.label })),
  ];

  const name  = [staff?.firstName, staff?.lastName].filter(Boolean).join(' ');
  const email = staff?.email ?? '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-violet-50 flex items-center justify-center">
              <UserPlus size={15} className="text-violet-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-sm">Create Login Account</h2>
              <p className="text-[11px] text-slate-500">for {name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={15} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Summary */}
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 space-y-1.5">
            <div className="flex gap-3 text-sm">
              <span className="text-slate-400 w-14 shrink-0 text-xs font-medium pt-0.5">Name</span>
              <span className="font-semibold text-slate-800">{name}</span>
            </div>
            <div className="flex gap-3 text-sm">
              <span className="text-slate-400 w-14 shrink-0 text-xs font-medium pt-0.5">Email</span>
              <span className="font-mono text-xs text-slate-700">{email}</span>
            </div>
          </div>

          {/* Role selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              System Role <span className="text-slate-400 font-normal">(controls what they can access)</span>
            </label>
            <select value={role} onChange={e => setRole(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 bg-white">
              {allRoles.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* What will happen */}
          <div className="rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 space-y-1.5">
            <p className="text-[11px] font-semibold text-indigo-800 mb-1">What will happen</p>
            <p className="text-[11px] text-indigo-700">
              A login account will be created for <strong>{email}</strong> with a system-generated temporary password.
            </p>
            <p className="text-[11px] text-indigo-700">
              A welcome email will be sent to {name} with their credentials and a link to sign in.
              They will be prompted to set a new password on first login.
            </p>
          </div>

          {/* Actions */}
          <div className="flex gap-2.5 pt-1">
            <button onClick={onClose}
              className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">
              Cancel
            </button>
            <button onClick={() => onConfirm({ name, email, role, staffId: staff?.staffId })}
              disabled={saving || !email}
              className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-700 py-2.5 text-sm font-semibold text-white transition disabled:opacity-50 flex items-center justify-center gap-2">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
              {saving ? 'Creating…' : 'Create & Send Email'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const [payrollModal, setPayrollModal]     = useState(null);  // null | { mode:'add'|'edit', record:null|{...} }
  const [deletingPayroll, setDeletingPayroll] = useState(null);  // null | { id }
  const [staffModal, setStaffModal]           = useState(null);  // null | { mode:'add'|'edit' }
  const [selectedStaff, setSelectedStaff]     = useState(null);  // null | teacher doc (for detail panel)
  const [staffSearch, setStaffSearch]         = useState('');
  const [createLoginStaff, setCreateLoginStaff] = useState(null); // null | teacher doc
  const [loginToast, setLoginToast]             = useState('');   // success message

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

  const { data: deptsData } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => deptsApi.list(),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    staleTime: 60_000,
  });

  const { data: subjectsListData } = useQuery({
    queryKey: ['subjects-flat'],
    queryFn:  () => subjectsApi.list({ limit: 100 }),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    enabled:  !!staffModal,
    staleTime: 120_000,
  });

  // Fetch school users so we can detect which staff members have login accounts
  const { data: usersData } = useQuery({
    queryKey: ['settings-users'],
    queryFn:  () => settingsApi.users.list(),
    select:   r => r?.data?.users ?? r?.users ?? (Array.isArray(r?.data) ? r.data : []),
    enabled:  isHR,
    staleTime: 60_000,
  });

  // Fetch custom roles so we can offer them in the Create Login modal
  const { data: customRolesData } = useQuery({
    queryKey: ['settings', 'custom-roles'],
    queryFn:  () => settingsApi.customRoles.list(),
    select:   r => r?.data ?? [],
    enabled:  isHR,
    staleTime: 60_000,
  });

  const teachers    = teachersData?.teachers ?? teachersData?.data ?? [];
  const leaves      = leaveData?.data        ?? leaveData?.requests   ?? [];
  const payrollRecs = payrollData?.data      ?? payrollData?.records  ?? [];
  const summary     = summaryData?.data      ?? summaryData           ?? {};
  const departments = deptsData   ?? [];
  const subjectsList= subjectsListData ?? [];
  const schoolUsers    = usersData ?? [];
  const customRolesList = customRolesData ?? [];

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

  const setPayrollStatus = useMutation({
    mutationFn: ({ id, status }) => hrApi.payroll.setStatus(id, status),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['hr','payroll'] });
      qc.invalidateQueries({ queryKey: ['hr','summary'] });
    },
  });

  const copyPayroll = useMutation({
    mutationFn: hrApi.payroll.copy,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['hr','payroll'] });
      qc.invalidateQueries({ queryKey: ['hr','summary'] });
    },
  });

  const createTeacher = useMutation({
    mutationFn: teachersApi.create,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['teachers'] });
      qc.invalidateQueries({ queryKey: ['hr','summary'] });
      setStaffModal(null);
    },
  });

  const updateTeacher = useMutation({
    mutationFn: ({ id, data }) => teachersApi.update(id, data),
    onSuccess:  updated => {
      qc.invalidateQueries({ queryKey: ['teachers'] });
      // Refresh the detail panel if we just edited the viewed teacher
      if (selectedStaff?.id === (updated?.id ?? updated?.data?.id)) {
        setSelectedStaff(updated?.data ?? updated);
      }
      setStaffModal(null);
    },
  });

  const inviteUser = useMutation({
    mutationFn: ({ name, email, role, staffId }) =>
      settingsApi.users.invite({ name, email, role, staffId }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['settings-users'] });
      setCreateLoginStaff(null);
      setLoginToast(`Login account created. Welcome email sent to ${vars.email}.`);
      setTimeout(() => setLoginToast(''), 6000);
    },
  });

  const docs = docsData?.data ?? docsData?.documents ?? [];

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
        <div>
          {/* Toolbar */}
          <div className="flex items-center gap-3 mb-5 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                value={staffSearch}
                onChange={e => setStaffSearch(e.target.value)}
                placeholder="Search staff by name…"
                className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40"
              />
            </div>
            {isHR && (
              <button
                onClick={() => setStaffModal({ mode: 'add' })}
                className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 transition">
                <Plus size={14} /> Add Staff
              </button>
            )}
            <span className="text-xs text-slate-400 ml-auto">
              {teachers.length} staff member{teachers.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Grid */}
          {(() => {
            const q = staffSearch.trim().toLowerCase();
            const filtered = q
              ? teachers.filter(t =>
                  `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) ||
                  (t.email ?? '').toLowerCase().includes(q) ||
                  (t.staffId ?? '').toLowerCase().includes(q)
                )
              : teachers;

            const STAFF_TYPE_COLORS = {
              teacher:'bg-violet-100 text-violet-700', administrator:'bg-blue-100 text-blue-700',
              librarian:'bg-emerald-100 text-emerald-700', counselor:'bg-pink-100 text-pink-700',
              finance:'bg-amber-100 text-amber-700', hr:'bg-orange-100 text-orange-700',
              it:'bg-cyan-100 text-cyan-700', security:'bg-red-100 text-red-700',
              other:'bg-slate-100 text-slate-500',
            };
            const STAFF_TYPE_LABELS = {
              teacher:'Teacher', administrator:'Administrator', librarian:'Librarian',
              counselor:'Counselor', finance:'Finance', hr:'HR', it:'IT',
              security:'Security', other:'Other',
            };
            const EXTRA_ROLES_LABELS = {
              hod:'HOD', class_teacher:'Class Teacher', timetabler:'Timetabler',
              exam_officer:'Exam Officer', deputy:'Deputy Principal', principal:'Principal',
            };
            const STATUS_COLORS = {
              active:'bg-emerald-100 text-emerald-700', on_leave:'bg-amber-100 text-amber-700',
              inactive:'bg-slate-100 text-slate-500', terminated:'bg-red-100 text-red-600',
            };

            if (filtered.length === 0) return (
              <div className="text-center py-16">
                <Users size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 text-sm">{q ? `No staff match "${q}"` : 'No staff records found.'}</p>
                {!q && isHR && (
                  <button onClick={() => setStaffModal({ mode:'add' })}
                    className="mt-3 text-violet-600 text-sm hover:underline">Add the first staff member</button>
                )}
              </div>
            );

            return (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filtered.map((t, i) => {
                  const dept = departments.find(d => d.id === t.departmentId);
                  const displayName = [t.title, t.firstName, t.lastName].filter(Boolean).join(' ');
                  return (
                    <motion.div
                      key={t.id ?? t._id}
                      initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} transition={{ delay: i * 0.025 }}
                      onClick={() => setSelectedStaff(t)}
                      className="bg-white rounded-xl border border-slate-200 p-4 cursor-pointer hover:border-violet-300 hover:shadow-sm transition group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 font-bold text-sm">
                          {initials(displayName)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-900 text-sm truncate">{displayName}</p>
                          <p className="text-xs text-slate-400 truncate mt-0.5">{t.specialization || t.email}</p>
                          {/* Type + status */}
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {t.staffType && (
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STAFF_TYPE_COLORS[t.staffType] ?? 'bg-slate-100 text-slate-500'}`}>
                                {STAFF_TYPE_LABELS[t.staffType] ?? t.staffType}
                              </span>
                            )}
                            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[t.status] ?? 'bg-slate-100 text-slate-500'}`}>
                              {t.status ?? 'active'}
                            </span>
                          </div>
                        </div>
                        <ChevronRight size={14} className="text-slate-300 group-hover:text-violet-400 shrink-0 mt-1 transition" />
                      </div>

                      {/* Department + extra roles */}
                      {(dept || (t.extraRoles ?? []).length > 0) && (
                        <div className="mt-2.5 pt-2.5 border-t border-slate-50 flex items-center gap-2 flex-wrap">
                          {dept && (
                            <span className="text-[10px] text-slate-500 truncate">{dept.name}</span>
                          )}
                          {(t.extraRoles ?? []).slice(0, 2).map(r => (
                            <span key={r} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                              {EXTRA_ROLES_LABELS[r] ?? r}
                            </span>
                          ))}
                          {(t.extraRoles ?? []).length > 2 && (
                            <span className="text-[10px] text-slate-400">+{(t.extraRoles ?? []).length - 2}</span>
                          )}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            );
          })()}
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
              {/* Period status summary */}
              {(() => {
                const draftCount     = payrollRecs.filter(p => (p.status ?? 'draft') === 'draft').length;
                const confirmedCount = payrollRecs.filter(p => p.status === 'confirmed').length;
                const paidCount      = payrollRecs.filter(p => p.status === 'paid').length;
                return (
                  <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-50 border-b border-slate-100 text-xs text-slate-500">
                    <span>{payrollRecs.length} record{payrollRecs.length !== 1 ? 's' : ''}</span>
                    <span className="text-slate-200">|</span>
                    {draftCount     > 0 && <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full font-medium">{draftCount} draft</span>}
                    {confirmedCount > 0 && <span className="bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">{confirmedCount} confirmed</span>}
                    {paidCount      > 0 && <span className="bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full font-medium">{paidCount} paid</span>}
                  </div>
                );
              })()}
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
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-center w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {payrollRecs.map(p => {
                      const isDeleting   = deletingPayroll?.id === p.id;
                      const isSettingStatus = setPayrollStatus.isPending && setPayrollStatus.variables?.id === p.id;
                      const status       = p.status ?? 'draft';
                      const isDraft      = status === 'draft';
                      const isConfirmed  = status === 'confirmed';
                      const isPaid       = status === 'paid';
                      const canEdit      = isDraft;    // only draft records can be edited
                      const isAdminUser  = ['superadmin','admin'].includes(user?.role);

                      return (
                        <tr key={p.id ?? p.staffId} className="hover:bg-slate-50/70 transition group">
                          <td className="px-4 py-3 font-medium text-slate-900">{p.staffName}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{fmtMoney(p.basicSalary, sym)}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{fmtMoney(p.allowances, sym)}</td>
                          <td className="px-4 py-3 text-right text-slate-600">{fmtMoney(p.grossSalary, sym)}</td>
                          <td className="px-4 py-3 text-right text-red-600">− {fmtMoney(p.deductions, sym)}</td>
                          <td className="px-4 py-3 text-right font-bold text-emerald-700">{fmtMoney(p.netSalary, sym)}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${PAYROLL_STATUS[status] ?? PAYROLL_STATUS.draft}`}>
                              {status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              {/* Edit — only on draft records */}
                              {canEdit && (
                                <button
                                  onClick={() => setPayrollModal({ mode:'edit', record: p })}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition opacity-0 group-hover:opacity-100"
                                  title="Edit">
                                  <Edit2 size={13} />
                                </button>
                              )}
                              {/* Confirm — draft → confirmed (HR) */}
                              {isDraft && (
                                <button
                                  disabled={isSettingStatus}
                                  onClick={() => setPayrollStatus.mutate({ id: p.id, status: 'confirmed' })}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition opacity-0 group-hover:opacity-100 disabled:opacity-40"
                                  title="Confirm payroll">
                                  {isSettingStatus ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                                </button>
                              )}
                              {/* Mark as Paid — confirmed → paid (admin only) */}
                              {isConfirmed && isAdminUser && (
                                <button
                                  disabled={isSettingStatus}
                                  onClick={() => setPayrollStatus.mutate({ id: p.id, status: 'paid' })}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition opacity-0 group-hover:opacity-100 disabled:opacity-40"
                                  title="Mark as paid">
                                  {isSettingStatus ? <Loader2 size={13} className="animate-spin" /> : <CreditCard size={13} />}
                                </button>
                              )}
                              {/* Delete */}
                              <button
                                disabled={isDeleting || deletePayroll.isPending}
                                onClick={() => {
                                  if (confirm(`Remove ${p.staffName}'s payroll for ${fmtPeriodLabel(p.payPeriod)}?`)) {
                                    setDeletingPayroll({ id: p.id });
                                    deletePayroll.mutate(p.id);
                                  }
                                }}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition opacity-0 group-hover:opacity-100"
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
                      <td colSpan={2} />
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

      {/* ── Add / Edit Staff modal ── */}
      {staffModal && (
        <StaffFormModal
          mode={staffModal.mode}
          teacher={staffModal.mode === 'edit' ? selectedStaff : null}
          departments={departments}
          subjects={subjectsList}
          isHR={isHR}
          onClose={() => setStaffModal(null)}
          saving={createTeacher.isPending || updateTeacher.isPending}
          onSave={data => {
            if (staffModal.mode === 'edit' && selectedStaff?.id) {
              updateTeacher.mutate({ id: selectedStaff.id, data });
            } else {
              createTeacher.mutate(data);
            }
          }}
        />
      )}

      {/* ── Staff detail slide-over ── */}
      {selectedStaff && (
        <div className="fixed inset-0 z-40 flex" onClick={e => e.target === e.currentTarget && setSelectedStaff(null)}>
          {/* Backdrop */}
          <div className="flex-1 bg-black/20" onClick={() => setSelectedStaff(null)} />
          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type:'tween', duration: 0.22 }}
            className="w-full max-w-md bg-white shadow-2xl border-l border-slate-200 overflow-hidden flex flex-col"
          >
            <StaffDetailPanel
              teacher={selectedStaff}
              departments={departments}
              subjects={subjectsList}
              isHR={isHR}
              users={schoolUsers}
              onClose={() => setSelectedStaff(null)}
              onEdit={() => setStaffModal({ mode: 'edit' })}
              onCreateLogin={t => setCreateLoginStaff(t)}
            />
          </motion.div>
        </div>
      )}

      {/* ── Create login account modal ── */}
      {createLoginStaff && (
        <CreateLoginModal
          staff={createLoginStaff}
          customRoles={customRolesList}
          saving={inviteUser.isPending}
          onClose={() => setCreateLoginStaff(null)}
          onConfirm={vars => inviteUser.mutate(vars)}
        />
      )}

      {/* ── Success toast ── */}
      {loginToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2.5 rounded-xl bg-emerald-600 text-white px-5 py-3 shadow-lg text-sm font-medium">
          <Check size={15} className="shrink-0" />
          {loginToast}
        </div>
      )}
    </div>
  );
}
