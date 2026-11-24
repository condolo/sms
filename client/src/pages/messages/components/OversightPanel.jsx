/* ============================================================
   Message oversight — conversations between families and staff, who is
   waiting for a reply, and a reminder to the staff member.
   Read-only: opening one is recorded and marks nothing as read.
   Server: routes/message-oversight.js (decides who may see what).
   ============================================================ */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BellRing, Clock, Eye, Paperclip, Search } from 'lucide-react';
import clsx from 'clsx';
import { messages as msgsApi } from '@/api/client.js';

const DAYS = [7, 30, 90];
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const waited = (h) => (h < 1 ? 'under an hour' : h < 24 ? `${h} h` : `${Math.floor(h / 24)} day${h >= 48 ? 's' : ''}`);
const REMIND_EVERY_MS = 12 * 3600_000;
const recentlyReminded = (r) => !!r && Date.now() - new Date(r.at).getTime() < REMIND_EVERY_MS;

export default function OversightPanel({ onBack, onToast }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('waiting');
  const [days, setDays]     = useState(30);
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [open, setOpen]     = useState(null);   // { staffId, familyId }

  const listQ = useQuery({
    queryKey: ['message-oversight', 'list', { status, days, search, page }],
    queryFn: () => msgsApi.oversight.list({ status, days, search: search || undefined, page }),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
  const rows = listQ.data?.data ?? [];
  const summary = listQ.data?.summary;
  const pages = listQ.data?.pagination?.pages ?? 1;

  // Each opening is logged on the server, so it is never refetched by itself.
  const convQ = useQuery({
    queryKey: ['message-oversight', 'conversation', open?.staffId, open?.familyId],
    queryFn: () => msgsApi.oversight.get(open.staffId, open.familyId),
    enabled: !!open,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const conv = convQ.data?.data;

  const remind = useMutation({
    mutationFn: ({ staffId, familyId }) => msgsApi.oversight.remind(staffId, familyId),
    onSuccess: (res) => {
      onToast?.(`Reminder sent to ${res?.data?.to ?? 'the staff member'}`);
      qc.invalidateQueries({ queryKey: ['message-oversight', 'list'] });
      setOpen(null);
    },
    onError: (err) => onToast?.(err?.message ?? 'Could not send the reminder', 'error'),
  });

  const set = (fn) => (v) => { fn(v); setPage(1); };

  return (
    <div className="flex min-h-0 flex-1 gap-4 px-4 pb-4 pt-4 sm:px-6 sm:pb-5">
      <div className={clsx('min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex lg:w-[440px] lg:shrink-0', open ? 'hidden lg:flex' : 'flex')}>
        <div className="shrink-0 space-y-3 border-b border-slate-200 p-3">
          <div className="flex items-center justify-between gap-2">
            <button onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900">
              <ArrowLeft size={14} /> My messages
            </button>
            {summary && (
              <span className={clsx('rounded-full border px-2.5 py-1 text-[10px] font-semibold', summary.waiting ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
                {summary.waiting ? `${summary.waiting} waiting for a reply` : 'No one is waiting'}
              </span>
            )}
          </div>
          <div className="flex gap-1 rounded-xl bg-slate-100/80 p-1">
            {[['waiting', 'Waiting for reply'], ['all', 'All conversations']].map(([id, label]) => (
              <button key={id} onClick={() => set(setStatus)(id)}
                className={clsx('flex-1 rounded-lg px-2 py-2 text-[11px] font-semibold transition', status === id ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => set(setSearch)(e.target.value)} placeholder="Search staff, parent or learner" aria-label="Search conversations"
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2 pr-3 text-xs text-slate-700 outline-none focus:border-violet-300 focus:bg-white" style={{ paddingLeft: '2.1rem' }} />
            </div>
            <select value={days} onChange={e => set(setDays)(Number(e.target.value))} aria-label="Period" className="rounded-xl border border-slate-200 bg-white px-2 text-xs text-slate-700">
              {DAYS.map(d => <option key={d} value={d}>Last {d} days</option>)}
            </select>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {listQ.isError ? (
            <p className="p-6 text-center text-xs text-rose-600">{listQ.error?.message ?? 'Could not load conversations.'}</p>
          ) : listQ.isLoading ? (
            <p className="p-6 text-center text-xs text-slate-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-8 text-center text-xs text-slate-400">{status === 'waiting' ? 'Every family has had a reply in this period.' : 'No conversations in this period.'}</p>
          ) : rows.map(r => (
            <button key={`${r.staffId}|${r.familyId}`} onClick={() => setOpen({ staffId: r.staffId, familyId: r.familyId })}
              className={clsx('w-full border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50', open?.staffId === r.staffId && open?.familyId === r.familyId && 'bg-violet-50/80')}>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[13px] font-semibold text-slate-800">{r.familyName} <span className="font-normal text-slate-400">({r.familyRole})</span></p>
                <span className="shrink-0 text-[10px] text-slate-400">{fmt(r.lastAt)}</span>
              </div>
              <p className="truncate text-[11px] text-slate-500">To {r.staffName} · {r.staffRole}{r.childName ? ` · about ${r.childName}` : ''}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {r.waitingSince && (
                  <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', r.waitingHours >= 24 ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800')}>
                    <Clock size={10} /> Waiting {waited(r.waitingHours)}
                  </span>
                )}
                {r.lastReminder && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">Reminded {fmt(r.lastReminder.at)}</span>}
              </div>
            </button>
          ))}
        </div>
        {pages > 1 && (
          <div className="flex shrink-0 items-center justify-between border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="font-semibold disabled:opacity-40">Previous</button>
            <span>Page {page} of {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="font-semibold disabled:opacity-40">Next</button>
          </div>
        )}
        {summary?.truncated && <p className="shrink-0 border-t border-slate-100 px-3 py-2 text-[10px] text-amber-700">Showing the newest messages only. Choose a shorter period to see everything in it.</p>}
      </div>

      <div className={clsx('min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm', open ? 'flex' : 'hidden lg:flex')}>
        {!open ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <Eye size={26} className="text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-700">Choose a conversation to read it</p>
            <p className="mt-1 max-w-sm text-xs text-slate-400">You can read and remind, not reply. Each conversation you open is recorded in the audit log, and nothing is marked as read.</p>
          </div>
        ) : convQ.isLoading ? (
          <p className="p-8 text-center text-xs text-slate-400">Loading…</p>
        ) : convQ.isError ? (
          <div className="p-8 text-center">
            <p className="text-xs text-rose-600">{convQ.error?.message ?? 'Could not load this conversation.'}</p>
            <button onClick={() => setOpen(null)} className="mt-2 text-xs font-semibold text-slate-600 underline">Back to the list</button>
          </div>
        ) : conv && (
          <>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <button onClick={() => setOpen(null)} className="text-slate-500 lg:hidden" aria-label="Back to the list"><ArrowLeft size={16} /></button>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{conv.familyName} and {conv.staffName}</p>
                  <p className="text-[11px] text-slate-500">
                    {conv.waitingSince ? `Waiting for ${conv.staffName} since ${fmt(conv.waitingSince)}` : 'Answered'}
                    {conv.lastReminder ? ` · reminded ${fmt(conv.lastReminder.at)}${conv.lastReminder.by ? ` by ${conv.lastReminder.by}` : ''}` : ''}
                  </p>
                </div>
              </div>
              {conv.waitingSince && conv.staffActive && (
                <button onClick={() => remind.mutate(open)} disabled={remind.isPending || recentlyReminded(conv.lastReminder)}
                  title={recentlyReminded(conv.lastReminder) ? 'A reminder was sent in the last 12 hours' : undefined}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50">
                  <BellRing size={13} /> {remind.isPending ? 'Sending…' : recentlyReminded(conv.lastReminder) ? 'Reminded' : 'Remind to reply'}
                </button>
              )}
              {conv.waitingSince && !conv.staffActive && <span className="text-[11px] font-semibold text-rose-600">This staff account is no longer active</span>}
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
              {conv.messages.map(m => (
                <div key={m.id} className={clsx('max-w-[85%] rounded-2xl border px-3.5 py-2.5', m.from === 'staff' ? 'ml-auto border-violet-200 bg-violet-50' : 'border-slate-200 bg-white')}>
                  <p className="text-[10px] font-semibold text-slate-500">{m.from === 'staff' ? conv.staffName : conv.familyName} · {fmt(m.at)}{m.childName ? ` · about ${m.childName}` : ''}</p>
                  {m.subject && <p className="mt-0.5 text-xs font-semibold text-slate-800">{m.subject}</p>}
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-slate-700">{m.body}</p>
                  {m.attachmentName && <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500"><Paperclip size={11} /> {m.attachmentName}</p>}
                </div>
              ))}
            </div>
            <p className="shrink-0 border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">Read only. Opening this conversation was recorded.</p>
          </>
        )}
      </div>
    </div>
  );
}
