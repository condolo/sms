/* ============================================================
   ThreadView — one conversation, read as a conversation.

   A thread is (this user, one counterpart), a pairing the server derives
   from the messages themselves — there is no thread document. Rows arrive
   with the rich extras already projected for THIS reader (kind, due date,
   context, the attachment card and the poll with my own vote), so a bubble
   only has to draw them.
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Bell, BookOpen, CalendarClock, CheckCheck, CornerUpLeft,
  FileText, Info, Loader2, MessageSquare, Paperclip, PieChart, Plus, Send, Trash2, Users, X,
} from 'lucide-react';
import clsx from 'clsx';
import {
  ATTACHMENT_MAX_BYTES, MESSAGE_KINDS, POLL_MAX_OPTIONS, POLL_MIN_OPTIONS,
  fmtListDate, isRichKind, roleLabel,
} from '../constants.js';
import Avatar from './Avatar.jsx';
import MessageExtras, { KindBadge } from './RichBlocks.jsx';

/** Icons/tones for the reply kind chips (labels live in constants.js). */
const KIND_ICONS = {
  text: MessageSquare,
  reminder: Bell,
  homework: BookOpen,
  results: FileText,
  poll: PieChart,
};

const KIND_TONES = {
  slate: 'border-slate-300 bg-slate-900 text-white',
  amber: 'border-amber-300 bg-amber-500 text-white',
  sky: 'border-sky-300 bg-sky-600 text-white',
  emerald: 'border-emerald-300 bg-emerald-600 text-white',
  violet: 'border-violet-300 bg-violet-600 text-white',
};

function bubbleTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function BubblesSkeleton() {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map(i => (
        <div key={i} className={clsx('flex animate-pulse', i % 2 ? 'justify-end' : 'justify-start')}>
          <div className="h-16 w-2/3 rounded-2xl bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export default function ThreadView({
  thread, loading, userId, onBack, onReply, replying,
  onVote, votingId = null, onDownloadAttachment, downloadingAttachment, richReply = false,
  showBack = false,
}) {
  const [replyText, setReplyText] = useState('');
  const [replyError, setReplyError] = useState('');
  const [kind, setKind] = useState('text');
  const [dueAt, setDueAt] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [readingFile, setReadingFile] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const scroller = useRef(null);
  const fileInput = useRef(null);
  const messageCount = thread?.messages?.length ?? 0;

  /* Follow the conversation: a new reply (or opening a thread) should put
     the latest bubble in view without the reader hunting for it. */
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messageCount, thread?.counterpart?.id]);

  const counterpart = thread?.counterpart ?? null;
  const messages = thread?.messages ?? [];
  /* "School office" notifications are sent by a synthetic `system` sender, not
     a user account: the server resolves no role for it and refuses a reply
     ("that recipient is no longer available"). There is nobody to write to, so
     the composer is replaced by that explanation instead of a control that can
     only fail. */
  const notAPerson = Boolean(thread) && !counterpart?.role;

  async function pickAttachment(file) {
    setAttachmentError('');
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setAttachmentError('That document is larger than 4 MB.');
      return;
    }
    setReadingFile(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('That document could not be read.'));
        reader.readAsDataURL(file);
      });
      setAttachment({ name: file.name, size: file.size, mimeType: file.type, dataUrl });
    } catch (err) {
      setAttachmentError(err.message || 'That document could not be read.');
    } finally {
      setReadingFile(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function clearExtras() {
    setKind('text');
    setDueAt('');
    setAttachment(null);
    setAttachmentError('');
    setPollQuestion('');
    setPollOptions(['', '']);
  }

  async function send() {
    const text = replyText.trim();
    if (!text || replying) return;

    /* Only the teacher route reads the rich fields; a parent's reply body is
       `{ body, subject? }` and sending extras would be silently discarded. */
    const payload = { body: text };
    if (richReply) {
      payload.kind = kind;
      if (isRichKind(kind)) {
        if (dueAt) payload.dueAt = new Date(dueAt).toISOString();
        if (kind === 'poll') {
          const options = pollOptions.map(o => o.trim()).filter(Boolean);
          if (!pollQuestion.trim() || options.length < POLL_MIN_OPTIONS) {
            setReplyError('A poll needs a question and at least two options.');
            return;
          }
          payload.poll = { question: pollQuestion.trim(), options };
        } else if (attachment) {
          payload.attachment = { name: attachment.name, dataUrl: attachment.dataUrl };
        }
      }
    }

    setReplyError('');
    try {
      await onReply?.(payload);
      setReplyText('');
      clearExtras();
    } catch (err) {
      setReplyError(err?.message || 'Could not send your reply.');
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur sm:px-5">
        <button
          onClick={onBack}
          className={clsx(
            'rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100',
            // The staff workspace is a two-panel layout, so its back button only
            // matters on a phone; the parent portal shows one conversation at a
            // time, so there it is always the way out.
            showBack ? '' : 'lg:hidden',
          )}
          aria-label="Back to conversations"
        >
          <ArrowLeft size={18} />
        </button>
        <Avatar name={counterpart?.name ?? '?'} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-900">{counterpart?.name ?? 'School office'}</p>
          <p className="truncate text-[11px] text-slate-400">
            {roleLabel(counterpart?.role) || 'School account'}
            {messages.length > 0 && ` · ${messages.length} ${messages.length === 1 ? 'message' : 'messages'}`}
          </p>
        </div>
      </div>

      {/* Conversation */}
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {loading && !thread ? (
            <BubblesSkeleton />
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-400">
                <CornerUpLeft size={24} />
              </div>
              <p className="text-xs font-semibold text-slate-600">This conversation is empty</p>
              <p className="mt-1 max-w-xs text-[11px] leading-relaxed text-slate-400">
                Say hello below — your message becomes the first bubble and your
                counterpart gets it in their inbox as usual.
              </p>
            </div>
          ) : (
            messages.map(m => (
              <div
                key={m.id}
                className={clsx('flex gap-2.5', m.mine ? 'justify-end' : 'justify-start')}
              >
                {!m.mine && <Avatar name={counterpart?.name ?? '?'} size="sm" className="mt-1" />}
                <div className={clsx('max-w-[85%] sm:max-w-[75%]', m.mine && 'flex flex-col items-end')}>
                  <div
                    className={clsx(
                      'rounded-2xl border px-4 py-3 shadow-sm',
                      m.mine
                        ? 'border-violet-200 bg-violet-50/80'
                        : 'border-slate-200 bg-white',
                    )}
                  >
                    {(m.kind && m.kind !== 'text') && (
                      <div className="mb-2">
                        <KindBadge kind={m.kind} />
                      </div>
                    )}
                    {m.subject && (
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        {m.subject}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap text-[13px] leading-6 text-slate-700">{m.body}</p>

                    <MessageExtras
                      msg={m}
                      userId={userId}
                      own={m.mine}
                      onVote={onVote}
                      voting={votingId === m.id}
                      onDownload={onDownloadAttachment}
                      downloading={downloadingAttachment}
                      className="mt-3"
                    />

                    {(m.recipientCount ?? 0) > 1 && (
                      <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-400">
                        <Users size={10} /> Sent to {m.recipientCount} people
                      </p>
                    )}
                  </div>
                  <div className={clsx(
                    'mt-1 flex items-center gap-1.5 px-1 text-[10px] text-slate-400',
                    m.mine && 'flex-row-reverse',
                  )}>
                    <span title={m.at}>{bubbleTime(m.at)}</span>
                    {m.mine && (
                      <span className={clsx('inline-flex items-center gap-1', m.read ? 'text-emerald-600' : 'text-slate-400')}>
                        <CheckCheck size={11} /> {m.read ? 'Read' : 'Sent'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Reply */}
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
        <div className="mx-auto max-w-3xl">
          {notAPerson ? (
            <p className="flex items-start gap-2 rounded-xl bg-slate-50 px-3 py-3 text-[11px] leading-relaxed text-slate-500">
              <Info size={12} className="mt-0.5 shrink-0" />
              These are school notifications — there is no one to reply to here. Use Compose to
              message a member of staff.
            </p>
          ) : (
          <>
          {/* Reply extras — only the teacher route accepts them, so a parent
              sees a plain reply box and nothing that would be ignored. */}
          {richReply && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {MESSAGE_KINDS.map(({ value, label, tone }) => {
                const Icon = KIND_ICONS[value] ?? MessageSquare;
                const active = kind === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => { setKind(value); setReplyError(''); }}
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold transition',
                      active
                        ? KIND_TONES[tone]
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300',
                    )}
                  >
                    <Icon size={10} /> {label}
                  </button>
                );
              })}
              {kind !== 'poll' && (
                <>
                  <input
                    ref={fileInput}
                    type="file"
                    className="hidden"
                    onChange={e => pickAttachment(e.target.files?.[0])}
                  />
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={readingFile}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-500 transition hover:border-violet-300 hover:text-violet-600 disabled:opacity-50"
                  >
                    {readingFile ? <Loader2 size={10} className="animate-spin" /> : <Paperclip size={10} />}
                    {attachment ? 'Replace file' : 'Attach'}
                  </button>
                </>
              )}
              {(kind === 'reminder' || kind === 'homework') && (
                <label className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-500">
                  <CalendarClock size={10} />
                  <span className="sr-only">Due by</span>
                  <input
                    type="datetime-local"
                    value={dueAt}
                    onChange={e => setDueAt(e.target.value)}
                    className="bg-transparent text-[10px] text-slate-600 outline-none"
                  />
                </label>
              )}
            </div>
          )}

          {richReply && attachment && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-2.5 py-1.5">
              <FileText size={12} className="shrink-0 text-violet-600" />
              <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700">{attachment.name}</span>
              <button
                type="button"
                onClick={() => setAttachment(null)}
                className="shrink-0 rounded p-0.5 text-slate-400 hover:text-rose-500"
                aria-label="Remove attachment"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {richReply && attachmentError && (
            <p className="mb-1.5 flex items-center gap-1 text-[10px] text-rose-600">
              <AlertTriangle size={10} /> {attachmentError}
            </p>
          )}

          {richReply && kind === 'poll' && (
            <div className="mb-2 space-y-1.5 rounded-xl border border-violet-100 bg-violet-50/40 p-2.5">
              <input
                value={pollQuestion}
                onChange={e => setPollQuestion(e.target.value.slice(0, 140))}
                placeholder="Poll question"
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
              />
              {pollOptions.map((option, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <input
                    value={option}
                    onChange={e => setPollOptions(prev => prev.map((o, i) => (i === index ? e.target.value.slice(0, 80) : o)))}
                    placeholder={`Option ${index + 1}`}
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                  />
                  {pollOptions.length > POLL_MIN_OPTIONS && (
                    <button
                      type="button"
                      onClick={() => setPollOptions(prev => prev.filter((_, i) => i !== index))}
                      className="shrink-0 rounded p-1 text-slate-400 hover:text-rose-500"
                      aria-label={`Remove option ${index + 1}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setPollOptions(prev => [...prev, ''])}
                  disabled={pollOptions.length >= POLL_MAX_OPTIONS}
                  className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-white px-2 py-1 text-[10px] font-semibold text-violet-700 disabled:opacity-45"
                >
                  <Plus size={10} /> Add option
                </button>
                <span className="text-[10px] text-slate-400">{pollOptions.length}/{POLL_MAX_OPTIONS}</span>
              </div>
            </div>
          )}

          <textarea
            value={replyText}
            onChange={e => { setReplyText(e.target.value.slice(0, 4000)); setReplyError(''); }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !(richReply && kind === 'poll')) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            placeholder={`Write to ${counterpart?.name ?? 'this person'}…`}
            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2.5 text-sm leading-relaxed outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:bg-white focus:ring-4 focus:ring-violet-100"
          />
          {replyError && <p className="mt-1 text-[11px] text-rose-600">{replyError}</p>}
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[10px] text-slate-400">
              {replyText.length}/4000 · Shift + Enter for a new line
              {messages.length > 0 && (
                <span className="ml-1.5 hidden text-slate-300 sm:inline">
                  · last activity {fmtListDate(messages[messages.length - 1]?.at)}
                </span>
              )}
            </span>
            <button
              onClick={send}
              disabled={!replyText.trim() || replying}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-700 disabled:opacity-40"
            >
              {replying ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              {replying ? 'Sending…' : 'Send'}
            </button>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  );
}
