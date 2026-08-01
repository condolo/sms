/* ============================================================
   InventoryPage — Inventory (Module 2, milestone 1: Categories + Items)
   Two tabs: Items (list + add/edit), Categories (list + add/edit/delete)
   ============================================================ */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Boxes, Tag, Search, Plus, X, Loader2, AlertTriangle, Trash2, Edit2,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { inventory as inventoryApi } from '@/api/client.js';
import useAuthStore from '@/store/auth.js';

const LIMIT = 20;
const STATUSES = ['active', 'inactive', 'discontinued'];

export default function InventoryPage() {
  const [tab, setTab] = useState('items');
  const can = useAuthStore(s => s.can);
  const canManage = can('inventory', 'create');

  const TABS = [
    { id: 'items', label: 'Items', icon: Boxes },
    ...(canManage ? [{ id: 'categories', label: 'Categories', icon: Tag }] : []),
  ];
  const activeTab = TABS.some(t => t.id === tab) ? tab : (TABS[0]?.id ?? 'items');

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-xl mx-auto">
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Inventory</h1>
          <p className="text-sm text-slate-500 mt-0.5">School inventory items and categories</p>
        </div>
      </div>

      <div className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-screen-xl mx-auto flex gap-0 overflow-x-auto">
          {TABS.map(t => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  active ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-5">
        <AnimatePresence mode="wait">
          {activeTab === 'items'      && <ItemsTab key="items" canManage={canManage} />}
          {activeTab === 'categories' && <CategoriesTab key="categories" />}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   ITEMS
   ══════════════════════════════════════════════════════════════ */
function ItemsTab({ canManage }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const { data: catData } = useQuery({
    queryKey: ['inventory', 'categories'],
    queryFn:  () => inventoryApi.categories.list(),
    staleTime: 60_000,
  });
  const categories = catData?.data ?? [];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inventory', 'items', { page, search }],
    queryFn:  () => inventoryApi.items.list({ page, limit: LIMIT, search: search || undefined }),
    placeholderData: prev => prev,
  });
  const rows       = data?.data ?? [];
  const pagination = data?.pagination ?? {};
  const totalPages = pagination.pages ?? 1;
  const total      = pagination.total ?? rows.length;

  const deleteMutation = useMutation({
    mutationFn: id => inventoryApi.items.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['inventory', 'items'] }),
  });

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name or item code…"
            className="w-full text-sm pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 placeholder-slate-400"
          />
        </div>
        {canManage && (
          <button
            onClick={() => { setEditing(null); setShowForm(true); }}
            className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-3 py-2 rounded-lg transition"
          >
            <Plus size={13} /> Add Item
          </button>
        )}
      </div>

      {showForm && (
        <ItemForm
          categories={categories}
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); qc.invalidateQueries({ queryKey: ['inventory', 'items'] }); }}
        />
      )}

      {isLoading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="bg-white rounded-xl border border-slate-200 h-14 animate-pulse" />)}</div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <AlertTriangle size={24} className="text-red-400" />
          <p className="text-sm text-slate-500">{error?.message ?? 'Failed to load'}</p>
          <button onClick={refetch} className="text-xs font-medium text-slate-700 underline">Retry</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-slate-400">
          <Boxes size={36} className="mb-3 opacity-40" />
          <p className="text-sm font-medium text-slate-600">No items yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Item Code</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">Category</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Qty</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">Location</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                {canManage && <th className="px-4 py-3 w-16" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(item => (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{item.itemCode}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
                  <td className="px-4 py-3 text-slate-600 hidden sm:table-cell">{item.categoryName}</td>
                  <td className="px-4 py-3 text-right text-slate-700">{item.quantity} <span className="text-slate-400">{item.unit}</span></td>
                  <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{item.location ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={item.status} /></td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => { setEditing(item); setShowForm(true); }} className="text-slate-400 hover:text-slate-700 transition"><Edit2 size={13} /></button>
                        <button
                          onClick={() => { if (confirm(`Delete "${item.name}"?`)) deleteMutation.mutate(item.id); }}
                          className="text-slate-300 hover:text-red-500 transition"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
            <p className="text-xs text-slate-500">{total} result{total !== 1 ? 's' : ''}</p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronLeft size={14} /></button>
              <span className="text-xs text-slate-500 px-2">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition text-slate-600"><ChevronRight size={14} /></button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    active:       'bg-emerald-50 text-emerald-700 border-emerald-200',
    inactive:     'bg-slate-100 text-slate-600 border-slate-200',
    discontinued: 'bg-red-50 text-red-700 border-red-200',
  };
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${styles[status] ?? styles.inactive}`}>{status}</span>;
}

function ItemForm({ categories, initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    itemCode:   initial?.itemCode   ?? '',
    name:       initial?.name       ?? '',
    categoryId: initial?.categoryId ?? (categories[0]?.id ?? ''),
    quantity:   initial?.quantity   ?? 0,
    unit:       initial?.unit       ?? 'pcs',
    location:   initial?.location   ?? '',
    status:     initial?.status     ?? 'active',
  });
  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const mutation = useMutation({
    mutationFn: () => initial
      ? inventoryApi.items.update(initial.id, form)
      : inventoryApi.items.create(form),
    onSuccess: onSaved,
  });

  return (
    <form
      onSubmit={e => { e.preventDefault(); mutation.mutate(); }}
      className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">{initial ? 'Edit Item' : 'Add Item'}</h3>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={15} /></button>
      </div>
      {mutation.isError && <p className="text-xs text-red-600">{mutation.error?.message ?? 'Failed to save'}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <FField label="Item code">
          <input required className={iCls()} value={form.itemCode} onChange={e => set('itemCode', e.target.value)} placeholder="e.g. ICT-001" />
        </FField>
        <FField label="Name">
          <input required className={iCls()} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Dell Laptop" />
        </FField>
        <FField label="Category">
          <select required className={iCls()} value={form.categoryId} onChange={e => set('categoryId', e.target.value)}>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FField>
        <FField label="Status">
          <select className={iCls()} value={form.status} onChange={e => set('status', e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FField>
        {!initial && (
          <FField label="Opening quantity">
            <input type="number" min={0} className={iCls()} value={form.quantity} onChange={e => set('quantity', Number(e.target.value))} />
          </FField>
        )}
        <FField label="Unit">
          <input className={iCls()} value={form.unit} onChange={e => set('unit', e.target.value)} placeholder="e.g. pcs, boxes, litres" />
        </FField>
        <FField label="Store / Location">
          <input className={iCls()} value={form.location} onChange={e => set('location', e.target.value)} placeholder="e.g. ICT Store Room" />
        </FField>
      </div>
      {initial && (
        <p className="text-[11px] text-slate-400">Quantity changes only through Stock Transactions, not here — coming in the next milestone.</p>
      )}
      <button
        type="submit"
        disabled={mutation.isPending}
        className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition"
      >
        {mutation.isPending ? <Loader2 size={13} className="animate-spin" /> : null}
        {mutation.isPending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

/* ══════════════════════════════════════════════════════════════
   CATEGORIES
   ══════════════════════════════════════════════════════════════ */
function CategoriesTab() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'categories'],
    queryFn:  () => inventoryApi.categories.list(),
  });
  const categories = data?.data ?? [];

  const createMutation = useMutation({
    mutationFn: () => inventoryApi.categories.create({ name: name.trim() }),
    onSuccess: () => { setName(''); setAdding(false); qc.invalidateQueries({ queryKey: ['inventory', 'categories'] }); },
  });
  const deleteMutation = useMutation({
    mutationFn: id => inventoryApi.categories.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['inventory', 'categories'] }),
    onError:    err => alert(err?.message ?? 'Failed to delete category'),
  });

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="max-w-lg space-y-4">
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-5 space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-slate-100 rounded animate-pulse" />)}</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {categories.map(c => (
              <li key={c.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-slate-800">{c.name}</span>
                <button
                  onClick={() => { if (confirm(`Delete category "${c.name}"?`)) deleteMutation.mutate(c.id); }}
                  className="text-slate-300 hover:text-red-500 transition"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {adding ? (
        <form
          onSubmit={e => { e.preventDefault(); if (name.trim()) createMutation.mutate(); }}
          className="flex items-center gap-2"
        >
          <input autoFocus className={iCls()} value={name} onChange={e => setName(e.target.value)} placeholder="Category name" />
          <button type="submit" disabled={createMutation.isPending} className="flex items-center gap-1 bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium px-3 py-2 rounded-lg transition">
            {createMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Add'}
          </button>
          <button type="button" onClick={() => { setAdding(false); setName(''); }} className="text-slate-400 hover:text-slate-700"><X size={15} /></button>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-lg px-3 py-1.5 transition">
          <Plus size={13} /> Add category
        </button>
      )}
    </motion.div>
  );
}

/* ── Shared field helpers ────────────────────────────────────── */
function FField({ label, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-600">{label}</label>
      {children}
    </div>
  );
}
function iCls() {
  return 'w-full text-sm px-3 py-2 rounded-lg border border-slate-200 focus:border-slate-400 bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-800 placeholder-slate-400 transition';
}
