/* ============================================================
   Student Profile — Premium Enterprise Rebuild
   /platform-audit: 5 tabs, BPS stage/milestone, house assignment,
   lucide icons, no emoji, currency from session, correct API shapes
   ============================================================ */
import { useState, useMemo, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Users, CalendarCheck, Receipt, Scale, GraduationCap,
  ChevronLeft, Edit2, Save, X, Loader2, AlertTriangle,
  Star, ShieldAlert, TrendingUp, TrendingDown, Award,
  Hash, Mail, Phone, MapPin, Shield, BookOpen, Home,
  CheckCircle2, Clock, XCircle, CheckCheck, Heart, Printer,
  KeyRound, UserX, UserCheck, Copy, RefreshCcw, Camera,
} from 'lucide-react';
import {
  students  as studentsApi,
  attendance as attendanceApi,
  finance    as financeApi,
  behaviour  as behaviourApi,
  grades     as gradesApi,
  settings   as settingsApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { studentStage, studentMilestone, demeritTotal, meritTotal, STAGES, MILESTONES } from '@/pages/behaviour/bpsConstants.js';

/* ── Tab config ─────────────────────────────────────────────── */
const TABS = [
  { id: 'overview',   label: 'Overview',   Icon: User           },
  { id: 'attendance', label: 'Attendance',  Icon: CalendarCheck  },
  { id: 'finance',    label: 'Finance',     Icon: Receipt        },
  { id: 'behaviour',  label: 'Behaviour',   Icon: Scale          },
  { id: 'grades',     label: 'Grades',      Icon: GraduationCap  },
  { id: 'medical',    label: 'Medical',     Icon: Heart          },
  { id: 'portal',     label: 'Portal',      Icon: KeyRound       },
];

/* ── Gradient avatar ─────────────────────────────────────────── */
const AVATAR_GRADIENTS = [
  'from-violet-500 to-purple-600', 'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',  'from-amber-500 to-orange-500',
  'from-pink-500 to-rose-500',     'from-indigo-500 to-blue-500',
];
function avatarGradient(name = '') {
  return AVATAR_GRADIENTS[(name.charCodeAt(0) || 0) % AVATAR_GRADIENTS.length];
}

/* ── Status chip ─────────────────────────────────────────────── */
const STATUS_CHIP = {
  active:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  inactive:   'bg-slate-100 text-slate-500 border-slate-200',
  suspended:  'bg-amber-50 text-amber-700 border-amber-200',
  expelled:   'bg-red-50 text-red-700 border-red-200',
  graduated:  'bg-blue-50 text-blue-700 border-blue-200',
  transferred:'bg-purple-50 text-purple-700 border-purple-200',
};
function StatusChip({ status }) {
  const cls = STATUS_CHIP[status] ?? 'bg-slate-100 text-slate-500 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border capitalize ${cls}`}>
      {status ?? 'unknown'}
    </span>
  );
}

/* ── Invoice status chip ─────────────────────────────────────── */
const INV_CHIP = {
  paid:      'bg-emerald-50 text-emerald-700 border-emerald-200',
  unpaid:    'bg-amber-50 text-amber-700 border-amber-200',
  overdue:   'bg-red-50 text-red-700 border-red-200',
  partial:   'bg-blue-50 text-blue-700 border-blue-200',
  cancelled: 'bg-slate-100 text-slate-400 border-slate-200',
};
function InvChip({ status }) {
  const cls = INV_CHIP[status] ?? 'bg-slate-100 text-slate-500 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border capitalize ${cls}`}>
      {status}
    </span>
  );
}

/* ── Skeleton loader ─────────────────────────────────────────── */
function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-100 rounded ${className}`} />;
}

/* ══════════════════════════════════════════════════════════════ */
export default function StudentProfile() {
  const { studentId } = useParams();
  const qc            = useQueryClient();
  const can           = useAuthStore(s => s.can.bind(s));
  const currency      = useAuthStore(s => s.session?.school?.currency ?? 'KES');
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);

  /* ── Student ── */
  const { data: studentRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['students', studentId],
    queryFn:  () => studentsApi.get(studentId),
    enabled:  !!studentId,
  });
  const student = studentRes?.data ?? null;

  /* ── Cross-module queries (lazy by tab) ── */
  const { data: attData, isLoading: attLoading } = useQuery({
    queryKey: ['attendance', 'summary', studentId],
    queryFn:  () => attendanceApi.summary({ studentId }),
    enabled:  tab === 'attendance' && !!studentId,
    staleTime: 5 * 60_000,
  });

  const { data: invoicesData, isLoading: invLoading } = useQuery({
    queryKey: ['finance', 'invoices', studentId],
    queryFn:  () => financeApi.invoices.list({ studentId, limit: 100 }),
    enabled:  tab === 'finance' && !!studentId,
    staleTime: 5 * 60_000,
  });

  const { data: bpsData, isLoading: bpsLoading } = useQuery({
    queryKey: ['behaviour', 'incidents', studentId],
    queryFn:  () => behaviourApi.incidents.list({ studentId, limit: 200 }),
    enabled:  tab === 'behaviour' && !!studentId,
    staleTime: 60_000,
  });

  const { data: gradesData, isLoading: gradesLoading } = useQuery({
    queryKey: ['grades', 'report', studentId],
    queryFn:  () => gradesApi.report({ studentId }),
    enabled:  tab === 'grades' && !!studentId,
    staleTime: 5 * 60_000,
  });

  /* ── Update mutation ── */
  const { mutate: updateStudent, isPending: saving } = useMutation({
    mutationFn: data => studentsApi.update(studentId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students', studentId] });
      qc.invalidateQueries({ queryKey: ['students'] });
      setEditing(false);
    },
  });

  /* ── Photo upload ── */
  const photoInputRef = useRef(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  const resizeToDataUrl = useCallback((file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image failed to load'));
      img.onload = () => {
        const MAX_W = 300, MAX_H = 375;
        let w = img.width, h = img.height;
        if (w > MAX_W) { h = Math.round(h * MAX_W / w); w = MAX_W; }
        if (h > MAX_H) { w = Math.round(w * MAX_H / h); h = MAX_H; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }), []);

  async function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert('Image must be under 5 MB'); return; }
    setPhotoUploading(true);
    try {
      const dataUrl = await resizeToDataUrl(file);
      await studentsApi.update(studentId, { photo: dataUrl });
      qc.invalidateQueries({ queryKey: ['students', studentId] });
    } catch (err) {
      alert(err.message || 'Photo upload failed');
    } finally {
      setPhotoUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }

  async function handleRemovePhoto() {
    if (!window.confirm('Remove student photo?')) return;
    setPhotoUploading(true);
    try {
      await studentsApi.update(studentId, { photo: '' });
      qc.invalidateQueries({ queryKey: ['students', studentId] });
    } finally {
      setPhotoUploading(false);
    }
  }

  /* ── Loading ── */
  if (isLoading) return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-4xl mx-auto">
          <Skeleton className="h-4 w-24 mb-5" />
          <div className="flex items-center gap-4">
            <Skeleton className="w-14 h-14 rounded-2xl" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  /* ── Error ── */
  if (isError || !student) return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-4">
        <Link to="/students" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition">
          <ChevronLeft size={14} /> Students
        </Link>
        <div className="bg-white border border-slate-200 rounded-xl p-8 flex flex-col items-center gap-3">
          <AlertTriangle size={24} className="text-red-400" />
          <p className="text-sm text-slate-600">{error?.message ?? 'Student not found.'}</p>
          <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
        </div>
      </div>
    </div>
  );

  const grad = avatarGradient(student.firstName ?? '');
  const initials = `${student.firstName?.charAt(0) ?? ''}${student.lastName?.charAt(0) ?? ''}`.toUpperCase();

  function printProfile() {
    const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '—';
    const rows = [
      ['Admission No.',   student.admissionNumber ?? '—'],
      ['Date of Birth',   fmtDate(student.dateOfBirth)],
      ['Gender',          student.gender ?? '—'],
      ['Class',           student.className ?? '—'],
      ['House',           student.house ?? '—'],
      ['Status',          student.status ?? '—'],
      ['School Email',    student.schoolEmail ?? '—'],
      ['Personal Email',  student.email ?? '—'],
      ['Phone',           student.phone ?? '—'],
      ['Parent/Guardian', student.parentName ?? '—'],
      ['Parent Phone',    student.parentPhone ?? '—'],
      ['Address',         student.address ?? '—'],
    ].filter(([, v]) => v && v !== '—');
    const html = `<!DOCTYPE html><html><head><title>Student Profile — ${student.firstName} ${student.lastName}</title>
<style>body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:40px;color:#1e293b;max-width:600px;margin:auto}
.hdr{border-bottom:2px solid #e2e8f0;padding-bottom:20px;margin-bottom:24px;display:flex;align-items:center;gap:20px}
.avatar{width:60px;height:60px;border-radius:14px;background:linear-gradient(135deg,#8b5cf6,#6d28d9);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;font-weight:700;flex-shrink:0}
.name{font-size:22px;font-weight:700;margin:0 0 4px}.sub{font-size:12px;color:#64748b;margin:0}
.status{display:inline-block;background:#d1fae5;color:#065f46;border-radius:20px;padding:2px 10px;font-size:11px;font-weight:600;margin-left:8px}
table{width:100%;border-collapse:collapse;font-size:13px}
tr:nth-child(odd){background:#f8fafc}
td{padding:8px 12px}td:first-child{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.05em;width:38%}
td:last-child{font-weight:500}
.footer{margin-top:32px;text-align:center;font-size:11px;color:#94a3b8}
@media print{body{padding:20px}}</style></head><body>
<div class="hdr">${student.photo ? `<img src="${student.photo}" style="width:60px;height:60px;border-radius:14px;object-fit:cover;flex-shrink:0" alt="Photo" />` : `<div class="avatar">${initials}</div>`}
<div><p class="name">${student.firstName} ${student.lastName}<span class="status">${student.status ?? 'active'}</span></p>
<p class="sub">${student.className ? `${student.className} · ` : ''}${student.house ? `${student.house} · ` : ''}ID: ${student.admissionNumber ?? '—'}</p></div></div>
<table>${rows.map(([k,v])=>`<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
<div class="footer">Printed ${new Date().toLocaleString('en-GB')}</div>
</body></html>`;
    const win = window.open('', '_blank', 'width=680,height=900');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    setTimeout(() => win.print(), 400);
  }

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Profile header ─────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-5">
          <Link to="/students" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition mb-4">
            <ChevronLeft size={14} /> Students
          </Link>

          <div className="flex items-start gap-4">
            {/* Avatar / Photo */}
            <div className="relative shrink-0 group">
              {student.photo ? (
                <img
                  src={student.photo}
                  alt={`${student.firstName} ${student.lastName}`}
                  className="w-16 h-16 rounded-2xl object-cover border border-slate-200"
                />
              ) : (
                <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${grad} flex items-center justify-center text-white text-lg font-bold select-none`}>
                  {initials}
                </div>
              )}
              {/* Upload overlay — visible on hover for users with edit rights */}
              {can('students') && (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoUploading}
                  className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  title="Change photo"
                >
                  {photoUploading
                    ? <Loader2 size={16} className="text-white animate-spin" />
                    : <Camera size={16} className="text-white" />}
                </button>
              )}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoChange}
              />
            </div>

            {/* Name + meta */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-xl font-semibold text-slate-900">
                  {student.firstName} {student.lastName}
                </h1>
                <StatusChip status={student.status} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {student.admissionNumber && (
                  <span className="flex items-center gap-1"><Hash size={11} />{student.admissionNumber}</span>
                )}
                {student.className && (
                  <span className="flex items-center gap-1"><BookOpen size={11} />{student.className}</span>
                )}
                {student.house && (
                  <span className="flex items-center gap-1"><Home size={11} />{student.house}</span>
                )}
                {student.schoolEmail && (
                  <span className="flex items-center gap-1"><Mail size={11} />{student.schoolEmail}</span>
                )}
              </div>
              {/* Remove photo link — only when a photo exists */}
              {student.photo && can('students') && (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  className="mt-1 text-[11px] text-slate-400 hover:text-red-500 transition-colors"
                >
                  Remove photo
                </button>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={printProfile}
                className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 transition"
                title="Print student profile"
              >
                <Printer size={13} />
              </button>
              <Link
                to={`/growth-profile/${studentId}`}
                className="flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-800 border border-violet-200 hover:border-violet-300 bg-violet-50 hover:bg-violet-100 rounded-lg px-3 py-1.5 transition"
              >
                <TrendingUp size={13} />
                Growth Profile
              </Link>
              {can('students') && !editing && (
                <button
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 transition"
                >
                  <Edit2 size={13} /> Edit
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <nav className="flex gap-1 mt-5 -mb-px overflow-x-auto">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                  tab === id
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* ── Tab panels ─────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {tab === 'overview' && (
              <OverviewTab
                student={student}
                editing={editing}
                saving={saving}
                onSave={updateStudent}
                onCancel={() => setEditing(false)}
              />
            )}
            {tab === 'attendance' && (
              <AttendanceTab data={attData?.data} loading={attLoading} />
            )}
            {tab === 'finance' && (
              <FinanceTab data={invoicesData?.data} loading={invLoading} currency={currency} />
            )}
            {tab === 'behaviour' && (
              <BehaviourTab data={bpsData?.data} loading={bpsLoading} studentId={studentId} />
            )}
            {tab === 'grades' && (
              <GradesTab data={gradesData?.data} loading={gradesLoading} />
            )}
            {tab === 'medical' && (
              <MedicalTab student={student} saving={saving} onSave={updateStudent} canEdit={can('students')} />
            )}
            {tab === 'portal' && (
              <PortalTab student={student} canEdit={can('students')} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   OVERVIEW TAB
   ══════════════════════════════════════════════════════════════ */
function OverviewTab({ student, editing, saving, onSave, onCancel }) {
  const [form, setForm] = useState({ ...student });
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  /* Houses from school settings (for dropdown in edit mode) */
  const { data: settingsData } = useQuery({
    queryKey: ['settings', 'school'],
    queryFn:  () => settingsApi.school.get(),
    enabled:  editing,
    staleTime: 5 * 60_000,
  });
  const houses = Array.isArray(settingsData?.data?.houses) ? settingsData.data.houses : [];

  /* ── View mode ── */
  if (!editing) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard title="Personal Information" icon={<User size={14} />}>
          <InfoRow label="First name"    value={student.firstName} />
          <InfoRow label="Last name"     value={student.lastName} />
          <InfoRow label="Date of birth" value={student.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : null} />
          <InfoRow label="Gender"        value={student.gender === 'M' ? 'Male' : student.gender === 'F' ? 'Female' : student.gender} />
          <InfoRow label="Nationality"   value={student.nationality} />
          <InfoRow label="Religion"      value={student.religion} />
        </InfoCard>

        <InfoCard title="Contact" icon={<Phone size={14} />}>
          <InfoRow label="School email" value={student.schoolEmail} />
          <InfoRow label="Personal email" value={student.email} />
          <InfoRow label="Phone"         value={student.phone} />
          <InfoRow label="Address"       value={student.address} />
        </InfoCard>

        <InfoCard title="Academic" icon={<BookOpen size={14} />}>
          <InfoRow label="Admission No." value={student.admissionNumber} />
          <InfoRow label="Class"         value={student.className} />
          <InfoRow label="House"         value={student.house} />
          <InfoRow label="Status"        value={student.status} />
          <InfoRow label="Enrolled"      value={student.enrollmentDate ? new Date(student.enrollmentDate).toLocaleDateString('en-GB') : null} />
        </InfoCard>

        <InfoCard title="Guardian" icon={<Shield size={14} />}>
          <InfoRow label="Name"         value={student.guardianName} />
          <InfoRow label="Relationship" value={student.guardianRelation} />
          <InfoRow label="Phone"        value={student.guardianPhone} />
          <InfoRow label="Email"        value={student.guardianEmail} />
        </InfoCard>
      </div>
    );
  }

  /* ── Edit mode ── */
  return (
    <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {/* Personal */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Personal</h3>
          <div className="grid grid-cols-2 gap-3">
            <FField label="First name">
              <input className={iCls()} value={form.firstName ?? ''} onChange={e => set('firstName', e.target.value)} required />
            </FField>
            <FField label="Last name">
              <input className={iCls()} value={form.lastName ?? ''} onChange={e => set('lastName', e.target.value)} required />
            </FField>
          </div>
          <FField label="Date of birth">
            <input type="date" className={iCls()} value={form.dateOfBirth?.slice(0,10) ?? ''} onChange={e => set('dateOfBirth', e.target.value)} />
          </FField>
          <FField label="Gender">
            <select className={iCls()} value={form.gender ?? ''} onChange={e => set('gender', e.target.value)}>
              <option value="">—</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="Other">Other</option>
            </select>
          </FField>
          <FField label="Nationality">
            <input className={iCls()} value={form.nationality ?? ''} onChange={e => set('nationality', e.target.value)} />
          </FField>
          <FField label="Religion">
            <input className={iCls()} value={form.religion ?? ''} onChange={e => set('religion', e.target.value)} />
          </FField>
        </div>

        {/* Contact */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Contact</h3>
          <FField label="School email" hint="School-issued email — used for student portal login">
            <input type="email" className={iCls()} value={form.schoolEmail ?? ''} onChange={e => set('schoolEmail', e.target.value)} placeholder="firstname.lastname@school.ac.ke" />
          </FField>
          <FField label="Personal email">
            <input type="email" className={iCls()} value={form.email ?? ''} onChange={e => set('email', e.target.value)} />
          </FField>
          <FField label="Phone">
            <input className={iCls()} value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} />
          </FField>
          <FField label="Address">
            <textarea rows={3} className={`${iCls()} resize-none`} value={form.address ?? ''} onChange={e => set('address', e.target.value)} />
          </FField>
        </div>

        {/* Academic */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Academic</h3>
          <FField label="Admission No.">
            <input className={iCls()} value={form.admissionNumber ?? ''} onChange={e => set('admissionNumber', e.target.value)} />
          </FField>
          <FField label="House">
            {houses.length > 0 ? (
              <select className={iCls()} value={form.house ?? ''} onChange={e => set('house', e.target.value)}>
                <option value="">No house assigned</option>
                {houses.map(h => (
                  <option key={h.id ?? h.name} value={h.id ?? h.name}>
                    {h.name}
                  </option>
                ))}
              </select>
            ) : (
              <input className={iCls()} value={form.house ?? ''} onChange={e => set('house', e.target.value)} placeholder="House name" />
            )}
          </FField>
          <FField label="Status">
            <select className={iCls()} value={form.status ?? 'active'} onChange={e => set('status', e.target.value)}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
              <option value="graduated">Graduated</option>
              <option value="transferred">Transferred</option>
              <option value="expelled">Expelled</option>
            </select>
          </FField>
          <FField label="Enrollment date">
            <input type="date" className={iCls()} value={form.enrollmentDate?.slice(0,10) ?? ''} onChange={e => set('enrollmentDate', e.target.value)} />
          </FField>
        </div>

        {/* Guardian */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Guardian</h3>
          <FField label="Guardian name">
            <input className={iCls()} value={form.guardianName ?? ''} onChange={e => set('guardianName', e.target.value)} />
          </FField>
          <FField label="Relationship">
            <input className={iCls()} value={form.guardianRelation ?? ''} onChange={e => set('guardianRelation', e.target.value)} />
          </FField>
          <FField label="Guardian phone">
            <input className={iCls()} value={form.guardianPhone ?? ''} onChange={e => set('guardianPhone', e.target.value)} />
          </FField>
          <FField label="Guardian email">
            <input type="email" className={iCls()} value={form.guardianEmail ?? ''} onChange={e => set('guardianEmail', e.target.value)} />
          </FField>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 px-4 py-2 rounded-lg transition"
        >
          <X size={13} /> Cancel
        </button>
      </div>
    </form>
  );
}

/* ══════════════════════════════════════════════════════════════
   ATTENDANCE TAB
   ══════════════════════════════════════════════════════════════ */
function AttendanceTab({ data, loading }) {
  if (loading) return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
    </div>
  );

  const summary = Array.isArray(data) ? data[0] : data;
  if (!summary) return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
      <CalendarCheck size={24} className="mx-auto text-slate-300 mb-2" />
      <p className="text-sm text-slate-500">No attendance data recorded yet.</p>
    </div>
  );

  const rate = summary?.rate != null ? Math.round(summary.rate) : null;
  const rateColor = rate == null ? 'text-slate-400' : rate >= 90 ? 'text-emerald-600' : rate >= 75 ? 'text-amber-600' : 'text-red-600';

  const stats = [
    { label: 'Attendance rate',   value: rate != null ? `${rate}%` : '—', color: rateColor, Icon: CheckCheck },
    { label: 'Days present',      value: summary?.presentCount ?? '—',    color: 'text-emerald-600', Icon: CheckCircle2 },
    { label: 'Days absent',       value: summary?.absentCount ?? '—',     color: 'text-red-500',    Icon: XCircle },
    { label: 'Days late',         value: summary?.lateCount ?? '—',       color: 'text-amber-600',  Icon: Clock },
  ];

  return (
    <div className="space-y-4">
      {/* Rate ring card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium text-slate-700">Attendance rate</h3>
          <span className={`text-2xl font-bold ${rateColor}`}>{rate != null ? `${rate}%` : '—'}</span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all ${rate >= 90 ? 'bg-emerald-500' : rate >= 75 ? 'bg-amber-400' : 'bg-red-400'}`}
            style={{ width: `${Math.min(rate ?? 0, 100)}%` }}
          />
        </div>
        {rate != null && rate < 90 && (
          <p className="text-xs text-slate-400 mt-2">
            {rate < 75 ? 'Below acceptable threshold — pastoral review recommended.' : 'Below 90% target.'}
          </p>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map(({ label, value, color, Icon }) => (
          <div key={label} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <Icon size={14} className={color} />
            </div>
            <p className={`text-xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   FINANCE TAB
   ══════════════════════════════════════════════════════════════ */
function FinanceTab({ data, loading, currency }) {
  if (loading) return <Skeleton className="h-48 rounded-xl" />;
  const invoices = Array.isArray(data) ? data : [];

  const fmt = (n) => {
    const num = Number(n ?? 0);
    return `${currency} ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (!invoices.length) return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
      <Receipt size={24} className="mx-auto text-slate-300 mb-2" />
      <p className="text-sm text-slate-500">No invoices found for this student.</p>
    </div>
  );

  const outstanding = invoices
    .filter(i => ['unpaid', 'overdue', 'partial'].includes(i.status))
    .reduce((s, i) => s + Number(i.balance ?? i.total ?? 0), 0);
  const totalBilled  = invoices.reduce((s, i) => s + Number(i.total ?? 0), 0);
  const totalPaid    = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + Number(i.total ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Total billed',    value: fmt(totalBilled),  color: 'text-slate-800' },
          { label: 'Total paid',      value: fmt(totalPaid),    color: 'text-emerald-600' },
          { label: 'Outstanding',     value: fmt(outstanding),  color: outstanding > 0 ? 'text-red-600' : 'text-slate-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className={`text-base font-bold ${color}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Invoice No.</th>
              <th className="text-left text-xs font-medium text-slate-500 px-4 py-3 hidden sm:table-cell">Description</th>
              <th className="text-right text-xs font-medium text-slate-500 px-4 py-3">Amount</th>
              <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Status</th>
              <th className="text-left text-xs font-medium text-slate-500 px-4 py-3 hidden md:table-cell">Due</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map(inv => (
              <tr key={inv._id ?? inv.id} className="hover:bg-slate-50 transition">
                <td className="px-4 py-3 font-mono text-xs text-slate-600">{inv.invoiceNumber ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500 text-xs hidden sm:table-cell truncate max-w-[160px]">{inv.description ?? '—'}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">{fmt(inv.total)}</td>
                <td className="px-4 py-3"><InvChip status={inv.status} /></td>
                <td className="px-4 py-3 text-xs text-slate-400 hidden md:table-cell">
                  {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString('en-GB') : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   BEHAVIOUR TAB — BPS stage + milestones + incident log
   ══════════════════════════════════════════════════════════════ */
const STAGE_COLORS = {
  'Stage 1 — Monitor':          { bg: 'bg-amber-50',  border: 'border-amber-200',  text: 'text-amber-700',  icon: 'text-amber-500'  },
  'Stage 2 — Caution':          { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: 'text-orange-500' },
  'Stage 3 — Intervention':     { bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    icon: 'text-red-500'    },
  'Stage 4 — Formal Support':   { bg: 'bg-red-100',   border: 'border-red-300',    text: 'text-red-800',    icon: 'text-red-600'    },
  'Stage 5 — Senior Review':    { bg: 'bg-red-200',   border: 'border-red-400',    text: 'text-red-900',    icon: 'text-red-700'    },
};
const MILESTONE_COLORS = {
  'Bronze Award':        'text-amber-600',
  'Silver Award':        'text-slate-500',
  'Gold Award':          'text-yellow-500',
  "Principal's Award":   'text-violet-600',
  'Platinum Award':      'text-cyan-600',
};

function BehaviourTab({ data, loading, studentId }) {
  if (loading) return <Skeleton className="h-64 rounded-xl" />;
  const logs = Array.isArray(data) ? data : [];

  const stage     = studentStage(logs, studentId);
  const milestone = studentMilestone(logs, studentId);
  const demerits  = demeritTotal(logs, studentId);
  const merits    = meritTotal(logs, studentId);

  // Next stage threshold
  const currentStageIdx = stage ? STAGES.findIndex(s => s.stage === stage.stage) : -1;
  const nextStage       = STAGES[currentStageIdx + 1] ?? null;

  // Next milestone threshold
  const currentMilestoneIdx = milestone ? MILESTONES.findIndex(m => m.name === milestone.name) : -1;
  const nextMilestone       = MILESTONES[currentMilestoneIdx + 1] ?? null;

  const stageStyle = stage ? (STAGE_COLORS[stage.stage] ?? { bg:'bg-slate-50', border:'border-slate-200', text:'text-slate-700', icon:'text-slate-400' }) : null;

  return (
    <div className="space-y-4">
      {/* BPS summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Demerit / Stage card */}
        <div className={`rounded-xl border p-4 ${stage ? `${stageStyle.bg} ${stageStyle.border}` : 'bg-white border-slate-200'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShieldAlert size={15} className={stage ? stageStyle.icon : 'text-slate-300'} />
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Demerit Stage</span>
            </div>
            <span className={`text-sm font-bold ${stage ? stageStyle.text : 'text-slate-400'}`}>
              {demerits} pts
            </span>
          </div>

          {stage ? (
            <>
              <p className={`font-semibold text-sm ${stageStyle.text}`}>{stage.stage}</p>
              <p className="text-xs text-slate-500 mt-0.5">{stage.action}</p>
              {nextStage && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Progress to {nextStage.stage.split('—')[0].trim()}</span>
                    <span>{demerits}/{nextStage.pts}</span>
                  </div>
                  <div className="h-1.5 bg-slate-200/60 rounded-full overflow-hidden">
                    <div
                      className="h-1.5 bg-red-400 rounded-full"
                      style={{ width: `${Math.min((demerits / nextStage.pts) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="font-semibold text-sm text-emerald-600">No active stage</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {STAGES[0].pts - demerits > 0
                  ? `${STAGES[0].pts - demerits} demerit pts before Stage 1`
                  : 'Clean record (90-day window)'}
              </p>
            </>
          )}
        </div>

        {/* Merit / Milestone card */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Star size={15} className={milestone ? 'text-amber-500' : 'text-slate-300'} />
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Merit Milestone</span>
            </div>
            <span className="text-sm font-bold text-emerald-600">{merits} pts</span>
          </div>

          {milestone ? (
            <>
              <p className={`font-semibold text-sm ${MILESTONE_COLORS[milestone.name] ?? 'text-slate-700'}`}>
                {milestone.name}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">{milestone.pts} pts achieved</p>
              {nextMilestone && (
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-slate-400 mb-1">
                    <span>Progress to {nextMilestone.name}</span>
                    <span>{merits}/{nextMilestone.pts}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-1.5 bg-amber-400 rounded-full"
                      style={{ width: `${Math.min((merits / nextMilestone.pts) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <p className="font-semibold text-sm text-slate-500">No milestone yet</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {MILESTONES[0].pts - merits > 0
                  ? `${MILESTONES[0].pts - merits} merit pts to Bronze Award`
                  : 'Accumulate merit points'}
              </p>
              {merits > 0 && (
                <div className="mt-3">
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-1.5 bg-amber-300 rounded-full"
                      style={{ width: `${Math.min((merits / MILESTONES[0].pts) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Incident log */}
      {logs.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <Scale size={24} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-500">No behaviour records found.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-700">Incident log</h3>
            <span className="text-xs text-slate-400">{logs.length} record{logs.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-[480px] overflow-y-auto">
            {logs.map(inc => {
              const isMerit = inc.type === 'merit';
              const pts     = inc.points ?? 0;
              return (
                <div key={inc._id ?? inc.id} className="flex items-start gap-3 px-4 py-3 hover:bg-slate-50 transition">
                  <div className={`mt-0.5 shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${isMerit ? 'bg-emerald-50' : 'bg-red-50'}`}>
                    {isMerit
                      ? <TrendingUp size={12} className="text-emerald-600" />
                      : <TrendingDown size={12} className="text-red-500" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-slate-700 truncate">
                        {inc.category ?? inc.description ?? 'Behaviour incident'}
                      </p>
                      <span className={`text-xs font-bold shrink-0 ${isMerit ? 'text-emerald-600' : 'text-red-500'}`}>
                        {pts > 0 ? `+${pts}` : pts} pts
                      </span>
                    </div>
                    {inc.description && inc.category && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{inc.description}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-1">
                      {inc.date ? new Date(inc.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                      {inc.recordedByName ? ` · ${inc.recordedByName}` : ''}
                      {inc.status === 'overturned' ? ' · Overturned' : ''}
                      {inc.status === 'appealing' ? ' · Under appeal' : ''}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   GRADES TAB
   ══════════════════════════════════════════════════════════════ */
function GradesTab({ data, loading }) {
  if (loading) return <Skeleton className="h-48 rounded-xl" />;
  const subjects = Array.isArray(data) ? data : [];

  if (!subjects.length) return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
      <GraduationCap size={24} className="mx-auto text-slate-300 mb-2" />
      <p className="text-sm text-slate-500">No grade data available yet.</p>
    </div>
  );

  const avg = subjects.length
    ? Math.round(subjects.reduce((s, r) => s + (r.avgPct ?? 0), 0) / subjects.length)
    : null;

  return (
    <div className="space-y-4">
      {/* Overall average */}
      {avg != null && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
          <div className={`text-3xl font-bold ${pctColor(avg)}`}>{avg}%</div>
          <div>
            <p className="text-sm font-medium text-slate-700">Overall average</p>
            <p className="text-xs text-slate-400">{subjects.length} subject{subjects.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex-1 ml-4">
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-2 rounded-full ${avg >= 70 ? 'bg-emerald-500' : avg >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                style={{ width: `${avg}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Subject table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/50">
              <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Subject</th>
              <th className="text-right text-xs font-medium text-slate-500 px-4 py-3">Average %</th>
              <th className="text-right text-xs font-medium text-slate-500 px-4 py-3">Grade</th>
              <th className="text-right text-xs font-medium text-slate-500 px-4 py-3 hidden sm:table-cell">Exams</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {subjects.map(row => (
              <tr key={row.subject ?? row._id} className="hover:bg-slate-50 transition">
                <td className="px-4 py-3 font-medium text-slate-800">{row.subject ?? row._id}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-semibold ${pctColor(row.avgPct)}`}>
                    {row.avgPct != null ? `${Math.round(row.avgPct)}%` : '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-700">{row.grade ?? '—'}</td>
                <td className="px-4 py-3 text-right text-slate-400 text-xs hidden sm:table-cell">{row.examCount ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MEDICAL TAB
   ══════════════════════════════════════════════════════════════ */
const BLOOD_GROUPS = ['A+','A-','B+','B-','O+','O-','AB+','AB-','Unknown'];

function MedicalTab({ student, saving, onSave, canEdit }) {
  const [editing, setEditing] = useState(false);
  const med = student.medical ?? {};
  const [form, setForm] = useState({
    bloodGroup:        med.bloodGroup        ?? '',
    allergies:         med.allergies         ?? '',
    conditions:        med.conditions        ?? '',
    emergencyName:     med.emergencyName     ?? '',
    emergencyPhone:    med.emergencyPhone    ?? '',
    emergencyRelation: med.emergencyRelation ?? '',
    doctorName:        med.doctorName        ?? '',
    doctorPhone:       med.doctorPhone       ?? '',
    vaccinations:      med.vaccinations      ?? '',
  });
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  if (!editing) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <InfoCard title="Medical Information" icon={<Heart size={14} />}>
            <InfoRow label="Blood group"   value={med.bloodGroup} />
            <InfoRow label="Allergies"     value={med.allergies} />
            <InfoRow label="Conditions"    value={med.conditions} />
            <InfoRow label="Vaccinations"  value={med.vaccinations} />
          </InfoCard>
          <div className="space-y-4">
            <InfoCard title="Emergency Contact" icon={<Phone size={14} />}>
              <InfoRow label="Name"         value={med.emergencyName} />
              <InfoRow label="Relationship" value={med.emergencyRelation} />
              <InfoRow label="Phone"        value={med.emergencyPhone} />
            </InfoCard>
            <InfoCard title="Doctor" icon={<User size={14} />}>
              <InfoRow label="Doctor name"  value={med.doctorName} />
              <InfoRow label="Doctor phone" value={med.doctorPhone} />
            </InfoCard>
          </div>
        </div>
        {canEdit && (
          <div className="flex justify-end">
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 transition"
            >
              <Edit2 size={13} /> Edit medical info
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        onSave({ medical: form }, { onSuccess: () => setEditing(false) });
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 md:grid-cols-2">
        {/* Medical info */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Medical Information</h3>
          <FField label="Blood group">
            <select className={iCls()} value={form.bloodGroup} onChange={e => set('bloodGroup', e.target.value)}>
              <option value="">— Select —</option>
              {BLOOD_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </FField>
          <FField label="Allergies">
            <textarea
              rows={3}
              className={`${iCls()} resize-none`}
              placeholder="e.g. Penicillin, peanuts, latex…"
              value={form.allergies}
              onChange={e => set('allergies', e.target.value)}
            />
          </FField>
          <FField label="Chronic conditions">
            <textarea
              rows={3}
              className={`${iCls()} resize-none`}
              placeholder="e.g. Asthma, diabetes, epilepsy…"
              value={form.conditions}
              onChange={e => set('conditions', e.target.value)}
            />
          </FField>
          <FField label="Vaccination notes">
            <textarea
              rows={2}
              className={`${iCls()} resize-none`}
              placeholder="e.g. BCG, MMR, Hepatitis B…"
              value={form.vaccinations}
              onChange={e => set('vaccinations', e.target.value)}
            />
          </FField>
        </div>

        {/* Emergency + Doctor */}
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Emergency Contact</h3>
            <FField label="Full name">
              <input className={iCls()} value={form.emergencyName} onChange={e => set('emergencyName', e.target.value)} placeholder="Contact name" />
            </FField>
            <FField label="Relationship">
              <input className={iCls()} value={form.emergencyRelation} onChange={e => set('emergencyRelation', e.target.value)} placeholder="e.g. Parent, sibling, uncle" />
            </FField>
            <FField label="Phone number">
              <input className={iCls()} value={form.emergencyPhone} onChange={e => set('emergencyPhone', e.target.value)} placeholder="+254 7xx xxx xxx" />
            </FField>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Doctor / Clinic</h3>
            <FField label="Doctor name">
              <input className={iCls()} value={form.doctorName} onChange={e => set('doctorName', e.target.value)} placeholder="Dr. …" />
            </FField>
            <FField label="Doctor / clinic phone">
              <input className={iCls()} value={form.doctorPhone} onChange={e => set('doctorPhone', e.target.value)} placeholder="+254 7xx xxx xxx" />
            </FField>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save medical info'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={saving}
          className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-800 border border-slate-200 hover:border-slate-300 px-4 py-2 rounded-lg transition"
        >
          <X size={13} /> Cancel
        </button>
      </div>
    </form>
  );
}

/* ── Shared helpers ──────────────────────────────────────────── */
function InfoCard({ title, icon, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
        <span className="text-slate-400">{icon}</span>
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</h3>
      </div>
      <dl className="space-y-2">{children}</dl>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-slate-400 shrink-0">{label}</dt>
      <dd className="text-slate-700 text-right truncate">{value ?? <span className="text-slate-300">—</span>}</dd>
    </div>
  );
}

function FField({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      {children}
      {hint && <p className="text-[10px] text-slate-400">{hint}</p>}
    </div>
  );
}

function iCls() {
  return 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 placeholder-slate-400 transition';
}

function pctColor(pct) {
  if (pct == null) return 'text-slate-400';
  if (pct >= 70)   return 'text-emerald-600';
  if (pct >= 50)   return 'text-amber-600';
  return 'text-red-500';
}

/* ══════════════════════════════════════════════════════════════
   PORTAL TAB — Create / manage student & parent portal accounts
   ══════════════════════════════════════════════════════════════ */
function PortalTab({ student, canEdit }) {
  const role  = useAuthStore(s => s.session?.user?.role);

  const [studentAccResult, setStudentAccResult] = useState(null);
  const [parentAccResult,  setParentAccResult]  = useState(null);
  const [deactivating,     setDeactivating]     = useState(false);
  const [working,          setWorking]          = useState('');
  const [error,            setError]            = useState('');

  const isAdmin = ['superadmin','admin','principal','deputy_principal'].includes(role);

  async function _call(method, path, setResult) {
    setWorking(path); setError('');
    try {
      const res  = await fetch(`/api/students/${student.id}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Request failed');
      setResult(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking('');
    }
  }

  async function handleDeactivateStudent() {
    setDeactivating(true); setError('');
    try {
      const sid = student.id || student._id;
      const res  = await fetch(`/api/students/${sid}/deactivate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason: 'withdrawn', notes: '' }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Failed');
      window.location.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeactivating(false);
    }
  }

  const isWithdrawn = student.status === 'withdrawn' || student.status === 'graduated';

  return (
    <div className="space-y-5 max-w-2xl">
      {/* ── Student portal account ──────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4 pb-3 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
            <User size={14} className="text-indigo-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Student Portal Account</h3>
            <p className="text-[11px] text-slate-400">Login: admission number · Student tier required</p>
          </div>
          <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${student.hasPortalAccount ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {student.hasPortalAccount ? 'Active' : 'Not created'}
          </span>
        </div>

        {studentAccResult && (
          <div className="mb-4 p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl">
            <p className="text-xs font-semibold text-emerald-800 mb-2">Account {studentAccResult.action} — share these credentials with the student:</p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-white rounded-lg px-3 py-2">
                <p className="text-[10px] text-slate-400 mb-0.5">Admission number (username)</p>
                <p className="font-mono font-semibold text-slate-800">{studentAccResult.username}</p>
              </div>
              <div className="bg-white rounded-lg px-3 py-2">
                <p className="text-[10px] text-slate-400 mb-0.5">Temporary password</p>
                <p className="font-mono font-semibold text-slate-800">{studentAccResult.tempPassword}</p>
              </div>
            </div>
            <p className="text-[10px] text-amber-700 mt-2">Student must change this password on first login.</p>
          </div>
        )}

        {isAdmin && !isWithdrawn && (
          <button
            onClick={() => _call('POST', '/portal-account', setStudentAccResult)}
            disabled={!!working}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {working === '/portal-account' ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
            {student.hasPortalAccount ? 'Reset Student Password' : 'Create Student Account'}
          </button>
        )}
        {isWithdrawn && (
          <p className="text-xs text-slate-400">Cannot create account for a withdrawn or graduated student.</p>
        )}
      </div>

      {/* ── Parent portal account ────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4 pb-3 border-b border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
            <Users size={14} className="text-violet-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Parent Portal Account</h3>
            <p className="text-[11px] text-slate-400">
              {student.parentEmail ? `Login: ${student.parentEmail}` : 'No parent email on record — add it in Overview first'}
              {' · Family tier required'}
            </p>
          </div>
          <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${student.hasParentAccount ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {student.hasParentAccount ? 'Active' : 'Not created'}
          </span>
        </div>

        {parentAccResult && (
          <div className="mb-4 p-3.5 bg-violet-50 border border-violet-200 rounded-xl">
            <p className="text-xs font-semibold text-violet-800 mb-1">
              Account {parentAccResult.action} — credentials sent to <span className="font-mono">{parentAccResult.email}</span>
            </p>
            <p className="text-[10px] text-slate-500">Parent will receive a welcome email with their login details.</p>
          </div>
        )}

        {isAdmin && student.parentEmail && !isWithdrawn && (
          <button
            onClick={() => _call('POST', '/parent-account', setParentAccResult)}
            disabled={!!working}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-lg hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            {working === '/parent-account' ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
            {student.hasParentAccount ? 'Resend Parent Credentials' : 'Create Parent Account'}
          </button>
        )}
      </div>

      {/* ── Deactivate student ───────────────────────────── */}
      {isAdmin && !isWithdrawn && (
        <div className="bg-white border border-red-100 rounded-xl p-5">
          <div className="flex items-center gap-3 mb-3 pb-3 border-b border-red-50">
            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
              <UserX size={14} className="text-red-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Deactivate Student</h3>
              <p className="text-[11px] text-slate-400">Mark as withdrawn. Records are preserved. Excluded from next billing snapshot.</p>
            </div>
          </div>
          {error && <p className="text-xs text-red-600 mb-3">{error}</p>}
          <button
            onClick={handleDeactivateStudent}
            disabled={deactivating}
            className="flex items-center gap-2 px-4 py-2.5 border border-red-200 text-red-600 text-sm font-semibold rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
          >
            {deactivating ? <Loader2 size={13} className="animate-spin" /> : <UserX size={13} />}
            Deactivate Student
          </button>
        </div>
      )}

      {isWithdrawn && isAdmin && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
              <UserCheck size={14} className="text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-slate-800">Student is {student.status}</h3>
              <p className="text-[11px] text-slate-400">Reactivate to restore portal access and re-include in billing.</p>
            </div>
            <button
              onClick={async () => {
                setError('');
                try {
                  const sid = student.id || student._id;
                  const res  = await fetch(`/api/students/${sid}/reactivate`, { method: 'PATCH', credentials: 'include' });
                  const json = await res.json();
                  if (!json.success) { setError(json.error?.message || 'Failed to reactivate'); return; }
                  window.location.reload();
                } catch (err) {
                  setError(err.message || 'Failed to reactivate');
                }
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 transition-colors"
            >
              <UserCheck size={13} /> Reactivate
            </button>
          </div>
        </div>
      )}

      {error && !deactivating && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2.5">
          <AlertTriangle size={14} /> {error}
        </div>
      )}
    </div>
  );
}
