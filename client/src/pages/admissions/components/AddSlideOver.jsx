/* ============================================================
   AddSlideOver — new application slide-over form
   ============================================================ */
import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  admissions as admissionsApi, academicConfig as academicConfigApi,
  classes as classesApi, streams as streamsApi, settings as settingsApi,
} from '@/api/client.js';
import { EMPTY_FORM, PIPELINE } from '../constants.js';
import { Section, Field, inputCls } from './AdmissionsPrimitives.jsx';
import { useCurrentAcademicPeriod } from '@/hooks/useCurrentAcademicPeriod.js';

export default function AddSlideOver({ onClose, onCreated }) {
  const [form, setForm]     = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const currentPeriod = useCurrentAcademicPeriod();

  const { data: yearsData } = useQuery({
    queryKey: ['academic-config', 'years'],
    queryFn:  academicConfigApi.years.list,
    staleTime: 10 * 60_000,
  });
  const years = yearsData?.data ?? yearsData ?? [];

  /* Default "applying for" year to the live-resolved current academic
     year — still overridable (e.g. applying ahead for next year's intake). */
  useEffect(() => {
    if (!currentPeriod.academicYear || form.applyingForYear) return;
    set('applyingForYear', currentPeriod.academicYear);
  }, [currentPeriod.academicYear]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Classes/streams — same source as everywhere else a class is picked
     (Students, Timetable, ...), so a stream added under Classes shows up
     here immediately instead of "Applying for Class" being free text
     disconnected from real class/stream records. */
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60_000,
  });
  const classList = classesData?.data ?? [];

  const { data: streamData } = useQuery({
    queryKey: ['streams', { classId: form.applyingForClass }],
    queryFn:  () => streamsApi.list({ classId: form.applyingForClass, status: 'active', limit: 200 }),
    enabled:  !!form.applyingForClass,
    staleTime: 60_000,
  });
  const streamList = streamData?.data ?? [];

  /* Houses — same source/shape as the Students form (StudentProfile.jsx):
     school.houses, each {id|name, color}. Color itself lives on the house
     in Settings, not per-applicant — picking the house is enough. */
  const { data: settingsData } = useQuery({
    queryKey: ['settings', 'school'],
    queryFn:  () => settingsApi.school.get(),
    staleTime: 5 * 60_000,
  });
  const houses = Array.isArray(settingsData?.data?.houses) ? settingsData.data.houses : [];

  function onHouseChange(houseId) {
    const h = houses.find(h => (h.id ?? h.name) === houseId);
    set('houseId', houseId);
    set('houseName', h?.name ?? '');
  }

  function onClassChange(classId) {
    const c = classList.find(c => (c.id ?? c._id) === classId);
    setForm(f => ({
      ...f,
      applyingForClass:      classId,
      applyingForClassName:  c?.name ?? '',
      applyingForStream:     '',
      applyingForStreamName: '',
    }));
  }

  function onStreamChange(streamId) {
    const s = streamList.find(s => (s.id ?? s._id) === streamId);
    setForm(f => ({ ...f, applyingForStream: streamId, applyingForStreamName: s?.name ?? '' }));
  }

  const mutation = useMutation({
    mutationFn: data => admissionsApi.create(data),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create application' }),
  });

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => { const n = { ...e }; delete n[field]; return n; });
  }

  function validate() {
    const e = {};
    if (!form.firstName.trim())   e.firstName   = 'Required';
    if (!form.lastName.trim())    e.lastName    = 'Required';
    if (!form.dateOfBirth.trim()) e.dateOfBirth = 'Required';
    if (!form.gender.trim())      e.gender      = 'Required';
    // Mirrors the server's own guardian requirement exactly (server/utils/
    // guardian-contact.js's validateGuardianRequirement). Email — not
    // phone — is mandatory for ANY named parent, independent of which one
    // is primaryContact: each parent can eventually get their own,
    // separate portal login, and a name without an email can never
    // become one later. Phone stays optional.
    if (form.motherName.trim() && !form.motherEmail.trim()) e.motherEmail = "Required when Mother's name is provided";
    if (form.fatherName.trim() && !form.fatherEmail.trim()) e.fatherEmail = "Required when Father's name is provided";
    const motherOk = form.motherName.trim() && form.motherEmail.trim();
    const fatherOk = form.fatherName.trim() && form.fatherEmail.trim();
    if (!e.motherEmail && !e.fatherEmail && !motherOk && !fatherOk) {
      e.motherName = 'At least one parent (name + email) is required';
    }
    return e;
  }

  function submit(ev) {
    ev.preventDefault();
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    mutation.mutate(form);
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      {/* Panel */}
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">New Application</h2>
            <p className="text-xs text-slate-400 mt-0.5">Add a new applicant to the pipeline</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1 rounded-lg hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertCircle size={15} className="shrink-0" />
              {errors._server}
            </div>
          )}

          {/* Applicant */}
          <Section label="Applicant Details">
            <div className="grid grid-cols-2 gap-4">
              <Field label="First Name *" error={errors.firstName}>
                <input value={form.firstName} onChange={e => set('firstName', e.target.value)} placeholder="First name" className={inputCls(errors.firstName)} />
              </Field>
              <Field label="Last Name *" error={errors.lastName}>
                <input value={form.lastName} onChange={e => set('lastName', e.target.value)} placeholder="Last name" className={inputCls(errors.lastName)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Date of Birth *" error={errors.dateOfBirth}>
                <input type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} className={inputCls(errors.dateOfBirth)} />
              </Field>
              <Field label="Gender *" error={errors.gender}>
                <select value={form.gender} onChange={e => set('gender', e.target.value)} className={inputCls(errors.gender)}>
                  <option value="">Select…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Applying for Class">
                <select value={form.applyingForClass} onChange={e => onClassChange(e.target.value)} className={inputCls()}>
                  <option value="">Select class…</option>
                  {classList.map(c => <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>)}
                </select>
              </Field>
              <Field label="Stream">
                <select
                  value={form.applyingForStream}
                  onChange={e => onStreamChange(e.target.value)}
                  disabled={!form.applyingForClass}
                  className={inputCls()}
                >
                  <option value="">{form.applyingForClass ? 'No stream' : 'Select class first'}</option>
                  {streamList.map(s => <option key={s.id ?? s._id} value={s.id ?? s._id}>Stream {s.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Academic Year">
                <select value={form.applyingForYear} onChange={e => set('applyingForYear', e.target.value)} className={inputCls()}>
                  <option value="">Select year…</option>
                  {years.map(y => (
                    <option key={y.id ?? y._id} value={y.name}>
                      {y.name}{y.isCurrent ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="House">
                <select value={form.houseId} onChange={e => onHouseChange(e.target.value)} className={inputCls()}>
                  <option value="">{houses.length ? 'Select house…' : 'No houses configured'}</option>
                  {houses.map(h => <option key={h.id ?? h.name} value={h.id ?? h.name}>{h.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Allergies">
              <input value={form.allergies} onChange={e => set('allergies', e.target.value)} placeholder="e.g. Peanuts, none if none known" className={inputCls()} />
            </Field>
          </Section>

          {/* Mother / Father */}
          <Section label="Parent / Guardian">
            <Field label="Primary Contact" error={errors.motherName}>
              <select value={form.primaryContact} onChange={e => set('primaryContact', e.target.value)} className={inputCls(errors.motherName)}>
                <option value="mother">Mother</option>
                <option value="father">Father</option>
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                Used for school communications and as the default contact on record. Once enrolled, Mother and Father can each get their own separate portal login from the student's profile — this selection doesn't limit that.
              </p>
            </Field>

            <p className="text-xs font-medium text-slate-500 mt-4 mb-1">Mother</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Full Name"><input value={form.motherName} onChange={e => set('motherName', e.target.value)} placeholder="Mother's name" className={inputCls()} /></Field>
              <Field label="ID / Passport No."><input value={form.motherIdNumber} onChange={e => set('motherIdNumber', e.target.value)} className={inputCls()} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone"><input value={form.motherPhone} onChange={e => set('motherPhone', e.target.value)} placeholder="+254 …" className={inputCls()} /></Field>
              <Field label={form.motherName.trim() ? 'Email *' : 'Email'} error={errors.motherEmail}>
                <input type="email" value={form.motherEmail} onChange={e => set('motherEmail', e.target.value)} placeholder="mother@email.com" className={inputCls(errors.motherEmail)} />
              </Field>
            </div>

            <p className="text-xs font-medium text-slate-500 mt-4 mb-1">Father</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Full Name"><input value={form.fatherName} onChange={e => set('fatherName', e.target.value)} placeholder="Father's name" className={inputCls()} /></Field>
              <Field label="ID / Passport No."><input value={form.fatherIdNumber} onChange={e => set('fatherIdNumber', e.target.value)} className={inputCls()} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone"><input value={form.fatherPhone} onChange={e => set('fatherPhone', e.target.value)} placeholder="+254 …" className={inputCls()} /></Field>
              <Field label={form.fatherName.trim() ? 'Email *' : 'Email'} error={errors.fatherEmail}>
                <input type="email" value={form.fatherEmail} onChange={e => set('fatherEmail', e.target.value)} placeholder="father@email.com" className={inputCls(errors.fatherEmail)} />
              </Field>
            </div>
          </Section>

          {/* Emergency contact */}
          <Section label="Emergency Contact">
            <Field label="Full Name">
              <input value={form.emergencyContactName} onChange={e => set('emergencyContactName', e.target.value)} placeholder="If different from parents above" className={inputCls()} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone">
                <input value={form.emergencyContactPhone} onChange={e => set('emergencyContactPhone', e.target.value)} placeholder="+254 …" className={inputCls()} />
              </Field>
              <Field label="Relationship">
                <input value={form.emergencyContactRelation} onChange={e => set('emergencyContactRelation', e.target.value)} placeholder="e.g. Aunt, Family friend" className={inputCls()} />
              </Field>
            </div>
          </Section>

          {/* Pipeline */}
          <Section label="Pipeline">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Initial Stage">
                <select value={form.stage} onChange={e => set('stage', e.target.value)} className={inputCls()}>
                  {PIPELINE.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select value={form.priority} onChange={e => set('priority', e.target.value)} className={inputCls()}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </Field>
            </div>
            <Field label="Notes">
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Any additional notes…" className={`${inputCls()} resize-none`} />
            </Field>
          </Section>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Saving…' : 'Add Application'}
          </button>
        </div>
      </motion.div>
    </>
  );
}
