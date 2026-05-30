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
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookCheck, ChevronRight, ChevronDown, Check, Plus, X,
  Loader2, AlertTriangle, Pencil, Trash2, Search, GraduationCap,
  Users, Copy, BarChart3, ArrowLeft, BookOpen, Circle,
  CheckCircle2, MinusCircle,
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
  const isAdmin = all.has('admin') || all.has('superadmin') || all.has('principal') || all.has('deputy') || all.has('deputy_principal');
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

/* ── Class-Subject card ──────────────────────────────────────── */
function ClassCard({ item, onClick }) {
  const { pct, className, subjectName, coveredItems, totalItems } = item;
  const color = pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-indigo-600';
  return (
    <button
      onClick={onClick}
      className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md hover:border-slate-300 transition-all text-left group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide truncate">{className}</p>
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
function TopicRow({ topic, classId, subjectId, academicYear, canManage, onEdit, onDelete }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const hasSubs = topic.subtopics?.length > 0;
  const allDone = topic.covered;
  const partial = topic.partial;

  const markMutation = useMutation({
    mutationFn: ({ topicId, subtopicId }) => lessonsApi.coverage.mark({
      classId, subjectId, topicId, subtopicId, academicYear,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lessons', 'coverage', classId, subjectId] }),
  });

  const unmarkMutation = useMutation({
    mutationFn: ({ coverageId, topicId, subtopicId }) => {
      if (coverageId) return lessonsApi.coverage.unmark(coverageId);
      return lessonsApi.coverage.unmarkBulk({ classId, subjectId, topicId, subtopicId });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lessons', 'coverage', classId, subjectId] }),
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
  const { classId, subjectId, subjectName, className, academicYear } = item;
  const qc = useQueryClient();
  const [search,     setSearch]     = useState('');
  const [showSlider, setShowSlider] = useState(false);
  const [editing,    setEditing]    = useState(null);

  const { data: resp, isLoading } = useQuery({
    queryKey: ['lessons', 'coverage', classId, subjectId],
    queryFn:  () => lessonsApi.coverage.list({ classId, subjectId, academicYear }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lessons', 'coverage', classId, subjectId] }),
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
            <span className="text-xs font-medium text-indigo-600 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">{className}</span>
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
            key={`${item.classId}-${item.subjectId}`}
            item={item}
            onClick={() => setDrilldown(item)}
          />
        ))}
      </div>
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
                  <td className="px-4 py-3 text-slate-600">{r.className}</td>
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

  // Default tab: admin/hod see overview; teachers see their classes
  const defaultTab = (isAdmin || isHod) ? 'overview' : 'my-classes';
  const [tab, setTab] = useState(defaultTab);

  const tabs = [
    ...(isTeacher ? [{ key: 'my-classes', label: 'My Classes', Icon: BookCheck }] : []),
    ...((isAdmin || isHod) ? [{ key: 'overview', label: 'Overview', Icon: BarChart3 }] : []),
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
      {tab === 'overview'   && <OverviewTab />}
    </div>
  );
}
