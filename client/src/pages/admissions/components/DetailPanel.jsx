/* ============================================================
   DetailPanel — applicant detail side panel + edit mode
   PrintLetterModal is kept here (only called from this panel)
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  X, Loader2, AlertCircle, Edit2, Save, ArrowRight, ChevronRight,
  GraduationCap, Users, Calendar, Flag, Phone, Mail, Printer,
} from 'lucide-react';
import {
  admissions as admissionsApi, academicConfig as academicConfigApi,
  classes as classesApi, streams as streamsApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { stageMeta, avatarColor, initials, formatDate, PRIORITY_CONFIG, applicantClassLabel } from '../constants.js';
import { Section, Field, inputCls, DetailSection, DetailRow } from './AdmissionsPrimitives.jsx';

/* ── Print letter modal ───────────────────────────────────── */
function PrintLetterModal({ applicant, school, onClose }) {
  const a          = applicant;
  const refNo      = `ADM-${(a._id ?? a.id ?? '').slice(-6).toUpperCase() || 'XXXXXX'}`;
  const today      = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const schoolName = school?.name ?? 'Msingi School';

  const letterBody = `
    <html>
    <head>
      <title>Admission Letter — ${a.firstName} ${a.lastName}</title>
      <style>
        body { font-family: Georgia, serif; max-width: 680px; margin: 40px auto; padding: 0 20px; color: #111; line-height: 1.6; }
        h1 { font-size: 22px; font-weight: bold; margin-bottom: 2px; }
        .school-sub { font-size: 13px; color: #555; margin-bottom: 32px; }
        .date { text-align: right; font-size: 13px; color: #555; }
        .ref  { font-size: 13px; color: #555; margin-bottom: 28px; }
        .salutation { font-size: 15px; margin-bottom: 16px; }
        .body-para  { font-size: 14px; margin-bottom: 14px; }
        .detail-box { border: 1px solid #ddd; border-radius: 6px; padding: 16px 20px; margin: 24px 0; font-size: 13px; background: #f9fafb; }
        .detail-row { display: flex; margin-bottom: 8px; }
        .detail-label { width: 160px; color: #666; font-weight: 600; }
        .detail-value { flex: 1; color: #111; }
        .sig-line { margin-top: 56px; border-top: 1px solid #333; width: 220px; padding-top: 6px; font-size: 13px; }
        hr { border: none; border-top: 2px solid #111; margin: 16px 0 8px; }
        @media print { body { margin: 0; } button { display: none; } }
      </style>
    </head>
    <body>
      <div class="date">${today}</div>
      <h1>${schoolName}</h1>
      <hr/>
      <div class="school-sub">Admissions Office</div>
      <div class="ref">Ref: ${refNo}</div>
      <div class="salutation">Dear ${a.parentName ?? 'Parent / Guardian'},</div>
      <p class="body-para">
        We are pleased to confirm that the application for <strong>${a.firstName} ${a.middleName ? a.middleName + ' ' : ''}${a.lastName}</strong> has been received and is currently at the <strong>${stageMeta(a.stage).label}</strong> stage of our admissions process.
      </p>
      <div class="detail-box">
        <div class="detail-row"><span class="detail-label">Applicant Name</span><span class="detail-value">${a.firstName} ${a.middleName ? a.middleName + ' ' : ''}${a.lastName}</span></div>
        <div class="detail-row"><span class="detail-label">Date of Birth</span><span class="detail-value">${a.dateOfBirth ? new Date(a.dateOfBirth).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</span></div>
        <div class="detail-row"><span class="detail-label">Applying For</span><span class="detail-value">${applicantClassLabel(a) || '—'}${a.applyingForStreamName ? ` (Stream ${a.applyingForStreamName})` : ''} — ${a.applyingForYear || 'Current Year'}</span></div>
        <div class="detail-row"><span class="detail-label">Stage</span><span class="detail-value">${stageMeta(a.stage).label}</span></div>
        <div class="detail-row"><span class="detail-label">Reference No.</span><span class="detail-value">${refNo}</span></div>
        <div class="detail-row"><span class="detail-label">Application Date</span><span class="detail-value">${a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : today}</span></div>
      </div>
      <p class="body-para">
        We will be in touch to inform you of the next steps in the process. If you have any questions, please do not hesitate to contact the Admissions Office.
      </p>
      <p class="body-para">Yours faithfully,</p>
      <div class="sig-line">Admissions Officer<br/>${schoolName}</div>
    </body>
    </html>
  `;

  function handlePrint() {
    const win = window.open('', '_blank', 'width=800,height=900');
    win.document.write(letterBody);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900">Admission Letter</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={16} /></button>
        </div>
        <div className="p-6 space-y-4">
          {/* Preview snippet */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-1 text-sm text-slate-700 font-mono text-xs leading-relaxed">
            <p className="font-bold text-base text-slate-900">{schoolName}</p>
            <p className="text-slate-500">Admissions Office — Ref: {refNo}</p>
            <p className="mt-3">Dear {a.parentName ?? 'Parent / Guardian'},</p>
            <p className="mt-2 text-slate-600">
              We are pleased to confirm the application for <strong>{a.firstName} {a.lastName}</strong>{' '}
              is at the <strong>{stageMeta(a.stage).label}</strong> stage.
            </p>
            <p className="text-slate-500 mt-2 text-xs">Class: {applicantClassLabel(a) || '—'} · Year: {a.applyingForYear || '—'}</p>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button
              onClick={handlePrint}
              className="rounded-lg bg-slate-900 hover:bg-slate-800 px-4 py-2 text-sm font-semibold text-white flex items-center gap-2"
            >
              <Printer size={14} /> Print Letter
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Detail panel ─────────────────────────────────────────── */
export default function DetailPanel({ applicant, onClose, onStageChange }) {
  const a      = applicant;
  const sm     = stageMeta(a.stage);
  const av     = avatarColor(`${a.firstName}${a.lastName}`);
  const pri    = PRIORITY_CONFIG[a.priority] ?? PRIORITY_CONFIG.normal;
  const school = useAuthStore(s => s.session?.school);
  const qc     = useQueryClient();

  const [showLetter, setShowLetter] = useState(false);
  const [editing, setEditing]       = useState(false);
  const [editForm, setEditForm]     = useState({
    firstName:             a.firstName             ?? '',
    lastName:              a.lastName              ?? '',
    applyingForClass:      a.applyingForClass       ?? '',
    applyingForClassName:  a.applyingForClassName   ?? '',
    applyingForStream:     a.applyingForStream      ?? '',
    applyingForStreamName: a.applyingForStreamName  ?? '',
    applyingForYear:       a.applyingForYear        ?? '',
    parentName:       a.parentName       ?? '',
    parentPhone:      a.parentPhone      ?? '',
    parentEmail:      a.parentEmail      ?? '',
    priority:         a.priority         ?? 'normal',
    notes:            a.notes            ?? '',
  });

  const updateMut = useMutation({
    mutationFn: data => admissionsApi.update(a.id ?? a._id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admissions'] });
      setEditing(false);
    },
  });

  function setF(field, val) { setEditForm(f => ({ ...f, [field]: val })); }

  /* Classes/streams/years — same real-reference selects as the New
     Application form, so editing an application can't reintroduce free
     text in place of a class/stream/year reference. */
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60_000,
    enabled:  editing,
  });
  const classList = classesData?.data ?? [];

  const { data: streamData } = useQuery({
    queryKey: ['streams', { classId: editForm.applyingForClass }],
    queryFn:  () => streamsApi.list({ classId: editForm.applyingForClass, status: 'active', limit: 200 }),
    enabled:  editing && !!editForm.applyingForClass,
    staleTime: 60_000,
  });
  const streamList = streamData?.data ?? [];

  const { data: yearsData } = useQuery({
    queryKey: ['academic-config', 'years'],
    queryFn:  academicConfigApi.years.list,
    staleTime: 10 * 60_000,
    enabled:  editing,
  });
  const years = yearsData?.data ?? yearsData ?? [];

  function onEditClassChange(classId) {
    const c = classList.find(c => (c.id ?? c._id) === classId);
    setEditForm(f => ({
      ...f,
      applyingForClass:      classId,
      applyingForClassName:  c?.name ?? '',
      applyingForStream:     '',
      applyingForStreamName: '',
    }));
  }

  function onEditStreamChange(streamId) {
    const s = streamList.find(s => (s.id ?? s._id) === streamId);
    setEditForm(f => ({ ...f, applyingForStream: streamId, applyingForStreamName: s?.name ?? '' }));
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/25 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 32, stiffness: 320 }}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${av} flex items-center justify-center text-white text-sm font-bold shrink-0`}>
                {initials(editing ? editForm.firstName : a.firstName, editing ? editForm.lastName : a.lastName)}
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {editing
                    ? `${editForm.firstName} ${editForm.lastName}`
                    : `${a.firstName} ${a.middleName ? a.middleName + ' ' : ''}${a.lastName}`}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ring-1 ${sm.light}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} />
                    {sm.label}
                  </span>
                  {a.priority !== 'normal' && !editing && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${pri.cls}`}>{pri.label}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {editing ? (
                <>
                  <button
                    onClick={() => setEditing(false)}
                    className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition text-xs font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => updateMut.mutate(editForm)}
                    disabled={updateMut.isPending}
                    className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {updateMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                    Save
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition"
                  title="Edit applicant"
                >
                  <Edit2 size={14} />
                </button>
              )}
              <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition">
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {editing ? (
            /* ── Edit form ──────────────────────────────────── */
            <div className="px-6 py-5 space-y-4">
              {updateMut.isError && (
                <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200">
                  <AlertCircle size={14} /> {updateMut.error?.message ?? 'Update failed'}
                </div>
              )}
              <Section label="Applicant">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="First Name">
                    <input value={editForm.firstName} onChange={e => setF('firstName', e.target.value)} className={inputCls()} />
                  </Field>
                  <Field label="Last Name">
                    <input value={editForm.lastName} onChange={e => setF('lastName', e.target.value)} className={inputCls()} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Applying for Class">
                    <select value={editForm.applyingForClass} onChange={e => onEditClassChange(e.target.value)} className={inputCls()}>
                      <option value="">Select class…</option>
                      {classList.map(c => <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>)}
                    </select>
                  </Field>
                  <Field label="Stream">
                    <select
                      value={editForm.applyingForStream}
                      onChange={e => onEditStreamChange(e.target.value)}
                      disabled={!editForm.applyingForClass}
                      className={inputCls()}
                    >
                      <option value="">{editForm.applyingForClass ? 'No stream' : 'Select class first'}</option>
                      {streamList.map(s => <option key={s.id ?? s._id} value={s.id ?? s._id}>Stream {s.name}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Academic Year">
                  <select value={editForm.applyingForYear} onChange={e => setF('applyingForYear', e.target.value)} className={inputCls()}>
                    <option value="">Select year…</option>
                    {years.map(y => (
                      <option key={y.id ?? y._id} value={y.name}>
                        {y.name}{y.isCurrent ? ' (current)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Priority">
                  <select value={editForm.priority} onChange={e => setF('priority', e.target.value)} className={inputCls()}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </select>
                </Field>
              </Section>
              <Section label="Parent / Guardian">
                <Field label="Full Name">
                  <input value={editForm.parentName} onChange={e => setF('parentName', e.target.value)} className={inputCls()} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Phone">
                    <input value={editForm.parentPhone} onChange={e => setF('parentPhone', e.target.value)} className={inputCls()} />
                  </Field>
                  <Field label="Email">
                    <input type="email" value={editForm.parentEmail} onChange={e => setF('parentEmail', e.target.value)} className={inputCls()} />
                  </Field>
                </div>
              </Section>
              <Section label="Notes">
                <textarea
                  value={editForm.notes}
                  onChange={e => setF('notes', e.target.value)}
                  rows={3}
                  className={`${inputCls()} resize-none`}
                  placeholder="Any notes…"
                />
              </Section>
            </div>
          ) : (
            /* ── View mode ──────────────────────────────────── */
            <>
              {/* Actions */}
              <div className="px-6 py-4 border-b border-slate-100 space-y-2">
                <button
                  onClick={onStageChange}
                  className="w-full flex items-center justify-between bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <ArrowRight size={14} />
                    Move to next stage
                  </span>
                  <ChevronRight size={14} />
                </button>
                <button
                  onClick={() => setShowLetter(true)}
                  className="w-full flex items-center justify-center gap-2 border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
                >
                  <Printer size={14} />
                  Print Admission Letter
                </button>
              </div>

              <div className="px-6 py-5 space-y-6">
                {/* Academic */}
                <DetailSection icon={<GraduationCap size={14} />} label="Academic">
                  <DetailRow label="Applying for"  value={applicantClassLabel(a) || '—'} />
                  {a.applyingForStreamName && <DetailRow label="Stream" value={a.applyingForStreamName} />}
                  <DetailRow label="Academic year" value={a.applyingForYear  || '—'} />
                  <DetailRow label="Date of birth" value={formatDate(a.dateOfBirth)} />
                  <DetailRow label="Gender"        value={a.gender           || '—'} />
                  {a.sibling      && <DetailRow label="Sibling"       value="Yes — has sibling at school" />}
                  {a.specialNeeds && <DetailRow label="Special needs" value={a.specialNeeds} />}
                </DetailSection>

                {/* Parent */}
                <DetailSection icon={<Users size={14} />} label="Parent / Guardian">
                  <DetailRow label="Name"  value={a.parentName  || '—'} />
                  <DetailRow label="Phone" value={a.parentPhone || '—'} icon={<Phone size={11} className="text-slate-400 shrink-0" />} />
                  <DetailRow label="Email" value={a.parentEmail || '—'} icon={<Mail  size={11} className="text-slate-400 shrink-0" />} />
                </DetailSection>

                {/* Timeline */}
                <DetailSection icon={<Calendar size={14} />} label="Timeline">
                  <DetailRow label="Applied"      value={formatDate(a.createdAt)} />
                  <DetailRow label="Last updated" value={formatDate(a.updatedAt)} />
                </DetailSection>

                {/* Notes */}
                {a.notes && (
                  <DetailSection icon={<Flag size={14} />} label="Notes">
                    <p className="text-sm text-slate-600 leading-relaxed bg-slate-50 rounded-lg px-3 py-2.5 border border-slate-100">
                      {a.notes}
                    </p>
                  </DetailSection>
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>

      {showLetter && (
        <PrintLetterModal applicant={a} school={school} onClose={() => setShowLetter(false)} />
      )}
    </>
  );
}
