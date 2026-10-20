/**
 * Parent Portal — Messages panel
 * The list a parent actually reads: who wrote to them, what it is about,
 * whether it has been read, and what the message says in full.
 *
 * Why this is its own component (and not more markup inside the 1,400
 * line ParentDashboard.jsx): the Messages page is the one page a parent
 * returns to most often, and it used to be the least useful one — a flat
 * list of tiny rows where an unread message was a 2px dot, the whole
 * body was dumped into the row, and clicking a message only flipped a
 * flag with nothing to show. Everything a parent needs to answer a
 * teacher's message lives here: a readable preview, the full text, who
 * it went to, and a reply.
 *
 * Data shape comes straight from GET /api/messages (senderName,
 * senderRole, recipients, recipientUsers, isGroup, isRead, createdAt) —
 * no extra endpoint, no per-row requests.
 */
import { useMemo } from 'react';
import { CheckCheck, Inbox, MessageSquare, Reply, Send, Users } from 'lucide-react';

/* ── Sender presentation ──────────────────────────────────────────
   The role decides the avatar colour and the chip under the name, so a
   parent can tell "the class teacher" from "the school office" without
   reading the name. Unknown roles fall back to a neutral school grey
   rather than pretending to be somebody specific. */
const ROLE_PRESENTATION = {
  teacher:             { label: 'Teacher',          bg: 'linear-gradient(135deg,#0ea5e9,#6366f1)' },
  section_head:        { label: 'Section Head',     bg: 'linear-gradient(135deg,#6366f1,#8b5cf6)' },
  principal:           { label: 'Principal',        bg: 'linear-gradient(135deg,#8b5cf6,#ec4899)' },
  deputy_principal:    { label: 'Deputy Principal', bg: 'linear-gradient(135deg,#7c3aed,#a855f7)' },
  deputy:              { label: 'Deputy',           bg: 'linear-gradient(135deg,#7c3aed,#a855f7)' },
  admin:               { label: 'Administration',   bg: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
  superadmin:          { label: 'Administration',   bg: 'linear-gradient(135deg,#f59e0b,#ef4444)' },
  finance:             { label: 'Finance',          bg: 'linear-gradient(135deg,#10b981,#059669)' },
  hr:                  { label: 'Human Resources',  bg: 'linear-gradient(135deg,#14b8a6,#0ea5e9)' },
  discipline_committee:{ label: 'Discipline',       bg: 'linear-gradient(135deg,#f43f5e,#e11d48)' },
  parent:              { label: 'Parent',           bg: 'linear-gradient(135deg,#14b8a6,#0ea5e9)' },
  guardian:            { label: 'Parent',           bg: 'linear-gradient(135deg,#14b8a6,#0ea5e9)' },
  student:             { label: 'Student',          bg: 'linear-gradient(135deg,#64748b,#94a3b8)' },
};
const FALLBACK_ROLE = { label: 'School', bg: 'linear-gradient(135deg,#475569,#94a3b8)' };

function _roleOf(msg) {
  return ROLE_PRESENTATION[msg?.senderRole] ?? FALLBACK_ROLE;
}

function _initials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 2) || '?';
}

function _isToday(iso) {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}

/** Day bucket label — "Today" / "Yesterday" / "This week" / the date. */
function _dayLabel(iso) {
  if (!iso) return 'Earlier';
  const d    = new Date(iso);
  const now  = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
  if (d >= weekAgo) return 'This week';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/** Right-hand timestamp — a clock time today, a date for anything older. */
function _timeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (_isToday(iso)) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Who a message went to, in plain words a parent understands. */
function _recipientSummary(msg) {
  if (msg?.isGroup) {
    const n = msg.recipientUsers?.length ?? 0;
    return n > 1 ? `Group · ${n} people` : 'Group message';
  }
  if ((msg?.recipients ?? []).includes('all')) return 'Whole school';
  const n = msg.recipientUsers?.length ?? 0;
  if (n === 1) return `To ${msg.recipientUsers[0]?.name ?? 'the school'}`;
  if (n > 1) return `To ${n} people`;
  return '';
}

/** Inbox rows say nothing about the recipient — the parent IS the
    recipient. Only the shape of the audience is worth showing. */
function _inboxAudience(msg) {
  if (msg?.isGroup) return _recipientSummary(msg);
  if ((msg?.recipients ?? []).includes('all')) return 'Whole school';
  return '';
}

export default function MessagesPanel({
  tab, onTabChange,
  messages, loading, hasMore, onLoadMore, total,
  myUserId, primary, openId, onToggle, onCompose, onReply,
  unreadOnly, onUnreadOnlyChange, unreadCount,
}) {
  const groups = useMemo(() => {
    const out = [];
    for (const m of messages) {
      const label = _dayLabel(m.createdAt);
      const last  = out[out.length - 1];
      if (last && last.label === label) last.items.push(m);
      else out.push({ label, items: [m] });
    }
    return out;
  }, [messages]);

  const isSent = tab === 'sent';

  return (
    <div className="bg-white rounded-[10px] border border-slate-200 shadow-sm overflow-hidden" id="section-messages">

      {/* ── Panel header ─────────────────────────────────────────── */}
      <div className="px-[18px] py-3.5 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Inbox size={15} className="flex-shrink-0 text-slate-400" />
          <h2 className="text-[13px] font-bold text-slate-900 truncate">
            {isSent ? 'Sent' : 'Inbox'}
          </h2>
          {!isSent && unreadCount > 0 && (
            <span id="messages-unread-badge" className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-[3px] rounded-full">
              {unreadCount} unread
            </span>
          )}
          {!isSent && total > 0 && (
            <span className="text-[11px] text-slate-400 hidden sm:inline">{total} message{total === 1 ? '' : 's'}</span>
          )}
        </div>
        <button
          id="compose-message-button"
          onClick={onCompose}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-white px-3 py-[7px] rounded-lg transition hover:opacity-90"
          style={{ background: primary }}
        >
          <Send size={12} /> New Message
        </button>
      </div>

      {/* ── Tabs + unread filter ─────────────────────────────────── */}
      <div className="px-[18px] py-2.5 border-b border-slate-100 flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg bg-slate-100 p-[3px]">
          <button
            onClick={() => onTabChange('inbox')}
            className={`text-[11px] font-semibold px-3 py-[5px] rounded-md transition ${
              tab === 'inbox' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Inbox
          </button>
          <button
            onClick={() => onTabChange('sent')}
            className={`text-[11px] font-semibold px-3 py-[5px] rounded-md transition ${
              tab === 'sent' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Sent
          </button>
        </div>

        {/* The toggle stays visible while it is switched on, even if the
            last unread message is read from here — otherwise the parent
            would be stuck in an empty filtered list with no way back. */}
        {!isSent && (unreadCount > 0 || unreadOnly) && (
          <button
            onClick={() => onUnreadOnlyChange(!unreadOnly)}
            className={`text-[11px] font-semibold px-2.5 py-[5px] rounded-full border transition ${
              unreadOnly
                ? 'text-white border-transparent'
                : 'text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            }`}
            style={unreadOnly ? { background: primary, borderColor: primary } : undefined}
          >
            Unread only
          </button>
        )}
      </div>

      {/* ── Body ─────────────────────────────────────────────────── */}
      {loading && messages.length === 0 ? (
        <div className="p-4 space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="flex gap-3 items-start">
              <div className="w-9 h-9 rounded-full bg-slate-100 animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-2 pt-1">
                <div className="h-2.5 w-1/3 rounded bg-slate-100 animate-pulse" />
                <div className="h-2.5 w-2/3 rounded bg-slate-100 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="px-6 py-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-300 flex items-center justify-center mx-auto">
            <MessageSquare size={22} />
          </div>
          <p className="text-[13px] font-semibold text-slate-700 mt-3">
            {isSent
              ? 'You have not sent any messages yet'
              : unreadOnly
                ? 'Nothing unread'
                : 'No messages yet'}
          </p>
          <p className="text-[12px] text-slate-400 mt-1 max-w-[280px] mx-auto leading-relaxed">
            {isSent
              ? 'Messages you send to the school will be listed here, so you can keep track of what you have asked.'
              : 'Messages from your child\'s teachers and the school office will appear here.'}
          </p>
          {!isSent && (
            <button
              onClick={onCompose}
              className="mt-4 inline-flex items-center gap-1.5 text-[12px] font-semibold text-white px-3.5 py-2 rounded-lg hover:opacity-90"
              style={{ background: primary }}
            >
              <Send size={12} /> Message the school
            </button>
          )}
        </div>
      ) : (
        <div id="messages-list">
          {groups.map(group => (
            <div key={group.label}>
              <div className="px-[18px] pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400 bg-slate-50/70 border-y border-slate-100">
                {group.label}
              </div>
              {group.items.map(m => {
                const unread  = !isSent && !m.isRead?.[myUserId];
                const open    = openId === m.id;
                const role    = _roleOf(m);
                const names   = isSent
                  ? (m.recipientUsers ?? []).map(u => u.name).filter(Boolean).join(', ') || 'The school'
                  : (m.senderName || 'School');
                const summary = isSent ? _recipientSummary(m) : _inboxAudience(m);
                return (
                  <div
                    key={m.id}
                    id={`inbox-message-${m.id}`}
                    className={`border-b border-slate-50 last:border-b-0 border-l-[3px] transition-colors ${
                      unread ? 'bg-slate-50' : 'bg-white border-l-transparent'
                    } ${open ? 'bg-slate-50' : ''}`}
                    style={unread ? { borderLeftColor: primary } : undefined}
                  >
                    <button
                      onClick={() => onToggle(m)}
                      aria-expanded={open}
                      className="w-full text-left px-[18px] py-3.5 flex items-start gap-3 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset"
                    >
                      {/* Avatar — the sender's role decides the colour */}
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0"
                        style={{ background: role.bg }}
                        aria-hidden="true"
                      >
                        {isSent ? <Send size={13} /> : _initials(m.senderName || 'School')}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`text-[12.5px] leading-snug truncate ${unread ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>
                            {isSent ? `To ${names}` : names}
                          </p>
                          <span className="text-[9.5px] font-bold uppercase tracking-[0.04em] text-slate-400 bg-slate-100 rounded px-1.5 py-[2px]">
                            {isSent ? 'Sent' : role.label}
                          </span>
                          {m.isGroup && (
                            <span className="inline-flex items-center gap-1 text-[9.5px] font-bold uppercase tracking-[0.04em] text-violet-500 bg-violet-50 rounded px-1.5 py-[2px]">
                              <Users size={9} /> Group
                            </span>
                          )}
                          {unread && (
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: primary }} aria-label="Unread" />
                          )}
                        </div>

                        <p className={`text-[12.5px] mt-0.5 truncate ${unread ? 'font-semibold text-slate-800' : 'font-medium text-slate-600'}`}>
                          {m.subject || '(no subject)'}
                        </p>

                        {m.body && !open && (
                          <p className="text-[11.5px] text-slate-500 mt-0.5 leading-relaxed line-clamp-2">
                            {m.body}
                          </p>
                        )}

                        {!isSent && summary && (
                          <div className="flex items-center gap-2 mt-1.5 text-[10.5px] text-slate-400">
                            <span className="truncate">{summary}</span>
                          </div>
                        )}
                      </div>

                      <span className="text-[10.5px] text-slate-400 whitespace-nowrap flex-shrink-0 pt-0.5">
                        {_timeLabel(m.createdAt)}
                      </span>
                    </button>

                    {/* Expanded — the full message, in place (a parent reads
                        on a phone; a route change per message is friction) */}
                    {open && (
                      <div className="px-[18px] pb-4 pl-[74px]">
                        <div className="rounded-lg bg-white border border-slate-200 p-3.5 shadow-sm">
                          <p className="text-[12.5px] text-slate-700 leading-relaxed whitespace-pre-line break-words">
                            {m.body || 'This message has no text.'}
                          </p>
                          <div className="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-100 flex-wrap">
                            <p className="text-[10.5px] text-slate-400">
                              {isSent ? 'Sent' : (m.senderName || 'School')} · {m.createdAt ? new Date(m.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                            </p>
                            {!isSent && (
                              <button
                                onClick={() => onReply(m)}
                                className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-white px-3 py-[6px] rounded-lg hover:opacity-90"
                                style={{ background: primary }}
                              >
                                <Reply size={12} /> Reply
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}

          {hasMore && (
            <div className="px-[18px] py-3 border-t border-slate-100">
              <button
                onClick={onLoadMore}
                className="w-full text-[12px] font-semibold text-slate-600 border border-slate-200 rounded-lg py-2 hover:bg-slate-50 transition"
              >
                Load older messages
              </button>
            </div>
          )}
        </div>
      )}

      {!isSent && !loading && messages.length > 0 && (
        <div className="px-[18px] py-2.5 border-t border-slate-100 bg-slate-50/60 flex items-center gap-1.5 text-[10.5px] text-slate-400">
          <CheckCheck size={11} className="text-emerald-500 flex-shrink-0" />
          Everything here is private to you and the school.
        </div>
      )}
    </div>
  );
}
