/* ============================================================
   LessonsPage — Syllabus / Lesson Coverage Tracker  (v4.33.0)

   Views:
   • Teacher  — "My Classes" cards  → topic drill-down
   • Admin    — "Overview" grid     (all teachers × classes)
   • HOD      — same as admin, filtered to their department

   Design pillars:
   • Topics are shared per subject (all teachers see the same list)
   • Coverage is per class — co-teachers share the coverage pool
   • Subtopics: when a topic has subtopics, tick each one;
     all subtopics done = topic auto-completes.
   ============================================================ */
import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookCheck, ChevronRight, ChevronDown, Check, Plus, X,
  Loader2, AlertTriangle, Pencil, Trash2, Search, GraduationCap,
  Users, Copy, BarChart3, ArrowLeft, BookOpen, Circle,
  CheckCircle2, MinusCircle, NotebookPen, Printer, Calendar, Settings,
} from 'lucide-react';
import { lessons as lessonsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

/* ── Role helpers ────────────────────────────────────────────── */
function useRole() {
  const session = useAuthStore(s => s.session);
  const role    = session?.user?.role ?? '';
  const roles   = session?.user?.roles ?? [];
  const extra   = session?.user?.extraRoles ?? [];
  const all     = new Set([role, ...roles, ...extra]);
  const isAdmin = all.has('admin') || all.has('superadmin') || all.has('principal') || all.has('deputy') || all.has('deputy_principal')
    || all.has('acting_deputy') || all.has('head_of_school'); // extraRoles responsibility tags — see server/config/staffResponsibilities.js
  const isHod   = all.has('hod') || all.has('section_head');
  const isTeacher = all.has('teacher') || isHod;
  return { isAdmin, isHod, isTeacher, all };
}

/* ── Progress ring component ─────────────────────────────────── */
function ProgressRing({ pct, size = 64, stroke = 5, className = '' }) {
  const r  = (size - stroke) / 2;
  const c  = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#6366f1';
  return (
    <svg width={size} height={size} className={`-rotate-90 ${className}`}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset .4s ease' }}
      />
    </svg>
  );
}

/* ── Class-Subject[-Stream] card ──────────────────────────────── */
function ClassCard({ item, onClick }) {
  const { pct, className, streamName, subjectName, coveredItems, totalItems } = item;
  const color = pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-indigo-600';
  return (
    <button
      onClick={onClick}
      className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all text-left group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide truncate">
            {className}{streamName ? ` · ${streamName}` : ''}
          </p>
          <h3 className="text-sm font-semibold text-slate-800 mt-0.5 truncate">{subjectName}</h3>
          <p className="text-xs text-slate-400 mt-1">{coveredItems} of {totalItems} items covered</p>
        </div>
        <div className="relative shrink-0">
          <ProgressRing pct={pct} size={60} stroke={5} />
          <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold rotate-90 ${color}`}>
            {pct}%
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 mt-3 text-xs text-slate-400 group-hover:text-indigo-600 transition-colors">
        View topics <ChevronRight size={12} />
      </div>
    </button>
  );
}

/* ── Add / Edit Topic slide-over ─────────────────────────────── */
function TopicSlideOver({ subjectId, subjectName, academicYear, existing, onClose, onSaved }) {
  const qc = useQueryClient();
  const [title,       setTitle]       = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [subtopics,   setSubtopics]   = useState(
    existing?.subtopics?.length ? existing.subtopics.map(s => s.title) : ['']
  );
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: existing
      ? (data) => lessonsApi.topics.update(existing.id, data)
      : (data) => lessonsApi.topics.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lessons', 'coverage'] });
      qc.invalidateQueries({ queryKey: ['lessons', 'topics', subjectId] });
      onSaved();
    },
    onError: (err) => setError(err?.message ?? 'Failed to save topic'),
  });

  function submit() {
    if (!title.trim()) { setError('Topic title is required'); return; }
    const validSubs = subtopics.map(s => s.trim()).filter(Boolean);
    mutation.mutate({
      subjectId, subjectName, academicYear,
      title: title.trim(),
      description: description.trim() || undefined,
      subtopics: validSubs.map((t, i) => ({ title: t, order: i })),
    });
  }

  function updateSub(i, val) { setSubtopics(p => p.map((s, idx) => idx === i ? val : s)); }
  function addSub()          { setSubtopics(p => [...p, '']); }
  function removeSub(i)      { setSubtopics(p => p.filter((_, idx) => idx !== i)); }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{existing ? 'Edit Topic' : 'Add Topic'}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{subjectName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200">
              <AlertTriangle size={14} className="shrink-0" />{error}
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Topic Title *</label>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Forces and Motion"
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Description (optional)</label>
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              rows={2} placeholder="Brief description of this topic…"
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 resize-none"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-700">Subtopics</label>
              <button type="button" onClick={addSub} className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                <Plus size={11} /> Add subtopic
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mb-2">Leave empty if this topic has no subtopics.</p>
            <div className="space-y-2">
              {subtopics.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={s} onChange={e => updateSub(i, e.target.value)}
                    placeholder={`Subtopic ${i + 1}`}
                    className="flex-1 text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                  {subtopics.length > 1 && (
                    <button onClick={() => removeSub(i)} className="text-slate-300 hover:text-red-500 p-1"><X size={13} /></button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={submit} disabled={mutation.isPending}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {mutation.isPending ? 'Saving…' : (existing ? 'Update Topic' : 'Add Topic')}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── Topic row ───────────────────────────────────────────────── */
function TopicRow({ topic, classId, streamId, subjectId, academicYear, canManage, onEdit, onDelete }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const hasSubs = topic.subtopics?.length > 0;
  const allDone = topic.covered;
  const partial = topic.partial;

  const markMutation = useMutation({
    mutationFn: ({ topicId, subtopicId }) => lessonsApi.coverage.mark({
      classId, ...(streamId ? { streamId } : {}), subjectId, topicId, subtopicId, academicYear,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lessons', 'coverage', classId, subjectId, streamId ?? ''] }),
  });

  const unmarkMutation = useMutation({
    mutationFn: ({ coverageId, topicId, subtopicId }) => {
      if (coverageId) return lessonsApi.coverage.unmark(coverageId);
      return lessonsApi.coverage.unmarkBulk({ classId, ...(streamId ? { streamId } : {}), subjectId, topicId, subtopicId });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lessons', 'coverage', classId, subjectId, streamId ?? ''] }),
  });

  function toggleTopic() {
    if (allDone) {
      unmarkMutation.mutate({ topicId: topic.id });
    } else {
      if (hasSubs) {
        // Mark all subtopics at once
        topic.subtopics.filter(s => !s.covered).forEach(st => {
          markMutation.mutate({ topicId: topic.id, subtopicId: st.id });
        });
      } else {
        markMutation.mutate({ topicId: topic.id });
      }
    }
  }

  function toggleSubtopic(st) {
    if (st.covered) {
      unmarkMutation.mutate({ coverageId: st.coverage?.id, topicId: topic.id, subtopicId: st.id });
    } else {
      markMutation.mutate({ topicId: topic.id, subtopicId: st.id });
    }
  }

  const isBusy = markMutation.isPending || unmarkMutation.isPending;

  const iconClass = allDone
    ? 'text-emerald-500'
    : partial ? 'text-amber-400' : 'text-slate-300';

  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3 bg-white hover:bg-slate-50/50 transition-colors">
        {/* Check / partial indicator */}
        <button
          onClick={toggleTopic}
          disabled={isBusy}
          className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all
            ${allDone ? 'border-emerald-500 bg-emerald-500' : partial ? 'border-amber-400 bg-amber-50' : 'border-slate-200 hover:border-indigo-400'}`}
        >
          {isBusy ? (
            <Loader2 size={12} className="animate-spin text-slate-400" />
          ) : allDone ? (
            <Check size={12} className="text-white" strokeWidth={3} />
          ) : partial ? (
            <MinusCircle size={14} className="text-amber-400" />
          ) : null}
        </button>

        <div className="flex-1 min-w-0">
          <span className={`text-sm font-medium ${allDone ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
            {topic.title}
          </span>
          {topic.description && (
            <p className="text-xs text-slate-400 mt-0.5 truncate">{topic.description}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {hasSubs && (
            <span className="text-[11px] text-slate-400 px-1.5 py-0.5 bg-slate-100 rounded-md">
              {topic.subtopics.filter(s => s.covered).length}/{topic.subtopics.length}
            </span>
          )}
          {canManage && (
            <>
              <button onClick={() => onEdit(topic)} className="p-1 text-slate-300 hover:text-indigo-500 rounded"><Pencil size={13} /></button>
              <button onClick={() => onDelete(topic)} className="p-1 text-slate-300 hover:text-red-500 rounded"><Trash2 size={13} /></button>
            </>
          )}
          {hasSubs && (
            <button onClick={() => setOpen(!open)} className="p-1 text-slate-400 hover:text-slate-600">
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
        </div>
      </div>

      {hasSubs && open && (
        <div className="border-t border-slate-100 divide-y divide-slate-50 bg-slate-50/30">
          {topic.subtopics.map(st => (
            <div key={st.id} className="flex items-center gap-3 px-4 py-2.5 pl-12">
              <button
                onClick={() => toggleSubtopic(st)}
                disabled={isBusy}
                className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all
                  ${st.covered ? 'border-emerald-400 bg-emerald-400' : 'border-slate-200 hover:border-indigo-400'}`}
              >
                {st.covered && <Check size={10} className="text-white" strokeWidth={3} />}
              </button>
              <span className={`text-xs font-medium ${st.covered ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                {st.title}
              </span>
              {st.covered && st.coverage?.coveredAt && (
                <span className="text-[10px] text-slate-400 ml-auto">
                  {new Date(st.coverage.coveredAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Drill-down: topics for a class-subject ──────────────────── */
function DrillDown({ item, onBack, canManage }) {
  const { classId, streamId, streamName, subjectId, subjectName, className, academicYear } = item;
  const qc = useQueryClient();
  const [search,     setSearch]     = useState('');
  const [showSlider, setShowSlider] = useState(false);
  const [editing,    setEditing]    = useState(null);

  const { data: resp, isLoading } = useQuery({
    queryKey: ['lessons', 'coverage', classId, subjectId, streamId ?? ''],
    queryFn:  () => lessonsApi.coverage.list({ classId, subjectId, ...(streamId ? { streamId } : {}), academicYear }),
    staleTime: 30_000,
  });

  const topics = resp?.data?.topics ?? [];
  const filteredTopics = useMemo(() => {
    if (!search) return topics;
    const s = search.toLowerCase();
    return topics.filter(t =>
      t.title.toLowerCase().includes(s) ||
      (t.subtopics ?? []).some(st => st.title.toLowerCase().includes(s))
    );
  }, [topics, search]);

  const covered = topics.filter(t => t.covered).length;
  const partial = topics.filter(t => t.partial).length;
  const total   = topics.length;

  const deleteMutation = useMutation({
    mutationFn: (topic) => lessonsApi.topics.remove(topic.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lessons', 'coverage', classId, subjectId, streamId ?? ''] }),
  });

  return (
    <div className="space-y-4">
      {/* Back + header */}
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="mt-0.5 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">{subjectName}</h2>
            <span className="text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
              {className}{streamName ? ` · ${streamName}` : ''}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {covered} of {total} topic{total !== 1 ? 's' : ''} complete
            {partial > 0 ? `, ${partial} in progress` : ''}
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => { setEditing(null); setShowSlider(true); }}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-3 py-2 rounded-lg"
          >
            <Plus size={13} /> Add Topic
          </button>
        )}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="bg-white border border-slate-100 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-600">Curriculum Progress</span>
            <span className="text-xs font-semibold text-slate-700">{total > 0 ? Math.round((covered / total) * 100) : 0}%</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${total > 0 ? (covered / total) * 100 : 0}%` }}
            />
          </div>
          <div className="flex items-center gap-4 mt-2">
            <span className="flex items-center gap-1 text-[11px] text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />{covered} done</span>
            {partial > 0 && <span className="flex items-center gap-1 text-[11px] text-amber-600"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />{partial} in progress</span>}
            <span className="flex items-center gap-1 text-[11px] text-slate-400"><span className="w-2 h-2 rounded-full bg-slate-200 inline-block" />{total - covered - partial} not started</span>
          </div>
        </div>
      )}

      {/* Search */}
      {total > 4 && (
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search topics…"
            className="w-full text-sm pl-9 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
      )}

      {/* Topics list */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-indigo-400" size={24} /></div>
      ) : filteredTopics.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          {total === 0 ? (
            <>
              <BookOpen size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No topics yet</p>
              <p className="text-xs mt-1">Add topics to start tracking your lesson coverage.</p>
            </>
          ) : (
            <p className="text-sm">No topics matching "{search}"</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredTopics.map(t => (
            <TopicRow
              key={t.id}
              topic={t}
              classId={classId}
              streamId={streamId}
              subjectId={subjectId}
              academicYear={academicYear}
              canManage={canManage}
              onEdit={(topic) => { setEditing(topic); setShowSlider(true); }}
              onDelete={(topic) => { if (window.confirm(`Delete topic "${topic.title}"? This will also remove all coverage records for this topic.`)) deleteMutation.mutate(topic); }}
            />
          ))}
        </div>
      )}

      {showSlider && (
        <TopicSlideOver
          subjectId={subjectId}
          subjectName={subjectName}
          academicYear={academicYear}
          existing={editing}
          onClose={() => { setShowSlider(false); setEditing(null); }}
          onSaved={() => { setShowSlider(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

/* ── Teacher: My Classes tab ─────────────────────────────────── */
function MyClassesTab() {
  const { isAdmin, isHod } = useRole();
  const canManage = true; // teachers can always manage their own topics
  const [drilldown, setDrilldown] = useState(null);

  const { data: resp, isLoading } = useQuery({
    queryKey: ['lessons', 'my-classes'],
    queryFn:  () => lessonsApi.myClasses(),
    staleTime: 60_000,
  });

  const items = resp?.data ?? [];

  if (drilldown) {
    return (
      <DrillDown
        item={drilldown}
        onBack={() => setDrilldown(null)}
        canManage={canManage}
      />
    );
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-indigo-400" size={24} /></div>;
  }

  if (!items.length) {
    return (
      <div className="text-center py-16 text-slate-400">
        <GraduationCap size={36} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium">No teaching assignments found</p>
        <p className="text-xs mt-1">Contact your administrator to set up your teaching assignments.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-slate-500 mb-4">
        {items.length} class–subject assignment{items.length !== 1 ? 's' : ''}. Tap a card to update topic coverage.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(item => (
          <ClassCard
            key={`${item.classId}-${item.subjectId}-${item.streamId ?? ''}`}
            item={item}
            onClick={() => setDrilldown(item)}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Template settings (per-school field customization) ───────
   Configures which builtin fields are shown/required/how they're
   labeled, plus any extra custom fields a school wants — gated
   server-side by hasExplicitSubGrant on lessons__template, not plain
   lessons:update, so this tab is shown only to someone who actually
   holds that grant (or is floor). */
const GROUP_LABELS = { lesson: 'Lesson Content', differentiation: 'Differentiation', assessment: 'Assessment', homework: 'Homework', reflection: 'Reflection' };

function TemplateTab() {
  const qc = useQueryClient();
  const [fields, setFields] = useState(null); // null until loaded
  const [toast, setToast] = useState('');

  const { data: resp, isLoading } = useQuery({
    queryKey: ['lessons', 'template'],
    queryFn:  () => lessonsApi.template.get(),
    staleTime: 30_000,
  });
  useEffect(() => {
    if (fields === null && resp?.data?.fields) setFields(resp.data.fields);
  }, [resp, fields]);

  const mutation = useMutation({
    mutationFn: (data) => lessonsApi.template.update(data),
    onSuccess: (r) => {
      setFields(r?.data?.fields ?? []);
      qc.invalidateQueries({ queryKey: ['lessons', 'template'] });
      setToast('Template saved.');
      setTimeout(() => setToast(''), 2500);
    },
    onError: (err) => setToast(err?.message ?? 'Failed to save template'),
  });

  if (isLoading || fields === null) {
    return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-indigo-400" size={24} /></div>;
  }

  function updateField(key, patch) {
    setFields(prev => prev.map(f => f.key === key ? { ...f, ...patch } : f));
  }
  function removeCustomField(key) {
    setFields(prev => prev.filter(f => f.key !== key));
  }
  function addCustomField() {
    const key = `custom_${Date.now().toString(36)}`;
    setFields(prev => [...prev, { key, label: '', enabled: true, required: false, builtin: false, group: 'custom', order: prev.length }]);
  }

  const builtinGroups = ['lesson', 'differentiation', 'assessment', 'homework', 'reflection'];
  const customFields = fields.filter(f => !f.builtin);

  return (
    <div className="max-w-2xl space-y-6">
      <p className="text-xs text-slate-500">
        Choose which fields appear on the Lesson Plan form for every teacher at this school, relabel them, mark any as required, and add your own extra fields. Topic, Subtopic, Class, Stream, Subject, and Date are always required and can't be changed here.
      </p>

      {builtinGroups.map(group => {
        const groupFields = fields.filter(f => f.builtin && f.group === group);
        if (!groupFields.length) return null;
        return (
          <div key={group}>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{GROUP_LABELS[group]}</p>
            <div className="space-y-2">
              {groupFields.map(f => (
                <div key={f.key} className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2">
                  <input type="checkbox" checked={f.enabled} onChange={e => updateField(f.key, { enabled: e.target.checked })} className="rounded border-slate-300" />
                  <input
                    value={f.label} onChange={e => updateField(f.key, { label: e.target.value })}
                    disabled={!f.enabled}
                    className="flex-1 text-sm px-2 py-1 border border-slate-200 rounded-lg disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
                    <input type="checkbox" checked={f.required} disabled={!f.enabled} onChange={e => updateField(f.key, { required: e.target.checked })} className="rounded border-slate-300" />
                    Required
                  </label>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Custom Fields</p>
          <button onClick={addCustomField} className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
            <Plus size={13} /> Add Field
          </button>
        </div>
        {customFields.length === 0 ? (
          <p className="text-xs text-slate-400">No custom fields yet.</p>
        ) : (
          <div className="space-y-2">
            {customFields.map(f => (
              <div key={f.key} className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2">
                <input type="checkbox" checked={f.enabled} onChange={e => updateField(f.key, { enabled: e.target.checked })} className="rounded border-slate-300" />
                <input
                  value={f.label} onChange={e => updateField(f.key, { label: e.target.value })}
                  placeholder="Field label, e.g. Cross-curricular links"
                  className="flex-1 text-sm px-2 py-1 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                />
                <label className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
                  <input type="checkbox" checked={f.required} onChange={e => updateField(f.key, { required: e.target.checked })} className="rounded border-slate-300" />
                  Required
                </label>
                <button onClick={() => removeCustomField(f.key)} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50"><X size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && <p className="text-xs text-emerald-600">{toast}</p>}

      <div className="flex justify-end">
        <button
          onClick={() => {
            const invalid = fields.some(f => f.enabled && !f.label.trim());
            if (invalid) { setToast('Every enabled field needs a label.'); return; }
            mutation.mutate({ fields: fields.map((f, i) => ({ key: f.key, label: f.label.trim(), enabled: f.enabled, required: f.required, order: i })) });
          }}
          disabled={mutation.isPending}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          Save Template
        </button>
      </div>
    </div>
  );
}

/* ── Lesson Plan slide-over (create / edit) ───────────────────
   Topic/Subtopic are pickers sourced from this subject's existing
   syllabus_topics — never free text. A subject with no topics yet is
   blocked here with a direct pointer to Topics & Coverage, which is the
   whole mechanism behind "teachers must update topics before planning a
   lesson" (the server enforces the same thing independently — this is
   just the friendlier, earlier version of that same rule). */
function LessonPlanSlideOver({ classId, className, subjectId, subjectName, streamId, streamName, existing, initialDate, onClose, onSaved }) {
  const qc = useQueryClient();
  const isEdit = !!existing;
  const [date,        setDate]        = useState(existing?.date ?? initialDate ?? new Date().toISOString().slice(0, 10));
  const [topicId,     setTopicId]     = useState(existing?.topicId ?? '');
  const [subtopicId,  setSubtopicId]  = useState(existing?.subtopicId ?? '');
  const [objectives,  setObjectives]  = useState(existing?.objectives ?? '');
  const [activities,  setActivities]  = useState(existing?.activities ?? '');
  const [resources,   setResources]   = useState(existing?.resources ?? '');
  const [remarks,     setRemarks]     = useState(existing?.remarks ?? '');
  const [diffLow,     setDiffLow]     = useState(existing?.differentiation?.low ?? '');
  const [diffMid,     setDiffMid]     = useState(existing?.differentiation?.middle ?? '');
  const [diffHigh,    setDiffHigh]    = useState(existing?.differentiation?.high ?? '');
  const [assessment,  setAssessment]  = useState(existing?.assessment ?? '');
  const [homework,    setHomework]    = useState(existing?.homework ?? '');
  const [wentWell,    setWentWell]    = useState(existing?.reflection?.wentWell ?? '');
  const [betterIf,    setBetterIf]    = useState(existing?.reflection?.betterIf ?? '');
  const [improvement, setImprovement] = useState(existing?.reflection?.improvement ?? '');
  const [customValues, setCustomValues] = useState(() =>
    Object.fromEntries((existing?.customFields ?? []).map(f => [f.key, f.value]))
  );
  const [error, setError] = useState('');

  const { data: topicsResp, isLoading: topicsLoading } = useQuery({
    queryKey: ['lessons', 'topics', subjectId],
    queryFn:  () => lessonsApi.topics.list({ subjectId }),
    staleTime: 60_000,
  });
  const topics = topicsResp?.data ?? [];
  const selectedTopic = topics.find(t => t.id === topicId);
  const subtopics = selectedTopic?.subtopics ?? [];

  // Per-school field customization — which builtins show/are required, what
  // they're labeled, and any extra fields this school added. Falls back to
  // BUILTIN_FIELDS' own defaults (all enabled, none required) while loading
  // so the form is still usable the instant it opens.
  const { data: templateResp } = useQuery({
    queryKey: ['lessons', 'template'],
    queryFn:  () => lessonsApi.template.get(),
    staleTime: 30_000,
  });
  const templateFields = templateResp?.data?.fields ?? [];
  const fieldsByKey = Object.fromEntries(templateFields.map(f => [f.key, f]));
  const isOn = (key) => fieldsByKey[key]?.enabled ?? true;
  const label = (key, fallback) => fieldsByKey[key]?.label || fallback;
  const isRequired = (key) => !!fieldsByKey[key]?.required;
  const customFieldDefs = templateFields.filter(f => !f.builtin && f.enabled);

  const mutation = useMutation({
    mutationFn: (data) => isEdit ? lessonsApi.plans.update(existing.id, data) : lessonsApi.plans.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lessons', 'plans', classId, subjectId, streamId ?? ''] });
      qc.invalidateQueries({ queryKey: ['lessons', 'week-status'] });
      onSaved();
    },
    onError: (err) => setError(err?.message ?? 'Failed to save lesson plan'),
  });

  function submit() {
    if (!date)    { setError('Date is required'); return; }
    if (!topicId) { setError('Pick a topic for this lesson'); return; }
    const REQUIRED_CHECK = [
      ['objectives', objectives], ['activities', activities], ['resources', resources], ['remarks', remarks],
      ['diff_low', diffLow], ['diff_middle', diffMid], ['diff_high', diffHigh],
      ['assessment', assessment], ['homework', homework],
      ['reflection_went_well', wentWell], ['reflection_better_if', betterIf], ['reflection_improvement', improvement],
    ];
    for (const [key, val] of REQUIRED_CHECK) {
      if (isOn(key) && isRequired(key) && !val.trim()) {
        setError(`"${label(key, key)}" is required`);
        return;
      }
    }
    for (const f of customFieldDefs) {
      if (f.required && !(customValues[f.key] ?? '').trim()) {
        setError(`"${f.label}" is required`);
        return;
      }
    }

    // Custom fields: current enabled ones from the form, plus any
    // previously-saved custom values whose field no longer appears in the
    // (possibly since-changed) template — never silently drop data just
    // because a school disabled or removed that field later.
    const currentKeys = new Set(customFieldDefs.map(f => f.key));
    const orphaned = (existing?.customFields ?? []).filter(f => !currentKeys.has(f.key));
    const customFields = [
      ...customFieldDefs.map(f => ({ key: f.key, label: f.label, value: customValues[f.key] ?? '' })),
      ...orphaned,
    ];

    mutation.mutate({
      classId, subjectId, ...(streamId ? { streamId } : {}),
      date, topicId, subtopicId: subtopicId || undefined,
      objectives, activities, resources, remarks,
      differentiation: { low: diffLow, middle: diffMid, high: diffHigh },
      assessment, homework,
      reflection: { wentWell, betterIf, improvement },
      customFields,
    });
  }

  function Field({ label: fieldLabel, value, onChange, rows = 2, placeholder, required = false }) {
    return (
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1.5">{fieldLabel}{required && ' *'}</label>
        <textarea
          value={value} onChange={e => onChange(e.target.value)}
          rows={rows} placeholder={placeholder}
          className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 resize-none"
        />
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{isEdit ? 'Edit Lesson Plan' : 'New Lesson Plan'}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{subjectName} · {className}{streamName ? ` · ${streamName}` : ''}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200">
              <AlertTriangle size={14} className="shrink-0" />{error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Date *</label>
            <input
              type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>

          {topicsLoading ? (
            <div className="flex justify-center py-6"><Loader2 className="animate-spin text-indigo-400" size={18} /></div>
          ) : topics.length === 0 ? (
            <div className="text-center py-8 bg-amber-50 border border-amber-200 rounded-lg px-4">
              <AlertTriangle size={20} className="mx-auto mb-2 text-amber-500" />
              <p className="text-sm font-medium text-amber-800">No topics yet for {subjectName}</p>
              <p className="text-xs text-amber-700 mt-1">Add topics under the "Topics & Coverage" tab before planning a lesson — a lesson plan always points at a real syllabus topic.</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">Topic *</label>
                <select
                  value={topicId} onChange={e => { setTopicId(e.target.value); setSubtopicId(''); }}
                  className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 bg-white"
                >
                  <option value="">Select a topic…</option>
                  {topics.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </div>
              {subtopics.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">Subtopic (optional)</label>
                  <select
                    value={subtopicId} onChange={e => setSubtopicId(e.target.value)}
                    className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10 bg-white"
                  >
                    <option value="">— whole topic —</option>
                    {subtopics.map(st => <option key={st.id} value={st.id}>{st.title}</option>)}
                  </select>
                </div>
              )}
            </>
          )}

          {isOn('objectives') && <Field label={label('objectives', 'Lesson Objectives')} required={isRequired('objectives')} value={objectives} onChange={setObjectives} rows={2} placeholder="By the end of the lesson, learners should be able to…" />}
          {isOn('activities') && <Field label={label('activities', 'Learning Activities')} required={isRequired('activities')} value={activities} onChange={setActivities} rows={3} placeholder="Introduction, main activity, plenary…" />}
          {isOn('resources')  && <Field label={label('resources', 'Resources / References')} required={isRequired('resources')} value={resources}  onChange={setResources}  rows={2} />}
          {isOn('remarks')    && <Field label={label('remarks', 'Remarks')} required={isRequired('remarks')} value={remarks}    onChange={setRemarks}    rows={2} />}

          {(isOn('diff_low') || isOn('diff_middle') || isOn('diff_high')) && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Differentiation</p>
              <div className="grid grid-cols-1 gap-3">
                {isOn('diff_low')    && <Field label={label('diff_low', 'Low Ability')} required={isRequired('diff_low')} value={diffLow}  onChange={setDiffLow}  rows={2} />}
                {isOn('diff_middle') && <Field label={label('diff_middle', 'Middle Ability')} required={isRequired('diff_middle')} value={diffMid}  onChange={setDiffMid}  rows={2} />}
                {isOn('diff_high')   && <Field label={label('diff_high', 'High Ability')} required={isRequired('diff_high')} value={diffHigh} onChange={setDiffHigh} rows={2} />}
              </div>
            </div>
          )}

          {isOn('assessment') && <Field label={label('assessment', 'Assessment & Evaluation')} required={isRequired('assessment')} value={assessment} onChange={setAssessment} rows={2} />}
          {isOn('homework')   && <Field label={label('homework', 'Lesson / Week Assignment')} required={isRequired('homework')} value={homework}  onChange={setHomework}   rows={2} placeholder="Homework or follow-up task" />}

          {customFieldDefs.map(f => (
            <Field key={f.key} label={f.label} required={f.required} value={customValues[f.key] ?? ''} onChange={(v) => setCustomValues(prev => ({ ...prev, [f.key]: v }))} rows={2} />
          ))}

          {(isOn('reflection_went_well') || isOn('reflection_better_if') || isOn('reflection_improvement')) && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Reflection <span className="normal-case font-normal text-slate-400">— fill in after teaching this lesson</span></p>
              <div className="grid grid-cols-1 gap-3">
                {isOn('reflection_went_well')   && <Field label={label('reflection_went_well', 'What went well')} required={isRequired('reflection_went_well')} value={wentWell}    onChange={setWentWell}    rows={2} />}
                {isOn('reflection_better_if')   && <Field label={label('reflection_better_if', 'Even better if')} required={isRequired('reflection_better_if')} value={betterIf}    onChange={setBetterIf}    rows={2} />}
                {isOn('reflection_improvement') && <Field label={label('reflection_improvement', 'Areas for improvement')} required={isRequired('reflection_improvement')} value={improvement} onChange={setImprovement} rows={2} />}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg">Cancel</button>
          <button
            onClick={submit} disabled={mutation.isPending || topics.length === 0}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {isEdit ? 'Save Changes' : 'Save Lesson Plan'}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── Lesson plan row (list item) ──────────────────────────────── */
function LessonPlanRow({ plan, onEdit, onDelete }) {
  const hasReflection = plan.reflection && (plan.reflection.wentWell || plan.reflection.betterIf || plan.reflection.improvement);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-indigo-600">
            {new Date(`${plan.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
          {hasReflection ? (
            <span className="text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">Reflected</span>
          ) : (
            <span className="text-[10px] font-medium text-slate-500 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded-full">Reflection pending</span>
          )}
        </div>
        <h4 className="text-sm font-semibold text-slate-800 mt-1">
          {plan.topicTitle}{plan.subtopicTitle ? ` — ${plan.subtopicTitle}` : ''}
        </h4>
        {plan.objectives && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{plan.objectives}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <a
          href={undefined} onClick={(e) => { e.preventDefault(); lessonsApi.plans.pdf(plan.id); }}
          title="Print / export" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
        ><Printer size={14} /></a>
        <button onClick={() => onEdit(plan)} title="Edit" className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"><Pencil size={14} /></button>
        <button onClick={() => onDelete(plan)} title="Delete" className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

/* ── Lesson Plans: drill-down for one class-subject[-stream] ──── */
function PlansDrillDown({ item, onBack }) {
  const { classId, streamId, streamName, subjectId, subjectName, className } = item;
  const qc = useQueryClient();
  const [showSlider, setShowSlider] = useState(false);
  const [editing,    setEditing]    = useState(null);
  const [prefillDate, setPrefillDate] = useState(null);

  const { data: resp, isLoading } = useQuery({
    queryKey: ['lessons', 'plans', classId, subjectId, streamId ?? ''],
    queryFn:  () => lessonsApi.plans.list({ classId, subjectId, ...(streamId ? { streamId } : {}) }),
    staleTime: 30_000,
  });
  const plans = resp?.data ?? [];

  // Timetable-aware: which of THIS class-subject[-stream]'s real weekly
  // lessons don't have a plan yet — see lessons.js's GET /plans/week-status.
  const { data: weekResp } = useQuery({
    queryKey: ['lessons', 'week-status'],
    queryFn:  () => lessonsApi.plans.weekStatus(),
    staleTime: 5 * 60_000,
  });
  const weekUnplanned = (weekResp?.data?.unplanned ?? []).filter(u =>
    u.classId === classId && u.subjectId === subjectId && (u.streamId ?? null) === (streamId ?? null)
  );

  const deleteMutation = useMutation({
    mutationFn: (plan) => lessonsApi.plans.remove(plan.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lessons', 'plans', classId, subjectId, streamId ?? ''] });
      qc.invalidateQueries({ queryKey: ['lessons', 'week-status'] });
    },
  });

  // Grouped by week (server computes weekStart from each plan's own date —
  // see lessons.js's _weekStartOf) so "plan a whole week" reads as one
  // visual group even though each lesson is its own saved record.
  const groups = useMemo(() => {
    const byWeek = {};
    plans.forEach(p => { (byWeek[p.weekStart ?? 'unscheduled'] ??= []).push(p); });
    return Object.entries(byWeek).sort((a, b) => b[0].localeCompare(a[0]));
  }, [plans]);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="mt-0.5 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900">{subjectName}</h2>
            <span className="text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
              {className}{streamName ? ` · ${streamName}` : ''}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{plans.length} lesson plan{plans.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => { setEditing(null); setPrefillDate(null); setShowSlider(true); }}
          className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-3 py-2 rounded-lg"
        >
          <Plus size={13} /> New Lesson Plan
        </button>
      </div>

      {weekUnplanned.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
            <AlertTriangle size={13} />
            {weekUnplanned.length} lesson{weekUnplanned.length !== 1 ? 's' : ''} on your timetable this week {weekUnplanned.length !== 1 ? "aren't" : "isn't"} planned yet
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {weekUnplanned.map(u => (
              <button
                key={u.date}
                onClick={() => { setEditing(null); setPrefillDate(u.date); setShowSlider(true); }}
                className="flex items-center gap-1 text-xs bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 px-2.5 py-1 rounded-full"
              >
                <Plus size={11} />
                {new Date(`${u.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-indigo-400" size={24} /></div>
      ) : plans.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <NotebookPen size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">No lesson plans yet</p>
          <p className="text-xs mt-1">Plan your first lesson for {subjectName} — you can add several at once for the week ahead.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(([weekStart, weekPlans]) => (
            <div key={weekStart}>
              <div className="flex items-center gap-1.5 mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                <Calendar size={12} />
                {weekStart === 'unscheduled' ? 'Unscheduled' : `Week of ${new Date(`${weekStart}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`}
              </div>
              <div className="space-y-2">
                {weekPlans.map(p => (
                  <LessonPlanRow
                    key={p.id}
                    plan={p}
                    onEdit={(plan) => { setEditing(plan); setShowSlider(true); }}
                    onDelete={(plan) => { if (window.confirm('Delete this lesson plan?')) deleteMutation.mutate(plan); }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {showSlider && (
        <LessonPlanSlideOver
          classId={classId} className={className} subjectId={subjectId} subjectName={subjectName}
          streamId={streamId} streamName={streamName}
          existing={editing} initialDate={prefillDate}
          onClose={() => { setShowSlider(false); setEditing(null); setPrefillDate(null); }}
          onSaved={() => { setShowSlider(false); setEditing(null); setPrefillDate(null); }}
        />
      )}
    </div>
  );
}

/* ── Lesson-plan class card — like ClassCard but shows "this week"
   planning status (from real timetable slots) instead of syllabus
   coverage %. Kept separate from ClassCard rather than overloading it
   with an optional prop: the two show fundamentally different metrics
   (coverage-to-date vs. this-week's plans) and Topics & Coverage's own
   card must stay completely unaffected by this feature. ─────────── */
function LessonPlanCard({ item, weekInfo, onClick }) {
  const { className, streamName, subjectName } = item;
  const required = weekInfo?.required ?? 0;
  const planned  = weekInfo?.planned ?? 0;
  const pct = required > 0 ? Math.round((planned / required) * 100) : null;
  const color = pct === null ? 'text-slate-300' : pct >= 100 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500';
  return (
    <button
      onClick={onClick}
      className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all text-left group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide truncate">
            {className}{streamName ? ` · ${streamName}` : ''}
          </p>
          <h3 className="text-sm font-semibold text-slate-800 mt-0.5 truncate">{subjectName}</h3>
          <p className="text-xs text-slate-400 mt-1">
            {required > 0 ? `${planned} of ${required} lessons planned this week` : 'No timetable slots this week'}
          </p>
        </div>
        {pct !== null && (
          <div className="relative shrink-0">
            <ProgressRing pct={pct} size={60} stroke={5} />
            <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold rotate-90 ${color}`}>
              {pct}%
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 mt-3 text-xs text-slate-400 group-hover:text-indigo-600 transition-colors">
        Plan lessons <ChevronRight size={12} />
      </div>
    </button>
  );
}

/* ── Teacher: Lesson Plans tab ─────────────────────────────────
   Same class-subject[-stream] picker as My Classes (myClasses()) —
   planning is per lesson per stream, so the picker has to resolve down
   to the exact same assignment granularity coverage already does.
   Enriched with real timetable-derived "this week" planning status
   (GET /plans/week-status) — the whole point of connecting Lesson Plans
   to Timetable: the system now knows how many lessons a week actually
   need planning, not just which classes exist. */
function LessonPlansTab() {
  const [drilldown, setDrilldown] = useState(null);

  const { data: resp, isLoading } = useQuery({
    queryKey: ['lessons', 'my-classes'],
    queryFn:  () => lessonsApi.myClasses(),
    staleTime: 60_000,
  });
  const items = resp?.data ?? [];

  const { data: weekResp } = useQuery({
    queryKey: ['lessons', 'week-status'],
    queryFn:  () => lessonsApi.plans.weekStatus(),
    staleTime: 5 * 60_000,
  });
  const week = weekResp?.data;
  const weekByKey = useMemo(() => {
    const map = {};
    (week?.assignments ?? []).forEach(a => { map[`${a.classId}__${a.subjectId}__${a.streamId ?? ''}`] = a; });
    return map;
  }, [week]);

  // Plan directly from the week-status reminder, bypassing the class-card
  // picker entirely — see quickPlan below for why this matters.
  const [quickPlan, setQuickPlan] = useState(null); // null | one entry from week.unplanned

  if (drilldown) {
    return <PlansDrillDown item={drilldown} onBack={() => setDrilldown(null)} />;
  }

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-indigo-400" size={24} /></div>;
  }

  if (!items.length && !(week?.totalRequired > 0)) {
    return (
      <div className="text-center py-16 text-slate-400">
        <GraduationCap size={36} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm font-medium">No teaching assignments found</p>
        <p className="text-xs mt-1">Contact your administrator to set up your teaching assignments.</p>
      </div>
    );
  }

  return (
    <div>
      {week && week.totalRequired > 0 && (
        <div className="mb-4">
          <div className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium ${
            week.totalPlanned >= week.totalRequired
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-amber-50 text-amber-800 border border-amber-200'
          }`}>
            {week.totalPlanned >= week.totalRequired ? <Check size={15} /> : <AlertTriangle size={15} />}
            {week.totalPlanned} of {week.totalRequired} lessons on your timetable planned this week
          </div>
          {/* Plan directly here, not just via the class cards below — a
              class-subject can be missing from "My Classes" (sourced from
              teaching_assignments) even though it's genuinely on this
              teacher's real timetable (a data-completeness gap between the
              two, not something this feature can silently paper over — see
              DEVELOPER_GUIDE.md §51/§52). Without this, a lesson the
              reminder correctly flags could be un-plannable through the UI
              at all. */}
          {week.unplanned.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {week.unplanned.map(u => (
                <button
                  key={`${u.classId}-${u.subjectId}-${u.streamId ?? ''}-${u.date}`}
                  onClick={() => setQuickPlan(u)}
                  className="flex items-center gap-1 text-xs bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 px-2.5 py-1 rounded-full"
                >
                  <Plus size={11} />
                  {u.subjectName} · {new Date(`${u.date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {items.length > 0 && (
        <>
          <p className="text-xs text-slate-500 mb-4">Tap a card to plan or review lessons for that class.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map(item => (
              <LessonPlanCard
                key={`${item.classId}-${item.subjectId}-${item.streamId ?? ''}`}
                item={item}
                weekInfo={weekByKey[`${item.classId}__${item.subjectId}__${item.streamId ?? ''}`]}
                onClick={() => setDrilldown(item)}
              />
            ))}
          </div>
        </>
      )}

      {quickPlan && (
        <LessonPlanSlideOver
          classId={quickPlan.classId} className={quickPlan.className}
          subjectId={quickPlan.subjectId} subjectName={quickPlan.subjectName}
          streamId={quickPlan.streamId ?? undefined} streamName={quickPlan.streamName}
          initialDate={quickPlan.date}
          onClose={() => setQuickPlan(null)}
          onSaved={() => setQuickPlan(null)}
        />
      )}
    </div>
  );
}

/* ── Admin: Overview tab ─────────────────────────────────────── */
function OverviewTab() {
  const [search, setSearch] = useState('');
  const school  = useAuthStore(s => s.session?.school);

  const { data: resp, isLoading } = useQuery({
    queryKey: ['lessons', 'summary'],
    queryFn:  () => lessonsApi.summary(),
    staleTime: 60_000,
  });

  const rows = resp?.data ?? [];

  const filtered = useMemo(() => {
    if (!search) return rows;
    const s = search.toLowerCase();
    return rows.filter(r =>
      r.teacherName?.toLowerCase().includes(s) ||
      r.className?.toLowerCase().includes(s) ||
      r.streamName?.toLowerCase().includes(s) ||
      r.subjectName?.toLowerCase().includes(s)
    );
  }, [rows, search]);

  function pctBadge(pct) {
    if (pct >= 80) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    if (pct >= 50) return 'bg-amber-50 text-amber-700 border-amber-200';
    return 'bg-red-50 text-red-700 border-red-200';
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search teacher, class or subject…"
          className="w-full text-sm pl-9 pr-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-indigo-400" size={24} /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Users size={32} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm font-medium">{rows.length === 0 ? 'No teaching assignments' : 'No matches'}</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Teacher</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Class</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Coverage</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((r, i) => (
                <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.teacherName}</td>
                  <td className="px-4 py-3 text-slate-600">{r.className}{r.streamName ? ` · ${r.streamName}` : ''}</td>
                  <td className="px-4 py-3 text-slate-600">{r.subjectName}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {r.coveredItems}/{r.totalItems} items
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${r.pct >= 80 ? 'bg-emerald-400' : r.pct >= 50 ? 'bg-amber-400' : 'bg-indigo-400'}`}
                          style={{ width: `${r.pct}%` }}
                        />
                      </div>
                      <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${pctBadge(r.pct)}`}>
                        {r.pct}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Copy from year slide-over ───────────────────────────────── */
function CopyYearSlideOver({ subjectId, subjectName, currentYear, onClose, onCopied }) {
  const qc = useQueryClient();
  const [fromYear, setFromYear] = useState('');
  const [toYear,   setToYear]   = useState(currentYear ?? '');
  const [error,    setError]    = useState('');

  const mutation = useMutation({
    mutationFn: () => lessonsApi.topics.copyFrom({ subjectId, fromAcademicYear: fromYear.trim(), toAcademicYear: toYear.trim() }),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ['lessons', 'topics', subjectId] });
      onCopied(resp?.data?.copied ?? 0);
    },
    onError: (err) => setError(err?.message ?? 'Failed to copy topics'),
  });

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Copy Topics from Year</h2>
            <p className="text-xs text-slate-400 mt-0.5">{subjectName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200">
              <AlertTriangle size={14} className="shrink-0" />{error}
            </div>
          )}
          <p className="text-sm text-slate-600">Copy all topics and subtopics from a previous academic year to a new year. Coverage records are NOT copied — only the curriculum structure.</p>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Copy FROM year</label>
            <input
              value={fromYear} onChange={e => setFromYear(e.target.value)}
              placeholder="e.g. 2024/2025"
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">Copy INTO year</label>
            <input
              value={toYear} onChange={e => setToYear(e.target.value)}
              placeholder="e.g. 2025/2026"
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending || !fromYear.trim() || !toYear.trim()}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
          >
            {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
            {mutation.isPending ? 'Copying…' : 'Copy Topics'}
          </button>
        </div>
      </div>
    </>
  );
}

/* ── Main page ───────────────────────────────────────────────── */
export default function LessonsPage() {
  const { isAdmin, isHod, isTeacher } = useRole();
  const school = useAuthStore(s => s.session?.school);
  const can = useAuthStore(s => s.can.bind(s));
  const role = useAuthStore(s => s.session?.user?.role);
  const isAdminLevel = ['admin', 'superadmin', 'principal', 'deputy_principal', 'deputy', 'acting_deputy', 'head_of_school'].includes(role);
  // Gated by lessons__template specifically (hasExplicitSubGrant server-
  // side, no coarse lessons:update fallback) — see moduleRegistry.js's own
  // comment for why this is deliberately narrower than plain "Edit Lesson
  // Plan".
  const canConfigureTemplate = isAdminLevel || can('lessons__template', 'update');

  // Default tab: admin/hod see overview; teachers see their classes
  const defaultTab = (isAdmin || isHod) ? 'overview' : 'my-classes';
  const [tab, setTab] = useState(defaultTab);

  const tabs = [
    ...(isTeacher ? [{ key: 'my-classes', label: 'Topics & Coverage', Icon: BookCheck }] : []),
    ...(isTeacher ? [{ key: 'plans',      label: 'Lesson Plans',      Icon: NotebookPen }] : []),
    ...((isAdmin || isHod) ? [{ key: 'overview', label: 'Overview', Icon: BarChart3 }] : []),
    ...(canConfigureTemplate ? [{ key: 'template', label: 'Template', Icon: Settings }] : []),
  ];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <BookCheck size={20} className="text-indigo-600" />
            <h1 className="text-xl font-bold text-slate-900">Lessons</h1>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            Track curriculum coverage across all classes and subjects
            {school?.academicYear ? ` — ${school.academicYear}` : ''}
          </p>
        </div>
      </div>

      {/* Tabs */}
      {tabs.length > 1 && (
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === t.key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <t.Icon size={15} />
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {tab === 'my-classes' && <MyClassesTab />}
      {tab === 'plans'      && <LessonPlansTab />}
      {tab === 'overview'   && <OverviewTab />}
      {tab === 'template'   && <TemplateTab />}
    </div>
  );
}
