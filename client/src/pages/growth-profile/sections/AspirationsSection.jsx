/* ============================================================
   AspirationsSection — Upsert pattern, one doc per student.
   Students can self-edit; staff can edit on behalf.
   ============================================================ */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Edit2, Save, X, Loader2, Plus, Compass } from 'lucide-react';
import { growthProfile as gpApi } from '@/api/client.js';

function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-slate-100 rounded ${className}`} />;
}

function iCls() {
  return 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 placeholder-slate-400 transition';
}

/* ── Tag input component ─────────────────────────────────────── */
function TagInput({ label, items = [], onChange, placeholder, max = 5 }) {
  const [input, setInput] = useState('');

  function add() {
    const v = input.trim();
    if (!v || items.includes(v) || items.length >= max) return;
    onChange([...items, v]);
    setInput('');
  }

  function remove(idx) { onChange(items.filter((_, i) => i !== idx)); }

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1.5">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
        {items.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-xs font-medium bg-slate-100 text-slate-700 px-2 py-1 rounded-lg">
            {item}
            <button type="button" onClick={() => remove(i)} className="text-slate-400 hover:text-red-500 transition"><X size={9} /></button>
          </span>
        ))}
      </div>
      {items.length < max && (
        <div className="flex gap-2">
          <input
            className={`${iCls()} flex-1`}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            placeholder={placeholder}
          />
          <button type="button" onClick={add} className="shrink-0 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-2 transition">
            <Plus size={13} />
          </button>
        </div>
      )}
      {items.length >= max && <p className="text-[11px] text-slate-400 mt-1">Maximum {max} items reached</p>}
    </div>
  );
}

export default function AspirationsSection({ studentId, canEdit }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm]       = useState({
    careerInterests: [], universityAspirations: [], intendedCourses: [],
    targetCountries: [], personalStatement: '', futureGoals: '',
  });
  const [error, setError] = useState(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['growth-aspirations', studentId],
    queryFn:  () => gpApi.aspirations.get(studentId),
    enabled:  !!studentId,
    staleTime: 5 * 60_000,
  });

  const aspirations = data?.data ?? {};

  // Sync form with loaded data when entering edit mode
  useEffect(() => {
    if (editing) {
      setForm({
        careerInterests:       aspirations.careerInterests       ?? [],
        universityAspirations: aspirations.universityAspirations ?? [],
        intendedCourses:       aspirations.intendedCourses        ?? [],
        targetCountries:       aspirations.targetCountries        ?? [],
        personalStatement:     aspirations.personalStatement      ?? '',
        futureGoals:           aspirations.futureGoals            ?? '',
      });
    }
  }, [editing]);

  const { mutate, isPending } = useMutation({
    mutationFn: (data) => gpApi.aspirations.upsert(studentId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['growth-aspirations', studentId] });
      qc.invalidateQueries({ queryKey: ['growth-profile', studentId] });
      setEditing(false);
      setError(null);
    },
    onError: (e) => setError(e.message ?? 'Failed to save'),
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  if (isLoading) return <div className="space-y-3"><Skeleton className="h-48 rounded-xl" /></div>;

  const hasData = aspirations.careerInterests?.length || aspirations.universityAspirations?.length ||
    aspirations.personalStatement || aspirations.futureGoals;

  /* ── View mode ── */
  if (!editing) {
    return (
      <div className="space-y-4">
        {canEdit && (
          <div className="flex justify-end">
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 transition">
              <Edit2 size={13} /> {hasData ? 'Edit aspirations' : 'Add aspirations'}
            </button>
          </div>
        )}

        {!hasData ? (
          <div className="py-12 text-center">
            <Compass size={24} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm font-medium text-slate-600">No aspirations recorded yet</p>
            <p className="text-xs text-slate-400 mt-1">Career interests, university goals, and personal statement.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {aspirations.careerInterests?.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Career Interests</p>
                <div className="flex flex-wrap gap-2">
                  {aspirations.careerInterests.map((c, i) => (
                    <span key={i} className="text-xs font-medium bg-violet-50 text-violet-700 px-2.5 py-1 rounded-lg">{c}</span>
                  ))}
                </div>
              </div>
            )}

            {aspirations.universityAspirations?.length > 0 && (
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">University Aspirations</p>
                <div className="flex flex-wrap gap-2">
                  {aspirations.universityAspirations.map((u, i) => (
                    <span key={i} className="text-xs font-medium bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg">{u}</span>
                  ))}
                </div>
              </div>
            )}

            {(aspirations.intendedCourses?.length > 0 || aspirations.targetCountries?.length > 0) && (
              <div className="grid grid-cols-2 gap-4">
                {aspirations.intendedCourses?.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Intended Courses</p>
                    <div className="flex flex-wrap gap-1.5">
                      {aspirations.intendedCourses.map((c, i) => <span key={i} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{c}</span>)}
                    </div>
                  </div>
                )}
                {aspirations.targetCountries?.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Target Countries</p>
                    <div className="flex flex-wrap gap-1.5">
                      {aspirations.targetCountries.map((c, i) => <span key={i} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{c}</span>)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {aspirations.personalStatement && (
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Personal Statement</p>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{aspirations.personalStatement}</p>
              </div>
            )}

            {aspirations.futureGoals && (
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Future Goals</p>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{aspirations.futureGoals}</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  /* ── Edit mode ── */
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
      {error && <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Career & University</h4>

        <TagInput label="Career interests" items={form.careerInterests} onChange={v => set('careerInterests', v)} placeholder="e.g. Medicine, Engineering…" max={10} />
        <TagInput label="University aspirations" items={form.universityAspirations} onChange={v => set('universityAspirations', v)} placeholder="e.g. University of Nairobi…" max={5} />
        <TagInput label="Intended courses / programmes" items={form.intendedCourses} onChange={v => set('intendedCourses', v)} placeholder="e.g. Computer Science, Law…" max={5} />
        <TagInput label="Target countries" items={form.targetCountries} onChange={v => set('targetCountries', v)} placeholder="e.g. Kenya, UK, USA…" max={5} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Personal Statement & Goals</h4>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Personal statement</label>
          <textarea rows={6} className={`${iCls()} resize-none`} value={form.personalStatement} onChange={e => set('personalStatement', e.target.value)} placeholder="Describe who you are, your values, and what drives you…" maxLength={4000} />
          <p className="text-[11px] text-slate-400 mt-1">{(form.personalStatement ?? '').length}/4000</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Future goals</label>
          <textarea rows={4} className={`${iCls()} resize-none`} value={form.futureGoals} onChange={e => set('futureGoals', e.target.value)} placeholder="Where do you see yourself in 5–10 years?" maxLength={2000} />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => mutate(form)} disabled={isPending} className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition">
          {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {isPending ? 'Saving…' : 'Save aspirations'}
        </button>
        <button onClick={() => { setEditing(false); setError(null); }} disabled={isPending} className="text-sm text-slate-500 hover:text-slate-700 px-3 py-2">Cancel</button>
      </div>
    </motion.div>
  );
}
