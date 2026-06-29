/* ============================================================
   StaffDetailPanel — Right-side slide-over for full staff profile
   Props:
     teacher     teacher document
     departments []
     subjects    []
     isHR        bool
     onClose     fn
     onEdit      fn — opens edit form
   ============================================================ */
import { useState } from 'react';
import { X, Edit2, UserPlus, CheckCircle2, ShieldAlert } from 'lucide-react';

const STAFF_TYPE_LABELS = {
  teacher:'Teacher', administrator:'Administrator', librarian:'Librarian',
  counselor:'Counselor', finance:'Finance', hr:'HR', it:'IT',
  security:'Security', other:'Other',
};
const STAFF_TYPE_COLORS = {
  teacher:'bg-violet-100 text-violet-700', administrator:'bg-blue-100 text-blue-700',
  librarian:'bg-emerald-100 text-emerald-700', counselor:'bg-pink-100 text-pink-700',
  finance:'bg-amber-100 text-amber-700', hr:'bg-orange-100 text-orange-700',
  it:'bg-cyan-100 text-cyan-700', security:'bg-red-100 text-red-700',
  other:'bg-slate-100 text-slate-500',
};
const LEGACY_EXTRA_ROLES_LABELS = {
  hod:'HOD', class_teacher:'Class Teacher', timetabler:'Timetabler',
  exam_officer:'Exam Officer', deputy:'Deputy Principal', principal:'Principal',
};
const STATUS_COLORS = {
  active:'bg-emerald-100 text-emerald-700', on_leave:'bg-amber-100 text-amber-700',
  inactive:'bg-slate-100 text-slate-500', terminated:'bg-red-100 text-red-600',
};

function fmtDate(iso) {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); }
  catch { return iso; }
}

function humanize(str) {
  if (!str) return null;
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function InfoRow({ label, value, mono }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-2.5 border-b border-slate-50 last:border-0">
      <span className="text-[11px] text-slate-400 w-28 shrink-0 font-medium pt-0.5">{label}</span>
      <span className={`text-sm text-slate-800 font-medium flex-1 min-w-0 ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  );
}

export default function StaffDetailPanel({ teacher: t, departments = [], subjects = [], responsibilities, isHR, users = [], onClose, onEdit, onCreateLogin }) {
  const [tab, setTab] = useState('profile');

  if (!t) return null;

  const extraRolesMap   = Array.isArray(responsibilities) && responsibilities.length > 0
    ? Object.fromEntries(responsibilities.map(r => [r.value, r.label]))
    : LEGACY_EXTRA_ROLES_LABELS;
  const dept            = departments.find(d => d.id === t.departmentId);
  const teacherSubjects = subjects.filter(s => (t.subjects ?? []).includes(s.id));
  const initials        = `${t.firstName?.[0] ?? ''}${t.lastName?.[0] ?? ''}`.toUpperCase();
  const displayName     = [t.title, t.firstName, t.lastName].filter(Boolean).join(' ');
  const hasHRData       = t.nationalId || t.nssfNo || t.shaNo || t.kraPinNo || t.nextOfKin?.name;
  // Check if this staff member already has a login account
  const hasAccount      = t.email && users.some(u => u.email?.toLowerCase() === t.email?.toLowerCase());

  const TABS = [
    { id: 'profile',    label: 'Profile'    },
    { id: 'employment', label: 'Employment' },
    ...(isHR ? [{ id: 'hr', label: 'HR Records' }] : []),
  ];

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ── */}
      <div className="px-5 pt-4 pb-0 border-b border-slate-100">
        {/* Action row */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition">
            <X size={15} />
          </button>
          {isHR && (
            <button onClick={onEdit}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition">
              <Edit2 size={12} /> Edit
            </button>
          )}
        </div>

        {/* Avatar + identity */}
        <div className="flex items-start gap-3 mb-4">
          <div className="h-12 w-12 shrink-0 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 font-bold text-lg">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-900 text-base leading-tight truncate">{displayName}</p>

            {/* Type + status chips */}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STAFF_TYPE_COLORS[t.staffType] ?? 'bg-slate-100 text-slate-500'}`}>
                {STAFF_TYPE_LABELS[t.staffType] ?? t.staffType ?? 'Staff'}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[t.status] ?? 'bg-slate-100 text-slate-500'}`}>
                {humanize(t.status) ?? 'Active'}
              </span>
              {t.staffId && (
                <span className="text-[10px] text-slate-400 font-mono">{t.staffId}</span>
              )}
            </div>

            {/* Department */}
            {dept && <p className="text-xs text-slate-500 mt-1">{dept.name}</p>}
          </div>
        </div>

        {/* Extra role badges */}
        {(t.extraRoles ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {(t.extraRoles ?? []).map(r => (
              <span key={r} className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                {extraRolesMap[r] ?? r}
              </span>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-0 -mb-px">
          {TABS.map(tb => (
            <button key={tb.id} onClick={() => setTab(tb.id)}
              className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition ${
                tab === tb.id
                  ? 'border-violet-600 text-violet-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}>
              {tb.label}
              {tb.id === 'hr' && !hasHRData && (
                <span className="ml-1 text-amber-500">●</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 overflow-y-auto px-5 py-4">

        {/* ── Profile tab ── */}
        {tab === 'profile' && (
          <div>
            <InfoRow label="Email"          value={t.email} />
            <InfoRow label="Phone"          value={t.phone} />
            <InfoRow label="Gender"         value={humanize(t.gender)} />
            <InfoRow label="Date of Birth"  value={fmtDate(t.dateOfBirth)} />
            <InfoRow label="Address"        value={t.address} />
            <InfoRow label="Qualifications" value={t.qualifications} />
            <InfoRow label="Specialization" value={t.specialization} />

            {!t.email && !t.phone && !t.address && (
              <p className="text-sm text-slate-400 text-center py-8">No personal details on record.</p>
            )}

            {/* ── Login account status ── */}
            {isHR && t.email && (
              <div className={`mt-5 rounded-xl border px-4 py-3.5 flex items-start gap-3 ${
                hasAccount
                  ? 'bg-emerald-50 border-emerald-100'
                  : 'bg-amber-50 border-amber-100'
              }`}>
                {hasAccount ? (
                  <>
                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-emerald-800">Has a login account</p>
                      <p className="text-[11px] text-emerald-700 mt-0.5">
                        Can sign in to the platform using <span className="font-mono">{t.email}</span>.
                        Manage their permissions in Settings → Roles.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <ShieldAlert size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-xs font-semibold text-amber-800">No login account</p>
                      <p className="text-[11px] text-amber-700 mt-0.5 mb-3">
                        {displayName} is in the staff directory but cannot sign in. Create an account to give them platform access.
                      </p>
                      <button
                        onClick={() => onCreateLogin?.(t)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                      >
                        <UserPlus size={12} />
                        Create Login Account
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Employment tab ── */}
        {tab === 'employment' && (
          <div>
            <InfoRow label="Staff ID"     value={t.staffId} mono />
            <InfoRow label="Staff Type"   value={STAFF_TYPE_LABELS[t.staffType] ?? t.staffType} />
            <InfoRow label="Contract"     value={humanize(t.contractType)} />
            <InfoRow label="Join Date"    value={fmtDate(t.joinDate)} />
            <InfoRow label="Status"       value={humanize(t.status)} />
            <InfoRow label="Department"   value={dept?.name} />

            {/* Extra roles */}
            {(t.extraRoles ?? []).length > 0 && (
              <div className="flex gap-3 py-2.5 border-b border-slate-50">
                <span className="text-[11px] text-slate-400 w-28 shrink-0 font-medium pt-0.5">Roles</span>
                <div className="flex flex-wrap gap-1">
                  {(t.extraRoles ?? []).map(r => (
                    <span key={r} className="rounded-md bg-violet-50 text-violet-700 px-2 py-0.5 text-[11px] font-semibold">
                      {extraRolesMap[r] ?? r}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Teaching subjects */}
            {teacherSubjects.length > 0 && (
              <div className="flex gap-3 py-2.5 border-b border-slate-50">
                <span className="text-[11px] text-slate-400 w-28 shrink-0 font-medium pt-0.5">Subjects</span>
                <div className="flex flex-wrap gap-1">
                  {teacherSubjects.map(s => (
                    <span key={s.id} className="rounded-md bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-semibold">
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Subject IDs (fallback when subjects list not loaded) */}
            {teacherSubjects.length === 0 && (t.subjects ?? []).length > 0 && (
              <InfoRow label="Subjects" value={`${t.subjects.length} assigned`} />
            )}
          </div>
        )}

        {/* ── HR Records tab ── */}
        {tab === 'hr' && isHR && (
          <div>
            <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 mb-4">
              <p className="text-xs text-amber-700 font-medium">🔒 Sensitive — visible to HR and Admin only</p>
            </div>

            <InfoRow label="National ID" value={t.nationalId} mono />
            <InfoRow label="KRA PIN"     value={t.kraPinNo}   mono />
            <InfoRow label="NSSF No."    value={t.nssfNo}     mono />
            <InfoRow label="SHA No."     value={t.shaNo}      mono />

            {t.nextOfKin?.name && (
              <div className="mt-4 rounded-xl bg-slate-50 border border-slate-100 p-4">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-3">Next of Kin</p>
                <InfoRow label="Name"         value={t.nextOfKin.name} />
                <InfoRow label="Phone"        value={t.nextOfKin.phone} />
                <InfoRow label="Relationship" value={t.nextOfKin.relationship} />
              </div>
            )}

            {!hasHRData && (
              <div className="text-center py-10">
                <p className="text-sm text-slate-400">No HR records entered yet.</p>
                {isHR && (
                  <button onClick={onEdit}
                    className="mt-3 text-xs text-violet-600 hover:underline font-medium">
                    Click Edit to add them
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
