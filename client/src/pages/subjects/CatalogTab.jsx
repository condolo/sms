/* ============================================================
   CatalogTab — Department + Subject registry
   Extracted from the original SubjectsPage (single-file version).
   Receives flash(msg, type) from SubjectsPage shell.
   ============================================================ */
import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, Search,
  X, BookOpen, Users, Library, AlertTriangle, Check, UserPlus,
  UserMinus, GraduationCap,
} from 'lucide-react';
import clsx from 'clsx';
import {
  departments as deptsApi,
  subjects    as subsApi,
  classes     as classesApi,
  students    as studentsApi,
  studentSubjects as enrollApi,
  teachers    as teachersApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import { useSections } from '@/hooks/useSections.js';

/* ── helpers ─────────────────────────────────────────────── */
const SECTION_COLORS = {
  all:       'bg-slate-100 text-slate-700',
  kg:        'bg-pink-100 text-pink-700',
  primary:   'bg-blue-100 text-blue-700',
  secondary: 'bg-violet-100 text-violet-700',
  alevel:    'bg-amber-100 text-amber-700',
};
const DEPT_COLORS = [
  '#6366F1','#0EA5E9','#10B981','#F59E0B','#EC4899',
  '#EF4444','#8B5CF6','#06B6D4','#84CC16','#F97316',
];
function canEdit(role) {
  return ['superadmin','admin','deputy'].includes(role);
}

/* ── small reusable ──────────────────────────────────────── */
function SectionPill({ value }) {
  const { sectionMap } = useSections();
  const label = sectionMap[value]?.name ?? value;
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', SECTION_COLORS[value] ?? 'bg-slate-100 text-slate-700')}>
      {label}
    </span>
  );
}
function ColorDot({ color, size = 'md' }) {
  return <span className={clsx('inline-block shrink-0 rounded-full', size === 'sm' ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5')} style={{ backgroundColor: color ?? '#94a3b8' }} />;
}

/* ── Department slide-over form ───────────────────────────── */
function DeptForm({ initial, onSave, onClose, saving }) {
  const [form, setForm] = useState({
    name:        initial?.name        ?? '',
    code:        initial?.code        ?? '',
    color:       initial?.color       ?? DEPT_COLORS[0],
    hodName:     initial?.hodName     ?? '',
    hodId:       initial?.hodId       ?? '',
    description: initial?.description ?? '',
    order:       initial?.order       ?? 0,
  });
  const [hodSearch, setHodSearch] = useState(initial?.hodName ?? '');
  const [hodOpen, setHodOpen]     = useState(false);
  const hodRef = useRef(null);
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const { data: teachersList = [] } = useQuery({
    queryKey: ['teachers-autocomplete'],
    queryFn:  () => teachersApi.list({ limit: 200, status: 'active' }),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    staleTime: 120_000,
  });
  const searchQ = hodSearch.trim().toLowerCase();
  const matchedTeachers = searchQ.length >= 1
    ? teachersList.filter(t => `${t.title ?? ''} ${t.firstName ?? ''} ${t.lastName ?? ''}`.trim().toLowerCase().includes(searchQ)).slice(0, 6)
    : teachersList.slice(0, 6);

  function selectTeacher(t) {
    const name = [t.title, t.firstName, t.lastName].filter(Boolean).join(' ');
    set('hodName', name); set('hodId', t.id); setHodSearch(name); setHodOpen(false);
  }
  function clearHod() { set('hodName', ''); set('hodId', ''); setHodSearch(''); }

  useEffect(() => {
    function handle(e) { if (hodRef.current && !hodRef.current.contains(e.target)) setHodOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-900">{initial ? 'Edit Department' : 'New Department'}</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Department Name <span className="text-red-500">*</span></label>
          <input value={form.name} onChange={e => set('name', e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="e.g. Mathematics" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Code <span className="text-red-500">*</span></label>
            <input value={form.code} onChange={e => set('code', e.target.value.toUpperCase())}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="e.g. MATH" maxLength={20} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Order</label>
            <input type="number" min={0} value={form.order} onChange={e => set('order', parseInt(e.target.value) || 0)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Colour</label>
          <div className="flex flex-wrap gap-2">
            {DEPT_COLORS.map(c => (
              <button key={c} type="button" onClick={() => set('color', c)}
                className={clsx('h-7 w-7 rounded-full border-2 transition', form.color === c ? 'border-slate-900 scale-110' : 'border-transparent')}
                style={{ backgroundColor: c }} />
            ))}
            <input type="color" value={form.color} onChange={e => set('color', e.target.value)}
              className="h-7 w-7 cursor-pointer rounded-full border border-slate-300 p-0.5" title="Custom colour" />
          </div>
        </div>
        <div ref={hodRef} className="relative">
          <label className="block text-sm font-medium text-slate-700 mb-1">Head of Department (HoD)</label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input value={hodSearch} onChange={e => { setHodSearch(e.target.value); set('hodName', e.target.value); set('hodId', ''); setHodOpen(true); }} onFocus={() => setHodOpen(true)}
              placeholder="Search by teacher name…"
              className="w-full rounded-lg border border-slate-300 pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            {hodSearch && <button type="button" onClick={clearHod} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"><X size={13} /></button>}
          </div>
          {hodOpen && matchedTeachers.length > 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden">
              {matchedTeachers.map(t => {
                const name = [t.title, t.firstName, t.lastName].filter(Boolean).join(' ');
                return (
                  <button key={t.id} type="button" onMouseDown={() => selectTeacher(t)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-violet-50 transition">
                    <div className="h-7 w-7 shrink-0 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 text-xs font-semibold">{(t.firstName?.[0] ?? '?').toUpperCase()}</div>
                    <p className="text-sm font-medium text-slate-800 truncate">{name}</p>
                  </button>
                );
              })}
            </div>
          )}
          {hodOpen && searchQ.length >= 1 && matchedTeachers.length === 0 && (
            <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg px-3 py-3">
              <p className="text-sm text-slate-400 text-center">No matching teachers</p>
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)}
            rows={3} maxLength={500}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
            placeholder="Optional department description" />
        </div>
      </div>
      <div className="shrink-0 flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-200 transition">Cancel</button>
        <button onClick={() => onSave(form)} disabled={saving || !form.name.trim() || !form.code.trim()}
          className="px-4 py-2 rounded-lg text-sm bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition font-medium">
          {saving ? 'Saving…' : 'Save Department'}
        </button>
      </div>
    </div>
  );
}

/* ── Subject slide-over form ──────────────────────────────── */
function SubjectForm({ initial, departments, onSave, onClose, saving }) {
  const { sectionTabs } = useSections();
  const [form, setForm] = useState({
    name:         initial?.name         ?? '',
    code:         initial?.code         ?? '',
    shortName:    initial?.shortName    ?? '',
    departmentId: initial?.departmentId ?? (departments[0]?.id ?? ''),
    sections:     initial?.sections     ?? ['all'],
    isCompulsory: initial?.isCompulsory ?? false,
    color:        initial?.color        ?? '#6366F1',
    order:        initial?.order        ?? 0,
    description:  initial?.description  ?? '',
  });
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function toggleSection(val) {
    setForm(f => {
      const cur = f.sections;
      if (val === 'all') return { ...f, sections: ['all'] };
      const without = cur.filter(s => s !== 'all' && s !== val);
      const next = cur.includes(val) ? without : [...without, val];
      return { ...f, sections: next.length ? next : ['all'] };
    });
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <h2 className="text-base font-semibold text-slate-900">{initial ? 'Edit Subject' : 'New Subject'}</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100"><X size={18} /></button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Subject Name <span className="text-red-500">*</span></label>
          <input value={form.name} onChange={e => set('name', e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="e.g. Pure Mathematics" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Code <span className="text-red-500">*</span></label>
            <input value={form.code} onChange={e => set('code', e.target.value.toUpperCase())}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="e.g. PMATH" maxLength={20} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Short Name</label>
            <input value={form.shortName} onChange={e => set('shortName', e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              placeholder="e.g. Pure Maths" maxLength={50} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Department <span className="text-red-500">*</span></label>
          <select value={form.departmentId} onChange={e => set('departmentId', e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white">
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Sections</label>
          <div className="flex flex-wrap gap-2">
            {sectionTabs.map(s => (
              <button key={s.id} type="button" onClick={() => toggleSection(s.id)}
                className={clsx('rounded-full px-3 py-1 text-xs font-medium border transition',
                  form.sections.includes(s.id) ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-600 border-slate-300 hover:border-violet-400')}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => set('isCompulsory', !form.isCompulsory)}
            className={clsx('relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors', form.isCompulsory ? 'bg-violet-600' : 'bg-slate-200')}>
            <span className={clsx('pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition', form.isCompulsory ? 'translate-x-4' : 'translate-x-0')} />
          </button>
          <span className="text-sm text-slate-700">Compulsory subject</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Colour</label>
            <div className="flex flex-wrap gap-2">
              {DEPT_COLORS.map(c => (
                <button key={c} type="button" onClick={() => set('color', c)}
                  className={clsx('h-6 w-6 rounded-full border-2 transition', form.color === c ? 'border-slate-900 scale-110' : 'border-transparent')}
                  style={{ backgroundColor: c }} />
              ))}
              <input type="color" value={form.color ?? '#6366F1'} onChange={e => set('color', e.target.value)}
                className="h-6 w-6 cursor-pointer rounded-full border border-slate-300 p-0.5" title="Custom colour" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Order</label>
            <input type="number" min={0} value={form.order} onChange={e => set('order', parseInt(e.target.value) || 0)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
          <textarea value={form.description} onChange={e => set('description', e.target.value)}
            rows={2} maxLength={500}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
            placeholder="Optional subject description" />
        </div>
      </div>
      <div className="shrink-0 flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-200 transition">Cancel</button>
        <button onClick={() => onSave(form)} disabled={saving || !form.name.trim() || !form.code.trim() || !form.departmentId}
          className="px-4 py-2 rounded-lg text-sm bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition font-medium">
          {saving ? 'Saving…' : 'Save Subject'}
        </button>
      </div>
    </div>
  );
}

/* ── Enrollment slide-over ────────────────────────────────── */
function EnrollSlideOver({ subject, onClose, flash }) {
  const qc = useQueryClient();
  const [classId, setClassId]           = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [enrollingId, setEnrollingId]   = useState(null);
  const [unenrollingId, setUnenrollingId] = useState(null);
  const [bulking, setBulking]           = useState(false);

  const { data: enrollments = [], isLoading: loadingEnrolled, refetch } = useQuery({
    queryKey: ['subject-enrollments', subject.id],
    queryFn:  () => enrollApi.list({ subjectId: subject.id }),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    staleTime: 0,
  });
  const { data: classes = [] } = useQuery({
    queryKey: ['classes'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    staleTime: 60_000,
  });
  const { data: allStudents = [] } = useQuery({
    queryKey: ['students-search-pool'],
    queryFn:  () => studentsApi.list({ limit: 2000, status: 'active' }),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    staleTime: 60_000,
  });

  const enrolledIds  = new Set(enrollments.map(e => e.studentId));
  const searchQ      = studentSearch.trim().toLowerCase();
  const searchResults = searchQ.length >= 2
    ? allStudents.filter(s => s.status === 'active' && !enrolledIds.has(s.id) &&
        (`${s.firstName} ${s.lastName}`.toLowerCase().includes(searchQ) || (s.admissionNumber ?? '').toLowerCase().includes(searchQ))
      ).slice(0, 8)
    : [];

  function invalidateCounts() { qc.invalidateQueries({ queryKey: ['student-subjects-counts'] }); }

  async function handleBulkEnroll() {
    if (!classId) return;
    setBulking(true);
    try { const r = await enrollApi.bulk({ subjectId: subject.id, classId }); refetch(); invalidateCounts(); flash(r.message ?? 'Class enrolled'); }
    catch (err) { flash(err.extra?.error || err.message || 'Bulk enroll failed', 'error'); }
    finally { setBulking(false); }
  }
  async function handleEnroll(studentId) {
    setEnrollingId(studentId);
    try { await enrollApi.enroll({ studentId, subjectId: subject.id }); refetch(); invalidateCounts(); setStudentSearch(''); }
    catch (err) { flash(err.extra?.error || err.message || 'Enroll failed', 'error'); }
    finally { setEnrollingId(null); }
  }
  async function handleUnenroll(enrollmentId) {
    setUnenrollingId(enrollmentId);
    try { await enrollApi.unenroll(enrollmentId); refetch(); invalidateCounts(); }
    catch (err) { flash(err.extra?.error || err.message || 'Unenroll failed', 'error'); }
    finally { setUnenrollingId(null); }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center" style={{ backgroundColor: subject.color ?? '#6366F1' }}>
            <GraduationCap size={15} className="text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">{subject.name}</h2>
            <p className="text-xs text-slate-500">{enrollments.length} enrolled</p>
          </div>
        </div>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 rounded-lg hover:bg-slate-100 shrink-0"><X size={18} /></button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Enroll by Class</p>
          <div className="flex gap-2">
            <select value={classId} onChange={e => setClassId(e.target.value)}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white">
              <option value="">Select a class…</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button onClick={handleBulkEnroll} disabled={!classId || bulking}
              className="shrink-0 flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-700 disabled:opacity-50 transition font-medium">
              {bulking ? 'Enrolling…' : <><UserPlus size={14} />Enroll Class</>}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">Enrolls all active students in the selected class. Already-enrolled students are skipped.</p>
        </div>
        <div className="px-6 py-4 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Enroll Individual Student</p>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={studentSearch} onChange={e => setStudentSearch(e.target.value)} placeholder="Search by name or admission number…"
              className="w-full rounded-lg border border-slate-300 pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
            {studentSearch && <button onClick={() => setStudentSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"><X size={13} /></button>}
          </div>
          {searchQ.length >= 2 && (
            <div className="mt-2 space-y-1">
              {searchResults.length === 0
                ? <p className="text-xs text-slate-400 py-2 text-center">No matching students (or all already enrolled)</p>
                : searchResults.map(s => (
                    <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{s.firstName} {s.lastName}</p>
                        {s.admissionNumber && <p className="text-[11px] text-slate-400">{s.admissionNumber}</p>}
                      </div>
                      <button onClick={() => handleEnroll(s.id)} disabled={enrollingId === s.id}
                        className="shrink-0 flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1.5 text-xs text-white hover:bg-violet-700 disabled:opacity-50 transition">
                        {enrollingId === s.id ? '…' : <><Plus size={12} />Enroll</>}
                      </button>
                    </div>
                  ))
              }
            </div>
          )}
          {searchQ.length > 0 && searchQ.length < 2 && <p className="text-[11px] text-slate-400 mt-1.5">Type at least 2 characters to search</p>}
        </div>
        <div className="px-6 py-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Enrolled Students ({enrollments.length})</p>
          {loadingEnrolled
            ? <p className="text-sm text-slate-400 py-4 text-center">Loading…</p>
            : enrollments.length === 0
              ? <div className="rounded-xl border-2 border-dashed border-slate-200 py-8 text-center"><Users size={24} className="mx-auto text-slate-300 mb-2" /><p className="text-sm text-slate-400">No students enrolled yet</p></div>
              : <div className="space-y-1">
                  {enrollments.map(e => (
                    <div key={e.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2.5 hover:bg-slate-50 transition">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{e.student ? `${e.student.firstName} ${e.student.lastName}` : e.studentId}</p>
                        <p className="text-[11px] text-slate-400">{[e.className, e.student?.admissionNumber].filter(Boolean).join(' · ')}</p>
                      </div>
                      <button onClick={() => handleUnenroll(e.id)} disabled={unenrollingId === e.id}
                        className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-50 transition" title="Unenroll">
                        {unenrollingId === e.id ? <span className="text-xs">…</span> : <UserMinus size={14} />}
                      </button>
                    </div>
                  ))}
                </div>
          }
        </div>
      </div>
    </div>
  );
}

/* ── Slide-over shell ────────────────────────────────────── */
function SlideOver({ open, onClose, children, wide = false }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className={clsx('fixed inset-y-0 right-0 z-50 bg-white shadow-2xl', wide ? 'w-full max-w-lg' : 'w-full max-w-md')}>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── Delete confirm dialog ───────────────────────────────── */
function DeleteDialog({ item, type, onConfirm, onClose, deleting }) {
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3 mb-4">
          <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={20} />
          <div>
            <p className="font-semibold text-slate-900 text-sm">Deactivate {type}?</p>
            <p className="text-slate-500 text-sm mt-1"><strong>{item.name}</strong> will be hidden from all modules.</p>
            {type === 'Department' && <p className="text-amber-600 text-xs mt-2 font-medium">All active subjects must be moved or deactivated first.</p>}
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-100">Cancel</button>
          <button onClick={onConfirm} disabled={deleting} className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
            {deleting ? 'Removing…' : 'Deactivate'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Department card ─────────────────────────────────────── */
function DeptCard({ dept, subjects, editable, enrollCounts, onEditDept, onDeleteDept, onAddSubject, onEditSubject, onDeleteSubject, onEnroll }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-5 py-3.5 cursor-pointer hover:bg-slate-50 transition select-none" onClick={() => setExpanded(e => !e)}>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white text-sm font-bold" style={{ backgroundColor: dept.color ?? '#6366F1' }}>
          {dept.code?.slice(0, 2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-900 text-sm">{dept.name}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 font-mono">{dept.code}</span>
            {dept.hodName && <span className="text-xs text-slate-500 flex items-center gap-1"><Users size={11} className="shrink-0" />{dept.hodName}</span>}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{subjects.length} subject{subjects.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {editable && (
            <>
              <button onClick={e => { e.stopPropagation(); onAddSubject(dept); }} className="p-1.5 rounded-lg text-violet-600 hover:bg-violet-50 transition" title="Add subject"><Plus size={14} /></button>
              <button onClick={e => { e.stopPropagation(); onEditDept(dept); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition" title="Edit department"><Pencil size={14} /></button>
              <button onClick={e => { e.stopPropagation(); onDeleteDept(dept); }} className="p-1.5 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500 transition" title="Deactivate department"><Trash2 size={14} /></button>
            </>
          )}
          {expanded ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <div className="border-t border-slate-100">
              {subjects.length === 0
                ? <div className="px-5 py-6 text-center text-sm text-slate-400">No subjects yet.{editable && <button onClick={() => onAddSubject(dept)} className="ml-1 text-violet-600 hover:underline">Add one</button>}</div>
                : <div className="divide-y divide-slate-50">
                    {subjects.map(sub => {
                      const count = enrollCounts[sub.id] ?? 0;
                      return (
                        <div key={sub.id} className="flex items-center gap-3 px-5 py-2.5 hover:bg-slate-50/60 transition group">
                          <ColorDot color={sub.color} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-slate-800">{sub.name}</span>
                              <span className="text-[11px] font-mono text-slate-400">{sub.code}</span>
                              {sub.shortName && sub.shortName !== sub.name && <span className="text-[11px] text-slate-400">({sub.shortName})</span>}
                              {sub.isCompulsory && <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">Compulsory</span>}
                              <span className={clsx('rounded-full px-2 py-0.5 text-[10px] font-medium flex items-center gap-1', count > 0 ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500')}>
                                <Users size={9} />{count} enrolled
                              </span>
                            </div>
                            {sub.sections?.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">{sub.sections.map(s => <SectionPill key={s} value={s} />)}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                            {editable && <button onClick={() => onEnroll(sub)} className="p-1 rounded text-violet-500 hover:text-violet-700 hover:bg-violet-50 transition" title="Manage enrollment"><UserPlus size={13} /></button>}
                            <button onClick={() => onEditSubject(sub)} className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"><Pencil size={13} /></button>
                            <button onClick={() => onDeleteSubject(sub)} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition"><Trash2 size={13} /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
              }
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main catalog tab ─────────────────────────────────────── */
export default function CatalogTab({ flash }) {
  const role     = useAuthStore(s => s.session?.user?.role ?? '');
  const editable = canEdit(role);
  const qc       = useQueryClient();

  const [search, setSearch]           = useState('');
  const [deptSlide, setDeptSlide]     = useState(null);
  const [subSlide, setSubSlide]       = useState(null);
  const [enrollSlide, setEnrollSlide] = useState(null);
  const [delTarget, setDelTarget]     = useState(null);

  const { data: depts = [], isPending: deptsLoading } = useQuery({
    queryKey: ['departments'],
    queryFn:  () => deptsApi.list(),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    staleTime: 60_000,
  });
  const { data: allSubjects = [], isPending: subsLoading } = useQuery({
    queryKey: ['subjects'],
    queryFn:  () => subsApi.list(),
    select:   r => r?.data ?? (Array.isArray(r) ? r : []),
    staleTime: 60_000,
  });
  const { data: enrollCounts = {} } = useQuery({
    queryKey: ['student-subjects-counts'],
    queryFn:  () => enrollApi.counts(),
    select:   r => r?.data ?? r ?? {},
    staleTime: 30_000,
  });

  const saveDept = useMutation({
    mutationFn: ({ id, data }) => id ? deptsApi.update(id, data) : deptsApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); setDeptSlide(null); flash('Department saved'); },
    onError: err => flash(err.message ?? 'Save failed', 'error'),
  });
  const deleteDept = useMutation({
    mutationFn: id => deptsApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); setDelTarget(null); flash('Department deactivated'); },
    onError: err => flash(err.message ?? 'Delete failed', 'error'),
  });
  const saveSub = useMutation({
    mutationFn: ({ id, data }) => id ? subsApi.update(id, data) : subsApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subjects'] }); setSubSlide(null); flash('Subject saved'); },
    onError: err => flash(err.message ?? 'Save failed', 'error'),
  });
  const deleteSub = useMutation({
    mutationFn: id => subsApi.remove(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subjects'] }); setDelTarget(null); flash('Subject deactivated'); },
    onError: err => flash(err.message ?? 'Delete failed', 'error'),
  });

  const q = search.trim().toLowerCase();
  const filteredDepts = q
    ? depts.filter(d => d.name.toLowerCase().includes(q) || d.code.toLowerCase().includes(q) || (d.hodName ?? '').toLowerCase().includes(q))
    : depts;
  function subjectsFor(deptId) {
    const subs = allSubjects.filter(s => s.departmentId === deptId);
    return q ? subs.filter(s => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)) : subs;
  }

  const totalEnrolled   = Object.values(enrollCounts).reduce((a, b) => a + b, 0);
  const totalSubjects   = allSubjects.length;
  const compulsoryCount = allSubjects.filter(s => s.isCompulsory).length;
  const loading         = deptsLoading || subsLoading;

  return (
    <div>
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100">
              <Library size={20} className="text-violet-600" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Subjects &amp; Departments</h1>
              <p className="text-sm text-slate-500">School-wide subject registry with student enrollment</p>
            </div>
          </div>
          {editable && (
            <div className="flex items-center gap-2">
              <button onClick={() => setSubSlide({ mode: 'new', data: null, deptId: depts[0]?.id })}
                className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition">
                <Plus size={15} />Add Subject
              </button>
              <button onClick={() => setDeptSlide({ mode: 'new', data: null })}
                className="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-700 transition font-medium">
                <Plus size={15} />Add Department
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-4 px-6 py-4">
        {[
          { label: 'Departments',    value: depts.length,    color: 'text-violet-600' },
          { label: 'Subjects',       value: totalSubjects,   color: 'text-blue-600'   },
          { label: 'Compulsory',     value: compulsoryCount, color: 'text-green-600'  },
          { label: 'Total Enrolled', value: totalEnrolled,   color: 'text-amber-600'  },
        ].map(stat => (
          <div key={stat.label} className="rounded-xl bg-white border border-slate-200 px-5 py-3.5 shadow-sm">
            <p className="text-xs text-slate-500">{stat.label}</p>
            <p className={clsx('text-2xl font-bold mt-0.5', stat.color)}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="px-6 pb-4">
        <div className="relative max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search departments or subjects…"
            className="w-full rounded-lg border border-slate-300 pl-8 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white" />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"><X size={14} /></button>}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 pb-10 space-y-4">
        {loading ? (
          <div className="py-20 text-center text-slate-400 text-sm">Loading…</div>
        ) : filteredDepts.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-slate-300 py-16 text-center">
            <Library size={32} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">{q ? `No results for "${search}"` : 'No departments yet.'}</p>
            {!q && editable && <button onClick={() => setDeptSlide({ mode: 'new', data: null })} className="mt-3 text-sm text-violet-600 hover:underline">Create your first department</button>}
          </div>
        ) : (
          filteredDepts.map(dept => (
            <DeptCard key={dept.id} dept={dept} subjects={subjectsFor(dept.id)} editable={editable}
              enrollCounts={enrollCounts}
              onEditDept={d   => setDeptSlide({ mode: 'edit', data: d })}
              onDeleteDept={d => setDelTarget({ type: 'Department', item: d })}
              onAddSubject={d => setSubSlide({ mode: 'new', data: null, deptId: d.id })}
              onEditSubject={s => setSubSlide({ mode: 'edit', data: s, deptId: s.departmentId })}
              onDeleteSubject={s => setDelTarget({ type: 'Subject', item: s })}
              onEnroll={s => setEnrollSlide(s)}
            />
          ))
        )}
      </div>

      {/* Slide-overs */}
      <SlideOver open={!!deptSlide} onClose={() => setDeptSlide(null)}>
        {deptSlide && <DeptForm initial={deptSlide.mode === 'edit' ? deptSlide.data : null}
          onSave={form => saveDept.mutate({ id: deptSlide.data?.id, data: form })}
          onClose={() => setDeptSlide(null)} saving={saveDept.isPending} />}
      </SlideOver>
      <SlideOver open={!!subSlide} onClose={() => setSubSlide(null)}>
        {subSlide && <SubjectForm initial={subSlide.mode === 'edit' ? subSlide.data : null} departments={depts}
          onSave={form => { const data = { ...form }; if (subSlide.mode === 'new' && subSlide.deptId && !form.departmentId) data.departmentId = subSlide.deptId; saveSub.mutate({ id: subSlide.data?.id, data }); }}
          onClose={() => setSubSlide(null)} saving={saveSub.isPending} />}
      </SlideOver>
      <SlideOver open={!!enrollSlide} onClose={() => setEnrollSlide(null)} wide>
        {enrollSlide && <EnrollSlideOver subject={enrollSlide} onClose={() => setEnrollSlide(null)} flash={flash} />}
      </SlideOver>

      {/* Delete dialog */}
      {delTarget && (
        <DeleteDialog item={delTarget.item} type={delTarget.type}
          onClose={() => setDelTarget(null)}
          deleting={deleteDept.isPending || deleteSub.isPending}
          onConfirm={() => { if (delTarget.type === 'Department') deleteDept.mutate(delTarget.item.id); else deleteSub.mutate(delTarget.item.id); }} />
      )}
    </div>
  );
}
