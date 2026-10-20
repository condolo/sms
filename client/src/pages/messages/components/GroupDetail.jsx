import { useEffect, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, Loader2, Mail, Pencil, Trash2, Users, X,
} from 'lucide-react';
import Avatar from './Avatar.jsx';
import RecipientPicker from './RecipientPicker.jsx';
import { roleLabel } from '../constants.js';

const MANAGER_ROLES = new Set(['superadmin', 'admin', 'principal', 'deputy_principal', 'deputy']);

export default function GroupDetail({
  group, userId, userRole, onMessage, onUpdate, onDelete, saving, deleting, onBack,
}) {
  const canManage = group.createdBy === userId || MANAGER_ROLES.has(userRole);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [members, setMembers] = useState(group.members ?? []);
  const [confirmDel, setConfirmDel] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(group.name);
    setMembers(group.members ?? []);
    setEditing(false);
    setConfirmDel(false);
    setError('');
  }, [group.id]);

  async function save() {
    if (!name.trim()) { setError('Group name is required.'); return; }
    if (!members.length) { setError('A group needs at least one member.'); return; }
    setError('');
    try {
      await onUpdate?.(group.id, { name: name.trim(), memberIds: members.map(m => m.id) });
      setEditing(false);
    } catch (err) {
      setError(err?.message || 'Could not update the group.');
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3.5 backdrop-blur sm:px-6">
        <button onClick={onBack} className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 lg:hidden">
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">Saved group</p>
          <h2 className="truncate text-base font-bold text-slate-900">{group.name}</h2>
        </div>
        {canManage && !editing && (
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-violet-200 hover:text-violet-700"
          >
            <Pencil size={12} /> Edit
          </button>
        )}
        {canManage && (
          <button
            onClick={() => setConfirmDel(true)}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
            title="Delete group"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="h-24 bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600">
              <div className="h-full w-full bg-[radial-gradient(circle_at_20%_120%,rgba(255,255,255,0.35),transparent_45%),radial-gradient(circle_at_90%_-20%,rgba(255,255,255,0.3),transparent_40%)]" />
            </div>
            <div className="relative px-5 pb-5">
              <div className="-mt-8 mb-3 flex items-end gap-3">
                <Avatar group name={group.name} size="2xl" className="ring-4 ring-white" />
                <div className="pb-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                    <Users size={10} /> {group.memberCount ?? members.length} members
                  </span>
                </div>
              </div>
              <h3 className="text-lg font-bold text-slate-900">{group.name}</h3>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Created by {group.createdByName || 'a staff member'}
                {group.createdAt ? ` · ${new Date(group.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
              </p>
              <button
                onClick={() => onMessage?.(group)}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-violet-200 transition hover:bg-violet-700"
              >
                <Mail size={14} /> Message this group
              </button>
            </div>
          </div>

          {editing && (
            <div className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">Edit group</h3>
                <button onClick={() => { setEditing(false); setError(''); }} className="text-slate-400 hover:text-slate-600">
                  <X size={15} />
                </button>
              </div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">Group name</label>
              <input
                value={name}
                onChange={e => setName(e.target.value.slice(0, 80))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
              />
              <div className="mb-3 mt-3 flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">Members</label>
                <span className="text-[10px] text-slate-400">{members.length} selected</span>
              </div>
              <RecipientPicker
                selected={members}
                onChange={setMembers}
                allowScope
                enabled
                placeholder="Add or find members…"
                emptyHint="Search for the people who should receive group messages."
              />
              {error && <p className="mt-2 text-[11px] text-rose-600">{error}</p>}
              <div className="mt-3 flex justify-end gap-2">
                <button onClick={() => { setEditing(false); setError(''); }} className="rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-slate-100">
                  Cancel
                </button>
                <button
                  onClick={save}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Members</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                {members.length}
              </span>
            </div>
            {members.length === 0 ? (
              <p className="px-4 py-8 text-center text-xs text-slate-400">No members in this group.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {members.map(m => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                    <Avatar name={m.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-700">{m.name}</p>
                      <p className="truncate text-[10px] capitalize text-slate-400">{m.roleLabel || roleLabel(m.role) || 'School account'}</p>
                    </div>
                    {m.isActive === false && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700">Inactive</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                <AlertTriangle size={18} />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">Delete this group?</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  “{group.name}” will be removed. Messages already sent to it stay in recipients’ inboxes.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDel(false)} className="rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-slate-100">
                Cancel
              </button>
              <button
                onClick={() => { setConfirmDel(false); onDelete?.(group.id); }}
                disabled={deleting}
                className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete group'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
