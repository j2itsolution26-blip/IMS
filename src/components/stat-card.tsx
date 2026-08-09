import * as React from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatSignedPercent } from '@/lib/format';

export type StatTone = 'default' | 'success' | 'warning' | 'destructive';

const TONE_ICON: Record<StatTone, string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
};

export interface StatCardProps {
  label: string;
  value: string;
  icon?: LucideIcon;
  tone?: StatTone;
  /** Period-over-period change. Null renders nothing rather than a fake 0%. */
  change?: number | null;
  /** What the change is measured against, e.g. "vs yesterday". */
  changeLabel?: string;
  /** Extra context under the value. */
  hint?: string;
  href?: string;
  /** True when a rise is bad (returns, expenses) so the colour flips. */
  invertChange?: boolean;
}

/**
 * A single KPI. The value is always passed in pre-formatted from the server so
 * currency and locale come from settings, not from a hardcoded symbol.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'default',
  change,
  changeLabel,
  hint,
  href,
  invertChange = false,
}: StatCardProps) {
  const isFlat = change != null && Math.abs(change) < 0.05;
  const isUp = change != null && change > 0;
  const isGood = invertChange ? !isUp : isUp;

  const body = (
    <Card
      className={cn(
        'h-full p-4 transition-colors',
        href && 'hover:border-primary/40 hover:bg-accent/40',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', TONE_ICON[tone])}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        )}
      </div>

      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
        {change != null && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-medium',
              isFlat ? 'text-muted-foreground' : isGood ? 'text-success' : 'text-destructive',
            )}
          >
            {isFlat ? (
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            ) : isUp ? (
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
            )}
            {formatSignedPercent(change)}
          </span>
        )}
        {changeLabel && change != null && <span className="text-muted-foreground">{changeLabel}</span>}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>
    </Card>
  );

  return href ? (
    <Link href={href} className="block rounded-lg focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}
