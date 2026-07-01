/* ============================================================
   Settings — Premium Enterprise Rebuild
   /platform-audit: lucide icons, invite slide-over, currency +
   timezone fields, houses config, no old components, no alert()
   ============================================================ */
import { useState, useRef } from 'react';
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
  Bell, MessageSquare, BookOpen, Calendar, CalendarDays, Clock,
  Upload, ImageIcon, KeyRound, Copy,
  PlusCircle, ChevronRight, AlertCircle, Archive,
  MonitorPlay, WifiOff, LayoutTemplate,
} from 'lucide-react';
import RCTemplatesSection from './RCTemplatesSection.jsx';
import { sections as sectionsApi, teachers as teachersApi } from '@/api/client.js';
import { settings as settingsApi } from '@/api/client.js';
import { academicConfig as academicConfigApi } from '@/api/client.js';
import { billing as billingApi, mpesa as mpesaApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

/* ── Tab config ─────────────────────────────────────────────── */
const TABS = [
  { id: 'school',         label: 'School',              Icon: Building2,      adminOnly: true  },
  { id: 'subscription',   label: 'Subscription',        Icon: CreditCard,     adminOnly: true  },
  { id: 'users',          label: 'Users',               Icon: Users,          adminOnly: true  },
  { id: 'roles',          label: 'Roles & Permissions', Icon: ShieldCheck,    adminOnly: true  },
  { id: 'modules',        label: 'Modules',             Icon: Layers,         adminOnly: true  },
  { id: 'rc_templates',   label: 'Report Templates',    Icon: LayoutTemplate, adminOnly: true  },
  { id: 'notifications',  label: 'Notifications',       Icon: Bell,           adminOnly: true  },
  { id: 'system',         label: 'System',              Icon: Database,       adminOnly: true  },
  { id: 'account',        label: 'Account',             Icon: User,           adminOnly: false },
];

/* ── Role display constants (must be before RolePill + USER_ROLE_GROUPS) ── */
const SYSTEM_ROLE_LABELS = {
  superadmin:           'Super Admin',
  admin:                'Admin',
  deputy_principal:     'Deputy Principal',
  deputy:               'Deputy',               // legacy alias
  section_head:         'Section Head',
  teacher:              'Teacher',
  exams_officer:        'Exams Officer',
  timetabler:           'Timetabler',
  admissions_officer:   'Admissions Officer',
  finance:              'Finance',
  hr:                   'HR',
  discipline_committee: 'Discipline Committee',
  parent:               'Parent',
  student:              'Student',
};
const SYSTEM_ROLE_COLORS = {
  superadmin:           { sel:'bg-red-600 text-white ring-red-600',          idle:'ring-slate-200 bg-white text-red-700'        },
  admin:                { sel:'bg-violet-600 text-white ring-violet-600',     idle:'ring-slate-200 bg-white text-violet-700'     },
  deputy_principal:     { sel:'bg-indigo-600 text-white ring-indigo-600',     idle:'ring-slate-200 bg-white text-indigo-700'     },
  section_head:         { sel:'bg-purple-600 text-white ring-purple-600',     idle:'ring-slate-200 bg-white text-purple-700'     },
  teacher:              { sel:'bg-blue-600 text-white ring-blue-600',         idle:'ring-slate-200 bg-white text-blue-700'       },
  exams_officer:        { sel:'bg-cyan-600 text-white ring-cyan-600',         idle:'ring-slate-200 bg-white text-cyan-700'       },
  timetabler:           { sel:'bg-teal-600 text-white ring-teal-600',         idle:'ring-slate-200 bg-white text-teal-700'       },
  admissions_officer:   { sel:'bg-sky-600 text-white ring-sky-600',           idle:'ring-slate-200 bg-white text-sky-700'        },
  finance:              { sel:'bg-green-600 text-white ring-green-600',       idle:'ring-slate-200 bg-white text-green-700'      },
  hr:                   { sel:'bg-lime-600 text-white ring-lime-600',         idle:'ring-slate-200 bg-white text-lime-700'       },
  discipline_committee: { sel:'bg-orange-600 text-white ring-orange-600',     idle:'ring-slate-200 bg-white text-orange-700'     },
  parent:               { sel:'bg-emerald-600 text-white ring-emerald-600',   idle:'ring-slate-200 bg-white text-emerald-700'    },
  student:              { sel:'bg-amber-500 text-white ring-amber-500',       idle:'ring-slate-200 bg-white text-amber-700'      },
};

/* ── Role pills ─────────────────────────────────────────────── */
const ROLE_PILL = {
  superadmin:           'bg-red-50 text-red-700 border-red-200',
  admin:                'bg-violet-50 text-violet-700 border-violet-200',
  deputy_principal:     'bg-indigo-50 text-indigo-700 border-indigo-200',
  deputy:               'bg-indigo-50 text-indigo-700 border-indigo-200',  // legacy alias
  section_head:         'bg-purple-50 text-purple-700 border-purple-200',
  teacher:              'bg-blue-50 text-blue-700 border-blue-200',
  exams_officer:        'bg-cyan-50 text-cyan-700 border-cyan-200',
  timetabler:           'bg-teal-50 text-teal-700 border-teal-200',
  admissions_officer:   'bg-sky-50 text-sky-700 border-sky-200',
  finance:              'bg-green-50 text-green-700 border-green-200',
  hr:                   'bg-lime-50 text-lime-700 border-lime-200',
  discipline_committee: 'bg-orange-50 text-orange-700 border-orange-200',
  parent:               'bg-emerald-50 text-emerald-700 border-emerald-200',
  student:              'bg-amber-50 text-amber-700 border-amber-200',
};
function RolePill({ role, customRoles = [] }) {
  // Check if this is a custom role first
  const cr = customRoles.find(r => r.key === role);
  if (cr) {
    return (
      <span
        className="inline-flex px-2 py-0.5 text-[11px] font-medium rounded border"
        style={{ backgroundColor: cr.color + '18', color: cr.color, borderColor: cr.color + '55' }}
      >
        {cr.label}
      </span>
    );
  }
  const label = SYSTEM_ROLE_LABELS[role] ?? role.replace(/_/g, ' ');
  const cls   = ROLE_PILL[role] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`inline-flex px-2 py-0.5 text-[11px] font-medium rounded border capitalize ${cls}`}>
      {label}
    </span>
  );
}

/* ── Shared primitives ───────────────────────────────────────── */
function iCls(err = false) {
  return `w-full text-sm px-3 py-2 rounded-lg border ${err ? 'border-red-300 focus:ring-red-500/20' : 'border-slate-200 focus:border-slate-400 focus:ring-slate-900/10'} bg-white focus:outline-none focus:ring-2 text-slate-800 placeholder-slate-400 transition`;
}

function Toast({ msg, type = 'success', onDismiss }) {
  const isErr  = type === 'error';
  const isWarn = type === 'warning';
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border shadow-sm ${
        isErr  ? 'bg-red-50    text-red-700    border-red-200'    :
        isWarn ? 'bg-amber-50  text-amber-700  border-amber-200'  :
                 'bg-emerald-50 text-emerald-700 border-emerald-200'
      }`}
    >
      {isErr || isWarn ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
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
  const [editForm, setEditForm] = useState({});      // { name, color, sectionHeadId }
  const [addForm,  setAddForm]  = useState({ key: '', name: '', color: SECTION_PALETTE[0] });
  const [adding,   setAdding]   = useState(false);

  const showT = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['sections'],
    queryFn:  () => sectionsApi.list(),
    staleTime: 10 * 60_000,
  });
  const rows = data?.data ?? [];

  const { data: teachersData } = useQuery({
    queryKey: ['teachers-list-for-sections'],
    queryFn:  () => teachersApi.list({ limit: 500 }),
    staleTime: 5 * 60_000,
  });
  const allTeachers = teachersData?.data ?? [];
  const teacherOptions = allTeachers.map(t => ({
    value: t.id,
    label: [t.title, t.firstName, t.lastName].filter(Boolean).join(' '),
  }));

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
              /* Inline edit row — wraps to multi-line */
              <div className="flex-1 flex flex-col gap-2 py-1">
                <div className="flex items-center gap-2">
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
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={editForm.sectionHeadId ?? ''}
                    onChange={e => setEditForm(p => ({ ...p, sectionHeadId: e.target.value || null }))}
                    className="flex-1 text-sm px-2 py-1 rounded border border-slate-200 focus:outline-none focus:border-indigo-400 bg-white"
                  >
                    <option value="">— No Section Head —</option>
                    {teacherOptions.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => updateSec({ id: sec.id, data: editForm })} disabled={updating}
                    className="text-xs font-medium text-white bg-slate-800 hover:bg-slate-700 px-2.5 py-1 rounded-lg transition disabled:opacity-50">
                    {updating ? <Loader2 size={11} className="animate-spin" /> : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditId(null)}
                    className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg transition">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* Display row */
              <>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-slate-800">{sec.name}</span>
                  {sec.sectionHeadName && (
                    <span className="block text-[11px] text-slate-400 truncate">Head: {sec.sectionHeadName}</span>
                  )}
                </div>
                <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{sec.key}</span>
                <button type="button"
                  onClick={() => { setEditId(sec.id); setEditForm({ name: sec.name, color: sec.color, sectionHeadId: sec.sectionHeadId ?? null }); }}
                  className="text-slate-400 hover:text-slate-700 p-1 rounded transition" title="Edit">
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

/* ── Asset uploader — logo or favicon ───────────────────────── */
function AssetUploader({ label, hint, currentUrl, maxKB, accept, onUpload, onDelete, uploading, square }) {
  const inputRef  = useRef(null);
  const [preview, setPreview] = useState(null);

  function pickFile() { inputRef.current?.click(); }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const b64 = ev.target.result;
      setPreview(b64);
      onUpload(b64);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  const src = preview || currentUrl;

  return (
    <div className="flex items-start gap-4">
      {/* Preview box */}
      <div
        className={`flex-shrink-0 flex items-center justify-center bg-slate-100 border-2 border-dashed border-slate-200 rounded-xl overflow-hidden ${square ? 'w-16 h-16' : 'w-24 h-16'}`}
        style={{ cursor: 'pointer' }}
        onClick={pickFile}
      >
        {src
          ? <img src={src} alt={label} className="w-full h-full object-contain p-1" />
          : <ImageIcon size={20} className="text-slate-300" />
        }
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-700 mb-0.5">{label}</p>
        <p className="text-xs text-slate-400 mb-2">{hint}</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={pickFile}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50 transition-colors"
          >
            {uploading
              ? <Loader2 size={12} className="animate-spin" />
              : <Upload size={12} />
            }
            {src ? 'Replace' : 'Upload'}
          </button>
          {src && (
            <button
              type="button"
              onClick={() => { setPreview(null); onDelete(); }}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 bg-red-50 hover:bg-red-100 text-red-600 disabled:opacity-50 transition-colors"
            >
              <Trash2 size={12} /> Remove
            </button>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}

/* ── Branding card — logo + favicon ─────────────────────────── */
function BrandingCard({ schoolId, logoUrl, faviconUrl, onSaved }) {
  const [logoUploading,    setLogoUploading]    = useState(false);
  const [faviconUploading, setFaviconUploading] = useState(false);
  const [toast,            setToast]            = useState(null);

  async function handleLogoUpload(b64) {
    setLogoUploading(true);
    try {
      await settingsApi.school.uploadLogo(b64);
      setToast({ msg: 'Logo saved.', type: 'success' });
      onSaved?.();
    } catch (err) {
      setToast({ msg: err?.message || 'Failed to upload logo.', type: 'error' });
    } finally {
      setLogoUploading(false);
    }
  }

  async function handleLogoDelete() {
    setLogoUploading(true);
    try {
      await settingsApi.school.deleteLogo();
      setToast({ msg: 'Logo removed.', type: 'success' });
      onSaved?.();
    } finally {
      setLogoUploading(false);
    }
  }

  async function handleFaviconUpload(b64) {
    setFaviconUploading(true);
    try {
      await settingsApi.school.uploadFavicon(b64);
      setToast({ msg: 'Favicon saved.', type: 'success' });
      onSaved?.();
    } catch (err) {
      setToast({ msg: err?.message || 'Failed to upload favicon.', type: 'error' });
    } finally {
      setFaviconUploading(false);
    }
  }

  async function handleFaviconDelete() {
    setFaviconUploading(true);
    try {
      await settingsApi.school.deleteFavicon();
      setToast({ msg: 'Favicon removed.', type: 'success' });
      onSaved?.();
    } finally {
      setFaviconUploading(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
        <ImageIcon size={14} className="text-slate-400" />
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Branding</h3>
      </div>

      <div className="h-6 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      <AssetUploader
        label="School Logo"
        hint={`Displayed in the sidebar and login page. PNG, WebP or SVG recommended. Max 500 KB.`}
        currentUrl={logoUrl}
        maxKB={500}
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onUpload={handleLogoUpload}
        onDelete={handleLogoDelete}
        uploading={logoUploading}
        square={false}
      />

      <div className="border-t border-slate-100 pt-4">
        <AssetUploader
          label="Favicon"
          hint="Browser tab icon. Must be square (e.g. 32×32 or 64×64). PNG or ICO. Max 150 KB."
          currentUrl={faviconUrl}
          maxKB={150}
          accept="image/png,image/x-icon,image/vnd.microsoft.icon"
          onUpload={handleFaviconUpload}
          onDelete={handleFaviconDelete}
          uploading={faviconUploading}
          square={true}
        />
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ADMISSION NUMBERS SECTION
   Lives inside SchoolTab; has its own counter API call.
   ══════════════════════════════════════════════════════════════ */
function AdmissionNumbersSection({ form: f, set }) {
  const qc = useQueryClient();
  const [counterInput, setCounterInput] = useState('');
  const [counterMsg,   setCounterMsg]   = useState(null); // {ok, text}

  const ac  = f.admissionConfig ?? {};
  const prefix      = ac.prefix      ?? '';
  const padding     = ac.padding      ?? 5;
  const yearInPrefix = ac.yearInPrefix !== false; // default true

  function setAC(k, v) { set('admissionConfig', { ...ac, [k]: v }); }

  // Build a live preview of what the next number will look like
  function preview(offset = 1) {
    const num = String(offset).padStart(padding, '0');
    if (prefix !== undefined) {
      return yearInPrefix
        ? `${prefix}${new Date().getFullYear()}-${num}`
        : `${prefix}${num}`;
    }
    return `ADM-${new Date().getFullYear()}-${num}`;
  }

  // Fetch current counter from server (read-only display)
  const { data: counterData, refetch: refetchCounter } = useQuery({
    queryKey: ['settings', 'admission-counter'],
    queryFn:  () => settingsApi.school.admissionCounter.get(),
    staleTime: 0,
  });
  const currentSeq        = counterData?.data?.seq ?? 0;
  const nextFormatted     = counterData?.data?.nextFormatted ?? preview(currentSeq + 1);

  const { mutate: saveCounter, isPending: savingCounter } = useMutation({
    mutationFn: () => settingsApi.school.admissionCounter.set(parseInt(counterInput, 10)),
    onSuccess: () => {
      setCounterMsg({ ok: true, text: 'Counter updated.' });
      setCounterInput('');
      refetchCounter();
    },
    onError: err => setCounterMsg({ ok: false, text: err?.message ?? 'Failed to set counter.' }),
  });

  const PADDING_OPTIONS = [3, 4, 5, 6, 7, 8];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
        <KeyRound size={14} className="text-indigo-500" />
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Admission Numbers</h3>
      </div>

      {/* Live preview banner */}
      <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
        <span className="text-[11px] text-indigo-500 font-semibold uppercase tracking-wide">Next generated</span>
        <span className="font-mono text-base font-bold text-indigo-700">{preview(currentSeq + 1)}</span>
        <span className="ml-auto text-[10px] text-indigo-400">counter at {currentSeq}</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Prefix */}
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1.5">
            Prefix <span className="font-normal text-slate-400">(leave blank for number-only)</span>
          </label>
          <input
            value={prefix}
            onChange={e => setAC('prefix', e.target.value)}
            placeholder="e.g. MLA-33  or  KPS/  or leave blank"
            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            {prefix
              ? yearInPrefix
                ? `Format: ${prefix}{year}-{number}`
                : `Format: ${prefix}{number}`
              : yearInPrefix
                ? 'Format: ADM-{year}-{number}  (legacy default)'
                : 'Format: {number only}'
            }
          </p>
        </div>

        {/* Number length */}
        <div>
          <label className="text-xs font-medium text-slate-600 block mb-1.5">Number length (digits)</label>
          <div className="flex gap-2 flex-wrap">
            {PADDING_OPTIONS.map(n => (
              <button key={n} type="button"
                onClick={() => setAC('padding', n)}
                className={`w-10 h-10 rounded-lg text-sm font-bold border transition-colors
                  ${padding === n
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}>
                {n}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-1.5">
            {`${padding} digits → ${'0'.repeat(padding - 1)}1`}
          </p>
        </div>
      </div>

      {/* Year in prefix toggle */}
      <div className="flex items-center justify-between gap-4 bg-slate-50 rounded-xl px-4 py-3 border border-slate-200">
        <div>
          <p className="text-sm font-semibold text-slate-700">Include year in admission number</p>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {yearInPrefix
              ? `Counter resets each year — students from different years are easy to identify (e.g. MLA-33${new Date().getFullYear()}-0001)`
              : 'Counter never resets — sequential for the life of the school (e.g. MLA-330298)'}
          </p>
        </div>
        <button type="button"
          onClick={() => setAC('yearInPrefix', !yearInPrefix)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none
            ${yearInPrefix ? 'bg-indigo-600' : 'bg-slate-200'}`}>
          <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition duration-200
            ${yearInPrefix ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      {/* Counter management */}
      <div className="border-t border-slate-100 pt-4 space-y-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Counter (for migrations &amp; imports)</p>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Set this to the <strong>last used</strong> number from your previous system.
          The next admission will be one higher.
          Example: your last student was <strong>MLA-330297</strong> → enter <strong>297</strong>.
        </p>
        <div className="flex gap-2 items-center">
          <input
            type="number" min={0}
            value={counterInput}
            onChange={e => { setCounterInput(e.target.value); setCounterMsg(null); }}
            placeholder={`Current: ${currentSeq} — next is ${currentSeq + 1}`}
            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <button
            type="button"
            disabled={savingCounter || counterInput === ''}
            onClick={() => saveCounter()}
            className="px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors whitespace-nowrap">
            {savingCounter ? 'Saving…' : 'Set counter'}
          </button>
        </div>
        {counterMsg && (
          <p className={`text-[11px] font-medium ${counterMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>
            {counterMsg.text}
            {counterMsg.ok && ` Next number will be: ${nextFormatted}`}
          </p>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   STAFF RESPONSIBILITIES PANEL — standalone component
   Placed inside SchoolTab (HR section). Manages the per-school
   list of responsibility options shown in the Add/Edit Staff form.
   ══════════════════════════════════════════════════════════════ */
const DEFAULT_STAFF_RESPONSIBILITIES = [
  { value: 'hod',           label: 'Head of Department' },
  { value: 'class_teacher', label: 'Class Teacher / Form Tutor' },
  { value: 'timetabler',    label: 'Timetabler' },
  { value: 'exam_officer',  label: 'Exam Officer' },
  { value: 'deputy',        label: 'Deputy Principal' },
  { value: 'principal',     label: 'Principal' },
];

function StaffResponsibilitiesPanel() {
  const qc = useQueryClient();
  const [toast,    setToast]    = useState(null);
  const [newLabel, setNewLabel] = useState('');
  const [adding,   setAdding]   = useState(false);

  const showT = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'school'],
    queryFn:  () => settingsApi.school.get(),
    staleTime: 5 * 60_000,
  });

  const school = data?.data ?? {};
  const responsibilities = Array.isArray(school.staffResponsibilities) && school.staffResponsibilities.length > 0
    ? school.staffResponsibilities
    : DEFAULT_STAFF_RESPONSIBILITIES;

  const { mutate: saveList, isPending: saving } = useMutation({
    mutationFn: (list) => settingsApi.school.update({ staffResponsibilities: list }),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['settings', 'school'] });
      qc.invalidateQueries({ queryKey: ['school-settings-hr'] });
      showT('Responsibilities updated.');
    },
    onError: err => showT(err?.message ?? 'Failed to save.', 'error'),
  });

  function handleAdd() {
    const label = newLabel.trim();
    if (!label) return;
    const value = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    if (responsibilities.some(r => r.value === value || r.label.toLowerCase() === label.toLowerCase())) {
      showT('That responsibility already exists.', 'error');
      return;
    }
    saveList([...responsibilities, { value, label }]);
    setNewLabel('');
    setAdding(false);
  }

  function handleDelete(value) {
    if (!window.confirm('Remove this responsibility? Staff members with it assigned will keep the value, but it will no longer appear as an option.')) return;
    saveList(responsibilities.filter(r => r.value !== value));
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
        <Shield size={14} className="text-violet-500" />
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Staff Roles & Responsibilities</h3>
        <button
          type="button"
          onClick={() => setAdding(p => !p)}
          className="ml-auto flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg transition"
        >
          <Plus size={11} /> Add Role
        </button>
      </div>

      <p className="text-xs text-slate-400 leading-relaxed -mt-2">
        These options appear in the <strong>Roles &amp; Responsibilities</strong> section when adding or editing a staff member.
        Customise them to match your school's structure — e.g. KS Coordinators, Section Heads, Deputy Head Primary.
      </p>

      {/* Toast */}
      <AnimatePresence>
        {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
      </AnimatePresence>

      {/* Responsibility rows */}
      <div className="space-y-1.5">
        {responsibilities.map(r => (
          <div key={r.value} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-100">
            <Shield size={12} className="text-violet-400 shrink-0" />
            <span className="flex-1 text-sm text-slate-700 font-medium">{r.label}</span>
            <span className="text-[10px] text-slate-400 font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded">{r.value}</span>
            <button
              type="button"
              onClick={() => handleDelete(r.value)}
              className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition"
              title="Remove"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>

      {/* Add form */}
      <AnimatePresence>
        {adding && (
          <motion.div
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-2 pt-1">
              <input
                autoFocus
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } if (e.key === 'Escape') { setAdding(false); setNewLabel(''); } }}
                placeholder="e.g. KS3 Academic Coordinator"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40"
              />
              <button
                type="button"
                onClick={handleAdd}
                disabled={!newLabel.trim() || saving}
                className="flex items-center gap-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-xs font-semibold px-3 py-2 rounded-lg transition"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Add
              </button>
              <button
                type="button"
                onClick={() => { setAdding(false); setNewLabel(''); }}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
              >
                <X size={13} />
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
  const qc         = useQueryClient();
  const patchSchool = useAuthStore(s => s.patchSchool);
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
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['settings', 'school'] });
      setForm(null);
      setToast({ msg: 'School settings saved.', type: 'success' });
      // Patch in-memory store so timetable banner + other module reads update immediately
      const saved = res?.data ?? {};
      const patch = {};
      if (saved.primaryColor        !== undefined) patch.primaryColor        = saved.primaryColor;
      if (saved.accentColor         !== undefined) patch.accentColor         = saved.accentColor;
      if (saved.academicYear        !== undefined) patch.academicYear        = saved.academicYear;
      if (saved.emergencyOnlineMode !== undefined) patch.emergencyOnlineMode = saved.emergencyOnlineMode;
      if (saved.moduleConfig        !== undefined) patch.moduleConfig        = saved.moduleConfig;
      if (saved.portalConfig        !== undefined) patch.portalConfig        = saved.portalConfig;
      if (saved.admissionConfig     !== undefined) patch.admissionConfig     = saved.admissionConfig;
      if (Object.keys(patch).length) patchSchool(patch);
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
    <form onSubmit={e => { e.preventDefault(); mutate(f); }} className="max-w-5xl space-y-4">
      {/* Toast */}
      <div className="h-8 flex items-center">
        <AnimatePresence>
          {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
        </AnimatePresence>
      </div>

      {/* ── Row 1: School Information + Branding ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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

        {/* Branding */}
        <BrandingCard schoolId={school.id} logoUrl={school.logoUrl} faviconUrl={school.faviconUrl} onSaved={() => qc.invalidateQueries({ queryKey: ['settings', 'school'] })} />
      </div>

      {/* ── Row 2: Regional + House System ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
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
          {/* ── Academic year management ── */}
          <AcademicYearsSection schoolId={school.id} />
          {/* ── Year start month (still controls billing roll-over) */}
          <div className="grid grid-cols-2 gap-3">
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
            <strong>Year starts in</strong> controls when billing invoices are auto-generated — a September start means the year
            rolls over in September, not January.
          </p>
        </div>

        {/* House System */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <Home size={14} className="text-slate-400" />
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">House System</h3>
            <span className="ml-auto text-xs text-slate-400">{houses.length} configured</span>
          </div>
          <p className="text-xs text-slate-400">Houses are used in the Behaviour module leaderboard and assigned to students on their profile.</p>

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
      </div>

      {/* ── Login Page Appearance (full-width) ── */}
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

      {/* ── Row 3: Curriculum Sections + Staff Responsibilities ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <SectionsPanel />
        <StaffResponsibilitiesPanel />
      </div>

      {/* ── Row 4: Emergency Online Learning + Portal Settings ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {/* Emergency Online Learning */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <MonitorPlay size={14} className="text-sky-500" />
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Emergency Online Learning Mode</h3>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            When this mode is active, each timetable slot automatically shows the assigned teacher's personal meeting link.
            Students see a <strong>"Join"</strong> button on their timetable — no separate scheduling required.
            Use this when the school cannot operate physically (weather, emergencies, etc.).
          </p>
          <div className="flex items-center justify-between gap-4 bg-slate-50 rounded-xl px-4 py-3.5 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${f.emergencyOnlineMode ? 'bg-sky-100' : 'bg-slate-100'}`}>
                {f.emergencyOnlineMode
                  ? <MonitorPlay size={18} className="text-sky-600" />
                  : <WifiOff size={18} className="text-slate-400" />
                }
              </div>
              <div>
                <p className={`text-sm font-semibold ${f.emergencyOnlineMode ? 'text-sky-700' : 'text-slate-600'}`}>
                  {f.emergencyOnlineMode ? 'Emergency Mode is ON' : 'Emergency Mode is OFF'}
                </p>
                <p className="text-[11px] text-slate-400">
                  {f.emergencyOnlineMode
                    ? 'Timetable shows meeting links. Students can join classes directly.'
                    : 'Normal operation — timetable shows class schedule only.'
                  }
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => set('emergencyOnlineMode', !f.emergencyOnlineMode)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none
                ${f.emergencyOnlineMode ? 'bg-sky-600' : 'bg-slate-200'}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out
                ${f.emergencyOnlineMode ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
          {f.emergencyOnlineMode && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3.5 py-3 text-xs text-amber-700">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                <strong>Important:</strong> Teachers must have saved their Zoom or Meet link in their Profile for the Join button to appear on their slots.
                Students will see links for all teachers who have saved a meeting link.
              </span>
            </div>
          )}
        </div>

        {/* Student & Parent Portal Settings */}
        {(() => {
          const pc = f.portalConfig ?? {};
          const showFees = pc.studentCanSeeFees ?? false;
          const threshold = pc.reportCardFeeThreshold ?? 100;
          function setPC(k, v) { set('portalConfig', { ...pc, [k]: v }); }
          return (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                <Users size={14} className="text-violet-500" />
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Student & Parent Portal</h3>
              </div>

              <div className="flex items-center justify-between gap-4 bg-slate-50 rounded-xl px-4 py-3.5 border border-slate-200">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Show fee balance to students</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    When off, students cannot see their fee balance. Parents always see fees.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPC('studentCanSeeFees', !showFees)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none
                    ${showFees ? 'bg-violet-600' : 'bg-slate-200'}`}
                >
                  <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out
                    ${showFees ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              <div className="bg-slate-50 rounded-xl px-4 py-3.5 border border-slate-200 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700">Report card fee clearance threshold</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Minimum % of school fees that must be paid before a student or parent can view and download report cards.
                    Set to <strong>0</strong> to always allow access. Set to <strong>100</strong> to require full payment.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0} max={100} step={5}
                    value={threshold}
                    onChange={e => setPC('reportCardFeeThreshold', Number(e.target.value))}
                    className="flex-1 h-2 accent-violet-600"
                  />
                  <span className="w-14 text-center text-sm font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded-lg py-1">
                    {threshold}%
                  </span>
                </div>
                {threshold === 0 && (
                  <p className="text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                    Report cards are always accessible regardless of fee payment status.
                  </p>
                )}
                {threshold > 0 && threshold < 100 && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Students/parents must have cleared at least <strong>{threshold}%</strong> of fees to view report cards.
                  </p>
                )}
                {threshold === 100 && (
                  <p className="text-[11px] text-slate-600 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2">
                    Students/parents must be <strong>fully paid</strong> to view and download report cards.
                  </p>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* ── Row 5: Admission Numbers + M-Pesa ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <AdmissionNumbersSection form={f} set={set} />

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
      </div>

      {/* ── Sticky Save Bar ── */}
      <div className="sticky bottom-0 z-10 -mx-1 px-1 pt-3 pb-4 bg-gradient-to-t from-slate-50 via-slate-50/90 to-transparent">
        <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
          {form ? (
            <span className="text-xs text-amber-600 flex-1 font-medium">You have unsaved changes</span>
          ) : (
            <span className="text-xs text-slate-400 flex-1">All settings saved</span>
          )}
          {form && (
            <button type="button" onClick={() => setForm(null)} className="text-sm text-slate-500 hover:text-slate-700 transition">
              Discard
            </button>
          )}
          <button
            type="submit"
            disabled={isPending || !form}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition"
          >
            {isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>

      {/* Custom SMTP — separate save, outside the main form submit */}
      <SmtpCard school={school} onSaved={() => qc.invalidateQueries({ queryKey: ['settings','school'] })} />
    </form>
  );
}

/* ── SmtpCard — per-school custom SMTP configuration ────────────
   Rendered inside SchoolTab but has its own save/test/remove mutations.
   Password is never pre-filled — server returns smtpPassSaved:bool only.
   ──────────────────────────────────────────────────────────────── */
const PASS_PLACEHOLDER = '••••••••';

function SmtpCard({ school = {}, onSaved }) {
  const qc = useQueryClient();
  const PORTS = [
    { value: 587,  label: '587 — STARTTLS (recommended)' },
    { value: 465,  label: '465 — SSL/TLS' },
    { value: 25,   label: '25  — Plain (not recommended)' },
    { value: 2525, label: '2525 — Alternative' },
  ];

  const init = () => ({
    smtpEnabled:   school.smtpEnabled   ?? false,
    smtpHost:      school.smtpHost      ?? '',
    smtpPort:      school.smtpPort      ?? 587,
    smtpSecure:    school.smtpSecure    ?? false,
    smtpUser:      school.smtpUser      ?? '',
    smtpPass:      school.smtpPassSaved ? PASS_PLACEHOLDER : '',
    smtpFromName:  school.smtpFromName  ?? school.name ?? '',
    smtpFromEmail: school.smtpFromEmail ?? '',
    sendTo:        '',
  });

  const [f,        setF]        = useState(init);
  const [toast,    setToast]    = useState(null);
  const [testMsg,  setTestMsg]  = useState(null);  // { ok, text }

  /* Re-sync when school data reloads */
  const prevSchoolId = useRef(school.id);
  useEffect(() => {
    if (school.id !== prevSchoolId.current) {
      prevSchoolId.current = school.id;
      setF(init());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [school.id, school.smtpEnabled, school.smtpPassSaved]);

  function set(k, v) { setF(p => ({ ...p, [k]: v })); }

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => settingsApi.school.smtp.save({
      smtpEnabled:   f.smtpEnabled,
      smtpHost:      f.smtpHost,
      smtpPort:      f.smtpPort,
      smtpSecure:    f.smtpSecure,
      smtpUser:      f.smtpUser,
      smtpPass:      f.smtpPass === PASS_PLACEHOLDER ? '' : f.smtpPass,  // blank = keep existing
      smtpFromName:  f.smtpFromName,
      smtpFromEmail: f.smtpFromEmail,
    }),
    onSuccess: () => {
      onSaved?.();
      setToast({ ok: true, text: 'SMTP settings saved.' });
    },
    onError: err => setToast({ ok: false, text: err?.message ?? 'Failed to save.' }),
  });

  const { mutate: testConn, isPending: testing } = useMutation({
    mutationFn: () => settingsApi.school.smtp.test({
      smtpHost:      f.smtpHost,
      smtpPort:      f.smtpPort,
      smtpSecure:    f.smtpSecure,
      smtpUser:      f.smtpUser,
      smtpPass:      f.smtpPass,
      smtpFromEmail: f.smtpFromEmail,
      sendTo:        f.sendTo || f.smtpUser,
    }),
    onSuccess: res => setTestMsg({ ok: true,  text: res?.message ?? 'Test email sent.' }),
    onError:   err => setTestMsg({ ok: false, text: err?.message ?? 'Connection failed.' }),
  });

  const { mutate: remove, isPending: removing } = useMutation({
    mutationFn: () => settingsApi.school.smtp.remove(),
    onSuccess: () => {
      onSaved?.();
      setF(init());
      setToast({ ok: true, text: 'Custom SMTP removed. Emails will use the Msingi platform.' });
    },
    onError: err => setToast({ ok: false, text: err?.message ?? 'Failed to remove.' }),
  });

  const hasSavedConfig = !!(school.smtpHost && school.smtpUser && school.smtpPassSaved);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Mail size={14} className="text-slate-400" />
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Email & Custom SMTP</h3>
        </div>
        {hasSavedConfig && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
            <CheckCircle2 size={10} /> Custom SMTP active
          </span>
        )}
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity:0, y:-4 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
            className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg border ${toast.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}
          >
            {toast.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {toast.text}
            <button onClick={() => setToast(null)} className="ml-auto opacity-60 hover:opacity-100"><X size={11} /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Description */}
      <p className="text-xs text-slate-400 leading-relaxed">
        By default, Msingi sends all school emails from <span className="font-medium text-slate-600">innolearnnetwork@gmail.com</span> with your school name as the display name.
        Configure your own SMTP server to send from <span className="font-medium text-slate-600">noreply@yourschool.ke</span> or any address you control.
        Msingi always falls back to the platform sender if your SMTP is unreachable.
      </p>

      {/* Enable toggle */}
      <label className="flex items-center gap-3 cursor-pointer select-none">
        <button
          type="button"
          onClick={() => set('smtpEnabled', !f.smtpEnabled)}
          className={`relative w-9 h-5 rounded-full transition-colors ${f.smtpEnabled ? 'bg-violet-600' : 'bg-slate-200'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${f.smtpEnabled ? 'translate-x-4' : ''}`} />
        </button>
        <span className="text-sm font-medium text-slate-700">Use custom SMTP for school emails</span>
      </label>

      {/* Config fields — always visible so admin can pre-fill before enabling */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <FField label="From name">
            <input value={f.smtpFromName} onChange={e => set('smtpFromName', e.target.value)}
              className={iCls()} placeholder="e.g. Greenwood Academy" />
          </FField>
          <FField label="From email address">
            <input type="email" value={f.smtpFromEmail} onChange={e => set('smtpFromEmail', e.target.value)}
              className={iCls()} placeholder="noreply@yourschool.ke" />
          </FField>
        </div>

        <FField label="SMTP host">
          <input value={f.smtpHost} onChange={e => set('smtpHost', e.target.value)}
            className={iCls()} placeholder="smtp.gmail.com  or  mail.yourschool.ke" />
        </FField>

        <div className="grid grid-cols-2 gap-3">
          <FField label="Port">
            <select value={f.smtpPort} onChange={e => set('smtpPort', Number(e.target.value))} className={iCls()}>
              {PORTS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </FField>
          <FField label="Security">
            <select value={f.smtpSecure ? 'ssl' : 'starttls'}
              onChange={e => set('smtpSecure', e.target.value === 'ssl')} className={iCls()}>
              <option value="starttls">STARTTLS (port 587)</option>
              <option value="ssl">SSL/TLS (port 465)</option>
            </select>
          </FField>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FField label="SMTP username">
            <input value={f.smtpUser} onChange={e => set('smtpUser', e.target.value)}
              className={iCls()} placeholder="your@email.com" autoComplete="off" />
          </FField>
          <FField label={school.smtpPassSaved ? 'Password (saved — leave blank to keep)' : 'Password'}>
            <input type="password" value={f.smtpPass}
              onChange={e => set('smtpPass', e.target.value)}
              className={iCls()} placeholder={school.smtpPassSaved ? PASS_PLACEHOLDER : 'SMTP password or App Password'}
              autoComplete="new-password" />
          </FField>
        </div>
      </div>

      {/* Test connection */}
      <div className="pt-1 border-t border-slate-100 space-y-2">
        <div className="flex items-center gap-2">
          <FField label="Send test email to" className="flex-1 min-w-0">
            <input value={f.sendTo} onChange={e => set('sendTo', e.target.value)}
              type="email" className={iCls()} placeholder={f.smtpUser || 'admin@yourschool.ke'} />
          </FField>
          <div className="pt-5">
            <button
              type="button"
              onClick={() => { setTestMsg(null); testConn(); }}
              disabled={testing || !f.smtpHost || !f.smtpUser}
              className="flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100 disabled:opacity-40 transition"
            >
              {testing ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              {testing ? 'Testing…' : 'Test'}
            </button>
          </div>
        </div>
        <AnimatePresence>
          {testMsg && (
            <motion.p initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
              className={`text-xs px-3 py-2 rounded-lg border ${testMsg.ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}`}
            >
              {testMsg.ok ? '✅' : '❌'} {testMsg.text}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => save()}
          disabled={saving}
          className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save SMTP settings'}
        </button>
        {hasSavedConfig && (
          <button
            type="button"
            onClick={() => { if (window.confirm('Remove custom SMTP? Emails will revert to the Msingi platform sender.')) remove(); }}
            disabled={removing}
            className="flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700 px-3 py-2 rounded-lg hover:bg-red-50 transition"
          >
            {removing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   USERS TAB
   ══════════════════════════════════════════════════════════════ */
/* ── Canonical system role list ─────────────────────────────────
   Single source of truth — filter, invite form, and R&P all derive
   from this. `deputy` kept below as a legacy alias (backward compat)
   but does NOT appear in the UI — it is merged with deputy_principal.
   ─────────────────────────────────────────────────────────────── */
const SYSTEM_ROLES = [
  'superadmin', 'admin', 'deputy_principal', 'section_head', 'teacher',
  'exams_officer', 'timetabler', 'admissions_officer', 'finance', 'hr',
  'discipline_committee', 'parent', 'student',
];

// Roles that can never be deleted from the school (safety guard)
const PROTECTED_ROLES = new Set(['superadmin', 'admin']);

// User filter groups — derived so they always stay in sync with SYSTEM_ROLES
// 'All roles' sentinel first; the rest come from SYSTEM_ROLES
const USER_ROLE_GROUPS = [
  { value: '', label: 'All roles' },
  ...SYSTEM_ROLES.map(r => ({ value: r, label: SYSTEM_ROLE_LABELS[r] })),
];

function UsersTab() {
  const qc = useQueryClient();
  const can        = useAuthStore(s => s.can.bind(s));
  const sessionRole = useAuthStore(s => s.session?.user?.role ?? '');
  const canManage  = can('settings') || sessionRole === 'admin' || sessionRole === 'superadmin';
  const [showInvite, setShowInvite] = useState(false);
  const [toast, setToast] = useState(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [search, setSearch]         = useState('');
  const [resetPwdUser, setResetPwdUser] = useState(null);
  const [editingUserId, setEditingUserId] = useState(null);
  const [editNameVal,   setEditNameVal]   = useState('');
  const [editingRoleId, setEditingRoleId] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['settings', 'users'],
    queryFn:  () => settingsApi.users.list(),
    staleTime: 60_000,
  });
  const allUsers = data?.data ?? [];

  /* Fetch school doc — needed for hiddenSystemRoles */
  const { data: schoolData } = useQuery({
    queryKey: ['settings', 'school'],
    queryFn:  () => settingsApi.school.get(),
    staleTime: 60_000,
  });
  const hiddenSystemRoles = schoolData?.data?.hiddenSystemRoles ?? [];

  /* Fetch custom roles so filter + pills stay in sync */
  const { data: crData } = useQuery({
    queryKey: ['settings', 'custom-roles'],
    queryFn:  () => settingsApi.customRoles.list(),
    staleTime: 60_000,
  });
  const customRoles = crData?.data ?? [];

  /* Merge built-in role groups + custom roles for the filter dropdown */
  const roleGroups = [
    ...USER_ROLE_GROUPS,
    ...customRoles.map(cr => ({ value: cr.key, label: cr.label })),
  ];

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

  const { mutate: saveName, isPending: savingName } = useMutation({
    mutationFn: ({ id, name }) => settingsApi.users.update(id, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'users'] });
      setEditingUserId(null);
      setToast({ msg: 'Name updated.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to update name.', type: 'error' }),
  });

  const { mutate: saveRole, isPending: savingRole } = useMutation({
    mutationFn: ({ id, role }) => settingsApi.users.update(id, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'users'] });
      setEditingRoleId(null);
      setToast({ msg: 'Role updated. User session revoked — they must log in again.', type: 'success' });
    },
    onError: err => {
      setEditingRoleId(null);
      setToast({ msg: err?.message ?? 'Failed to update role.', type: 'error' });
    },
  });

  // Roles available to assign — excludes superadmin (only platform-level)
  const assignableRoles = [
    ...SYSTEM_ROLES.filter(r => r !== 'superadmin').map(r => ({ value: r, label: SYSTEM_ROLE_LABELS[r] ?? r })),
    ...customRoles.map(cr => ({ value: cr.key, label: cr.label })),
  ];

  function confirmRemove(u) {
    if (!window.confirm(`Remove ${u.name ?? u.email} from this school? They will lose access immediately.`)) return;
    removeUser(u.id ?? u._id);
  }

  function startEditName(u) {
    setEditingUserId(u.id ?? u._id);
    setEditNameVal(u.name ?? '');
  }

  function commitNameEdit(u) {
    const trimmed = editNameVal.trim();
    if (!trimmed || trimmed === u.name) { setEditingUserId(null); return; }
    saveName({ id: u.id ?? u._id, name: trimmed });
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
            {roleGroups.map(g => (
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
              {users.map(u => {
                const uid       = u.id ?? u._id;
                const isEditing = editingUserId === uid;
                return (
                  <tr key={u._id ?? u.id} className="hover:bg-slate-50 transition group">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={editNameVal}
                            onChange={e => setEditNameVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') commitNameEdit(u);
                              if (e.key === 'Escape') setEditingUserId(null);
                            }}
                            className="flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400/40"
                          />
                          <button
                            onClick={() => commitNameEdit(u)}
                            disabled={savingName}
                            className="p-1 text-emerald-500 hover:bg-emerald-50 rounded transition"
                            title="Save name"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            onClick={() => setEditingUserId(null)}
                            className="p-1 text-slate-400 hover:bg-slate-100 rounded transition"
                            title="Cancel"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      ) : (
                        <span className="cursor-default">{u.name ?? '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs hidden sm:table-cell">{u.email}</td>
                    <td className="px-4 py-3">
                      {canManage && editingRoleId === uid ? (
                        <select
                          autoFocus
                          defaultValue={u.role}
                          disabled={savingRole}
                          onChange={e => {
                            const newRole = e.target.value;
                            if (newRole !== u.role) saveRole({ id: uid, role: newRole });
                            else setEditingRoleId(null);
                          }}
                          onBlur={() => setEditingRoleId(null)}
                          className="rounded border border-violet-300 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-violet-400/40"
                        >
                          {assignableRoles.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      ) : (
                        <button
                          onClick={() => canManage && !PROTECTED_ROLES.has(u.role) && setEditingRoleId(uid)}
                          className={canManage && !PROTECTED_ROLES.has(u.role) ? 'cursor-pointer hover:opacity-80 transition' : 'cursor-default'}
                          title={canManage && !PROTECTED_ROLES.has(u.role) ? 'Click to change role' : undefined}
                        >
                          <RolePill role={u.role} customRoles={customRoles} />
                        </button>
                      )}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition">
                          <button
                            onClick={() => startEditName(u)}
                            className="p-1.5 text-slate-300 hover:text-violet-500 hover:bg-violet-50 rounded-lg transition"
                            title="Edit name"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => setResetPwdUser(u)}
                            className="p-1.5 text-slate-300 hover:text-amber-500 hover:bg-amber-50 rounded-lg transition"
                            title="Set password"
                          >
                            <KeyRound size={13} />
                          </button>
                          <button
                            onClick={() => confirmRemove(u)}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition"
                            title="Remove user"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Invite slide-over */}
      <AnimatePresence>
        {showInvite && (
          <InviteSlideOver
            customRoles={customRoles}
            hiddenSystemRoles={hiddenSystemRoles}
            onClose={() => setShowInvite(false)}
            onInvited={() => {
              setShowInvite(false);
              qc.invalidateQueries({ queryKey: ['settings', 'users'] });
              setToast({ msg: 'Invitation sent.', type: 'success' });
            }}
          />
        )}
      </AnimatePresence>

      {/* Reset password modal */}
      <AnimatePresence>
        {resetPwdUser && (
          <ResetPasswordModal user={resetPwdUser} onClose={() => setResetPwdUser(null)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function InviteSlideOver({ customRoles = [], hiddenSystemRoles = [], onClose, onInvited }) {
  const [email, setEmail] = useState('');
  const [role,  setRole]  = useState('teacher');
  const [name,  setName]  = useState('');
  const [errors, setErrors] = useState({});

  const { mutate, isPending } = useMutation({
    mutationFn: () => settingsApi.users.invite({ email, role, name }),
    onSuccess:  () => onInvited(),
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
              {/* System roles: exclude superadmin (can't be invited) and school-hidden roles */}
              {SYSTEM_ROLES
                .filter(r => r !== 'superadmin' && !hiddenSystemRoles.includes(r))
                .map(r => (
                  <option key={r} value={r}>{SYSTEM_ROLE_LABELS[r] ?? r}</option>
                ))
              }
              {customRoles.length > 0 && (
                <optgroup label="── Custom Roles ──">
                  {customRoles.map(cr => (
                    <option key={cr.key} value={cr.key}>{cr.label}</option>
                  ))}
                </optgroup>
              )}
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
   ACADEMIC YEARS SECTION
   Full academic year lifecycle manager embedded in the School tab.
   Lists all years with status badges, allows creating draft years,
   editing term dates, and transitioning to a new active year.
   ══════════════════════════════════════════════════════════════ */
const STATUS_META = {
  active: { label: 'Active',  cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  draft:  { label: 'Draft',   cls: 'bg-slate-50  text-slate-500  ring-1 ring-slate-200'  },
  locked: { label: 'Locked',  cls: 'bg-amber-50  text-amber-700  ring-1 ring-amber-200'  },
};

function YearStatusBadge({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.cls}`}>
      {status === 'active' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
      {status === 'locked' && <Lock size={9} />}
      {m.label}
    </span>
  );
}

function AcademicYearsSection({ schoolId }) {
  const patchSchool = useAuthStore(s => s.patchSchool);
  const qc = useQueryClient();
  const [toast, setToast]             = useState(null);
  const [showNew, setShowNew]         = useState(false);
  const [editingId, setEditingId]     = useState(null);   // yearId being edited
  const [transitioning, setTransitioning] = useState(false); // confirm dialog

  // ── New year form state ──────────────────────────────────────
  const [newName, setNewName]         = useState('');
  const [newStart, setNewStart]       = useState('');
  const [newEnd, setNewEnd]           = useState('');
  const [newTermCount, setNewTermCount] = useState(3);

  // ── Transition confirmation ──────────────────────────────────
  const [transTarget, setTransTarget] = useState(null); // year object
  const [transReason, setTransReason] = useState('');

  const { data: years = [], isLoading, error } = useQuery({
    queryKey: ['academic-years'],
    queryFn:  () => academicConfigApi.years.list().then(r => r.data ?? r),
    staleTime: 30_000,
  });

  const activeYear = years.find(y => y.status === 'active');
  const draftYears = years.filter(y => y.status === 'draft');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['academic-years'] });

  // ── Create ──────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: (data) => academicConfigApi.years.create(data),
    onSuccess: () => {
      invalidate(); setShowNew(false); setNewName(''); setNewStart(''); setNewEnd(''); setNewTermCount(3);
      setToast({ msg: 'Academic year created.', type: 'success' });
    },
    onError: (err) => setToast({ msg: err?.message ?? 'Failed to create academic year.', type: 'error' }),
  });

  function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim() || !newStart || !newEnd) return;
    const terms = Array.from({ length: newTermCount }, (_, i) => ({
      term: i + 1, label: `Term ${i + 1}`, startDate: '', endDate: '',
    }));
    createMut.mutate({ name: newName.trim(), startDate: newStart, endDate: newEnd, terms });
  }

  // ── Delete ──────────────────────────────────────────────────
  const deleteMut = useMutation({
    mutationFn: (id) => academicConfigApi.years.remove(id),
    onSuccess: () => { invalidate(); setToast({ msg: 'Academic year deleted.', type: 'success' }); },
    onError: (err) => setToast({ msg: err?.message ?? 'Failed to delete academic year.', type: 'error' }),
  });

  // ── Inline term-date edit ────────────────────────────────────
  const [editTerms, setEditTerms] = useState({});  // yearId → terms[]
  const [savingTerms, setSavingTerms] = useState(null);

  function startEdit(year) {
    const yid = year.id || year._id;
    setEditingId(yid);
    // Normalise terms — assign term number + default label for any legacy docs
    // that are missing these fields so the editor always has valid data to work with
    const normalised = (year.terms ?? []).map((t, idx) => ({
      term:      t.term      ?? (idx + 1),
      label:     t.label     || `Term ${t.term ?? (idx + 1)}`,
      startDate: t.startDate ?? '',
      endDate:   t.endDate   ?? '',
    }));
    setEditTerms(prev => ({ ...prev, [yid]: normalised }));
  }
  function cancelEdit() { setEditingId(null); }

  async function saveTerms(year) {
    const yid = year.id || year._id;
    setSavingTerms(yid);
    try {
      await academicConfigApi.years.update(yid, { terms: editTerms[yid] ?? [] });
      invalidate();
      setEditingId(null);
      setToast({ msg: 'Term dates saved.', type: 'success' });
    } catch (err) {
      setToast({ msg: err?.message ?? 'Failed to save term dates.', type: 'error' });
    } finally { setSavingTerms(null); }
  }

  function updateTermDate(yid, termNum, field, val) {
    setEditTerms(prev => {
      const terms = (prev[yid] ?? []).map(t =>
        t.term === termNum ? { ...t, [field]: val } : t
      );
      return { ...prev, [yid]: terms };
    });
  }

  // ── Transition ───────────────────────────────────────────────
  const transMut = useMutation({
    mutationFn: (data) => academicConfigApi.transition(data),
    onSuccess: (res) => {
      // Keep the auth-store session in sync so every module that reads
      // session.school.academicYear (Lessons subtitle, StudentDashboard,
      // FeeStructureSlideOver default year, etc.) reflects the new year
      // immediately — without requiring a logout/login.
      const newYearName = res?.data?.activatedYear?.name;
      if (newYearName) patchSchool({ academicYear: newYearName });
      invalidate();
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['school'] });
      setTransitioning(false);
      setTransTarget(null);
      setTransReason('');
      setToast({ msg: `Switched to ${newYearName ?? 'new academic year'} — all modules updated.`, type: 'success' });
    },
    onError: (err) => setToast({ msg: err?.message ?? 'Year transition failed.', type: 'error' }),
  });

  if (isLoading) return (
    <div className="py-6 flex items-center justify-center gap-2 text-slate-400 text-sm">
      <Loader2 size={16} className="animate-spin" /> Loading academic years…
    </div>
  );

  if (error) return (
    <div className="py-4 flex items-center gap-2 text-red-500 text-sm">
      <AlertCircle size={14} /> Failed to load academic years
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ── Feedback toast ──────────────────────────────────── */}
      <AnimatePresence>
        {toast && <Toast msg={toast.msg} type={toast.type} onDismiss={() => setToast(null)} />}
      </AnimatePresence>

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarDays size={14} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Academic Years</span>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(v => !v)}
          className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-2.5 py-1 rounded-md transition"
        >
          <PlusCircle size={13} />
          New year
        </button>
      </div>

      {/* ── Create new year form ────────────────────────────── */}
      <AnimatePresence>
        {showNew && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <form
              onSubmit={handleCreate}
              className="border border-indigo-100 rounded-xl bg-indigo-50/40 p-4 space-y-3"
            >
              <p className="text-xs font-semibold text-indigo-700">New Academic Year</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-3 sm:col-span-1">
                  <label className="block text-[10px] text-slate-500 mb-1">Year name *</label>
                  <input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. 2026-2027"
                    required
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Start date *</label>
                  <input type="date" value={newStart} onChange={e => setNewStart(e.target.value)} required
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">End date *</label>
                  <input type="date" value={newEnd} onChange={e => setNewEnd(e.target.value)} required
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Terms per year</label>
                  <select value={newTermCount} onChange={e => setNewTermCount(Number(e.target.value))}
                    className="w-full text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value={2}>2 terms</option>
                    <option value={3}>3 terms</option>
                    <option value={4}>4 terms</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={createMut.isPending}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
                  {createMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  Create draft year
                </button>
                <button type="button" onClick={() => setShowNew(false)}
                  className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg transition">
                  Cancel
                </button>
              </div>
              {createMut.isError && (
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle size={11} /> {createMut.error?.response?.data?.message ?? 'Failed to create year'}
                </p>
              )}
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Year list ───────────────────────────────────────── */}
      {years.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">
          No academic years yet — click <strong>New year</strong> to add one.
        </div>
      ) : (
        <div className="space-y-2">
          {[...years].sort((a, b) => {
            const ord = { active: 0, draft: 1, locked: 2 };
            return (ord[a.status] ?? 3) - (ord[b.status] ?? 3) || a.name.localeCompare(b.name);
          }).map(year => {
            const yid     = year.id || year._id;
            const isEditing = editingId === yid;
            const terms   = isEditing ? (editTerms[yid] ?? []) : (year.terms ?? []);
            const isLocked = year.status === 'locked';

            return (
              <div key={yid} className={`rounded-xl border transition ${
                year.status === 'active' ? 'border-emerald-200 bg-emerald-50/30' :
                year.status === 'locked' ? 'border-amber-100 bg-amber-50/20' :
                'border-slate-200 bg-white'
              }`}>
                {/* Year header row */}
                <div className="flex items-center gap-3 px-4 py-2.5">
                  <CalendarDays size={13} className={
                    year.status === 'active' ? 'text-emerald-500' :
                    year.status === 'locked' ? 'text-amber-500' : 'text-slate-400'
                  } />
                  <span className="text-sm font-semibold text-slate-800 flex-1">{year.name}</span>
                  <YearStatusBadge status={year.status} />
                  {!isLocked && (
                    <button type="button"
                      onClick={() => isEditing ? cancelEdit() : startEdit(year)}
                      className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition"
                      title={isEditing ? 'Cancel editing' : 'Edit term dates'}>
                      {isEditing ? <X size={13} /> : <Pencil size={13} />}
                    </button>
                  )}
                  {year.status === 'draft' && (
                    <button type="button"
                      onClick={() => { if (window.confirm(`Delete draft year "${year.name}"? This cannot be undone.`)) deleteMut.mutate(yid); }}
                      disabled={deleteMut.isPending}
                      className="p-1 rounded hover:bg-red-50 text-slate-300 hover:text-red-500 transition"
                      title="Delete draft year">
                      <Trash2 size={13} />
                    </button>
                  )}
                  {year.status === 'locked' && (
                    <span title="Permanently locked — part of the academic record" className="p-1 text-amber-300">
                      <Lock size={13} />
                    </span>
                  )}
                </div>

                {/* Term dates — always show; editable when not locked */}
                {terms.length > 0 && (
                  <div className="px-4 pb-3 space-y-1.5 border-t border-slate-100">
                    {isEditing && (
                      <p className="pt-2 text-[10px] text-slate-400">Edit term names, start and end dates — these appear on report cards and invoices.</p>
                    )}
                    <div className={isEditing ? 'pt-1 space-y-3' : 'pt-2 space-y-1.5'}>
                      {terms.map((t, idx) => {
                        const termNum = t.term ?? (idx + 1);
                        const fallbackLabel = `Term ${termNum}`;
                        const editRow = editTerms[yid]?.find(x => (x.term ?? -1) === termNum) ?? editTerms[yid]?.[idx];
                        return (
                        <div key={t.term ?? idx}>
                          {isEditing ? (
                            /* ── Edit mode: name input + date pickers ── */
                            <div className="space-y-1">
                              <div>
                                <label className="block text-[9px] text-slate-400 mb-0.5">Term name</label>
                                <input
                                  value={editRow?.label ?? t.label ?? fallbackLabel}
                                  onChange={e => updateTermDate(yid, termNum, 'label', e.target.value)}
                                  placeholder={fallbackLabel}
                                  className="w-full text-xs font-semibold border border-indigo-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-indigo-50/40"
                                />
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[9px] text-slate-400 mb-0.5">Start date</label>
                                  <input type="date" value={editRow?.startDate ?? t.startDate ?? ''}
                                    onChange={e => updateTermDate(yid, termNum, 'startDate', e.target.value)}
                                    className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                                </div>
                                <div>
                                  <label className="block text-[9px] text-slate-400 mb-0.5">End date</label>
                                  <input type="date" value={editRow?.endDate ?? t.endDate ?? ''}
                                    onChange={e => updateTermDate(yid, termNum, 'endDate', e.target.value)}
                                    className="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-400" />
                                </div>
                              </div>
                            </div>
                          ) : (
                            /* ── View mode ── */
                            <div className="grid grid-cols-[100px_1fr_1fr] gap-2 items-center">
                              <span className="text-[11px] font-semibold text-slate-600">{t.label || fallbackLabel}</span>
                              <span className="text-xs text-slate-500">{t.startDate || <span className="text-slate-300 italic">not set</span>}</span>
                              <span className="text-xs text-slate-500">{t.endDate   || <span className="text-slate-300 italic">not set</span>}</span>
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>
                    {isEditing && (
                      <div className="flex gap-2 pt-1">
                        <button type="button"
                          onClick={() => saveTerms(year)}
                          disabled={savingTerms === yid}
                          className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition">
                          {savingTerms === yid ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                          Save terms
                        </button>
                        <button type="button" onClick={cancelEdit}
                          className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 rounded-lg transition">
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Activate button for draft years */}
                {year.status === 'draft' && (
                  <div className="px-4 pb-3">
                    <button
                      type="button"
                      onClick={() => { setTransTarget(year); setTransitioning(true); }}
                      className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-200 transition"
                    >
                      <ChevronRight size={12} />
                      Start this academic year
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Transition confirmation dialog ──────────────────── */}
      <AnimatePresence>
        {transitioning && transTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-50">
                  <Archive size={20} className="text-amber-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">Start New Academic Year</h3>
                  <p className="text-xs text-slate-500 mt-0.5">This action is permanent and cannot be reversed.</p>
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                {activeYear ? (
                  <div className="flex items-start gap-2 text-slate-600">
                    <Lock size={14} className="mt-0.5 text-amber-500 shrink-0" />
                    <span>
                      <strong>{activeYear.name}</strong> will be <strong>permanently locked</strong>.
                      All grades, exams and report cards for this year will be frozen.
                    </span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2 text-slate-500">
                    <Info size={14} className="mt-0.5 shrink-0" />
                    <span>There is no currently active year — only the new year will be activated.</span>
                  </div>
                )}
                <div className="flex items-start gap-2 text-slate-600">
                  <CheckCircle2 size={14} className="mt-0.5 text-emerald-500 shrink-0" />
                  <span>
                    <strong>{transTarget.name}</strong> will become the active academic year.
                    Term dates will be synced school-wide.
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Reason (optional)</label>
                <input
                  value={transReason}
                  onChange={e => setTransReason(e.target.value)}
                  placeholder="e.g. End of 2025/2026 academic year"
                  className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>

              {transMut.isError && (
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertCircle size={11} />
                  {transMut.error?.response?.data?.message ?? 'Transition failed — please try again'}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => transMut.mutate({ targetYearId: transTarget.id || transTarget._id, reason: transReason || undefined })}
                  disabled={transMut.isPending}
                  className="flex-1 flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition"
                >
                  {transMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
                  {activeYear ? 'Lock current & activate new year' : 'Activate year'}
                </button>
                <button
                  type="button"
                  onClick={() => { setTransitioning(false); setTransTarget(null); setTransReason(''); transMut.reset(); }}
                  className="px-4 py-2.5 text-sm font-medium text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SET PASSWORD MODAL
   Admin sets a usable password for the user.  They can use it
   immediately — no forced change on login.  The platform's
   90-day rotation policy handles scheduled expiry.
   ══════════════════════════════════════════════════════════════ */
function ResetPasswordModal({ user, onClose }) {
  const [result,     setResult]     = useState(null);
  const [copied,     setCopied]     = useState(false);
  const [errMsg,     setErrMsg]     = useState('');
  const [customPwd,  setCustomPwd]  = useState('');
  const [showPwd,    setShowPwd]    = useState(false);

  const { mutate, isPending } = useMutation({
    mutationFn: () => settingsApi.users.resetPassword(
      user.id ?? user._id,
      customPwd.trim() ? { password: customPwd.trim() } : {}
    ),
    onSuccess: res  => setResult(res?.data),
    onError:   err  => setErrMsg(err?.message ?? 'Failed to set password.'),
  });

  function copyPwd() {
    navigator.clipboard.writeText(result.password).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50"
        onClick={!result ? onClose : undefined}
      />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1,    opacity: 1 }}
        exit={{ scale: 0.95,    opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden"
      >
        {!result ? (
          /* ── Form ── */
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <KeyRound size={18} className="text-amber-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Set Password</h2>
                <p className="text-xs text-slate-500">{user.name ?? user.email}</p>
              </div>
            </div>

            <p className="text-sm text-slate-600">
              Set a new password for <strong>{user.name ?? user.email}</strong>. They can use it immediately — no forced change on login.
            </p>

            {/* Optional custom password */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Password <span className="text-slate-400 font-normal">(leave blank to auto-generate)</span>
              </label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={customPwd}
                  onChange={e => { setCustomPwd(e.target.value); setErrMsg(''); }}
                  placeholder="Type a password, or leave blank"
                  minLength={8}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {customPwd && customPwd.length < 8 && (
                <p className="text-xs text-amber-600 mt-1">Must be at least 8 characters</p>
              )}
            </div>

            <p className="text-xs text-slate-500">
              An email with the new password will be sent to{' '}
              <span className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">{user.email}</span>
              {' '}— keep this dialog open in case the email doesn&apos;t arrive.
            </p>

            {errMsg && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{errMsg}</p>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition">
                Cancel
              </button>
              <button
                onClick={() => mutate()}
                disabled={isPending || (customPwd.length > 0 && customPwd.length < 8)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg transition"
              >
                {isPending && <Loader2 size={13} className="animate-spin" />}
                {isPending ? 'Saving…' : 'Set Password'}
              </button>
            </div>
          </div>
        ) : (
          /* ── Result ── */
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                <CheckCircle2 size={18} className="text-green-600" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">Password Set</h2>
                <p className="text-xs text-slate-500">{result.name} · {result.email}</p>
              </div>
            </div>

            <p className="text-sm text-slate-600">Share this password securely with the user. They can log in with it immediately.</p>

            <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
              <code className="flex-1 text-lg font-bold tracking-widest text-violet-700 font-mono break-all">
                {result.password}
              </code>
              <button
                onClick={copyPwd}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-2.5 py-1.5 hover:bg-white transition shrink-0"
              >
                {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>

            <div className={`rounded-lg px-3 py-2.5 text-xs flex items-start gap-2 ${result.emailSent ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
              {result.emailSent ? (
                <><CheckCircle2 size={13} className="shrink-0 mt-0.5" /> Email with the new password sent to {result.email}.</>
              ) : (
                <><AlertTriangle size={13} className="shrink-0 mt-0.5" /> Email could not be sent — share this password directly with {result.name}.</>
              )}
            </div>

            <p className="text-[11px] text-slate-400">This password will not be shown again after you close this dialog.</p>

            <div className="flex justify-end pt-1">
              <button onClick={onClose} className="px-5 py-2 text-sm font-medium bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition">
                Done
              </button>
            </div>
          </div>
        )}
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

  const { data: crData } = useQuery({
    queryKey: ['settings', 'custom-roles'],
    queryFn:  () => settingsApi.customRoles.list(),
    staleTime: 120_000,
  });
  const customRoles = crData?.data ?? [];

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
          <RolePill role={user?.role} customRoles={customRoles} />
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
   CREATE CUSTOM ROLE MODAL
   ══════════════════════════════════════════════════════════════ */
function CreateCustomRoleModal({ onClose, onCreated }) {
  const [label,    setLabel]    = useState('');
  const [color,    setColor]    = useState('#6366f1');
  const [baseRole, setBaseRole] = useState('teacher');
  const [error,    setError]    = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: () => settingsApi.customRoles.create({ label: label.trim(), color, baseRole }),
    onSuccess:  d  => onCreated(d?.data),
    onError:    err => setError(err?.message ?? 'Failed to create role.'),
  });

  const key = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">Create Custom Role</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg flex items-center gap-2">
            <AlertTriangle size={13} />{error}
          </div>
        )}

        <FField label="Role name">
          <input
            value={label} onChange={e => setLabel(e.target.value)}
            placeholder="e.g. Office Admin, Admission Officer"
            className={iCls()} autoFocus
          />
        </FField>

        {key && (
          <p className="text-[11px] text-slate-400 -mt-1">
            Role key: <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-mono">{key}</code>
          </p>
        )}

        <FField label="Start permissions from">
          <select value={baseRole} onChange={e => setBaseRole(e.target.value)} className={iCls()}>
            <option value="teacher">Teacher — limited access (recommended)</option>
            <option value="deputy">Deputy — moderate access</option>
            <option value="admin">Admin — full access</option>
          </select>
        </FField>

        <FField label="Role colour">
          <div className="flex items-center gap-3">
            <input type="color" value={color} onChange={e => setColor(e.target.value)}
              className="w-9 h-9 rounded-lg cursor-pointer border border-slate-200 p-0.5 shrink-0" />
            <span className="text-xs text-slate-500 flex-1">
              Shown as a badge in the Roles tab and when assigning access.
            </span>
          </div>
        </FField>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">
            Cancel
          </button>
          <button
            onClick={() => mutate()}
            disabled={isPending || !label.trim()}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-sm font-semibold transition"
          >
            {isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
            {isPending ? 'Creating…' : 'Create Role'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   EDIT CUSTOM ROLE MODAL
   ══════════════════════════════════════════════════════════════ */
function EditCustomRoleModal({ role, onClose, onSaved }) {
  const [label, setLabel] = useState(role.label);
  const [color, setColor] = useState(role.color ?? '#6366f1');
  const [error, setError] = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: () => settingsApi.customRoles.update(role.key, { label: label.trim(), color }),
    onSuccess:  d  => onSaved(d?.data),
    onError:    err => setError(err?.message ?? 'Failed to update role.'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">Edit Role</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition">
            <X size={16} />
          </button>
        </div>

        <p className="text-[11px] text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
          Key: <code className="font-mono text-slate-600">{role.key}</code>
          {' '}— permanent. Renaming the label updates the display everywhere without affecting
          users already assigned this role.
        </p>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg flex items-center gap-2">
            <AlertTriangle size={13} />{error}
          </div>
        )}

        <FField label="Display name">
          <input value={label} onChange={e => setLabel(e.target.value)} className={iCls()} autoFocus />
        </FField>

        <FField label="Role colour">
          <div className="flex items-center gap-3">
            <input type="color" value={color} onChange={e => setColor(e.target.value)}
              className="w-9 h-9 rounded-lg cursor-pointer border border-slate-200 p-0.5 shrink-0" />
            <span className="text-xs text-slate-500 flex-1">Shown as the role badge throughout the platform.</span>
          </div>
        </FField>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition">
            Cancel
          </button>
          <button onClick={() => mutate()} disabled={isPending || !label.trim()}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white text-sm font-semibold transition">
            {isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            {isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
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
  { key: 'analytics',  label: 'Analytics Dashboard', subs: [
    { key: 'view', label: 'View Leadership Analytics' },
  ]},
  { key: 'settings',   label: 'Settings', subs: [
    { key: 'school',      label: 'Edit School Settings' },
    { key: 'users',       label: 'Manage Users / Invites' },
    { key: 'permissions', label: 'Manage Roles & Permissions' },
    { key: 'system',      label: 'View System Info' },
  ]},
];

function _makeDefaultPerms() {
  const T = { v:true,  e:true,  d:true  };
  const V = { v:true,  e:false, d:false };
  const E = { v:true,  e:true,  d:false };
  const N = { v:false, e:false, d:false };
  const DEFS = {
    superadmin: ()      => T,
    admin:      ()      => T,

    /* deputy_principal — canonical key; deputy kept as alias below */
    deputy_principal: (m, s) => {
      if (m==='finance'    && ['void_invoice','record_payment','payroll_view','payroll_export','mpesa'].includes(s)) return N;
      if (m==='finance'    && s==='fee_structure') return E;
      if (m==='hr'         && ['payroll_view','payroll_export','documents'].includes(s)) return N;
      if (m==='settings'   && s==='permissions') return N;
      if (m==='analytics') return V;
      return E;
    },
    deputy: (m, s) => DEFS.deputy_principal(m, s),  // legacy alias

    section_head: (m, s) => {
      if (['finance','hr','admissions'].includes(m)) return N;
      if (m==='settings') return N;
      if (m==='analytics') return V;
      if (m==='timetable' && ['rooms','bell_schedule','assignments'].includes(s)) return V;
      if (m==='behaviour' && ['delete'].includes(s)) return N;
      if (m==='growth_profile' && ['delete_records','aspirations'].includes(s)) return N;
      if (s==='import') return N;
      return E;
    },

    teacher: (m, s) => {
      if (['finance','admissions','hr','settings'].includes(m)) return N;
      if (m==='attendance') return s==='edit' ? N : s==='export' ? V : E;
      if (m==='grades')     return ['enter_marks','create_exam'].includes(s) ? E : V;
      if (m==='behaviour')  return s==='create' ? E : V;
      if (m==='messages')   return s==='delete' ? N : E;
      if (m==='growth_profile') {
        if (['delete_records','aspirations'].includes(s)) return N;
        if (s==='verify') return E;
        return E;
      }
      if (s==='import') return N;
      if (m==='classes'   && ['section','delete'].includes(s)) return N;
      if (m==='timetable' && ['rooms','bell_schedule','assignments'].includes(s)) return V;
      return V;
    },

    exams_officer: (m, s) => {
      if (['finance','hr','admissions'].includes(m)) return N;
      if (m==='settings') return N;
      if (m==='grades')   return T;
      if (m==='students') return V;
      if (m==='classes')  return V;
      if (m==='subjects') return V;
      if (m==='reports')  return E;
      if (m==='growth_profile') return V;
      return N;
    },

    timetabler: (m, s) => {
      if (['finance','hr','admissions'].includes(m)) return N;
      if (m==='settings') return N;
      if (m==='timetable') return T;
      if (m==='subjects')  return V;
      if (m==='classes')   return V;
      if (m==='students')  return V;
      return N;
    },

    admissions_officer: (m, s) => {
      if (['finance','hr'].includes(m)) return N;
      if (m==='settings') return N;
      if (m==='admissions') return T;
      if (m==='students')   return E;
      if (m==='classes')    return V;
      if (m==='events')     return V;
      if (m==='messages')   return s==='delete' ? N : E;
      return N;
    },

    finance: (m, s) => {
      if (m==='hr' && ['payroll_view','payroll_export','documents'].includes(s)) return N;
      if (m==='settings') return N;
      if (m==='finance')  return T;
      if (m==='students') return V;
      if (m==='reports')  return V;
      return N;
    },

    hr: (m, s) => {
      if (m==='settings') return N;
      if (m==='finance' && !['fee_structure'].includes(s)) return N;
      if (m==='hr')      return T;
      if (m==='students') return V;
      if (m==='reports')  return V;
      return N;
    },

    discipline_committee: (m, s) => {
      if (['finance','hr','admissions'].includes(m)) return N;
      if (m==='settings') return N;
      if (m==='behaviour') return T;
      if (m==='students')  return V;
      if (m==='classes')   return V;
      if (m==='attendance') return V;
      if (m==='messages')  return s==='delete' ? N : E;
      if (m==='growth_profile') return V;
      return N;
    },

    parent: (m, s) => {
      if (!['students','finance','attendance','grades','behaviour','events','messages','growth_profile'].includes(m)) return N;
      if (m==='finance' && ['fee_structure','mpesa','import','create_invoice','void_invoice','record_payment'].includes(s)) return N;
      if (m==='growth_profile' && s !== 'view') return N;
      return V;
    },

    student: (m, s) => {
      if (['students','timetable','grades','events'].includes(m)) return V;
      if (m==='growth_profile') {
        if (s==='view') return V;
        if (s==='aspirations') return E;
        return N;
      }
      return N;
    },
  };
  const perms = { byRole:{}, byUser:{} };
  /* Iterate all system roles + the legacy 'deputy' alias */
  [...SYSTEM_ROLES, 'deputy'].forEach(role => {
    if (!DEFS[role]) return;   // skip any unknown key
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

  const [mode,           setMode]           = useState('role');   // 'role' | 'user'
  const [selRole,        setSelRole]        = useState('admin');
  const [selUser,        setSelUser]        = useState(null);
  const [expanded,       setExpanded]       = useState({});
  const [perms,          setPerms]          = useState(null);
  const [dirty,          setDirty]          = useState(false);
  const [toast,          setToast]          = useState(null);
  const _autoSynced = useRef(false);
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [editingRole,    setEditingRole]    = useState(null);   // null | custom_role doc

  /* Load school data (holds saved modulePermissions) */
  const { data: schoolData } = useQuery({
    queryKey: ['settings','school'],
    queryFn:  () => settingsApi.school.get(),
    staleTime: 30_000,
  });

  /* Load custom roles */
  const { data: customRolesData } = useQuery({
    queryKey: ['settings','custom-roles'],
    queryFn:  () => settingsApi.customRoles.list(),
    staleTime: 30_000,
  });
  const customRoles = customRolesData?.data ?? [];

  /* Delete custom role mutation */
  const { mutate: deleteCustomRole } = useMutation({
    mutationFn: key => settingsApi.customRoles.remove(key),
    onSuccess: (_, key) => {
      qc.invalidateQueries({ queryKey: ['settings','custom-roles'] });
      qc.invalidateQueries({ queryKey: ['settings','school'] });
      if (selRole === key) setSelRole('admin');
      setToast({ msg: 'Custom role deleted.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Delete failed.', type: 'error' }),
  });

  function confirmDeleteRole(key, label) {
    if (!window.confirm(`Delete the "${label}" role? Users assigned this role will lose access until reassigned.`)) return;
    deleteCustomRole(key);
  }

  /* Hidden system roles — read from school doc */
  const hiddenSystemRoles = schoolData?.data?.hiddenSystemRoles ?? [];

  /* Hide a system role (non-destructive — just adds to hiddenSystemRoles list) */
  const { mutate: hideRoleMutate } = useMutation({
    mutationFn: (roleKey) => settingsApi.school.update({
      hiddenSystemRoles: [...new Set([...hiddenSystemRoles, roleKey])],
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings','school'] });
      setToast({ msg: 'Role hidden from the invite form.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to hide role.', type: 'error' }),
  });

  /* Restore a hidden system role */
  const { mutate: restoreRoleMutate } = useMutation({
    mutationFn: (roleKey) => settingsApi.school.update({
      hiddenSystemRoles: hiddenSystemRoles.filter(r => r !== roleKey),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings','school'] });
      setToast({ msg: 'Role restored.', type: 'success' });
    },
    onError: err => setToast({ msg: err?.message ?? 'Failed to restore role.', type: 'error' }),
  });

  function confirmHideRole(roleKey) {
    const label = SYSTEM_ROLE_LABELS[roleKey] ?? roleKey;
    if (!window.confirm(`Hide the "${label}" role? It will no longer appear in the invite form. Existing users keep their access.`)) return;
    hideRoleMutate(roleKey);
  }

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
    const computed = saved ? _mergePerms(_makeDefaultPerms(), saved) : _makeDefaultPerms();
    setPerms(computed);
    // First-load background sync: write computed defaults to role_permissions so that the
    // RBAC middleware matches exactly what this UI shows — even before the admin clicks Save.
    // This closes the gap when the DB was seeded at onboarding with permissions that differ
    // from the current Settings defaults, because without an explicit Save the DB and UI
    // are never reconciled.
    if (!_autoSynced.current) {
      _autoSynced.current = true;
      settingsApi.school.update({ modulePermissions: computed }).catch(() => {});
    }
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
        {isAdmin && (
          <button onClick={() => savePerms()} disabled={saving}
            className={`flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg transition disabled:opacity-50 ${
              dirty
                ? 'bg-slate-900 hover:bg-slate-800 text-white'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
            }`}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {saving ? 'Saving…' : dirty ? 'Save Permissions' : 'Sync Permissions'}
          </button>
        )}
      </div>

      <div className="flex gap-4 items-start">

        {/* ── Left: entity selector ── */}
        <div className="shrink-0 w-44 space-y-1.5">
          {mode === 'role' ? (
            <>
              {/* Built-in system roles (hidden ones are omitted from the main list) */}
              {SYSTEM_ROLES.filter(r => !hiddenSystemRoles.includes(r)).map(r => {
                const c         = SYSTEM_ROLE_COLORS[r] ?? SYSTEM_ROLE_COLORS.teacher;
                const isProtect = PROTECTED_ROLES.has(r);
                return (
                  <div key={r} className="relative group">
                    <button onClick={() => setSelRole(r)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold text-left transition ring-1 ${
                        selRole===r ? c.sel : c.idle
                      } ${!isProtect && isAdmin ? 'pr-7' : ''}`}
                    >
                      <ShieldCheck size={12} className="shrink-0" />
                      <span className="flex-1 truncate">{SYSTEM_ROLE_LABELS[r]}</span>
                    </button>
                    {isAdmin && !isProtect && (
                      <button
                        onClick={e => { e.stopPropagation(); confirmHideRole(r); }}
                        title="Hide role from invite form"
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition"
                      >
                        <EyeOff size={11} />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Hidden roles restore strip */}
              {hiddenSystemRoles.length > 0 && isAdmin && (
                <div className="mt-2 pt-2 border-t border-slate-100">
                  <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide px-1 mb-1">Hidden</p>
                  {hiddenSystemRoles.map(r => (
                    <div key={r} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 group">
                      <span className="flex-1 text-[11px] text-slate-400 truncate">{SYSTEM_ROLE_LABELS[r] ?? r}</span>
                      <button
                        onClick={() => restoreRoleMutate(r)}
                        title="Restore role"
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition"
                      >
                        <Eye size={11} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Custom roles */}
              {customRoles.map(cr => {
                const isSel = selRole === cr.key;
                return (
                  <div key={cr.key} className="relative group">
                    <button onClick={() => setSelRole(cr.key)}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-semibold text-left transition ring-1 ${
                        isSel ? 'text-white ring-transparent' : 'ring-slate-200 bg-white hover:bg-slate-50'
                      }`}
                      style={isSel ? { backgroundColor: cr.color } : {}}
                    >
                      <ShieldCheck size={12} className="shrink-0" style={!isSel ? { color: cr.color } : {}} />
                      <span className="flex-1 truncate" style={!isSel ? { color: cr.color } : {}}>{cr.label}</span>
                    </button>
                    {isAdmin && (
                      <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                        <button
                          onClick={e => { e.stopPropagation(); setEditingRole(cr); }}
                          title="Edit role"
                          className="p-1 rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition"
                        >
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); confirmDeleteRole(cr.key, cr.label); }}
                          title="Delete role"
                          className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* New Role button */}
              {isAdmin && (
                <button onClick={() => setShowCreateRole(true)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-50 ring-1 ring-dashed ring-slate-200 transition"
                >
                  <Plus size={12} /> New Role
                </button>
              )}
            </>
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

      {/* Edit custom role modal */}
      {editingRole && (
        <EditCustomRoleModal
          role={editingRole}
          onClose={() => setEditingRole(null)}
          onSaved={updated => {
            qc.invalidateQueries({ queryKey: ['settings','custom-roles'] });
            qc.invalidateQueries({ queryKey: ['settings','users'] }); // refresh role pills
            setEditingRole(null);
            setToast({ msg: `Role "${updated?.label}" updated.`, type: 'success' });
          }}
        />
      )}

      {/* Create custom role modal */}
      <AnimatePresence>
        {showCreateRole && (
          <CreateCustomRoleModal
            onClose={() => setShowCreateRole(false)}
            onCreated={newRole => {
              qc.invalidateQueries({ queryKey: ['settings','custom-roles'] });
              setShowCreateRole(false);
              setSelRole(newRole?.key ?? selRole);
              setToast({ msg: `Role "${newRole?.label}" created. Configure its permissions and save.`, type: 'success' });
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   SUBSCRIPTION TAB — pay Msingi platform subscription via M-Pesa
   ══════════════════════════════════════════════════════════════ */
/* Portal tiers — mirrors server/config/pricing.js */
const PORTAL_TIERS_SETTINGS = {
  base:       { label: 'Base',       rate: 150, tagline: 'Admin & teacher portals',   color: 'text-slate-700',  bg: 'bg-slate-50',   border: 'border-slate-300' },
  student:    { label: 'Student',    rate: 200, tagline: 'Base + student portal',      color: 'text-indigo-700', bg: 'bg-indigo-50',  border: 'border-indigo-300', popular: true },
  family:     { label: 'Family',     rate: 250, tagline: 'Student + parent portal',    color: 'text-violet-700', bg: 'bg-violet-50',  border: 'border-violet-300' },
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
  const [generating,   setGenerating]   = useState(false);
  const [result,       setResult]       = useState(null);
  const [error,        setError]        = useState('');

  const currentTierKey  = LEGACY_TO_TIER[school?.plan] || 'student';
  const currentTierMeta = PORTAL_TIERS_SETTINGS[currentTierKey] ?? PORTAL_TIERS_SETTINGS.student;
  const isEnterprise    = currentTierKey === 'enterprise';
  const expiry          = school?.planExpiresAt
    ? new Date(school.planExpiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  // Fetch current pending invoice
  const { data: invoiceData, refetch: refetchInvoice } = useQuery({
    queryKey:  ['billing-current'],
    queryFn:   () => billingApi.current().catch(() => ({ invoice: null })),
    select: d => d?.invoice ?? null,
  });

  const invoice      = invoiceData;
  const selectedRate = PORTAL_TIERS_SETTINGS[selTier]?.rate || 0;
  // If there's a pending invoice, use its amount; otherwise calculate from manual input
  const termAmount   = invoice ? invoice.totalAmount : selectedRate * Math.max(1, studentCount);

  async function handleGenerate() {
    setGenerating(true); setError(''); setResult(null);
    try {
      // Determine current term from school settings (first term whose start date <= today)
      const schoolData = school;
      const termDates  = schoolData?.termDates ?? [];
      const today      = new Date().toISOString().slice(0, 10);
      const currentTermDef = termDates
        .filter(t => t.startDate && t.startDate <= today)
        .sort((a, b) => b.startDate.localeCompare(a.startDate))[0];

      const body = {
        academicYear: schoolData?.academicYear || '',
        term:         currentTermDef?.term ?? 1,
      };

      const json = await billingApi.generate(body);
      if (!json.success) throw new Error(json.error?.message || 'Failed to generate invoice.');
      await refetchInvoice();
    } catch (err) {
      setError(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handlePay() {
    if (!phone.trim())     { setError('Enter the M-Pesa number to charge.'); return; }
    if (studentCount < 1)  { setError('Enter a valid student count.'); return; }
    setLoading(true); setError(''); setResult(null);
    try {
      const json = await mpesaApi.subscription({ phone: phone.trim(), tier: selTier, studentCount });
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

        {/* Invoice panel — shows auto-generated invoice or manual fallback */}
        {invoice ? (
          <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-200 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">Current Invoice</p>
                <p className="text-[10px] text-indigo-500 mt-0.5">{invoice.invoiceRef} · {invoice.academicYear} Term {invoice.term}</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-indigo-800">KSh {invoice.totalAmount.toLocaleString()}</p>
                <p className="text-[10px] text-indigo-500">{invoice.activeCount} students × KSh {invoice.ratePerStudent}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
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
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors"
            >
              {generating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
              Generate invoice from active student count
            </button>
          </div>
        )}

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

      {/* Billing history */}
      <BillingHistory />
    </div>
  );
}

function BillingHistory() {
  const { data: history = [] } = useQuery({
    queryKey: ['billing-history'],
    queryFn: async () => {
      const json = await billingApi.history();
      return json.success ? json.data : [];
    },
  });

  if (!history.length) return null;

  const STATUS_STYLE = {
    pending: 'bg-amber-50 text-amber-700 border-amber-200',
    paid:    'bg-emerald-50 text-emerald-700 border-emerald-200',
    overdue: 'bg-red-50 text-red-700 border-red-200',
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-100">
        <Clock size={14} className="text-slate-400" />
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Billing History</h3>
      </div>
      <div className="space-y-2">
        {history.map(inv => (
          <div key={inv.id} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800">{inv.invoiceRef}</p>
              <p className="text-xs text-slate-400">{inv.academicYear} · Term {inv.term} · {inv.activeCount} students</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold text-slate-800">KSh {inv.totalAmount.toLocaleString()}</p>
              {inv.paidAt && <p className="text-[10px] text-slate-400">{new Date(inv.paidAt).toLocaleDateString('en-GB')}</p>}
            </div>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border capitalize ${STATUS_STYLE[inv.status] || 'bg-slate-50 text-slate-600 border-slate-200'}`}>
              {inv.status}
            </span>
          </div>
        ))}
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
  { key: 'exams',      label: 'Exams & Assessment',  section: 'Academic'   },
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
  const role = useAuthStore(s => s.session?.user?.role ?? '');
  const isAdmin = ['admin', 'superadmin'].includes(role);
  const [tab, setTab] = useState(() => isAdmin ? 'school' : 'account');

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
            {tab === 'rc_templates'   && <RCTemplatesSection />}
            {tab === 'notifications'  && <NotificationsTab />}
            {tab === 'system'         && <SystemTab />}
            {tab === 'account'        && <AccountTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
