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
import { Library, BookOpen, Users, AlertTriangle, Check, Lock } from 'lucide-react';
import clsx from 'clsx';
import useAuthStore from '@/store/auth.js';
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

  // Raised directly: "I have removed all access to subject but this exam
  // officer still have full access to this Subject module." The sidebar
  // already correctly hides the Subjects nav link once permissions.subjects
  // is an empty array (Sidebar.jsx's computeNav — fails closed on a present
  // but empty array). But nothing gated the PAGE itself: no route guard in
  // App.jsx, and this component had zero permission checks of its own — so
  // reaching /subjects by any other means (a direct URL, browser history, a
  // link from elsewhere) showed the full Catalog/Curriculum/Enrollment/
  // Warnings tabs regardless. CatalogTab/CurriculumTab already correctly
  // gate their own Create/Edit/Delete buttons via can('subjects', action)
  // reading this exact same coarse array — reusing it here for 'read' is
  // the same convention, not a new one: the coarse array unions every
  // sub-key's grant (view/create/edit/delete — settings.js's
  // _deriveApiPerms), so an empty array here means truly zero grants of any
  // kind, not just zero on the 'view' row specifically.
  const role = useAuthStore(s => s.session?.user?.role ?? '');
  const can  = useAuthStore(s => s.can.bind(s));
  const isAdminLevel = role === 'admin' || role === 'superadmin';
  const hasAccess = isAdminLevel || can('subjects', 'read');

  function flash(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  if (!hasAccess) {
    return (
      <div className="min-h-full bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-10 flex flex-col items-center gap-3 max-w-sm text-center">
          <Lock size={28} className="text-slate-300" />
          <p className="text-sm font-medium text-slate-700">You don't have access to Subjects</p>
          <p className="text-xs text-slate-400">
            Ask your school admin to grant a Subjects permission under Settings → Roles &amp; Permissions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-slate-50">
      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-6">
        <nav className="flex gap-0.5 -mb-px overflow-x-auto">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={clsx(
                'flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition whitespace-nowrap shrink-0',
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
