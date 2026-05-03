import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { students as studentsApi, classes as classesApi } from '@/api/client.js';
import { Spinner, PageSpinner } from '@/components/ui/Spinner.jsx';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState.jsx';
import { Pagination }             from '@/components/ui/Pagination.jsx';
import { studentStatusBadge }     from '@/components/ui/Badge.jsx';
import useAuthStore from '@/store/auth.js';

const LIMIT  = 20;
const GENDER_OPTIONS  = [{ value: '', label: 'All genders' }, { value: 'M', label: 'Male' }, { value: 'F', label: 'Female' }, { value: 'Other', label: 'Other' }];
const STATUS_OPTIONS  = [{ value: '', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'suspended', label: 'Suspended' }];

export default function StudentList() {
  const navigate = useNavigate();
  const qc       = useQueryClient();
  const can      = useAuthStore((s) => s.can);

  // ─── Filter/pagination state ──────────────────────────────────────────────
  const [search,  setSearch]  = useState('');
  const [classId, setClassId] = useState('');
  const [gender,  setGender]  = useState('');
  const [status,  setStatus]  = useState('active');
  const [page,    setPage]    = useState(1);

  // Debounced search: commit after 400 ms idle
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchTimer, setSearchTimer] = useState(null);
  function onSearchChange(val) {
    setSearch(val);
    clearTimeout(searchTimer);
    setSearchTimer(setTimeout(() => { setDebouncedSearch(val); setPage(1); }, 400));
  }

  function resetPage() { setPage(1); }

  // ─── Classes for filter dropdown ─────────────────────────────────────────
  const { data: classesData } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn:  () => classesApi.list({ limit: 200 }),
    staleTime: 5 * 60 * 1000,
  });
  const classList = classesData?.data ?? [];

  // ─── Students query ───────────────────────────────────────────────────────
  const queryKey = ['students', { page, search: debouncedSearch, classId, gender, status }];
  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () => studentsApi.list({
      page, limit: LIMIT,
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(classId         && { classId }),
      ...(gender          && { gender }),
      ...(status          && { status }),
    }),
    keepPreviousData: true,
    placeholderData:  (prev) => prev,
  });

  const rows       = data?.data        ?? [];
  const pagination = data?.pagination  ?? {};
  const total      = pagination.total  ?? 0;
  const totalPages = pagination.pages  ?? 1;

  // ─── Soft-delete mutation ─────────────────────────────────────────────────
  const { mutate: removeStudent, variables: removingId } = useMutation({
    mutationFn: (id) => studentsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['students'] });
    },
  });

  function confirmRemove(student) {
    if (!window.confirm(`Remove ${student.firstName} ${student.lastName}? This sets their status to inactive.`)) return;
    removeStudent(student._id);
  }

  // ─── UI ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Students</h2>
          {!isLoading && (
            <p className="text-sm text-slate-500 mt-0.5">{total.toLocaleString()} student{total !== 1 ? 's' : ''}</p>
          )}
        </div>
        {can('students') && (
          <Link to="/students/new" className="btn-primary">
            + Add student
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="card !py-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Search */}
        <div className="relative lg:col-span-2">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm select-none">🔍</span>
          <input
            type="search"
            placeholder="Search by name, admission no. or email…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="form-input pl-8"
          />
        </div>

        {/* Class filter */}
        <select
          value={classId}
          onChange={(e) => { setClassId(e.target.value); resetPage(); }}
          className="form-select"
        >
          <option value="">All classes</option>
          {classList.map((c) => (
            <option key={c._id} value={c._id}>{c.name}</option>
          ))}
        </select>

        {/* Status filter */}
        <div className="flex gap-2">
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); resetPage(); }}
            className="form-select flex-1"
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            value={gender}
            onChange={(e) => { setGender(e.target.value); resetPage(); }}
            className="form-select flex-1"
          >
            {GENDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card !p-0 overflow-hidden">
        {/* Fetching indicator */}
        {isFetching && !isLoading && (
          <div className="flex items-center gap-2 px-4 py-2 bg-brand-50 border-b border-brand-100 text-xs text-brand-700">
            <Spinner size="xs" /> Refreshing…
          </div>
        )}

        {isLoading ? (
          <PageSpinner message="Loading students…" />
        ) : isError ? (
          <ErrorState message={error?.message ?? 'Failed to load students.'} onRetry={refetch} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="🎓"
            title="No students found"
            description={debouncedSearch ? 'Try a different search term or clear the filters.' : 'Add your first student to get started.'}
            action={
              debouncedSearch && (
                <button
                  onClick={() => { setSearch(''); setDebouncedSearch(''); setPage(1); }}
                  className="btn-secondary btn-sm"
                >
                  Clear search
                </button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th className="hidden sm:table-cell">Admission No.</th>
                  <th className="hidden md:table-cell">Class</th>
                  <th className="hidden lg:table-cell">Gender</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s._id}
                    className={clsx(removingId === s._id && 'opacity-50 pointer-events-none')}
                  >
                    {/* Name + avatar */}
                    <td>
                      <Link
                        to={`/students/${s._id}`}
                        className="flex items-center gap-3 min-w-0 group"
                      >
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 text-xs font-semibold uppercase select-none">
                          {`${s.firstName?.charAt(0) ?? ''}${s.lastName?.charAt(0) ?? ''}`.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 group-hover:text-brand-600 transition truncate">
                            {s.firstName} {s.lastName}
                          </p>
                          {s.email && (
                            <p className="text-xs text-slate-400 truncate hidden sm:block">{s.email}</p>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="hidden sm:table-cell font-mono text-xs text-slate-500">
                      {s.admissionNumber}
                    </td>
                    <td className="hidden md:table-cell text-slate-600">
                      {s.className ?? '—'}
                    </td>
                    <td className="hidden lg:table-cell text-slate-600">
                      {s.gender === 'M' ? 'Male' : s.gender === 'F' ? 'Female' : s.gender ?? '—'}
                    </td>
                    <td>{studentStatusBadge(s.status)}</td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={`/students/${s._id}`}
                          className="btn-ghost btn-sm btn-icon text-slate-400 hover:text-brand-600"
                          title="View profile"
                        >
                          👁
                        </Link>
                        {can('students') && (
                          <button
                            onClick={() => confirmRemove(s)}
                            className="btn-ghost btn-sm btn-icon text-slate-400 hover:text-red-500"
                            title="Remove student"
                          >
                            🗑
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        limit={LIMIT}
        onPage={setPage}
      />
    </div>
  );
}
