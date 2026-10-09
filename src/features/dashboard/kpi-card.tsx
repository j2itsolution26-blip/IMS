import * as React from 'react';
import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { Sparkline } from '@/components/charts/sparkline';
import { formatSignedPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

export type KpiTone = 'default' | 'success' | 'warning' | 'destructive';

const TONE_ICON: Record<KpiTone, string> = {
  default: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
};

/**
 * One headline figure.
 *
 * The number carries the card; the icon, trend and sparkline are support and
 * are sized to stay that way. A change of null renders nothing rather than a
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
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: KpiTone;
  change?: number | null;
  changeLabel?: string;
  hint?: string;
  series?: number[];
  href?: string;
  /** True when a rise is bad, so the colour flips. */
  invertChange?: boolean;
}) {
  const isFlat = change != null && Math.abs(change) < 0.05;
  const isUp = change != null && change > 0;
  const isGood = invertChange ? !isUp : isUp;
  const TrendIcon = isFlat ? ArrowRight : isUp ? ArrowUpRight : ArrowDownRight;

  const body = (
    <div
      className={cn(
        'flex h-full flex-col rounded-xl border bg-card p-4 shadow-2xs transition-colors',
        href && 'hover:border-primary/40',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <span
          className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', TONE_ICON[tone])}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>

      <p className="tabular mt-2 text-[28px] font-bold leading-none tracking-tight">{value}</p>

      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-1.5 text-xs">
        {change != null && (
          <span
            className={cn(
              'inline-flex items-center gap-0.5 font-semibold',
              isFlat ? 'text-muted-foreground' : isGood ? 'text-success' : 'text-destructive',
            )}
          >
            <TrendIcon className="h-3 w-3" aria-hidden="true" />
            {formatSignedPercent(change)}
          </span>
        )}
        {changeLabel && change != null && <span className="text-muted-foreground">{changeLabel}</span>}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </div>

      {series && series.length > 1 && (
        <div className="-mx-1 mt-auto pt-3">
          <Sparkline data={series} tone={tone === 'warning' ? 'warning' : tone === 'success' ? 'success' : 'primary'} />
        </div>
      )}
    </div>
  );

  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      {body}
    </Link>
  ) : (
    body
  );
}
