/* ============================================================
   MessagesPage — conversations, announcements & saved groups
   ------------------------------------------------------------
   Three ways to reach people:
   • Direct  — one person or a hand-picked set of people
   • Announcement — a staff broadcast to a school audience
   • Group   — a reusable recipient list (class, team, committee)

   The server owns the real authority checks; this page reflects them
   so nobody is offered a mode their role cannot use.
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check, ChevronRight, Inbox, MessageCircle, MessageSquare,
  Plus, Search, Send, Sparkles, UserPlus, Users, X,
} from 'lucide-react';
import clsx from 'clsx';
import { messages as msgsApi, teacherPortalApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';
import {
  canBroadcast, fmtListDate, isPortalRole, matchesSearch, reSubject, roleLabel,
} from './constants.js';
import Avatar from './components/Avatar.jsx';
import ComposePanel from './components/ComposePanel.jsx';
import GroupDetail from './components/GroupDetail.jsx';
import MessageDetail from './components/MessageDetail.jsx';
import MessageRow from './components/MessageRow.jsx';
import ThreadView from './components/ThreadView.jsx';

/* A conversation is the pair (this user, one counterpart). The server can
   pair them for these two roles, and this page is the only place on the web
   that reads them: ProtectedRoute sends parents, guardians and students to
   their own portals, so a parent never reaches this screen (their inbox, with
   no conversation view, is ParentDashboard's MessagesPanel; the parent-portal
   thread routes serve the mobile app). A student account has no pairing route
   at all, so it gets the inbox and sent tabs only. */
const CHAT_ROLES = new Set(['teacher', 'staff']);

const MESSAGE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'direct', label: 'Direct' },
  { id: 'groups', label: 'Groups' },
];

function msgKey(m) {
  return m?.id ?? m?._id;
}

/* ── empty states ─────────────────────────────────────────── */
function EmptyDetail({ tab, onCreateGroup, onCompose }) {
  if (tab === 'groups') {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-slate-50 px-8 text-center">
        <div className="relative mb-5">
          <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-violet-200 to-blue-200 blur-2xl" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 text-white shadow-xl shadow-violet-200">
            <Users size={34} />
          </div>
        </div>
        <h3 className="text-sm font-bold text-slate-800">Reusable groups, one click away</h3>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
          Build a group once for a class, department or committee, then message everyone in it without picking names each time.
        </p>
        <button
          onClick={onCreateGroup}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-700"
        >
          <Plus size={13} /> Create a group
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-slate-50 px-8 text-center">
      <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-violet-100/70 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-blue-100/60 blur-3xl" />
      <div className="relative mb-5">
        <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-violet-200 to-blue-200 blur-2xl" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 text-white shadow-xl shadow-violet-200">
          <MessageSquare size={34} />
        </div>
        <span className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full border-4 border-slate-50 bg-emerald-500 text-white">
          <Check size={13} strokeWidth={3} />
        </span>
      </div>
      <h3 className="relative text-sm font-bold text-slate-800">Your inbox, minus the noise</h3>
      <p className="relative mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
        Pick a conversation on the left to read it, or start a direct message to one person, several people, or a saved group.
      </p>
      <button
        onClick={() => onCompose?.()}
        className="relative mt-4 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-700"
      >
        <Plus size={13} /> New message
      </button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y divide-slate-100">
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="flex animate-pulse items-start gap-3 px-4 py-3.5">
          <div className="h-9 w-9 rounded-full bg-slate-100" />
          <div className="flex-1 space-y-2">
            <div className="h-2.5 w-1/2 rounded bg-slate-100" />
            <div className="h-2.5 w-3/4 rounded bg-slate-100" />
            <div className="h-2 w-2/3 rounded bg-slate-50" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── group list card ─────────────────────────────────────── */
function GroupRow({ group, selected, onClick }) {
  const preview = (group.members ?? []).slice(0, 3);
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'group relative w-full border-b border-slate-100 px-4 py-3.5 text-left transition hover:bg-slate-50',
        selected && 'bg-violet-50/80 hover:bg-violet-50',
      )}
    >
      <span className={clsx(
        'absolute inset-y-2 left-0 w-[3px] rounded-r-full',
        selected ? 'bg-violet-600' : 'bg-transparent group-hover:bg-slate-200',
      )} />
      <div className="flex items-center gap-3 pl-1">
        <Avatar group name={group.name} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-[13px] font-semibold text-slate-800">{group.name}</p>
            <span className="shrink-0 text-[10px] text-slate-400">{group.memberCount ?? 0}</span>
          </div>
          <p className="truncate text-[11px] text-slate-400">
            {group.memberCount ?? 0} members{group.createdByName ? ` · ${group.createdByName}` : ''}
          </p>
          <div className="mt-1.5 flex items-center gap-1">
            {preview.map(m => (
              <Avatar key={m.id} name={m.name} size="xs" className="!h-5 !w-5 !text-[8px] !ring-1" />
            ))}
            {(group.memberCount ?? 0) > 3 && (
              <span className="ml-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
                +{(group.memberCount ?? 0) - 3}
              </span>
            )}
          </div>
        </div>
        <ChevronRight size={15} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-400" />
      </div>
    </button>
  );
}

/* ── main page ───────────────────────────────────────────── */
export default function MessagesPage() {
  const user = useAuthStore(s => s.session?.user);
  const userId = user?.id;
  const userRole = user?.role ?? '';
  const portal = isPortalRole(userRole);
  const broadcastAllowed = canBroadcast(userRole);
  const qc = useQueryClient();

  const [tab, setTab] = useState('inbox');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [pickingChat, setPickingChat] = useState(false);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const [composing, setComposing] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const chatCapable = CHAT_ROLES.has(userRole);
  /* Only the teacher portal pairs conversations for a role that can reach
     this page (see CHAT_ROLES above), so there is no parent branch here. */
  const chatApi = teacherPortalApi;
  const canStartChat = chatCapable;

  const messageQuery = useQuery({
    queryKey: ['messages', tab],
    queryFn: () => msgsApi.list({ tab, limit: 100 }),
    enabled: tab !== 'groups' && tab !== 'chats',
    staleTime: 15_000,
  });

  const groupsQuery = useQuery({
    queryKey: ['message-groups'],
    queryFn: () => msgsApi.groups.list(),
    staleTime: 30_000,
  });

  const unreadQuery = useQuery({
    queryKey: ['messages', 'unread-count'],
    queryFn: () => msgsApi.unreadCount(),
    staleTime: 20_000,
  });

  const threadsQuery = useQuery({
    queryKey: ['message-threads'],
    queryFn: () => chatApi.inbox(),
    enabled: tab === 'chats' && chatCapable,
    staleTime: 15_000,
  });

  const threadQuery = useQuery({
    queryKey: ['message-thread', selectedThreadId],
    queryFn: () => chatApi.threads.get(selectedThreadId),
    enabled: tab === 'chats' && !!selectedThreadId && chatCapable,
    staleTime: 0,
  });

  /* The address book behind "New chat". Only the teacher portal has one —
     parents start a conversation from Compose, which lands as a thread. */
  const contactsQuery = useQuery({
    queryKey: ['teacher-message-contacts'],
    queryFn: () => teacherPortalApi.messageContacts(),
    enabled: pickingChat && canStartChat,
    staleTime: 60_000,
  });

  const msgs = (tab === 'groups' || tab === 'chats') ? [] : (messageQuery.data?.data ?? []);
  const groups = groupsQuery.data?.data ?? [];
  const threads = threadsQuery.data?.data?.threads ?? [];
  const contacts = contactsQuery.data?.data?.contacts ?? [];
  const selected = msgs.find(m => msgKey(m) === selectedId) ?? null;
  const selectedGroup = groups.find(g => g.id === selectedGroupId) ?? null;
  const unreadCount = unreadQuery.data?.data?.count ?? 0;
  /* Only conversations with a person count toward the Chats badge — see
     filteredThreads below for why `system` is excluded. */
  const threadUnread = threads
    .filter(t => t.counterpartUserId !== 'system' && t.role)
    .reduce((sum, t) => sum + (t.unread ?? 0), 0);

  const filteredMessages = useMemo(() => {
    return msgs.filter(m => {
      if (!matchesSearch(m, search)) return false;
      if (filter === 'unread') return tab === 'inbox' && !m.isRead?.[userId];
      if (filter === 'announcements') return m.type === 'announcement';
      if (filter === 'direct') return m.type !== 'announcement' && !m.groupId;
      if (filter === 'groups') return !!m.groupId;
      return true;
    });
  }, [msgs, search, filter, tab, userId]);

  const filteredGroups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return groups;
    return groups.filter(g =>
      g.name?.toLowerCase().includes(needle)
      || (g.members ?? []).some(m => m.name?.toLowerCase().includes(needle)),
    );
  }, [groups, search]);

  function flash(msg, type = 'success') {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }

  /* ── mark read ─────────────────────────────────────────── */
  const markRead = useMutation({
    mutationFn: id => msgsApi.markRead(id),
    onSuccess: (_, id) => {
      qc.setQueriesData({ queryKey: ['messages'] }, old => {
        if (!old?.data || !Array.isArray(old.data)) return old;
        return {
          ...old,
          data: old.data.map(m => msgKey(m) === id
            ? { ...m, isRead: { ...(m.isRead ?? {}), [userId]: true } }
            : m),
        };
      });
      qc.invalidateQueries({ queryKey: ['messages', 'unread-count'] });
      window.dispatchEvent(new CustomEvent('messages:read'));
    },
  });

  async function markAllRead() {
    const unread = msgs.filter(m => !m.isRead?.[userId]);
    await Promise.allSettled(unread.map(m => msgsApi.markRead(msgKey(m))));
    qc.invalidateQueries({ queryKey: ['messages'] });
    window.dispatchEvent(new CustomEvent('messages:read'));
    flash('Inbox marked as read');
  }

  function openMessage(msg) {
    setSelectedId(msgKey(msg));
    setShowMobileDetail(true);
    if (tab === 'inbox' && !msg.isRead?.[userId]) {
      markRead.mutate(msgKey(msg));
    }
  }

  function switchTab(next) {
    setTab(next);
    setFilter('all');
    setSearch('');
    setSelectedId(null);
    setSelectedGroupId(null);
    setSelectedThreadId(null);
    setPickingChat(false);
    setShowMobileDetail(false);
  }

  function openThread(counterpartUserId) {
    setSelectedThreadId(counterpartUserId);
    setPickingChat(false);
    setShowMobileDetail(true);
  }

  function selectGroup(group) {
    setSelectedGroupId(group.id);
    setShowMobileDetail(true);
  }

  /* ── delete ────────────────────────────────────────────── */
  const deleteMsg = useMutation({
    mutationFn: id => msgsApi.remove(id),
    onSuccess: () => {
      setSelectedId(null);
      setShowMobileDetail(false);
      qc.invalidateQueries({ queryKey: ['messages'] });
      flash('Message deleted');
    },
    onError: err => flash(err.message || 'Delete failed', 'error'),
  });

  /* ── quick reply ───────────────────────────────────────── */
  const quickReply = useMutation({
    mutationFn: ({ msg, body }) => {
      const payload = {
        subject: reSubject(msg.subject),
        body,
        type: 'direct',
      };
      if (msg.groupId) payload.groupId = msg.groupId;
      else payload.recipients = [msg.senderId];
      return msgsApi.send(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages'] });
      flash('Reply sent');
    },
    onError: err => flash(err.message || 'Reply failed', 'error'),
  });

  /* ── poll vote ─────────────────────────────────────────── */
  const votePoll = useMutation({
    mutationFn: ({ messageId, optionId }) => msgsApi.vote(messageId, optionId),
    onSuccess: (res, vars) => {
      const poll = res?.data;
      if (poll && vars?.messageId) {
        /* The vote route answers with the poll as THIS reader sees it, so
           patch it in place instead of refetching the whole list. */
        qc.setQueriesData({ queryKey: ['messages'] }, old => {
          if (!old?.data || !Array.isArray(old.data)) return old;
          return {
            ...old,
            data: old.data.map(m => (msgKey(m) === vars.messageId ? { ...m, poll } : m)),
          };
        });
        qc.setQueriesData({ queryKey: ['message-thread'] }, old => {
          if (!old?.data?.messages) return old;
          return {
            ...old,
            data: {
              ...old.data,
              messages: old.data.messages.map(m => (m.id === vars.messageId ? { ...m, poll } : m)),
            },
          };
        });
      }
      flash('Vote saved');
    },
    onError: err => flash(err.message || 'Could not save your vote', 'error'),
  });

  /* ── attachment download (bytes on demand) ─────────────── */
  const attachmentDownload = useMutation({
    mutationFn: id => msgsApi.attachment(id),
  });

  /* ── thread reply ──────────────────────────────────────── */
  const threadReply = useMutation({
    /* `payload` already carries whatever the reply composer built — a plain
       body for a parent, or body + kind/due/poll/document for a teacher
       (only the teacher route accepts extras; see server/routes/teacher-portal.js). */
    mutationFn: ({ counterpartId, payload }) => chatApi.threads.reply(counterpartId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['message-thread', selectedThreadId] });
      qc.invalidateQueries({ queryKey: ['message-threads'] });
      qc.invalidateQueries({ queryKey: ['messages'] });
      flash('Reply sent');
    },
    onError: err => flash(err.message || 'Reply failed', 'error'),
  });

  /* Opening a conversation reads it server-side in one write; reflect that
     here rather than leaving a stale unread badge behind. */
  useEffect(() => {
    if (!threadQuery.data) return;
    qc.invalidateQueries({ queryKey: ['message-threads'] });
    qc.invalidateQueries({ queryKey: ['messages', 'unread-count'] });
    window.dispatchEvent(new CustomEvent('messages:read'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadQuery.data]);

  /* ── groups ────────────────────────────────────────────── */
  const updateGroup = useMutation({
    mutationFn: ({ id, data }) => msgsApi.groups.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['message-groups'] });
      flash('Group updated');
    },
    onError: err => flash(err.message || 'Could not update group', 'error'),
  });

  const deleteGroup = useMutation({
    mutationFn: id => msgsApi.groups.remove(id),
    onSuccess: () => {
      setSelectedGroupId(null);
      setShowMobileDetail(false);
      qc.invalidateQueries({ queryKey: ['message-groups'] });
      flash('Group deleted');
    },
    onError: err => flash(err.message || 'Could not delete group', 'error'),
  });

  /* ── compose prefill ───────────────────────────────────── */
  function openCompose(initial = {}) {
    setComposing(initial);
  }

  /* A hand-off from another page (today: the teacher's attendance sheet
     "message the guardian") arrives as a one-shot payload in sessionStorage,
     read and removed here so a reload cannot silently re-open the composer
     with somebody else's draft. */
  useEffect(() => {
    let raw = null;
    try {
      raw = sessionStorage.getItem('messages:prefill');
      if (raw) sessionStorage.removeItem('messages:prefill');
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const prefill = JSON.parse(raw);
      if (prefill && typeof prefill === 'object') openCompose(prefill);
    } catch {
      /* a corrupt payload is not worth an error screen */
    }
    // Runs once per mount: the payload is consumed, not observed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function replyPrefill(msg, includeAll = false) {
    const subject = reSubject(msg.subject);
    if (msg.groupId) {
      return openCompose({ mode: 'group', groupId: msg.groupId, subject });
    }
    if (msg.senderId === userId) {
      if (msg.type === 'announcement') {
        const audience = (msg.recipients ?? []).find(r => ['all', 'teachers', 'parents', 'students', 'staff'].includes(r)) ?? 'all';
        return openCompose({ mode: 'announcement', audience, subject });
      }
      return openCompose({
        recipients: (msg.recipientUsers ?? []).map(u => ({
          id: u.id, name: u.name, role: u.role, roleLabel: u.roleLabel,
        })),
        subject,
      });
    }

    const ids = new Set();
    if (msg.senderId) ids.add(msg.senderId);
    if (includeAll) {
      for (const u of msg.recipientUsers ?? []) ids.add(u.id);
    }
    ids.delete(userId);

    const recipients = [...ids].map(id => {
      const known = (msg.recipientUsers ?? []).find(u => u.id === id);
      if (known) return { id, name: known.name, role: known.role, roleLabel: known.roleLabel };
      if (id === msg.senderId) {
        return {
          id,
          name: msg.senderName ?? 'Sender',
          role: msg.senderRole,
          roleLabel: roleLabel(msg.senderRole),
        };
      }
      return { id, name: 'Recipient', role: '' };
    });

    openCompose({
      recipients,
      subject,
      mode: 'direct',
    });
  }

  function handleSent() {
    qc.invalidateQueries({ queryKey: ['messages'] });
    qc.invalidateQueries({ queryKey: ['message-groups'] });
    flash('Message sent');
  }

  const messageTabs = [
    { id: 'inbox', label: 'Inbox', icon: Inbox },
    { id: 'sent', label: 'Sent', icon: Send },
    ...(chatCapable ? [{ id: 'chats', label: 'Chats', icon: MessageCircle }] : []),
    ...(!portal ? [{ id: 'groups', label: 'Groups', icon: Users }] : []),
  ];

  const visibleFilters = MESSAGE_FILTERS.filter(f => f.id !== 'unread' || tab === 'inbox');
  const listLoading = tab === 'groups'
    ? groupsQuery.isLoading
    : tab === 'chats'
      ? threadsQuery.isLoading
      : messageQuery.isLoading;

  const filteredThreads = useMemo(() => {
    /* A conversation needs a person. `system` is the synthetic sender behind
       school notifications (weekly snapshots, notices) — the server resolves
       no role for it and refuses a reply, so it belongs in the inbox, not in
       a list of people to talk to. */
    const people = threads.filter(t => t.counterpartUserId !== 'system' && t.role);
    const needle = search.trim().toLowerCase();
    if (!needle) return people;
    const matches = (t) =>
      (t.name ?? '').toLowerCase().includes(needle)
      || (t.subject ?? '').toLowerCase().includes(needle)
      || (t.preview ?? '').toLowerCase().includes(needle);
    return people.filter(matches);
  }, [threads, search]);

  const filteredContacts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const sorted = [...contacts].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    if (!needle) return sorted;
    return sorted.filter(c => (c.name ?? '').toLowerCase().includes(needle));
  }, [contacts, search]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50/80">
      {/* Page header */}
      <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-5">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.13),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.10),transparent_38%)]" />
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 text-white shadow-lg shadow-violet-200">
                <MessageSquare size={21} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-lg font-bold text-slate-900">Messages</h1>
                  <span className="hidden rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-600 sm:inline-flex">
                    Communication
                  </span>
                </div>
                <p className="truncate text-[11px] text-slate-400 sm:text-xs">
                  Direct conversations, school announcements and reusable groups.
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span className={clsx(
                'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold sm:inline-flex',
                unreadCount > 0
                  ? 'border-violet-200 bg-violet-50 text-violet-700'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-700',
              )}>
                {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
              </span>
              <button
                onClick={() => openCompose({})}
                className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2.5 text-xs font-semibold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-700 active:scale-[0.98]"
              >
                <Plus size={14} /> <span className="hidden sm:inline">Compose</span><span className="sm:hidden">New</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Two-panel workspace */}
      <div className="flex min-h-0 flex-1 gap-4 px-4 pb-4 pt-4 sm:px-6 sm:pb-5">
        {/* Left column */}
        <div className={clsx(
          'min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm',
          'lg:flex lg:w-[380px] xl:w-[420px] lg:shrink-0',
          showMobileDetail ? 'hidden lg:flex' : 'flex',
        )}>
          {/* Tabs */}
          <div className="shrink-0 border-b border-slate-200 px-3 pt-3">
            <div className="flex gap-1 rounded-xl bg-slate-100/80 p-1">
              {messageTabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => switchTab(id)}
                  className={clsx(
                    'relative flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold transition',
                    tab === id
                      ? 'bg-white text-violet-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700',
                  )}
                >
                  <Icon size={13} />
                  {label}
                  {id === 'inbox' && unreadCount > 0 && (
                    <span className="ml-0.5 rounded-full bg-violet-600 px-1.5 py-0.5 text-[8px] font-bold leading-none text-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                  {id === 'groups' && groups.length > 0 && (
                    <span className="ml-0.5 rounded-full bg-slate-200 px-1.5 py-0.5 text-[8px] font-bold leading-none text-slate-600">
                      {groups.length}
                    </span>
                  )}
                  {id === 'chats' && threadUnread > 0 && (
                    <span className="ml-0.5 rounded-full bg-violet-600 px-1.5 py-0.5 text-[8px] font-bold leading-none text-white">
                      {threadUnread > 99 ? '99+' : threadUnread}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Search */}
          <div className="shrink-0 px-3 py-3">
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={
                  tab === 'groups' ? 'Search groups or members…'
                    : tab === 'chats' ? (pickingChat ? 'Search people…' : 'Search conversations…')
                      : 'Search messages or people…'
                }
                className="w-full rounded-xl border border-slate-200 bg-slate-50/60 py-2 pr-8 text-xs text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:bg-white focus:ring-4 focus:ring-violet-100"
                style={{ paddingLeft: '2.1rem' }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Clear search"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Filter chips / group action */}
          {tab === 'groups' ? (
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 pb-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {groups.length} saved {groups.length === 1 ? 'group' : 'groups'}
              </p>
              <button
                onClick={() => openCompose({ mode: 'group', createNew: true })}
                className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700 transition hover:bg-violet-100"
              >
                <Plus size={10} /> New group
              </button>
            </div>
          ) : tab === 'chats' ? (
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 pb-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {pickingChat
                  ? `${filteredContacts.length} ${filteredContacts.length === 1 ? 'person' : 'people'}`
                  : `${threads.length} ${threads.length === 1 ? 'conversation' : 'conversations'}`}
              </p>
              {canStartChat && (
                <button
                  onClick={() => { setPickingChat(v => !v); setSearch(''); }}
                  className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700 transition hover:bg-violet-100"
                >
                  {pickingChat ? <X size={10} /> : <UserPlus size={10} />}
                  {pickingChat ? 'Cancel' : 'New chat'}
                </button>
              )}
            </div>
          ) : (
            <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-slate-100 px-3 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {visibleFilters.map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={clsx(
                    'whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-semibold transition',
                    filter === f.id
                      ? 'border-violet-300 bg-violet-100 text-violet-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {/* Mark all read */}
          {tab === 'inbox' && unreadCount > 0 && filteredMessages.some(m => !m.isRead?.[userId]) && (
            <div className="flex shrink-0 items-center justify-between border-b border-violet-100 bg-violet-50/70 px-3 py-1.5">
              <span className="text-[10px] font-semibold text-violet-700">
                {filteredMessages.filter(m => !m.isRead?.[userId]).length} unread in view
              </span>
              <button
                onClick={markAllRead}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-violet-700 transition hover:text-violet-900"
              >
                <Check size={11} /> Mark all read
              </button>
            </div>
          )}

          {/* List */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {listLoading ? (
              <ListSkeleton />
            ) : tab === 'groups' ? (
              filteredGroups.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-14 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                    <Users size={22} />
                  </div>
                  <p className="text-xs font-semibold text-slate-600">
                    {search ? 'No groups match that search' : 'No saved groups yet'}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {search ? 'Try a different name or member.' : 'Create one for a class, department or committee.'}
                  </p>
                  {!search && (
                    <button
                      onClick={() => openCompose({ mode: 'group', createNew: true })}
                      className="mt-3 inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-violet-700"
                    >
                      <Plus size={11} /> New group
                    </button>
                  )}
                </div>
              ) : (
                filteredGroups.map(g => (
                  <GroupRow
                    key={g.id}
                    group={g}
                    selected={selectedGroupId === g.id}
                    onClick={() => selectGroup(g)}
                  />
                ))
              )
            ) : tab === 'chats' ? (
              pickingChat ? (
                filteredContacts.length === 0 ? (
                  <div className="flex flex-col items-center px-6 py-14 text-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                      <UserPlus size={22} />
                    </div>
                    <p className="text-xs font-semibold text-slate-600">No people match that name</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Try a different spelling, or send a plain message from Compose.
                    </p>
                  </div>
                ) : (
                  filteredContacts.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => openThread(c.id)}
                      className="group flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition hover:bg-slate-50"
                    >
                      <Avatar name={c.name ?? '?'} size="md" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-slate-800">{c.name}</p>
                        <p className="truncate text-[11px] text-slate-400">
                          {[roleLabel(c.role), c.kind === 'parent' ? c.detail : null].filter(Boolean).join(' · ') || 'School account'}
                        </p>
                      </div>
                      <ChevronRight size={15} className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5" />
                    </button>
                  ))
                )
              ) : filteredThreads.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-14 text-center">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                    <MessageCircle size={22} />
                  </div>
                  <p className="text-xs font-semibold text-slate-600">
                    {search ? 'No conversations match that search' : 'No conversations yet'}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    {search
                      ? 'Try a different name or subject.'
                      : 'Every direct message you exchange becomes a conversation here.'}
                  </p>
                  {canStartChat && !search && (
                    <button
                      onClick={() => setPickingChat(true)}
                      className="mt-3 inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-violet-700"
                    >
                      <UserPlus size={11} /> Start a chat
                    </button>
                  )}
                </div>
              ) : (
                filteredThreads.map(t => (
                  <button
                    key={t.counterpartUserId}
                    type="button"
                    onClick={() => openThread(t.counterpartUserId)}
                    className={clsx(
                      'group relative w-full border-b border-slate-100 px-3 py-3 text-left transition hover:bg-slate-50/90',
                      selectedThreadId === t.counterpartUserId && 'bg-violet-50/80 hover:bg-violet-50',
                      t.unread > 0 && selectedThreadId !== t.counterpartUserId && 'bg-violet-50/30',
                    )}
                  >
                    <span className={clsx(
                      'absolute inset-y-2 left-0 w-[3px] rounded-r-full transition',
                      selectedThreadId === t.counterpartUserId
                        ? 'bg-violet-600'
                        : t.unread > 0 ? 'bg-violet-300' : 'bg-transparent group-hover:bg-slate-200',
                    )} />
                    <div className="flex items-start gap-3 pl-1.5">
                      <div className="relative">
                        <Avatar name={t.name ?? '?'} size="md" className={t.unread > 0 ? 'ring-violet-200' : undefined} />
                        {t.unread > 0 && (
                          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-violet-600" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-baseline justify-between gap-2">
                          <span className={clsx(
                            'truncate text-[13px]',
                            t.unread > 0 ? 'font-bold text-slate-900' : 'font-semibold text-slate-700',
                          )}>
                            {t.name ?? 'School office'}
                          </span>
                          <span className={clsx(
                            'shrink-0 text-[10px]',
                            t.unread > 0 ? 'font-semibold text-violet-600' : 'text-slate-400',
                          )}>
                            {fmtListDate(t.lastAt)}
                          </span>
                        </div>
                        <p className="truncate text-[12px] font-medium text-slate-600">{t.subject}</p>
                        <p className="mt-0.5 truncate text-[11px] leading-relaxed text-slate-400">{t.preview}</p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
                            {roleLabel(t.role) || 'School account'}
                          </span>
                          {(t.recipientCount ?? 0) > 1 && (
                            <span className="text-[9px] font-medium text-slate-400">{t.recipientCount} people</span>
                          )}
                          {t.unread > 0 && (
                            <span className="ml-auto rounded-full bg-violet-600 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
                              {t.unread} new
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )
            ) : filteredMessages.length === 0 ? (
              <div className="flex flex-col items-center px-6 py-14 text-center">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
                  <MessageSquare size={22} />
                </div>
                <p className="text-xs font-semibold text-slate-600">
                  {search || filter !== 'all' ? 'Nothing matches these filters' : tab === 'sent' ? 'No messages sent yet' : 'Your inbox is clear'}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  {search || filter !== 'all'
                    ? 'Try clearing the search or switching back to All.'
                    : tab === 'sent'
                      ? 'Messages you send will appear here.'
                      : 'New direct messages and announcements will land here.'}
                </p>
                {(search || filter !== 'all') && (
                  <button
                    onClick={() => { setSearch(''); setFilter('all'); }}
                    className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-[10px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              filteredMessages.map(m => (
                <MessageRow
                  key={msgKey(m)}
                  msg={m}
                  selected={selectedId === msgKey(m)}
                  unread={tab === 'inbox' && !m.isRead?.[userId]}
                  sent={tab === 'sent'}
                  onClick={() => openMessage(m)}
                />
              ))
            )}
          </div>

          {/* Footer hint */}
          <div className="hidden shrink-0 items-center gap-1.5 border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-[9px] text-slate-400 lg:flex">
            <Sparkles size={10} className="text-violet-400" />
            {tab === 'chats'
              ? 'Conversations group every direct message you exchange with one person.'
              : portal
                ? 'You can message staff directly. Saved groups are managed by staff.'
                : broadcastAllowed
                  ? 'Tip: use saved groups for classes, teams and committees.'
                  : 'Direct messages support one or many recipients.'}
          </div>
        </div>

        {/* Right column */}
        <div className={clsx(
          'min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm',
          showMobileDetail ? 'flex flex-col' : 'hidden lg:flex lg:flex-col',
        )}>
          {tab === 'groups' ? (
            selectedGroup ? (
              <GroupDetail
                group={selectedGroup}
                userId={userId}
                userRole={userRole}
                onMessage={g => openCompose({ mode: 'group', groupId: g.id })}
                onUpdate={(id, data) => updateGroup.mutateAsync({ id, data })}
                onDelete={id => deleteGroup.mutate(id)}
                saving={updateGroup.isPending}
                deleting={deleteGroup.isPending}
                onBack={() => { setShowMobileDetail(false); setSelectedGroupId(null); }}
              />
            ) : (
              <EmptyDetail
                tab="groups"
                onCreateGroup={() => openCompose({ mode: 'group', createNew: true })}
                onCompose={() => openCompose({})}
              />
            )
          ) : tab === 'chats' ? (
            selectedThreadId ? (
              <ThreadView
                key={selectedThreadId}
                thread={threadQuery.data?.data ?? null}
                loading={threadQuery.isLoading}
                userId={userId}
                onBack={() => { setShowMobileDetail(false); setSelectedThreadId(null); }}
                onReply={payload => threadReply.mutateAsync({ counterpartId: selectedThreadId, payload })}
                replying={threadReply.isPending}
                richReply={canStartChat}
                onVote={(m, optionId) => votePoll.mutate({ messageId: msgKey(m), optionId })}
                votingId={votePoll.isPending ? votePoll.variables?.messageId : null}
                onDownloadAttachment={a => attachmentDownload.mutateAsync(a.id)}
                downloadingAttachment={attachmentDownload.isPending}
              />
            ) : (
              <div className="relative flex h-full flex-col items-center justify-center overflow-hidden bg-slate-50 px-8 text-center">
                <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-violet-100/70 blur-3xl" />
                <div className="relative mb-5">
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-violet-200 to-blue-200 blur-2xl" />
                  <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-600 via-indigo-600 to-blue-600 text-white shadow-xl shadow-violet-200">
                    <MessageCircle size={34} />
                  </div>
                </div>
                <h3 className="relative text-sm font-bold text-slate-800">Pick up where you left off</h3>
                <p className="relative mt-1 max-w-xs text-xs leading-relaxed text-slate-400">
                  Choose a conversation on the left to read it and reply. Every direct
                  message becomes part of a conversation automatically.
                </p>
                {canStartChat && (
                  <button
                    onClick={() => setPickingChat(true)}
                    className="relative mt-4 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-700"
                  >
                    <UserPlus size={13} /> Start a chat
                  </button>
                )}
              </div>
            )
          ) : selected ? (
            <MessageDetail
              key={selectedId}
              msg={selected}
              userId={userId}
              userRole={userRole}
              onDelete={id => deleteMsg.mutate(id)}
              deleting={deleteMsg.isPending}
              onBack={() => { setShowMobileDetail(false); setSelectedId(null); }}
              onReply={m => replyPrefill(m, false)}
              onReplyAll={m => replyPrefill(m, true)}
              onQuickReply={(m, text) => quickReply.mutateAsync({ msg: m, body: text })}
              replying={quickReply.isPending}
              onVote={(m, optionId) => votePoll.mutate({ messageId: msgKey(m), optionId })}
              voting={votePoll.isPending}
              onDownloadAttachment={a => attachmentDownload.mutateAsync(a.id)}
              downloadingAttachment={attachmentDownload.isPending}
            />
          ) : (
            <EmptyDetail
              tab={tab}
              onCreateGroup={() => openCompose({ mode: 'group', createNew: true })}
              onCompose={() => openCompose({})}
            />
          )}
        </div>
      </div>

      {/* Compose */}
      <ComposePanel
        open={!!composing}
        initial={composing}
        currentRole={userRole}
        onClose={() => setComposing(null)}
        onSent={handleSent}
      />

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            className={clsx(
              'fixed bottom-6 right-6 z-[60] flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-semibold shadow-xl',
              toast.type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white',
            )}
          >
            {toast.type !== 'error' && <Check size={14} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
