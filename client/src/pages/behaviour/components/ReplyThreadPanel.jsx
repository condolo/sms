/* ============================================================
   ReplyThreadPanel — staff view of the parent conversations on one
   behaviour entry (v5.266.0), with a reply box per conversation.
   Opened from the Parent Replies tab and from an Incidents row.
   Opening it marks the parent's messages as read.
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Send, Loader2, MessageCircle } from 'lucide-react';
import { behaviour as behaviourApi } from '@/api/client.js';

const REASON = { logged: 'logged this', form_teacher: 'form teacher' };

function fmtWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function Conversation({ incidentId, thread }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const send = useMutation({
    mutationFn: () => behaviourApi.replies.send(incidentId, thread.parentUserId, draft.trim()),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['behaviour', 'replies'] });
      qc.invalidateQueries({ queryKey: ['behaviour', 'incidents'] });
    },
  });

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-600">
        With {thread.parentName}
      </div>
      <ul className="px-4 py-3 space-y-2.5">
        {thread.messages.map(m => (
          <li key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-lg px-3 py-2 ${m.mine ? 'bg-slate-900 text-white' : m.fromParent ? 'bg-indigo-50 border border-indigo-100 text-slate-800' : 'bg-white border border-slate-200 text-slate-700'}`}>
              <p className={`text-[11px] font-semibold ${m.mine ? 'text-slate-300' : 'text-slate-500'}`}>
                {m.mine ? 'You' : m.senderName}{m.fromParent ? ' (parent)' : ''} · {fmtWhen(m.createdAt)}
              </p>
              <p className="text-sm whitespace-pre-wrap break-words mt-0.5">{m.body}</p>
            </div>
          </li>
        ))}
      </ul>
      {thread.canReply && (
        <div className="px-4 pb-3 flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder={`Reply to ${thread.parentName}…`}
            className="flex-1 text-sm px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900/10 resize-none"
          />
          <button
            type="button"
            onClick={() => send.mutate()}
            disabled={!draft.trim() || send.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-50"
          >
            {send.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Reply
          </button>
        </div>
      )}
      {send.isError && <p className="px-4 pb-3 text-xs text-red-600">{send.error?.message || 'Could not send.'}</p>}
    </div>
  );
}

export default function ReplyThreadPanel({ incidentId, onClose }) {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['behaviour', 'replies', 'thread', incidentId],
    queryFn: async () => {
      const r = await behaviourApi.replies.thread(incidentId);
      // Reading marked them read — refresh the counts elsewhere.
      qc.invalidateQueries({ queryKey: ['behaviour', 'replies', 'inbox'] });
      return r.data;
    },
  });
  const inc = data?.incident;
  const staff = data?.staff ?? [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" onClick={onClose}>
      <div className="w-full max-w-lg h-full bg-white shadow-xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-slate-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5"><MessageCircle size={13} /> Parent replies</p>
            {inc && (
              <>
                <p className="text-sm font-semibold text-slate-900 mt-1">{inc.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {[inc.studentName, inc.subjectName, inc.category, inc.date ? new Date(inc.date).toLocaleDateString('en-GB') : null].filter(Boolean).join(' · ')}
                  {' · '}<span className={(inc.points ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}>{(inc.points ?? 0) > 0 ? '+' : ''}{inc.points ?? 0}</span>
                </p>
              </>
            )}
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-500" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isLoading ? (
            <p className="text-sm text-slate-400">Loading…</p>
          ) : isError ? (
            <p className="text-sm text-red-600">{error?.message || 'Could not load.'}</p>
          ) : !data.threads.length ? (
            <p className="text-sm text-slate-400">No parent has replied on this entry yet.</p>
          ) : (
            data.threads.map(t => <Conversation key={t.threadKey} incidentId={incidentId} thread={t} />)
          )}
          {staff.length > 0 && (
            <p className="text-xs text-slate-400">
              Parent replies go to {staff.map(s => `${s.name} (${REASON[s.reason] || 'staff'})`).join(' and ')}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
