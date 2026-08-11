/* ============================================================
   Growth Profile — landing page (class → student roster)
   Route: /growth-profile

   Growth Profile previously had no page of its own — it was only
   reachable by already being on a specific student's profile and
   clicking through (StudentProfile.jsx's "Growth Profile" button,
   still there, unchanged). This is the front door: pick a class, see
   its roster, open any student's Growth Profile from here too.

   Sorted the same way every other class-roster view in this app sorts
   (lastName, firstName — server-side, classes.js's GET /:id/students),
   so "who's next" here matches what a class teacher already sees on
   Attendance, the Markbook, etc. — no new arbitrary order.
   ============================================================ */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Sprout, Search, Users, ChevronRight } from 'lucide-react';
import { classes as classesApi } from '@/api/client.js';

/* Same gradient/avatar convention as GrowthProfilePage.jsx's detail view,
   for visual continuity between the roster and the profile it opens. */
const GRADIENTS = [
  'from-violet-500 to-purple-600', 'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-500',  'from-amber-500 to-orange-500',
  'from-pink-500 to-rose-500',     'from-indigo-500 to-blue-500',
];
function avatarGradient(name = '') {
  return GRADIENTS[(name.charCodeAt(0) || 0) % GRADIENTS.length];
}
function initials(first = '', last = '') {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase() || '?';
}

export default function GrowthProfileHome() {
  const navigate = useNavigate();
  const [classId, setClassId] = useState('');
  const [search,  setSearch]  = useState('');

  const { data: classesRes, isLoading: classesLoading } = useQuery({
    queryKey: ['classes', 'list-for-growth-profile'],
    queryFn:  () => classesApi.list({ limit: 200, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const classList = classesRes?.data ?? [];

  const { data: rosterRes, isLoading: rosterLoading } = useQuery({
    queryKey: ['classes', classId, 'students', 'for-growth-profile'],
    queryFn:  () => classesApi.students(classId, { limit: 200, status: 'active' }),
    enabled:  !!classId,
    staleTime: 60_000,
  });
  const roster = rosterRes?.data ?? [];
  const filteredRoster = search.trim()
    ? roster.filter(s => `${s.firstName} ${s.lastName}`.toLowerCase().includes(search.trim().toLowerCase())
        || (s.admissionNumber ?? '').toLowerCase().includes(search.trim().toLowerCase()))
    : roster;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
            <Sprout size={18} className="text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Growth Profile</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Verified learner development — leadership, activities, projects, service, awards, and academic/behaviour history
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-5 space-y-4">
        {/* Class picker + search */}
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={classId}
            onChange={e => setClassId(e.target.value)}
            className="w-full sm:w-64 text-sm px-3 py-2.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-800"
          >
            <option value="">{classesLoading ? 'Loading classes…' : 'Select a class…'}</option>
            {classList.map(c => (
              <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>
            ))}
          </select>

          {classId && (
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search this class by name or admission number…"
                className="w-full text-sm pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-800 placeholder-slate-400"
              />
            </div>
          )}
        </div>

        {/* Roster */}
        {!classId ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3 bg-white rounded-xl border border-slate-200">
            <Users size={28} className="opacity-40" />
            <p className="text-sm">Select a class above to view its students' Growth Profiles</p>
          </div>
        ) : rosterLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-16 bg-white rounded-xl border border-slate-200 animate-pulse" />
            ))}
          </div>
        ) : filteredRoster.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3 bg-white rounded-xl border border-slate-200">
            <Users size={28} className="opacity-40" />
            <p className="text-sm">{search ? 'No students match that search.' : 'No active students in this class yet.'}</p>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredRoster.map(s => {
              const id = s.id ?? s._id;
              return (
                <button
                  key={id}
                  onClick={() => navigate(`/growth-profile/${id}`)}
                  className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 text-left hover:border-slate-300 hover:shadow-sm transition group"
                >
                  <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${avatarGradient(s.firstName)} flex items-center justify-center text-white text-xs font-semibold shrink-0`}>
                    {initials(s.firstName, s.lastName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{s.firstName} {s.lastName}</p>
                    <p className="text-xs text-slate-400 font-mono truncate">{s.admissionNumber ?? '—'}</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-300 group-hover:text-slate-400 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
