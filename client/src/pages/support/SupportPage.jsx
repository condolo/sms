/**
 * Support — raise and follow your own ticket (/support)
 *
 * Available to every authenticated school user: staff, parents and students.
 * The page only ever sees the caller's own tickets; internal operator notes
 * are filtered out server-side.
 */
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import {
  LifeBuoy, ArrowLeft, Send, Loader2, AlertCircle, CheckCircle2,
  Clock3, MessageSquare, LogOut,
} from 'lucide-react';
import useAuthStore from '@/store/auth.js';
import { supportApi } from '@/api/client.js';

const CATEGORIES = [
  { value: 'support', label: 'General help' },
  { value: 'bug',     label: 'Something is broken' },
  { value: 'billing', label: 'Fees / billing' },
  { value: 'feature', label: 'Feature request' },
];
const PRIORITIES = [
  { value: 'low',    label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high',   label: 'Urgent' },
];

const STATUS_STYLE = {
  open:        'bg-rose-50 text-rose-700 border-rose-200',
  in_progress: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  waiting:     'bg-amber-50 text-amber-800 border-amber-200',
  resolved:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed:      'bg-slate-100 text-slate-600 border-slate-200',
};
const STATUS_LABEL = {
  open: 'Open', in_progress: 'In progress', waiting: 'Awaiting your reply',
  resolved: 'Resolved', closed: 'Closed',
};

function _fmt(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function SupportPage() {
  const navigate = useNavigate();
  const session  = useAuthStore(s => s.session);
  const logout   = useAuthStore(s => s.logout);

  const [tickets, setTickets]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState(null);
  const [threadBusy, setThreadBusy] = useState(false);
  const [reply, setReply]           = useState('');
  const [error, setError]           = useState('');
  const [notice, setNotice]         = useState('');
  const [form, setForm]             = useState({ subject: '', description: '', category: 'support', priority: 'normal' });
  const [submitting, setSubmitting] = useState(false);

  const role = session?.user?.role;
  const backTo = role === 'parent' || role === 'guardian'
    ? '/parent-dashboard'
    : role === 'student' ? '/student-dashboard' : '/dashboard';

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function loadTickets() {
    setLoading(true);
    try {
      const res = await supportApi.list();
      setTickets(res.data || []);
    } catch (err) {
      setError(err.message || 'Could not load your tickets.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (session) loadTickets(); }, [session]);

  async function openTicket(id) {
    setThreadBusy(true); setError(''); setNotice('');
    try {
      const res = await supportApi.get(id);
      setSelected(res.data);
    } catch (err) {
      setError(err.message || 'Could not open that ticket.');
    } finally {
      setThreadBusy(false);
    }
  }

  async function submitTicket(e) {
    e.preventDefault();
    setError(''); setNotice(''); setSubmitting(true);
    try {
      const res = await supportApi.create(form);
      setNotice(`Ticket ${res.data.ref} created. We will reply here and by email.`);
      setForm({ subject: '', description: '', category: 'support', priority: 'normal' });
      await loadTickets();
      await openTicket(res.data.id);
    } catch (err) {
      setError(err.message || 'Could not create the ticket.');
    } finally {
      setSubmitting(false);
    }
  }

  async function sendReply(e) {
    e.preventDefault();
    if (!reply.trim() || !selected) return;
    setThreadBusy(true); setError('');
    try {
      const res = await supportApi.reply(selected.id, reply.trim());
      setSelected(res.data);
      setReply('');
      await loadTickets();
    } catch (err) {
      setError(err.message || 'Could not send that reply.');
    } finally {
      setThreadBusy(false);
    }
  }

  if (!session) return <Navigate to="/login" replace />;

  return (
    <>
      <Helmet><title>Support — {session.school?.name || 'Msingi'}</title></Helmet>
      <div className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-4xl items-center gap-3 px-5 py-3">
            <Link to={backTo} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
              <ArrowLeft size={15} /> Back
            </Link>
            <div className="ml-2 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
                <LifeBuoy size={16} className="text-indigo-600" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">Support</p>
                <p className="text-[11px] text-slate-400">{session.school?.name}</p>
              </div>
            </div>
            <button
              onClick={() => { logout(); navigate('/login', { replace: true }); }}
              className="ml-auto inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-rose-600"
            >
              <LogOut size={13} /> Sign out
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-4xl space-y-5 px-5 py-6">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
          {notice && (
            <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> {notice}
            </div>
          )}

          {!selected && (
            <>
              <section className="rounded-2xl border border-slate-200 bg-white p-5">
                <h1 className="text-lg font-semibold text-slate-900">Raise a support ticket</h1>
                <p className="mt-1 text-sm text-slate-500">Tell us what you need. Replies appear below and are emailed to you.</p>
                <form onSubmit={submitTicket} className="mt-4 space-y-3">
                  <input
                    required minLength={3} maxLength={200}
                    value={form.subject} onChange={set('subject')}
                    placeholder="Short summary"
                    className={inputCls}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <select value={form.category} onChange={set('category')} className={inputCls}>
                      {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                    <select value={form.priority} onChange={set('priority')} className={inputCls}>
                      {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <textarea
                    rows={4} maxLength={5000}
                    value={form.description} onChange={set('description')}
                    placeholder="What happened? Include the page and what you expected."
                    className={inputCls}
                  />
                  <button type="submit" disabled={submitting || form.subject.trim().length < 3}
                    className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                    {submitting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                    {submitting ? 'Sending…' : 'Submit ticket'}
                  </button>
                </form>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white">
                <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
                  <MessageSquare size={15} className="text-slate-400" />
                  <h2 className="text-sm font-semibold text-slate-800">My tickets</h2>
                  <span className="text-xs text-slate-400">({tickets.length})</span>
                </div>
                {loading ? (
                  <div className="flex items-center gap-2 px-5 py-6 text-sm text-slate-500">
                    <Loader2 size={15} className="animate-spin" /> Loading…
                  </div>
                ) : tickets.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-slate-400">No tickets yet.</div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {tickets.map(t => (
                      <li key={t.id}>
                        <button onClick={() => openTicket(t.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-slate-800">{t.subject}</p>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              {t.ref} · {_fmt(t.updatedAt)} · {t.messageCount} message{t.messageCount === 1 ? '' : 's'}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[t.status] || STATUS_STYLE.open}`}>
                            {STATUS_LABEL[t.status] || t.status}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {selected && (
            <section className="rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-start gap-2 border-b border-slate-100 px-5 py-4">
                <button onClick={() => { setSelected(null); setReply(''); }} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                  <ArrowLeft size={14} /> All tickets
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[selected.status] || STATUS_STYLE.open}`}>
                    {STATUS_LABEL[selected.status] || selected.status}
                  </span>
                  <span className="text-[11px] text-slate-400">{selected.ref}</span>
                </div>
                <div className="w-full">
                  <h2 className="text-lg font-semibold text-slate-900">{selected.subject}</h2>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Opened {_fmt(selected.createdAt)} · {selected.category} · {selected.priority} priority
                  </p>
                </div>
              </div>

              <div className="space-y-3 px-5 py-4">
                {selected.description && (
                  <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700 whitespace-pre-wrap">{selected.description}</div>
                )}
                {(selected.messages || []).map(m => (
                  <div key={m.id} className={`rounded-lg border p-3 ${m.authorType === 'operator' ? 'border-indigo-100 bg-indigo-50/50' : 'border-slate-100 bg-white'}`}>
                    <p className="text-[11px] font-semibold text-slate-500">
                      {m.author}{m.authorType === 'operator' ? ' · Support' : ''} · {_fmt(m.createdAt)}
                    </p>
                    <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{m.body}</p>
                  </div>
                ))}
                {(selected.messages || []).length === 0 && (
                  <p className="text-sm text-slate-400">No replies yet — we will email you when support responds.</p>
                )}
              </div>

              {selected.status !== 'closed' && (
                <form onSubmit={sendReply} className="border-t border-slate-100 px-5 py-4">
                  <textarea
                    rows={3} value={reply} onChange={e => setReply(e.target.value)}
                    placeholder="Add a reply…"
                    className={inputCls}
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button type="submit" disabled={threadBusy || !reply.trim()}
                      className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                      {threadBusy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      Send reply
                    </button>
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <Clock3 size={11} /> Typical reply within one business day
                    </span>
                  </div>
                </form>
              )}
            </section>
          )}
        </main>
      </div>
    </>
  );
}

const inputCls = 'w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500';
