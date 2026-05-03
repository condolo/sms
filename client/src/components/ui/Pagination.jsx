import clsx from 'clsx';

/**
 * Page-based pagination bar.
 *
 * @param {{
 *   page: number,
 *   totalPages: number,
 *   total: number,
 *   limit: number,
 *   onPage: (n: number) => void,
 * }} props
 */
export function Pagination({ page, totalPages, total, limit, onPage }) {
  if (!totalPages || totalPages <= 1) return null;

  const from  = (page - 1) * limit + 1;
  const to    = Math.min(page * limit, total);

  // Build page window: always show first, last, and up to 3 around current
  function buildPages() {
    const pages = new Set([1, totalPages]);
    for (let i = Math.max(1, page - 1); i <= Math.min(totalPages, page + 1); i++) {
      pages.add(i);
    }
    const sorted = [...pages].sort((a, b) => a - b);
    const result = [];
    let prev = null;
    for (const p of sorted) {
      if (prev !== null && p - prev > 1) result.push('…');
      result.push(p);
      prev = p;
    }
    return result;
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
      <p className="text-sm text-slate-500">
        Showing <span className="font-medium text-slate-700">{from}–{to}</span> of{' '}
        <span className="font-medium text-slate-700">{total}</span> results
      </p>

      <div className="flex items-center gap-1">
        <PageBtn
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          ‹
        </PageBtn>

        {buildPages().map((p, i) =>
          p === '…' ? (
            <span key={`ellipsis-${i}`} className="px-1 text-slate-400 select-none">…</span>
          ) : (
            <PageBtn
              key={p}
              onClick={() => onPage(p)}
              active={p === page}
            >
              {p}
            </PageBtn>
          ),
        )}

        <PageBtn
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          ›
        </PageBtn>
      </div>
    </div>
  );
}

function PageBtn({ onClick, disabled, active, children, ...rest }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'min-w-[32px] h-8 px-2 rounded-lg text-sm font-medium transition',
        'focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1',
        'disabled:opacity-40 disabled:pointer-events-none',
        active
          ? 'bg-brand-600 text-white'
          : 'text-slate-600 hover:bg-slate-100',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
