/* ============================================================
   StaffFormModal — Add / Edit a staff member
   Props:
     mode        'add' | 'edit'
     teacher     null (add) | existing teacher doc (edit)
     departments []
     subjects    []
     isHR        bool — show sensitive HR fields
     onClose     fn
     onSave      fn(formData)
     saving      bool
   ============================================================ */
import { useState } from 'react';
import { X, Save, Loader2, User, Briefcase, Shield, Lock } from 'lucide-react';

const STAFF_TYPE_OPTIONS = [
  { value: 'teacher',       label: 'Teacher' },
  { value: 'administrator', label: 'Administrator' },
  { value: 'librarian',     label: 'Librarian' },
  { value: 'counselor',     label: 'Counselor' },
  { value: 'finance',       label: 'Finance Staff' },
  { value: 'hr',            label: 'HR Staff' },
  { value: 'it',            label: 'IT Staff' },
  { value: 'security',      label: 'Security' },
  { value: 'other',         label: 'Other' },
];

const EXTRA_ROLES_OPTIONS = [
  { value: 'hod',           label: 'Head of Department' },
  { value: 'class_teacher', label: 'Class Teacher / Form Tutor' },
  { value: 'timetabler',    label: 'Timetabler' },
  { value: 'exam_officer',  label: 'Exam Officer' },
  { value: 'deputy',        label: 'Deputy Principal' },
  { value: 'principal',     label: 'Principal' },
];

const CONTRACT_OPTIONS = [
  { value: 'full_time', label: 'Full Time' },
  { value: 'part_time', label: 'Part Time' },
  { value: 'supply',    label: 'Supply / Relief' },
  { value: 'volunteer', label: 'Volunteer' },
];

const STATUS_OPTIONS = [
  { value: 'active',     label: 'Active' },
  { value: 'on_leave',   label: 'On Leave' },
  { value: 'inactive',   label: 'Inactive' },
  { value: 'terminated', label: 'Terminated' },
];

function Section({ icon: Icon, title, children }) {
  return (
    <div className="border-t border-slate-100 pt-5 mt-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-6 w-6 rounded-md bg-violet-50 flex items-center justify-center shrink-0">
          <Icon size={13} className="text-violet-600" />
        </div>
        <h3 className="text-xs font-bold text-slate-600 uppercase tracking-wider">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function StaffFormModal({ mode, teacher, departments = [], subjects = [], isHR, onClose, onSave, saving }) {
  const isEdit = mode === 'edit';

  const [form, setForm] = useState({
    title:          teacher?.title          ?? '',
    firstName:      teacher?.firstName      ?? '',
    lastName:       teacher?.lastName       ?? '',
    middleName:     teacher?.middleName     ?? '',
    email:          teacher?.email          ?? '',
    phone:          teacher?.phone          ?? '',
    gender:         teacher?.gender         ?? '',
    dateOfBirth:    teacher?.dateOfBirth    ?? '',
    address:        teacher?.address        ?? '',
    staffType:      teacher?.staffType      ?? 'teacher',
    contractType:   teacher?.contractType   ?? 'full_time',
    joinDate:       teacher?.joinDate       ?? '',
    status:         teacher?.status         ?? 'active',
    departmentId:   teacher?.departmentId   ?? '',
    specialization: teacher?.specialization ?? '',
    qualifications: teacher?.qualifications ?? '',
    subjects:       teacher?.subjects       ?? [],
    extraRoles:     teacher?.extraRoles     ?? [],
    formClassId:    teacher?.formClassId    ?? '',
    nationalId:     teacher?.nationalId     ?? '',
    nssfNo:         teacher?.nssfNo         ?? '',
    shaNo:          teacher?.shaNo          ?? '',
    kraPinNo:       teacher?.kraPinNo       ?? '',
    nextOfKin: {
      name:         teacher?.nextOfKin?.name         ?? '',
      phone:        teacher?.nextOfKin?.phone        ?? '',
      relationship: teacher?.nextOfKin?.relationship ?? '',
    },
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function setNok(k, v) { setForm(f => ({ ...f, nextOfKin: { ...f.nextOfKin, [k]: v } })); }

  function toggleRole(role) {
    setForm(f => ({
      ...f,
      extraRoles: f.extraRoles.includes(role)
        ? f.extraRoles.filter(r => r !== role)
        : [...f.extraRoles, role],
    }));
  }

  function toggleSubject(subjectId) {
    setForm(f => ({
      ...f,
      subjects: f.subjects.includes(subjectId)
        ? f.subjects.filter(s => s !== subjectId)
        : [...f.subjects, subjectId],
    }));
  }

  const fCls = 'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 bg-white';
  const lbl  = 'block text-xs font-semibold text-slate-600 mb-1';

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/40 overflow-y-auto"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
          <div>
            <h2 className="font-bold text-slate-900">
              {isEdit ? `Edit — ${teacher?.firstName} ${teacher?.lastName}` : 'Add Staff Member'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {isEdit ? 'Update profile and employment details' : 'Complete the form to register a new staff member'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition">
            <X size={16} />
          </button>
        </div>

        <form
          onSubmit={e => {
            e.preventDefault();
            onSave({
              ...form,
              // Coerce empty strings to undefined so the backend doesn't store blanks
              middleName:  form.middleName     || undefined,
              phone:       form.phone          || undefined,
              dateOfBirth: form.dateOfBirth    || undefined,
              address:     form.address        || undefined,
              departmentId:form.departmentId   || undefined,
              formClassId: form.formClassId    || undefined,
              nationalId:  form.nationalId     || undefined,
              nssfNo:      form.nssfNo         || undefined,
              shaNo:       form.shaNo          || undefined,
              kraPinNo:    form.kraPinNo       || undefined,
              nextOfKin:   (form.nextOfKin.name || form.nextOfKin.phone) ? form.nextOfKin : undefined,
            });
          }}
          className="px-6 pb-6"
        >

          {/* ── Personal Details ── */}
          <Section icon={User} title="Personal Details">
            <div className="grid grid-cols-4 gap-3 mb-3">
              <div>
                <label className={lbl}>Title</label>
                <select value={form.title} onChange={e => set('title', e.target.value)} className={fCls}>
                  <option value="">—</option>
                  {['Mr.','Mrs.','Ms.','Miss','Dr.','Prof.'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="col-span-3 grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>First Name *</label>
                  <input required value={form.firstName} onChange={e => set('firstName', e.target.value)}
                    className={fCls} placeholder="e.g. Agnes" />
                </div>
                <div>
                  <label className={lbl}>Last Name *</label>
                  <input required value={form.lastName} onChange={e => set('lastName', e.target.value)}
                    className={fCls} placeholder="e.g. Otieno" />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className={lbl}>Gender</label>
                <select value={form.gender} onChange={e => set('gender', e.target.value)} className={fCls}>
                  <option value="">— Not specified —</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </div>
              <div>
                <label className={lbl}>Date of Birth</label>
                <input type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} className={fCls} />
              </div>
              <div>
                <label className={lbl}>Phone</label>
                <input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)}
                  className={fCls} placeholder="+254 7xx xxx xxx" />
              </div>
            </div>
            <div>
              <label className={lbl}>Address</label>
              <input value={form.address} onChange={e => set('address', e.target.value)}
                className={fCls} placeholder="Physical or postal address" />
            </div>
          </Section>

          {/* ── Employment ── */}
          <Section icon={Briefcase} title="Employment">
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className={lbl}>Email *</label>
                <input required type="email" value={form.email} onChange={e => set('email', e.target.value)}
                  readOnly={isEdit}
                  className={`${fCls} ${isEdit ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : ''}`}
                  placeholder="staff@school.com" />
                {isEdit && <p className="text-[10px] text-slate-400 mt-0.5">Email cannot be changed here</p>}
              </div>
              <div>
                <label className={lbl}>Staff Type *</label>
                <select required value={form.staffType} onChange={e => set('staffType', e.target.value)} className={fCls}>
                  {STAFF_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div>
                <label className={lbl}>Contract Type</label>
                <select value={form.contractType} onChange={e => set('contractType', e.target.value)} className={fCls}>
                  {CONTRACT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Join Date</label>
                <input type="date" value={form.joinDate} onChange={e => set('joinDate', e.target.value)} className={fCls} />
              </div>
              <div>
                <label className={lbl}>Status</label>
                <select value={form.status} onChange={e => set('status', e.target.value)} className={fCls}>
                  {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className={lbl}>Department</label>
                <select value={form.departmentId} onChange={e => set('departmentId', e.target.value)} className={fCls}>
                  <option value="">— No department —</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className={lbl}>Specialization</label>
                <input value={form.specialization} onChange={e => set('specialization', e.target.value)}
                  className={fCls} placeholder="e.g. Mathematics, Sciences" />
              </div>
            </div>
            <div>
              <label className={lbl}>Qualifications</label>
              <textarea rows={2} value={form.qualifications} onChange={e => set('qualifications', e.target.value)}
                className={`${fCls} resize-none`} placeholder="e.g. B.Ed Mathematics, PGDE" />
            </div>
          </Section>

          {/* ── Roles ── */}
          <Section icon={Shield} title="Roles & Responsibilities">
            <p className="text-xs text-slate-400 mb-3">Select any additional responsibilities this staff member holds.</p>
            <div className="grid grid-cols-2 gap-2">
              {EXTRA_ROLES_OPTIONS.map(r => (
                <label key={r.value}
                  className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 cursor-pointer transition select-none ${
                    form.extraRoles.includes(r.value) ? 'border-violet-300 bg-violet-50' : 'border-slate-200 hover:bg-slate-50'
                  }`}>
                  <input type="checkbox" checked={form.extraRoles.includes(r.value)} onChange={() => toggleRole(r.value)}
                    className="accent-violet-600 shrink-0" />
                  <span className="text-sm text-slate-700 font-medium">{r.label}</span>
                </label>
              ))}
            </div>

            {/* Teaching subjects (visible when staffType is teacher) */}
            {form.staffType === 'teacher' && subjects.length > 0 && (
              <div className="mt-4">
                <label className={lbl}>Teaching Subjects</label>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
                  {subjects.map(s => (
                    <label key={s.id}
                      className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition select-none ${
                        form.subjects.includes(s.id) ? 'bg-violet-50' : 'hover:bg-slate-50'
                      }`}>
                      <input type="checkbox" checked={form.subjects.includes(s.id)} onChange={() => toggleSubject(s.id)}
                        className="accent-violet-600 shrink-0" />
                      <span className="text-sm text-slate-700">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </Section>

          {/* ── HR Records (HR/Admin only) ── */}
          {isHR && (
            <Section icon={Lock} title="HR Records">
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 mb-4">
                <p className="text-xs text-amber-700 font-medium">🔒 Sensitive — visible to HR and Admin only</p>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={lbl}>National ID</label>
                  <input value={form.nationalId} onChange={e => set('nationalId', e.target.value)}
                    className={fCls} placeholder="e.g. 12345678" />
                </div>
                <div>
                  <label className={lbl}>KRA PIN</label>
                  <input value={form.kraPinNo} onChange={e => set('kraPinNo', e.target.value)}
                    className={fCls} placeholder="e.g. A001234567T" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div>
                  <label className={lbl}>NSSF No.</label>
                  <input value={form.nssfNo} onChange={e => set('nssfNo', e.target.value)}
                    className={fCls} placeholder="NSSF member number" />
                </div>
                <div>
                  <label className={lbl}>SHA No.</label>
                  <input value={form.shaNo} onChange={e => set('shaNo', e.target.value)}
                    className={fCls} placeholder="Social Health Authority No." />
                </div>
              </div>

              {/* Next of Kin */}
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Next of Kin</p>
              <div className="grid grid-cols-3 gap-3 bg-slate-50 border border-slate-100 rounded-xl p-3">
                <div>
                  <label className={lbl}>Full Name</label>
                  <input value={form.nextOfKin.name} onChange={e => setNok('name', e.target.value)}
                    className={fCls} placeholder="Name" />
                </div>
                <div>
                  <label className={lbl}>Phone</label>
                  <input type="tel" value={form.nextOfKin.phone} onChange={e => setNok('phone', e.target.value)}
                    className={fCls} placeholder="+254..." />
                </div>
                <div>
                  <label className={lbl}>Relationship</label>
                  <input value={form.nextOfKin.relationship} onChange={e => setNok('relationship', e.target.value)}
                    className={fCls} placeholder="e.g. Spouse, Parent" />
                </div>
              </div>
            </Section>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-2 pt-5 border-t border-slate-100 mt-5">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="rounded-lg bg-violet-600 px-5 py-2 text-sm font-semibold text-white hover:bg-violet-700 flex items-center gap-1.5 disabled:opacity-50 transition">
              {saving
                ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
                : <><Save size={13} /> {isEdit ? 'Save Changes' : 'Add Staff Member'}</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
