import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle, Briefcase, Check, Globe, GraduationCap, HeartHandshake,
  Loader2, Lock, Megaphone, MessageSquare, Plus, Send, Sparkles, Users, X,
} from 'lucide-react';
import clsx from 'clsx';
import { messages as msgsApi } from '@/api/client.js';
import {
  AUDIENCE_OPTIONS, canBroadcast, isPortalRole,
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

  const [mode, setMode] = useState('direct');
  const [selected, setSelected] = useState([]);
  const [scope, setScope] = useState('all');
  const [audience, setAudience] = useState('all');
  const [groupId, setGroupId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState([]);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [createdGroups, setCreatedGroups] = useState([]);

  useEffect(() => {
    if (!open) return;
    const requested = initial?.mode
      || (initial?.groupId ? 'group' : (initial?.type === 'announcement' ? 'announcement' : 'direct'));
    setMode(requested === 'group' && portal ? 'direct' : requested === 'announcement' && !broadcastAllowed ? 'direct' : requested);
    setSelected(initial?.recipients ?? []);
    setScope('all');
    setAudience(initial?.audience ?? 'all');
    setGroupId(initial?.groupId ?? '');
    setSubject(initial?.subject ?? '');
    setBody(initial?.body ?? '');
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

  const groups = useMemo(() => {
    const base = groupsResult?.data ?? [];
    const merged = [...createdGroups, ...base.filter(g => !createdGroups.some(c => c.id === g.id))];
    return merged;
  }, [groupsResult, createdGroups]);

  const selectedGroup = groups.find(g => g.id === groupId) ?? null;

  function selectMode(next) {
    if (next === 'announcement' && !broadcastAllowed) return;
    if (next === 'group' && portal) return;
    setMode(next);
    setError('');
  }

  function validate() {
    if (!subject.trim()) return 'Add a subject so recipients know what this is about.';
    if (!body.trim()) return 'Write a message before sending.';
    if (mode === 'direct' && selected.length === 0) return 'Choose at least one person to message.';
    if (mode === 'announcement' && !audience) return 'Choose an audience for the announcement.';
    if (mode === 'group' && !groupId) return 'Select a saved group or create one first.';
    return '';
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
      const payload = {
        subject: subject.trim(),
        body: body.trim(),
        type: mode === 'announcement' ? 'announcement' : 'direct',
      };
      if (mode === 'direct') payload.recipients = selected.map(s => s.id);
      if (mode === 'announcement') payload.recipients = [audience];
      if (mode === 'group') payload.groupId = groupId;

      const sent = await msgsApi.send(payload);
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
      : (selectedGroup?.memberCount ?? 0);

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
              <div className="grid grid-cols-3 gap-2">
                {MODES.map(({ id, label, desc, icon: Icon }) => {
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
                  {mode === 'announcement'
                    ? `Broadcast to ${AUDIENCE_OPTIONS.find(o => o.value === audience)?.label ?? audience}`
                    : mode === 'group'
                      ? (selectedGroup ? `Group · ${selectedGroup.name}` : 'No group selected')
                      : recipientCount
                        ? `${recipientCount} ${recipientCount === 1 ? 'recipient' : 'recipients'}`
                        : 'No recipients yet'}
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
