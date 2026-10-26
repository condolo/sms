/* ============================================================
   Settings → Message Templates tab (2026-10-26)

   Reported directly: "the school wants to own the message, not
   sent by system 'from hidden' somewhere" — every automated email
   (welcome credentials, password reset, behaviour alerts, etc.)
   previously had its wording hardcoded in server/utils/email.js,
   with no way for a school to put it in their own words.

   This is deliberately NOT a rich HTML editor — a school edits the
   subject line and the plain-text narrative (greeting + explanation)
   of each message via server/config/notificationTemplates.js's
   registry; everything else in the email (credential boxes, buttons,
   security disclosures, the "do not reply" footer) stays fixed, so
   wording changes can never break a placeholder, hide a security
   notice, or corrupt the layout. {{placeholders}} shown under each
   field are substituted by server/utils/notificationTemplates.js at
   send time.
   ============================================================ */
import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquare, ChevronDown, ChevronUp, Save, RefreshCcw, Loader2,
  CheckCircle2, AlertTriangle, Sparkles, ShieldCheck, Wallet, CalendarDays,
  Scale, UserCog, Cake, BookOpen,
} from 'lucide-react';
import { settings as settingsApi } from '@/api/client.js';

const CATEGORY_ICONS = {
  account:       ShieldCheck,
  communication: MessageSquare,
  academic:      BookOpen,
  finance:       Wallet,
  attendance:    CalendarDays,
  behaviour:     Scale,
  hr:            UserCog,
  celebrations:  Cake,
};

function Toast({ toast }) {
  return (
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
  );
}

/* One editable template row — collapsed by default, expands to a
   Subject + Body form. Owns its own draft state so editing one
   template never disturbs another's unsaved edits. */
function TemplateRow({ tpl, onSave, onReset, saving, resetting }) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(tpl.subject);
  const [body, setBody] = useState(tpl.body);

  const dirty = subject !== tpl.subject || body !== tpl.body;

  function expand() {
    if (!open) { setSubject(tpl.subject); setBody(tpl.body); }
    setOpen(o => !o);
  }

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white">
      <button
        onClick={expand}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-slate-900 truncate">{tpl.label}</p>
            {tpl.isOverridden ? (
              <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">Customized</span>
            ) : (
              <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Default</span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{tpl.desc}</p>
        </div>
        {open ? <ChevronUp size={16} className="text-slate-400 shrink-0" /> : <ChevronDown size={16} className="text-slate-400 shrink-0" />}
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Subject line</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              maxLength={300}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-600 mb-1 block">Message</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              maxLength={4000}
              rows={5}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              Leave a blank line between paragraphs. Other parts of this email (buttons, data boxes, security notices) aren't editable here.
            </p>
          </div>
          {tpl.placeholders?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] text-slate-400 mr-1">Available placeholders:</span>
              {tpl.placeholders.map(p => (
                <code key={p} className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{`{{${p}}}`}</code>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => onSave(tpl.key, { subject, body })}
              disabled={!dirty || saving}
              className="btn-primary btn-sm flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save
            </button>
            {tpl.isOverridden && (
              <button
                onClick={() => onReset(tpl.key)}
                disabled={resetting}
                className="btn-secondary btn-sm flex items-center gap-1.5"
              >
                {resetting ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
                Reset to default
              </button>
            )}
            {dirty && <span className="text-[11px] text-amber-600">Unsaved changes</span>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function MessageTemplatesTab() {
  const qc = useQueryClient();
  const [toast, setToast] = useState(null);
  const showT = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'notification-templates'],
    queryFn:  () => settingsApi.notificationTemplates.list(),
    staleTime: 30_000,
  });

  const templates    = data?.data ?? [];
  const categoryOrder = data?.categoryOrder ?? [];
  const categories    = data?.categories ?? {};

  const grouped = useMemo(() => {
    const byCat = {};
    for (const t of templates) {
      (byCat[t.category] ??= []).push(t);
    }
    return byCat;
  }, [templates]);

  const [pendingKey, setPendingKey] = useState(null);

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: ({ key, data: body }) => settingsApi.notificationTemplates.update(key, body),
    onMutate: ({ key }) => setPendingKey(key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'notification-templates'] });
      showT('Message template saved.');
    },
    onError: err => showT(err?.message ?? 'Failed to save template.', 'error'),
    onSettled: () => setPendingKey(null),
  });

  const { mutate: reset, isPending: resetting } = useMutation({
    mutationFn: (key) => settingsApi.notificationTemplates.reset(key),
    onMutate: (key) => setPendingKey(key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'notification-templates'] });
      showT('Reverted to the default wording.');
    },
    onError: err => showT(err?.message ?? 'Failed to reset template.', 'error'),
    onSettled: () => setPendingKey(null),
  });

  return (
    <div className="space-y-6">
      <Toast toast={toast} />

      <div>
        <h2 className="text-base font-semibold text-slate-900">Message Templates</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Put the automated emails your school sends — welcome credentials, password resets, fee reminders, behaviour alerts, and more — in your own words.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-slate-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        categoryOrder.filter(cat => grouped[cat]?.length).map(cat => {
          const Icon = CATEGORY_ICONS[cat] ?? Sparkles;
          return (
            <div key={cat} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Icon size={15} className="text-indigo-500" />
                <h3 className="text-sm font-semibold text-slate-700">{categories[cat] ?? cat}</h3>
              </div>
              <div className="space-y-2">
                {grouped[cat].map(tpl => (
                  <TemplateRow
                    key={tpl.key}
                    tpl={tpl}
                    onSave={(key, body) => save({ key, data: body })}
                    onReset={(key) => reset(key)}
                    saving={saving && pendingKey === tpl.key}
                    resetting={resetting && pendingKey === tpl.key}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
