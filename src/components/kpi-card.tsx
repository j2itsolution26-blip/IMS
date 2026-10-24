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

const CARD = 'flex h-full flex-col rounded-card border bg-card p-4 text-card-foreground shadow-card sm:p-5';

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
  /**
   * A small figure beside the value — `KpiBars` or `KpiRing`. It must chart
   * the same measure as the value, never a nearby one.
   */
  visual?: React.ReactNode;
  /** Makes the whole card a link. Ignored when `footer` is given. */
  href?: string;
  /** A labelled link under a divider, e.g. "See sales". */
  footer?: { label: string; href: string };
  /** The one dark "hero" card in a row. Use at most once per row. */
  inverse?: boolean;
  /** True when a rise is bad (returns, expenses), so the colour flips. */
  invertChange?: boolean;
}

/**
 * One headline figure — the single KPI card every screen uses.
 *
 * The number carries the card; the icon, change, visual and link are support
 * and are sized to stay that way. A change of null renders nothing rather than
 * an invented 0%, so a store with no history yesterday does not read as flat.
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
  visual,
  href,
  footer,
  inverse = false,
  invertChange = false,
}: KpiCardProps) {
  const isFlat = change != null && Math.abs(change) < 0.05;
  const isUp = change != null && change > 0;
  const isGood = invertChange ? !isUp : isUp;
  const TrendIcon = isFlat ? ArrowRight : isUp ? ArrowUpRight : ArrowDownRight;
  const cardLink = href && !footer ? href : undefined;

  const body = (
    <div
      className={cn(
        CARD,
        // The dark theme's tokens, scoped to this card: a navy card in light
        // mode, lifted a step in dark mode (see .kpi-inverse in globals.css).
        inverse && 'dark kpi-inverse border-transparent',
        cardLink && 'transition-colors hover:border-primary/40',
      )}
    >
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full', TONE_ICON[tone])}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <div className="min-w-0">
          {/* Long currency values wrap rather than overflow a two-up phone grid. */}
          <p className="tabular text-xl font-bold leading-none tracking-tight [overflow-wrap:anywhere] sm:text-kpi">
            {value}
          </p>

          {/* Rendered only when there is something to say, so a card carrying
              just a label and a number stays compact. */}
          {(change != null || hint) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
              {change != null && (
                <span
                  className={cn(
                    'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-semibold',
                    isFlat
                      ? 'bg-muted text-muted-foreground'
                      : isGood
                        ? 'bg-success/15 text-success-text'
                        : 'bg-destructive/15 text-destructive-text',
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
        </div>

        {visual && <div className="shrink-0">{visual}</div>}
      </div>

      {series && series.length > 1 && (
        <div className="-mx-1 pt-3">
          <Sparkline data={series} tone={tone === 'warning' ? 'warning' : tone === 'success' ? 'success' : 'primary'} />
        </div>
      )}

      {footer && (
        <div className="mt-auto pt-4">
          <div className="border-t border-dashed pt-3">
            <Link
              href={footer.href}
              className="rounded-sm text-sm font-medium underline decoration-muted-foreground/50 underline-offset-4 transition-colors hover:decoration-current"
            >
              {footer.label}
            </Link>
          </div>
        </div>
      )}
    </div>
  );

  return cardLink ? (
    <Link
      href={cardLink}
      className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Mini column chart for a card. Decorative — the figure is written out in the
 * card — so it is hidden from assistive technology. Shows at most the latest
 * `max` buckets; the latest is drawn solid, the rest muted.
 */
export function KpiBars({ data, max = 16 }: { data: number[]; max?: number }) {
  const points = data.slice(-max);
  const peak = Math.max(...points, 0);
  if (points.length < 2 || peak <= 0) return null;

  return (
    <div className="flex h-11 items-end gap-[3px]" aria-hidden="true">
      {points.map((value, index) => (
        <span
          key={index}
          className={cn('w-1.5 rounded-full', index === points.length - 1 ? 'bg-primary' : 'bg-muted-foreground/30')}
          // A visible stub for zero buckets keeps the time axis readable.
          style={{ height: `${Math.max((value / peak) * 100, 6)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * A share as a ring. Decorative: the caller states the share in words in the
 * card's hint, so the ring is hidden from assistive technology.
 */
export function KpiRing({ value }: { value: number }) {
  const share = Math.min(Math.max(value, 0), 1);
  const radius = 18;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative h-12 w-12" aria-hidden="true">
      <svg viewBox="0 0 44 44" className="h-full w-full -rotate-90">
        <circle cx="22" cy="22" r={radius} fill="none" strokeWidth="5" className="stroke-muted" />
        <circle
          cx="22"
          cy="22"
          r={radius}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          className="stroke-primary"
          strokeDasharray={`${share * circumference} ${circumference}`}
        />
      </svg>
      <span className="tabular absolute inset-0 flex items-center justify-center text-[10px] font-semibold">
        {Math.round(share * 100)}%
      </span>
    </div>
  );
}

/** The card's shape while its figure loads, so the grid does not jump. */
export function KpiCardSkeleton() {
  return (
    <div className={CARD} aria-hidden="true">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <Skeleton className="mt-2 h-6 w-32" />
      <Skeleton className="mt-2.5 h-3 w-40" />
    </div>
  );
}
