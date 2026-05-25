/* ============================================================
   CurriculumTab — Assign subjects to a class curriculum.

   Flow:
     1. Pick a class from the selector
     2. Left panel: available subjects (filtered by section compatibility,
        coloured by in/out-of-curriculum state)
     3. Right panel: class curriculum (subjects already assigned)
        — toggle compulsory flag inline
        — remove subject (guarded if students enrolled)
     4. Add subject: click in left panel or use bulk-assign button
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, Plus, X, Lock, ToggleLeft, ToggleRight, ChevronDown, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import {
  classes        as classesApi,
  subjects       as subsApi,
  classSubjects  as csApi,
  departments    as deptsApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

/* ── helpers ─────────────────────────────────────────────── */
const SECTION_LABELS = { kg: 'KG', primary: 'Primary', secondary: 'Secondary', alevel: 'A-Level', all: 'All' };
const SECTION_BADGE  = {
  primary:   'bg-blue-100 text-blue-700',
  secondary: 'bg-violet-100 text-violet-700',
  alevel:    'bg-amber-100 text-amber-700',
  all:       'bg-slate-100 text-slate-600',
  kg:        'bg-pink-100 text-pink-700',
};

function sectionCompatible(subject, sectionKey) {
  if (!subject.sections?.length) return true;
  if (subject.sections.includes('all')) return true;
  return subject.sections.includes(sectionKey);
}

function canEdit(role) {
  return ['superadmin','admin','deputy','timetabler'].includes(role);
}

/* ── Small subject chip ─────────────────────────────────── */
function SubjectChip({ subject, inCurriculum, isCompulsory, classSubjectId, onAdd, onRemove, onToggleCompulsory, adding, removing, toggling }) {
  return (
    <div className={clsx(
      'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 transition group',
      inCurriculum
        ? 'bg-violet-50 border-violet-200 hover:bg-violet-100'
        : 'bg-white border-slate-200 hover:border-violet-300',
    )}>
      {/* colour dot */}
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: subject.color ?? subject.department?.color ?? '#6366F1' }} />

      {/* name + code */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={clsx('text-sm font-medium truncate', inCurriculum ? 'text-violet-900' : 'text-slate-800')}>{subject.name}</span>
          <span className="text-[10px] font-mono text-slate-400 shrink-0">{subject.code}</span>
          {inCurriculum && isCompulsory && (
            <span className="shrink-0 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">Compulsory</span>
          )}
        </div>
        <p className="text-[11px] text-slate-400">{subject.department?.name ?? ''}</p>
      </div>

      {/* actions */}
      {inCurriculum ? (
        <div className="flex items-center gap-1 shrink-0">
          {/* toggle compulsory */}
          <button
            onClick={() => onToggleCompulsory(classSubjectId, !isCompulsory)}
            disabled={toggling === classSubjectId}
            title={isCompulsory ? 'Mark as elective' : 'Mark as compulsory'}
            className="p-1 rounded text-slate-400 hover:text-green-600 hover:bg-green-50 transition disabled:opacity-40"
          >
            {toggling === classSubjectId
              ? <Loader2 size={13} className="animate-spin" />
              : isCompulsory ? <ToggleRight size={14} className="text-green-600" /> : <ToggleLeft size={14} />
            }
          </button>
          {/* remove */}
          <button
            onClick={() => onRemove(classSubjectId)}
            disabled={removing === classSubjectId}
            title="Remove from curriculum"
            className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition disabled:opacity-40"
          >
            {removing === classSubjectId ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
          </button>
        </div>
      ) : (
        <button
          onClick={() => onAdd(subject.id)}
          disabled={adding === subject.id}
          title="Add to curriculum"
          className="shrink-0 flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-50 transition font-medium"
        >
          {adding === subject.id ? <Loader2 size={12} className="animate-spin" /> : <><Plus size={11} />Add</>}
        </button>
      )}
    </div>
  );
}

/* ── Main tab ─────────────────────────────────────────────── */
export default function CurriculumTab({ flash }) {
  const role     = useAuthStore(s => s.session?.user?.role ?? '');
  const editable = canEdit(role);
  const qc       = useQueryClient();

  const [classId,  setClassId]  = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [adding,   setAdding]   = useState(null);  // subjectId being added
  const [removing, setRemoving] = useState(null);  // classSubjectId being removed
  const [toggling, setToggling] = useState(null);  // classSubjectId being toggled

  /* ── queries ─────────────────────────────────────────────── */
  const { data: classes = [], isLoading: classesLoading } = useQuery({
    queryKey: ['classes'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    select:   r => (r?.data ?? (Array.isArray(r) ? r : [])).sort((a,b) => (a.order ?? 0) - (b.order ?? 0)),
    staleTime: 60_000,
  });

  // All subjects with curriculum state attached (?withClassCurriculum=classId)
  const { data: subjects = [], isLoading: subsLoading } = useQuery({
    queryKey: ['subjects-with-curriculum', classId],
    queryFn:  () => subsApi.list({ withClassCurriculum: classId }),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    enabled:  !!classId,
    staleTime: 0,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => deptsApi.list(),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    staleTime: 60_000,
  });

  const selectedClass   = classes.find(c => c.id === classId);
  const sectionKey      = selectedClass?.sectionKey ?? '';

  /* Compatible subjects for this class (filtered by sectionKey) */
  const compatible = subjects.filter(s => sectionCompatible(s, sectionKey));

  /* Split into in-curriculum and available */
  const inCurriculum = compatible.filter(s => s.inCurriculum);
  const available    = compatible.filter(s => !s.inCurriculum);

  /* Dept filter */
  const depts = departments;
  const filteredAvailable = deptFilter === 'all'
    ? available
    : available.filter(s => s.departmentId === deptFilter);

  /* ── actions ─────────────────────────────────────────────── */
  async function handleAdd(subjectId) {
    setAdding(subjectId);
    try {
      await csApi.assign({ classId, subjectId, isCompulsoryForClass: false });
      qc.invalidateQueries({ queryKey: ['subjects-with-curriculum', classId] });
      flash('Subject added to curriculum');
    } catch (err) {
      flash(err.extra?.error || err.message || 'Failed to add subject', 'error');
    } finally { setAdding(null); }
  }

  async function handleRemove(classSubjectId) {
    setRemoving(classSubjectId);
    try {
      await csApi.remove(classSubjectId);
      qc.invalidateQueries({ queryKey: ['subjects-with-curriculum', classId] });
      flash('Subject removed from curriculum');
    } catch (err) {
      flash(err.extra?.error || err.message || 'Cannot remove — students may still be enrolled', 'error');
    } finally { setRemoving(null); }
  }

  async function handleToggleCompulsory(classSubjectId, newValue) {
    setToggling(classSubjectId);
    try {
      await csApi.update(classSubjectId, { isCompulsoryForClass: newValue });
      qc.invalidateQueries({ queryKey: ['subjects-with-curriculum', classId] });
    } catch (err) {
      flash(err.extra?.error || err.message || 'Update failed', 'error');
    } finally { setToggling(null); }
  }

  async function handleBulkAddSection() {
    // Add all compatible subjects not yet in curriculum
    if (available.length === 0) return;
    try {
      await csApi.bulk({ classId, subjects: available.map(s => ({ subjectId: s.id, isCompulsoryForClass: false })) });
      qc.invalidateQueries({ queryKey: ['subjects-with-curriculum', classId] });
      flash(`Added ${available.length} subject${available.length !== 1 ? 's' : ''} to curriculum`);
    } catch (err) {
      flash(err.extra?.error || err.message || 'Bulk add failed', 'error');
    }
  }

  /* ── group by section for class selector ──────────────────── */
  const classBySection = classes.reduce((acc, c) => {
    const key = c.sectionKey ?? 'other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(c);
    return acc;
  }, {});

  const sectionOrder = ['kg','primary','secondary','alevel','other'];

  /* ── render ─────────────────────────────────────────────── */
  return (
    <div className="px-6 py-5">

      {/* Class selector */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative">
          <BookOpen size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <select
            value={classId}
            onChange={e => { setClassId(e.target.value); setDeptFilter('all'); }}
            className="pl-9 pr-8 py-2 rounded-lg border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 min-w-[200px]"
          >
            <option value="">Select a class…</option>
            {sectionOrder.map(sec => {
              const group = classBySection[sec];
              if (!group?.length) return null;
              return (
                <optgroup key={sec} label={SECTION_LABELS[sec] ?? sec}>
                  {group.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              );
            })}
          </select>
        </div>

        {selectedClass && (
          <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-medium', SECTION_BADGE[sectionKey] ?? 'bg-slate-100 text-slate-600')}>
            {SECTION_LABELS[sectionKey] ?? sectionKey}
          </span>
        )}

        {selectedClass && (
          <span className="text-sm text-slate-500">
            <strong className="text-slate-800">{inCurriculum.length}</strong> in curriculum ·{' '}
            <strong className="text-slate-800">{available.length}</strong> available to add
          </span>
        )}
      </div>

      {/* Placeholder when no class selected */}
      {!classId && (
        <div className="rounded-xl border-2 border-dashed border-slate-200 py-20 text-center">
          <BookOpen size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500 font-medium">Select a class to manage its curriculum</p>
          <p className="text-xs text-slate-400 mt-1">Choose a class from the dropdown above to see and assign subjects</p>
        </div>
      )}

      {/* Loading */}
      {classId && subsLoading && (
        <div className="py-16 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin" />Loading…
        </div>
      )}

      {/* Two-column layout: curriculum (left) + available (right) */}
      {classId && !subsLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Left: Class curriculum ──────────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{selectedClass?.name} Curriculum</h2>
                <p className="text-xs text-slate-500 mt-0.5">{inCurriculum.length} subject{inCurriculum.length !== 1 ? 's' : ''} assigned</p>
              </div>
            </div>

            {inCurriculum.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
                <p className="text-sm text-slate-400">No subjects in this class curriculum yet.</p>
                <p className="text-xs text-slate-400 mt-1">Add subjects from the panel on the right.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {inCurriculum.map(s => (
                  <SubjectChip
                    key={s.id}
                    subject={s}
                    inCurriculum={true}
                    isCompulsory={s.isCompulsoryForClass}
                    classSubjectId={s.classSubjectId}
                    onAdd={handleAdd}
                    onRemove={editable ? handleRemove : () => {}}
                    onToggleCompulsory={editable ? handleToggleCompulsory : () => {}}
                    adding={adding}
                    removing={removing}
                    toggling={toggling}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Right: Available subjects ───────────────────── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Available Subjects</h2>
                <p className="text-xs text-slate-500 mt-0.5">{available.length} compatible with {SECTION_LABELS[sectionKey] ?? sectionKey}</p>
              </div>
              {editable && available.length > 0 && (
                <button onClick={handleBulkAddSection}
                  className="text-xs text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1 hover:underline">
                  <Plus size={12} />Add all
                </button>
              )}
            </div>

            {/* Dept filter pills */}
            {depts.length > 0 && available.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                <button onClick={() => setDeptFilter('all')}
                  className={clsx('rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition',
                    deptFilter === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500')}>
                  All
                </button>
                {depts.filter(d => available.some(s => s.departmentId === d.id)).map(d => (
                  <button key={d.id} onClick={() => setDeptFilter(d.id)}
                    className={clsx('rounded-full px-2.5 py-0.5 text-[11px] font-medium border transition',
                      deptFilter === d.id ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500')}
                    style={deptFilter === d.id ? { backgroundColor: d.color ?? '#6366F1', borderColor: d.color ?? '#6366F1' } : {}}>
                    {d.code}
                  </button>
                ))}
              </div>
            )}

            {available.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 py-12 text-center">
                <Check size={24} className="mx-auto text-green-400 mb-2" />
                <p className="text-sm text-slate-400">All compatible subjects are in the curriculum!</p>
              </div>
            ) : filteredAvailable.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">No subjects in this department available to add.</p>
            ) : (
              <div className="space-y-1.5">
                {filteredAvailable.map(s => (
                  <SubjectChip
                    key={s.id}
                    subject={s}
                    inCurriculum={false}
                    isCompulsory={false}
                    classSubjectId={null}
                    onAdd={editable ? handleAdd : () => {}}
                    onRemove={() => {}}
                    onToggleCompulsory={() => {}}
                    adding={adding}
                    removing={removing}
                    toggling={toggling}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Read-only notice */}
      {classId && !editable && (
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <Lock size={12} />
          <span>You have read-only access to the curriculum. Contact an administrator to make changes.</span>
        </div>
      )}
    </div>
  );
}
