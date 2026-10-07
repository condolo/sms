/* ============================================================
   Msingi — Notification Bell
   Reused next to the profile avatar/menu on every authenticated
   surface (staff TopBar, student/parent portal headers). Scoped to
   what already exists: direct messages, role-group messages, and
   school-wide announcements — the same `messages` collection and
   isRead/userId map GET /api/messages already tracks. No new
   notification type or store; this is a second, more immediate way
   to reach the same inbox, not a parallel one.

   `onSelect(message | null)` is called when the bell should hand off
   to the host: with a message when a specific row was clicked (after
   marking it read), or with null when "View all" was clicked. Each
   host decides what that means — navigate to a Messages page, or
   scroll to an inline messages section — this component has no
   opinion on routing.
   ============================================================ */
import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Bell } from 'lucide-react';
import clsx from 'clsx';
import { messages as messagesApi } from '@/api/client.js';

const POLL_MS = 45_000;

function _timeAgo(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function NotificationBell({ myUserId, onSelect }) {
  const [open, setOpen]   = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);
  const [loadingList, setLoadingList] = useState(false);
  const ref = useRef(null);

  const refreshCount = useCallback(() => {
    messagesApi.unreadCount().then(r => setCount(r?.data?.count ?? 0)).catch(() => {});
  }, []);

  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, POLL_MS);
    return () => clearInterval(t);
  }, [refreshCount]);

  // Marking read happens on a different page (MessagesPage.jsx) or through
  // this bell's own rows — either way, re-sync immediately rather than
  // waiting out the rest of the poll interval.
  useEffect(() => {
    window.addEventListener('messages:read', refreshCount);
    return () => window.removeEventListener('messages:read', refreshCount);
  }, [refreshCount]);

  // "View all" sends the viewer off to read messages elsewhere (the full
  // Messages page, or this portal's own inline section) — re-sync the real
  // count every time a route change lands back on a page this bell renders
  // on, since this component stays mounted across in-app navigation (no
  // remount to trigger the mount effect above again). Catches both "came
  // back after reading everything" and "a new message arrived while away".
  const location = useLocation();
  useEffect(() => { refreshCount(); }, [location.pathname, refreshCount]);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      refreshCount();
      setLoadingList(true);
      messagesApi.list({ tab: 'inbox', limit: 8 })
        .then(r => setItems(r?.data ?? []))
        .catch(() => setItems([]))
        .finally(() => setLoadingList(false));
    }
  }

  function isUnread(m) { return !m.isRead?.[myUserId]; }

  async function handleSelect(m) {
    setOpen(false);
    if (isUnread(m)) {
      setCount(c => Math.max(0, c - 1));
      setItems(prev => prev.map(x => (x.id === m.id ? { ...x, isRead: { ...x.isRead, [myUserId]: true } } : x)));
      messagesApi.markRead(m.id).catch(() => {});
    }
    onSelect?.(m);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        className="relative flex items-center justify-center h-9 w-9 rounded-full text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        aria-label={count > 0 ? `${count} unread notification${count === 1 ? '' : 's'}` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <Bell className="h-[18px] w-[18px]" />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-semibold leading-none">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl bg-white shadow-lg border border-slate-200 py-1 z-50 animate-in fade-in slide-in-from-top-1 duration-100">
          <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-800">Notifications</p>
            {count > 0 && <span className="text-[11px] text-slate-400">{count} unread</span>}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loadingList ? (
              <p className="text-xs text-slate-400 text-center py-6">Loading…</p>
            ) : items.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">Nothing yet</p>
            ) : (
              items.map(m => {
                const unread = isUnread(m);
                return (
                  <button
                    key={m.id}
                    onClick={() => handleSelect(m)}
                    className={clsx(
                      'w-full text-left px-4 py-2.5 flex items-start gap-2.5 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0',
                      unread && 'bg-brand-50/40'
                    )}
                  >
                    <span className={clsx('mt-1.5 h-1.5 w-1.5 rounded-full shrink-0', unread ? 'bg-brand-600' : 'bg-transparent')} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={clsx('text-[12.5px] truncate', unread ? 'font-semibold text-slate-800' : 'font-medium text-slate-600')}>
                          {m.senderName || 'School staff'}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">{_timeAgo(m.createdAt)}</span>
                      </span>
                      <span className="block text-[12px] text-slate-500 truncate">{m.subject}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>

          <button
            onClick={() => { setOpen(false); onSelect?.(null); }}
            className="w-full text-center text-xs font-medium text-brand-600 hover:text-brand-700 py-2.5 border-t border-slate-100"
          >
            View all messages
          </button>
        </div>
      )}
    </div>
  );
}
