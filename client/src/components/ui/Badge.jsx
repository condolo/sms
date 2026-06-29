import clsx from 'clsx';

const VARIANTS = {
  default:   'bg-slate-100 text-slate-700',
  primary:   'bg-brand-100 text-brand-700',
  success:   'bg-green-100 text-green-700',
  warning:   'bg-amber-100 text-amber-700',
  danger:    'bg-red-100 text-red-700',
  info:      'bg-blue-100 text-blue-700',
  purple:    'bg-purple-100 text-purple-700',
};

const SIZES = {
  sm: 'px-1.5 py-0.5 text-[10px]',
  md: 'px-2.5 py-0.5 text-xs',
  lg: 'px-3 py-1 text-sm',
};

/**
 * Small label pill.
 * @param {{ variant?: keyof VARIANTS, size?: 'sm'|'md'|'lg', dot?: boolean, className?: string }} props
 */
export function Badge({ children, variant = 'default', size = 'md', dot = false, className }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        VARIANTS[variant] ?? VARIANTS.default,
        SIZES[size] ?? SIZES.md,
        className,
      )}
    >
      {dot && (
        <span
          className={clsx('h-1.5 w-1.5 rounded-full', {
            'bg-slate-500':  variant === 'default',
            'bg-brand-500':  variant === 'primary',
            'bg-green-500':  variant === 'success',
            'bg-amber-500':  variant === 'warning',
            'bg-red-500':    variant === 'danger',
            'bg-blue-500':   variant === 'info',
            'bg-purple-500': variant === 'purple',
          })}
        />
      )}
      {children}
    </span>
  );
}

// ─── Status → variant mapping helpers ────────────────────────────────────────

export function studentStatusBadge(status) {
  const map = { active: 'success', inactive: 'danger', suspended: 'warning', graduated: 'info' };
  return <Badge variant={map[status] ?? 'default'} dot>{status}</Badge>;
}

export function invoiceStatusBadge(status) {
  const map = { paid: 'success', partial: 'warning', unpaid: 'danger', voided: 'default', overdue: 'danger' };
  return <Badge variant={map[status] ?? 'default'} dot>{status}</Badge>;
}

export function admissionStageBadge(stage) {
  const map = {
    enquiry: 'info', applied: 'primary', shortlisted: 'purple',
    assessed: 'warning', offered: 'success', enrolled: 'success',
    rejected: 'danger', withdrawn: 'default',
  };
  return <Badge variant={map[stage] ?? 'default'}>{stage}</Badge>;
}
