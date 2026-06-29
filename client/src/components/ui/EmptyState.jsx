/**
 * Placeholder shown when a list has no results.
 */
export function EmptyState({ icon = '📭', title = 'Nothing here yet', description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="text-5xl select-none">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        {description && (
          <p className="mt-1 text-sm text-slate-400 max-w-xs mx-auto">{description}</p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Inline error state with retry button.
 */
export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <span className="text-4xl select-none">⚠️</span>
      <p className="text-sm text-slate-600">{message ?? 'Something went wrong.'}</p>
      {onRetry && (
        <button onClick={onRetry} className="btn-secondary btn-sm">
          Try again
        </button>
      )}
    </div>
  );
}
