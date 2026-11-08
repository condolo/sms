/* ============================================================
   Student Council — staff patron console

   Three desks behind one nav item:
     Cases      every grievance/suggestion, identities included. A
                safeguarding case is flagged and cannot be buried.
     Elections  create, vet candidates, close (tally happens server-side
                and seats the winners as elected members).
     Members    who sits on the council, elected or appointed.

   Students file and reply from /student-council; council members triage
   from the queue on the same student screen. This page is the adult in
   the room, not a second student UI.
   ============================================================ */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Megaphone, ShieldAlert, Users, Vote, Plus, X, Loader2, CheckCircle2,
  Search, CalendarDays, ChevronRight, Send,
} from 'lucide-react';
import { council as councilApi, students as studentsApi } from '@/api/client.js';

const TABS = [
  { key: 'cases',     label: 'Cases',     Icon: Megaphone },
  { key: 'elections', label: 'Elections', Icon: Vote },
  { key: 'members',   label: 'Members',   Icon: Users },
];

const STATUS_META = {
  open:         { label: 'Open',         cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  under_review: { label: 'Under review', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  escalated:    { label: 'Escalated',    cls: 'bg-red-50 text-red-700 ring-red-200' },
  resolved:     { label: 'Resolved',     cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  rejected:     { label: 'Closed',       cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  merged:       { label: 'Merged',       cls: 'bg-violet-50 text-violet-700 ring-violet-200' },
  withdrawn:    { label: 'Withdrawn',    cls: 'bg-slate-100 text-slate-500 ring-slate-200' },
};

const CATEGORY_LABEL = {
  welfare: 'Welfare', academics: 'Academics', facilities: 'Facilities',
  safety: 'Safety', other: 'Other',
};

const fmt = (v) => (v ? new Date(v).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '');
const inputCls = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 bg-white';
const btnPrimary = 'inline-flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition';
const btnGhost = 'inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg hover:bg-slate-50 transition';

function Stat({ label, value, tone = 'slate' }) {
  const tones = {
    slate: 'text-slate-900', red: 'text-red-600', amber: 'text-amber-600', emerald: 'text-emerald-600',
  };
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-2xl font-extrabold mt-1 ${tones[tone] || tones.slate}`}>{value}</div>
    </div>
  );
}

export default function CouncilPage() {
  const [tab, setTab] = useState('cases');
  const overview = useQuery({ queryKey: ['council', 'overview'], queryFn: () => councilApi.admin.overview() });
  const data = overview.data || {};

  /* Direct navigation to /council is possible even for a role without the
     grant — the nav hides it, but a bookmark or a pasted URL must not sit
     on "Loading…" forever. The API's 403 is the authority; show it plainly. */
  if (overview.isError) {
    const status = overview.error?.status;
    return (
      <div className="max-w-xl mx-auto px-6 py-16 text-center">
        <ShieldAlert size={26} className="mx-auto text-amber-500 mb-3" />
        <h1 className="text-lg font-bold text-slate-900">You don’t have access to the Student Council</h1>
        <p className="text-sm text-slate-500 mt-2">
          {status === 403
            ? 'Your role does not carry the council module. The school office can grant it under Settings → Roles & Permissions.'
            : 'The council could not be loaded. Please refresh, or try again later.'}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Megaphone size={18} className="text-violet-600" /> Student Council
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Grievances and suggestions from students. Safeguarding cases escalate to you automatically and can only be closed by staff.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Open cases" value={data.open ?? '—'} />
        <Stat label="Safeguarding" value={data.safeguarding ?? '—'} tone={data.safeguarding ? 'red' : 'slate'} />
        <Stat label="Council seats" value={(data.members || []).length} />
        <Stat label="Live elections" value={(data.elections || []).filter(e => ['nominations', 'voting', 'vetting'].includes(e.phase)).length} />
      </div>

      <div className="flex items-center gap-1 border-b border-slate-200">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${
              tab === key ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'cases' && <CasesTab />}
      {tab === 'elections' && <ElectionsTab />}
      {tab === 'members' && <MembersTab />}
    </div>
  );
}

/* ── Cases ─────────────────────────────────────────────────── */

function CasesTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [safeguardingOnly, setSafeguardingOnly] = useState(false);
  const [openId, setOpenId] = useState(null);

  const params = useMemo(() => ({
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
    ...(safeguardingOnly ? { safeguarding: '1' } : {}),
  }), [status, kind, safeguardingOnly]);

  const list = useQuery({
    queryKey: ['council', 'cases', params],
    queryFn: () => councilApi.admin.cases(params),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={status} onChange={e => setStatus(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="under_review">Under review</option>
          <option value="escalated">Escalated</option>
          <option value="resolved">Resolved</option>
          <option value="rejected">Closed</option>
        </select>
        <select value={kind} onChange={e => setKind(e.target.value)} className={`${inputCls} w-auto`}>
          <option value="">Grievances & suggestions</option>
          <option value="grievance">Grievances</option>
          <option value="suggestion">Suggestions</option>
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-slate-600 px-2">
          <input type="checkbox" checked={safeguardingOnly} onChange={e => setSafeguardingOnly(e.target.checked)} className="accent-red-600" />
          Safeguarding only
        </label>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {list.isLoading ? (
          <div className="p-8 text-center text-sm text-slate-400"><Loader2 size={16} className="animate-spin inline mr-2" />Loading cases…</div>
        ) : (list.data || []).length === 0 ? (
          <div className="p-10 text-center">
            <Megaphone size={22} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No cases match these filters yet.</p>
          </div>
        ) : (
          (list.data || []).map(c => (
            <button
              key={c.id}
              onClick={() => setOpenId(c.id)}
              className="w-full text-left flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition"
            >
              <span className={`w-1.5 h-8 rounded-full ${c.safeguarding ? 'bg-red-500' : c.kind === 'suggestion' ? 'bg-violet-400' : 'bg-sky-400'}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-mono text-slate-400">{c.ref}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 ring-1 ${c.kind === 'suggestion' ? 'bg-violet-50 text-violet-700 ring-violet-200' : 'bg-sky-50 text-sky-700 ring-sky-200'}`}>
                    {c.kind}
                  </span>
                  <span className="text-[11px] text-slate-500">{CATEGORY_LABEL[c.category] || c.category}</span>
                  {c.safeguarding && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-50 ring-1 ring-red-200 rounded-full px-2 py-0.5">
                      <ShieldAlert size={10} /> Safeguarding
                    </span>
                  )}
                </div>
                <p className="text-sm font-medium text-slate-800 mt-0.5 truncate">{c.title}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {c.reporter?.anonymous ? 'Anonymous' : c.reporter?.name} · {c.reporter?.className || '—'} · {fmt(c.updatedAt)}
                  {c.upvoteCount > 0 ? ` · ${c.upvoteCount} upvote${c.upvoteCount === 1 ? '' : 's'}` : ''}
                </p>
              </div>
              <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ring-1 whitespace-nowrap ${STATUS_META[c.status]?.cls || ''}`}>
                {STATUS_META[c.status]?.label || c.status}
              </span>
              <ChevronRight size={14} className="text-slate-300" />
            </button>
          ))
        )}
      </div>

      <AnimatePresence>
        {openId && <CaseDrawer id={openId} onClose={() => { setOpenId(null); qc.invalidateQueries({ queryKey: ['council'] }); }} />}
      </AnimatePresence>
    </div>
  );
}

function CaseDrawer({ id, onClose }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['council', 'case', id], queryFn: () => councilApi.admin.getCase(id) });
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [internal, setInternal] = useState(false);
  const [err, setErr] = useState('');

  const update = useMutation({
    mutationFn: () => councilApi.admin.updateCase(id, { ...(status ? { status } : {}), note, internal }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['council'] });
      setNote(''); setStatus(''); setErr('');
      detail.refetch();
    },
    onError: e => setErr(e?.message || 'Update failed.'),
  });

  const c = detail.data;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-6"
      onClick={onClose}
    >
      <motion.div initial={{ y: 24 }} animate={{ y: 0 }} exit={{ y: 24 }}
        onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-3xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col"
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-100">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-slate-400">{c?.ref || '…'}</span>
              {c && <span className={`text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 ring-1 ${STATUS_META[c.status]?.cls || ''}`}>{STATUS_META[c.status]?.label || c.status}</span>}
              {c?.safeguarding && <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-50 ring-1 ring-red-200 rounded-full px-2 py-0.5"><ShieldAlert size={10} /> Safeguarding</span>}
            </div>
            <h2 className="text-base font-semibold text-slate-900 truncate">{c?.title || 'Loading…'}</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {detail.isLoading ? (
            <div className="py-10 text-center text-sm text-slate-400"><Loader2 size={16} className="animate-spin inline mr-2" />Loading…</div>
          ) : !c ? (
            <p className="text-sm text-red-600">Could not load this case.</p>
          ) : (
            <>
              <div className="text-[12px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1">
                <span><strong className="text-slate-700">Type:</strong> {c.kind} · {CATEGORY_LABEL[c.category] || c.category}</span>
                <span><strong className="text-slate-700">Reporter:</strong> {c.reporter?.anonymous ? 'Anonymous' : c.reporter?.name} ({c.reporter?.className || '—'})</span>
                <span><strong className="text-slate-700">Filed:</strong> {fmt(c.createdAt)}</span>
                {c.assignedTo && <span><strong className="text-slate-700">Assigned:</strong> {c.assignedTo.name}</span>}
              </div>

              {/* Staff always see the reporter even when the council does not. */}
              {c.reporter?.anonymous && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  The council sees this as anonymous. You can see the reporter because staff oversight always can.
                </p>
              )}

              <div className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.body}</p>
              </div>

              <div>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Thread</h3>
                {(c.replies || []).length === 0 ? (
                  <p className="text-sm text-slate-400">No replies yet.</p>
                ) : (
                  <div className="space-y-2">
                    {c.replies.map(r => (
                      <div key={r.id} className={`rounded-lg border px-3 py-2 ${r.authorType === 'staff' ? 'bg-violet-50 border-violet-200' : r.authorType === 'council' ? 'bg-sky-50 border-sky-200' : 'bg-white border-slate-200'}`}>
                        <div className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="font-semibold text-slate-700">{r.authorName}</span>
                          <span className="capitalize">{r.authorType}</span>
                          <span>· {fmt(r.createdAt)}</span>
                        </div>
                        <p className="text-sm text-slate-700 whitespace-pre-wrap mt-1">{r.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {(c.events || []).length > 0 && (
                <details className="text-[11px] text-slate-500">
                  <summary className="cursor-pointer select-none">Audit trail ({c.events.length})</summary>
                  <ul className="mt-2 space-y-1">
                    {c.events.map(e => (
                      <li key={e.id}>{fmt(e.at)} — {e.action} {e.byName ? `by ${e.byName}` : ''}{e.note ? ` — ${e.note}` : ''}</li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="border-t border-slate-100 pt-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <select value={status} onChange={e => setStatus(e.target.value)} className={`${inputCls} w-auto`}>
                    <option value="">Change status…</option>
                    {(c.safeguarding ? ['under_review', 'resolved', 'rejected'] : ['under_review', 'resolved', 'rejected', 'open']).map(s => (
                      <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>
                    ))}
                  </select>
                  <label className="inline-flex items-center gap-2 text-[12px] text-slate-600">
                    <input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} className="accent-violet-600" />
                    Internal note (hidden from the student)
                  </label>
                </div>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={3}
                  placeholder={internal ? 'Internal note for the patron team…' : 'Reply to the student (they receive it in-app and by email if enabled)…'}
                  className={inputCls}
                />
                {err && <p className="text-xs text-red-600">{err}</p>}
                <div className="flex justify-end">
                  <button
                    onClick={() => update.mutate()}
                    disabled={update.isPending || (!note.trim() && !status)}
                    className={btnPrimary}
                  >
                    {update.isPending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {update.isPending ? 'Saving…' : 'Save update'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── Elections ─────────────────────────────────────────────── */

const emptyPosition = () => ({ title: '', seats: 1, description: '', eligibleClassIds: [], minAttendancePct: 0 });

function ElectionsTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['council', 'elections'], queryFn: () => councilApi.admin.elections() });
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState(null);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setShowNew(true)} className={btnPrimary}><Plus size={14} /> New election</button>
      </div>

      {(list.data || []).length === 0 ? (
        list.isLoading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin inline mr-2" />Loading elections…
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
            <Vote size={22} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No elections yet. Create one to let students stand and vote.</p>
          </div>
        )
      ) : (
        <div className="space-y-2">
          {(list.data || []).map(e => (
            <ElectionRow key={e.id} election={e} expanded={expanded === e.id} onToggle={() => setExpanded(expanded === e.id ? null : e.id)} onChanged={() => qc.invalidateQueries({ queryKey: ['council'] })} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {showNew && <ElectionForm onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ['council'] }); }} />}
      </AnimatePresence>
    </div>
  );
}

function ElectionRow({ election, expanded, onToggle, onChanged }) {
  const qc = useQueryClient();
  const [closing, setClosing] = useState(false);
  const candidates = useQuery({
    queryKey: ['council', 'candidates', election.id],
    queryFn: () => councilApi.admin.candidates(election.id),
    enabled: expanded,
  });
  const vet = useMutation({
    mutationFn: ({ cid, approve, reason }) => councilApi.admin.vet(election.id, cid, { approve, reason }),
    onSuccess: () => { candidates.refetch(); onChanged(); },
  });
  const close = useMutation({
    mutationFn: () => councilApi.admin.closeElection(election.id),
    onSuccess: () => { setClosing(false); onChanged(); },
    onError: () => setClosing(false),
  });

  const phaseMeta = {
    draft: 'bg-slate-100 text-slate-600 ring-slate-200',
    upcoming: 'bg-sky-50 text-sky-700 ring-sky-200',
    nominations: 'bg-violet-50 text-violet-700 ring-violet-200',
    vetting: 'bg-amber-50 text-amber-700 ring-amber-200',
    voting: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    closed: 'bg-slate-100 text-slate-500 ring-slate-200',
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
        <Vote size={16} className="text-violet-500 flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 truncate">{election.title}</p>
          <p className="text-[11px] text-slate-400">
            {election.termLabel || 'No term'} · {election.positions?.length || 0} position{(election.positions?.length || 0) === 1 ? '' : 's'} · voting ends {fmt(election.votingEnd)}
          </p>
        </div>
        <span className={`text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 ring-1 ${phaseMeta[election.phase] || ''}`}>{election.phase}</span>
        <ChevronRight size={14} className={`text-slate-300 transition ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="border-t border-slate-100 px-4 py-3 space-y-3">
          <div className="grid sm:grid-cols-2 gap-2 text-[12px] text-slate-500">
            <span><strong className="text-slate-700">Nominations:</strong> {fmt(election.nominationStart)} → {fmt(election.nominationEnd)}</span>
            <span><strong className="text-slate-700">Voting:</strong> {fmt(election.votingStart)} → {fmt(election.votingEnd)}</span>
          </div>

          <div>
            <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">Candidates</h4>
            {candidates.isLoading ? (
              <p className="text-sm text-slate-400">Loading…</p>
            ) : (candidates.data || []).length === 0 ? (
              <p className="text-sm text-slate-400">No nominations yet.</p>
            ) : (
              <div className="space-y-1.5">
                {(candidates.data || []).map(c => (
                  <div key={c.id} className="flex items-center gap-2 text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-700 truncate">{c.studentName} <span className="text-[11px] text-slate-400">· {c.className} · {c.positionTitle}</span></p>
                      {c.statement && <p className="text-[11px] text-slate-500 truncate">{c.statement}</p>}
                    </div>
                    <span className={`text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 ring-1 ${
                      c.status === 'approved' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                      : c.status === 'rejected' ? 'bg-red-50 text-red-700 ring-red-200'
                      : 'bg-amber-50 text-amber-700 ring-amber-200'
                    }`}>{c.status}</span>
                    {c.status === 'pending' && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => vet.mutate({ cid: c.id, approve: true, reason: '' })} className="text-emerald-600 hover:text-emerald-700 p-1" title="Approve"><CheckCircle2 size={15} /></button>
                        <button
                          onClick={() => {
                            const reason = window.prompt('Why is this nomination rejected? The candidate sees this.');
                            if (reason && reason.trim()) vet.mutate({ cid: c.id, approve: false, reason });
                          }}
                          className="text-red-500 hover:text-red-600 p-1" title="Reject"
                        ><X size={15} /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {election.phase !== 'closed' && (
            <div className="flex justify-end">
              <button
                onClick={() => { if (window.confirm('Close this election and seat the winners? Results become visible to students.')) { setClosing(true); close.mutate(); } }}
                disabled={closing}
                className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
              >
                {closing ? <Loader2 size={13} className="animate-spin" /> : <Vote size={13} />} Close & tally
              </button>
            </div>
          )}

          {election.phase === 'closed' && Array.isArray(election.results) && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Results</h4>
              {election.results.map(r => (
                <div key={r.positionId} className="rounded-lg border border-slate-200 px-3 py-2">
                  <p className="text-sm font-medium text-slate-700">{r.title} <span className="text-[11px] text-slate-400">· {r.seats} seat{r.seats === 1 ? '' : 's'}{r.runoffRequired ? ' · runoff required' : ''}</span></p>
                  <ul className="mt-1 text-[12px] text-slate-600">
                    {r.candidates.map(c => <li key={c.id}>{c.name} — {c.votes} vote{c.votes === 1 ? '' : 's'}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ElectionForm({ onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [termLabel, setTermLabel] = useState('');
  const [nominationStart, setNominationStart] = useState('');
  const [nominationEnd, setNominationEnd] = useState('');
  const [votingStart, setVotingStart] = useState('');
  const [votingEnd, setVotingEnd] = useState('');
  const [allowSelfVote, setAllowSelfVote] = useState(false);
  const [positions, setPositions] = useState([emptyPosition()]);
  const [err, setErr] = useState('');

  const create = useMutation({
    mutationFn: () => councilApi.admin.createElection({
      title, termLabel,
      nominationStart: new Date(nominationStart).toISOString(),
      nominationEnd: new Date(nominationEnd).toISOString(),
      votingStart: new Date(votingStart).toISOString(),
      votingEnd: new Date(votingEnd).toISOString(),
      allowSelfVote,
      positions: positions.map(p => ({
        title: p.title, seats: Number(p.seats) || 1,
        description: p.description,
        eligibleClassIds: [],
        minAttendancePct: 0,
      })),
    }),
    onSuccess: onCreated,
    onError: e => setErr(e?.message || 'Could not create the election.'),
  });

  const setPos = (i, k, v) => setPositions(ps => ps.map((p, idx) => idx === i ? { ...p, [k]: v } : p));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <motion.div initial={{ y: 24 }} animate={{ y: 0 }} exit={{ y: 24 }} onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-2xl max-h-[92vh] rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">New council election</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Title</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Student Council Elections 2027" className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Term label (optional)</label>
            <input value={termLabel} onChange={e => setTermLabel(e.target.value)} placeholder="Term 1 · 2027" className={inputCls} />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              ['Nominations open', nominationStart, setNominationStart],
              ['Nominations close', nominationEnd, setNominationEnd],
              ['Voting opens', votingStart, setVotingStart],
              ['Voting closes', votingEnd, setVotingEnd],
            ].map(([label, value, setter]) => (
              <div key={label}>
                <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</label>
                <input type="datetime-local" value={value} onChange={e => setter(e.target.value)} className={inputCls} />
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 flex items-center gap-1.5"><CalendarDays size={12} /> Vet candidates between nominations and voting. A missing advance click is tolerated — the phase moves on its own.</p>

          <label className="inline-flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={allowSelfVote} onChange={e => setAllowSelfVote(e.target.checked)} className="accent-violet-600" />
            Allow candidates to vote for themselves
          </label>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Positions</label>
              <button onClick={() => setPositions(ps => [...ps, emptyPosition()])} className={btnGhost}><Plus size={13} /> Add</button>
            </div>
            {positions.map((p, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_32px] gap-2">
                <input value={p.title} onChange={e => setPos(i, 'title', e.target.value)} placeholder="Chairperson" className={inputCls} />
                <input type="number" min={1} max={20} value={p.seats} onChange={e => setPos(i, 'seats', e.target.value)} className={inputCls} title="Seats" />
                <button
                  onClick={() => setPositions(ps => ps.length > 1 ? ps.filter((_, idx) => idx !== i) : ps)}
                  className="text-slate-300 hover:text-red-500"
                ><X size={15} /></button>
              </div>
            ))}
          </div>

          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={() => create.mutate()} disabled={create.isPending} className={btnPrimary}>
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create election
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── Members ───────────────────────────────────────────────── */

function MembersTab() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['council', 'memberships'], queryFn: () => councilApi.admin.memberships() });
  const [showAppoint, setShowAppoint] = useState(false);
  const remove = useMutation({
    mutationFn: (id) => councilApi.admin.removeMember(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['council'] }),
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setShowAppoint(true)} className={btnPrimary}><Plus size={14} /> Appoint member</button>
      </div>

      {(list.data || []).length === 0 ? (
        list.isLoading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin inline mr-2" />Loading members…
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
            <Users size={22} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No council members yet. Appoint one now, or close an election to seat winners.</p>
          </div>
        )
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {(list.data || []).map(m => (
            <div key={m.id} className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0">
              <div className="w-8 h-8 rounded-full bg-violet-50 text-violet-700 flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                {m.name?.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">{m.name} <span className="text-[11px] text-slate-400">· {m.className}</span></p>
                <p className="text-[11px] text-slate-500">{m.positionTitle} · {m.source}{m.termLabel ? ` · ${m.termLabel}` : ''}</p>
              </div>
              <span className={`text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 ring-1 ${m.active ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-slate-100 text-slate-500 ring-slate-200'}`}>
                {m.active ? 'Active' : 'Ended'}
              </span>
              {m.active && (
                <button
                  onClick={() => remove.mutate(m.id)}
                  className="text-slate-300 hover:text-red-500 p-1"
                  title="End this seat"
                ><X size={15} /></button>
              )}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showAppoint && (
          <AppointModal
            onClose={() => setShowAppoint(false)}
            onDone={() => { setShowAppoint(false); qc.invalidateQueries({ queryKey: ['council'] }); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function AppointModal({ onClose, onDone }) {
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState(null);
  const [positionTitle, setPositionTitle] = useState('');
  const [err, setErr] = useState('');

  const search = useQuery({
    queryKey: ['council', 'student-search', term],
    // The raw students resource pages on `search` (not `q`) and returns
    // firstName/lastName rather than a joined name.
    queryFn: () => studentsApi.list({ search: term, limit: 8, status: 'active' }),
    enabled: term.trim().length >= 2,
  });
  // The students resource answers the standard envelope: { data: [...] }.
  const candidates = search.data?.data ?? search.data?.rows ?? [];
  const displayName = (s) => s.name || [s.firstName, s.lastName].filter(Boolean).join(' ') || s.admissionNumber;

  const appoint = useMutation({
    mutationFn: () => councilApi.admin.appoint({
      studentId: picked.id,
      positionTitle,
      termLabel: '',
    }),
    onSuccess: onDone,
    onError: e => setErr(e?.message || 'Could not appoint.'),
  });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-40 bg-slate-900/40 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <motion.div initial={{ y: 24 }} animate={{ y: 0 }} exit={{ y: 24 }} onClick={e => e.stopPropagation()}
        className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">Appoint a council member</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Find the student</label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={term} onChange={e => { setTerm(e.target.value); setPicked(null); }} placeholder="Name or admission number" className={`${inputCls} pl-8`} />
            </div>
            {term.trim().length >= 2 && !picked && (
              <div className="mt-1 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto">
                {search.isLoading ? (
                  <p className="text-sm text-slate-400 px-3 py-2">Searching…</p>
                ) : candidates.length === 0 ? (
                  <p className="text-sm text-slate-400 px-3 py-2">No student matches.</p>
                ) : (
                  candidates.map(s => (
                    <button key={s.id} onClick={() => setPicked(s)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50">
                      <span className="font-medium text-slate-700">{displayName(s)}</span>
                      <span className="text-[11px] text-slate-400"> · {s.className} · {s.admissionNumber}</span>
                    </button>
                  ))
                )}
              </div>
            )}
            {picked && (
              <div className="mt-1 text-sm bg-violet-50 border border-violet-200 rounded-lg px-3 py-2 text-violet-800">
                {displayName(picked)} · {picked.className}
              </div>
            )}
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Position</label>
            <input value={positionTitle} onChange={e => setPositionTitle(e.target.value)} placeholder="Secretary" className={inputCls} />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className={btnGhost}>Cancel</button>
          <button onClick={() => appoint.mutate()} disabled={appoint.isPending || !picked || positionTitle.trim().length < 2} className={btnPrimary}>
            {appoint.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Appoint
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
