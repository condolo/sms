/* ============================================================
   MessagesPage — In-app Messaging & Announcements
   Two-panel layout: message list + detail.
   Supports group recipients (Everyone, Teachers, Parents,
   Students, Staff) and announcements vs direct messages.
   ============================================================ */
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, Plus, Trash2, X, Send, ChevronLeft,
  Check, Inbox, Clock, Users, Globe, Megaphone,
  AlertTriangle,
} from 'lucide-react';
import clsx from 'clsx';
import { messages as msgsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

/* ── constants ───────────────────────────────────────────── */
const RECIPIENT_OPTIONS = [
  { value: 'all',      label: 'Everyone',     desc: 'All active school users' },
  { value: 'teachers', label: 'All Teachers', desc: 'Teachers & section heads' },
  { value: 'parents',  label: 'All Parents',  desc: 'Parent / guardian accounts' },
  { value: 'students', label: 'All Students', desc: 'Student accounts' },
  { value: 'staff',    label: 'All Staff',    desc: 'All non-admin staff roles' },
];

const RECIPIENT_LABELS = {
  all: 'Everyone', teachers: 'All Teachers', parents: 'All Parents',
  students: 'All Students', staff: 'All Staff',
};

function recipientLabel(r) {
  return RECIPIENT_LABELS[r] ?? 'Direct';
}

/* ── date formatter ──────────────────────────────────────── */
function fmtDate(iso) {
  if (!iso) return '';
  const d   = new Date(iso);
  const now = new Date();
  const diff = now - d;
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7)  return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateLong(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/* ── sender avatar ───────────────────────────────────────── */
function Avatar({ name = '?', size = 'md' }) {
  const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const colors = ['bg-violet-500','bg-blue-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-cyan-500'];
  const color  = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className={clsx('shrink-0 rounded-full flex items-center justify-center text-white font-semibold select-none',
      color,
      size === 'lg' ? 'h-11 w-11 text-base' : 'h-9 w-9 text-sm')}>
      {initials}
    </div>
  );
}

/* ── compose slide-over ──────────────────────────────────── */
function ComposeSlideOver({ open, onClose, onSent }) {
  const [form, setForm] = useState({ to: 'all', type: 'announcement', subject: '', body: '' });
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState('');

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); setError(''); }

  async function handleSend() {
    if (!form.subject.trim()) { setError('Subject is required'); return; }
    if (!form.body.trim())    { setError('Message body is required'); return; }
    setSending(true);
    try {
      await msgsApi.send({
        subject:    form.subject.trim(),
        body:       form.body.trim(),
        recipients: [form.to],
        type:       form.type,
      });
      setForm({ to: 'all', type: 'announcement', subject: '', body: '' });
      onSent?.();
      onClose();
    } catch (err) {
      setError(err.extra?.error || err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
          <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed inset-y-0 right-0 z-50 w-full max-w-lg bg-white shadow-2xl flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Send size={17} className="text-violet-600" />
                <h2 className="text-base font-semibold text-slate-900">New Message</h2>
              </div>
              <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

              {/* To */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">To <span className="text-red-500">*</span></label>
                <select value={form.to} onChange={e => set('to', e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500">
                  {RECIPIENT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label} — {opt.desc}</option>
                  ))}
                </select>
              </div>

              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Type</label>
                <div className="flex gap-2">
                  {[
                    { v: 'announcement', icon: <Megaphone size={14} />, label: 'Announcement' },
                    { v: 'direct',       icon: <MessageSquare size={14} />, label: 'Direct Message' },
                  ].map(({ v, icon, label }) => (
                    <button key={v} type="button" onClick={() => set('type', v)}
                      className={clsx('flex-1 flex items-center justify-center gap-2 rounded-lg border py-2 text-sm font-medium transition',
                        form.type === v
                          ? 'bg-violet-50 border-violet-400 text-violet-700'
                          : 'border-slate-300 text-slate-600 hover:border-slate-400')}>
                      {icon}{label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Subject <span className="text-red-500">*</span></label>
                <input value={form.subject} onChange={e => set('subject', e.target.value)}
                  placeholder="Message subject…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
              </div>

              {/* Body */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Message <span className="text-red-500">*</span></label>
                <textarea value={form.body} onChange={e => set('body', e.target.value)}
                  rows={10} placeholder="Write your message here…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none" />
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">
                  <AlertTriangle size={14} className="shrink-0" />
                  {error}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-200 transition">
                Discard
              </button>
              <button onClick={handleSend} disabled={sending || !form.subject.trim() || !form.body.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition font-medium">
                <Send size={14} />
                {sending ? 'Sending…' : 'Send Message'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── message list item ───────────────────────────────────── */
function MessageItem({ msg, selected, isUnread, isSent, onClick }) {
  const preview = (msg.body ?? '').replace(/\n+/g, ' ').slice(0, 90);
  const recs    = (msg.recipients ?? []).map(recipientLabel).join(', ');

  return (
    <button
      onClick={onClick}
      className={clsx(
        'w-full text-left flex items-start gap-3 px-4 py-3.5 border-b border-slate-100 transition hover:bg-slate-50',
        selected && 'bg-violet-50 border-l-2 border-l-violet-500 hover:bg-violet-50',
      )}
    >
      <Avatar name={isSent ? 'Me' : (msg.senderName ?? '?')} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className={clsx('text-sm truncate', isUnread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700')}>
            {isSent ? `To: ${recs}` : (msg.senderName ?? 'Unknown')}
          </span>
          <span className="text-[11px] text-slate-400 shrink-0">{fmtDate(msg.createdAt)}</span>
        </div>
        <p className={clsx('text-sm truncate mb-1', isUnread ? 'text-slate-800 font-medium' : 'text-slate-600')}>
          {msg.subject}
        </p>
        <p className="text-[12px] text-slate-400 truncate">{preview}</p>
        <div className="flex items-center gap-1.5 mt-1.5">
          {msg.type === 'announcement' ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              <Megaphone size={9} />Announcement
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
              <MessageSquare size={9} />Direct
            </span>
          )}
          {isUnread && (
            <span className="h-2 w-2 rounded-full bg-violet-500 shrink-0" />
          )}
        </div>
      </div>
    </button>
  );
}

/* ── message detail ──────────────────────────────────────── */
function MessageDetail({ msg, userId, userRole, onDelete, deleting, onBack }) {
  const recs     = (msg.recipients ?? []).map(recipientLabel).join(', ');
  const canDelete = msg.senderId === userId || ['superadmin', 'admin', 'deputy_principal'].includes(userRole);
  const [confirmDel, setConfirmDel] = useState(false);

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-200 shrink-0">
        {/* Mobile back */}
        <button onClick={onBack} className="lg:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-slate-900 truncate">{msg.subject}</h2>
          <p className="text-xs text-slate-500 mt-0.5">{fmtDateLong(msg.createdAt)}</p>
        </div>
        {canDelete && (
          <button
            onClick={() => setConfirmDel(true)}
            className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition shrink-0"
            title="Delete message"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Meta row */}
      <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 shrink-0">
        <div className="flex items-start gap-3">
          <Avatar name={msg.senderName ?? '?'} size="lg" />
          <div>
            <p className="font-medium text-slate-900 text-sm">{msg.senderName ?? 'Unknown'}</p>
            <p className="text-xs text-slate-500 capitalize">{(msg.senderRole ?? '').replace(/_/g, ' ')}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Users size={11} />To: {recs}
              </span>
              {msg.type === 'announcement' ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                  <Megaphone size={9} />Announcement
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                  <MessageSquare size={9} />Direct Message
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{msg.body}</p>
      </div>

      {/* Delete confirm */}
      <AnimatePresence>
        {confirmDel && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
              <div className="flex items-start gap-3 mb-4">
                <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={20} />
                <div>
                  <p className="font-semibold text-slate-900 text-sm">Delete message?</p>
                  <p className="text-slate-500 text-sm mt-1">
                    "<strong>{msg.subject}</strong>" will be permanently removed for all recipients.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setConfirmDel(false)} className="px-4 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-100">Cancel</button>
                <button onClick={() => { setConfirmDel(false); onDelete(msg.id); }}
                  disabled={deleting}
                  className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── empty state ─────────────────────────────────────────── */
function EmptyDetail() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-8 bg-slate-50/40">
      <MessageSquare size={40} className="text-slate-200 mb-3" />
      <p className="text-sm font-medium text-slate-400">Select a message to read</p>
      <p className="text-xs text-slate-400 mt-1">Choose from the list on the left</p>
    </div>
  );
}

/* ── main page ───────────────────────────────────────────── */
export default function MessagesPage() {
  const user       = useAuthStore(s => s.session?.user);
  const userId     = user?.id;
  const userRole   = user?.role ?? '';
  const qc         = useQueryClient();

  const [tab, setTab]         = useState('inbox');
  const [selected, setSelected] = useState(null);
  const [composing, setComposing] = useState(false);
  const [toast, setToast]     = useState(null);
  const [showDetail, setShowDetail] = useState(false); // mobile: show right panel

  /* ── queries ─────────────────────────────────────────────── */
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['messages', tab],
    queryFn:  () => msgsApi.list({ tab, limit: 100 }),
    staleTime: 30_000,
  });

  const msgs = data?.data ?? [];

  /* ── unread count ─────────────────────────────────────────── */
  const unreadCount = tab === 'inbox'
    ? msgs.filter(m => !m.isRead?.[userId]).length
    : 0;

  /* ── mutations ───────────────────────────────────────────── */
  const markRead = useMutation({
    mutationFn: id => msgsApi.markRead(id),
    onSuccess: (_, id) => {
      qc.setQueryData(['messages', tab], old => {
        if (!old) return old;
        return {
          ...old,
          data: old.data.map(m => m.id === id
            ? { ...m, isRead: { ...(m.isRead ?? {}), [userId]: true } }
            : m
          ),
        };
      });
    },
  });

  const deleteMsg = useMutation({
    mutationFn: id => msgsApi.remove(id),
    onSuccess: () => {
      setSelected(null);
      setShowDetail(false);
      qc.invalidateQueries({ queryKey: ['messages'] });
      flash('Message deleted');
    },
    onError: err => flash(err.extra?.error || err.message || 'Delete failed', 'error'),
  });

  /* ── select a message ────────────────────────────────────── */
  function handleSelect(msg) {
    setSelected(msg);
    setShowDetail(true);
    if (tab === 'inbox' && !msg.isRead?.[userId]) {
      markRead.mutate(msg.id);
    }
  }

  /* ── tab change ──────────────────────────────────────────── */
  function switchTab(t) {
    setTab(t);
    setSelected(null);
    setShowDetail(false);
  }

  function flash(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  return (
    <div className="flex flex-col h-full min-h-screen bg-slate-50">
      {/* ── Page header ─────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-100">
              <MessageSquare size={18} className="text-violet-600" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">Messages</h1>
              <p className="text-xs text-slate-500">School announcements &amp; direct messages</p>
            </div>
          </div>
          <button
            onClick={() => setComposing(true)}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-sm text-white hover:bg-violet-700 transition font-medium"
          >
            <Plus size={15} />
            Compose
          </button>
        </div>
      </div>

      {/* ── Two-panel body ───────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: message list ──────────────────────────────── */}
        <div className={clsx(
          'flex flex-col bg-white border-r border-slate-200 w-full lg:w-80 xl:w-96 shrink-0',
          showDetail ? 'hidden lg:flex' : 'flex',
        )}>
          {/* Tabs */}
          <div className="flex border-b border-slate-200">
            {[
              { id: 'inbox', label: 'Inbox', Icon: Inbox },
              { id: 'sent',  label: 'Sent',  Icon: Clock },
            ].map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => switchTab(id)}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium border-b-2 transition',
                  tab === id
                    ? 'border-violet-600 text-violet-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700',
                )}
              >
                <Icon size={15} />
                {label}
                {id === 'inbox' && unreadCount > 0 && (
                  <span className="ml-0.5 rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] text-white font-bold min-w-[18px] text-center">
                    {unreadCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Message list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="py-20 text-center text-sm text-slate-400">Loading…</div>
            ) : msgs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <MessageSquare size={32} className="text-slate-200 mb-3" />
                <p className="text-sm text-slate-500">
                  {tab === 'inbox' ? 'No messages in your inbox' : 'No messages sent yet'}
                </p>
              </div>
            ) : (
              msgs.map(msg => (
                <MessageItem
                  key={msg.id ?? msg._id}
                  msg={msg}
                  selected={selected?.id === (msg.id ?? msg._id)}
                  isUnread={tab === 'inbox' && !msg.isRead?.[userId]}
                  isSent={tab === 'sent'}
                  onClick={() => handleSelect(msg)}
                />
              ))
            )}
          </div>
        </div>

        {/* ── Right: message detail ────────────────────────────── */}
        <div className={clsx(
          'flex-1 overflow-hidden',
          showDetail ? 'flex flex-col' : 'hidden lg:flex lg:flex-col',
        )}>
          {selected ? (
            <MessageDetail
              msg={selected}
              userId={userId}
              userRole={userRole}
              onDelete={id => deleteMsg.mutate(id)}
              deleting={deleteMsg.isPending}
              onBack={() => { setShowDetail(false); setSelected(null); }}
            />
          ) : (
            <EmptyDetail />
          )}
        </div>
      </div>

      {/* ── Compose ──────────────────────────────────────────── */}
      <ComposeSlideOver
        open={composing}
        onClose={() => setComposing(false)}
        onSent={() => {
          refetch();
          flash('Message sent');
        }}
      />

      {/* ── Toast ────────────────────────────────────────────── */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className={clsx('fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg',
              toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white')}>
            {toast.type !== 'error' && <Check size={15} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
