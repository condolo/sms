import clsx from 'clsx';
import { Users } from 'lucide-react';
import { avatarTone, initials } from '../constants.js';

const SIZES = {
  xs: 'h-7 w-7 text-[10px]',
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-11 w-11 text-sm',
  xl: 'h-14 w-14 text-base',
  '2xl': 'h-16 w-16 text-lg',
};

const GROUP_SIZES = {
  xs: 12,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  '2xl': 26,
};

export default function Avatar({
  name = '?',
  size = 'md',
  group = false,
  className,
  title,
}) {
  return (
    <div
      title={title ?? name}
      className={clsx(
        'relative shrink-0 select-none rounded-full text-white font-semibold',
        'flex items-center justify-center shadow-sm ring-2 ring-white/80',
        size === '2xl' || size === 'xl' ? 'rounded-2xl' : '',
        group
          ? 'bg-gradient-to-br from-violet-500 via-indigo-500 to-blue-500'
          : `bg-gradient-to-br ${avatarTone(name)}`,
        SIZES[size] ?? SIZES.md,
        className,
      )}
    >
      {group
        ? <Users size={GROUP_SIZES[size] ?? 15} strokeWidth={2.2} />
        : initials(name)}
    </div>
  );
}
