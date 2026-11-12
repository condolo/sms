/* ============================================================
   ParentRepliesTab — every parent conversation on a behaviour entry
   this staff member is part of (they logged it, they are the child's
   form teacher, or they answered), newest first, unread highlighted.
   v5.266.0.
   ============================================================ */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { MessageCircle } from 'lucide-react';
import { behaviour as behaviourApi } from '@/api/client.js';
import { EmptyMsg, ErrState } from './BehaviourPrimitives.jsx';
import ReplyThreadPanel from './ReplyThreadPanel.jsx';

export default function ParentRepliesTab() {
  const [openId, setOpenId] = useState(null);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['behaviour', 'replies', 'inbox'],
    queryFn: () => behaviourApi.replies.inbox().then(r => r.data),
    refetchInterval: 60_000,
  });
  const threads = data?.threads ?? [];

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-3">
      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-16 animate-pulse" />)}</div>
      ) : isError ? (
        <ErrState msg={error?.message} onRetry={refetch} />
      ) : !threads.length ? (
        <EmptyMsg icon={<MessageCircle size={36} />} title="No parent replies yet" subtitle="When a parent replies on an entry you logged, or for a student in your form, it appears here" />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {threads.map(t => (
            <button
              key={t.threadKey}
              type="button"
              onClick={() => setOpenId(t.incidentId)}
              className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-3 ${t.unread ? 'bg-indigo-50/40' : ''}`}
            >
              <MessageCircle size={16} className={`mt-0.5 flex-shrink-0 ${t.unread ? 'text-indigo-600' : 'text-slate-400'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800">
                  <span className={t.unread ? 'font-semibold' : 'font-medium'}>{t.parentName}</span>
                  <span className="text-slate-400"> on </span>
                  <span className="font-medium">{t.incident?.title ?? 'a behaviour entry'}</span>
                  {t.incident?.studentName && <span className="text-slate-500"> · {t.incident.studentName}</span>}
                </p>
                <p className="text-xs text-slate-500 truncate mt-0.5">
                  {t.lastMessage.mine ? 'You: ' : `${t.lastMessage.senderName}: `}{t.lastMessage.body}
                </p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-[11px] text-slate-400">{new Date(t.lastMessage.createdAt).toLocaleDateString('en-GB')}</p>
                {t.unread > 0 && <span className="inline-block mt-1 px-1.5 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-semibold">{t.unread} new</span>}
              </div>
            </button>
          ))}
        </div>
      )}
      {openId && <ReplyThreadPanel incidentId={openId} onClose={() => { setOpenId(null); refetch(); }} />}
    </motion.div>
  );
}
