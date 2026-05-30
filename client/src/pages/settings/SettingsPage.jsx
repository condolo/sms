/* ============================================================
   Settings — Premium Enterprise Rebuild
   /platform-audit: lucide icons, invite slide-over, currency +
   timezone fields, houses config, no old components, no alert()
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect } from 'react';
import {
  Building2, Users, User, Plus, X, Save, Loader2,
  CheckCircle2, AlertTriangle, Trash2, Mail, Phone,
  Globe, MapPin, Shield, UserPlus, Home, Palette,
  Eye, EyeOff, Lock, ShieldCheck, Database, Download,
  RefreshCcw, Info, Server, Check, Minus, ChevronDown, ChevronUp,
  CreditCard, Smartphone, Zap, ArrowRight, Layers, Pencil,
  Bell, MessageSquare, BookOpen, Calendar, Clock,
} from 'lucide-react';
import { sections as sectionsApi } from '@/api/client.js';
import { settings as settingsApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

/* ── Tab config ─────────────────────────────────────────────── */
const TABS = [
  { id: 'school',         label: 'School',              Icon: Building2,  adminOnly: false },
  { id: 'subscription',   label: 'Subscription',        Icon: CreditCard, adminOnly: true  },
  { id: 'users',          label: 'Users',               Icon: Users,       adminOnly: true  },
  { id: 'roles',          label: 'Roles & Permissions', Icon: ShieldCheck, adminOnly: true  },
  { id: 'modules',        label: 'Modules',             Icon: Layers,      adminOnly: true  },
  { id: 'notifications',  label: 'Notifications',       Icon: Bell,        adminOnly: true  },
  { id: 'system',         label: 'System',              Icon: Database,    adminOnly: true  },
  { id: 'account',        label: 'Account',             Icon: User,        adminOnly: false },
];

/* ── Role pills ─────────────────────────────────────────────── */
const ROLE_PILL = {
  superadmin: 'bg-red-50 text-red-700 border-red-200',
  admin:      'bg-violet-50 text-violet-700 border-violet-200',
  deputy:     'bg-indigo-50 text-indigo-700 border-indigo-200',
  teacher:    'bg-blue-50 text-blue-700 border-blue-200',
  parent:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  student:    'bg-amber-50 text-amber-700 border-amber-200',
};
function RolePill({ role }) {
  const cls = ROLE_PILL[role] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex px-2 py-0.5 text-[11px] font-medium rounded border capitalize ${cls}`}>
      {role}
    </span>
  );
}

/* ── Shared primitives ───────────────────────────────────────── */
function iCls(err = false) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${err ? 'border-red-300 focus:ring-red-500/20' : 'border-slate-200 focus:border-slate-400 focus:ring-slate-900/10'} bg-white focus:outline-none focus:ring-2 text-slate-800 placeholder-slate-400 transition`;
}

function Toast({ msg, type = 'success', onDismiss }) {
  const isErr = type === 'error';
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border shadow-sm ${
        isErr ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }`}
    >
      {isErr ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
      {msg}
      <button onClick={onDismiss} className="ml-1 opacity-60 hover:opacity-100"><X size={11} /></button>
    </motion.div>
  );
}

function FField({ label, error, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500">{error}</p>}
    </div>
  );
}

/* ── Currency + Timezone options ────────────────────────────── */
const CURRENCIES = [
  { value: 'KES', label: 'KES — Kenyan Shilling' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'NGN', label: 'NGN — Nigerian Naira' },
  { value: 'GHS', label: 'GHS — Ghanaian Cedi' },
  { value: 'UGX', label: 'UGX — Ugandan Shilling' },
  { value: 'TZS', label: 'TZS — Tanzanian Shilling' },
  { value: 'ZAR', label: 'ZAR — South African Rand' },
  { value: 'RWF', label: 'RWF — Rwandan Franc' },
];
const TIMEZONES = [
  { value: 'Africa/Nairobi',      label: 'Africa/Nairobi (EAT +3)' },
  { value: 'Africa/Lagos',        label: 'Africa/Lagos (WAT +1)' },
  { value: 'Africa/Accra',        label: 'Africa/Accra (GMT +0)' },
  { value: 'Africa/Johannesburg', label: 'Africa/Johannesburg (SAST +2)' },
  { value: 'Africa/Kampala',      label: 'Africa/Kampala (EAT +3)' },
  { value: 'Africa/Dar_es_Salaam', label: 'Africa/Dar es Salaam (EAT +3)' },
  { value: 'Africa/Kigali',       label: 'Africa/Kigali (CAT +2)' },
  { value: 'Europe/London',       label: 'Europe/London (GMT/BST)' },
  { value: 'America/New_York',    label: 'America/New_York (EST/EDT)' },
  { value: 'Asia/Dubai',          label: 'Asia/Dubai (GST +4)' },
];

/* ── House colors ────────────────────────────────────────────── */
const HOUSE_PALETTE    = ['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#f97316'];
const SECTION_PALETTE  = ['#10b981','#3b82f6','#8b5cf6','#f59e0b','#ef4444','#ec4899','#14b8a6','#f97316'];

/* ══════════════════════════════════════════════════════════════
   SECTIONS PANEL — standalone component (own React Query state)
   Placed inside SchoolTab between Houses and M-Pesa sections.
   ══════════════════════════════════════════════════════════════ */
function SectionsPanel() {
  const qc = useQueryClient();
  const [toast,    setToast]    = useState(null);
  const [editId,   setEditId]   = useState(null);   // which row is being edited
  const [editForm, setEditForm] = useState({});      // { name, color }
  const [addForm,  setAddForm]  = useState({ key: '', name: '', color: SECTION_PALETTE[0] });
  const [adding,   setAdding]   = useState(false);

  const showT = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['sections'],
    queryFn:  () => sectionsApi.list(),
    staleTime: 10 * 60_000,
  });
  const rows = data?.data ?? [];

  /* Create */
  const { mutate: createSec, isPending: creating } = useMutation({
    mutationFn: (d) => sectionsApi.create(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sections'] });
      setAddForm({ key: '', name: '', color: SECTION_PALETTE[0] });
      setAdding(false);
      showT('Section added.');
    },
    onError: err => showT(err?.message ?? 'Failed to add section.', 'error'),
  });

  /* Update */
  const { mutate: updateSec, isPending: updating } = useMutation({
    mutationFn: ({ id, data }) => sectionsApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sections'] });
      setEditId(null);
      showT('Section updated.');
    },
    onError: err => showT(err?.message ?? 'Failed to update section.', 'error'),
  });

  /* Delete */
  const { mutate: deleteSec } = useMutation({
    mutationFn: (id) => sectionsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sections'] });
      showT('Section deleted.');
    },
    onError: err => showT(err?.message ?? 'Cannot delete — classes may be using this section.', 'error'),
  });

  /* Auto-derive key from name when adding */
  function handleAddName(name) {
    const key = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/__+/g, '_').replace(/^_|_$/g, '').slice(0, 30);
    setAddForm(p => ({ ...p, name, key }));
  }

  if (isLoading) return (
    <div className="space-y-2">
      {[1,2,3].map(i => <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />)}
    </div>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
        <Layers size={14} className="text-indigo-500" />
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Curriculum Sections</h3>
        <button
          type="button"
          onClick={() => setAdding(p => !p)}
          className="ml-auto flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg transition"
        >
          <Plus size={11} /> Add Section
        </button>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed -mt-2">
        Sections (e.g. Primary, Secondary) are used across Classes, Timetable, Bell Schedule and Reports.
        The <strong>key</strong> is permanent — rename the <strong>label</strong> freely.
      </p>

      {/* Toast */}
      <AnimatePresence>
        {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
      </AnimatePresence>

      {/* Section rows */}
      <div className="space-y-1.5">
        {rows.map(sec => (
          <div key={sec.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 border border-slate-100">
            {/* Colour dot */}
            <div className="w-4 h-4 rounded-full shrink-0 ring-2 ring-offset-1" style={{ backgroundColor: sec.color, ringColor: sec.color }} />

            {editId === sec.id ? (
              /* Inline edit row */
              <>
                <input
                  value={editForm.name ?? ''}
                  onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                  className="flex-1 text-sm px-2 py-1 rounded border border-slate-200 focus:outline-none focus:border-indigo-400 bg-white"
                  placeholder="Section name"
                  autoFocus
                />
                <div className="flex gap-1 items-center">
                  {SECTION_PALETTE.map(c => (
                    <button key={c} type="button" onClick={() => setEditForm(p => ({ ...p, color: c }))}
                      className={`w-4 h-4 rounded-full transition ${editForm.color === c ? 'ring-2 ring-offset-1 ring-slate-700' : ''}`}
                      style={{ backgroundColor: c }} />
                  ))}
                  <input type="color" value={editForm.color ?? '#6366f1'}
                    onChange={e => setEditForm(p => ({ ...p, color: e.target.value }))}
                    className="w-5 h-5 rounded cursor-pointer border-0 p-0" title="Custom colour" />
                </div>
                <button type="button" onClick={() => updateSec({ id: sec.id, data: editForm })} disabled={updating}
                  className="text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded-lg transition disabled:opacity-50">
                  {updating ? <Loader2 size={11} className="animate-spin" /> : 'Save'}
                </button>
                <button type="button" onClick={() => setEditId(null)}
                  className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg transition">
                  Cancel
                </button>
              </>
            ) : (
              /* Display row */
              <>
                <span className="flex-1 text-sm font-medium text-slate-800">{sec.name}</span>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{sec.key}</span>
                <button type="button"
                  onClick={() => { setEditId(sec.id); setEditForm({ name: sec.name, color: sec.color }); }}
                  className="text-slate-400 hover:text-slate-700 p-1 rounded transition" title="Rename">
                  <Pencil size={13} />
                </button>
                <button type="button" onClick={() => { if (window.confirm(`Delete section "${sec.name}"?`)) deleteSec(sec.id); }}
                  className="text-slate-400 hover:text-red-500 p-1 rounded transition" title="Delete">
                  <Trash2 size={13} />
                </button>
              </>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-slate-400 italic py-2">No sections configured yet.</p>
        )}
      </div>

      {/* Add new section form */}
      <AnimatePresence>
        {adding && (
          <motion.div initial={{ opacity:0, height:0 }} animate={{ opacity:1, height:'auto' }} exit={{ opacity:0, height:0 }}
            className="overflow-hidden border-t border-slate-100 pt-4 space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">New Section</p>
            <div className="grid grid-cols-2 gap-3">
              <FField label="Display Name">
                <input value={addForm.name} onChange={e => handleAddName(e.target.value)}
                  placeholder="e.g. Junior Secondary"
                  className={iCls()} />
              </FField>
              <FField label="Key (auto-generated, permanent)">
                <input value={addForm.key}
                  onChange={e => setAddForm(p => ({ ...p, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,30) }))}
                  placeholder="e.g. junior_secondary"
                  className={iCls()} />
              </FField>
            </div>
            <FField label="Colour">
              <div className="flex gap-1.5 items-center">
                {SECTION_PALETTE.map(c => (
                  <button key={c} type="button" onClick={() => setAddForm(p => ({ ...p, color: c }))}
                    className={`w-5 h-5 rounded-full transition ${addForm.color === c ? 'ring-2 ring-offset-1 ring-slate-900' : ''}`}
                    style={{ backgroundColor: c }} />
                ))}
                <input type="color" value={addForm.color} onChange={e => setAddForm(p => ({ ...p, color: e.target.value }))}
                  className="w-6 h-6 rounded cursor-pointer border-0 p-0" title="Custom colour" />
                <span className="ml-1 text-xs text-slate-500">Preview:</span>
                <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: addForm.color + '20', color: addForm.color }}>
                  {addForm.name || 'Section Name'}
                </span>
              </div>
            </FField>
            <div className="flex items-center gap-2">
              <button type="button"
                onClick={() => createSec({ key: addForm.key, name: addForm.name, color: addForm.color })}
                disabled={creating || !addForm.key || !addForm.name}
                className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-xs font-medium px-4 py-2 rounded-lg transition">
                {creating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                {creating ? 'Adding…' : 'Add Section'}
              </button>
              <button type="button" onClick={() => setAdding(false)}
                className="text-xs text-slate-500 hover:text-slate-700 px-3 py-2 rounded-lg transition">
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SCHOOL SETTINGS TAB
   ══════════════════════════════════════════════════════════════ */
function SchoolTab() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['settings', 'school'],
    queryFn:  () => settingsApi.school.get(),
    staleTime: 5 * 60_000,
  });
  const school = data?.data ?? {};

  const [form, setForm] = useState(null);
  const f = form ?? school;
  function set(k, v) { setForm(p => ({ ...(p ?? school), [k]: v })); }

  /* ── House management state ── */
  const houses    = Array.isArray(f.houses) ? f.houses : [];
  const [newName, setNewName]   = useState('');
  const [newColor, setNewColor] = useState(HOUSE_PALETTE[0]);

  function addHouse() {
    if (!newName.trim()) return;
    const h = { id: `house_${Date.now()}`, name: newName.trim(), color: newColor };
    set('houses', [...houses, h]);
    setNewName(''); setNewColor(HOUSE_PALETTE[houses.length % HOUSE_PALETTE.length]);
  }
  function removeHouse(id) {
    set('houses', houses.filter(h => (h.id ?? h.name) !== id));
  }

  const { mutate, isPending } = useMutation({
    mutationFn: d => settingsApi.school.update(d),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'school'] });
      setForm(null);
      setToast({ msg: 'School settings saved.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save.', type: 'error' }),
  });

  if (isLoading) return (
    <div className="space-y-3 max-w-2xl">
      {[...Array(4)].map((_, i) => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}
    </div>
  );
  if (isError) return (
    <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2 max-w-2xl">
      <AlertTriangle size={20} className="text-red-400" />
      <p className="text-sm text-slate-600">{error?.message}</p>
      <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
    </div>
  );

  return (
    <form onSubmit={e => { e.preventDefault(); mutate(f); }} className="max-w-2xl space-y-4">
      {/* Toast */}
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* School information */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Building2 size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">School Information</h3>
        </div>
        <FField label="School name">
          <input value={f.name ?? ''} onChange={e => set('name', e.target.value)} className={iCls()} placeholder="e.g. Msingi Academy" />
        </FField>
        <FField label="Tagline / Description">
          <input value={f.tagline ?? ''} onChange={e => set('tagline', e.target.value)} className={iCls()} placeholder="Optional short description" />
        </FField>
        <div className="grid grid-cols-2 gap-3">
          <FField label="Email">
            <input type="email" value={f.email ?? ''} onChange={e => set('email', e.target.value)} className={iCls()} />
          </FField>
          <FField label="Phone">
            <input value={f.phone ?? ''} onChange={e => set('phone', e.target.value)} className={iCls()} />
          </FField>
        </div>
        <FField label="Address">
          <input value={f.address ?? ''} onChange={e => set('address', e.target.value)} className={iCls()} />
        </FField>
        <FField label="Website">
          <input type="url" value={f.website ?? ''} onChange={e => set('website', e.target.value)} className={iCls()} placeholder="https://" />
        </FField>
        <FField label="Country">
          <input value={f.country ?? ''} onChange={e => set('country', e.target.value)} className={iCls()} placeholder="e.g. Kenya" />
        </FField>
      </div>

      {/* Regional */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Globe size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Regional</h3>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FField label="Currency">
            <select value={f.currency ?? 'KES'} onChange={e => set('currency', e.target.value)} className={iCls()}>
              {CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </FField>
          <FField label="Timezone">
            <select value={f.timezone ?? 'Africa/Nairobi'} onChange={e => set('timezone', e.target.value)} className={iCls()}>
              {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </select>
          </FField>
        </div>
        {/* ── Academic year configuration ──────────────────── */}
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-3">
            <FField label="Academic year label">
              <input
                value={f.academicYear ?? ''}
                onChange={e => set('academicYear', e.target.value)}
                className={iCls()}
                placeholder="e.g. 2025/2026"
              />
            </FField>
            <FField label="Year starts in">
              <select
                value={f.academicYearStartMonth ?? 1}
                onChange={e => set('academicYearStartMonth', Number(e.target.value))}
                className={iCls()}
              >
                {['January','February','March','April','May','June',
                  'July','August','September','October','November','December'
                ].map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
            </FField>
            <FField label="Terms per year">
              <select value={f.termsPerYear ?? 3} onChange={e => set('termsPerYear', Number(e.target.value))} className={iCls()}>
                <option value={2}>2 terms</option>
                <option value={3}>3 terms</option>
                <option value={4}>4 terms (quarters)</option>
              </select>
            </FField>
          </div>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            The label (e.g. <strong>2025/2026</strong>) appears on fee structures, report cards and admission references.
            Set the start month so the system knows when your year rolls over — a September start means the year
            changes in September, not January.
          </p>
        </div>
      </div>

      {/* ── Login Appearance ──────────────────────────────────── */}
      <style>{`
        @keyframes msingiGradientShift {
          0%   { background-position: 0% 50%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Palette size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Login Page Appearance</h3>
        </div>
        <p className="text-xs text-slate-400">
          Choose a colour theme for your school's login page gradient. Staff and students see this every time they sign in.
        </p>

        {/* Preset swatches */}
        <div>
          <label className="text-xs font-medium text-slate-600 mb-2 block">Theme presets</label>
          <div className="grid grid-cols-4 gap-2">
            {[
              { id: 'violet',   name: 'Violet',    p: '#4f46e5', a: '#7c3aed' },
              { id: 'ocean',    name: 'Ocean',     p: '#0369a1', a: '#0891b2' },
              { id: 'forest',   name: 'Forest',    p: '#059669', a: '#0d9488' },
              { id: 'sunset',   name: 'Sunset',    p: '#ea580c', a: '#ef4444' },
              { id: 'midnight', name: 'Midnight',  p: '#1e3a5f', a: '#1e1b4b' },
              { id: 'rose',     name: 'Rose',      p: '#e11d48', a: '#9f1239' },
              { id: 'gold',     name: 'Gold',      p: '#b45309', a: '#92400e' },
              { id: 'slate',    name: 'Slate',     p: '#475569', a: '#334155' },
            ].map(({ id, name, p, a }) => {
              const isActive = (f.themePreset === id) || (!f.themePreset && id === 'violet');
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => { set('themePreset', id); set('primaryColor', p); set('accentColor', a); }}
                  className={`relative rounded-xl overflow-hidden h-14 transition-all ${
                    isActive ? 'ring-2 ring-offset-2 ring-slate-900 scale-105' : 'hover:scale-105 hover:shadow-md'
                  }`}
                  title={name}
                  style={{
                    background: `linear-gradient(-45deg, ${p}, ${a}, ${p}cc, ${a}99)`,
                    backgroundSize: '200% 200%',
                    animation: 'msingiGradientShift 4s ease infinite',
                  }}
                >
                  {isActive && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-5 h-5 rounded-full bg-white/80 flex items-center justify-center">
                        <Check size={10} className="text-slate-800" />
                      </div>
                    </div>
                  )}
                  <span className="absolute bottom-1.5 left-0 right-0 text-center text-[9px] font-semibold text-white/80 tracking-wide">
                    {name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Custom colour pickers */}
        <div className="grid grid-cols-2 gap-4 pt-1">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1.5 block">Primary colour</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={f.primaryColor ?? '#4f46e5'}
                onChange={e => { set('primaryColor', e.target.value); set('themePreset', 'custom'); }}
                className="w-9 h-9 rounded-lg cursor-pointer border border-slate-200 p-0.5"
              />
              <input
                type="text"
                value={f.primaryColor ?? '#4f46e5'}
                onChange={e => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) { set('primaryColor', e.target.value); set('themePreset', 'custom'); } }}
                className="flex-1 text-xs font-mono px-2 py-1.5 rounded-lg border border-slate-200 text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                maxLength={7}
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1.5 block">Accent colour</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={f.accentColor ?? '#7c3aed'}
                onChange={e => { set('accentColor', e.target.value); set('themePreset', 'custom'); }}
                className="w-9 h-9 rounded-lg cursor-pointer border border-slate-200 p-0.5"
              />
              <input
                type="text"
                value={f.accentColor ?? '#7c3aed'}
                onChange={e => { if (/^#[0-9A-Fa-f]{0,6}$/.test(e.target.value)) { set('accentColor', e.target.value); set('themePreset', 'custom'); } }}
                className="flex-1 text-xs font-mono px-2 py-1.5 rounded-lg border border-slate-200 text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                maxLength={7}
              />
            </div>
          </div>
        </div>

        {/* Live mini-preview */}
        <div>
          <label className="text-xs font-medium text-slate-600 mb-1.5 block">Preview</label>
          <div
            className="h-16 rounded-xl relative overflow-hidden"
            style={{
              background: `linear-gradient(-45deg, ${f.primaryColor ?? '#4f46e5'}, ${f.accentColor ?? '#7c3aed'}, ${f.primaryColor ?? '#4f46e5'}cc, ${f.accentColor ?? '#7c3aed'}99)`,
              backgroundSize: '400% 400%',
              animation: 'msingiGradientShift 5s ease infinite',
            }}
          >
            <div className="absolute inset-0 flex items-center gap-3 px-4">
              <div className="w-8 h-8 rounded-xl bg-white/25 flex items-center justify-center text-white text-xs font-bold shrink-0">
                {(school.shortName ?? school.name ?? 'S').charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-white text-xs font-semibold leading-tight">{school.name ?? 'Your School'}</p>
                <p className="text-white/60 text-[10px]">Login page gradient preview</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Houses */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Home size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">House System</h3>
          <span className="ml-auto text-xs text-slate-400">{houses.length} configured</span>
        </div>
        <p className="text-xs text-slate-400">Houses are used in the Behaviour module leaderboard and assigned to students on their profile.</p>

        {/* Existing houses */}
        {houses.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {houses.map(h => (
              <div
                key={h.id ?? h.name}
                className="flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50"
              >
                <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: h.color ?? '#94a3b8' }} />
                <span className="text-sm text-slate-700">{h.name}</span>
                <button
                  type="button"
                  onClick={() => removeHouse(h.id ?? h.name)}
                  className="p-0.5 text-slate-300 hover:text-red-500 transition"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add house row */}
        <div className="flex items-end gap-2 pt-1">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs font-medium text-slate-600">House name</label>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addHouse())}
              placeholder="e.g. Phoenix"
              className={iCls()}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">Colour</label>
            <div className="flex gap-1.5 items-center">
              <div className="flex gap-1">
                {HOUSE_PALETTE.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={`w-5 h-5 rounded-full transition ${newColor === c ? 'ring-2 ring-offset-1 ring-slate-900' : ''}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0 p-0" title="Custom colour" />
            </div>
          </div>
          <button
            type="button"
            onClick={addHouse}
            disabled={!newName.trim()}
            className="flex items-center gap-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white text-xs font-medium px-3 py-2 rounded-lg transition self-end"
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      {/* Curriculum Sections — standalone async panel */}
      <SectionsPanel />

      {/* M-Pesa Integration */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Shield size={14} className="text-emerald-500" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">M-Pesa Integration</h3>
          <span className="ml-auto text-[10px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">Daraja API</span>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Connect your Safaricom Daraja account to enable M-Pesa STK Push payments and automatic C2B reconciliation.
          Credentials are stored encrypted per school — never shared across tenants.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <FField label="Consumer Key">
            <input
              value={f.mpesa?.consumerKey ?? ''}
              onChange={e => set('mpesa', { ...(f.mpesa ?? {}), consumerKey: e.target.value })}
              className={iCls()} placeholder="From Daraja developer portal"
            />
          </FField>
          <FField label="Consumer Secret">
            <input
              type="password"
              value={f.mpesa?.consumerSecret ?? ''}
              onChange={e => set('mpesa', { ...(f.mpesa ?? {}), consumerSecret: e.target.value })}
              className={iCls()} placeholder="••••••••"
            />
          </FField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FField label="Paybill / Till Number">
            <input
              value={f.mpesa?.shortCode ?? ''}
              onChange={e => set('mpesa', { ...(f.mpesa ?? {}), shortCode: e.target.value })}
              className={iCls()} placeholder="e.g. 174379"
            />
          </FField>
          <FField label="STK Push Passkey">
            <input
              type="password"
              value={f.mpesa?.passkey ?? ''}
              onChange={e => set('mpesa', { ...(f.mpesa ?? {}), passkey: e.target.value })}
              className={iCls()} placeholder="Lipa Na M-Pesa passkey"
            />
          </FField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FField label="Environment">
            <select
              value={f.mpesa?.env ?? 'sandbox'}
              onChange={e => set('mpesa', { ...(f.mpesa ?? {}), env: e.target.value })}
              className={iCls()}
            >
              <option value="sandbox">Sandbox (testing)</option>
              <option value="production">Production (live)</option>
            </select>
          </FField>
          <FField label="Public Callback Base URL">
            <input
              value={f.mpesa?.callbackBaseUrl ?? ''}
              onChange={e => set('mpesa', { ...(f.mpesa ?? {}), callbackBaseUrl: e.target.value })}
              className={iCls()} placeholder="https://your-domain.msingi.io"
            />
          </FField>
        </div>

        <div className="flex items-start gap-2 bg-slate-50 rounded-lg p-3 border border-slate-100">
          <Info size={13} className="text-slate-400 mt-0.5 shrink-0" />
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Register your C2B callback URLs with Safaricom from Finance → Settings → M-Pesa after saving.
            Callback URL: <code className="bg-slate-100 px-1 rounded text-slate-600">/api/mpesa/callback</code>
          </p>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="submit"
          disabled={isPending || !form}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
        >
          {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {isPending ? 'Saving…' : 'Save settings'}
        </button>
        {form && (
          <button type="button" onClick={() => setForm(null)} className="text-sm text-slate-500 hover:text-slate-700 transition">
            Discard
          </button>
        )}
      </div>
    </form>
  );
}

/* ══════════════════════════════════════════════════════════════
   USERS TAB
   ══════════════════════════════════════════════════════════════ */
const INVITE_ROLES = ['teacher', 'deputy', 'admin', 'parent', 'student'];

const USER_ROLE_GROUPS = [
  { value: '',                   label: 'All roles' },
  { value: 'admin',              label: 'Admin' },
  { value: 'superadmin',         label: 'Super Admin' },
  { value: 'teacher',            label: 'Teachers' },
  { value: 'section_head',       label: 'Section Heads' },
  { value: 'deputy_principal',   label: 'Deputy Principals' },
  { value: 'hr',                 label: 'HR' },
  { value: 'finance',            label: 'Finance' },
  { value: 'admissions_officer', label: 'Admissions' },
  { value: 'exams_officer',      label: 'Exams Officers' },
  { value: 'timetabler',         label: 'Timetablers' },
  { value: 'parent',             label: 'Parents' },
  { value: 'student',            label: 'Students' },
];

function UsersTab() {
  const qc = useQueryClient();
  const can        = useAuthStore(s => s.can.bind(s));
  const sessionRole = useAuthStore(s => s.session?.user?.role ?? '');
  const canManage  = can('settings') || sessionRole === 'admin' || sessionRole === 'superadmin';
  const [showInvite, setShowInvite] = useState(false);
  const [toast, setToast] = useState(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['settings', 'users'],
    queryFn:  () => settingsApi.users.list(),
    staleTime: 60_000,
  });
  const allUsers = data?.data ?? [];
  const users = allUsers.filter(u => {
    const matchRole   = !roleFilter || u.role === roleFilter;
    const matchSearch = !search || (u.name ?? '').toLowerCase().includes(search.toLowerCase()) || (u.email ?? '').toLowerCase().includes(search.toLowerCase());
    return matchRole && matchSearch;
  });

  const { mutate: removeUser } = useMutation({
    mutationFn: id => settingsApi.users.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'users'] });
      setToast({ msg: 'User removed.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Remove failed.', type: 'error' }),
  });

  function confirmRemove(u) {
    if (!window.confirm(`Remove ${u.name ?? u.email} from this school? They will lose access immediately.`)) return;
    removeUser(u.id ?? u._id);
  }

  return (
    <div className="max-w-2xl space-y-4">
      {/* Toast */}
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* Header + filters */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {isLoading ? 'Loading…' : `${users.length} of ${allUsers.length} user${allUsers.length !== 1 ? 's' : ''}`}
          </p>
          {canManage && (
            <button
              onClick={() => setShowInvite(true)}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-3 py-2 rounded-lg transition"
            >
              <UserPlus size={13} /> Invite user
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Search */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="flex-1 min-w-[180px] rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400"
          />
          {/* Role filter */}
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40 focus:border-violet-400"
          >
            {USER_ROLE_GROUPS.map(g => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
          {(roleFilter || search) && (
            <button
              onClick={() => { setRoleFilter(''); setSearch(''); }}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 transition"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      ) : isError ? (
        <div className="bg-white border border-red-200 rounded-xl p-8 flex flex-col items-center gap-2">
          <AlertTriangle size={20} className="text-red-400" />
          <p className="text-sm text-slate-600">{error?.message}</p>
          <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
        </div>
      ) : users.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-2">
          <Users size={24} className="text-slate-300" />
          <p className="text-sm text-slate-500">No users yet. Invite your team to get started.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50">
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Name</th>
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3 hidden sm:table-cell">Email</th>
                <th className="text-left text-xs font-medium text-slate-500 px-4 py-3">Role</th>
                {canManage && <th className="px-4 py-3 w-8" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map(u => (
                <tr key={u._id ?? u.id} className="hover:bg-slate-50 transition group">
                  <td className="px-4 py-3 font-medium text-slate-800">{u.name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs hidden sm:table-cell">{u.email}</td>
                  <td className="px-4 py-3"><RolePill role={u.role} /></td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => confirmRemove(u)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite slide-over */}
      <AnimatePresence>
        {showInvite && (
          <InviteSlideOver
            onClose={() => setShowInvite(false)}
            onInvited={() => {
              setShowInvite(false);
              qc.invalidateQueries({ queryKey: ['settings', 'users'] });
              setToast({ msg: 'Invitation sent.', type: 'success' });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function InviteSlideOver({ onClose, onInvited }) {
  const [email, setEmail] = useState('');
  const [role,  setRole]  = useState('teacher');
  const [name,  setName]  = useState('');
  const [errors, setErrors] = useState({});

  const { mutate, isPending } = useMutation({
    mutationFn: () => settingsApi.users.invite({ email, role, name }),
    onSuccess:  onInvited,
    onError:    err => setErrors({ _server: err?.message ?? 'Invite failed.' }),
  });

  function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!email.trim()) errs.email = 'Email is required.';
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    mutate();
  }

  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm z-40" onClick={onClose} />
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        className="fixed right-0 top-0 h-full w-full max-w-sm bg-white shadow-2xl z-50 flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Invite User</h2>
            <p className="text-xs text-slate-400 mt-0.5">Send an invite to your team</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {errors._server && (
            <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2.5 rounded-lg border border-red-200">
              <AlertTriangle size={14} />{errors._server}
            </div>
          )}
          <FField label="Full name (optional)" error={errors.name}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Their display name" className={iCls(!!errors.name)} />
          </FField>
          <FField label="Email address *" error={errors.email}>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="teacher@school.com" className={iCls(!!errors.email)} autoFocus />
          </FField>
          <FField label="Role">
            <select value={role} onChange={e => setRole(e.target.value)} className={iCls()}>
              {INVITE_ROLES.map(r => (
                <option key={r} value={r} className="capitalize">{r.charAt(0).toUpperCase() + r.slice(1)}</option>
              ))}
            </select>
          </FField>
        </form>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition">Cancel</button>
          <button
            onClick={submit}
            disabled={isPending}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
            {isPending ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </motion.div>
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   ACCOUNT TAB
   ══════════════════════════════════════════════════════════════ */
function AccountTab() {
  const patchUser   = useAuthStore(s => s.patchUser);
  const user        = useAuthStore(s => s.session?.user);
  const [name, setName] = useState(user?.name ?? '');
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwVisible, setPwVisible] = useState(false);
  const [toast, setToast] = useState(null);
  const [pwError, setPwError] = useState('');

  const { mutate: saveName, isPending: savingName } = useMutation({
    mutationFn: () => settingsApi.update({ name }),
    onSuccess: () => {
      patchUser({ name });
      setToast({ msg: 'Display name updated.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to save name.', type: 'error' }),
  });

  const { mutate: changePassword, isPending: changingPw } = useMutation({
    mutationFn: () => settingsApi.update({ currentPassword: pwForm.current, newPassword: pwForm.next }),
    onSuccess: () => {
      setPwForm({ current: '', next: '', confirm: '' });
      setToast({ msg: 'Password updated successfully.', type: 'success' });
      setPwError('');
    },
    onError: err => setToast({ msg: err?.message ?? 'Password change failed.', type: 'error' }),
  });

  function submitPw(e) {
    e.preventDefault();
    if (pwForm.next !== pwForm.confirm) {
      setPwError('New passwords do not match.');
      return;
    }
    if (pwForm.next.length < 8) {
      setPwError('New password must be at least 8 characters.');
      return;
    }
    setPwError('');
    changePassword();
  }

  return (
    <div className="max-w-md space-y-4">
      {/* Toast */}
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* Who you are */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <User size={18} className="text-slate-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">{user?.name ?? user?.email ?? '—'}</p>
            <p className="text-xs text-slate-400">{user?.email}</p>
          </div>
          <RolePill role={user?.role} />
        </div>
      </div>

      {/* Display name */}
      <form
        onSubmit={e => { e.preventDefault(); saveName(); }}
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <User size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Display Name</h3>
        </div>
        <FField label="Your name">
          <input value={name} onChange={e => setName(e.target.value)} className={iCls()} required />
        </FField>
        <button
          type="submit"
          disabled={savingName || !name.trim() || name === (user?.name ?? '')}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          {savingName ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {savingName ? 'Saving…' : 'Update name'}
        </button>
      </form>

      {/* Change password */}
      <form
        onSubmit={submitPw}
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Lock size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Change Password</h3>
          <button
            type="button"
            onClick={() => setPwVisible(v => !v)}
            className="ml-auto text-slate-400 hover:text-slate-600 transition"
          >
            {pwVisible ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>

        {pwError && (
          <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-200">
            <AlertTriangle size={13} />{pwError}
          </div>
        )}

        {[
          { label: 'Current password', key: 'current', minLength: 1 },
          { label: 'New password',     key: 'next',    minLength: 8 },
          { label: 'Confirm new password', key: 'confirm', minLength: 8 },
        ].map(({ label, key, minLength }) => (
          <FField key={key} label={label}>
            <input
              type={pwVisible ? 'text' : 'password'}
              value={pwForm[key]}
              onChange={e => { setPwForm(f => ({ ...f, [key]: e.target.value })); setPwError(''); }}
              required
              minLength={minLength}
              className={iCls(pwError && key !== 'current')}
            />
          </FField>
        ))}

        <button
          type="submit"
          disabled={changingPw || !pwForm.current || !pwForm.next || !pwForm.confirm}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          {changingPw ? <Loader2 size={13} className="animate-spin" /> : <Shield size={13} />}
          {changingPw ? 'Updating…' : 'Change password'}
        </button>
      </form>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ROLES & PERMISSIONS TAB — editable sub-module RBAC matrix
   ══════════════════════════════════════════════════════════════ */

const PERM_MODULES = [
  { key: 'students',   label: 'Students', subs: [
    { key: 'list',    label: 'View Student List' },
    { key: 'profile', label: 'View Student Profile' },
    { key: 'create',  label: 'Add Student' },
    { key: 'edit',    label: 'Edit Student' },
    { key: 'delete',  label: 'Delete Student' },
    { key: 'export',  label: 'Export Students (CSV)' },
    { key: 'import',  label: 'Import Students (CSV)' },
  ]},
  { key: 'teachers',   label: 'Teachers', subs: [
    { key: 'list',   label: 'View Teacher List' },
    { key: 'detail', label: 'View Teacher Profile' },
    { key: 'create', label: 'Add Teacher' },
    { key: 'edit',   label: 'Edit Teacher' },
    { key: 'delete', label: 'Delete Teacher' },
    { key: 'export', label: 'Export Teachers (CSV)' },
    { key: 'import', label: 'Import Teachers (CSV)' },
  ]},
  { key: 'classes',    label: 'Classes', subs: [
    { key: 'view',    label: 'View Classes' },
    { key: 'create',  label: 'Create Class' },
    { key: 'edit',    label: 'Edit Class' },
    { key: 'delete',  label: 'Delete Class' },
    { key: 'export',  label: 'Export Classes (CSV)' },
    { key: 'import',  label: 'Import Classes (CSV)' },
    { key: 'section', label: 'Manage Sections & Streams' },
  ]},
  { key: 'attendance', label: 'Attendance', subs: [
    { key: 'view',   label: 'View Register' },
    { key: 'mark',   label: 'Mark Attendance' },
    { key: 'edit',   label: 'Edit Records' },
    { key: 'export', label: 'Export / Print Register' },
  ]},
  { key: 'finance',    label: 'Finance', subs: [
    { key: 'invoices',       label: 'View Invoices' },
    { key: 'create_invoice', label: 'Create Invoice' },
    { key: 'void_invoice',   label: 'Void Invoice' },
    { key: 'payments',       label: 'View Payments' },
    { key: 'record_payment', label: 'Record Payment' },
    { key: 'print',          label: 'Print Receipts / Invoices' },
    { key: 'fee_structure',  label: 'Manage Fee Structures' },
    { key: 'import',         label: 'Import Finance Data (CSV)' },
    { key: 'mpesa',          label: 'Configure M-Pesa Integration' },
  ]},
  { key: 'behaviour',  label: 'Behaviour (BPS)', subs: [
    { key: 'view',   label: 'View Incidents & BPS' },
    { key: 'create', label: 'Record Incident / Award Points' },
    { key: 'edit',   label: 'Edit Records' },
    { key: 'delete', label: 'Delete Records' },
  ]},
  { key: 'grades',     label: 'Grades & Exams', subs: [
    { key: 'view_grades',  label: 'View Grades' },
    { key: 'enter_marks',  label: 'Enter / Edit Marks' },
    { key: 'view_exams',   label: 'View Exams' },
    { key: 'create_exam',  label: 'Create / Edit Exam' },
    { key: 'export',       label: 'Export Grades (CSV)' },
  ]},
  { key: 'admissions', label: 'Admissions', subs: [
    { key: 'view',   label: 'View Pipeline' },
    { key: 'create', label: 'Add Applicant' },
    { key: 'edit',   label: 'Edit Applicant Details' },
    { key: 'move',   label: 'Move Pipeline Stage' },
    { key: 'delete', label: 'Delete Applicant' },
    { key: 'export', label: 'Export Applicants (CSV)' },
  ]},
  { key: 'messages',   label: 'Messages', subs: [
    { key: 'view',   label: 'View Messages' },
    { key: 'send',   label: 'Send Messages' },
    { key: 'delete', label: 'Delete Messages' },
  ]},
  { key: 'events',     label: 'Events & Calendar', subs: [
    { key: 'view',   label: 'View Events' },
    { key: 'create', label: 'Create Event' },
    { key: 'edit',   label: 'Edit Event' },
    { key: 'delete', label: 'Delete Event' },
    { key: 'export', label: 'Export Events (CSV)' },
  ]},
  { key: 'hr',         label: 'HR & Payroll', subs: [
    { key: 'staff',          label: 'View Staff Records' },
    { key: 'leave_view',     label: 'View Leave Requests' },
    { key: 'leave_approve',  label: 'Approve / Reject Leave' },
    { key: 'payroll_view',   label: 'View Payroll' },
    { key: 'payroll_export', label: 'Export Payroll (CSV)' },
    { key: 'documents',      label: 'Manage Staff Documents' },
  ]},
  { key: 'reports',    label: 'Reports & Analytics', subs: [
    { key: 'view',   label: 'View Reports' },
    { key: 'export', label: 'Export Reports (CSV)' },
  ]},
  { key: 'timetable',  label: 'Timetable', subs: [
    { key: 'view',          label: 'View Timetable' },
    { key: 'edit',          label: 'Edit Timetable' },
    { key: 'rooms',         label: 'Manage Rooms' },
    { key: 'bell_schedule', label: 'Configure Bell Schedule' },
    { key: 'assignments',   label: 'Manage Teaching Assignments' },
    { key: 'import',        label: 'Import Timetable (CSV)' },
    { key: 'export',        label: 'Export Timetable (CSV)' },
  ]},
  { key: 'subjects',   label: 'Subjects', subs: [
    { key: 'view',   label: 'View Subjects' },
    { key: 'create', label: 'Create Subject / Department' },
    { key: 'edit',   label: 'Edit Subject' },
    { key: 'delete', label: 'Delete Subject' },
  ]},
  { key: 'growth_profile', label: 'Growth Profile', subs: [
    { key: 'view',             label: 'View Growth Profiles' },
    { key: 'add_records',      label: 'Add Records (Leadership / Activities / Service / Awards)' },
    { key: 'edit_records',     label: 'Edit Own Records' },
    { key: 'delete_records',   label: 'Delete Records' },
    { key: 'projects',         label: 'Add / Edit Projects' },
    { key: 'recommendations',  label: 'Write Recommendations' },
    { key: 'aspirations',      label: 'Edit Aspirations' },
    { key: 'verify',           label: 'Verify / Approve Records' },
  ]},
  { key: 'settings',   label: 'Settings', subs: [
    { key: 'school',      label: 'Edit School Settings' },
    { key: 'users',       label: 'Manage Users / Invites' },
    { key: 'permissions', label: 'Manage Roles & Permissions' },
    { key: 'system',      label: 'View System Info' },
  ]},
];

const PERM_ROLES = ['superadmin','admin','deputy','teacher','parent','student'];
const PERM_ROLE_LABELS = {
  superadmin:'Super Admin', admin:'Admin', deputy:'Deputy',
  teacher:'Teacher', parent:'Parent', student:'Student',
};
const PERM_ROLE_COLORS = {
  superadmin: { sel:'bg-red-600 text-white ring-red-600',        idle:'ring-slate-200 bg-white text-red-700'     },
  admin:      { sel:'bg-violet-600 text-white ring-violet-600',  idle:'ring-slate-200 bg-white text-violet-700'  },
  deputy:     { sel:'bg-indigo-600 text-white ring-indigo-600',  idle:'ring-slate-200 bg-white text-indigo-700'  },
  teacher:    { sel:'bg-blue-600 text-white ring-blue-600',      idle:'ring-slate-200 bg-white text-blue-700'    },
  parent:     { sel:'bg-emerald-600 text-white ring-emerald-600',idle:'ring-slate-200 bg-white text-emerald-700' },
  student:    { sel:'bg-amber-500 text-white ring-amber-500',    idle:'ring-slate-200 bg-white text-amber-700'   },
};

function _makeDefaultPerms() {
  const T = { v:true,  e:true,  d:true  };
  const V = { v:true,  e:false, d:false };
  const E = { v:true,  e:true,  d:false };
  const N = { v:false, e:false, d:false };
  const DEFS = {
    superadmin: ()      => T,
    admin:      ()      => T,
    deputy: (m, s) => {
      if (m==='finance'  && ['void_invoice','record_payment','payroll_view','payroll_export','mpesa'].includes(s)) return N;
      if (m==='finance'  && s==='fee_structure') return E;  // deputy can manage fee structures
      if (m==='hr'       && ['payroll_view','payroll_export','documents'].includes(s)) return N;
      if (m==='settings' && s==='permissions') return N;
      return E;
    },
    teacher: (m, s) => {
      if (['finance','admissions','hr','settings'].includes(m)) return N;
      if (m==='attendance') return s==='edit' ? N : s==='export' ? V : E;
      if (m==='grades')     return ['enter_marks','create_exam'].includes(s) ? E : V;
      if (m==='behaviour')  return s==='create' ? E : V;
      if (m==='messages')   return s==='delete' ? N : E;
      if (m==='growth_profile') {
        // Teachers can view, add, edit, write recommendations, and verify (staff level)
        // They cannot delete records or manage aspirations
        if (['delete_records'].includes(s)) return N;
        if (['aspirations'].includes(s)) return N;
        if (['verify'].includes(s)) return E;   // staff_verified tier
        return E;
      }
      // Block bulk-import and admin-only management for teachers
      if (s==='import') return N;
      if (m==='classes'   && ['section','delete'].includes(s)) return N;
      if (m==='timetable' && ['rooms','bell_schedule','assignments'].includes(s)) return V;
      return V;
    },
    parent: (m, s) => {
      if (!['students','finance','attendance','grades','behaviour','events','messages','growth_profile'].includes(m)) return N;
      // Parents can view invoices/payments but not manage financial config
      if (m==='finance' && ['fee_structure','mpesa','import','create_invoice','void_invoice','record_payment'].includes(s)) return N;
      // Parents: view growth profile only — cannot add/edit/verify
      if (m==='growth_profile' && s !== 'view') return N;
      return V;
    },
    student:(m, s) => {
      if (['students','timetable','grades','events'].includes(m)) return V;
      if (m==='growth_profile') {
        // Students can view their profile and edit their own aspirations
        if (s==='view') return V;
        if (s==='aspirations') return E;  // self-edit aspirations
        return N;
      }
      return N;
    },
  };
  const perms = { byRole:{}, byUser:{} };
  PERM_ROLES.forEach(role => {
    perms.byRole[role] = {};
    PERM_MODULES.forEach(mod => mod.subs.forEach(sub => {
      perms.byRole[role][`${mod.key}__${sub.key}`] = DEFS[role](mod.key, sub.key);
    }));
  });
  return perms;
}

function _mergePerms(defaults, saved) {
  const out = JSON.parse(JSON.stringify(defaults));
  if (saved?.byRole) {
    Object.entries(saved.byRole).forEach(([role, cells]) => {
      if (!out.byRole[role]) out.byRole[role] = {};
      Object.entries(cells).forEach(([k,v]) => { out.byRole[role][k] = { ...out.byRole[role][k], ...v }; });
    });
  }
  if (saved?.byUser) out.byUser = JSON.parse(JSON.stringify(saved.byUser));
  return out;
}

function PChk({ checked, onChange, color }) {
  const ON  = { violet:'bg-violet-600 border-violet-600', amber:'bg-amber-500 border-amber-500', red:'bg-red-500 border-red-500' };
  const OFF = 'bg-white border-slate-300';
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={!onChange}
      className={`w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-all shrink-0 ${checked ? ON[color] : OFF} ${onChange ? 'hover:opacity-80 cursor-pointer' : 'cursor-default'}`}
    >
      {checked && <Check size={9} className="text-white" strokeWidth={3} />}
    </button>
  );
}

function RolesTab() {
  const qc       = useQueryClient();
  const userRole = useAuthStore(s => s.session?.user?.role ?? '');
  const isAdmin  = ['admin','superadmin'].includes(userRole);

  const [mode,     setMode]     = useState('role');   // 'role' | 'user'
  const [selRole,  setSelRole]  = useState('admin');
  const [selUser,  setSelUser]  = useState(null);
  const [expanded, setExpanded] = useState({});
  const [perms,    setPerms]    = useState(null);
  const [dirty,    setDirty]    = useState(false);
  const [toast,    setToast]    = useState(null);

  /* Load school data (holds saved modulePermissions) */
  const { data: schoolData } = useQuery({
    queryKey: ['settings','school'],
    queryFn:  () => settingsApi.school.get(),
    staleTime: 30_000,
  });

  /* Load users for Per-User mode */
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['settings','users'],
    queryFn:  () => settingsApi.users.list(),
    enabled:  mode === 'user',
    staleTime: 60_000,
  });
  const users = usersData?.data ?? [];

  /* Initialise permission state once school data arrives */
  useEffect(() => {
    if (!schoolData) return;
    const saved = schoolData.data?.modulePermissions;
    setPerms(saved ? _mergePerms(_makeDefaultPerms(), saved) : _makeDefaultPerms());
  }, [schoolData]);

  /* Save mutation */
  const { mutate: savePerms, isPending: saving } = useMutation({
    mutationFn: () => settingsApi.school.update({ modulePermissions: perms }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings','school'] });
      setDirty(false);
      setToast({ msg: 'Permissions saved.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Save failed.', type: 'error' }),
  });

  /* Toggle a single V/E/D cell */
  function toggle(permKey, type) {
    if (!isAdmin) return;
    setPerms(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      if (mode === 'role') {
        if (!next.byRole[selRole]) next.byRole[selRole] = {};
        const cell = next.byRole[selRole][permKey] ?? { v:false, e:false, d:false };
        cell[type] = !cell[type];
        next.byRole[selRole][permKey] = cell;
      } else {
        /* Per-user: start from current effective value, toggle, store override */
        if (!next.byUser[selUser]) next.byUser[selUser] = {};
        const u        = users.find(x => (x.id ?? x._id) === selUser);
        const roleBase = u ? (next.byRole[u.role]?.[permKey] ?? { v:false,e:false,d:false }) : { v:false,e:false,d:false };
        const override = next.byUser[selUser][permKey];
        const current  = override ? { ...roleBase, ...override } : { ...roleBase };
        current[type]  = !current[type];
        next.byUser[selUser][permKey] = current;
      }
      return next;
    });
    setDirty(true);
  }

  /* Effective permission map for the selected entity */
  const effectiveMap = (() => {
    if (!perms) return {};
    if (mode === 'role') return perms.byRole[selRole] ?? {};
    if (!selUser) return {};
    const u = users.find(x => (x.id ?? x._id) === selUser);
    const base = u ? (perms.byRole[u.role] ?? {}) : {};
    const over = perms.byUser?.[selUser] ?? {};
    return Object.fromEntries(
      Object.entries(base).map(([k,v]) => [k, over[k] ? { ...v, ...over[k] } : v])
    );
  })();

  if (!perms) return (
    <div className="space-y-3 max-w-4xl">
      {[...Array(5)].map((_,i) => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}
    </div>
  );

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Toast */}
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
          {[['role','Global (By Role)'],['user','Per User']].map(([v,label]) => (
            <button key={v} onClick={() => setMode(v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${mode===v ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >{label}</button>
          ))}
        </div>
        {isAdmin && dirty && (
          <button onClick={() => savePerms()} disabled={saving}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving…' : 'Save Permissions'}
          </button>
        )}
      </div>

      <div className="flex gap-4 items-start">

        {/* ── Left: entity selector ── */}
        <div className="shrink-0 w-44 space-y-1.5">
          {mode === 'role' ? (
            PERM_ROLES.map(r => {
              const c = PERM_ROLE_COLORS[r];
              return (
                <button key={r} onClick={() => setSelRole(r)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold text-left transition ring-1 ${selRole===r ? c.sel : c.idle}`}
                >
                  <ShieldCheck size={12} className="shrink-0" />
                  {PERM_ROLE_LABELS[r]}
                </button>
              );
            })
          ) : usersLoading ? (
            <div className="space-y-2">{[...Array(4)].map((_,i) => <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />)}</div>
          ) : users.length === 0 ? (
            <p className="text-xs text-slate-400 px-2 py-4 text-center">No users in school.</p>
          ) : (
            users.map(u => {
              const uid = u.id ?? u._id;
              const sel = selUser === uid;
              return (
                <button key={uid} onClick={() => setSelUser(uid)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition ring-1 ${sel ? 'ring-slate-800 bg-slate-900' : 'ring-slate-200 bg-white hover:bg-slate-50'}`}
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${sel ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
                    {(u.name ?? u.email ?? '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-medium truncate ${sel ? 'text-white' : 'text-slate-700'}`}>{u.name ?? u.email}</p>
                    <p className={`text-[10px] truncate capitalize ${sel ? 'text-white/60' : 'text-slate-400'}`}>{u.role}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* ── Right: permission tree ── */}
        <div className="flex-1 min-w-0 space-y-2">
          {(mode === 'role' && selRole) || (mode === 'user' && selUser) ? (
            <>
              {/* Legend */}
              <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-200 text-[11px]">
                <span className="font-semibold text-slate-600">Legend:</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-violet-600 inline-block" /><span className="text-slate-500">V = Visible</span></span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-amber-500 inline-block" /><span className="text-slate-500">E = Editable</span></span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500 inline-block" /><span className="text-slate-500">D = Deletable</span></span>
                {!isAdmin && <span className="ml-auto font-medium text-amber-600">Read-only — admin required to edit</span>}
                {mode === 'user' && selUser && (
                  <span className="ml-auto text-slate-400">Showing inherited role defaults + any user overrides</span>
                )}
              </div>

              {/* Module accordion rows */}
              {PERM_MODULES.map(mod => {
                const isOpen = expanded[mod.key] !== false; // default open
                return (
                  <div key={mod.key} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                    {/* Module header */}
                    <button
                      type="button"
                      onClick={() => setExpanded(p => ({ ...p, [mod.key]: !isOpen }))}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition text-left"
                    >
                      <span className="text-sm font-semibold text-slate-800">{mod.label}</span>
                      <div className="flex items-center gap-2 text-slate-400">
                        <span className="text-xs">{mod.subs.length} sub-modules</span>
                        <ChevronDown size={14} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                      </div>
                    </button>

                    {/* Sub-module rows */}
                    {isOpen && (
                      <div className="border-t border-slate-100">
                        {/* Column headers */}
                        <div className="flex items-center px-4 py-1.5 bg-slate-50/70 border-b border-slate-100">
                          <span className="flex-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Sub-module</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="w-[18px] text-center text-[10px] font-bold text-violet-600">V</span>
                            <span className="w-[18px] text-center text-[10px] font-bold text-amber-500">E</span>
                            <span className="w-[18px] text-center text-[10px] font-bold text-red-500">D</span>
                          </div>
                        </div>

                        {mod.subs.map(sub => {
                          const pk   = `${mod.key}__${sub.key}`;
                          const cell = effectiveMap[pk] ?? { v:false, e:false, d:false };
                          return (
                            <div key={sub.key} className="flex items-center px-4 py-2.5 border-b border-slate-50 last:border-0 hover:bg-slate-50/50 transition">
                              <span className="flex-1 text-sm text-slate-700">{sub.label}</span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <PChk checked={!!cell.v} color="violet" onChange={isAdmin ? () => toggle(pk,'v') : undefined} />
                                <PChk checked={!!cell.e} color="amber"  onChange={isAdmin ? () => toggle(pk,'e') : undefined} />
                                <PChk checked={!!cell.d} color="red"    onChange={isAdmin ? () => toggle(pk,'d') : undefined} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center gap-2">
              <ShieldCheck size={28} className="text-slate-300" />
              <p className="text-sm text-slate-400">Select a user from the list to view and configure their permissions.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SUBSCRIPTION TAB — pay Msingi platform subscription via M-Pesa
   ══════════════════════════════════════════════════════════════ */
/* Portal tiers — mirrors server/config/pricing.js */
const PORTAL_TIERS_SETTINGS = {
  base:       { label: 'Base',       rate: 100, tagline: 'Admin & teacher portals',   color: 'text-slate-700',  bg: 'bg-slate-50',   border: 'border-slate-300' },
  student:    { label: 'Student',    rate: 120, tagline: 'Base + student portal',      color: 'text-indigo-700', bg: 'bg-indigo-50',  border: 'border-indigo-300', popular: true },
  family:     { label: 'Family',     rate: 160, tagline: 'Student + parent portal',    color: 'text-violet-700', bg: 'bg-violet-50',  border: 'border-violet-300' },
  enterprise: { label: 'Enterprise', rate: null, tagline: 'Full access · custom SLAs', color: 'text-amber-700',  bg: 'bg-amber-50',   border: 'border-amber-200'  },
};
/* Map legacy plan keys → portal tier keys */
const LEGACY_TO_TIER = { core: 'base', standard: 'student', premium: 'family', base: 'base', student: 'student', family: 'family', enterprise: 'enterprise' };

function SubscriptionTab() {
  const school  = useAuthStore(s => s.session?.school);
  const user    = useAuthStore(s => s.session?.user);
  const [phone,        setPhone]        = useState(user?.phone || '');
  const [selTier,      setSelTier]      = useState(() => LEGACY_TO_TIER[school?.plan] || 'student');
  const [studentCount, setStudentCount] = useState(300);
  const [loading,      setLoading]      = useState(false);
  const [result,       setResult]       = useState(null);
  const [error,        setError]        = useState('');

  const currentTierKey  = LEGACY_TO_TIER[school?.plan] || 'student';
  const currentTierMeta = PORTAL_TIERS_SETTINGS[currentTierKey] ?? PORTAL_TIERS_SETTINGS.student;
  const isEnterprise    = currentTierKey === 'enterprise';
  const expiry          = school?.planExpiresAt
    ? new Date(school.planExpiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const selectedRate = PORTAL_TIERS_SETTINGS[selTier]?.rate || 0;
  const termAmount   = selectedRate * Math.max(1, studentCount);

  async function handlePay() {
    if (!phone.trim())     { setError('Enter the M-Pesa number to charge.'); return; }
    if (studentCount < 1)  { setError('Enter a valid student count.'); return; }
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('/api/mpesa/subscription', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${JSON.parse(localStorage.getItem('msingi_session') || '{}')?.token}`,
        },
        body: JSON.stringify({ phone: phone.trim(), tier: selTier, studentCount }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error?.message || 'Payment initiation failed.');
      setResult(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Current plan status */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center">
            <CreditCard size={16} className="text-indigo-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Current Plan</h3>
            <p className="text-xs text-slate-400">Msingi platform subscription</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${currentTierMeta.bg} ${currentTierMeta.color} border ${currentTierMeta.border}`}>
            <Zap size={12} />
            {currentTierMeta.label}
          </span>
          {expiry && (
            <span className="text-xs text-slate-400">Active until {expiry}</span>
          )}
          {!expiry && isEnterprise && (
            <span className="text-xs text-emerald-600 font-medium">Full access · Bootstrap trial</span>
          )}
          {!expiry && !isEnterprise && (
            <span className="text-xs text-amber-600 font-medium">No active subscription — limited access</span>
          )}
        </div>
      </div>

      {/* Portal tier selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Choose a Portal Tier</h3>
          <p className="text-xs text-slate-400 mt-0.5">All tiers include every ERP module. The tier controls which portals students and parents can log in to.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Object.entries(PORTAL_TIERS_SETTINGS).filter(([k]) => k !== 'enterprise').map(([key, meta]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSelTier(key)}
              className={`relative text-left p-4 rounded-xl border-2 transition-all ${selTier === key ? `${meta.border} ${meta.bg}` : 'border-slate-200 hover:border-slate-300'}`}
            >
              {meta.popular && (
                <span className="absolute -top-2.5 left-3 bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Popular</span>
              )}
              <p className={`text-sm font-semibold ${meta.color}`}>{meta.label}</p>
              <p className="text-xl font-bold text-slate-800 mt-1">
                KSh {meta.rate}<span className="text-xs font-normal text-slate-400"> /student/term</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">{meta.tagline}</p>
            </button>
          ))}
        </div>

        {/* Enterprise CTA */}
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <div className="flex-1">
            <p className="text-sm font-semibold text-amber-800">Enterprise</p>
            <p className="text-xs text-amber-600 mt-0.5">Custom SLAs, white-label, dedicated support. Talk to us.</p>
          </div>
          <a href="mailto:sales@msingi.io" className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-900 whitespace-nowrap">
            Contact sales <ArrowRight size={12} />
          </a>
        </div>
      </div>

      {/* Payment */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Smartphone size={14} className="text-emerald-500" />
          <h3 className="text-sm font-semibold text-slate-700">Pay via M-Pesa STK Push</h3>
          <span className="ml-auto text-[10px] font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full border border-emerald-200">Instant</span>
        </div>
        <p className="text-xs text-slate-400">
          Enter your enrolled student count — the term amount is calculated automatically.
          An STK push will be sent to your M-Pesa number.
        </p>

        {/* Student count + calculated amount */}
        <div className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">Enrolled students this term</label>
            <input
              type="number"
              min="1"
              max="9999"
              value={studentCount}
              onChange={e => setStudentCount(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            />
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-slate-400 mb-1">Term total</p>
            <p className="text-xl font-bold text-slate-800">KSh {termAmount.toLocaleString()}</p>
            <p className="text-[10px] text-slate-400">{studentCount} × KSh {selectedRate}</p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700 flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        {result && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2.5 text-sm text-emerald-700 flex items-start gap-2">
            <CheckCircle2 size={14} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">STK push sent!</p>
              <p className="text-xs mt-0.5">{result.message}</p>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">M-Pesa Number</label>
            <input
              type="tel"
              value={phone}
              onChange={e => { setPhone(e.target.value); setError(''); }}
              placeholder="0712 345 678 or +254..."
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={handlePay}
              disabled={loading || !phone.trim()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Smartphone size={14} />}
              Pay KSh {termAmount.toLocaleString()}
            </button>
          </div>
        </div>

        <p className="text-[10px] text-slate-400 flex items-center gap-1">
          <Lock size={10} />
          Payment is processed directly by Safaricom. Msingi does not store M-Pesa PINs.
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SYSTEM TAB — system info + data management
   ══════════════════════════════════════════════════════════════ */
function SystemTab() {
  const school = useAuthStore(s => s.session?.school);
  const user   = useAuthStore(s => s.session?.user);
  const [exporting, setExporting] = useState(false);

  const planBadgeColor = {
    free:       'bg-slate-100 text-slate-600',
    starter:    'bg-blue-50 text-blue-700',
    premium:    'bg-violet-50 text-violet-700',
    enterprise: 'bg-amber-50 text-amber-700',
  };

  const plan = school?.plan ?? 'premium';

  async function handleExport() {
    setExporting(true);
    try {
      const { importExport } = await import('@/api/client.js');
      await importExport.exportCSV('students');
    } catch {
      /* silent — the browser will show the download or error */
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-5">

      {/* School info card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Server size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">System Information</h3>
        </div>
        <div className="grid grid-cols-2 gap-y-3 text-sm">
          {[
            ['School ID',    school?.id ?? school?.slug ?? '—'],
            ['Platform',     'Msingi School ERP'],
            ['Subscription', <span key="plan" className={`inline-flex px-2 py-0.5 text-[11px] font-semibold rounded-full capitalize ${planBadgeColor[plan] ?? planBadgeColor.premium}`}>{plan}</span>],
            ['Version',      'v4.19.0'],
            ['Timezone',     school?.timezone ?? 'Africa/Nairobi'],
            ['Currency',     school?.currency ?? 'KES'],
            ['Academic Year',school?.academicYear ?? '—'],
            ['Terms/Year',   school?.termsPerYear ?? 3],
          ].map(([label, value]) => (
            <div key={label} className="space-y-0.5">
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</p>
              <p className="text-sm font-medium text-slate-700">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Data management */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
          <Database size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Data Management</h3>
        </div>
        <div className="space-y-3">
          <DataAction
            icon={<Download size={15} />}
            title="Export Students"
            desc="Download all active student records as a CSV file"
            buttonLabel={exporting ? 'Exporting…' : 'Export CSV'}
            buttonColor="bg-slate-900 hover:bg-slate-800"
            loading={exporting}
            onClick={handleExport}
          />
          <DataAction
            icon={<Download size={15} />}
            title="Export Teachers"
            desc="Download all teacher records as a CSV file"
            buttonLabel="Export CSV"
            buttonColor="bg-slate-900 hover:bg-slate-800"
            onClick={async () => {
              const { importExport } = await import('@/api/client.js');
              await importExport.exportCSV('teachers');
            }}
          />
          <div className="pt-1">
            <p className="text-xs text-slate-400">
              Import and export are now available directly in each module: Students, Teachers, Classes, Timetable, and Finance.
            </p>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-white border border-red-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-red-100">
          <AlertTriangle size={14} className="text-red-400" />
          <h3 className="text-xs font-semibold text-red-500 uppercase tracking-wider">Danger Zone</h3>
        </div>
        <div className="bg-red-50 rounded-lg px-4 py-3 text-xs text-red-700 space-y-1">
          <p className="font-semibold">Destructive operations are managed by your Msingi account manager.</p>
          <p>To permanently delete school data, reset academic records, or deactivate your account, please contact support at support@msingi.io</p>
        </div>
      </div>
    </div>
  );
}

function DataAction({ icon, title, desc, buttonLabel, buttonColor, loading, onClick }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 shrink-0 mt-0.5">
          {icon}
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700">{title}</p>
          <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
        </div>
      </div>
      <button
        onClick={onClick}
        disabled={loading}
        className={`shrink-0 flex items-center gap-1.5 ${buttonColor} disabled:opacity-50 text-white text-xs font-medium px-3 py-2 rounded-lg transition`}
      >
        {loading && <Loader2 size={12} className="animate-spin" />}
        {buttonLabel}
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   NOTIFICATIONS TAB
   Per-event, per-channel notification configuration matrix.
   ══════════════════════════════════════════════════════════════ */

/* ── Event registry (mirrors server/utils/notif-settings.js) ── */
const NOTIF_GROUPS = [
  { key: 'communication', label: 'Communication',      Icon: MessageSquare },
  { key: 'academic',      label: 'Academic',            Icon: BookOpen      },
  { key: 'finance',       label: 'Finance',             Icon: CreditCard    },
  { key: 'attendance',    label: 'Attendance',          Icon: Calendar      },
  { key: 'account',       label: 'Account & Security',  Icon: Shield        },
];

const NOTIF_EVENTS = [
  /* Communication */
  {
    key: 'new_message', group: 'communication',
    label: 'New Message',
    desc:  'When a user receives a direct or group message',
    audience: ['staff', 'parents'],
    channels: ['email', 'inApp'],
    implemented: true,
  },
  {
    key: 'announcement', group: 'communication',
    label: 'School Announcement',
    desc:  'When a school-wide announcement is posted',
    audience: ['staff', 'parents', 'students'],
    channels: ['email', 'inApp'],
    implemented: false,
  },
  /* Academic */
  {
    key: 'assessment_reminder', group: 'academic',
    label: 'Assessment Reminder',
    desc:  'Reminder for upcoming or overdue teacher assessments',
    audience: ['staff'],
    channels: ['email', 'inApp'],
    implemented: true,
  },
  {
    key: 'report_published', group: 'academic',
    label: 'Report Cards Published',
    desc:  'When report cards are released for a term',
    audience: ['parents', 'students'],
    channels: ['email', 'inApp'],
    implemented: false,
  },
  {
    key: 'exam_results', group: 'academic',
    label: 'Exam Results Released',
    desc:  'When exam results are published for a class',
    audience: ['parents', 'students'],
    channels: ['email', 'inApp'],
    implemented: false,
  },
  /* Finance */
  {
    key: 'invoice_created', group: 'finance',
    label: 'Invoice Generated',
    desc:  'When a new fee invoice is created for a student',
    audience: ['parents'],
    channels: ['email', 'inApp'],
    implemented: false,
  },
  {
    key: 'payment_received', group: 'finance',
    label: 'Payment Received',
    desc:  'Payment receipt sent after a fee payment is recorded',
    audience: ['parents'],
    channels: ['email', 'inApp'],
    implemented: false,
  },
  {
    key: 'invoice_overdue', group: 'finance',
    label: 'Overdue Invoice Reminder',
    desc:  'Reminder for unpaid invoices past their due date',
    audience: ['parents'],
    channels: ['email', 'inApp'],
    implemented: false,
  },
  /* Attendance */
  {
    key: 'absence_alert', group: 'attendance',
    label: 'Absence Alert',
    desc:  'Sent to parents when a student is marked absent',
    audience: ['parents'],
    channels: ['email', 'inApp'],
    implemented: false,
  },
  {
    key: 'attendance_summary', group: 'attendance',
    label: 'Daily Attendance Summary',
    desc:  'End-of-day attendance summary report for administrators',
    audience: ['staff'],
    channels: ['email', 'inApp'],
    implemented: false,
  },
  /* Account */
  {
    key: 'welcome_user', group: 'account',
    label: 'Welcome / Account Created',
    desc:  'Login credentials email sent to newly invited users',
    audience: ['staff', 'parents'],
    channels: ['email'],
    alwaysOn: true,
    implemented: true,
  },
  {
    key: 'role_changed', group: 'account',
    label: 'Role or Permission Changed',
    desc:  'Notifies a user when their role or access level is updated',
    audience: ['staff'],
    channels: ['email', 'inApp'],
    alwaysOn: true,
    implemented: true,
  },
  {
    key: 'password_expiry', group: 'account',
    label: 'Password Expiry Warning',
    desc:  'Security reminder sent before a user\'s password expires',
    audience: ['staff'],
    channels: ['email'],
    alwaysOn: true,
    implemented: true,
  },
];

/* Defaults for events when the school has no saved setting */
const NOTIF_DEFAULTS = {
  new_message:          { email: true,  inApp: true  },
  announcement:         { email: true,  inApp: true  },
  assessment_reminder:  { email: true,  inApp: false },
  report_published:     { email: true,  inApp: true  },
  exam_results:         { email: true,  inApp: true  },
  invoice_created:      { email: true,  inApp: true  },
  payment_received:     { email: true,  inApp: true  },
  invoice_overdue:      { email: true,  inApp: false },
  absence_alert:        { email: true,  inApp: true  },
  attendance_summary:   { email: false, inApp: true  },
  welcome_user:         { email: true,  inApp: false },
  role_changed:         { email: true,  inApp: true  },
  password_expiry:      { email: true,  inApp: false },
};

const AUDIENCE_PILL = {
  staff:    'bg-violet-50 text-violet-700 border-violet-200',
  parents:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  students: 'bg-amber-50 text-amber-700 border-amber-200',
};

const CHANNEL_META = {
  email: { label: 'Email', Icon: Mail },
  inApp: { label: 'In-App', Icon: Bell },
};

/* ── Toggle switch primitive ─────────────────────────────── */
function Toggle({ checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-slate-400
        ${disabled ? 'opacity-40 cursor-not-allowed' :  'cursor-pointer'}
        ${checked ? 'bg-slate-800' : 'bg-slate-200'}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform
          ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`}
      />
    </button>
  );
}

function NotificationsTab() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);
  const showT = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  /* ── Load current settings ─────────────────────────────── */
  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'notifications'],
    queryFn:  () => settingsApi.notifications.get(),
    staleTime: 30_000,
  });

  /* ── Local editable state ──────────────────────────────── */
  const [cfg, setCfg] = useState(null);

  // Initialise local state from server data
  const serverCfg = data?.data;
  const [initialised, setInitialised] = useState(false);
  if (serverCfg && !initialised) {
    // Merge server data with defaults for any missing keys
    const merged = {};
    for (const ev of NOTIF_EVENTS) {
      merged[ev.key] = { ...NOTIF_DEFAULTS[ev.key], ...(serverCfg[ev.key] ?? {}) };
    }
    setCfg(merged);
    setInitialised(true);
  }

  /* ── Save mutation ─────────────────────────────────────── */
  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => settingsApi.notifications.update(cfg),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'notifications'] });
      showT('Notification settings saved.');
    },
    onError: err => showT(err?.message ?? 'Failed to save settings.', 'error'),
  });

  /* ── Toggle a single channel for an event ──────────────── */
  function toggle(eventKey, channel, val) {
    setCfg(prev => ({
      ...prev,
      [eventKey]: { ...prev[eventKey], [channel]: val },
    }));
  }

  /* ── Dirty check ────────────────────────────────────────── */
  const isDirty = cfg && serverCfg
    ? JSON.stringify(cfg) !== JSON.stringify(
        Object.fromEntries(
          NOTIF_EVENTS.map(ev => [
            ev.key,
            { ...NOTIF_DEFAULTS[ev.key], ...(serverCfg[ev.key] ?? {}) },
          ])
        )
      )
    : false;

  const activeCfg = cfg ?? NOTIF_DEFAULTS;

  return (
    <div className="space-y-6">
      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium
              ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'}`}
          >
            {toast.type === 'error' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Notification Settings</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Control which events trigger notifications and through which channels.
          </p>
        </div>
        <button
          onClick={() => save()}
          disabled={!isDirty || saving || isLoading}
          className="btn-primary btn-sm flex items-center gap-1.5"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {/* Channel legend */}
      <div className="flex items-center gap-6 px-4 py-3 bg-slate-50 rounded-xl border border-slate-200">
        <p className="text-xs text-slate-500 font-medium">Channels:</p>
        {Object.entries(CHANNEL_META).map(([ch, { label, Icon }]) => (
          <div key={ch} className="flex items-center gap-1.5 text-xs text-slate-600">
            <Icon size={13} className="text-slate-400" />
            <span className="font-medium">{label}</span>
            <span className="text-slate-400">— sent directly to users</span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
          <Lock size={11} />
          Always on — security events
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="h-32 bg-slate-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        NOTIF_GROUPS.map(group => {
          const groupEvents = NOTIF_EVENTS.filter(ev => ev.group === group.key);
          if (!groupEvents.length) return null;
          const { Icon: GIcon } = group;

          return (
            <div key={group.key} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {/* Group header */}
              <div className="flex items-center gap-2.5 px-5 py-3.5 bg-slate-50 border-b border-slate-200">
                <GIcon size={14} className="text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-700">{group.label}</h3>
              </div>

              {/* Events */}
              <div className="divide-y divide-slate-100">
                {groupEvents.map((ev, idx) => {
                  const evCfg = activeCfg[ev.key] ?? NOTIF_DEFAULTS[ev.key] ?? {};

                  return (
                    <div
                      key={ev.key}
                      className={`flex items-center gap-4 px-5 py-4 transition-colors
                        ${ev.alwaysOn ? 'bg-slate-50/40' : 'hover:bg-slate-50/50'}`}
                    >
                      {/* Left — event info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-slate-800">{ev.label}</p>
                          {ev.alwaysOn && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-amber-50 text-amber-700 border-amber-200">
                              <Lock size={9} />
                              Always on
                            </span>
                          )}
                          {!ev.implemented && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border bg-sky-50 text-sky-700 border-sky-200">
                              <Clock size={9} />
                              Coming soon
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{ev.desc}</p>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {ev.audience.map(a => (
                            <span
                              key={a}
                              className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded border capitalize ${AUDIENCE_PILL[a] ?? 'bg-slate-100 text-slate-600 border-slate-200'}`}
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Right — channel toggles */}
                      <div className="flex items-center gap-6 shrink-0">
                        {(['email', 'inApp']).map(ch => {
                          const { label: chLabel, Icon: ChIcon } = CHANNEL_META[ch];
                          const hasChannel = ev.channels.includes(ch);
                          const isOn = ev.alwaysOn ? (ch === 'email') : (evCfg[ch] ?? false);

                          if (!hasChannel) {
                            return (
                              <div key={ch} className="w-[72px] flex flex-col items-center gap-1 opacity-20 select-none">
                                <ChIcon size={13} className="text-slate-400" />
                                <span className="text-[10px] text-slate-400">{chLabel}</span>
                                <div className="h-5 w-9 rounded-full bg-slate-100" />
                              </div>
                            );
                          }

                          return (
                            <div key={ch} className="w-[72px] flex flex-col items-center gap-1">
                              <ChIcon size={13} className={isOn ? 'text-slate-600' : 'text-slate-300'} />
                              <span className={`text-[10px] font-medium ${isOn ? 'text-slate-600' : 'text-slate-400'}`}>
                                {chLabel}
                              </span>
                              {ev.alwaysOn ? (
                                <div className="flex items-center gap-1">
                                  <div className="h-5 w-9 rounded-full bg-slate-800 flex items-center justify-end pr-0.5">
                                    <span className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm" />
                                  </div>
                                  <Lock size={9} className="text-slate-400" />
                                </div>
                              ) : (
                                <Toggle
                                  checked={isOn}
                                  onChange={val => toggle(ev.key, ch, val)}
                                  disabled={!ev.implemented && false}
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {/* Bottom save bar — appears when there are unsaved changes */}
      <AnimatePresence>
        {isDirty && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-5 py-3 bg-slate-900 text-white rounded-2xl shadow-2xl text-sm"
          >
            <span className="text-slate-300">You have unsaved notification changes</span>
            <button
              onClick={() => {
                const merged = {};
                for (const ev of NOTIF_EVENTS) {
                  merged[ev.key] = { ...NOTIF_DEFAULTS[ev.key], ...(serverCfg?.[ev.key] ?? {}) };
                }
                setCfg(merged);
              }}
              className="text-slate-400 hover:text-white transition text-xs px-2 py-1 rounded-lg hover:bg-slate-800"
            >
              Discard
            </button>
            <button
              onClick={() => save()}
              disabled={saving}
              className="flex items-center gap-1.5 bg-white text-slate-900 hover:bg-slate-100 transition px-3 py-1.5 rounded-lg text-xs font-semibold"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MODULES TAB — admin can toggle and reorder sidebar modules
   Changes saved to school.moduleConfig and apply to all users
   ══════════════════════════════════════════════════════════════ */

const MODULES_MASTER = [
  { key: 'students',   label: 'Students',            section: 'Academic'   },
  { key: 'teachers',   label: 'Teachers',            section: 'Academic'   },
  { key: 'classes',    label: 'Classes',             section: 'Academic'   },
  { key: 'timetable',  label: 'Timetable',           section: 'Academic'   },
  { key: 'attendance', label: 'Attendance',          section: 'Academic'   },
  { key: 'grades',     label: 'Exams & Assessment',  section: 'Academic'   },
  { key: 'subjects',   label: 'Subjects',            section: 'Academic'   },
  { key: 'lessons',    label: 'Lessons',             section: 'Academic'   },
  { key: 'admissions', label: 'Admissions',          section: 'Operations' },
  { key: 'behaviour',  label: 'Behaviour',           section: 'Operations' },
  { key: 'finance',    label: 'Finance',             section: 'Operations' },
  { key: 'messages',   label: 'Messages',            section: 'Operations' },
  { key: 'events',     label: 'Events',              section: 'Operations' },
  { key: 'hr',         label: 'HR & Staff',          section: 'Operations' },
  { key: 'library',    label: 'Library',             section: 'Operations' },
  { key: 'transport',  label: 'Transport',           section: 'Operations' },
  { key: 'hostel',     label: 'Hostel',              section: 'Operations' },
  { key: 'reports',    label: 'Reports & Analytics', section: 'Insights'   },
];

const SEC_BADGE = {
  Academic:   'bg-blue-50 text-blue-700 border-blue-200',
  Operations: 'bg-violet-50 text-violet-700 border-violet-200',
  Insights:   'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function initModuleList(savedConfig) {
  const cfgMap = Object.fromEntries(
    (savedConfig ?? []).map((m, i) => [m.key, { enabled: m.enabled ?? true, order: m.order ?? i }])
  );
  return MODULES_MASTER
    .map((m, i) => ({ ...m, enabled: cfgMap[m.key]?.enabled ?? true, order: cfgMap[m.key]?.order ?? i }))
    .sort((a, b) => a.order - b.order);
}

function ModulesTab() {
  const patchSchool = useAuthStore(s => s.patchSchool);
  const savedConfig = useAuthStore(s => s.session?.school?.moduleConfig);

  const [modules, setModules] = useState(() => initModuleList(savedConfig));
  const [toast,   setToast]   = useState(null);
  const showT = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: (cfg) => settingsApi.school.update({ moduleConfig: cfg }),
    onSuccess: (_, cfg) => {
      patchSchool({ moduleConfig: cfg });
      showT('Saved — sidebar updated for all users.');
    },
    onError: err => showT(err?.message ?? 'Failed to save module settings.', 'error'),
  });

  function toggle(key) {
    setModules(prev => prev.map(m => m.key === key ? { ...m, enabled: !m.enabled } : m));
  }

  function move(index, dir) {
    setModules(prev => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function handleSave() {
    const cfg = modules.map((m, i) => ({ key: m.key, enabled: m.enabled, order: i }));
    save(cfg);
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Navigation Modules</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Use the arrows to reorder or toggle modules on/off. Changes apply to all staff accounts in your school.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <AnimatePresence>
            {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
          </AnimatePresence>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-700 disabled:opacity-60 transition"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save order
          </button>
        </div>
      </div>

      {/* Fixed modules note */}
      <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
        <Info size={14} className="mt-0.5 shrink-0 text-amber-500" />
        <span>
          <strong className="font-semibold">Dashboard · Settings · Changelog · Help Centre</strong>{' '}
          are always visible and cannot be hidden or reordered.
        </span>
      </div>

      {/* Module list */}
      <div className="rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
        {modules.map((mod, index) => (
          <div
            key={mod.key}
            className={`flex items-center gap-3 px-4 py-3 transition-colors ${
              mod.enabled ? 'bg-white' : 'bg-slate-50'
            }`}
          >
            {/* Up / Down arrows */}
            <div className="flex flex-col shrink-0">
              <button
                onClick={() => move(index, -1)}
                disabled={index === 0}
                className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-20 rounded transition"
                title="Move up"
              >
                <ChevronUp size={14} />
              </button>
              <button
                onClick={() => move(index, 1)}
                disabled={index === modules.length - 1}
                className="p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-20 rounded transition"
                title="Move down"
              >
                <ChevronDown size={14} />
              </button>
            </div>

            {/* Position badge */}
            <span className="w-5 text-center text-[11px] text-slate-400 font-mono tabular-nums shrink-0">
              {index + 1}
            </span>

            {/* Name */}
            <span className={`flex-1 text-sm font-medium ${mod.enabled ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
              {mod.label}
            </span>

            {/* Section badge */}
            <span className={`hidden sm:inline-flex px-2 py-0.5 text-[10px] font-semibold rounded border ${SEC_BADGE[mod.section] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
              {mod.section}
            </span>

            {/* Toggle switch */}
            <button
              onClick={() => toggle(mod.key)}
              role="switch"
              aria-checked={mod.enabled}
              title={mod.enabled ? 'Disable module' : 'Enable module'}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
                mod.enabled ? 'bg-violet-600' : 'bg-slate-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  mod.enabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-400 text-center pb-2">
        The sidebar refreshes immediately after saving — no page reload needed.
      </p>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
   ══════════════════════════════════════════════════════════════ */
export default function SettingsPage() {
  const [tab, setTab] = useState('school');
  const role = useAuthStore(s => s.session?.user?.role ?? '');
  const isAdmin = ['admin', 'superadmin'].includes(role);

  const visibleTabs = TABS.filter(t => !t.adminOnly || isAdmin);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="mb-5">
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Settings</h1>
            <p className="text-sm text-slate-500 mt-0.5">School profile, team management, permissions and system information</p>
          </div>
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {visibleTabs.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                  tab === id
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {tab === 'school'         && <SchoolTab />}
            {tab === 'subscription'   && <SubscriptionTab />}
            {tab === 'users'          && <UsersTab />}
            {tab === 'roles'          && <RolesTab />}
            {tab === 'modules'        && <ModulesTab />}
            {tab === 'notifications'  && <NotificationsTab />}
            {tab === 'system'         && <SystemTab />}
            {tab === 'account'        && <AccountTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
