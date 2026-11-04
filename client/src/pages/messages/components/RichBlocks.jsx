/* ============================================================
   RichBlocks — the shared renderer for message extras.

   One place draws kind / due date / context / attachment / poll so a
   bubble in a thread and a card in the inbox detail say the same thing.
   Everything degrades: no extras → nothing is rendered at all.
   ============================================================ */
import { useState } from 'react';
import {
  AlertTriangle, Bell, BookOpen, CalendarClock, Check, Download, FileText,
  GraduationCap, Link2, Loader2, MessageSquare, PieChart,
} from 'lucide-react';
import clsx from 'clsx';
import {
  contextTypeLabel, extrasFor, fmtDue, fmtFileSize, isRichKind, kindMeta,
} from '../constants.js';

const KIND_ICONS = {
  text: MessageSquare,
  reminder: Bell,
  homework: BookOpen,
  results: GraduationCap,
  poll: PieChart,
};

const TONES = {
  slate: 'border-slate-200 bg-slate-50 text-slate-600',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  sky: 'border-sky-200 bg-sky-50 text-sky-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  violet: 'border-violet-200 bg-violet-50 text-violet-700',
};

/** The little "Homework" / "Poll" chip. `text` kind renders nothing. */
export function KindBadge({ kind, className, withIcon = true }) {
  if (!kind || kind === 'text') return null;
  const meta = kindMeta(kind);
  const Icon = KIND_ICONS[kind] ?? MessageSquare;
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
        TONES[meta.tone] ?? TONES.slate,
        className,
      )}
    >
      {withIcon && <Icon size={8} />}
      {meta.label}
    </span>
  );
}

/** Where a message came from: attendance chase, results follow-up, … */
export function ContextCard({ context, className }) {
  if (!context?.title) return null;
  return (
    <div className={clsx(
      'flex items-start gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2.5',
      className,
    )}>
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-600 shadow-sm">
        <Link2 size={11} />
      </span>
      <div className="min-w-0">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-indigo-500">
          {contextTypeLabel(context.type)}
        </p>
        <p className="truncate text-xs font-semibold text-slate-800">{context.title}</p>
        {context.detail && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{context.detail}</p>
        )}
      </div>
    </div>
  );
}

/** A due date with an honest lead ("overdue", "today", "in 3 days"). */
export function DueChip({ dueAt, className }) {
  const due = fmtDue(dueAt);
  if (!due) return null;
  return (
    <span className={clsx(
      'inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium',
      due.past
        ? 'border-rose-200 bg-rose-50 text-rose-700'
        : 'border-amber-200 bg-amber-50 text-amber-700',
      className,
    )}>
      <CalendarClock size={12} />
      <span className="font-semibold">Due {due.label}</span>
      <span className="opacity-70">· {due.lead}</span>
    </span>
  );
}

/** The document card. Bytes are fetched on demand, never in the list. */
export function AttachmentCard({ attachment, onDownload, downloading, className }) {
  const [localError, setLocalError] = useState('');
  if (!attachment?.id) return null;

  async function handle() {
    if (!onDownload || downloading) return;
    setLocalError('');
    try {
      await onDownload(attachment);
    } catch (err) {
      setLocalError(err?.message || 'Could not download that file.');
    }
  }

  return (
    <div className={clsx('rounded-xl border border-slate-200 bg-white p-2.5', className)}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
          <FileText size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-slate-800">{attachment.name}</p>
          <p className="text-[10px] text-slate-400">
            {[attachment.mimeType, fmtFileSize(attachment.size)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button
          type="button"
          onClick={handle}
          disabled={downloading}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {downloading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
          {downloading ? 'Opening' : 'Download'}
        </button>
      </div>
      {localError && (
        <p className="mt-2 flex items-center gap-1 text-[10px] text-rose-600">
          <AlertTriangle size={10} /> {localError}
        </p>
      )}
    </div>
  );
}

/**
 * The poll. Voting is one choice per recipient and re-voting replaces it;
 * a closed poll refuses. Counts are drawn from `pollForReader`, so the raw
 * inbox shape and the projected thread shape render identically.
 */
export function PollCard({ msg, userId, onVote, voting, own = false, className }) {
  const poll = extrasFor(msg, userId).poll;
  if (!poll) return null;

  /* The poll's author never votes on it: the server's vote route answers
     "Poll not found" for anyone outside the inbox (see messages.js), so
     offering the choice on your own bubble would only ever fail. */
  const canVote = !own && !poll.closed && !voting;
  const total = Math.max(poll.totalVotes, 1);
  const closesLabel = poll.closesAt && !poll.closed
    ? ` · closes ${new Date(poll.closesAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : '';

  return (
    <div className={clsx('rounded-xl border border-violet-100 bg-violet-50/40 p-3', className)}>
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-white text-violet-600 shadow-sm">
          <PieChart size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-800">{poll.question || 'Poll'}</p>
          <p className="text-[10px] text-slate-400">
            {poll.totalVotes} {poll.totalVotes === 1 ? 'vote' : 'votes'}
            {poll.closed ? ' · closed' : own ? ' · you asked this' : poll.myVote ? ' · tap another option to change' : ''}
            {closesLabel}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        {poll.options.map(option => {
          const mine = poll.myVote === option.id;
          const pct = Math.round((option.votes / total) * 100);
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => canVote && onVote?.(msg, option.id)}
              disabled={!canVote}
              className={clsx(
                'group relative w-full overflow-hidden rounded-lg border px-2.5 py-2 text-left transition',
                mine
                  ? 'border-violet-300 bg-white ring-2 ring-violet-200'
                  : 'border-slate-200 bg-white hover:border-violet-200',
                !canVote && 'cursor-default',
              )}
            >
              <span
                className={clsx(
                  'absolute inset-y-0 left-0 transition-all',
                  mine ? 'bg-violet-100/80' : 'bg-slate-100/70',
                )}
                style={{ width: `${pct}%` }}
              />
              <span className="relative flex items-center gap-2">
                <span className={clsx(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                  mine ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-300 bg-white',
                )}>
                  {mine && <Check size={9} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700">
                  {option.text}
                </span>
                <span className="shrink-0 text-[10px] font-semibold text-slate-500">
                  {option.votes} · {pct}%
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {voting && (
        <p className="mt-2 flex items-center gap-1.5 text-[10px] text-violet-600">
          <Loader2 size={10} className="animate-spin" /> Saving your vote…
        </p>
      )}
      {poll.closed && (
        <p className="mt-2 text-[10px] text-slate-400">This poll has closed — results are final.</p>
      )}
    </div>
  );
}

/**
 * Everything a message carries beyond its text, in one stack.
 * Used by the inbox detail card and every thread bubble.
 */
export default function MessageExtras({
  msg, userId, onVote, voting, own = false, onDownload, downloading, className,
}) {
  const { kind, dueAt, context, attachment, poll } = extrasFor(msg, userId);
  if (!isRichKind(kind) && !dueAt && !context && !attachment && !poll) return null;

  return (
    <div className={clsx('space-y-2.5', className)}>
      {context && <ContextCard context={context} />}
      {dueAt && <DueChip dueAt={dueAt} />}
      {attachment && (
        <AttachmentCard
          attachment={attachment}
          onDownload={onDownload}
          downloading={downloading}
        />
      )}
      {poll && <PollCard msg={msg} userId={userId} onVote={onVote} voting={voting} own={own} />}
    </div>
  );
}
