/* ============================================================
   PaginationBar — shared page control for the Settings tables.

   Same shape everywhere: "Showing X–Y of Z" on the left, a
   per-page selector and a numbered page window on the right.
   The window always shows the first and last page plus the two
   pages either side of the current one, with an ellipsis for the
   gap in between, so the control stays a fixed width no matter
   how many pages there are.
   ============================================================ */
import { ChevronLeft, ChevronRight } from 'lucide-react';

function buildPages(page, totalPages) {
  const pages = new Set([1, totalPages]);
  for (let i = Math.max(1, page - 1); i <= Math.min(totalPages, page + 1); i++) pages.add(i);
  const sorted = [...pages].sort((a, b) => a - b);
  const out = [];
  let prev = null;
  for (const p of sorted) {
    if (prev !== null && p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}

export default function PaginationBar({
  page,
  totalPages,
  total,
  limit,
  onPage,
  onLimit,
  itemLabel = 'results',
  limitOptions = [10, 25, 50, 100],
  disabled = false,
}) {
  const safeTotal  = total ?? 0;
  const safePages  = Math.max(1, totalPages ?? 1);
  const from       = safeTotal === 0 ? 0 : (page - 1) * limit + 1;
  const to         = Math.min(page * limit, safeTotal);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
      <p className="text-xs text-slate-500">
        {safeTotal === 0 ? (
          `No ${itemLabel}`
        ) : (
          <>
            Showing <span className="font-semibold text-slate-700 tabular-nums">{from}–{to}</span> of{' '}
            <span className="font-semibold text-slate-700 tabular-nums">{safeTotal.toLocaleString()}</span> {itemLabel}
          </>
        )}
      </p>

      <div className="flex items-center gap-3">
        {onLimit && (
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="hidden sm:inline">Rows</span>
            <select
              value={limit}
              onChange={e => onLimit(Number(e.target.value))}
              disabled={disabled}
              className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-400/40 disabled:opacity-50"
            >
              {limitOptions.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        )}

        {safePages > 1 && (
          <div className="flex items-center gap-1">
            <PageBtn onClick={() => onPage(1)} disabled={disabled || page <= 1} aria-label="First page" title="First page">
              «
            </PageBtn>
            <PageBtn onClick={() => onPage(page - 1)} disabled={disabled || page <= 1} aria-label="Previous page">
              <ChevronLeft size={13} />
            </PageBtn>

            {buildPages(page, safePages).map((p, i) =>
              p === '…' ? (
                <span key={`gap-${i}`} className="px-1 text-xs text-slate-300 select-none">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => onPage(p)}
                  disabled={disabled}
                  aria-current={p === page ? 'page' : undefined}
                  className={`min-w-[28px] h-7 px-1.5 rounded-md text-xs font-medium tabular-nums transition disabled:opacity-50 ${
                    p === page
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {p}
                </button>
              ),
            )}

            <PageBtn onClick={() => onPage(page + 1)} disabled={disabled || page >= safePages} aria-label="Next page">
              <ChevronRight size={13} />
            </PageBtn>
            <PageBtn onClick={() => onPage(safePages)} disabled={disabled || page >= safePages} aria-label="Last page" title="Last page">
              »
            </PageBtn>
          </div>
        )}
      </div>
    </div>
  );
}

function PageBtn({ onClick, disabled, children, ...rest }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 min-w-[28px] items-center justify-center rounded-md px-1.5 text-xs text-slate-600 transition hover:bg-slate-200 disabled:opacity-30 disabled:pointer-events-none"
      {...rest}
    >
      {children}
    </button>
  );
}
