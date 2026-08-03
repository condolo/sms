/* ============================================================
   Report Cards — top-level module (RCE5)
   Splits out of Exams' old "Grade Report" tab into its own page:
   - Generate & Publish: unchanged ReportCardsTab (class/term selector,
     per-student report view, publish batch) — reused from
     pages/grades/components, not duplicated.
   - Settings: General / Comments / Workflow / Publication Policy /
     Templates — the RCE1/RC7/RC8/RC9/RC11 server capabilities this
     engine has had since earlier milestones but never had a client UI.
   ============================================================ */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileBarChart2, Settings as SettingsIcon, GraduationCap } from 'lucide-react';
import ReportCardsTab from '../grades/components/ReportCardsTab.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import useAuthStore from '@/store/auth.js';

export default function ReportCardsPage() {
  const [tab, setTab] = useState('generate');
  const role = useAuthStore(s => s.session?.user?.role ?? '');
  const canConfigure = ['admin', 'superadmin'].includes(role);

  const TABS = [
    { id: 'generate', label: 'Generate & Publish', icon: FileBarChart2, adminOnly: false },
    { id: 'settings',  label: 'Settings',           icon: SettingsIcon, adminOnly: true  },
  ].filter(t => !t.adminOnly || canConfigure);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ── Gradient header (matches ExamsPage's pattern, distinct hue) ── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-emerald-700 via-teal-700 to-cyan-800 px-6 pt-5 pb-0">
        <div className="pointer-events-none absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute top-4 right-36 w-28 h-28 rounded-full bg-white/5" />
        <div className="max-w-screen-xl mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-white/20 border border-white/30 flex items-center justify-center shrink-0">
                <GraduationCap size={20} className="text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white leading-tight">Report Cards</h1>
                <p className="text-teal-100 text-xs mt-0.5">Generate, publish, and configure every school's report card</p>
              </div>
            </div>
          </div>

          {/* ── Tab bar — overflow-x-auto scrolls within its own bounds
              rather than being clipped by the header's overflow-hidden ── */}
          <div className="flex gap-0.5 mt-5 overflow-x-auto">
            {TABS.map(t => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition rounded-t-lg whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white text-teal-700 shadow-sm'
                      : 'text-white/90 hover:text-white hover:bg-white/15'
                  }`}
                >
                  <Icon size={13} />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-6 py-5">
        <AnimatePresence mode="wait">
          {tab === 'generate' && (
            <motion.div key="generate" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              <ReportCardsTab />
            </motion.div>
          )}
          {tab === 'settings' && canConfigure && (
            <motion.div key="settings" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              <SettingsPanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
