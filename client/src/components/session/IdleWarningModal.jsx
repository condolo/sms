export default function IdleWarningModal({ countdown, onStay, onLogout }) {
  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const display = minutes > 0
    ? `${minutes}:${String(seconds).padStart(2, '0')}`
    : `${seconds}s`;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-sm mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-amber-50 border-b border-amber-100 px-6 py-4 flex items-center gap-3">
          <span className="text-2xl" aria-hidden>⏱</span>
          <div>
            <p className="font-semibold text-amber-900 text-sm">Session expiring soon</p>
            <p className="text-amber-700 text-xs mt-0.5">You've been inactive for 59 minutes.</p>
          </div>
        </div>

        {/* Countdown */}
        <div className="px-6 py-6 text-center">
          <p className="text-sm text-slate-500 mb-2">You'll be signed out in</p>
          <div className="font-mono text-5xl font-bold text-amber-500 tracking-widest mb-1">
            {display}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Click <strong>Stay signed in</strong> to continue your session.
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex flex-col gap-2.5">
          <button
            onClick={onStay}
            className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
          >
            Stay signed in
          </button>
          <button
            onClick={onLogout}
            className="w-full py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            Sign out now
          </button>
        </div>
      </div>
    </div>
  );
}
