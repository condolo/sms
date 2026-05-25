/* ============================================================
   BehaviourPage — tab-routing shell (was 1268 lines)
   Decomposed into: bpsConstants.js (pre-existing) +
   BehaviourPrimitives.jsx + OverviewTab · AwardTab ·
   IncidentsTab · AppealsTab · HousesTab · CategoriesTab
   ============================================================ */
import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { BarChart3, Star, Scale, Send, Home, Tag } from 'lucide-react';
import useAuthStore from '@/store/auth.js';
import OverviewTab   from './components/OverviewTab.jsx';
import AwardTab      from './components/AwardTab.jsx';
import IncidentsTab  from './components/IncidentsTab.jsx';
import AppealsTab    from './components/AppealsTab.jsx';
import HousesTab     from './components/HousesTab.jsx';
import CategoriesTab from './components/CategoriesTab.jsx';

export default function BehaviourPage() {
  const [tab, setTab] = useState('overview');
  const role    = useAuthStore(s => s.session?.user?.role ?? '');
  const isAdmin = role === 'admin' || role === 'superadmin';

  const TABS = [
    { id: 'overview',   label: 'Overview',     icon: BarChart3 },
    { id: 'award',      label: 'Award Points',  icon: Star      },
    { id: 'incidents',  label: 'Incidents',     icon: Scale     },
    { id: 'appeals',    label: 'Appeals',       icon: Send      },
    { id: 'houses',     label: 'Houses',        icon: Home      },
    ...(isAdmin ? [{ id: 'categories', label: 'Categories', icon: Tag }] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-xl mx-auto">
          <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Behaviour Points</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Behaviour Point System — merit awards, demerit logging, intervention stages, and appeals
          </p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="bg-white border-b border-slate-200 px-6">
        <div className="max-w-screen-xl mx-auto flex gap-0 overflow-x-auto">
          {TABS.map(t => {
            const Icon   = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-screen-xl mx-auto px-6 py-5">
        <AnimatePresence mode="wait">
          {tab === 'overview'   && <OverviewTab   key="overview"   />}
          {tab === 'award'      && <AwardTab      key="award"      />}
          {tab === 'incidents'  && <IncidentsTab  key="incidents"  />}
          {tab === 'appeals'    && <AppealsTab    key="appeals"    />}
          {tab === 'houses'     && <HousesTab     key="houses"     />}
          {tab === 'categories' && <CategoriesTab key="categories" />}
        </AnimatePresence>
      </div>
    </div>
  );
}
