import * as React from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { Sparkline } from '@/components/charts/sparkline';
import { Skeleton } from '@/components/ui/misc';
import { formatSignedPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

export type KpiTone = 'default' | 'success' | 'warning' | 'destructive';

const TONE_ICON: Record<KpiTone, string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success-text',
  warning: 'bg-warning/15 text-warning-text',
  destructive: 'bg-destructive/10 text-destructive-text',
};

const CARD = 'flex h-full flex-col rounded-card border bg-card p-4 shadow-card';

export interface KpiCardProps {
  label: string;
  /** Pre-formatted on the server, so currency and locale come from settings. */
  value: string;
  icon?: LucideIcon;
  tone?: KpiTone;
  /** Period-over-period change. Null renders nothing rather than a fake 0%. */
  change?: number | null;
  /** What the change is measured against, e.g. "vs yesterday". */
  changeLabel?: string;
  /** Extra context under the value. */
  hint?: string;
  /** A short real series for the sparkline; fewer than two points draws none. */
  series?: number[];
  href?: string;
  /** True when a rise is bad (returns, expenses), so the colour flips. */
  invertChange?: boolean;
}

/**
 * One headline figure — the single KPI card every screen uses.
 *
 * The number carries the card; the icon, trend and sparkline are support and
 * are sized to stay that way. A change of null renders nothing rather than an
 * invented 0%, so a store with no history yesterday does not read as flat.
 */
export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = 'default',
  change,
  changeLabel,
  hint,
  series,
  href,
  invertChange = false,
}: KpiCardProps) {
  const isFlat = change != null && Math.abs(change) < 0.05;
  const isUp = change != null && change > 0;
  const isGood = invertChange ? !isUp : isUp;
  const TrendIcon = isFlat ? ArrowRight : isUp ? ArrowUpRight : ArrowDownRight;

  const body = (
    <div className={cn(CARD, 'transition-colors', href && 'hover:border-primary/40')}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TONE_ICON[tone])}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
      </div>

      {/* Long currency values wrap rather than overflow a two-up phone grid. */}
      <p className="tabular mt-2 text-xl font-bold leading-none tracking-tight [overflow-wrap:anywhere] sm:text-kpi">
        {value}
      </p>

      {/* Rendered only when there is something to say, so a card carrying just
          a label and a number stays compact instead of padding itself out. */}
      {(change != null || hint) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
          {change != null && (
            <span
              className={cn(
                'inline-flex items-center gap-0.5 font-semibold',
                isFlat ? 'text-muted-foreground' : isGood ? 'text-success-text' : 'text-destructive-text',
              )}
            >
              <TrendIcon className="h-3 w-3" aria-hidden="true" />
              {formatSignedPercent(change)}
            </span>
          )}
          {changeLabel && change != null && <span className="text-muted-foreground">{changeLabel}</span>}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      )}

      {series && series.length > 1 && (
        <div className="-mx-1 mt-auto pt-3">
          <Sparkline data={series} tone={tone === 'warning' ? 'warning' : tone === 'success' ? 'success' : 'primary'} />
        </div>
      )}
    </div>
  );

  return href ? (
    <Link
      href={href}
      className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

/** The card's shape while its figure loads, so the grid does not jump. */
export function KpiCardSkeleton() {
  return (
    <div className={CARD} aria-hidden="true">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
      <Skeleton className="mt-2 h-6 w-32" />
      <Skeleton className="mt-2 h-3 w-40" />
    </div>
  );
}
