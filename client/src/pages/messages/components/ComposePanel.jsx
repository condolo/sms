import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, Bell, BookOpen, Briefcase, CalendarClock, Check, FileText,
  Globe, GraduationCap, HeartHandshake, Loader2, Lock, Megaphone,
  MessageSquare, Paperclip, PieChart, Plus, Send, Sparkles, Trash2, Users, X,
} from 'lucide-react';
import clsx from 'clsx';
import { messages as msgsApi, teacherPortalApi } from '@/api/client.js';
import {
  ATTACHMENT_MAX_BYTES, AUDIENCE_OPTIONS, MESSAGE_KINDS, POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS, canBroadcast, isPortalRole, isRichKind, kindMeta,
} from '../constants.js';
import Avatar from './Avatar.jsx';
import RecipientPicker from './RecipientPicker.jsx';

const AUDIENCE_ICONS = {
  all: Globe,
  teachers: GraduationCap,
  parents: HeartHandshake,
  students: GraduationCap,
  staff: Briefcase,
};

/** Icons for the rich message kinds (the labels live in constants.js). */
const KIND_ICONS = {
  text: MessageSquare,
  reminder: Bell,
  homework: BookOpen,
  results: GraduationCap,
  poll: PieChart,
};

const KIND_TONES = {
  slate: 'border-slate-300 bg-slate-900 text-white',
  amber: 'border-amber-300 bg-amber-500 text-white',
  sky: 'border-sky-300 bg-sky-600 text-white',
  emerald: 'border-emerald-300 bg-emerald-600 text-white',
  violet: 'border-violet-300 bg-violet-600 text-white',
};

/* `datetime-local` wants a local "YYYY-MM-DDTHH:mm", never an ISO string
   (feeding it toISOString() silently shows the wrong wall-clock time). */
function toLocalInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const AUDIENCE_TONES = {
  violet: 'border-violet-200 bg-violet-50 text-violet-700 ring-violet-100',
  sky: 'border-sky-200 bg-sky-50 text-sky-700 ring-sky-100',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 ring-emerald-100',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 ring-amber-100',
  rose: 'border-rose-200 bg-rose-50 text-rose-700 ring-rose-100',
};

const MODES = [
  {
    id: 'direct',
    label: 'Direct',
    desc: 'One person or a hand-picked group',
    icon: MessageSquare,
  },
  {
    id: 'audience',
    label: 'Class & staff',
    desc: 'Parents of a class, the office or teachers',
    icon: Users,
    tier: 'teacher',
  },
  {
    id: 'announcement',
    label: 'Announcement',
    desc: 'Broadcast to a school audience',
    icon: Megaphone,
  },
  {
    id: 'group',
    label: 'Saved group',
    desc: 'Reuse a class, team or committee',
    icon: Users,
  },
];

export default function ComposePanel({ open, initial, onClose, onSent, currentRole }) {
  const qc = useQueryClient();
  const portal = isPortalRole(currentRole);
  const broadcastAllowed = canBroadcast(currentRole);
  /* Rich compose (kind / due / poll / attachment) and the server-resolved
     class-and-staff audiences exist only on the teacher portal, for the two
     roles it accepts — teacher and staff. Everyone else keeps the plain
     compose, which is exactly what POST /api/messages supports. */
  const richCapable = currentRole === 'teacher' || currentRole === 'staff';
  const modes = useMemo(() => MODES.filter(m => m.tier !== 'teacher' || richCapable), [richCapable]);

  const [mode, setMode] = useState('direct');
  const [selected, setSelected] = useState([]);
  const [scope, setScope] = useState('all');
  const [audience, setAudience] = useState('all');
  const [categoryKey, setCategoryKey] = useState('');
  const [groupId, setGroupId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState('text');
  const [dueAt, setDueAt] = useState('');
  const [context, setContext] = useState(null);
  const [attachment, setAttachment] = useState(null);
  const [attachmentError, setAttachmentError] = useState('');
  const [readingFile, setReadingFile] = useState(false);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState(['', '']);
  const [pollClosesAt, setPollClosesAt] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [createdGroups, setCreatedGroups] = useState([]);
  const fileInput = useRef(null);

  useEffect(() => {
    if (!open) return;
    const requested = initial?.mode
      || (initial?.groupId ? 'group' : (initial?.type === 'announcement' ? 'announcement' : 'direct'));
    setMode(requested === 'group' && portal ? 'direct' : requested === 'announcement' && !broadcastAllowed ? 'direct' : requested);
    setSelected(initial?.recipients ?? []);
    setScope('all');
    setAudience(initial?.audience ?? 'all');
    setCategoryKey(initial?.categoryKey ?? '');
    setGroupId(initial?.groupId ?? '');
    setSubject(initial?.subject ?? '');
    setBody(initial?.body ?? '');
    setKind(initial?.kind ?? 'text');
    setDueAt(initial?.dueAt ? toLocalInput(initial.dueAt) : '');
    setContext(initial?.context ?? null);
    setAttachment(null);
    setAttachmentError('');
    setReadingFile(false);
    setPollQuestion('');
    setPollOptions(['', '']);
    setPollClosesAt('');
    setCreatingGroup(!!initial?.createNew && !portal);
    setNewGroupName('');
    setNewGroupMembers([]);
    setCreating(false);
    setSending(false);
    setError('');
    setCreatedGroups([]);
    // Deliberately keyed only on `open`: initial is a one-shot snapshot
    // prepared by the page when the panel is opened, not a live binding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const { data: groupsResult } = useQuery({
    queryKey: ['message-groups'],
    queryFn: () => msgsApi.groups.list(),
    enabled: open && !portal,
    staleTime: 30_000,
  });

  /* The server's own view of what a teacher may start: "Parents of Form 1A"
     and friends. Sending a key rather than ids is what lets the server
     re-check membership at send time. */
  const { data: recipientsResult, isLoading: categoriesLoading } = useQuery({
    queryKey: ['teacher-message-recipients'],
    queryFn: () => teacherPortalApi.messageRecipients(),
    enabled: open && richCapable,
    staleTime: 60_000,
  });
  const categories = recipientsResult?.data?.categories ?? [];
  const selectedCategory = categories.find(c => c.key === categoryKey) ?? null;

  const groups = useMemo(() => {
    const base = groupsResult?.data ?? [];
    const merged = [...createdGroups, ...base.filter(g => !createdGroups.some(c => c.id === g.id))];
    return merged;
  }, [groupsResult, createdGroups]);

  const selectedGroup = groups.find(g => g.id === groupId) ?? null;

  function selectMode(next) {
    if (next === 'announcement' && !broadcastAllowed) return;
    if (next === 'group' && portal) return;
    if (next === 'audience' && !richCapable) return;
    /* A broadcast goes through POST /messages, which has no extras fields at
       all — so clear them here rather than leaving a poll or a document
       attached to a draft whose editor is no longer on screen. */
    if (next === 'announcement') {
      setKind('text');
      setDueAt('');
      setAttachment(null);
      setAttachmentError('');
    }
    setMode(next);
    setError('');
  }

  /** The rich fields, in the exact shape server/utils/message-extras.js reads. */
  function buildExtras() {
    if (!richCapable) return {};
    const extras = { kind };
    if (dueAt) extras.dueAt = new Date(dueAt).toISOString();
    if (context?.title) extras.context = context;
    if (attachment) extras.attachment = { name: attachment.name, dataUrl: attachment.dataUrl };
    if (kind === 'poll') {
      extras.poll = {
        question: pollQuestion.trim(),
        options: pollOptions.map(o => o.trim()).filter(Boolean),
      };
      if (pollClosesAt) extras.poll.closesAt = new Date(pollClosesAt).toISOString();
    }
    return extras;
  }

  const cleanPollOptions = pollOptions.map(o => o.trim()).filter(Boolean);
  const carriesExtras = richCapable && (isRichKind(kind) || Boolean(attachment));

  function validate() {
    if (!subject.trim()) return 'Add a subject so recipients know what this is about.';
    if (!body.trim()) return 'Write a message before sending.';
    if (mode === 'direct' && selected.length === 0) return 'Choose at least one person to message.';
    if (mode === 'announcement' && !audience) return 'Choose an audience for the announcement.';
    if (mode === 'audience' && !categoryKey) return 'Choose who should receive this message.';
    if (mode === 'group' && !groupId) return 'Select a saved group or create one first.';
    if (kind === 'poll') {
      if (!pollQuestion.trim()) return 'Write the poll question.';
      if (cleanPollOptions.length < 2) return 'A poll needs at least two options.';
    }
    if (attachment && attachment.size > ATTACHMENT_MAX_BYTES) return 'That document must be 4 MB or smaller.';
    return '';
  }

  async function pickAttachment(file) {
    setAttachmentError('');
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setAttachmentError('That document is larger than 4 MB.');
      return;
    }
    setReadingFile(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('That document could not be read.'));
        reader.readAsDataURL(file);
      });
      setAttachment({ name: file.name, size: file.size, mimeType: file.type, dataUrl });
    } catch (err) {
      setAttachmentError(err.message || 'That document could not be read.');
    } finally {
      setReadingFile(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function setPollOption(index, value) {
    setPollOptions(prev => prev.map((o, i) => (i === index ? value.slice(0, 80) : o)));
    setError('');
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) { setError('Give the group a name.'); return; }
    if (!newGroupMembers.length) { setError('Add at least one member to the group.'); return; }
    setCreating(true);
    setError('');
    try {
      const res = await msgsApi.groups.create({
        name: newGroupName.trim(),
        memberIds: newGroupMembers.map(m => m.id),
      });
      const group = res?.data;
      if (group) {
        setCreatedGroups(prev => [group, ...prev]);
        setGroupId(group.id);
        qc.setQueryData(['message-groups'], old => {
          if (!old?.data) return old;
          return { ...old, data: [group, ...old.data.filter(g => g.id !== group.id)] };
        });
      }
      setCreatingGroup(false);
      setNewGroupName('');
      setNewGroupMembers([]);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not create the group.');
    } finally {
      setCreating(false);
    }
  }

  async function handleSend() {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setSending(true);
    setError('');
    try {
      const base = { subject: subject.trim(), body: body.trim() };
      /* Two send paths, and which one is used is decided by the server's
         capabilities rather than by taste:
           • teacher portal compose — accepts the rich extras, and the
             class/staff categories that only exist there. Recipients are
             re-resolved server-side from a key or from ids that must be a
             colleague or a parent of one of this teacher's own classes.
           • POST /messages — the plain route every other role uses; it
             deliberately ignores the extra fields. */
      const richSend = mode === 'audience' || (mode !== 'announcement' && carriesExtras);
      let sent;

      if (richSend) {
        const payload = { ...base, ...buildExtras() };
        if (mode === 'audience') payload.category = categoryKey;
        else if (mode === 'group') payload.groupId = groupId;
        else payload.memberIds = selected.map(s => s.id);
        sent = await teacherPortalApi.compose(payload);
      } else {
        const payload = { ...base, type: mode === 'announcement' ? 'announcement' : 'direct' };
        if (mode === 'direct') payload.recipients = selected.map(s => s.id);
        if (mode === 'announcement') payload.recipients = [audience];
        if (mode === 'group') payload.groupId = groupId;
        sent = await msgsApi.send(payload);
      }

      onSent?.(sent);
      onClose?.();
    } catch (err) {
      setError(err.message || 'Could not send the message.');
    } finally {
      setSending(false);
    }
  }

  const recipientCount = mode === 'direct'
    ? selected.length
    : mode === 'announcement'
      ? null
      : mode === 'audience'
        ? (selectedCategory?.count ?? 0)
        : (selectedGroup?.memberCount ?? 0);

  const footerTarget = mode === 'announcement'
    ? `Broadcast to ${AUDIENCE_OPTIONS.find(o => o.value === audience)?.label ?? audience}`
    : mode === 'audience'
      ? (selectedCategory ? `${selectedCategory.label} · ${selectedCategory.count} people` : 'No audience selected')
      : mode === 'group'
        ? (selectedGroup ? `Group · ${selectedGroup.name}` : 'No group selected')
        : recipientCount
          ? `${recipientCount} ${recipientCount === 1 ? 'recipient' : 'recipients'}`
          : 'No recipients yet';

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-slate-50 shadow-2xl"
          >
            {/* Header */}
            <div className="relative shrink-0 overflow-hidden bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 px-6 py-5 text-white">
              <div className="pointer-events-none absolute -right-10 -top-14 h-40 w-40 rounded-full bg-white/10" />
              <div className="pointer-events-none absolute -bottom-16 right-24 h-36 w-36 rounded-full bg-white/10" />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
                    <Sparkles size={12} /> New conversation
                  </div>
                  <h2 className="text-lg font-bold">Compose a message</h2>
                  <p className="mt-0.5 text-xs text-white/70">
                    Direct to one person or many, or broadcast to an audience.
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-xl bg-white/10 p-2 text-white/80 transition hover:bg-white/20 hover:text-white"
                  aria-label="Close compose"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
              {/* Mode */}
              <div className={clsx('grid gap-2', modes.length > 3 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
                {modes.map(({ id, label, desc, icon: Icon }) => {
                  const disabled = (id === 'announcement' && !broadcastAllowed) || (id === 'group' && portal);
                  const active = mode === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => selectMode(id)}
                      disabled={disabled}
                      title={disabled ? (id === 'group' ? 'Only staff can create saved groups' : 'Only staff can send announcements') : desc}
                      className={clsx(
                        'group relative rounded-xl border p-3 text-left transition',
                        active
                          ? 'border-violet-300 bg-white shadow-sm ring-4 ring-violet-100'
                          : 'border-slate-200 bg-white/70 hover:border-slate-300 hover:bg-white',
                        disabled && 'cursor-not-allowed opacity-45',
                      )}
                    >
                      <div className={clsx(
                        'mb-2 flex h-8 w-8 items-center justify-center rounded-lg',
                        active ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500',
                      )}>
                        {disabled ? <Lock size={15} /> : <Icon size={15} />}
                      </div>
                      <p className="text-xs font-semibold text-slate-800">{label}</p>
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-slate-400">{desc}</p>
                      {active && (
                        <span className="absolute right-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-violet-600 text-white">
                          <Check size={9} strokeWidth={3} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Direct recipients */}
              {mode === 'direct' && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">To</h3>
                      <p className="text-[11px] text-slate-400">Search staff, parents or students by name.</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      {selected.length} selected
                    </span>
                  </div>
                  <RecipientPicker
                    selected={selected}
                    onChange={setSelected}
                    scope={scope}
                    onScopeChange={setScope}
                    allowScope={!portal}
                    enabled={open}
                  />
                  {portal && (
                    <p className="mt-2 text-[11px] text-slate-400">
                      Parent and student accounts can message staff directly. To reach several staff members, add them here.
                    </p>
                  )}
                </section>
              )}

              {/* Announcement audience */}
              {mode === 'announcement' && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-slate-800">Audience</h3>
                    <p className="text-[11px] text-slate-400">
                      Everyone in this audience gets an in-app message and an email notification (when enabled).
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {AUDIENCE_OPTIONS.map(opt => {
                      const Icon = AUDIENCE_ICONS[opt.value] ?? Users;
                      const active = audience === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => { setAudience(opt.value); setError(''); }}
                          className={clsx(
                            'flex items-start gap-3 rounded-xl border p-3 text-left transition',
                            active
                              ? `${AUDIENCE_TONES[opt.tone]} ring-4`
                              : 'border-slate-200 bg-white hover:border-slate-300',
                          )}
                        >
                          <span className={clsx(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                            active ? 'bg-white/70' : 'bg-slate-100 text-slate-500',
                          )}>
                            <Icon size={16} />
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5 text-xs font-semibold">
                              {opt.label}
                              {active && <Check size={12} strokeWidth={3} />}
                            </span>
                            <span className="mt-0.5 block text-[10px] leading-tight opacity-70">{opt.desc}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Server-resolved audiences (teacher portal only) */}
              {mode === 'audience' && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-slate-800">Who should get this?</h3>
                    <p className="text-[11px] text-slate-400">
                      The school works these lists out at send time, so a parent who joins
                      your class tomorrow is included without you picking anyone again.
                    </p>
                  </div>

                  {categoriesLoading ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-400">
                      <Loader2 size={14} className="animate-spin" /> Loading audiences…
                    </div>
                  ) : categories.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                      <Users size={22} className="mx-auto mb-2 text-slate-300" />
                      <p className="text-xs font-medium text-slate-600">No audiences available</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        Audiences come from your own classes. Use Direct to pick people by name.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {categories.map(cat => {
                        const Icon = cat.key.startsWith('parents:')
                          ? HeartHandshake
                          : cat.key === 'staff:office' ? Briefcase : GraduationCap;
                        const active = categoryKey === cat.key;
                        return (
                          <button
                            key={cat.key}
                            type="button"
                            onClick={() => { setCategoryKey(cat.key); setError(''); }}
                            className={clsx(
                              'flex items-start gap-3 rounded-xl border p-3 text-left transition',
                              active
                                ? 'border-violet-300 bg-violet-50 ring-4 ring-violet-100'
                                : 'border-slate-200 bg-white hover:border-slate-300',
                            )}
                          >
                            <span className={clsx(
                              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                              active ? 'bg-white text-violet-700' : 'bg-slate-100 text-slate-500',
                            )}>
                              <Icon size={16} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-800">
                                {cat.label}
                                {active && <Check size={12} strokeWidth={3} className="text-violet-600" />}
                              </span>
                              <span className="mt-0.5 block text-[10px] text-slate-400">
                                {cat.count} {cat.count === 1 ? 'person' : 'people'}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {selectedCategory && (
                    <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                      <Check size={12} className="shrink-0 text-emerald-500" />
                      This will reach {selectedCategory.count} {selectedCategory.count === 1 ? 'person' : 'people'} in
                      <strong className="text-slate-700">{selectedCategory.label}</strong>.
                    </div>
                  )}
                </section>
              )}

              {/* Saved groups */}
              {mode === 'group' && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">Saved groups</h3>
                      <p className="text-[11px] text-slate-400">Reusable recipient lists for classes, teams and committees.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setCreatingGroup(v => !v); setError(''); }}
                      className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100"
                    >
                      <Plus size={12} /> New group
                    </button>
                  </div>

                  {groups.length === 0 && !creatingGroup ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                      <Users size={24} className="mx-auto mb-2 text-slate-300" />
                      <p className="text-xs font-medium text-slate-600">No saved groups yet</p>
                      <p className="mt-1 text-[11px] text-slate-400">Create one for a class, department or committee.</p>
                      <button
                        type="button"
                        onClick={() => setCreatingGroup(true)}
                        className="mt-3 inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-violet-700"
                      >
                        <Plus size={12} /> Create your first group
                      </button>
                    </div>
                  ) : (
                    <div className="max-h-56 space-y-2 overflow-y-auto pr-0.5">
                      {groups.map(g => {
                        const active = groupId === g.id;
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => { setGroupId(g.id); setError(''); }}
                            className={clsx(
                              'flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition',
                              active
                                ? 'border-violet-300 bg-violet-50 ring-4 ring-violet-100'
                                : 'border-slate-200 bg-white hover:border-slate-300',
                            )}
                          >
                            <Avatar group name={g.name} size="sm" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold text-slate-800">{g.name}</span>
                              <span className="block text-[10px] text-slate-400">
                                {g.memberCount ?? g.memberIds?.length ?? 0} members
                                {g.createdByName ? ` · by ${g.createdByName}` : ''}
                              </span>
                            </span>
                            {active && (
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white">
                                <Check size={11} strokeWidth={3} />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {creatingGroup && (
                    <div className="mt-3 space-y-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-700">Create a new group</p>
                        <button
                          type="button"
                          onClick={() => { setCreatingGroup(false); setError(''); }}
                          className="text-slate-400 hover:text-slate-600"
                          aria-label="Cancel new group"
                        >
                          <X size={14} />
                        </button>
                      </div>
                      <input
                        value={newGroupName}
                        onChange={e => setNewGroupName(e.target.value)}
                        placeholder="Group name — e.g. Form 4 Teachers"
                        maxLength={80}
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                      />
                      <RecipientPicker
                        selected={newGroupMembers}
                        onChange={setNewGroupMembers}
                        scope={scope}
                        onScopeChange={setScope}
                        allowScope
                        enabled={open}
                        placeholder="Add members by name…"
                        emptyHint="Search for the people who should receive group messages."
                      />
                      <button
                        type="button"
                        onClick={handleCreateGroup}
                        disabled={creating}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                      >
                        {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                        {creating ? 'Creating…' : 'Create group'}
                      </button>
                    </div>
                  )}

                  {selectedGroup && !creatingGroup && (
                    <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
                      <Check size={12} className="text-emerald-500" />
                      This message will go to {selectedGroup.memberCount ?? selectedGroup.memberIds?.length ?? 0} people in
                      <strong className="text-slate-700">{selectedGroup.name}</strong>.
                    </div>
                  )}
                </section>
              )}

              {/* Subject + body */}
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                  Subject <span className="text-rose-500">*</span>
                  <span className="float-right font-normal text-[10px] text-slate-400">{subject.length}/200</span>
                </label>
                <input
                  value={subject}
                  onChange={e => { setSubject(e.target.value.slice(0, 200)); setError(''); }}
                  placeholder={mode === 'announcement' ? 'Announcement title…' : 'What is this about?'}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                />

                <label className="mb-1.5 mt-4 block text-xs font-semibold text-slate-700">
                  Message <span className="text-rose-500">*</span>
                  <span className="float-right font-normal text-[10px] text-slate-400">{body.length}/10000</span>
                </label>
                <textarea
                  value={body}
                  onChange={e => { setBody(e.target.value.slice(0, 10_000)); setError(''); }}
                  rows={9}
                  placeholder="Write your message here…"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                />
              </section>

              {richCapable && mode !== 'announcement' && (
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-800">What kind of message?</h3>
                      <p className="text-[11px] text-slate-400">
                        A plain message is fine. Reminders, homework and polls carry a deadline,
                        a document or choices your recipients can answer.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {MESSAGE_KINDS.map(({ value, label, desc, tone }) => {
                      const Icon = KIND_ICONS[value] ?? MessageSquare;
                      const active = kind === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => { setKind(value); setError(''); }}
                          title={desc}
                          className={clsx(
                            'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2.5 text-center transition',
                            active
                              ? KIND_TONES[tone]
                              : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300',
                          )}
                        >
                          <Icon size={15} />
                          <span className="text-[10px] font-semibold">{label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {context?.title && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-500">Context</p>
                        <p className="truncate text-xs font-semibold text-slate-800">{context.title}</p>
                        {context.detail && <p className="truncate text-[11px] text-slate-500">{context.detail}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => setContext(null)}
                        className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-white hover:text-slate-600"
                        aria-label="Remove context"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  )}

                  {(kind === 'reminder' || kind === 'homework') && (
                    <div className="mt-3">
                      <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                        Due by
                        <span className="float-right font-normal text-[10px] text-slate-400">optional</span>
                      </label>
                      <input
                        type="datetime-local"
                        value={dueAt}
                        onChange={e => { setDueAt(e.target.value); setError(''); }}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                      />
                    </div>
                  )}

                  {kind === 'poll' ? (
                    <div className="mt-3 space-y-2.5">
                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Poll question <span className="text-rose-500">*</span>
                        </label>
                        <input
                          value={pollQuestion}
                          onChange={e => { setPollQuestion(e.target.value.slice(0, 140)); setError(''); }}
                          placeholder="e.g. Which day suits the parents' meeting?"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                        />
                      </div>

                      <div className="space-y-2">
                        {pollOptions.map((option, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-50 text-[10px] font-bold text-violet-600">
                              {index + 1}
                            </span>
                            <input
                              value={option}
                              onChange={e => setPollOption(index, e.target.value)}
                              placeholder={`Option ${index + 1}`}
                              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                            />
                            {pollOptions.length > POLL_MIN_OPTIONS && (
                              <button
                                type="button"
                                onClick={() => setPollOptions(prev => prev.filter((_, i) => i !== index))}
                                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                                aria-label={`Remove option ${index + 1}`}
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setPollOptions(prev => [...prev, ''])}
                          disabled={pollOptions.length >= POLL_MAX_OPTIONS}
                          className="inline-flex items-center gap-1 rounded-lg border border-violet-200 bg-violet-50 px-2.5 py-1.5 text-[11px] font-semibold text-violet-700 transition hover:bg-violet-100 disabled:opacity-45"
                        >
                          <Plus size={11} /> Add option
                        </button>
                        <span className="text-[10px] text-slate-400">
                          {pollOptions.length}/{POLL_MAX_OPTIONS} options
                        </span>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold text-slate-700">
                          Stop accepting votes
                          <span className="float-right font-normal text-[10px] text-slate-400">optional</span>
                        </label>
                        <input
                          type="datetime-local"
                          value={pollClosesAt}
                          onChange={e => { setPollClosesAt(e.target.value); setError(''); }}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3">
                      <input
                        ref={fileInput}
                        type="file"
                        className="hidden"
                        onChange={e => pickAttachment(e.target.files?.[0])}
                      />
                      {attachment ? (
                        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-violet-600 shadow-sm">
                            <FileText size={15} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-semibold text-slate-800">{attachment.name}</p>
                            <p className="text-[10px] text-slate-400">{(attachment.size / 1024 / 1024).toFixed(2)} MB · attached</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAttachment(null)}
                            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                            aria-label="Remove attachment"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileInput.current?.click()}
                          disabled={readingFile}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3 text-[11px] font-semibold text-slate-500 transition hover:border-violet-300 hover:text-violet-600 disabled:opacity-50"
                        >
                          {readingFile ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />}
                          {readingFile ? 'Reading file…' : 'Attach a document (max 4 MB)'}
                        </button>
                      )}
                      {attachmentError && (
                        <p className="mt-2 flex items-center gap-1 text-[10px] text-rose-600">
                          <AlertTriangle size={10} /> {attachmentError}
                        </p>
                      )}
                    </div>
                  )}

                  {mode === 'direct' && carriesExtras && (
                    <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[10px] leading-relaxed text-amber-700">
                      <CalendarClock size={11} className="mt-0.5 shrink-0" />
                      A reminder, poll or attachment can go to staff and to parents of your own
                      classes. For anyone else, send it as a plain message.
                    </p>
                  )}
                </section>
              )}

              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-4">
              <div className="flex items-center justify-between gap-4">
                <p className="min-w-0 truncate text-[11px] text-slate-400">
                  {footerTarget}
                  {isRichKind(kind) && (
                    <span className="ml-1.5 text-violet-500">· {kindMeta(kind).label}</span>
                  )}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-xl px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending}
                    className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-700 disabled:opacity-50"
                  >
                    {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    {sending ? 'Sending…' : 'Send message'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
