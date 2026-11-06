import * as React from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Crown, Gem, History, Package, Store, Users, Zap, type LucideIcon } from 'lucide-react';
import { CORE_FEATURES, FEATURE_LABEL, PLANS, PLAN_ORDER, previousPlan, staffSlotSummary, type Feature, type LimitKey, type PlanId, type StaffSlotSlug } from '@/lib/plans';
import { annualSavingsPercent, type BillingInterval, type PlanPricing } from '@/lib/billing';
import { formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PlanWhyButton } from '@/features/billing/plan-why-dialog';
import { gainsOver } from '@/features/billing/plan-reasons';

/**
 * The one plan card, shared by the owner's Subscription & Billing page and
 * the System Admin's store page so the two can never drift apart. Pure
 * presentation with no hooks: what a plan includes comes from lib/plans,
 * prices from the published price list, and each page passes its own
 * role-appropriate action into the card.
 *
 * The card is always drawn dark (charcoal, with the plan's accent), on the
 * owner's pricing section and on the light admin page alike.
 */

const peso = (amount: number) => formatCurrency(amount, 'PHP');

export const INTERVAL_OPTION: Record<BillingInterval, string> = { MONTHLY: 'Monthly', ANNUAL: 'Yearly' };

/**
 * Each plan's colours on light surfaces (the invoice, the admin plan badge):
 * Basic blue, Business green, Enterprise purple, from the theme tokens.
 * Presentation only — what a plan includes lives in lib/plans.
 */
export const THEME: Record<PlanId, { icon: LucideIcon; tag: string; card: string; soft: string; check: string; fill: string; hover: string }> = {
  BASIC: {
    icon: Package,
    tag: 'For Small Stores',
    card: 'border-plan-basic-border bg-gradient-to-b from-plan-basic-tint to-card',
    soft: 'bg-plan-basic/10 text-plan-basic-text',
    check: 'text-plan-basic-text',
    fill: 'bg-plan-basic text-white',
    hover: 'hover:bg-plan-basic/90',
  },
  BUSINESS: {
    icon: Users,
    tag: 'Most Popular',
    card: 'border-2 border-primary/60 bg-gradient-to-b from-mint to-card',
    soft: 'bg-primary/10 text-primary',
    check: 'text-success-text',
    fill: 'bg-primary text-primary-foreground',
    hover: 'hover:bg-primary/90',
  },
  ENTERPRISE: {
    icon: Gem,
    tag: 'Advanced Plan',
    card: 'border-plan-enterprise-border bg-gradient-to-b from-plan-enterprise-tint to-card',
    soft: 'bg-plan-enterprise/10 text-plan-enterprise-text',
    check: 'text-plan-enterprise-text',
    fill: 'bg-plan-enterprise text-white',
    hover: 'hover:bg-plan-enterprise/90',
  },
};

/** The pricing cards' own palette, always dark: charcoal with the plan's accent. */
export const CARD_THEME: Record<PlanId, { card: string; badge: string; soft: string; check: string; fill: string; bar: string }> = {
  BASIC: {
    card: 'border-white/10 bg-[#141518] hover:border-blue-400/40',
    badge: 'border border-blue-400/30 bg-[#16233f] text-blue-200',
    soft: 'bg-blue-500/15 text-blue-300',
    check: 'text-blue-400',
    fill: 'bg-blue-600 text-white hover:bg-blue-500 focus-visible:ring-blue-300',
    bar: 'bg-blue-500',
  },
  BUSINESS: {
    card: 'border-emerald-400/70 bg-[#141518] bg-gradient-to-b from-emerald-500/[0.09] via-[#141518] to-[#141518] shadow-[0_0_48px_-16px_rgba(16,185,129,0.55)]',
    badge: 'bg-emerald-400 text-emerald-950',
    soft: 'bg-emerald-400/15 text-emerald-300',
    check: 'text-emerald-400',
    fill: 'bg-emerald-400 text-emerald-950 hover:bg-emerald-300 focus-visible:ring-emerald-200',
    bar: 'bg-emerald-400',
  },
  ENTERPRISE: {
    card: 'border-violet-500/55 bg-[#141518] bg-gradient-to-b from-violet-500/[0.10] via-[#141518] to-[#141518] hover:shadow-[0_0_48px_-16px_rgba(139,92,246,0.5)]',
    badge: 'border border-violet-400/40 bg-[#26193f] text-violet-200',
    soft: 'bg-violet-500/20 text-violet-300',
    check: 'text-violet-400',
    fill: 'bg-violet-600 text-white hover:bg-violet-500 focus-visible:ring-violet-300',
    bar: 'bg-violet-500',
  },
};

/** "2 Cashiers, 1 Inventory Staff" */
export function staffSplit(slots: Record<StaffSlotSlug, number>): string {
  return staffSlotSummary(slots);
}

/** A plan's locations (physical stores or branches, never devices), from the plan configuration. */
export function locationLine(id: PlanId): { headline: string; detail: string } {
  const branches = PLANS[id].limits.branches;
  if (branches === null) return { headline: 'Unlimited locations', detail: 'Physical stores or branches' };
  if (branches === 1) return { headline: '1 location included', detail: 'One physical store' };
  return { headline: `Up to ${formatNumber(branches, 0)} locations`, detail: 'Physical stores or branches, viewed one by one or together' };
}

// The invoice's summary of a plan (invoice-payment.tsx). Locations are shown on their own.
const LIMIT_ROWS: { key: LimitKey; one: string; many: string }[] = [
  { key: 'staff', one: 'staff account', many: 'staff accounts' },
  { key: 'products', one: 'product', many: 'products' },
  { key: 'backgroundRemovalsPerMonth', one: 'background removal / month', many: 'background removals / month' },
];
const FEATURE_ROWS: Feature[] = ['reportExports', 'customRoles'];

function limitLine(value: number | null, row: { one: string; many: string }): { text: string; included: boolean } {
  if (value === null) return { text: `Unlimited ${row.many}`, included: true };
  if (value === 0) return { text: row.many.charAt(0).toUpperCase() + row.many.slice(1), included: false };
  if (value === 1) return { text: `${value} ${row.one}`, included: true };
  return { text: `Up to ${formatNumber(value, 0)} ${row.many}`, included: true };
}

/** What a plan includes besides locations, included lines first: staff, products, removals, history, exports, roles. */
export function featureLines(id: PlanId): { text: string; included: boolean }[] {
  const plan = PLANS[id];
  const lines = [
    ...LIMIT_ROWS.map((row) => {
      const line = limitLine(plan.limits[row.key], row);
      // Basic's staff places are one per role.
      return row.key === 'staff' && plan.staffSlots !== null && line.included ? { ...line, text: `${line.text} (${staffSplit(plan.staffSlots)})` } : line;
    }),
    { text: plan.auditHistoryDays === null ? 'Full audit history' : `${plan.auditHistoryDays}-day audit history`, included: true },
    ...FEATURE_ROWS.map((feature) => ({ text: FEATURE_LABEL[feature], included: plan.features[feature] })),
  ];
  return [...lines.filter((line) => line.included), ...lines.filter((line) => !line.included)];
}

export interface CapacityRow {
  key: 'staff' | 'products' | 'history';
  text: string;
  detail: string | null;
}

/** Staff, products and activity history, in the same order on every card, from the plan configuration. */
export function capacityRows(id: PlanId): CapacityRow[] {
  const plan = PLANS[id];
  const { staff, products } = plan.limits;
  return [
    {
      key: 'staff',
      text: staff === null ? 'Unlimited staff accounts' : staff === 1 ? `${staff} staff account` : `Up to ${formatNumber(staff, 0)} staff accounts`,
      detail: plan.staffSlots ? staffSplit(plan.staffSlots) : 'Any mix of roles',
    },
    {
      key: 'products',
      text: products === null ? 'Unlimited products' : `Up to ${formatNumber(products, 0)} products`,
      detail: 'Archived products do not count',
    },
    {
      key: 'history',
      text: plan.auditHistoryDays === null ? 'Full activity history' : `${formatNumber(plan.auditHistoryDays, 0)}-day activity history`,
      detail: 'Audit & Activity Center',
    },
  ];
}

const CAPACITY_ICON: Record<CapacityRow['key'], LucideIcon> = { staff: Users, products: Package, history: History };

/** The per-branch view, offered only where a plan has more than one location. */
export const BRANCH_VIEW_LINE = 'Dashboard, sales and reports for each branch or all branches';

/** Basic's lead lines: the core features an owner looks for first. */
const BASIC_LEAD = [CORE_FEATURES[0], CORE_FEATURES[1], CORE_FEATURES[4], CORE_FEATURES[6]];

const FEATURE_ORDER: Feature[] = ['reportExports', 'customRoles', 'backgroundRemoval'];

function featureText(id: PlanId, feature: Feature): string {
  const removals = PLANS[id].limits.backgroundRemovalsPerMonth;
  return feature === 'backgroundRemoval' && removals ? `${FEATURE_LABEL[feature]} (up to ${formatNumber(removals, 0)} a month)` : FEATURE_LABEL[feature];
}

/**
 * The short list a card shows (`lead`, at most four lines, so no plan looks
 * longer than another) and everything the plan includes (`all`, behind
 * "View all features"). From the plan configuration; nothing announced but
 * unbuilt is listed.
 */
export function planHighlights(id: PlanId): { lead: string[]; all: string[] } {
  const plan = PLANS[id];
  const multiBranch = plan.limits.branches === null || plan.limits.branches > 1;
  const included = FEATURE_ORDER.filter((feature) => plan.features[feature]);
  const all = [...CORE_FEATURES, ...(multiBranch ? [BRANCH_VIEW_LINE] : []), ...included.map((feature) => featureText(id, feature))];

  const lower = previousPlan(id);
  if (!lower) return { lead: [...BASIC_LEAD], all };

  // What this plan adds: the branch view and new features first, then the
  // larger limits (the same comparison the "Why …?" dialog explains).
  const gained = included.filter((feature) => !lower.features[feature]).map((feature) => featureText(id, feature));
  const lowerMulti = lower.limits.branches === null || lower.limits.branches > 1;
  const capacity = gainsOver(plan, lower).filter((gain) => !Object.values(FEATURE_LABEL).includes(gain));
  const lead = [...new Set([`Everything in ${lower.name}`, ...(multiBranch && !lowerMulti ? [BRANCH_VIEW_LINE] : []), ...gained, ...capacity])].slice(0, 4);
  return { lead, all };
}

/** The three cards' grid. Cards line their rows up through subgrid; Enterprise centres under the others on tablets. */
export function PlanCardGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ul className={cn('grid gap-x-5 gap-y-8 pt-4 md:grid-cols-2 xl:grid-cols-3', className)}>{children}</ul>;
}

/** The plan's "Current plan"-style pill, for a card's action row. Not a button. */
export function PlanCardPill({ plan, children }: { plan: PlanId; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold text-white')}>
      <Crown className={cn('h-4 w-4', CARD_THEME[plan].check)} aria-hidden="true" />
      {children}
    </div>
  );
}

/** The button style for a plan's main action, so pages need no colour logic of their own. */
export function planButtonClass(plan: PlanId): string {
  return cn(
    'inline-flex min-h-12 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold shadow-sm transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141518] disabled:pointer-events-none disabled:opacity-50',
    CARD_THEME[plan].fill,
  );
}

export interface LocationUsage {
  used: number;
  limit: number | null;
  /** Where to add a branch, when there is room and the viewer may. */
  addHref: string | null;
  /** Shown when every location is in use. */
  fullHint: string | null;
}

function LocationMeter({ plan, usage }: { plan: PlanId; usage: LocationUsage }) {
  const { used, limit } = usage;
  const full = limit !== null && used >= limit;
  const remaining = limit === null ? null : Math.max(0, limit - used);
  return (
    <div className="mt-3 space-y-1.5 border-t border-white/10 pt-3">
      <p className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-white">
          {limit === null ? `${formatNumber(used, 0)} in use` : `${formatNumber(used, 0)} of ${formatNumber(limit, 0)} locations used`}
        </span>
        {remaining !== null && <span className={full ? 'text-amber-300' : 'text-zinc-400'}>{full ? 'All in use' : `${formatNumber(remaining, 0)} left`}</span>}
      </p>
      {limit !== null && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-label="Locations used"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
        >
          <div className={cn('h-full rounded-full', full ? 'bg-amber-400' : CARD_THEME[plan].bar)} style={{ width: `${Math.min(100, (used / Math.max(limit, 1)) * 100)}%` }} />
        </div>
      )}
      {full ? (
        usage.fullHint && <p className="text-xs text-zinc-400">{usage.fullHint}</p>
      ) : (
        usage.addHref && (
          <Link href={usage.addHref} className="inline-block text-xs font-semibold text-white underline-offset-4 hover:underline">
            Add a location →
          </Link>
        )
      )}
    </div>
  );
}

export function PlanCard({
  plan: id,
  pricing,
  interval,
  badge,
  current,
  locationUsage = null,
  action,
}: {
  plan: PlanId;
  pricing: PlanPricing;
  interval: BillingInterval;
  /** The label on the card's top edge ("Current plan", "Your trial", the plan's tag), or null. */
  badge: string | null;
  /** Marks the card as the store's plan (aria-current). */
  current: boolean;
  /** Locations in use, on the plan in force. */
  locationUsage?: LocationUsage | null;
  /** The page's own role-appropriate action, or nothing. */
  action: React.ReactNode;
}) {
  const plan = PLANS[id];
  const theme = CARD_THEME[id];
  const Icon = THEME[id].icon;
  const savePercent = annualSavingsPercent(pricing);
  const amount = interval === 'MONTHLY' ? pricing.monthly : pricing.annual;
  const location = locationLine(id);
  const highlights = planHighlights(id);
  const more = highlights.all.filter((line) => !highlights.lead.includes(line));
  return (
    <li
      aria-current={current ? 'true' : undefined}
      aria-label={`${plan.name} plan`}
      className={cn(
        'dark relative row-span-5 grid grid-rows-subgrid gap-y-5 rounded-2xl border p-5 text-zinc-100 transition-[border-color,box-shadow] duration-200 [color-scheme:dark] motion-reduce:transition-none sm:p-6',
        theme.card,
        current && 'ring-1 ring-white/25',
        id === 'ENTERPRISE' && 'md:col-span-2 md:w-[calc(50%-0.625rem)] md:justify-self-center xl:col-span-1 xl:w-auto xl:justify-self-stretch',
      )}
    >
      {badge && (
        <span
          className={cn(
            'absolute -top-3 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] shadow-md',
            current ? 'border border-white/25 bg-[#26272c] text-white' : theme.badge,
          )}
        >
          {(current || id === 'BUSINESS') && <Crown className="h-3 w-3" aria-hidden="true" />}
          {badge}
        </span>
      )}

      {/* Row 1: identity */}
      <div className="space-y-3 pt-1">
        <div className="flex items-center gap-3">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', theme.soft)}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="text-xl font-bold tracking-tight text-white">{plan.name}</h3>
        </div>
        <p className="text-sm leading-relaxed text-zinc-400">{plan.description}</p>
      </div>

      {/* Row 2: price */}
      <div>
        {amount !== null ? (
          <>
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="tabular text-[2.5rem] font-extrabold leading-none tracking-tight text-white">{peso(amount)}</span>
              <span className="text-sm text-zinc-400">/ {interval === 'MONTHLY' ? 'month' : 'year'}</span>
            </p>
            <p className="mt-2.5 flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
              {interval === 'MONTHLY' &&
                (pricing.annual !== null ? (
                  <>
                    <span className="tabular">or {peso(pricing.annual)} a year</span>
                    {savePercent !== null && <span className={cn('rounded-md px-1.5 py-0.5 font-semibold', theme.soft)}>Save {savePercent}%</span>}
                  </>
                ) : (
                  <span>Billed monthly</span>
                ))}
              {interval === 'ANNUAL' && (
                <>
                  {pricing.annualPerMonth !== null && <span className="tabular">{peso(pricing.annualPerMonth)} a month, billed yearly</span>}
                  {pricing.annualSavings !== null && (
                    <span className={cn('tabular rounded-md px-1.5 py-0.5 font-semibold', theme.soft)}>
                      Save {peso(pricing.annualSavings)}
                      {savePercent !== null ? ` (${savePercent}%)` : ''}
                    </span>
                  )}
                </>
              )}
            </p>
          </>
        ) : (
          <>
            <p className="text-xl font-bold text-zinc-300">
              {pricing.monthly === null && pricing.annual === null ? 'Pricing not yet available' : `Not offered ${INTERVAL_OPTION[interval].toLowerCase()}`}
            </p>
            <p className="mt-1.5 text-xs text-zinc-400">Prices are set by the platform administrator.</p>
          </>
        )}
      </div>

      {/* Row 3: capacity — locations first, then staff, products and history */}
      <div className="space-y-3">
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-3.5">
          <div className="flex items-start gap-3">
            <Store className={cn('mt-0.5 h-5 w-5 shrink-0', theme.check)} aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-base font-bold text-white">{location.headline}</p>
              <p className="mt-0.5 text-xs text-zinc-400">{location.detail}</p>
            </div>
          </div>
          {locationUsage && <LocationMeter plan={id} usage={locationUsage} />}
        </div>
        <ul className="space-y-2.5 px-0.5 text-sm" aria-label={`${plan.name} limits`}>
          {capacityRows(id).map((row) => {
            const RowIcon = CAPACITY_ICON[row.key];
            return (
              <li key={row.key} className="flex items-start gap-3">
                <RowIcon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="font-medium text-zinc-100">{row.text}</span>
                  {row.detail && <span className="block text-xs text-zinc-500">{row.detail}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Row 4: the page's action, then why this plan */}
      <div className="space-y-1.5 self-end">
        {action}
        <PlanWhyButton plan={id} />
      </div>

      {/* Row 5: highlights, then everything */}
      <div className="border-t border-white/10 pt-5">
        <ul className="space-y-2.5 text-sm" aria-label={`${plan.name} highlights`}>
          {highlights.lead.map((text, index) => (
            <li key={text} className={cn('flex items-start gap-2.5', index === 0 && id !== 'BASIC' ? 'font-semibold text-white' : 'text-zinc-200')}>
              {index === 0 && id !== 'BASIC' ? (
                <Zap className={cn('mt-0.5 h-4 w-4 shrink-0', theme.check)} aria-hidden="true" />
              ) : (
                <Check className={cn('mt-0.5 h-4 w-4 shrink-0', theme.check)} strokeWidth={3} aria-hidden="true" />
              )}
              <span>{text}</span>
            </li>
          ))}
        </ul>
        {more.length > 0 && (
          <details className="group mt-3 [&_summary::-webkit-details-marker]:hidden">
            <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1 rounded-md text-xs font-semibold text-zinc-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
              <span className="group-open:hidden">View all features</span>
              <span className="hidden group-open:inline">Show fewer</span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
              <span className="sr-only"> of {plan.name}</span>
            </summary>
            <ul className="mt-2 space-y-2 text-sm text-zinc-300" aria-label={`Everything in ${plan.name}`}>
              {more.map((text) => (
                <li key={text} className="flex items-start gap-2.5">
                  <Check className={cn('mt-0.5 h-4 w-4 shrink-0', theme.check)} strokeWidth={3} aria-hidden="true" />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </li>
  );
}

/** Plans above this one, for "upgrade for more" hints. */
export function higherPlan(id: PlanId): PlanId | null {
  const index = PLAN_ORDER.indexOf(id);
  return index >= 0 && index < PLAN_ORDER.length - 1 ? PLAN_ORDER[index + 1] : null;
}
