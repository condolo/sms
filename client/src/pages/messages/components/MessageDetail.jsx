import { useState } from 'react';
import {
  AlertTriangle, ArrowLeft, CheckCheck, CornerUpLeft, Loader2,
  Megaphone, MessageSquare, ReplyAll, Send, Trash2, Users,
} from 'lucide-react';
import useAuthStore from '@/store/auth.js';
import {
  audienceLabel, fmtFullDate, roleLabel,
} from '../constants.js';
import Avatar from './Avatar.jsx';

function RecipientPills({ msg }) {
  const audiences = (msg.recipients ?? []).filter(r => r === 'all' || ['teachers', 'parents', 'students', 'staff'].includes(r));
  if (audiences.length) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {audiences.map(a => (
          <span key={a} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-600">
            <Megaphone size={9} className="text-amber-500" />
            {a === 'all' ? 'Everyone' : audienceLabel(a)}
          </span>
        ))}
      </div>
    );
  }

  const people = msg.recipientUsers ?? [];
  if (!people.length) {
    return <span className="text-[11px] text-slate-500">Direct message</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {people.map(u => (
        <span
          key={u.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-0.5 pl-0.5 pr-2 text-[10px] font-medium text-slate-600"
          title={`${u.name}${u.roleLabel || u.role ? ` · ${u.roleLabel || roleLabel(u.role)}` : ''}`}
        >
          <Avatar name={u.name} size="xs" className="!h-4 !w-4 !text-[7px] !ring-0" />
          {u.name}
        </span>
      ))}
    </div>
  );
}

export default function MessageDetail({
  msg, userId, userRole, onDelete, deleting, onBack,
  onReply, onReplyAll, onQuickReply, replying,
}) {
  const can = useAuthStore(s => s.can.bind(s));
  const [confirmDel, setConfirmDel] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyError, setReplyError] = useState('');

  const isModerateFloor = ['superadmin', 'admin', 'deputy_principal'].includes(userRole);
  const canDelete = msg.senderId === userId || isModerateFloor || can('messages__moderate', 'delete');
  const isMine = msg.senderId === userId;
  const isAnnouncement = msg.type === 'announcement';
  const isGroup = !!msg.groupId;
  const participantCount = (msg.recipientUsers?.length ?? 0) + 1;

  async function sendQuickReply() {
    const text = replyText.trim();
    if (!text || replying) return;
    setReplyError('');
    try {
      await onQuickReply?.(msg, text);
      setReplyText('');
    } catch (err) {
      setReplyError(err?.message || 'Could not send reply.');
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      {/* Top bar */}
      <div className="flex shrink-0 items-start gap-3 border-b border-slate-200 bg-white/90 px-4 py-3.5 backdrop-blur sm:px-6">
        <button onClick={onBack} className="mt-0.5 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 lg:hidden">
          <ArrowLeft size={18} />
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {isAnnouncement ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                <Megaphone size={9} /> Announcement
              </span>
            ) : isGroup ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-700">
                <Users size={9} /> Group message
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-700">
                <MessageSquare size={9} /> Direct message
              </span>
            )}
            {msg.createdAt && (
              <span className="text-[10px] text-slate-400">{fmtFullDate(msg.createdAt)}</span>
            )}
          </div>
          <h2 className="truncate text-base font-bold text-slate-900">{msg.subject}</h2>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!isMine && (
            <>
              <button
                onClick={() => onReply?.(msg)}
                title="Reply"
                className="rounded-lg p-2 text-slate-400 transition hover:bg-violet-50 hover:text-violet-600"
              >
                <CornerUpLeft size={16} />
              </button>
              {!isAnnouncement && !isGroup && participantCount > 1 && (
                <button
                  onClick={() => onReplyAll?.(msg)}
                  title="Reply all"
                  className="rounded-lg p-2 text-slate-400 transition hover:bg-violet-50 hover:text-violet-600"
                >
                  <ReplyAll size={16} />
                </button>
              )}
            </>
          )}
          {canDelete && (
            <button
              onClick={() => setConfirmDel(true)}
              title="Delete message"
              className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Scroll area */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {/* Sender card */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-violet-100/80 to-blue-100/60 blur-2xl" />
            <div className="relative flex items-start gap-3">
              <Avatar name={msg.senderName ?? '?'} size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold text-slate-900">{msg.senderName ?? 'Unknown sender'}</p>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                    {roleLabel(msg.senderRole) || 'School account'}
                  </span>
                  {isMine && (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold text-emerald-700">
                      You
                    </span>
                  )}
                </div>
                <div className="mt-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    {isGroup ? 'Group' : isAnnouncement ? 'Audience' : 'To'}
                  </p>
                  {isGroup && (
                    <div className="mb-1.5 flex items-center gap-1.5">
                      <Avatar group name={msg.groupName} size="xs" />
                      <span className="text-xs font-semibold text-slate-700">{msg.groupName}</span>
                    </div>
                  )}
                  <RecipientPills msg={msg} />
                </div>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="h-1 bg-gradient-to-r from-violet-500 via-indigo-500 to-blue-500" />
            <div className="px-5 py-6 sm:px-7 sm:py-8">
              <p className="whitespace-pre-wrap text-[13.5px] leading-7 text-slate-700">{msg.body}</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-2.5 text-[10px] text-slate-400">
              <span className="inline-flex items-center gap-1">
                <CheckCheck size={12} className="text-emerald-500" />
                Delivered in-app{isAnnouncement ? ' as an announcement' : ' as a direct message'}
              </span>
              <span>Recipients also get an email notification when enabled.</span>
            </div>
          </div>

          {/* Quick reply */}
          {!isMine ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <CornerUpLeft size={13} className="text-violet-500" />
                  {isGroup ? `Reply to ${msg.groupName}` : `Reply to ${msg.senderName ?? 'sender'}`}
                </p>
                <span className="text-[10px] text-slate-400">Shift + Enter for a new line</span>
              </div>
              <textarea
                value={replyText}
                onChange={e => { setReplyText(e.target.value); setReplyError(''); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendQuickReply();
                  }
                }}
                rows={3}
                placeholder="Write a quick reply…"
                className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50/40 px-3 py-2.5 text-sm leading-relaxed outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:bg-white focus:ring-4 focus:ring-violet-100"
              />
              {replyError && <p className="mt-1 text-[11px] text-rose-600">{replyError}</p>}
              <div className="mt-2 flex items-center justify-between gap-2">
                <button
                  onClick={() => onReplyAll?.(msg)}
                  className="text-[11px] font-medium text-slate-400 transition hover:text-violet-600"
                >
                  {isGroup ? 'Open full reply' : 'Reply with subject'}
                </button>
                <button
                  onClick={sendQuickReply}
                  disabled={!replyText.trim() || replying}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-[11px] font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40"
                >
                  {replying ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {replying ? 'Sending…' : 'Send reply'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
              <span className="inline-flex items-center gap-2">
                <CheckCheck size={15} /> You sent this message.
              </span>
              <button onClick={() => onReply?.(msg)} className="font-semibold underline underline-offset-2">
                Send again
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                <AlertTriangle size={18} />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">Delete this message?</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  “{msg.subject}” will be permanently removed for every recipient.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDel(false)} className="rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button
                onClick={() => { setConfirmDel(false); onDelete(msg.id); }}
                disabled={deleting}
                className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete message'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
