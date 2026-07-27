/* ============================================================
   FinancePage — tab-routing shell (was 1355 lines)
   Decomposed into: constants.js + FinancePrimitives.jsx +
   SummaryTab · OverdueTab · InvoicesTab · PaymentsTab ·
   FeeStructureTab · RecordPaymentSlideOver · FeeStructureSlideOver

   No manual "New Invoice" entry point on purpose — every invoice is
   expected to come from a Fee Structure's Generate Invoices (handles
   class/section/student scope + sibling discounts consistently).
   Ad-hoc one-off invoices, if ever needed again, go through a Fee
   Structure scoped to a single student rather than a separate
   free-form creation flow.
   ============================================================ */
import { useState } from 'react';
import { Settings } from 'lucide-react';
import useAuthStore from '@/store/auth.js';
import { TABS, makeFmtCurrency } from './constants.js';
import SummaryTab              from './components/SummaryTab.jsx';
import OverdueTab              from './components/OverdueTab.jsx';
import InvoicesTab             from './components/InvoicesTab.jsx';
import PaymentsTab             from './components/PaymentsTab.jsx';
import FeeStructureTab         from './components/FeeStructureTab.jsx';
import FeeSettingsModal        from './components/FeeSettingsModal.jsx';
import { RecordPaymentButton }      from './components/RecordPaymentSlideOver.jsx';
import { CreateFeeStructureButton } from './components/FeeStructureSlideOver.jsx';

export default function FinancePage() {
  const [tab,  setTab]  = useState('summary');
  const [page, setPage] = useState(1);
  const [showFeeSettings, setShowFeeSettings] = useState(false);

  const school = useAuthStore(s => s.session?.school);
  const role   = useAuthStore(s => s.session?.user?.role ?? '');
  const can    = useAuthStore(s => s.can.bind(s));

  const canCreate  = can('finance') || role === 'admin' || role === 'superadmin';
  const fmtCurrency = makeFmtCurrency(school);
  const currency    = school?.currency ?? 'KES';

  function switchTab(id) { setTab(id); setPage(1); }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-screen-2xl mx-auto flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Finance</h1>
            <p className="text-sm text-slate-500 mt-0.5">Invoices, payments, and financial overview</p>
          </div>
          {canCreate && tab === 'payments' && <RecordPaymentButton      fmtCurrency={fmtCurrency} currency={currency} />}
          {canCreate && tab === 'feestr'   && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFeeSettings(true)}
                className="flex items-center gap-1.5 border border-slate-200 hover:bg-slate-50 text-slate-600 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                <Settings size={14} /> Fee Settings
              </button>
              <CreateFeeStructureButton fmtCurrency={fmtCurrency} />
            </div>
          )}
        </div>

        {/* Tab nav */}
        <div className="max-w-screen-2xl mx-auto mt-4 flex gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                tab === t.id
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              <t.Icon size={14} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-screen-2xl mx-auto px-6 py-5">
        {tab === 'summary'  && <SummaryTab      fmtCurrency={fmtCurrency} />}
        {tab === 'invoices' && <InvoicesTab     fmtCurrency={fmtCurrency} page={page} onPage={setPage} canCreate={canCreate} school={school} />}
        {tab === 'overdue'  && <OverdueTab      fmtCurrency={fmtCurrency} />}
        {tab === 'payments' && <PaymentsTab     fmtCurrency={fmtCurrency} page={page} onPage={setPage} school={school} />}
        {tab === 'feestr'   && <FeeStructureTab fmtCurrency={fmtCurrency} canCreate={canCreate} />}
      </div>

      {showFeeSettings && <FeeSettingsModal onClose={() => setShowFeeSettings(false)} />}
    </div>
  );
}
