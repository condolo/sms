import clsx from 'clsx';

const SIZES = {
  xs:  'h-3 w-3 border-[1.5px]',
  sm:  'h-4 w-4 border-2',
  md:  'h-6 w-6 border-2',
  lg:  'h-9 w-9 border-[3px]',
  xl:  'h-14 w-14 border-4',
};

/**
 * Accessible spinning indicator.
 * @param {{ size?: 'xs'|'sm'|'md'|'lg'|'xl', className?: string, label?: string }} props
 */
export function Spinner({ size = 'md', className, label = 'Loading…' }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={clsx(
        'inline-block rounded-full border-slate-200 border-t-brand-600 animate-spin',
        SIZES[size] ?? SIZES.md,
        className,
      )}
    />
  );
}

/** Full-page loading overlay */
export function PageSpinner({ message = 'Loading…', subtext }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-3 text-slate-500">
      <Spinner size="lg" />
      <p className="text-sm font-medium">{message}</p>
      {subtext && <p className="text-xs text-slate-400">{subtext}</p>}
    </div>
  );
}
