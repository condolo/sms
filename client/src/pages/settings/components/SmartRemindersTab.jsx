/* ============================================================
   Settings → Smart Reminders

   The web half of utils/smart-reminders.js. Three questions a head
   actually asks, in order:

     1. What is running?          — the rules, their audience, the
                                     hour they fire in the school's
                                     own timezone.
     2. Who would get it now?     — Preview runs the SAME detect()
                                     a real send runs, so the list
                                     cannot drift from the message.
     3. Did it already go out?    — last run, and the window it ran
                                     for. "Run now" inside a window
                                     that already sent is refused by
                                     the server, not by this screen,
                                     so the rule holds from cron too.

   Lesson plans are listed but carry no buttons on purpose: that cron
   sweeps every school at once, and a per-school "run now" would
   message the whole platform.
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BellRing, Loader2, Play, Eye, Users, Clock, CalendarClock, CheckCircle2,
  AlertTriangle, Info, MailCheck,
} from 'lucide-react';
import { smartReminders as api } from '@/api/client.js';
import { Toast } from './SettingsPrimitives.jsx';

function _when(iso) {
  if (!iso) return 'never';
  try {
    return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function _schedule(rule) {
  if (rule.scheduleLabel) return rule.scheduleLabel;
  const hour = rule.hour == null ? '' : `${String(rule.hour).padStart(2, '0')}:00`;
  const day = rule.weekday ? `${rule.weekday[0].toUpperCase()}${rule.weekday.slice(1)} ` : 'Daily ';
  return `${day}${hour} school time`;
}

function RuleCard({ rule, onPreview, preview, previewing, onRun, running }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BellRing size={15} className="text-indigo-500" />
            <h3 className="text-sm font-semibold text-slate-800">{rule.label}</h3>
            {rule.lastRun && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                <CheckCircle2 size={10} /> {rule.lastRun.sent} sent
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">{rule.desc}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><Users size={11} /> {rule.audience}</span>
        <span className="inline-flex items-center gap-1"><CalendarClock size={11} /> {_schedule(rule)}</span>
        <span className="inline-flex items-center gap-1"><Clock size={11} /> last run {_when(rule.lastRun?.at)}</span>
      </div>

      {rule.note && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          <Info size={12} className="mt-0.5 shrink-0" /> {rule.note}
        </p>
      )}

      {(rule.previewable || rule.runnable) && (
        <div className="mt-4 flex items-center gap-2">
          {rule.previewable && (
            <button
              type="button"
              onClick={() => onPreview(rule.key)}
              disabled={previewing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {previewing ? <Loader2 size={12} className="animate-spin" /> : <Eye size={12} />} Preview
            </button>
          )}
          {rule.runnable && (
            <button
              type="button"
              onClick={() => onRun(rule.key)}
              disabled={running}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run now
            </button>
          )}
        </div>
      )}

      {preview && (
        <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
          {!preview.previewable ? (
            <p className="text-[11px] text-slate-500">This reminder is scheduled elsewhere and cannot be previewed here.</p>
          ) : preview.total === 0 ? (
            <p className="text-[11px] text-slate-500">Nobody would be messaged right now — nothing needs attention.</p>
          ) : (
            <>
              <p className="text-[11px] font-semibold text-slate-700">
                {preview.total} recipient{preview.total === 1 ? '' : 's'} right now
              </p>
              <ul className="mt-2 space-y-1.5">
                {preview.recipients.slice(0, 8).map((r, i) => (
                  <li key={`${r.userId}-${i}`} className="text-[11px] text-slate-600">
                    <span className="font-medium text-slate-800">{r.name || r.userId}</span>
                    {r.email ? <span className="text-slate-400"> · {r.email}</span> : null}
                    <span className="block text-slate-500">{r.subject}</span>
                  </li>
                ))}
              </ul>
              {preview.total > 8 && (
                <p className="mt-2 text-[11px] text-slate-400">…and {preview.total - 8} more.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function SmartRemindersTab() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);
  const [openKey, setOpenKey] = useState(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['smart-reminders'],
    queryFn:  () => api.list(),
    staleTime: 30_000,
  });
  const rules = data?.data?.rules ?? [];
  const timezone = data?.data?.timezone ?? '';

  const previewMutation = useMutation({
    mutationFn: key => api.preview(key),
    onSuccess: (res, key) => setOpenKey({ key, payload: res?.data ?? null }),
    onError: err => setToast({ msg: err?.message ?? 'Could not build the preview.', type: 'error' }),
  });

  const runMutation = useMutation({
    mutationFn: key => api.run(key, {}),
    onSuccess: res => {
      const out = res?.data ?? {};
      qc.invalidateQueries({ queryKey: ['smart-reminders'] });
      setToast({
        msg: out.skipped
          ? (out.reason || 'This window already went out.')
          : `Sent to ${out.sent} recipient${out.sent === 1 ? '' : 's'}.`,
        type: out.skipped ? 'error' : 'success',
      });
    },
    onError: err => setToast({ msg: err?.message ?? 'The reminder could not be sent.', type: 'error' }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 size={14} className="animate-spin" /> Loading reminders…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertTriangle size={14} /> {error?.message || 'The reminders could not be loaded.'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}

      <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <MailCheck size={15} className="text-indigo-600" /> Smart Reminders
        </h2>
        <p className="mt-1 text-xs text-slate-600 leading-relaxed">
          Nudges the school sends on its own — an exam coming up, a register nobody marked, a notice
          nobody opened. Each one respects the channels you chose in Notifications, and fires in your
          school's timezone{timezone ? ` (${timezone})` : ''}.
        </p>
      </div>

      <div className="grid gap-3">
        {rules.map(rule => (
          <RuleCard
            key={rule.key}
            rule={rule}
            preview={openKey?.key === rule.key ? openKey.payload : null}
            previewing={previewMutation.isPending && previewMutation.variables === rule.key}
            onPreview={key => (openKey?.key === key ? setOpenKey(null) : previewMutation.mutate(key))}
            running={runMutation.isPending && runMutation.variables === rule.key}
            onRun={key => runMutation.mutate(key)}
          />
        ))}
      </div>
    </div>
  );
}
