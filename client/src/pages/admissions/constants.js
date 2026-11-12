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

/* ── Enquiry tracking (2026-11) ────────────────────────────────
   The public/staff enquiry form captures a deliberately small set of
   follow-up facts. Tri-state flags are kept distinct from false:
   "not sure / not asked" is exactly the group the admissions team
   needs to chase, so collapsing it into "no" would lose the lead. */
export const HEARD_ABOUT_OPTIONS = [
  { value: 'word_of_mouth', label: 'Word of mouth' },
  { value: 'social_media',  label: 'Facebook / Instagram / WhatsApp' },
  { value: 'google',        label: 'Google search' },
  { value: 'event',         label: 'School event / open day' },
  { value: 'referral',      label: 'Referred by a parent' },
  { value: 'walk_in',       label: 'Walked past / signboard' },
  { value: 'other',         label: 'Other' },
];

export const ENQUIRY_SOURCE_LABEL = {
  public_form: 'Web form',
  staff:       'Staff',
};

export function heardAboutLabel(value) {
  if (!value) return '';
  return HEARD_ABOUT_OPTIONS.find(o => o.value === value)?.label ?? value;
}

export function triStateLabel(value) {
  if (value === true)  return 'Yes';
  if (value === false) return 'No';
  return 'Not sure';
}

/** Applicant name with a fallback for the light enquiry form, where the
 *  learner's names are intentionally not collected. */
export function applicantDisplayName(a) {
  const name = [a?.firstName, a?.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  return a?.parentName || a?.parentPhone || a?.parentEmail || 'Unnamed enquiry';
}

export function applicantInitials(a) {
  if (a?.firstName || a?.lastName) return initials(a.firstName, a.lastName);
  const name = applicantDisplayName(a);
  const parts = name.split(/\s+/).filter(Boolean);
  // A phone number has no useful initials — use the first digit instead.
  if (!parts.length) return '?';
  if (/^\+?\d/.test(name)) return name.replace(/\D/g, '').slice(0, 2) || '#';
  return parts.slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

export const EMPTY_FORM = {
  firstName: '', lastName: '', middleName: '', dateOfBirth: '',
  gender: '',
  allergies: '',
  houseId: '', houseName: '',
  applyingForClass: '', applyingForClassName: '',
  applyingForStream: '', applyingForStreamName: '',
  applyingForYear: '',
  // Mother/Father — the actual inputs now (2026-09). primaryContact
  // selects which one feeds parentName/Email/Phone below, which stay in
  // the form state (server-derived, but keeping them here too means a
  // response round-trip reflects immediately without a refetch).
  primaryContact: 'mother',
  motherName: '', motherEmail: '', motherPhone: '', motherIdNumber: '',
  fatherName: '', fatherEmail: '', fatherPhone: '', fatherIdNumber: '',
  parentName: '', parentEmail: '', parentPhone: '',
  emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelation: '',
  priority: 'normal', notes: '', stage: 'enquiry',
  // 2026-09 — Director's/Referral fee-discount eligibility, established
  // here so it's known BEFORE the admission invoice is generated at
  // enroll time (see server/routes/admissions.js's billing-sequence fix).
  isDirectorFamily: false, isReferralFamily: false,
  // 2026-11 — enquiry tracking. Staff-captured leads are marked as such;
  // the public form sets 'public_form' server-side. Tri-state selects use
  // 'unknown' | 'yes' | 'no' and are converted to null | true | false on save.
  learnerAge: '',
  tourCompleted: 'unknown',
  assessmentCompleted: 'unknown',
  heardAbout: '',
  heardAboutOther: '',
  enquirySource: 'staff',
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
    'Application Ref',
    'First Name','Last Name','Stage','Priority',
    'Applying For Class','Applying For Stream','Academic Year','Date of Birth','Gender',
    'Parent Name','Parent Phone','Parent Email','Applied Date',
    'Learner Age','Enquiry Source','Heard About','School Tour','Assessment',
  ];
  const rows = cols.flatMap(col =>
    col.items.map(a => [
      a.applicationRef ?? '',
      a.firstName ?? '', a.lastName ?? '',
      stageMeta(a.stage).label,
      a.priority ?? 'normal',
      applicantClassLabel(a) ?? '', a.applyingForStreamName ?? '', a.applyingForYear ?? '',
      a.dateOfBirth ? new Date(a.dateOfBirth).toLocaleDateString('en-GB') : '',
      a.gender ?? '',
      a.parentName ?? '', a.parentPhone ?? '', a.parentEmail ?? '',
      a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-GB') : '',
      a.learnerAge ?? '',
      ENQUIRY_SOURCE_LABEL[a.enquirySource] ?? '',
      heardAboutLabel(a.heardAbout) ?? '',
      a.tourCompleted === true ? 'Yes' : a.tourCompleted === false ? 'No' : 'Not sure',
      a.assessmentCompleted === true ? 'Yes' : a.assessmentCompleted === false ? 'No' : 'Not sure',
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
