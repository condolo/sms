/* ============================================================
   Finance → Extra-Curricular
   The activity catalogue (name and amount per term), and which students are
   enrolled in which activity. Term billing reads both (see TermBillingTab).
   A student is chosen from the school's records: pick a class, then search.
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus } from 'lucide-react';
import {
  extracurricular as ecApi, classes as classesApi, students as studentsApi,
} from '@/api/client.js';

const inputCls = 'w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900/10';

function StudentPicker({ value, onChange }) {
  const [classId, setClassId] = useState('');
  const [search, setSearch]   = useState('');

  const { data: classesResp } = useQuery({
    queryKey: ['ec', 'classes'],
    queryFn:  () => classesApi.list(),
    staleTime: 5 * 60_000,
  });
  const classList = classesResp?.data ?? [];

  const { data: studentsResp, isFetching } = useQuery({
    queryKey: ['ec', 'students', classId, search.trim()],
    queryFn:  () => studentsApi.list({ classId, search: search.trim() || undefined, status: 'active', limit: 20 }),
    enabled:  !!classId,
    staleTime: 30_000,
  });
  const results = studentsResp?.data ?? [];

  return (
    <div className="space-y-2">
      <select value={classId} onChange={e => { setClassId(e.target.value); setSearch(''); onChange(null); }} className={inputCls}>
        <option value="">Select class…</option>
        {classList.map(c => <option key={c.id ?? c._id} value={c.id ?? c._id}>{c.name}</option>)}
      </select>
      {value ? (
        <div className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
          <span>{value.name} <span className="text-slate-500">· {value.admissionNumber ?? '—'}</span></span>
          <button type="button" onClick={() => onChange(null)} className="text-xs text-slate-600 hover:underline">Change</button>
        </div>
      ) : (
        <>
          <input value={search} onChange={e => setSearch(e.target.value)} disabled={!classId}
            placeholder={classId ? 'Search by name or admission number' : 'Choose a class first'}
            className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-400`} />
          {classId && (
            <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
              {isFetching && <p className="px-3 py-2 text-xs text-slate-400">Searching…</p>}
              {!isFetching && results.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">No active students match.</p>}
              {results.map(s => (
                <button key={s.id ?? s._id} type="button"
                  onClick={() => onChange({ id: s.id ?? s._id, name: [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' '), admissionNumber: s.admissionNumber ?? null })}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex justify-between gap-2">
                  <span>{[s.firstName, s.lastName].filter(Boolean).join(' ')}</span>
                  <span className="font-mono text-xs text-slate-500">{s.admissionNumber ?? '—'}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ActivitiesTab({ fmtCurrency, canCreate }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');

  const { data: actResp, isLoading: loadingActs } = useQuery({
    queryKey: ['ec', 'activities'],
    queryFn:  () => ecApi.activities.list(),
    staleTime: 60_000,
  });
  const activities = actResp?.data ?? [];

  const { data: enrResp, isLoading: loadingEnr } = useQuery({
    queryKey: ['ec', 'enrolments'],
    queryFn:  () => ecApi.enrolments.list(),
    staleTime: 30_000,
  });
  const enrolments = enrResp?.data ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ec'] });
  };

  // New activity
  const [newAct, setNewAct] = useState({ name: '', amount: '' });
  const createAct = useMutation({
    mutationFn: () => ecApi.activities.create({ name: newAct.name.trim(), amount: Number(newAct.amount) }),
    onSuccess: () => { setNewAct({ name: '', amount: '' }); setError(''); refresh(); },
    onError: (e) => setError(e.message ?? 'Could not add the activity'),
  });

  // Toggle an activity's status
  const toggleAct = useMutation({
    mutationFn: (a) => ecApi.activities.update(a.id, { status: a.status === 'active' ? 'inactive' : 'active' }),
    onSuccess: refresh,
    onError: (e) => setError(e.message ?? 'Could not change the activity'),
  });

  // New enrolment
  const [student, setStudent] = useState(null);
  const [enrolForm, setEnrolForm] = useState({ activityId: '', startDate: new Date().toISOString().slice(0, 10), endDate: '' });
  const enrol = useMutation({
    mutationFn: () => ecApi.enrolments.create({
      studentId: student.id, activityId: enrolForm.activityId,
      startDate: enrolForm.startDate, endDate: enrolForm.endDate || null,
    }),
    onSuccess: () => { setStudent(null); setEnrolForm(f => ({ ...f, activityId: '', endDate: '' })); setError(''); refresh(); },
    onError: (e) => setError(e.message ?? 'Could not enrol the student'),
  });

  // End an enrolment (kept for history, not deleted)
  const endEnrol = useMutation({
    mutationFn: ({ id, endDate }) => ecApi.enrolments.end(id, endDate),
    onSuccess: () => { setError(''); refresh(); },
    onError: (e) => setError(e.message ?? 'Could not end the enrolment'),
  });

  const activeActs = activities.filter(a => a.status === 'active');

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {/* Catalogue */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Activities and amounts</h3>
        {loadingActs ? <Loader2 className="animate-spin text-slate-400" size={18} /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500">
              <th className="py-2 font-semibold">Activity</th>
              <th className="py-2 font-semibold text-right">Amount per term</th>
              <th className="py-2 font-semibold text-center">Status</th>
              {canCreate && <th />}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {activities.length === 0 && <tr><td colSpan={4} className="py-3 text-slate-400 text-xs">No activities yet.</td></tr>}
              {activities.map(a => (
                <tr key={a.id}>
                  <td className="py-2 text-slate-800">{a.name}</td>
                  <td className="py-2 text-right">{fmtCurrency ? fmtCurrency(a.amount) : a.amount}</td>
                  <td className="py-2 text-center text-xs">{a.status === 'active' ? 'Active' : 'Inactive'}</td>
                  {canCreate && (
                    <td className="py-2 text-right">
                      <button onClick={() => toggleAct.mutate(a)} className="text-xs text-indigo-600 hover:underline">
                        {a.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canCreate && (
          <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-100">
            <label className="flex flex-col gap-1 text-xs text-slate-500">Activity
              <input value={newAct.name} onChange={e => setNewAct(n => ({ ...n, name: e.target.value }))} className={`${inputCls} w-48`} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-500">Amount per term
              <input type="number" min={0} value={newAct.amount} onChange={e => setNewAct(n => ({ ...n, amount: e.target.value }))} className={`${inputCls} w-36`} />
            </label>
            <button onClick={() => createAct.mutate()} disabled={!newAct.name.trim() || newAct.amount === '' || createAct.isPending}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg">
              <Plus size={13} /> Add activity
            </button>
          </div>
        )}
      </section>

      {/* Enrolments */}
      <section className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">Students enrolled</h3>
        {loadingEnr ? <Loader2 className="animate-spin text-slate-400" size={18} /> : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500">
              <th className="py-2 font-semibold">Student</th>
              <th className="py-2 font-semibold">Activity</th>
              <th className="py-2 font-semibold">From</th>
              <th className="py-2 font-semibold">To</th>
              <th className="py-2 font-semibold">Status</th>
              {canCreate && <th />}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {enrolments.length === 0 && <tr><td colSpan={6} className="py-3 text-slate-400 text-xs">No students enrolled yet.</td></tr>}
              {enrolments.map(e => (
                <tr key={e.id}>
                  <td className="py-2">{e.studentName}</td>
                  <td className="py-2">{e.activityName}</td>
                  <td className="py-2 text-xs">{e.startDate}</td>
                  <td className="py-2 text-xs">{e.endDate ?? 'Open'}</td>
                  <td className="py-2 text-xs">{e.status === 'active' ? 'Active' : 'Ended'}</td>
                  {canCreate && (
                    <td className="py-2 text-right">
                      {e.status === 'active' && (
                        <button onClick={() => {
                          const endDate = window.prompt('End date (YYYY-MM-DD)', new Date().toISOString().slice(0, 10));
                          if (endDate) endEnrol.mutate({ id: e.id, endDate });
                        }} className="text-xs text-red-600 hover:underline">End</button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {canCreate && (
          <div className="grid gap-3 md:grid-cols-2 pt-3 border-t border-slate-100">
            <div>
              <p className="text-xs font-medium text-slate-700 mb-1">Student</p>
              <StudentPicker value={student} onChange={setStudent} />
            </div>
            <div className="space-y-2">
              <label className="flex flex-col gap-1 text-xs text-slate-500">Activity
                <select value={enrolForm.activityId} onChange={e => setEnrolForm(f => ({ ...f, activityId: e.target.value }))} className={inputCls}>
                  <option value="">Choose activity…</option>
                  {activeActs.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <div className="flex gap-2">
                <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1">From
                  <input type="date" value={enrolForm.startDate} onChange={e => setEnrolForm(f => ({ ...f, startDate: e.target.value }))} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-500 flex-1">To (optional)
                  <input type="date" value={enrolForm.endDate} onChange={e => setEnrolForm(f => ({ ...f, endDate: e.target.value }))} className={inputCls} />
                </label>
              </div>
              <button onClick={() => enrol.mutate()} disabled={!student || !enrolForm.activityId || !enrolForm.startDate || enrol.isPending}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg">
                <Plus size={13} /> Enrol student
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
