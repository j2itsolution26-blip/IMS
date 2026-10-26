import * as React from 'react';
import Link from 'next/link';
import { Building2, CalendarClock, CreditCard, FileText, Gem, Package, Receipt, RefreshCcw, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/misc';
import { METER_HINT, METER_LABEL } from '@/features/subscription/plan-display';
import { PlanCard, PlanCardGrid, PlanCardPill, THEME } from '@/features/billing/plan-card';
import { planCardBadges, planPricing, usageLevel, type BillingInterval } from '@/lib/billing';
import { PLANS, PLAN_ORDER, type LimitKey, type PlanId } from '@/lib/plans';
import { ACTOR_ROLE_LABEL, historyKind, type ActorRole, type DisplayTone, type HistoryKind } from '@/lib/store-detail-display';
import { formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Pieces of the administrator's store page. Each section keeps a white
 * surface and wears its colour only on the icon tile, a thin top bar and
 * its own data, so the page reads as six distinct areas without shouting.
 */

export type Section = 'subscription' | 'usage' | 'invoices' | 'payments' | 'history' | 'plans';

const SECTION: Record<Section, { bar: string; tile: string; text: string; tint: string; fill: string }> = {
  subscription: { bar: 'bg-sec-subscription', tile: 'bg-sec-subscription-tint text-sec-subscription-text', text: 'text-sec-subscription-text', tint: 'bg-sec-subscription-tint', fill: 'bg-sec-subscription' },
  usage: { bar: 'bg-sec-usage', tile: 'bg-sec-usage-tint text-sec-usage-text', text: 'text-sec-usage-text', tint: 'bg-sec-usage-tint', fill: 'bg-sec-usage' },
  invoices: { bar: 'bg-sec-invoices', tile: 'bg-sec-invoices-tint text-sec-invoices-text', text: 'text-sec-invoices-text', tint: 'bg-sec-invoices-tint', fill: 'bg-sec-invoices' },
  payments: { bar: 'bg-sec-payments', tile: 'bg-sec-payments-tint text-sec-payments-text', text: 'text-sec-payments-text', tint: 'bg-sec-payments-tint', fill: 'bg-sec-payments' },
  history: { bar: 'bg-sec-history', tile: 'bg-sec-history-tint text-sec-history-text', text: 'text-sec-history-text', tint: 'bg-sec-history-tint', fill: 'bg-sec-history' },
  plans: { bar: 'bg-sec-plans', tile: 'bg-sec-plans-tint text-sec-plans-text', text: 'text-sec-plans-text', tint: 'bg-sec-plans-tint', fill: 'bg-sec-plans' },
};

export const sectionTint = (section: Section) => SECTION[section].tint;
export const sectionText = (section: Section) => SECTION[section].text;

export function SectionCard({
  section,
  icon: Icon,
  title,
  description,
  action,
  className,
  children,
}: {
  section: Section;
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const style = SECTION[section];
  const id = `section-${section}`;
  return (
    <section aria-labelledby={id} className={cn('relative flex min-w-0 flex-col overflow-hidden rounded-card border bg-card shadow-card', className)}>
      <span className={cn('absolute inset-x-0 top-0 h-1', style.bar)} aria-hidden="true" />
      <div className="flex items-start justify-between gap-3 border-b px-4 pb-3.5 pt-5 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', style.tile)}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id={id} className="text-base font-semibold leading-tight">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>
        {action}
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/** A small empty state inside a section, in the section's colour. */
export function SectionEmpty({ section, icon: Icon, title, description }: { section: Section; icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 py-8 text-center">
      <span className={cn('mb-1 flex h-11 w-11 items-center justify-center rounded-full', SECTION[section].tile)}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

const TONE_VARIANT: Record<DisplayTone, 'success' | 'info' | 'warning' | 'destructive' | 'outline'> = {
  success: 'success',
  info: 'info',
  warning: 'warning',
  danger: 'destructive',
  neutral: 'outline',
};

export function ToneBadge({ tone, children, className }: { tone: DisplayTone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant={TONE_VARIANT[tone]} className={cn(tone === 'neutral' && 'text-muted-foreground', className)}>
      {children}
    </Badge>
  );
}

// --- Plans ---------------------------------------------------------------------

/** The plan's name as a coloured pill, in the same identity as the plan cards. */
export function PlanBadge({ plan, className }: { plan: PlanId; className?: string }) {
  const Icon = THEME[plan].icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold', THEME[plan].fill, className)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {PLANS[plan].name}
    </span>
  );
}

/**
 * The plans as the owner sees them — the same shared card — with the
 * store's plan in effect marked. Read-only: no purchase actions. Plan
 * changes stay with the header's Change plan control, prices with Billing
 * settings.
 */
export function AdminPlanCards({
  prices,
  effectivePlan,
  paidPlan,
  onTrial,
  canManage,
}: {
  prices: { plan: PlanId; interval: BillingInterval; amount: number }[];
  /** The plan in force for this store (the trial plan during a trial). */
  effectivePlan: PlanId;
  /** The plan the store bought; null during a trial. */
  paidPlan: PlanId | null;
  onTrial: boolean;
  canManage: boolean;
}) {
  const interval: BillingInterval = prices.some((price) => price.interval === 'MONTHLY' && price.amount > 0) || !prices.some((price) => price.amount > 0) ? 'MONTHLY' : 'ANNUAL';
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <PlanCardGrid>
        {PLAN_ORDER.map((id) => {
          const badges = planCardBadges(id, { paidPlan, effectivePlan, onTrial });
          const inEffect = id === effectivePlan;
          return (
            <PlanCard
              key={id}
              plan={id}
              pricing={planPricing(prices, id)}
              interval={interval}
              chip={inEffect ? (onTrial ? 'Trial plan' : 'Plan in effect') : id === 'BUSINESS' ? null : THEME[id].tag}
              popular={badges.popular}
              current={inEffect}
              action={
                inEffect ? (
                  <PlanCardPill plan={id}>{onTrial ? 'Plan in effect (Trial)' : 'Plan in effect'}</PlanCardPill>
                ) : (
                  <p className="flex min-h-12 items-center justify-center rounded-xl border border-dashed bg-card/60 px-4 text-center text-xs text-muted-foreground">
                    {paidPlan === id ? 'Bought, not in effect' : 'Not this store’s plan'}
                  </p>
                )
              }
            />
          );
        })}
      </PlanCardGrid>
      <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Limits and features come from the plan configuration; prices from Billing settings.</span>
        {canManage && (
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span>To move this store, use Change plan at the top of the page.</span>
            <Link href="/system-admin/billing/settings" className="font-semibold text-primary hover:underline">
              Manage prices
            </Link>
          </span>
        )}
      </p>
    </div>
  );
}

// --- Usage -----------------------------------------------------------------------

/** One quota: used against limit, a bar coloured by how close it is, and what it counts. */
export function UsageTile({ meter }: { meter: { key: LimitKey; used: number; limit: number | null } }) {
  const level = usageLevel(meter.used, meter.limit);
  const id = `admin-usage-${meter.key}`;
  const ratio = meter.limit ? Math.min(1, meter.used / meter.limit) : 0;
  const hot = level === 'FULL' || level === 'OVER';
  return (
    <div className="rounded-xl border bg-card p-3.5">
      <p id={id} className="text-xs font-medium text-muted-foreground">
        {METER_LABEL[meter.key]}
      </p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className={cn('tabular text-2xl font-bold', hot && 'text-destructive-text', level === 'NEAR' && 'text-warning-text')}>
          {formatNumber(meter.used, 0)}
        </span>
        <span className="text-sm text-muted-foreground">
          {level === 'UNLIMITED' ? 'of unlimited' : level === 'NOT_INCLUDED' ? '· not included' : `of ${formatNumber(meter.limit, 0)}`}
        </span>
      </p>
      {meter.limit !== null && meter.limit > 0 && (
        <Progress
          value={ratio * 100}
          className="mt-2 h-2"
          aria-labelledby={id}
          aria-valuetext={`${meter.used} of ${meter.limit} used`}
          indicatorClassName={hot ? 'bg-destructive' : level === 'NEAR' ? 'bg-warning' : 'bg-sec-usage'}
        />
      )}
      <p className={cn('mt-1.5 text-xs', hot ? 'font-medium text-destructive-text' : level === 'NEAR' ? 'text-warning-text' : 'text-muted-foreground')}>
        {level === 'OVER'
          ? 'Over the limit — nothing more can be added.'
          : level === 'FULL'
            ? 'At the limit.'
            : level === 'NEAR'
              ? `${formatNumber((meter.limit ?? 0) - meter.used, 0)} left`
              : (METER_HINT[meter.key] ?? (level === 'UNLIMITED' ? 'No limit on this plan.' : ' '))}
      </p>
    </div>
  );
}

// --- History --------------------------------------------------------------------

const KIND_ICON: Record<HistoryKind, LucideIcon> = { PAYMENT: CreditCard, INVOICE: FileText, PLAN: RefreshCcw, STATUS: CalendarClock };

const ROLE_STYLE: Record<ActorRole, string> = {
  OWNER: 'bg-sec-subscription-tint text-sec-subscription-text',
  STAFF: 'bg-muted text-muted-foreground',
  ADMIN: 'bg-sec-plans-tint text-sec-plans-text',
  SYSTEM: 'bg-muted text-muted-foreground',
};

/** Subscription changes as an activity feed: what happened, who did it, when. */
export function HistoryTimeline({
  entries,
  storeName,
}: {
  entries: { id: string; entity: string; summary: string; actorName: string | null; actorRole: ActorRole; createdAt: Date }[];
  storeName: string;
}) {
  return (
    <ol className="px-4 py-4 sm:px-5">
      {entries.map((entry, index) => {
        const Icon = KIND_ICON[historyKind(entry)];
        return (
          <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
            {index < entries.length - 1 && <span className="absolute left-[15px] top-9 h-[calc(100%-2rem)] w-px bg-sec-history/30" aria-hidden="true" />}
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sec-history-tint text-sec-history-text ring-4 ring-card">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm">{entry.summary.replace(`${storeName}: `, '')}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span className={cn('rounded-full px-2 py-0.5 font-semibold', ROLE_STYLE[entry.actorRole])}>{ACTOR_ROLE_LABEL[entry.actorRole]}</span>
                {entry.actorName && entry.actorRole !== 'SYSTEM' && <span className="font-medium text-foreground">{entry.actorName}</span>}
                <time dateTime={entry.createdAt.toISOString()}>{formatDateTime(entry.createdAt)}</time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export const SECTION_ICON = { subscription: Building2, usage: Package, invoices: FileText, payments: Receipt, history: CalendarClock, plans: Gem } as const;
