import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  students as studentsApi,
  attendance as attendanceApi,
  finance as financeApi,
  behaviour as behaviourApi,
  grades as gradesApi,
} from '@/api/client.js';
import { PageSpinner }         from '@/components/ui/Spinner.jsx';
import { ErrorState }          from '@/components/ui/EmptyState.jsx';
import { studentStatusBadge, invoiceStatusBadge } from '@/components/ui/Badge.jsx';
import useAuthStore from '@/store/auth.js';

const TABS = [
  { id: 'overview',    label: '📋 Overview' },
  { id: 'attendance',  label: '✅ Attendance' },
  { id: 'finance',     label: '💰 Finance' },
  { id: 'behaviour',   label: '⚖️ Behaviour' },
  { id: 'grades',      label: '📝 Grades' },
];

export default function StudentProfile() {
  const { studentId } = useParams();
  const navigate      = useNavigate();
  const qc            = useQueryClient();
  const can           = useAuthStore((s) => s.can);
  const [activeTab, setActiveTab] = useState('overview');
  const [editing, setEditing]     = useState(false);

  // ─── Student query ─────────────────────────────────────────────────────────
  const {
    data: studentRes,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['students', studentId],
    queryFn:  () => studentsApi.get(studentId),
    enabled:  !!studentId,
  });
  const student = studentRes?.data ?? null;

  // ─── Attendance summary ───────────────────────────────────────────────────
  const { data: attData, isLoading: attLoading } = useQuery({
    queryKey: ['attendance', 'summary', studentId],
    queryFn:  () => attendanceApi.summary({ studentId }),
    enabled:  activeTab === 'attendance' && !!studentId,
  });

  // ─── Finance (invoices) ───────────────────────────────────────────────────
  const { data: invoicesData, isLoading: invoicesLoading } = useQuery({
    queryKey: ['finance', 'invoices', studentId],
    queryFn:  () => financeApi.invoices.list({ studentId }),
    enabled:  activeTab === 'finance' && !!studentId,
  });

  // ─── Behaviour incidents ──────────────────────────────────────────────────
  const { data: behaviourData, isLoading: behaviourLoading } = useQuery({
    queryKey: ['behaviour', 'incidents', studentId],
    queryFn:  () => behaviourApi.incidents.list({ studentId, limit: 20 }),
    enabled:  activeTab === 'behaviour' && !!studentId,
  });

  // ─── Grades report ────────────────────────────────────────────────────────
  const { data: gradesData, isLoading: gradesLoading } = useQuery({
    queryKey: ['grades', 'report', studentId],
    queryFn:  () => gradesApi.report({ studentId }),
    enabled:  activeTab === 'grades' && !!studentId,
  });

  // ─── Update mutation ──────────────────────────────────────────────────────
  const { mutate: updateStudent, isPending: saving } = useMutation({
    mutationFn: (data) => studentsApi.update(studentId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students', studentId] });
      qc.invalidateQueries({ queryKey: ['students', 'recent'] });
      setEditing(false);
    },
  });

  // ─── Loading / error states ───────────────────────────────────────────────
  if (isLoading) return <PageSpinner message="Loading student…" />;
  if (isError)   return (
    <div className="space-y-4">
      <Link to="/students" className="btn-ghost btn-sm">← Back to students</Link>
      <ErrorState message={error?.message ?? 'Student not found.'} onRetry={refetch} />
    </div>
  );
  if (!student) return null;

  // ─── UI ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back */}
      <Link to="/students" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-brand-600 transition">
        ← Students
      </Link>

      {/* Profile header */}
      <div className="card flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700 text-2xl font-bold uppercase select-none">
          {`${student.firstName?.charAt(0) ?? ''}${student.lastName?.charAt(0) ?? ''}`}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold text-slate-800">
              {student.firstName} {student.lastName}
            </h2>
            {studentStatusBadge(student.status)}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
            <span>🆔 {student.admissionNumber}</span>
            {student.className  && <span>📚 {student.className}</span>}
            {student.email      && <span>✉️ {student.email}</span>}
            {student.gender     && <span>{student.gender === 'M' ? '♂' : student.gender === 'F' ? '♀' : '⚥'} {student.gender === 'M' ? 'Male' : student.gender === 'F' ? 'Female' : student.gender}</span>}
            {student.dateOfBirth && <span>🎂 {new Date(student.dateOfBirth).toLocaleDateString('en-GB')}</span>}
          </div>
        </div>

        {can('students') && !editing && (
          <button onClick={() => setEditing(true)} className="btn-secondary btn-sm shrink-0">
            Edit
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-surface-border">
        <nav className="-mb-px flex gap-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition',
                activeTab === tab.id
                  ? 'border-brand-600 text-brand-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
              )}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab panels */}
      <div className="animate-fade-in">
        {activeTab === 'overview' && (
          <OverviewTab student={student} editing={editing} onSave={updateStudent} onCancel={() => setEditing(false)} saving={saving} />
        )}
        {activeTab === 'attendance' && (
          <AttendanceTab data={attData?.data} loading={attLoading} />
        )}
        {activeTab === 'finance' && (
          <FinanceTab data={invoicesData?.data} loading={invoicesLoading} />
        )}
        {activeTab === 'behaviour' && (
          <BehaviourTab data={behaviourData?.data} loading={behaviourLoading} />
        )}
        {activeTab === 'grades' && (
          <GradesTab data={gradesData?.data} loading={gradesLoading} />
        )}
      </div>
    </div>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ student, editing, onSave, onCancel, saving }) {
  const [form, setForm] = useState({ ...student });
  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  if (!editing) {
    return (
      <div className="grid gap-6 md:grid-cols-2">
        <InfoCard title="Personal Information">
          <InfoRow label="First name"    value={student.firstName} />
          <InfoRow label="Last name"     value={student.lastName} />
          <InfoRow label="Date of birth" value={student.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString('en-GB') : '—'} />
          <InfoRow label="Gender"        value={student.gender === 'M' ? 'Male' : student.gender === 'F' ? 'Female' : student.gender ?? '—'} />
          <InfoRow label="Nationality"   value={student.nationality} />
          <InfoRow label="Religion"      value={student.religion} />
        </InfoCard>

        <InfoCard title="Contact">
          <InfoRow label="Email"        value={student.email} />
          <InfoRow label="Phone"        value={student.phone} />
          <InfoRow label="Address"      value={student.address} />
        </InfoCard>

        <InfoCard title="Academic">
          <InfoRow label="Admission No."  value={student.admissionNumber} />
          <InfoRow label="Class"          value={student.className} />
          <InfoRow label="Key stage"      value={student.keyStage} />
          <InfoRow label="House"          value={student.house} />
          <InfoRow label="Enrolled"       value={student.enrollmentDate ? new Date(student.enrollmentDate).toLocaleDateString('en-GB') : '—'} />
        </InfoCard>

        <InfoCard title="Guardian">
          <InfoRow label="Name"         value={student.guardianName} />
          <InfoRow label="Relationship" value={student.guardianRelation} />
          <InfoRow label="Phone"        value={student.guardianPhone} />
          <InfoRow label="Email"        value={student.guardianEmail} />
        </InfoCard>
      </div>
    );
  }

  // Edit mode
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSave(form); }}
      className="space-y-6"
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div className="card space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">Personal Information</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">First name</label>
              <input className="form-input" value={form.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} required />
            </div>
            <div>
              <label className="form-label">Last name</label>
              <input className="form-input" value={form.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} required />
            </div>
          </div>
          <div>
            <label className="form-label">Date of birth</label>
            <input type="date" className="form-input" value={form.dateOfBirth?.slice(0,10) ?? ''} onChange={(e) => set('dateOfBirth', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Gender</label>
            <select className="form-select" value={form.gender ?? ''} onChange={(e) => set('gender', e.target.value)}>
              <option value="">—</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="form-label">Email</label>
            <input type="email" className="form-input" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Phone</label>
            <input className="form-input" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          </div>
        </div>

        <div className="card space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">Guardian</h3>
          <div>
            <label className="form-label">Guardian name</label>
            <input className="form-input" value={form.guardianName ?? ''} onChange={(e) => set('guardianName', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Relationship</label>
            <input className="form-input" value={form.guardianRelation ?? ''} onChange={(e) => set('guardianRelation', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Guardian phone</label>
            <input className="form-input" value={form.guardianPhone ?? ''} onChange={(e) => set('guardianPhone', e.target.value)} />
          </div>
          <div>
            <label className="form-label">Guardian email</label>
            <input type="email" className="form-input" value={form.guardianEmail ?? ''} onChange={(e) => set('guardianEmail', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Attendance tab ───────────────────────────────────────────────────────────

function AttendanceTab({ data, loading }) {
  if (loading) return <PageSpinner message="Loading attendance…" />;
  if (!data)   return <ErrorState message="No attendance data." />;

  const summary = Array.isArray(data) ? data[0] : data;
  const rate    = summary?.rate != null ? Math.round(summary.rate) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Attendance rate',  value: rate != null ? `${rate}%` : '—',         color: rate >= 90 ? 'text-green-600' : rate >= 75 ? 'text-amber-600' : 'text-red-600' },
          { label: 'Days present',     value: summary?.presentCount ?? '—',             color: 'text-slate-800' },
          { label: 'Days absent',      value: summary?.absentCount ?? '—',              color: 'text-slate-800' },
          { label: 'Days late',        value: summary?.lateCount ?? '—',                color: 'text-slate-800' },
        ].map((s) => (
          <div key={s.label} className="card text-center">
            <p className={clsx('text-2xl font-bold', s.color)}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-1">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Finance tab ──────────────────────────────────────────────────────────────

function FinanceTab({ data, loading }) {
  if (loading) return <PageSpinner message="Loading invoices…" />;
  const invoices = Array.isArray(data) ? data : [];
  if (!invoices.length) return <p className="text-sm text-slate-400 py-6 text-center">No invoices found.</p>;

  return (
    <div className="card !p-0 overflow-hidden">
      <table className="data-table">
        <thead>
          <tr>
            <th>Invoice No.</th>
            <th>Description</th>
            <th className="text-right">Amount</th>
            <th>Status</th>
            <th className="hidden sm:table-cell">Due</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv._id}>
              <td className="font-mono text-xs">{inv.invoiceNumber}</td>
              <td className="text-slate-600">{inv.description}</td>
              <td className="text-right font-medium">£{Number(inv.total).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
              <td>{invoiceStatusBadge(inv.status)}</td>
              <td className="hidden sm:table-cell text-slate-500 text-xs">
                {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-GB') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Behaviour tab ────────────────────────────────────────────────────────────

function BehaviourTab({ data, loading }) {
  if (loading) return <PageSpinner message="Loading behaviour…" />;
  const incidents = Array.isArray(data) ? data : [];
  if (!incidents.length) return <p className="text-sm text-slate-400 py-6 text-center">No behaviour incidents recorded.</p>;

  return (
    <div className="space-y-3">
      {incidents.map((inc) => (
        <div key={inc._id} className="card flex items-start gap-4">
          <span className={clsx('mt-0.5 shrink-0 text-xl', inc.type === 'merit' ? 'text-green-500' : 'text-red-500')}>
            {inc.type === 'merit' ? '⭐' : '⚠️'}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-700">{inc.category}</p>
              <span className={clsx('text-xs font-semibold', inc.points > 0 ? 'text-green-600' : 'text-red-600')}>
                {inc.points > 0 ? `+${inc.points}` : inc.points} pts
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">{inc.description}</p>
            <p className="text-xs text-slate-400 mt-1">
              {inc.date ? new Date(inc.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
              {inc.recordedByName ? ` · ${inc.recordedByName}` : ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Grades tab ───────────────────────────────────────────────────────────────

function GradesTab({ data, loading }) {
  if (loading) return <PageSpinner message="Loading grades…" />;
  const subjects = Array.isArray(data) ? data : [];
  if (!subjects.length) return <p className="text-sm text-slate-400 py-6 text-center">No grade data available.</p>;

  return (
    <div className="card !p-0 overflow-hidden">
      <table className="data-table">
        <thead>
          <tr>
            <th>Subject</th>
            <th className="text-right">Average %</th>
            <th className="text-right">Grade</th>
            <th className="hidden sm:table-cell text-right">Exams taken</th>
          </tr>
        </thead>
        <tbody>
          {subjects.map((row) => (
            <tr key={row.subject ?? row._id}>
              <td className="font-medium">{row.subject ?? row._id}</td>
              <td className="text-right">
                <span className={clsx('font-semibold', pctColor(row.avgPct))}>
                  {row.avgPct != null ? `${Math.round(row.avgPct)}%` : '—'}
                </span>
              </td>
              <td className="text-right font-medium text-slate-700">{row.grade ?? '—'}</td>
              <td className="hidden sm:table-cell text-right text-slate-500">{row.examCount ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function InfoCard({ title, children }) {
  return (
    <div className="card space-y-3">
      <h3 className="text-sm font-semibold text-slate-700 border-b border-surface-border pb-2">{title}</h3>
      <dl className="space-y-2">{children}</dl>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between gap-2 text-sm">
      <dt className="text-slate-400 shrink-0">{label}</dt>
      <dd className="text-slate-700 text-right truncate">{value ?? '—'}</dd>
    </div>
  );
}

function pctColor(pct) {
  if (pct == null) return 'text-slate-400';
  if (pct >= 70) return 'text-green-600';
  if (pct >= 50) return 'text-amber-600';
  return 'text-red-600';
}
