/* ============================================================
   Finance — shared constants
   ============================================================ */
import {
  TrendingUp, FileText, AlertTriangle, CreditCard, ListChecks,
} from 'lucide-react';

export const LIMIT = 20;

export const TABS = [
  { id: 'summary',  label: 'Overview',      Icon: TrendingUp    },
  { id: 'invoices', label: 'Invoices',      Icon: FileText      },
  { id: 'overdue',  label: 'Overdue',       Icon: AlertTriangle },
  { id: 'payments', label: 'Payments',      Icon: CreditCard    },
  { id: 'feestr',   label: 'Fee Structure', Icon: ListChecks    },
];

export const INV_STATUS_BADGE = {
  paid:    'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  unpaid:  'bg-amber-50   text-amber-700  ring-1 ring-amber-200',
  partial: 'bg-blue-50    text-blue-700   ring-1 ring-blue-200',
  void:    'bg-slate-100  text-slate-400',
  overdue: 'bg-red-50     text-red-600    ring-1 ring-red-200',
};

/** Build a currency formatter from the school object */
export function makeFmtCurrency(school) {
  const currency       = school?.currency       ?? 'KES';
  const currencySymbol = school?.currencySymbol ?? 'KSh';
  return function fmtCurrency(n) {
    if (n == null || isNaN(Number(n))) return '—';
    try {
      return new Intl.NumberFormat('en-KE', {
        style: 'currency', currency, maximumFractionDigits: 0,
      }).format(n);
    } catch {
      return `${currencySymbol} ${Number(n).toLocaleString()}`;
    }
  };
}
