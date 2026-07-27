/* ============================================================
   FeeStructureSlideOver — slide-over to create a fee structure
   Default export: FeeStructureSlideOver    (the slide-over)
   Named export:   CreateFeeStructureButton (header button + portal)
   ============================================================ */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Loader2, CheckCircle2, AlertTriangle, Search } from 'lucide-react';
import { finance as financeApi, classes as classesApi, students as studentsApi } from '@/api/client.js';
import { useSections } from '@/hooks/useSections.js';
import useAuthStore from '@/store/auth.js';

const SCOPE_OPTIONS = [
  { id: 'all',      label: 'All active students' },
  { id: 'classes',  label: 'Specific classes' },
  { id: 'sections', label: 'Specific sections' },
  { id: 'students', label: 'Specific students' },
];

/* ── Header button ─────────────────────────────────────────── */
export function CreateFeeStructureButton({ fmtCurrency }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        <Plus size={15} /> New Fee Structure
      </button>
      <AnimatePresence>
        {open && (
          <FeeStructureSlideOver
            fmtCurrency={fmtCurrency}
            onClose={() => setOpen(false)}
            onCreated={() => { setOpen(false); qc.invalidateQueries({ queryKey: ['finance', 'fee-structures'] }); }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/* ── Slide-over ────────────────────────────────────────────── */
export default function FeeStructureSlideOver({ fmtCurrency, onClose, onCreated }) {
  const school       = useAuthStore(s => s.session?.school);
  const schoolYear   = school?.academicYear ?? new Date().getFullYear().toString();
  const termsPerYear = school?.termsPerYear ?? 3;

  const [name,    setName]    = useState('');
  const [desc,    setDesc]    = useState('');
  const [year,    setYear]    = useState(schoolYear);
  const [term,    setTerm]    = useState('');
  const [dueDate, setDueDate] = useState('');
  const [items,   setItems]   = useState([{ description: 'Tuition Fee', quantity: 1, unitPrice: 0, feeType: '' }]);
  const [errors,  setErrors]  = useState({});

  const [scopeType,  setScopeType]  = useState('all');
  const [classIds,   setClassIds]   = useState([]);
  const [sectionIds, setSectionIds] = useState([]);
  const [studentIds, setStudentIds] = useState([]);       // selected {id, name}
  const [studentSearch, setStudentSearch] = useState('');

  const { data: feeCfgData } = useQuery({
    queryKey: ['finance', 'fee-config'],
    queryFn:  () => financeApi.feeConfig.get(),
  });
  const feeTypeOptions = feeCfgData?.data?.feeTypes ?? [];

  const { data: classesData } = useQuery({
    queryKey: ['classes', 'for-fee-structure'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    enabled:  scopeType === 'classes',
  });
  const classList = classesData?.data ?? classesData?.classes ?? [];

  const { sections } = useSections();

  const { data: stuData } = useQuery({
    queryKey: ['students', 'search-feestr', studentSearch],
    queryFn:  () => studentsApi.list({ search: studentSearch, limit: 10, status: 'active' }),
    enabled:  scopeType === 'students' && studentSearch.length > 1,
  });
  const stuResults = (stuData?.data ?? []).filter(s => !studentIds.some(sel => sel.id === (s.id ?? s._id)));

  const total = items.reduce((s, i) => s + (i.unitPrice || 0) * (i.quantity || 1), 0);

  const mutation = useMutation({
    mutationFn: data => financeApi.feeStructures.create(data),
    onSuccess:  onCreated,
    onError:    err => setErrors({ _server: err?.message ?? 'Failed to create fee structure' }),
  });

  function updateItem(i, field, val) {
    setItems(prev => prev.map((item, idx) =>
      idx === i ? { ...item, [field]: (field === 'description' || field === 'feeType') ? val : Number(val) } : item
    ));
  }
  function addItem()     { setItems(prev => [...prev, { description: '', quantity: 1, unitPrice: 0, feeType: '' }]); }
  function removeItem(i) { setItems(prev => prev.filter((_, idx) => idx !== i)); }

  function toggleClass(id)   { setClassIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); }
  function toggleSection(id) { setSectionIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]); }
  function addStudent(s)     { setStudentIds(prev => [...prev, { id: s.id ?? s._id, name: `${s.firstName} ${s.lastName}` }]); setStudentSearch(''); }
  function removeStudent(id) { setStudentIds(prev => prev.filter(s => s.id !== id)); }

  function submit() {
    const e = {};
    if (!name.trim()) e.name = 'Name is required';
    if (!items.every(i => i.description.trim())) e.items = 'All line items need a description';
    if (scopeType === 'classes'  && classIds.length === 0)   e.scope = 'Select at least one class';
    if (scopeType === 'sections' && sectionIds.length === 0) e.scope = 'Select at least one section';
    if (scopeType === 'students' && studentIds.length === 0) e.scope = 'Select at least one student';
    if (Object.keys(e).length) { setErrors(e); return; }
    mutation.mutate({
      name: name.trim(),
      description: desc.trim() || undefined,
      academicYear: year || undefined,
      term: term ? Number(term) : undefined,
      dueDate: dueDate || undefined,
      lineItems: items.map(i => ({ ...i, feeType: i.feeType || undefined })),
      scopeType,
      classIds:   scopeType === 'classes'  ? classIds : undefined,
      sectionIds: scopeType === 'sections' ? sectionIds : undefined,
      studentIds: scopeType === 'students' ? studentIds.map(s => s.id) : undefined,
    });
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">New Fee Structure</h2>
            <p className="text-xs text-slate-400 mt-0.5">Define fees for a term/year — bulk generate invoices later</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={15} className="shrink-0" />{errors._server}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Structure Name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Term 2 2025 — Full Fee"
              className={`w-full text-sm px-3 py-2 border ${errors.name ? 'border-red-300' : 'border-slate-200'} rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10`}
            />
            {errors.name && <p className="text-[11px] text-red-500 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Description (optional)</label>
            <input
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Brief description…"
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Academic Year</label>
              <input
                value={year}
                onChange={e => setYear(e.target.value)}
                placeholder="2025"
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Term</label>
              <select
                value={term}
                onChange={e => setTerm(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              >
                <option value="">All terms</option>
                {Array.from({ length: termsPerYear }, (_, i) => (
                  <option key={i + 1} value={i + 1}>Term {i + 1}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Due Date</label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
          </div>

          {/* Applies To — scope */}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Applies To</label>
            <div className="flex flex-wrap gap-1.5">
              {SCOPE_OPTIONS.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setScopeType(opt.id)}
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold border transition-colors ${
                    scopeType === opt.id ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {errors.scope && <p className="text-[11px] text-red-500 mt-1.5">{errors.scope}</p>}

            {scopeType === 'classes' && (
              <div className="mt-2.5 flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                {classList.length === 0 && <p className="text-xs text-slate-400">No classes found.</p>}
                {classList.map(c => (
                  <button key={c.id} type="button" onClick={() => toggleClass(c.id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border ${classIds.includes(c.id) ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500'}`}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}

            {scopeType === 'sections' && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {sections.filter(s => s.key).map(s => (
                  <button key={s.key} type="button" onClick={() => toggleSection(s.key)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold border ${sectionIds.includes(s.key) ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500'}`}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {scopeType === 'students' && (
              <div className="mt-2.5 space-y-2">
                <div className="relative">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={studentSearch}
                    onChange={e => setStudentSearch(e.target.value)}
                    placeholder="Search students by name…"
                    className="w-full text-sm pl-8 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                  {studentSearch.length > 1 && stuResults.length > 0 && (
                    <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                      {stuResults.map(s => (
                        <button key={s.id ?? s._id} type="button" onClick={() => addStudent(s)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                          {s.firstName} {s.lastName}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {studentIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {studentIds.map(s => (
                      <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                        {s.name}
                        <button type="button" onClick={() => removeStudent(s.id)} className="text-slate-400 hover:text-red-500"><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Fee line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-700">Fee Items *</label>
              <button type="button" onClick={addItem} className="text-xs font-medium text-violet-600 hover:text-violet-800 flex items-center gap-1">
                <Plus size={12} /> Add item
              </button>
            </div>
            {errors.items && <p className="text-[11px] text-red-500 mb-2">{errors.items}</p>}
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={item.description}
                    onChange={e => updateItem(i, 'description', e.target.value)}
                    placeholder="e.g. Tuition Fee"
                    className="flex-1 text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                  {feeTypeOptions.length > 0 && (
                    <select
                      value={item.feeType}
                      onChange={e => updateItem(i, 'feeType', e.target.value)}
                      className="w-32 text-sm px-2 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-600"
                    >
                      <option value="">Fee type…</option>
                      {feeTypeOptions.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </select>
                  )}
                  <input
                    type="number" min="1"
                    value={item.quantity}
                    onChange={e => updateItem(i, 'quantity', e.target.value)}
                    className="w-14 text-sm px-2 py-2 border border-slate-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                  <input
                    type="number" min="0"
                    value={item.unitPrice}
                    onChange={e => updateItem(i, 'unitPrice', e.target.value)}
                    placeholder="Amount"
                    className="w-28 text-sm px-3 py-2 border border-slate-200 rounded-lg text-right focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                  {items.length > 1 && (
                    <button onClick={() => removeItem(i)} className="text-slate-400 hover:text-red-500 p-1"><X size={14} /></button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3 pt-3 border-t border-slate-100">
              <div className="text-sm font-bold text-slate-800">Total per student: {fmtCurrency(total)}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={submit}
            disabled={mutation.isPending}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {mutation.isPending ? 'Saving…' : 'Save Fee Structure'}
          </button>
        </div>
      </motion.div>
    </>
  );
}
