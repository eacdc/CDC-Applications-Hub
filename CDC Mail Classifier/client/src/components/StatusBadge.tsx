import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  needsReview?: boolean;
  reviewed?: boolean;
  confidence?: number;
}

export default function StatusBadge({ needsReview, reviewed, confidence }: StatusBadgeProps) {
  if (reviewed) {
    return (
      <span className={cn('inline-flex rounded px-2 py-0.5 text-xs font-medium', 'bg-emerald-900/50 text-emerald-300 ring-1 ring-emerald-700/50')}>
        Reviewed
      </span>
    );
  }

  if (needsReview) {
    return (
      <span className={cn('inline-flex rounded px-2 py-0.5 text-xs font-medium', 'bg-amber-900/50 text-amber-300 ring-1 ring-amber-700/50')}>
        Needs review
      </span>
    );
  }

  if (confidence !== undefined && confidence >= 0.7) {
    return (
      <span className={cn('inline-flex rounded px-2 py-0.5 text-xs font-medium', 'bg-slate-800 text-slate-400 ring-1 ring-slate-700')}>
        OK
      </span>
    );
  }

  return null;
}
