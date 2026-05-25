/* ============================================================
   SubjectsPage — tabbed shell
   Tabs:
     1. Catalog    — subject registry grouped by department
     2. Curriculum — assign subjects to each class
     3. Enrollment — manage student subject enrollment per class
     4. Warnings   — students with too few / too many subjects
   ============================================================ */
import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Library, BookOpen, Users, AlertTriangle, Check } from 'lucide-react';
import clsx from 'clsx';
import CatalogTab    from './CatalogTab';
import CurriculumTab from './CurriculumTab';
import EnrollmentTab from './EnrollmentTab';
import WarningsTab   from './WarningsTab';

const TABS = [
  { id: 'catalog',    label: 'Catalog',    Icon: Library,       desc: 'Subjects by department' },
  { id: 'curriculum', label: 'Curriculum', Icon: BookOpen,      desc: 'Assign subjects per class' },
  { id: 'enrollment', label: 'Enrollment', Icon: Users,         desc: 'Student subject enrollment' },
  { id: 'warnings',   label: 'Warnings',   Icon: AlertTriangle, desc: 'Enrollment rule violations' },
];

export default function SubjectsPage() {
  const [tab,   setTab]   = useState('catalog');
  const [toast, setToast] = useState(null);

  function flash(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  return (
    <div className="min-h-full bg-slate-50">
      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-6">
        <nav className="flex gap-0.5 -mb-px">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={clsx(
                'flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition',
                tab === id
                  ? 'border-violet-600 text-violet-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300',
              )}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {tab === 'catalog'    && <CatalogTab    flash={flash} />}
      {tab === 'curriculum' && <CurriculumTab flash={flash} />}
      {tab === 'enrollment' && <EnrollmentTab flash={flash} />}
      {tab === 'warnings'   && <WarningsTab   flash={flash} />}

      {/* Shared toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className={clsx(
              'fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lg',
              toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white',
            )}
          >
            {toast.type !== 'error' && <Check size={15} />}
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
