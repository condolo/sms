/* ============================================================
   AddSlideOver — new application slide-over form
   ============================================================ */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { admissions as admissionsApi } from '@/api/client.js';
import { EMPTY_FORM, PIPELINE } from '../constants.js';
import { Section, Field, inputCls } from './AdmissionsPrimitives.jsx';

export default function AddSlideOver({ onClose, onCreated }) {
  const [form, setForm]     = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});

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
    if (!form.firstName.trim())  e.firstName  = 'Required';
    if (!form.lastName.trim())   e.lastName   = 'Required';
    if (!form.parentName.trim()) e.parentName = 'Required';
    if (!form.parentPhone.trim() && !form.parentEmail.trim()) e.parentPhone = 'Phone or email required';
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
              <Field label="Date of Birth">
                <input type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} className={inputCls()} />
              </Field>
              <Field label="Gender">
                <select value={form.gender} onChange={e => set('gender', e.target.value)} className={inputCls()}>
                  <option value="">Select…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Applying for Class">
                <input value={form.applyingForClass} onChange={e => set('applyingForClass', e.target.value)} placeholder="e.g. Year 7" className={inputCls()} />
              </Field>
              <Field label="Academic Year">
                <input value={form.applyingForYear} onChange={e => set('applyingForYear', e.target.value)} placeholder="e.g. 2025/26" className={inputCls()} />
              </Field>
            </div>
          </Section>

          {/* Parent/Guardian */}
          <Section label="Parent / Guardian">
            <Field label="Full Name *" error={errors.parentName}>
              <input value={form.parentName} onChange={e => set('parentName', e.target.value)} placeholder="Parent or guardian name" className={inputCls(errors.parentName)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone" error={errors.parentPhone}>
                <input value={form.parentPhone} onChange={e => set('parentPhone', e.target.value)} placeholder="+254 …" className={inputCls(errors.parentPhone)} />
              </Field>
              <Field label="Email">
                <input type="email" value={form.parentEmail} onChange={e => set('parentEmail', e.target.value)} placeholder="parent@email.com" className={inputCls()} />
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
