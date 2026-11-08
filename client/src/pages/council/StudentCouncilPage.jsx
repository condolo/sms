/* ============================================================
   Student Council — the student's side

   One page, three lanes:
     Have your say   file a grievance or a suggestion (named by default,
                     "hide my name from the council" per submission)
     My cases        follow the thread, reply, withdraw, upvote
                     suggestions
     Elections       stand for a seat, vote once per position, read the
                     published result

   A council member additionally sees the triage queue. Safeguarding
   cases never reach that queue: the server routes them to staff.
   ============================================================ */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Megaphone, ArrowLeft, ShieldAlert, EyeOff, Eye, Send, Loader2, CheckCircle2,
  AlertTriangle, ThumbsUp, Vote, Users, X, ChevronRight, Lock,
} from 'lucide-react';
import { council as councilApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

const CATEGORY_LABEL = {
  welfare: 'Welfare', academics: 'Academics', facilities: 'Facilities',
  safety: 'Safety', other: 'Other',
};
const STATUS_META = {
  open:         { label: 'Open',         cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  under_review: { label: 'Under review', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  escalated:    { label: 'With staff',   cls: 'bg-red-50 text-red-700 ring-red-200' },
  resolved:     { label: 'Resolved',     cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rejected:     { label: 'Closed',       cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  merged:       { label: 'Merged',       cls: 'bg-violet-50 text-violet-700 ring-violet-200' },
  withdrawn:    { label: 'Withdrawn',    cls: 'bg-slate-100 text-slate-500 ring-slate-200' },
};

const fmt = (v) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const inputCls = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 bg-white';
const btnPrimary = 'inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition';
const btnGhost = 'inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-50 transition';

export default function StudentCouncilPage() {
  const navigate = useNavigate();
  const session = useAuthStore(s => s.session);
  const logout = useAuthStore(s => s.logout);
  const me = useQuery({ queryKey: ['council', 'me'], queryFn: () => councilApi.me() });

  useEffect(() => {
    if (!session?.user) { navigate('/login', { replace: true }); return; }
    if (session.user.role !== 'student') { navigate('/dashboard', { replace: true }); }
  }, [session, navigate]);

  const tabs = useMemo(() => {
    const base = [
      { key: 'submit', label: 'Have your say' },
      { key: 'mine',   label: 'My cases' },
      { key: 'ideas',  label: 'Suggestions' },
      { key: 'votes',  label: 'Elections' },
    ];
    if (me.data?.membership) base.push({ key: 'queue', label: 'Council queue' });
    return base;
  }, [me.data?.membership]);
  const [tab, setTab] = useState('submit');

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => navigate('/student-dashboard')} className="p-2 -ml-2 rounded-lg hover:bg-slate-100 text-slate-500" title="Back to dashboard">
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-bold text-slate-900 flex items-center gap-1.5">
              <Megaphone size={16} className="text-emerald-600" /> Student Council
            </h1>
            <p className="text-[11px] text-slate-400">
              {me.data?.membership
                ? `${me.data.membership.positionTitle} · ${me.data.membership.source}`
                : 'Share a grievance or an idea with the council'}
            </p>
          </div>
          {me.data?.membership && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase rounded-full px-2 py-1 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
              <Users size={10} /> Council
            </span>
          )}
          <button
            onClick={() => { logout(); navigate('/login', { replace: true }); }}
            className="text-[11px] text-slate-400 hover:text-slate-600"
          >Sign out</button>
        </div>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex items-center gap-1 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition ${
                tab === t.key ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >{t.label}</button>
          ))}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-5 pb-16">
        {tab === 'submit' && <SubmitCase onDone={() => setTab('mine')} />}
        {tab === 'mine' && <MyCases onOpenQueue={() => setTab('queue')} hasQueue={!!me.data?.membership} />}
        {tab === 'ideas' && <Suggestions />}
        {tab === 'votes' && <Elections />}
        {tab === 'queue' && <Queue />}
      </main>
    </div>
  );
}

/* ── Submit ────────────────────────────────────────────────── */

const EMPTY = {
  kind: 'grievance', category: 'welfare', title: '', body: '',
  anonymous: false, sensitive: false,
};

function SubmitCase({ onDone }) {
  const qc = useQueryClient();
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const submit = useMutation({
    mutationFn: () => councilApi.createCase(f),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['council'] });
      setDone(data);
      setF(EMPTY);
    },
    onError: e => setErr(e?.message || 'Could not file this. Please try again.'),
  });

  if (done) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center">
        <CheckCircle2 size={30} className="mx-auto text-emerald-500 mb-3" />
        <h2 className="text-lg font-bold text-slate-900">Filed as {done.ref}</h2>
        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
          {done.safeguarding
            ? 'Because this mentions safety, it has gone straight to school staff as well as the council.'
            : 'The council will pick it up from here. You will see their replies in My cases.'}
        </p>
        <button onClick={onDone} className={`${btnPrimary} mt-4`}>See my cases</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <div className="flex gap-2">
          {['grievance', 'suggestion'].map(k => (
            <button
              key={k}
              onClick={() => set('kind', k)}
              className={`flex-1 text-left rounded-xl border px-4 py-3 transition ${
                f.kind === k ? 'border-emerald-400 bg-emerald-50/60 ring-1 ring-emerald-200' : 'border-slate-200 hover:bg-slate-50'
              }`}
            >
              <p className="text-sm font-semibold text-slate-800 capitalize">{k}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {k === 'grievance' ? 'Something is wrong and needs the council to act.' : 'An idea that would make school better.'}
              </p>
            </button>
          ))}
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">What is it about?</label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
              <button
                key={key}
                onClick={() => set('category', key)}
                className={`text-xs font-medium rounded-full px-3 py-1.5 border transition ${
                  f.category === key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >{label}</button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Title</label>
          <input value={f.title} onChange={e => set('title', e.target.value)} maxLength={160} placeholder="A short line the council will see" className={inputCls} />
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Details</label>
          <textarea value={f.body} onChange={e => set('body', e.target.value)} rows={6} maxLength={6000}
            placeholder="What happened, who it affects, and what you would like the council to do."
            className={inputCls} />
        </div>

        <div className="space-y-2 border-t border-slate-100 pt-3">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={f.anonymous} onChange={e => set('anonymous', e.target.checked)} className="mt-0.5 accent-emerald-600" />
            <span className="text-[12px] text-slate-600">
              <span className="font-medium text-slate-800 inline-flex items-center gap-1"><EyeOff size={12} /> Hide my name from the council</span>
              <span className="block text-slate-400 mt-0.5">Your class is still shown, and school staff can always see who filed it — that is how safety follow-ups work.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={f.sensitive} onChange={e => set('sensitive', e.target.checked)} className="mt-0.5 accent-red-600" />
            <span className="text-[12px] text-slate-600">
              <span className="font-medium text-slate-800">This involves a council member or the council patron</span>
              <span className="block text-slate-400 mt-0.5">Only school staff will see it until they decide who handles it.</span>
            </span>
          </label>
        </div>

        {f.category === 'safety' && (
          <p className="flex items-start gap-2 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
            Safety items go straight to school staff. The council cannot close them on their own.
          </p>
        )}

        {err && <p className="text-xs text-red-600">{err}</p>}

        <div className="flex justify-end">
          <button
            onClick={() => { setErr(''); submit.mutate(); }}
            disabled={submit.isPending || f.title.trim().length < 3 || f.body.trim().length < 5}
            className={btnPrimary}
          >
            {submit.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {submit.isPending ? 'Filing…' : 'File with the council'}
          </button>
        </div>
      </div>
      <p className="text-[11px] text-slate-400 px-1">
        This goes to the student council, not to teachers. Anything about immediate danger should also be told to a teacher or the office.
      </p>
    </div>
  );
}

/* ── My cases ──────────────────────────────────────────────── */

function MyCases({ onOpenQueue, hasQueue }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['council', 'cases', 'mine'], queryFn: () => councilApi.cases() });
  const [openId, setOpenId] = useState(null);

  if (list.isLoading) return <div className="py-16 text-center text-sm text-slate-400"><Loader2 size={16} className="animate-spin inline mr-2" />Loading your cases…</div>;

  if (!(list.data || []).length) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
        <Megaphone size={24} className="mx-auto text-slate-300 mb-2" />
        <p className="text-sm text-slate-500">Nothing filed yet.</p>
        <p className="text-[12px] text-slate-400 mt-1">Use “Have your say” to start a grievance or suggestion.</p>
        {hasQueue && (
          <button onClick={onOpenQueue} className={`${btnGhost} mt-3 mx-auto`}>Open the council queue <ChevronRight size={14} /></button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {(list.data || []).map(c => (
        <div key={c.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <button onClick={() => setOpenId(openId === c.id ? null : c.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
            <span className={`w-1.5 h-8 rounded-full ${c.safeguarding ? 'bg-red-500' : c.kind === 'suggestion' ? 'bg-violet-400' : 'bg-sky-400'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-slate-400">{c.ref}</span>
                <span className="text-[10px] font-semibold uppercase text-slate-500">{c.kind}</span>
                {c.upvoteCount > 0 && <span className="text-[10px] text-violet-600 font-semibold">{c.upvoteCount} upvote{c.upvoteCount === 1 ? '' : 's'}</span>}
              </div>
              <p className="text-sm font-medium text-slate-800 truncate">{c.title}</p>
              <p className="text-[11px] text-slate-400">{fmt(c.updatedAt)}</p>
            </div>
            <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ring-1 whitespace-nowrap ${STATUS_META[c.status]?.cls || ''}`}>
              {STATUS_META[c.status]?.label || c.status}
            </span>
          </button>
          {openId === c.id && <CaseDetail id={c.id} onChanged={() => qc.invalidateQueries({ queryKey: ['council'] })} />}
        </div>
      ))}
      {hasQueue && (
        <button onClick={onOpenQueue} className={`${btnGhost} mx-auto`}>Open the council queue <ChevronRight size={14} /></button>
      )}
    </div>
  );
}

function CaseDetail({ id, onChanged }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['council', 'case', 'mine', id], queryFn: () => councilApi.case(id) });
  const [reply, setReply] = useState('');
  const c = q.data;

  const send = useMutation({
    mutationFn: () => councilApi.reply(id, { body: reply }),
    onSuccess: () => { setReply(''); q.refetch(); onChanged(); },
  });
  const withdraw = useMutation({
    mutationFn: () => councilApi.withdraw(id),
    onSuccess: () => { q.refetch(); onChanged(); },
  });
  const upvote = useMutation({
    mutationFn: () => councilApi.upvote(id),
    onSuccess: () => { q.refetch(); onChanged(); },
  });

  if (q.isLoading) return <p className="px-4 py-3 text-sm text-slate-400">Loading…</p>;
  if (!c) return <p className="px-4 py-3 text-sm text-red-600">Could not load.</p>;

  return (
    <div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50/60">
      <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
        <span>{CATEGORY_LABEL[c.category] || c.category}</span>
        <span>Filed {fmt(c.createdAt)}</span>
        {c.assignedTo && <span>Handled by {c.assignedTo.name}</span>}
      </div>
      <p className="text-sm text-slate-700 whitespace-pre-wrap bg-white border border-slate-200 rounded-lg px-3 py-2">{c.body}</p>

      {(c.replies || []).length > 0 && (
        <div className="space-y-2">
          {c.replies.map(r => (
            <div key={r.id} className={`rounded-lg border px-3 py-2 ${r.authorType === 'student' ? 'bg-white border-slate-200' : 'bg-emerald-50 border-emerald-200'}`}>
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className="font-semibold text-slate-700">{r.authorName}</span>
                <span>{r.authorType === 'council' ? 'Council' : r.authorType === 'staff' ? 'School staff' : 'You'}</span>
                <span>· {fmt(r.createdAt)}</span>
              </div>
              <p className="text-sm text-slate-700 whitespace-pre-wrap mt-1">{r.body}</p>
            </div>
          ))}
        </div>
      )}

      {!['merged', 'withdrawn'].includes(c.status) && (
        <div className="flex items-start gap-2">
          <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2} placeholder="Reply to the council…" className={inputCls} />
          <button onClick={() => send.mutate()} disabled={send.isPending || !reply.trim()} className={`${btnPrimary} mt-0.5`}>
            {send.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {c.kind === 'suggestion' && !['merged', 'withdrawn'].includes(c.status) && (
          <button onClick={() => upvote.mutate()} disabled={upvote.isPending} className={`${btnGhost} ${c.upvotedByMe ? 'text-violet-700' : ''}`}>
            <ThumbsUp size={13} /> {c.upvotedByMe ? 'Upvoted' : 'Upvote'} ({c.upvoteCount})
          </button>
        )}
        {['open', 'under_review'].includes(c.status) && (
          <button
            onClick={() => { if (window.confirm('Withdraw this case? The council will stop working on it.')) withdraw.mutate(); }}
            className={`${btnGhost} text-red-500 hover:text-red-600`}
          ><X size={13} /> Withdraw</button>
        )}
      </div>
    </div>
  );
}

/* ── Suggestions feed ─────────────────────────────────────── */

function Suggestions() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['council', 'suggestions'], queryFn: () => councilApi.suggestions() });
  const [err, setErr] = useState('');

  const upvote = useMutation({
    mutationFn: (id) => councilApi.upvote(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['council', 'suggestions'] }),
    onError: e => setErr(e?.message || 'Could not record your vote.'),
  });

  if (list.isLoading) {
    return <div className="py-16 text-center text-sm text-slate-400"><Loader2 size={16} className="animate-spin inline mr-2" />Loading suggestions…</div>;
  }
  if (!(list.data || []).length) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
        <ThumbsUp size={24} className="mx-auto text-slate-300 mb-2" />
        <p className="text-sm text-slate-500">No suggestions yet.</p>
        <p className="text-[12px] text-slate-400 mt-1">Be the first to propose something — use “Have your say”.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-[12px] text-slate-500 px-1">Ideas other students have shared. Upvote the ones you want the council to push.</p>
      {(list.data || []).map(c => (
        <div key={c.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-mono text-slate-400">{c.ref}</span>
                <span className="text-[11px] text-slate-500">{CATEGORY_LABEL[c.category]}</span>
                <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 ring-1 ${STATUS_META[c.status]?.cls || ''}`}>
                  {STATUS_META[c.status]?.label || c.status}
                </span>
              </div>
              <p className="text-sm font-medium text-slate-800 mt-0.5">{c.title}</p>
              <p className="text-[12px] text-slate-500 mt-0.5 line-clamp-2">{c.body}</p>
              <p className="text-[11px] text-slate-400 mt-1">
                {c.reporter?.anonymous ? 'Anonymous' : c.reporter?.name} · {c.reporter?.className} · {fmt(c.createdAt)}
              </p>
            </div>
            <button
              onClick={() => { if (!c.isMine) { setErr(''); upvote.mutate(c.id); } }}
              disabled={upvote.isPending || c.isMine}
              className={`flex-shrink-0 flex flex-col items-center gap-0.5 rounded-xl border px-3 py-2 transition ${
                c.isMine
                  ? 'border-slate-200 bg-slate-50 text-slate-300 cursor-default'
                  : c.upvotedByMe ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-500 hover:border-violet-300 hover:text-violet-700'
              }`}
              title={c.isMine ? 'Your own suggestion' : c.upvotedByMe ? 'Remove your upvote' : 'Upvote this suggestion'}
            >
              <ThumbsUp size={14} />
              <span className="text-[11px] font-semibold">{c.upvoteCount}</span>
            </button>
          </div>
        </div>
      ))}
      {err && <p className="text-xs text-red-600 px-1">{err}</p>}
    </div>
  );
}

/* ── Elections ─────────────────────────────────────────────── */

function Elections() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['council', 'elections'], queryFn: () => councilApi.elections() });

  if (list.isLoading) return <div className="py-16 text-center text-sm text-slate-400"><Loader2 size={16} className="animate-spin inline mr-2" />Loading elections…</div>;
  if (!(list.data || []).length) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
        <Vote size={24} className="mx-auto text-slate-300 mb-2" />
        <p className="text-sm text-slate-500">No open elections right now.</p>
        <p className="text-[12px] text-slate-400 mt-1">When the school opens one, you will stand and vote here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(list.data || []).map(e => <ElectionCard key={e.id} election={e} onChanged={() => qc.invalidateQueries({ queryKey: ['council'] })} />)}
    </div>
  );
}

function ElectionCard({ election, onChanged }) {
  const [err, setErr] = useState('');
  const nominate = useMutation({
    mutationFn: (positionId) => councilApi.nominate(election.id, { positionId }),
    onSuccess: onChanged,
    onError: e => setErr(e?.message || 'Could not submit your nomination.'),
  });
  const vote = useMutation({
    mutationFn: ({ positionId, candidateId }) => councilApi.vote(election.id, { positionId, candidateId }),
    onSuccess: onChanged,
    onError: e => setErr(e?.message || 'Could not record your vote.'),
  });

  const phaseLabel = {
    nominations: 'Nominations open', voting: 'Voting open', closed: 'Results published',
  }[election.phase] || election.phase;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <Vote size={16} className="text-emerald-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 truncate">{election.title}</p>
          <p className="text-[11px] text-slate-400">{election.termLabel} · {phaseLabel}</p>
        </div>
      </div>
      <div className="px-4 py-3 space-y-3">
        {(election.positions || []).map(p => {
          const myCandidacy = election.myCandidacy?.positionId === p.id ? election.myCandidacy : null;
          return (
            <div key={p.id} className="border border-slate-200 rounded-xl px-3 py-3">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-slate-800 flex-1">{p.title} <span className="text-[11px] text-slate-400">· {p.seats} seat{p.seats === 1 ? '' : 's'}</span></p>
                {p.voted && <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded-full px-2 py-0.5">Voted</span>}
              </div>
              {p.description && <p className="text-[11px] text-slate-400 mt-0.5">{p.description}</p>}

              {election.phase === 'nominations' && (
                myCandidacy ? (
                  <p className="mt-2 text-[12px] text-slate-500">
                    {myCandidacy.status === 'pending' ? 'Your nomination is waiting for staff vetting.' :
                     myCandidacy.status === 'approved' ? 'You are on the ballot.' : 'Your nomination was not approved.'}
                  </p>
                ) : election.myCandidacy ? (
                  <p className="mt-2 text-[12px] text-slate-400">You are already standing for another seat.</p>
                ) : (
                  <button onClick={() => { setErr(''); nominate.mutate(p.id); }} disabled={nominate.isPending} className={`${btnPrimary} mt-2`}>
                    <Megaphone size={13} /> Stand for this seat
                  </button>
                )
              )}

              {election.phase === 'voting' && (
                <div className="mt-2 space-y-1.5">
                  {(p.candidates || []).length === 0 ? (
                    <p className="text-[12px] text-slate-400">No approved candidates for this seat.</p>
                  ) : p.candidates.map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setErr(''); vote.mutate({ positionId: p.id, candidateId: c.id }); }}
                      disabled={vote.isPending || p.voted}
                      className={`w-full flex items-center gap-2 text-left rounded-lg border px-3 py-2 transition ${
                        p.voted ? 'border-slate-200 bg-slate-50 opacity-60' : 'border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40'
                      }`}
                    >
                      <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                        {c.name?.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                      <span className="text-sm text-slate-700 flex-1">{c.name}</span>
                      <span className="text-[10px] text-slate-400">{c.className}</span>
                    </button>
                  ))}
                </div>
              )}

              {election.phase === 'closed' && election.results && (
                <div className="mt-2">
                  {(() => {
                    const r = election.results.find(x => x.positionId === p.id);
                    if (!r) return <p className="text-[12px] text-slate-400">No result recorded.</p>;
                    return (
                      <ul className="text-[12px] text-slate-600 space-y-0.5">
                        {r.candidates.map(c => (
                          <li key={c.id} className={r.winners?.some(w => w.id === c.id) ? 'font-semibold text-emerald-700' : ''}>
                            {c.name} — {c.votes} vote{c.votes === 1 ? '' : 's'}{r.winners?.some(w => w.id === c.id) ? ' · elected' : ''}
                          </li>
                        ))}
                        {r.runoffRequired && <li className="text-amber-600">A runoff is required for this seat.</li>}
                      </ul>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
        {err && <p className="text-xs text-red-600">{err}</p>}
      </div>
    </div>
  );
}

/* ── Council queue ─────────────────────────────────────────── */

function Queue() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['council', 'queue'], queryFn: () => councilApi.queue() });
  const [openId, setOpenId] = useState(null);
  const [reply, setReply] = useState('');
  const [note, setNote] = useState('');

  const claim = useMutation({
    mutationFn: (id) => councilApi.assign(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['council'] }),
  });
  const send = useMutation({
    mutationFn: ({ id, internal }) => councilApi.reply(id, { body: internal ? note : reply, internal }),
    onSuccess: () => { setReply(''); setNote(''); qc.invalidateQueries({ queryKey: ['council'] }); q.refetch(); },
  });
  const decide = useMutation({
    mutationFn: ({ id, status, note: n }) => councilApi.setStatus(id, { status, note: n }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['council'] }),
  });
  const escalate = useMutation({
    mutationFn: (id) => councilApi.escalate(id, note),
    onSuccess: () => { setNote(''); qc.invalidateQueries({ queryKey: ['council'] }); },
  });

  if (q.isLoading) return <div className="py-16 text-center text-sm text-slate-400"><Loader2 size={16} className="animate-spin inline mr-2" />Loading the queue…</div>;

  const cases = q.data?.cases || [];
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-slate-500 px-1">
        Cases filed with the council. Safeguarding cases and cases about a council member stay with staff until the patron assigns them.
      </p>
      {cases.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-10 text-center">
          <CheckCircle2 size={24} className="mx-auto text-emerald-400 mb-2" />
          <p className="text-sm text-slate-500">The queue is clear.</p>
        </div>
      ) : cases.map(c => (
        <div key={c.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <button onClick={() => setOpenId(openId === c.id ? null : c.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
            <span className={`w-1.5 h-8 rounded-full ${c.kind === 'suggestion' ? 'bg-violet-400' : 'bg-sky-400'}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-slate-400">{c.ref}</span>
                <span className="text-[10px] uppercase font-semibold text-slate-500">{c.kind}</span>
                <span className="text-[11px] text-slate-400">{CATEGORY_LABEL[c.category]}</span>
                {c.assignedTo && <span className="text-[10px] text-amber-600 font-semibold">Assigned {c.assignedTo.name}</span>}
              </div>
              <p className="text-sm font-medium text-slate-800 truncate">{c.title}</p>
              <p className="text-[11px] text-slate-400">{c.reporter?.anonymous ? 'Anonymous' : c.reporter?.name} · {c.reporter?.className} · {fmt(c.updatedAt)}</p>
            </div>
            <ChevronRight size={14} className={`text-slate-300 transition ${openId === c.id ? 'rotate-90' : ''}`} />
          </button>

          {openId === c.id && (
            <div className="border-t border-slate-100 px-4 py-3 space-y-3 bg-slate-50/60">
              <p className="text-sm text-slate-700 whitespace-pre-wrap bg-white border border-slate-200 rounded-lg px-3 py-2">{c.body}</p>
              {(c.replies || []).length > 0 && (
                <div className="space-y-2">
                  {c.replies.map(r => (
                    <div key={r.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                      <div className="text-[11px] text-slate-500"><span className="font-semibold text-slate-700">{r.authorName}</span> · {r.authorType} · {fmt(r.createdAt)}</div>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap mt-1">{r.body}</p>
                    </div>
                  ))}
                </div>
              )}

              {!c.assignedTo && (
                <button onClick={() => claim.mutate(c.id)} disabled={claim.isPending} className={btnPrimary}>
                  {claim.isPending ? <Loader2 size={13} className="animate-spin" /> : <Users size={13} />} Claim this case
                </button>
              )}

              <div className="flex items-start gap-2">
                <textarea value={reply} onChange={e => setReply(e.target.value)} rows={2} placeholder="Reply to the student…" className={inputCls} />
                <button onClick={() => send.mutate({ id: c.id, internal: false })} disabled={send.isPending || !reply.trim()} className={`${btnPrimary} mt-0.5`}>
                  <Send size={13} />
                </button>
              </div>

              <details className="text-[12px] text-slate-500">
                <summary className="cursor-pointer">Advanced</summary>
                <div className="mt-2 space-y-2">
                  <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Internal note (never shown to the student)…" className={inputCls} />
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => send.mutate({ id: c.id, internal: true })} disabled={!note.trim()} className={btnGhost}>
                      <Lock size={12} /> Add internal note
                    </button>
                    <button onClick={() => decide.mutate({ id: c.id, status: 'resolved', note })} className={btnGhost}>
                      <CheckCircle2 size={13} /> Resolve
                    </button>
                    <button onClick={() => escalate.mutate(c.id)} className={`${btnGhost} text-red-500 hover:text-red-600`}>
                      <AlertTriangle size={13} /> Escalate to staff
                    </button>
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
