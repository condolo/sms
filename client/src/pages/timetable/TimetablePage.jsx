/* ============================================================
   TimetablePage — orchestration shell
   Handles auth guard, top-level state, shared queries, and
   view routing. All UI lives in ./components/.
   ============================================================ */
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence } from 'framer-motion';
import {
  CalendarDays, Plus, AlertCircle, CheckCircle2, BarChart3,
  Clock, User, LayoutGrid, Globe, UserX, Zap,
} from 'lucide-react';
import {
  timetable    as ttApi,
  classes      as classesApi,
  teachers     as teachersApi,
  bellSchedule as bellApi,
} from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

import TimetablePortal       from './TimetablePortal.jsx';
import { DAYS, DAY_SHORT, SECTIONS, DEFAULT_BELL, inferSection } from './constants.js';
import TimetableGrid          from './components/TimetableGrid.jsx';
import WorkloadPanel          from './components/WorkloadPanel.jsx';
import ConflictsPanel         from './components/ConflictsPanel.jsx';
import AddSlotSlideOver       from './components/AddSlotSlideOver.jsx';
import BellScheduleSlideOver  from './components/BellScheduleSlideOver.jsx';
import OverviewView           from './components/OverviewView.jsx';
import CoverTab               from './components/CoverTab.jsx';
import PublishModal           from './components/PublishModal.jsx';
import { Toast }              from './components/TimetablePrimitives.jsx';

const VIEWS = [
  { id: 'class',    label: 'Class Grid',   Icon: LayoutGrid           },
  { id: 'teacher',  label: 'Teacher View', Icon: User                 },
  { id: 'overview', label: 'Institution',  Icon: Globe                },
  { id: 'cover',    label: 'Cover / Subs', Icon: UserX, adminOnly: true },
];

const ADMIN_ROLES = new Set(['admin', 'superadmin', 'deputy', 'timetabler']);

export default function TimetablePage() {
  const qc    = useQueryClient();
  const can   = useAuthStore(s => s.can.bind(s));
  const role  = useAuthStore(s => s.session?.user?.role  ?? '');
  const roles = useAuthStore(s => s.session?.user?.roles ?? []);

  const canEdit    = can('timetable') || ADMIN_ROLES.has(role);
  const isAdminRole = ADMIN_ROLES.has(role) || roles.some(r => ADMIN_ROLES.has(r));

  // Non-admin roles see the read-only portal
  if (!isAdminRole) return <TimetablePortal />;

  /* ── UI state ────────────────────────────────────────────── */
  const [activeView,      setActiveView]      = useState('class');
  const [classId,         setClassId]         = useState('');
  const [section,         setSection]         = useState('all');
  const [teacherId,       setTeacherId]       = useState('');
  const [showAdd,         setShowAdd]         = useState(false);
  const [addDefaults,     setAddDefaults]     = useState({ day: 'monday', period: '1' });
  const [showWorkload,    setShowWorkload]     = useState(false);
  const [showConflicts,   setShowConflicts]   = useState(false);
  const [showBell,        setShowBell]        = useState(false);
  const [showPublishModal,setShowPublishModal] = useState(false);
  const [toast,           setToast]           = useState(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  /* ── Shared data queries ─────────────────────────────────── */
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'list'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const classList = classesData?.data ?? [];

  const filteredClasses = section === 'all'
    ? classList
    : classList.filter(c => inferSection(c.name) === section);
  const selectedClass = classList.find(c => (c._id ?? c.id) === classId);

  /* Bell schedule — resolved for the selected class's section */
  const classSection = selectedClass ? inferSection(selectedClass.name) : 'all';
  const { data: bellData } = useQuery({
    queryKey: ['bell-schedule', classSection],
    queryFn:  () => bellApi.get(classSection),
    staleTime: 10 * 60_000,
  });
  const bell          = bellData?.data?.periods ?? DEFAULT_BELL;
  const lessonPeriods = bell.filter(b => !b.isBreak);

  const { data: teachersData } = useQuery({
    queryKey: ['teachers', 'picker'],
    queryFn:  () => teachersApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const teacherList = teachersData?.data ?? [];

  /* ── View-specific queries ───────────────────────────────── */
  const { data: classData, isLoading: classLoading, isError: classError } = useQuery({
    queryKey: ['timetable', 'class', classId],
    queryFn:  () => ttApi.byClass(classId),
    enabled:  !!classId && activeView === 'class',
    staleTime: 30_000,
  });
  const classSlots = Array.isArray(classData?.data)
    ? classData.data
    : (classData?.data?.slots ?? []);

  const { data: teacherData, isLoading: teacherLoading } = useQuery({
    queryKey: ['timetable', 'teacher', teacherId],
    queryFn:  () => ttApi.byTeacher(teacherId),
    enabled:  !!teacherId && activeView === 'teacher',
    staleTime: 30_000,
  });
  const teacherSlots = Array.isArray(teacherData?.data)
    ? teacherData.data
    : (teacherData?.data?.slots ?? []);

  const teacherLessonCount = teacherSlots.filter(s => !s.type || s.type === 'lesson').length;
  const teacherByDay = DAYS.map(d => ({
    day: d, count: teacherSlots.filter(s => (s.day || '').toLowerCase() === d).length,
  }));

  const { data: conflictData } = useQuery({
    queryKey: ['timetable', 'conflicts'],
    queryFn:  () => ttApi.conflicts(),
    staleTime: 60_000,
  });
  const conflicts     = conflictData?.data?.conflicts ?? [];
  const conflictCount = conflicts.length;

  const { data: statusData, refetch: refetchStatus } = useQuery({
    queryKey: ['timetable', 'status'],
    queryFn:  () => ttApi.status(),
    staleTime: 30_000,
  });
  const publishStatus = statusData?.data ?? { published: false };

  /* ── Mutations ───────────────────────────────────────────── */
  const invalidateTT = () => {
    qc.invalidateQueries({ queryKey: ['timetable', 'class',   classId] });
    qc.invalidateQueries({ queryKey: ['timetable', 'teacher', teacherId] });
    qc.invalidateQueries({ queryKey: ['timetable', 'conflicts'] });
    qc.invalidateQueries({ queryKey: ['timetable', 'overview'] });
    qc.invalidateQueries({ queryKey: ['timetable', 'workload'] });
  };

  const { mutate: removeSlot } = useMutation({
    mutationFn: id => ttApi.remove(id),
    onSuccess:  () => { invalidateTT(); showToast('Slot removed.'); },
    onError:    err => showToast(err?.message ?? 'Failed to remove slot.', 'error'),
  });

  const { mutate: doPublish, isPending: publishing } = useMutation({
    mutationFn: (termLabel) => ttApi.publish({ termLabel }),
    onSuccess:  () => { refetchStatus(); setShowPublishModal(false); showToast('Timetable published — now visible to staff and parents.'); },
    onError:    err => showToast(err?.message ?? 'Failed to publish.', 'error'),
  });

  const { mutate: doUnpublish, isPending: unpublishing } = useMutation({
    mutationFn: () => ttApi.unpublish(),
    onSuccess:  () => { refetchStatus(); showToast('Timetable unpublished — hidden from portal users.'); },
    onError:    err => showToast(err?.message ?? 'Failed to unpublish.', 'error'),
  });

  /* ── Handlers ────────────────────────────────────────────── */
  const openAdd = useCallback((day, period) => {
    setAddDefaults({ day, period });
    setShowAdd(true);
  }, []);

  function onSlotCreated() {
    setShowAdd(false);
    invalidateTT();
    showToast('Lesson slot added.');
  }

  const selectedTeacher = teacherList.find(t => (t._id ?? t.id) === teacherId);

  /* ══════════════════════════════════════════════════════════
     RENDER
     ══════════════════════════════════════════════════════════ */
  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Page header ── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-screen-2xl mx-auto">

          {/* Title + header actions */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CalendarDays size={18} className="text-slate-400" />
              <div>
                <h1 className="text-base font-semibold text-slate-900 leading-tight">Scheduling Engine</h1>
                <p className="text-xs text-slate-400 mt-0.5">Institutional timetable &amp; coordination</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Conflict badge */}
              <button
                onClick={() => conflictCount > 0 && setShowConflicts(true)}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition ${
                  conflictCount > 0
                    ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                    : 'bg-emerald-50 text-emerald-600 border-emerald-200'
                }`}
              >
                {conflictCount > 0
                  ? <><AlertCircle size={12} /> {conflictCount} conflict{conflictCount !== 1 ? 's' : ''}</>
                  : <><CheckCircle2 size={12} /> No conflicts</>
                }
              </button>

              {/* Workload toggle */}
              <button
                onClick={() => setShowWorkload(s => !s)}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition ${
                  showWorkload
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                <BarChart3 size={12} /> Workload
              </button>

              {/* Bell schedule (admin only) */}
              {canEdit && (
                <button
                  onClick={() => setShowBell(true)}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition"
                >
                  <Clock size={12} /> Bell
                </button>
              )}

              {/* Add slot (class view only) */}
              {canEdit && activeView === 'class' && classId && (
                <button
                  onClick={() => openAdd('monday', '1')}
                  className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition"
                >
                  <Plus size={13} /> Add slot
                </button>
              )}
            </div>
          </div>

          {/* View tabs */}
          <div className="flex gap-1 mt-4">
            {VIEWS.filter(v => !v.adminOnly || canEdit).map(v => (
              <button
                key={v.id}
                onClick={() => setActiveView(v.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  activeView === v.id
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'
                }`}
              >
                <v.Icon size={13} />{v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Publish banner ── */}
      {canEdit && (
        <div className={`px-6 py-2.5 border-b flex items-center justify-between gap-4 text-xs ${
          publishStatus.published ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-center gap-2">
            {publishStatus.published ? (
              <>
                <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                <span className="font-medium text-emerald-700">
                  Published
                  {publishStatus.termLabel  ? ` · ${publishStatus.termLabel}`  : ''}
                  {publishStatus.publishedAt
                    ? ` · ${new Date(publishStatus.publishedAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}`
                    : ''}
                </span>
                <span className="text-emerald-600 hidden sm:inline">— visible to teachers, parents, and section heads</span>
              </>
            ) : (
              <>
                <AlertCircle size={13} className="text-amber-600 shrink-0" />
                <span className="font-medium text-amber-700">Draft — not visible to portal users</span>
                <span className="text-amber-600 hidden sm:inline">Publish when the timetable is ready</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {publishStatus.published ? (
              <button
                onClick={() => { if (window.confirm('Unpublish the timetable? Portal users will no longer see it.')) doUnpublish(); }}
                disabled={unpublishing}
                className="flex items-center gap-1 px-3 py-1 rounded-md border border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-100 transition font-medium"
              >
                {unpublishing ? 'Unpublishing…' : 'Unpublish'}
              </button>
            ) : (
              <button
                onClick={() => setShowPublishModal(true)}
                className="flex items-center gap-1 px-3 py-1 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition font-medium"
              >
                <Zap size={11} /> Publish Timetable
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Context toolbar ── */}
      <div className="bg-white border-b border-slate-100 px-6 py-3">
        <div className="max-w-screen-2xl mx-auto flex items-center gap-3 flex-wrap">
          {activeView === 'class' && (
            <>
              <div className="flex items-center gap-1.5">
                {SECTIONS.map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setSection(s.id); setClassId(''); }}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
                      section === s.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="h-4 border-r border-slate-200" />
              <select
                value={classId}
                onChange={e => setClassId(e.target.value)}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700 max-w-xs"
              >
                <option value="">Select class…</option>
                {filteredClasses.map(c => (
                  <option key={c._id ?? c.id} value={c._id ?? c.id}>{c.name}</option>
                ))}
              </select>
              {selectedClass && (
                <span className="text-xs text-slate-400">{classSlots.length} lessons scheduled</span>
              )}
            </>
          )}

          {activeView === 'teacher' && (
            <>
              <select
                value={teacherId}
                onChange={e => setTeacherId(e.target.value)}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700 max-w-xs"
              >
                <option value="">Select teacher…</option>
                {teacherList.map(t => (
                  <option key={t._id ?? t.id} value={t._id ?? t.id}>{t.firstName} {t.lastName}</option>
                ))}
              </select>
              {selectedTeacher && (
                <span className="text-xs text-slate-400">
                  {teacherLessonCount} lesson{teacherLessonCount !== 1 ? 's' : ''} this week
                  {teacherByDay.some(d => d.count > 0) && (
                    <> · {teacherByDay.filter(d => d.count > 0).map(d => `${DAY_SHORT[d.day]}(${d.count})`).join(' ')}</>
                  )}
                </span>
              )}
            </>
          )}

          {activeView === 'overview' && (
            <span className="text-xs text-slate-500">
              Institution-wide scheduling overview · {classList.length} classes
            </span>
          )}

          {activeView === 'cover' && (
            <span className="text-xs text-slate-500">Daily cover arrangements · substitution management</span>
          )}
        </div>
      </div>

      {/* ── Main content ── */}
      <div className={`max-w-screen-2xl mx-auto px-6 py-5 ${showWorkload ? 'pr-80' : ''} transition-all`}>

        <div className="h-9 mb-3 flex items-center">
          <AnimatePresence>
            {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
          </AnimatePresence>
        </div>

        {activeView === 'class' && (
          !classId ? (
            <div className="bg-white border border-slate-200 rounded-xl p-14 flex flex-col items-center gap-3">
              <CalendarDays size={32} className="text-slate-200" />
              <p className="text-sm font-medium text-slate-400">Select a class above to view its timetable</p>
            </div>
          ) : classLoading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 animate-pulse space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex gap-2">
                  <div className="w-20 h-16 bg-slate-100 rounded" />
                  {DAYS.map(d => <div key={d} className="flex-1 h-16 bg-slate-100 rounded" />)}
                </div>
              ))}
            </div>
          ) : classError ? (
            <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
              <AlertCircle size={20} className="text-red-400" />
              <p className="text-sm text-slate-600">Failed to load timetable.</p>
            </div>
          ) : (
            <TimetableGrid slots={classSlots} onDelete={removeSlot} onAdd={openAdd} canEdit={canEdit} bell={bell} />
          )
        )}

        {activeView === 'teacher' && (
          !teacherId ? (
            <div className="bg-white border border-slate-200 rounded-xl p-14 flex flex-col items-center gap-3">
              <User size={32} className="text-slate-200" />
              <p className="text-sm font-medium text-slate-400">Select a teacher above to view their schedule</p>
            </div>
          ) : teacherLoading ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 animate-pulse space-y-3">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="flex gap-2">
                  <div className="w-20 h-16 bg-slate-100 rounded" />
                  {DAYS.map(d => <div key={d} className="flex-1 h-16 bg-slate-100 rounded" />)}
                </div>
              ))}
            </div>
          ) : (
            <TimetableGrid slots={teacherSlots} onDelete={removeSlot} onAdd={() => {}} canEdit={false} bell={bell} />
          )
        )}

        {activeView === 'overview' && <OverviewView classList={classList} />}
        {activeView === 'cover'    && <CoverTab teachers={teacherList} />}
      </div>

      {/* ── Panels & modals ── */}
      <AnimatePresence>
        {showWorkload  && <WorkloadPanel onClose={() => setShowWorkload(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {showConflicts && (
          <ConflictsPanel conflicts={conflicts} onClose={() => setShowConflicts(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAdd && classId && (
          <AddSlotSlideOver
            classId={classId}
            defaults={addDefaults}
            onClose={() => setShowAdd(false)}
            onCreated={onSlotCreated}
            lessonPeriods={lessonPeriods}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showBell && <BellScheduleSlideOver onClose={() => setShowBell(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {showPublishModal && (
          <PublishModal
            publishing={publishing}
            onPublish={(termLabel) => doPublish(termLabel)}
            onClose={() => setShowPublishModal(false)}
          />
        )}
      </AnimatePresence>

    </div>
  );
}
