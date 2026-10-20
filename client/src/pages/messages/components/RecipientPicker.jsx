import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Search, Sparkles, UserPlus, X } from 'lucide-react';
import clsx from 'clsx';
import { messages as msgsApi } from '@/api/client.js';
import { SCOPE_OPTIONS, roleLabel } from '../constants.js';
import Avatar from './Avatar.jsx';

export default function RecipientPicker({
  selected,
  onChange,
  scope = 'all',
  onScopeChange,
  allowScope = true,
  placeholder = 'Search by name…',
  emptyHint = 'Start typing a name to find people.',
  enabled = true,
}) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['message-recipients', scope, debounced],
    queryFn: () => msgsApi.recipients({ q: debounced, scope, limit: 30 }),
    enabled,
    staleTime: 60_000,
  });

  const selectedIds = useMemo(() => new Set(selected.map(s => s.id)), [selected]);
  const results = (data?.data ?? []).filter(u => !selectedIds.has(u.id));

  function add(user) {
    onChange([...selected, user]);
    setQ('');
  }

  function remove(id) {
    onChange(selected.filter(s => s.id !== id));
  }

  return (
    <div className="space-y-3">
      {/* selected chips */}
      {selected.length > 0 && (
        <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-violet-100 bg-violet-50/60 p-2">
          {selected.map(u => (
            <span
              key={u.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-violet-200 bg-white py-1 pl-1 pr-2 text-xs font-medium text-slate-700 shadow-sm"
            >
              <Avatar name={u.name} size="xs" className="!h-5 !w-5 !text-[8px] !ring-0" />
              <span className="truncate">{u.name}</span>
              <button
                type="button"
                onClick={() => remove(u.id)}
                className="rounded-full p-0.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                aria-label={`Remove ${u.name}`}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* scope filters */}
      {allowScope && (
        <div className="flex flex-wrap gap-1.5">
          {SCOPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onScopeChange?.(opt.value)}
              className={clsx(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition',
                scope === opt.value
                  ? 'border-violet-300 bg-violet-100 text-violet-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700',
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* search */}
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-9 text-sm text-slate-800 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
        />
        {isFetching && (
          <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-violet-500" />
        )}
      </div>

      {/* results */}
      <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white">
        {isError ? (
          <p className="px-3 py-4 text-xs text-rose-600">{error?.message || 'Could not load people.'}</p>
        ) : results.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-5 text-xs text-slate-400">
            {debounced ? <Search size={14} /> : <Sparkles size={14} />}
            {isFetching
              ? 'Searching…'
              : debounced
                ? 'No matching people — check the spelling or try another group.'
                : emptyHint}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {results.map(u => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => add(u)}
                  className="group flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-violet-50/60"
                >
                  <Avatar name={u.name} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-800">{u.name}</span>
                    <span className="block truncate text-[11px] capitalize text-slate-400">
                      {roleLabel(u.role) || 'School account'}
                    </span>
                  </span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition group-hover:bg-violet-600 group-hover:text-white">
                    <UserPlus size={13} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="flex items-center gap-1 text-[11px] text-slate-400">
        <Check size={11} className="text-emerald-500" />
        {selected.length
          ? `${selected.length} ${selected.length === 1 ? 'person' : 'people'} selected`
          : 'Pick one person or several — this is a direct message, not a broadcast.'}
      </p>
    </div>
  );
}
