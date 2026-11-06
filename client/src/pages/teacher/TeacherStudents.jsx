/* ============================================================
   Teacher Students — aggregate roster across all my classes
   Route: /teacher/students
   ============================================================ */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Users, ChevronRight, AlertTriangle } from 'lucide-react';
import { teacherPortalApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

export default function TeacherStudents() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.session?.user?.role ?? '');
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState(null);

  const { data: dashData, isLoading: dashLoading } = useQuery({
    queryKey: ['teacher', 'dashboard'],
    queryFn: () => teacherPortalApi.dashboard(),
    staleTime: 60_000,
  });
  const myClasses = dashData?.data?.myClasses ?? [];

  // Load roster for each class.
  const rosterQueries = myClasses.map((cls) => ({
    classId: cls.id,
    className: cls.name,
  }));

  // We'll fetch rosters lazily via individual queries.
  const { data: allRosters } = useQuery({
    queryKey: ['teacher', 'all-rosters', myClasses.map((c) => c.id).join(',')],
    queryFn: async () => {
      const results = await Promise.all(
        myClasses.map(async (cls) => {
          const res = await fetch(`/api/classes/${cls.id}/students?limit=500&status=active`, {
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          });
          const json = await res.json();
          return { classId: cls.id, className: cls.name, students: json?.data ?? [] };
        }),
      );
      return results;
    },
    enabled: myClasses.length > 0,
    staleTime: 30_000,
  });

  const allStudents = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of allRosters ?? []) {
      for (const s of r.students ?? []) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        out.push({ ...s, classId: r.classId, className: r.className });
      }
    }
    return out;
  }, [allRosters]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allStudents.filter((s) => {
      if (classFilter && s.classId !== classFilter) return false;
      if (!q) return true;
      return (
        (s.name ?? '').toLowerCase().includes(q) ||
        (s.admissionNumber ?? '').toLowerCase().includes(q)
      );
    });
  }, [allStudents, search, classFilter]);

  if (dashLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My students</h1>
        <p className="text-sm text-slate-500 mt-1">Every child in your classes.</p>
      </div>

      {/* Search + class filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or admission number"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>
        {myClasses.length > 1 && (
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setClassFilter(null)}
              className={`px-3 py-2 rounded-lg text-sm font-medium ${classFilter === null ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
            >
              All
            </button>
            {myClasses.map((cls) => (
              <button
                key={cls.id}
                onClick={() => setClassFilter(cls.id)}
                className={`px-3 py-2 rounded-lg text-sm font-medium ${classFilter === cls.id ? 'bg-violet-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
              >
                {cls.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Student list */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            {search.trim() ? `No student matches "${search.trim()}".` : 'No students in your classes yet.'}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((s) => (
              <div
                key={s.id}
                onClick={() => navigate(`/students/${s.id}`)}
                className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 cursor-pointer transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center text-violet-700 font-bold text-sm">
                  {(s.name ?? '').split(' ').slice(0, 2).map((p) => p[0]?.toUpperCase()).join('')}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-slate-900 truncate">{s.name}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {s.className}{s.admissionNumber ? ` · ${s.admissionNumber}` : ''}
                  </div>
                  {s.medicalAlert && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-amber-600">
                      <AlertTriangle className="w-3 h-3" />
                      {s.medicalAlert}
                    </div>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-slate-400">
        Showing {filtered.length} of {allStudents.length} students
      </div>
    </div>
  );
}