import clsx from 'clsx';
import { Megaphone, MessageSquare, Users } from 'lucide-react';
import { fmtListDate, recipientSummary } from '../constants.js';
import Avatar from './Avatar.jsx';

export default function MessageRow({ msg, selected, unread, sent, onClick }) {
  const isAnnouncement = msg.type === 'announcement';
  const isGroup = !!msg.groupId;
  const preview = (msg.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 110);
  const title = sent
    ? `To: ${recipientSummary(msg)}`
    : (isGroup ? msg.groupName : (msg.senderName ?? 'Unknown sender'));
  const subtitle = sent ? (msg.senderName ?? 'You') : (isGroup ? (msg.senderName ?? '') : '');
  const avatarName = sent
    ? (msg.recipientUsers?.[0]?.name ?? msg.groupName ?? 'You')
    : (msg.senderName ?? '?');
  const peopleCount = msg.recipientUsers?.length ?? 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'group relative w-full border-b border-slate-100 px-3 py-3 text-left transition',
        'hover:bg-slate-50/90',
        selected && 'bg-violet-50/80 hover:bg-violet-50',
        unread && !selected && 'bg-violet-50/30',
      )}
    >
      <span
        className={clsx(
          'absolute inset-y-2 left-0 w-[3px] rounded-r-full transition',
          selected ? 'bg-violet-600' : unread ? 'bg-violet-300' : 'bg-transparent group-hover:bg-slate-200',
        )}
      />
      <div className="flex items-start gap-3 pl-1.5">
        <div className="relative">
          <Avatar
            name={isGroup ? msg.groupName : avatarName}
            group={isGroup}
            size="md"
            className={unread ? 'ring-violet-200' : undefined}
          />
          {unread && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-violet-600" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex items-baseline justify-between gap-2">
            <span className={clsx(
              'truncate text-[13px]',
              unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700',
            )}>
              {title}
            </span>
            <span className={clsx(
              'shrink-0 text-[10px]',
              unread ? 'font-semibold text-violet-600' : 'text-slate-400',
            )}>
              {fmtListDate(msg.createdAt)}
            </span>
          </div>

          <p className={clsx(
            'truncate text-[12px]',
            unread ? 'font-semibold text-slate-800' : 'font-medium text-slate-600',
          )}>
            {msg.subject}
          </p>
          {subtitle && <p className="truncate text-[10px] text-slate-400">{subtitle}</p>}
          <p className="mt-0.5 truncate text-[11px] leading-relaxed text-slate-400">{preview}</p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {isAnnouncement ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                <Megaphone size={8} /> Announcement
              </span>
            ) : isGroup ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                <Users size={8} /> Group
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[9px] font-semibold text-sky-700">
                <MessageSquare size={8} /> Direct
              </span>
            )}
            {peopleCount > 1 && (
              <span className="text-[9px] font-medium text-slate-400">
                {peopleCount} people
              </span>
            )}
            {unread && (
              <span className="ml-auto rounded-full bg-violet-600 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
                New
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
