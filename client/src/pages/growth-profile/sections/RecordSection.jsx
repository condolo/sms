/* ============================================================
   RecordSection — Generic CRUD section for Growth Profile.
   Used by: Leadership, Activities, Service, Awards sections.

   Props:
     type       — 'leadership' | 'activities' | 'service' | 'awards'
     studentId  — string
     canEdit    — boolean
     canVerify  — boolean
     isAdmin    — boolean
     config     — { title, description, icon, categories, extraFields }

   extraFields can be: 'hours', 'issuer', 'level', 'organization',
                       'location', 'achievement', 'evidenceUrl'
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Edit2, Trash2, X, Save, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { growthProfile as gpApi } from '@/api/client.js';
import VerificationBadge from '../components/VerificationBadge.jsx';

/* ── Skeleton ────────────────────────────────────────────────── */
function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-100 rounded ${className}`} />;
}

/* ── Empty state ─────────────────────────────────────────────── */
function Empty({ config }) {
  const Icon = config.icon;
  return (
    <div className="py-12 text-center">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
        <Icon size={20} className="text-slate-400" />
      </div>
      <p className="text-sm font-medium text-slate-600">No {config.title.toLowerCase()} records yet</p>
      <p className="text-xs text-slate-400 mt-1">{config.description}</p>
    </div>
  );
}

/* ── Input primitive ─────────────────────────────────────────── */
function iCls() {
  return 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 placeholder-slate-400 transition';
}

/* ── Level labels ────────────────────────────────────────────── */
const LEVEL_LABELS = { school: 'School', local: 'Local', regional: 'Regional', national: 'National', international: 'International' };

/* ── Date formatter ──────────────────────────────────────────── */
function fmtDate(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

/* ── Record Card ─────────────────────────────────────────────── */
function RecordCard({ record, config, canEdit, canVerify, isAdmin, onEdit, onDelete, onVerify, isVerifying }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      {/* Card header */}
      <div
        className="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-slate-50/50 transition"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-start gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-800 leading-snug">{record.title}</p>
            {record.level && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 uppercase tracking-wider">
                {LEVEL_LABELS[record.level] ?? record.level}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
            {record.category && (
              <span className="text-xs text-slate-500">{record.category}</span>
            )}
            {(record.startDate || record.endDate) && (
              <span className="text-xs text-slate-400">
                {fmtDate(record.startDate)}{record.endDate && record.endDate !== record.startDate ? ` — ${fmtDate(record.endDate)}` : ''}
              </span>
            )}
            {record.organization && (
              <span className="text-xs text-slate-400">{record.organization}</span>
            )}
            {record.hours != null && (
              <span className="text-xs text-slate-400">{record.hours}h</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
          <VerificationBadge
            status={record.verificationStatus}
            canVerify={canVerify}
            onVerify={(status, notes) => onVerify(record, status, notes)}
            isPending={isVerifying}
            isAdmin={isAdmin}
          />
          {canEdit && (
            <>
              <button
                onClick={() => onEdit(record)}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                title="Edit"
              >
                <Edit2 size={13} />
              </button>
              <button
                onClick={() => onDelete(record)}
                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
          {expanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
        </div>
      </div>

      {/* Expandable body */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 space-y-2 border-t border-slate-100 text-sm text-slate-600">
              {record.description && <p className="leading-relaxed">{record.description}</p>}
              {record.achievement && (
                <p className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg inline-block">
                  {record.achievement}
                </p>
              )}
              {record.issuer && <p className="text-xs text-slate-400">Issued by: {record.issuer}</p>}
              {record.evidenceUrl && (
                <a href={record.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                  View evidence
                </a>
              )}
              {record.verificationNotes && (
                <p className="text-xs text-slate-400 italic">{record.verificationNotes}</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Record Form ─────────────────────────────────────────────── */
function RecordForm({ type, studentId, config, initial = null, onClose, onSaved }) {
  const [form, setForm] = useState(initial ?? {
    title: '', category: '', description: '', startDate: '', endDate: '',
    achievement: '', evidenceUrl: '', organization: '', location: '',
    hours: '', issuer: '', level: '', isPublic: true,
  });
  const [error, setError] = useState(null);

  const qc = useQueryClient();
  const isEdit = !!initial?.id;

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => isEdit
      ? gpApi.records.update(type, initial.id, data)
      : gpApi.records.create(type, { ...data, studentId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['growth-records', type, studentId] });
      qc.invalidateQueries({ queryKey: ['growth-profile', studentId] });
      onSaved?.();
      onClose();
    },
    onError: (e) => setError(e.message ?? 'Failed to save record'),
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  const ef = config.extraFields ?? [];

  function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const payload = { ...form };
    if (payload.hours !== '' && payload.hours !== undefined) {
      payload.hours = parseFloat(payload.hours);
      if (isNaN(payload.hours)) { setError('Hours must be a number'); return; }
    } else {
      delete payload.hours;
    }
    if (!payload.evidenceUrl) delete payload.evidenceUrl;
    mutate(payload);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="bg-slate-50 border border-slate-200 rounded-xl p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-semibold text-slate-800">{isEdit ? `Edit ${config.title} Record` : `Add ${config.title} Record`}</h4>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-200 transition"><X size={14} /></button>
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Title */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">Title *</label>
            <input
              className={iCls()}
              value={form.title}
              onChange={e => set('title', e.target.value)}
              placeholder={`e.g. ${config.titlePlaceholder ?? 'Record title'}`}
              required
            />
          </div>

          {/* Category */}
          {config.categories && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
              <select className={iCls()} value={form.category} onChange={e => set('category', e.target.value)}>
                <option value="">Select category</option>
                {config.categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          {/* Level */}
          {ef.includes('level') && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Level</label>
              <select className={iCls()} value={form.level} onChange={e => set('level', e.target.value)}>
                <option value="">—</option>
                {Object.entries(LEVEL_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          )}

          {/* Organization */}
          {ef.includes('organization') && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Organization</label>
              <input className={iCls()} value={form.organization} onChange={e => set('organization', e.target.value)} placeholder="Club, company, institution…" />
            </div>
          )}

          {/* Issuer (awards) */}
          {ef.includes('issuer') && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Issued by</label>
              <input className={iCls()} value={form.issuer} onChange={e => set('issuer', e.target.value)} placeholder="Organisation or person" />
            </div>
          )}

          {/* Hours (service) */}
          {ef.includes('hours') && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Hours</label>
              <input
                type="number" min="0" max="100000" step="0.5"
                className={iCls()}
                value={form.hours}
                onChange={e => set('hours', e.target.value)}
                placeholder="e.g. 40"
              />
            </div>
          )}

          {/* Start date */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Start date</label>
            <input type="date" className={iCls()} value={form.startDate} onChange={e => set('startDate', e.target.value)} />
          </div>

          {/* End date */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">End date</label>
            <input type="date" className={iCls()} value={form.endDate} onChange={e => set('endDate', e.target.value)} />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
          <textarea rows={3} className={`${iCls()} resize-none`} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Describe your role, contribution, or experience…" />
        </div>

        {/* Achievement */}
        {ef.includes('achievement') && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Achievement / outcome</label>
            <input className={iCls()} value={form.achievement} onChange={e => set('achievement', e.target.value)} placeholder="Key outcome or award received" />
          </div>
        )}

        {/* Evidence URL */}
        {ef.includes('evidenceUrl') && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Evidence link (optional)</label>
            <input type="url" className={iCls()} value={form.evidenceUrl} onChange={e => set('evidenceUrl', e.target.value)} placeholder="https://…" />
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            disabled={isPending}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Add record'}
          </button>
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
        </div>
      </form>
    </motion.div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ══════════════════════════════════════════════════════════════ */
export default function RecordSection({ type, studentId, canEdit, canVerify, isAdmin, config }) {
  const [showForm, setShowForm]     = useState(false);
  const [editRecord, setEditRecord] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [verifyingId, setVerifyingId]   = useState(null);

  const qc = useQueryClient();

  /* ── Data ── */
  const { data, isLoading } = useQuery({
    queryKey: ['growth-records', type, studentId],
    queryFn:  () => gpApi.records.list(type, { studentId, limit: 100 }),
    enabled:  !!studentId,
    staleTime: 2 * 60_000,
  });
  const records = data?.data ?? [];

  /* ── Delete mutation ── */
  const { mutate: deleteRecord, isPending: deleting } = useMutation({
    mutationFn: (id) => gpApi.records.remove(type, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['growth-records', type, studentId] });
      qc.invalidateQueries({ queryKey: ['growth-profile', studentId] });
      setDeleteTarget(null);
    },
  });

  /* ── Verify mutation ── */
  const { mutate: verifyRecord } = useMutation({
    mutationFn: ({ id, status, notes }) => gpApi.records.verify(type, id, { status, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['growth-records', type, studentId] });
      setVerifyingId(null);
    },
    onMutate: ({ id }) => setVerifyingId(id),
    onError: () => setVerifyingId(null),
  });

  if (isLoading) return (
    <div className="space-y-3">
      {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-slate-400">{records.length} record{records.length !== 1 ? 's' : ''}</p>
        </div>
        {canEdit && !showForm && !editRecord && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 transition"
          >
            <Plus size={13} /> Add record
          </button>
        )}
      </div>

      {/* Add form */}
      <AnimatePresence>
        {showForm && (
          <RecordForm
            type={type} studentId={studentId} config={config}
            onClose={() => setShowForm(false)}
            onSaved={() => setShowForm(false)}
          />
        )}
      </AnimatePresence>

      {/* Edit form */}
      <AnimatePresence>
        {editRecord && (
          <RecordForm
            type={type} studentId={studentId} config={config}
            initial={editRecord}
            onClose={() => setEditRecord(null)}
            onSaved={() => setEditRecord(null)}
          />
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between gap-4"
          >
            <div>
              <p className="text-sm font-medium text-red-700">Delete this record?</p>
              <p className="text-xs text-red-500 mt-0.5">"{deleteTarget.title}" — this cannot be undone.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => deleteRecord(deleteTarget.id)}
                disabled={deleting}
                className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
              <button onClick={() => setDeleteTarget(null)} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5">Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Records list */}
      {records.length === 0 ? (
        <Empty config={config} />
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {records.map(record => (
              <RecordCard
                key={record.id ?? record._id}
                record={record}
                config={config}
                canEdit={canEdit}
                canVerify={canVerify}
                isAdmin={isAdmin}
                onEdit={setEditRecord}
                onDelete={setDeleteTarget}
                onVerify={(r, status, notes) => verifyRecord({ id: r.id, status, notes })}
                isVerifying={verifyingId === record.id}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
