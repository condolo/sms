/* ============================================================
   BehaviourReplyThread — a parent's conversation about one behaviour
   entry (v5.266.0). Asked for by a parent: "I don't even know who to
   reply to and question."

   Collapsed: a "Reply to teacher" button with the reply count / new
   count. Open: the parent's own thread (oldest first), who a reply
   reaches (display names only, resolved by the server), and a box to
   send. Opening it marks the teacher's answers as read.
   ============================================================ */
import { useState } from 'react';
import { MessageCircle, Send, Loader2 } from 'lucide-react';
import { parentPortal } from '@/api/client.js';

const REASON = { logged: 'logged this', form_teacher: 'form teacher' };

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function BehaviourReplyThread({ childId, incident, onSeen }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [thread, setThread] = useState(null); // { messages, recipients }
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const count = incident.replyCount || 0;
  const unread = incident.unreadReplies || 0;

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await parentPortal.behaviourReplies(childId, incident.id);
      setThread(r.data);
      onSeen?.(incident.id, { replyCount: r.data.messages.length, unreadReplies: 0 });
    } catch (err) {
      setError(err?.message || 'Could not load the conversation.');
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !thread) load();
  }

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError('');
    try {
      const r = await parentPortal.sendBehaviourReply(childId, incident.id, body);
      const messages = [...(thread?.messages ?? []), r.data.message];
      setThread({ messages, recipients: r.data.recipients });
      setDraft('');
      onSeen?.(incident.id, { replyCount: messages.length, unreadReplies: 0 });
    } catch (err) {
      setError(err?.message || 'Could not send your reply.');
    } finally {
      setSending(false);
    }
  }

  const recipients = thread?.recipients ?? [];

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700"
        aria-expanded={open}
      >
        <MessageCircle size={13} />
        {open ? 'Hide conversation' : count ? `Conversation (${count})` : 'Reply to teacher'}
        {!open && unread > 0 && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] leading-none">{unread} new</span>
        )}
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
          {loading ? (
            <p className="text-[11px] text-slate-400 py-2">Loading…</p>
          ) : (
            <>
              {(thread?.messages ?? []).length > 0 && (
                <ul className="space-y-2 mb-2.5">
                  {thread.messages.map(m => (
                    <li key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-lg px-2.5 py-1.5 ${m.mine ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}>
                        <p className={`text-[10px] font-semibold ${m.mine ? 'text-indigo-100' : 'text-slate-500'}`}>
                          {m.mine ? 'You' : m.senderName} · {fmtWhen(m.createdAt)}
                        </p>
                        <p className="text-[12px] whitespace-pre-wrap break-words mt-0.5">{m.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {recipients.length > 0 ? (
                <p className="text-[10px] text-slate-500 mb-1.5">
                  Goes to {recipients.map((r, i) => (
                    <span key={i}>{i > 0 ? (i === recipients.length - 1 ? ' and ' : ', ') : ''}<strong className="font-semibold text-slate-700">{r.name}</strong> ({REASON[r.reason] || 'staff'})</span>
                  ))}
                </p>
              ) : thread && (
                <p className="text-[10px] text-amber-600 mb-1.5">No teacher is linked to this entry any more. Please use Messages to contact the school.</p>
              )}
              {recipients.length > 0 && (
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={e => setDraft(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    placeholder="Ask a question or add a comment…"
                    className="flex-1 text-[12px] px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                  />
                  <button
                    type="button"
                    onClick={send}
                    disabled={!draft.trim() || sending}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-indigo-600 text-white text-[12px] font-semibold disabled:opacity-50"
                  >
                    {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    Send
                  </button>
                </div>
              )}
            </>
          )}
          {error && <p className="text-[11px] text-red-600 mt-1.5">{error}</p>}
        </div>
      )}
    </div>
  );
}
