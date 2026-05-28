/* ============================================================
   VerificationBadge — reusable chip showing record verification
   state with optional verify-action dropdown for staff.

   Props:
     status      — 'institution_verified' | 'staff_verified' |
                   'pending_verification' | 'rejected' | null
     canVerify   — boolean (show verify dropdown if true)
     onVerify    — (newStatus, notes) => void
     isPending   — boolean (loading state during verify mutation)
   ============================================================ */
import { useState } from 'react';
import { CheckCircle2, Shield, Clock, XCircle, Circle, ChevronDown, Loader2 } from 'lucide-react';

/* ── Status config ──────────────────────────────────────────── */
const STATUS_CONFIG = {
  institution_verified: {
    label: 'School Verified',
    icon:  Shield,
    cls:   'bg-emerald-50 text-emerald-700 border-emerald-200',
    dot:   'bg-emerald-500',
  },
  staff_verified: {
    label: 'Staff Verified',
    icon:  CheckCircle2,
    cls:   'bg-blue-50 text-blue-700 border-blue-200',
    dot:   'bg-blue-500',
  },
  pending_verification: {
    label: 'Pending Review',
    icon:  Clock,
    cls:   'bg-amber-50 text-amber-700 border-amber-200',
    dot:   'bg-amber-400',
  },
  rejected: {
    label: 'Not Verified',
    icon:  XCircle,
    cls:   'bg-red-50 text-red-700 border-red-200',
    dot:   'bg-red-500',
  },
};

const UNVERIFIED = {
  label: 'Unverified',
  icon:  Circle,
  cls:   'bg-slate-50 text-slate-500 border-slate-200',
  dot:   'bg-slate-300',
};

/* ── Verify actions available to staff ─────────────────────── */
const VERIFY_ACTIONS = [
  { status: 'institution_verified', label: 'Mark as School Verified', adminOnly: true  },
  { status: 'staff_verified',       label: 'Mark as Staff Verified',   adminOnly: false },
  { status: 'pending_verification', label: 'Set to Pending Review',    adminOnly: false },
  { status: 'rejected',             label: 'Reject / Unverify',        adminOnly: false },
];

export default function VerificationBadge({ status, canVerify = false, onVerify, isPending = false, isAdmin = false }) {
  const [open, setOpen]   = useState(false);
  const [notes, setNotes] = useState('');
  const [action, setAction] = useState(null);

  const cfg = STATUS_CONFIG[status] ?? UNVERIFIED;
  const Icon = cfg.icon;

  function handleSelect(a) {
    if (!onVerify) return;
    setAction(a);
  }

  function handleConfirm() {
    if (!action || !onVerify) return;
    onVerify(action.status, notes);
    setOpen(false);
    setAction(null);
    setNotes('');
  }

  if (!canVerify) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.cls}`}>
        <Icon size={10} />
        {cfg.label}
      </span>
    );
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition hover:opacity-80 ${cfg.cls}`}
      >
        {isPending ? <Loader2 size={10} className="animate-spin" /> : <Icon size={10} />}
        {cfg.label}
        <ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => { setOpen(false); setAction(null); setNotes(''); }} />

          {/* Dropdown */}
          <div className="absolute left-0 top-full mt-1 z-20 w-64 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
            {!action ? (
              <>
                <p className="px-3 pt-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Change status
                </p>
                {VERIFY_ACTIONS.filter(a => isAdmin || !a.adminOnly).map(a => (
                  <button
                    key={a.status}
                    onClick={() => handleSelect(a)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 transition flex items-center gap-2 ${
                      status === a.status ? 'text-slate-400 cursor-default' : 'text-slate-700'
                    }`}
                    disabled={status === a.status}
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_CONFIG[a.status]?.dot ?? 'bg-slate-300'}`} />
                    {a.label}
                  </button>
                ))}
              </>
            ) : (
              <div className="p-3 space-y-2.5">
                <p className="text-xs font-medium text-slate-700">
                  {action.label}
                </p>
                <textarea
                  rows={2}
                  placeholder="Notes (optional)"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-slate-900/10 text-slate-700 placeholder-slate-400"
                />
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleConfirm}
                    disabled={isPending}
                    className="flex-1 text-xs font-medium bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition"
                  >
                    {isPending ? 'Saving…' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => { setAction(null); setNotes(''); }}
                    className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1.5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
