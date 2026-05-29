/* ============================================================
   HousesTab — house leaderboard + admin house management
   ============================================================ */
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Home, Trophy, Palette, Plus, X, Loader2, AlertTriangle } from 'lucide-react';
import { behaviour as behaviourApi, students as studentsApi, settings as settingsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

const DEFAULT_HOUSE_COLORS = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316'];
const MEDALS = ['🥇', '🥈', '🥉'];

export default function HousesTab() {
  const qc      = useQueryClient();
  const role    = useAuthStore(s => s.session?.user?.role ?? '');
  const isAdmin = role === 'admin' || role === 'superadmin';

  /* School settings (houses stored here) */
  const { data: settingsData, isLoading: settingsLoading } = useQuery({
    queryKey: ['settings', 'school'],
    queryFn:  () => settingsApi.school.get(),
    staleTime: 5 * 60_000,
  });
  const schoolSettings = settingsData?.data ?? settingsData ?? {};
  const houses         = Array.isArray(schoolSettings.houses) ? schoolSettings.houses : [];

  /* Students for member counts */
  const { data: stuData } = useQuery({
    queryKey: ['students', 'list', { limit: 1000 }],
    queryFn:  () => studentsApi.list({ limit: 1000, status: 'active' }),
    staleTime: 5 * 60_000,
  });
  const allStudents = stuData?.data ?? [];

  /* Incidents for house leaderboard */
  const { data: incData, isLoading: incLoading } = useQuery({
    queryKey: ['behaviour', 'incidents', 'all'],
    queryFn:  () => behaviourApi.incidents.list({ limit: 1000 }),
    staleTime: 2 * 60_000,
  });
  const allLogs = incData?.data ?? [];

  /* House standings */
  const standings = useMemo(() => (
    houses.map(h => {
      const members   = allStudents.filter(s => (s.house ?? s.houseId) === (h.id ?? h.name));
      const memberIds = new Set(members.map(s => s.id ?? s._id));
      const hLogs     = allLogs.filter(l => memberIds.has(l.studentId));
      const merits    = hLogs.filter(l => l.type === 'merit').reduce((sum, l) => sum + (l.points ?? 0), 0);
      const demerits  = Math.abs(hLogs.filter(l => l.type === 'demerit').reduce((sum, l) => sum + (l.points ?? 0), 0));
      const net       = merits - demerits;
      return { ...h, members: members.length, merits, demerits, net, events: hLogs.length };
    }).sort((a, b) => b.net - a.net)
  ), [houses, allStudents, allLogs]);

  /* Add / remove house */
  const [newName, setNewName]   = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_HOUSE_COLORS[0]);
  const [addErr, setAddErr]     = useState('');

  const saveMut = useMutation({
    mutationFn: updatedHouses => settingsApi.school.update({ ...schoolSettings, houses: updatedHouses }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['settings', 'school'] }),
    onError:    err => setAddErr(err?.message ?? 'Failed to save'),
  });

  function addHouse() {
    const name = newName.trim();
    if (!name) { setAddErr('House name is required'); return; }
    if (houses.find(h => h.name.toLowerCase() === name.toLowerCase())) { setAddErr('A house with that name already exists'); return; }
    const updated = [...houses, { id: 'h_' + Date.now(), name, color: newColor }];
    saveMut.mutate(updated);
    setNewName('');
    setNewColor(DEFAULT_HOUSE_COLORS[updated.length % DEFAULT_HOUSE_COLORS.length]);
    setAddErr('');
  }

  function removeHouse(id) {
    if (!confirm('Remove this house? Students assigned to it will have no house until reassigned.')) return;
    saveMut.mutate(houses.filter(h => (h.id ?? h.name) !== id));
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-5">

      {/* Leaderboard */}
      {incLoading || settingsLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-24 animate-pulse" />)}</div>
      ) : houses.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <Home size={36} className="mb-3 opacity-40" />
          <p className="text-sm font-medium text-slate-600">No houses configured</p>
          <p className="text-xs mt-1 text-center max-w-xs">
            {isAdmin
              ? 'Add houses below. Students can be assigned to a house in their profile.'
              : 'Houses will appear here once configured by an admin.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Trophy size={15} className="text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-800">House Standings</h3>
            <span className="ml-auto text-xs text-slate-400">Based on all-time behaviour points</span>
          </div>
          {standings.map((h, i) => {
            const maxNet = Math.max(...standings.map(x => Math.abs(x.net)), 1);
            const pct    = Math.round((Math.abs(h.net) / maxNet) * 100);
            const netPos = h.net >= 0;
            return (
              <div key={h.id ?? h.name} className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xl w-8 text-center">{MEDALS[i] ?? `#${i + 1}`}</span>
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg shrink-0" style={{ background: h.color }}>
                      {h.name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="font-semibold text-slate-800">{h.name}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-emerald-600 font-medium">+{h.merits}M</span>
                        <span className="text-xs text-red-600 font-medium">-{h.demerits}D</span>
                        <span className={`font-bold text-base ${netPos ? 'text-emerald-600' : 'text-red-600'}`}>
                          {netPos ? '+' : ''}{h.net}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: netPos ? h.color : '#ef4444' }} />
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{h.members} student{h.members !== 1 ? 's' : ''} · {h.events} events</p>
                  </div>
                  {isAdmin && (
                    <button onClick={() => removeHouse(h.id ?? h.name)} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition shrink-0">
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* House management (admin only) */}
      {isAdmin && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Palette size={14} className="text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-800">Manage Houses</h3>
          </div>
          <p className="text-xs text-slate-500">
            Houses are school-specific. Students are assigned to a house in their profile.
            Points aggregate automatically from all behaviour logs.
          </p>

          {addErr && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-xs px-3 py-2 rounded-lg border border-red-200">
              <AlertTriangle size={13} />{addErr}
            </div>
          )}

          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-slate-700 mb-1.5">House Name</label>
              <input
                value={newName}
                onChange={e => { setNewName(e.target.value); setAddErr(''); }}
                onKeyDown={e => e.key === 'Enter' && addHouse()}
                placeholder="e.g. Eagle, Phoenix, Storm…"
                className="w-full text-sm px-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 text-slate-800 placeholder-slate-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Colour</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={newColor}
                  onChange={e => setNewColor(e.target.value)}
                  className="w-10 h-9 rounded-lg border border-slate-200 cursor-pointer p-0.5 bg-white"
                />
                <div className="flex gap-1.5">
                  {DEFAULT_HOUSE_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setNewColor(c)}
                      className={`w-5 h-5 rounded-full border-2 transition ${newColor === c ? 'border-slate-800 scale-110' : 'border-transparent'}`}
                      style={{ background: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <button
              onClick={addHouse}
              disabled={saveMut.isPending || !newName.trim()}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              {saveMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Add House
            </button>
          </div>

          {houses.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
              {houses.map(h => (
                <div key={h.id ?? h.name} className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50">
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: h.color }} />
                  <span className="text-sm font-medium text-slate-700">{h.name}</span>
                  <button onClick={() => removeHouse(h.id ?? h.name)} className="text-slate-300 hover:text-red-500 transition"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info callout */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-start gap-3">
        <Home size={15} className="text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700">
          Students are assigned to a house in their individual profile. House points are computed automatically from all behaviour logs associated with students in that house.
        </p>
      </div>
    </motion.div>
  );
}
