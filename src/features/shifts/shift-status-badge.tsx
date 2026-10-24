import { Badge } from '@/components/ui/badge';
import type { ShiftDisplayStatus } from '@/lib/shift-review';
import type { VarianceKind } from '@/lib/shift-math';
import { formatCurrency } from '@/lib/format';
import { cn } from '@/lib/utils';

const STATUS = {
  OPEN: { label: 'Open', variant: 'default' },
  CLOSED: { label: 'Closed', variant: 'secondary' },
  REQUIRES_REVIEW: { label: 'Requires review', variant: 'warning' },
  REVIEWED: { label: 'Reviewed', variant: 'success' },
} as const;

export function ShiftStatusBadge({ status }: { status: ShiftDisplayStatus }) {
  const meta = STATUS[status];
  return (
    <Badge variant={meta.variant} className="whitespace-nowrap">
      {status === 'OPEN' && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {meta.label}
    </Badge>
  );
}

/** "Balanced", or the signed shortage/overage — colour plus words, never colour alone. */
export function VarianceText({
  difference,
  kind,
  currency,
  className,
}: {
  difference: number | null;
  kind: VarianceKind | null;
  currency: string;
  className?: string;
}) {
  if (difference == null || kind == null) return <span className="text-muted-foreground">—</span>;
  if (kind === 'BALANCED') return <span className={cn('text-success-text', className)}>Balanced</span>;
  return (
    <span className={cn('whitespace-nowrap', kind === 'SHORTAGE' ? 'text-destructive-text' : 'text-warning-text', className)}>
      {kind === 'SHORTAGE' ? 'Short ' : 'Over '}
      {formatCurrency(Math.abs(difference), currency)}
    </span>
  );
}
