/* ============================================================
   Admissions — shared constants and pure helpers
   ============================================================ */

/* ── Stage config ─────────────────────────────────────────── */
export const PIPELINE = [
  { id: 'enquiry',     label: 'Enquiry',     color: 'bg-violet-500', light: 'bg-violet-50 text-violet-700 ring-violet-200',   dot: 'bg-violet-400' },
  { id: 'application', label: 'Applied',     color: 'bg-blue-500',   light: 'bg-blue-50 text-blue-700 ring-blue-200',         dot: 'bg-blue-400'   },
  { id: 'assessment',  label: 'Assessment',  color: 'bg-amber-500',  light: 'bg-amber-50 text-amber-700 ring-amber-200',      dot: 'bg-amber-400'  },
  { id: 'interview',   label: 'Interview',   color: 'bg-orange-500', light: 'bg-orange-50 text-orange-700 ring-orange-200',   dot: 'bg-orange-400' },
  { id: 'offer',       label: 'Offer',       color: 'bg-cyan-500',   light: 'bg-cyan-50 text-cyan-700 ring-cyan-200',         dot: 'bg-cyan-400'   },
  { id: 'acceptance',  label: 'Acceptance',  color: 'bg-teal-500',   light: 'bg-teal-50 text-teal-700 ring-teal-200',         dot: 'bg-teal-400'   },
  { id: 'enrolled',    label: 'Enrolled',    color: 'bg-emerald-500',light: 'bg-emerald-50 text-emerald-700 ring-emerald-200',dot: 'bg-emerald-400'},
];

export const TERMINAL = [
  { id: 'withdrawn', label: 'Withdrawn', light: 'bg-slate-100 text-slate-500 ring-slate-200', dot: 'bg-slate-400' },
  { id: 'rejected',  label: 'Rejected',  light: 'bg-red-50 text-red-600 ring-red-200',         dot: 'bg-red-400'   },
];

export const ALL_STAGES = [...PIPELINE, ...TERMINAL];

export const PRIORITY_CONFIG = {
  high:   { label: 'High',   cls: 'bg-red-50 text-red-600 ring-1 ring-red-200' },
  normal: { label: 'Normal', cls: 'bg-slate-100 text-slate-500'                },
  low:    { label: 'Low',    cls: 'bg-slate-50 text-slate-400'                 },
};

export const EMPTY_FORM = {
  firstName: '', lastName: '', middleName: '', dateOfBirth: '',
  gender: '',
  applyingForClass: '', applyingForClassName: '',
  applyingForStream: '', applyingForStreamName: '',
  applyingForYear: '',
  parentName: '', parentEmail: '', parentPhone: '',
  priority: 'normal', notes: '', stage: 'enquiry',
};

/** Display label for an applicant's class — prefers the denormalized name
 *  (set when picked from the real Classes list), falls back to the raw
 *  applyingForClass value for records saved before class became a real
 *  reference (previously free text). */
export function applicantClassLabel(a) {
  return a.applyingForClassName || a.applyingForClass || null;
}

/* ── Pure helpers ─────────────────────────────────────────── */
export function stageMeta(id) {
  return ALL_STAGES.find(s => s.id === id) ?? {
    label: id,
    light: 'bg-slate-100 text-slate-500 ring-slate-200',
    dot:   'bg-slate-300',
  };
}

export function initials(first, last) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

export function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const AVATAR_COLORS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-pink-500 to-rose-600',
  'from-indigo-500 to-blue-600',
];
export function avatarColor(name = '') {
  return AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];
}

export function exportAdmissionsCSV(cols) {
  const header = [
    'First Name','Last Name','Stage','Priority',
    'Applying For Class','Applying For Stream','Academic Year','Date of Birth','Gender',
    'Parent Name','Parent Phone','Parent Email','Applied Date',
  ];
  const rows = cols.flatMap(col =>
    col.items.map(a => [
      a.firstName ?? '', a.lastName ?? '',
      stageMeta(a.stage).label,
      a.priority ?? 'normal',
      applicantClassLabel(a) ?? '', a.applyingForStreamName ?? '', a.applyingForYear ?? '',
      a.dateOfBirth ? new Date(a.dateOfBirth).toLocaleDateString('en-GB') : '',
      a.gender ?? '',
      a.parentName ?? '', a.parentPhone ?? '', a.parentEmail ?? '',
      a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-GB') : '',
    ])
  );
  const csv = [header, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const el   = document.createElement('a');
  el.href     = url;
  el.download = `admissions_${new Date().toISOString().slice(0, 10)}.csv`;
  el.click();
  URL.revokeObjectURL(url);
}
