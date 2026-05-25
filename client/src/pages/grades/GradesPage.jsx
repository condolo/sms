/* ============================================================
   Exams & Assessment — orchestration shell
   Tabs: Exams · Results · Mark Entry · Report Cards · Config · Reminders

   Data stores:
     exams + exam_results  → formal exam scheduling & results
     assessment_marks      → continuous assessment (CA/HW/MT/ET)
   ============================================================ */
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useAuthStore from '@/store/auth.js';
import { TABS } from './constants.js';
import ExamsListTab       from './components/ExamsListTab.jsx';
import ExamResultsTab     from './components/ExamResultsTab.jsx';
import MarkEntryTab       from './components/MarkEntryTab.jsx';
import ReportCardsTab     from './components/ReportCardsTab.jsx';
import ConfigTab          from './components/ConfigTab.jsx';
import RemindersTab       from './components/RemindersTab.jsx';

export default function GradesPage() {
  const role = useAuthStore(s => s.session?.user?.role ?? 'teacher');
  const [tab, setTab] = useState('exams');

  const visibleTabs = TABS.filter(t => t.roles.includes(role));

  useEffect(() => {
    if (!visibleTabs.find(t => t.key === tab)) {
      setTab(visibleTabs[0]?.key ?? 'exams');
    }
  }, [role]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-screen-2xl mx-auto px-6 py-5">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Exams &amp; Assessment</h1>
              <p className="text-sm text-slate-500 mt-0.5">Exam scheduling, results, continuous assessment and report cards</p>
            </div>
          </div>
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {visibleTabs.map(({ key, label, Icon }) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${
                  tab === key
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}>
                <Icon size={13} />{label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
            {tab === 'exams'   && <ExamsListTab />}
            {tab === 'results' && <ExamResultsTab />}
            {tab === 'entry'   && <MarkEntryTab />}
            {tab === 'report'  && <ReportCardsTab />}
            {tab === 'config'  && <ConfigTab />}
            {tab === 'remind'  && <RemindersTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
