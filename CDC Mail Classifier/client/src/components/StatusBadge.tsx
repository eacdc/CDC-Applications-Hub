import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  needsReview?: boolean;
  reviewed?: boolean;
  confidence?: number;
  compact?: boolean;
}

export default function StatusBadge({ needsReview, reviewed, confidence, compact }: StatusBadgeProps) {
  const styles = compact
    ? 'inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium leading-none'
    : 'inline-flex rounded px-2 py-0.5 text-xs font-medium';

  if (reviewed) {
    return (
      <span className={cn(styles, 'bg-emerald-900/50 text-emerald-300 ring-1 ring-emerald-700/50')}>
        {compact ? 'Done' : 'Reviewed'}
      </span>
    );
  }

  if (needsReview) {
    return (
      <span className={cn(styles, 'bg-amber-900/50 text-amber-300 ring-1 ring-amber-700/50')}>
        {compact ? 'Review' : 'Needs review'}
      </span>
    );
  }

  if (confidence !== undefined && confidence >= 0.7) {
    return (
      <span className={cn(styles, 'bg-slate-800 text-slate-400 ring-1 ring-slate-700')}>
        OK
      </span>
    );
  }

  return null;
}
