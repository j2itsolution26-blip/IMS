import * as React from 'react';
import { Check, Crown, Gem, Minus, Package, Users, type LucideIcon } from 'lucide-react';
import { FEATURE_LABEL, PLANS, type Feature, type LimitKey, type PlanId } from '@/lib/plans';
import { annualSavingsPercent, type BillingInterval, type PlanPricing } from '@/lib/billing';
import { formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BasicArt, BusinessArt, EnterpriseArt } from '@/features/billing/plan-art';

/**
 * The one plan card, shared by the owner's Subscription & Billing page and
 * the System Admin's store page so the two can never drift apart. Pure
 * presentation with no hooks: what a plan includes comes from lib/plans,
 * prices from the published price list, and each page passes its own
 * role-appropriate action into the card's last row.
 */

const peso = (amount: number) => formatCurrency(amount, 'PHP');

export const INTERVAL_OPTION: Record<BillingInterval, string> = { MONTHLY: 'Monthly', ANNUAL: 'Yearly' };

/**
 * Each plan's colour identity: Basic blue, Business green, Enterprise purple.
 * Presentation only — what a plan includes lives in lib/plans.
 */
export const THEME: Record<
  PlanId,
  { icon: LucideIcon; art: React.ComponentType<{ className?: string }>; tag: string; card: string; soft: string; check: string; fill: string; hover: string }
> = {
  BASIC: {
    icon: Package,
    art: BasicArt,
    tag: 'Get started',
    card: 'border-plan-basic-border bg-gradient-to-b from-plan-basic-tint to-card hover:shadow-lg hover:shadow-plan-basic/10',
    soft: 'bg-plan-basic/10 text-plan-basic-text',
    check: 'text-plan-basic-text',
    fill: 'bg-plan-basic text-white',
    hover: 'hover:bg-plan-basic/90',
  },
  BUSINESS: {
    icon: Users,
    art: BusinessArt,
    tag: 'Most popular',
    card: 'border-2 border-primary/60 bg-gradient-to-b from-mint to-card shadow-lg shadow-primary/10 hover:shadow-xl hover:shadow-primary/15',
    soft: 'bg-primary/10 text-primary',
    check: 'text-success-text',
    fill: 'bg-primary text-primary-foreground',
    hover: 'hover:bg-primary/90',
  },
  ENTERPRISE: {
    icon: Gem,
    art: EnterpriseArt,
    tag: 'Best for large businesses',
    card: 'border-plan-enterprise-border bg-gradient-to-b from-plan-enterprise-tint to-card hover:shadow-lg hover:shadow-plan-enterprise/10',
    soft: 'bg-plan-enterprise/10 text-plan-enterprise-text',
    check: 'text-plan-enterprise-text',
    fill: 'bg-plan-enterprise text-white',
    hover: 'hover:bg-plan-enterprise/90',
  },
};

const LIMIT_ROWS: { key: LimitKey; one: string; many: string }[] = [
  { key: 'branches', one: 'branch', many: 'branches' },
  { key: 'staff', one: 'staff account', many: 'staff accounts' },
  { key: 'products', one: 'product', many: 'products' },
  { key: 'backgroundRemovalsPerMonth', one: 'background removal / month', many: 'background removals / month' },
];
const FEATURE_ROWS: Feature[] = ['reportExports', 'customRoles'];

function limitLine(value: number | null, row: { one: string; many: string }): { text: string; included: boolean } {
  if (value === null) return { text: `Unlimited ${row.many}`, included: true };
  if (value === 0) return { text: row.many.charAt(0).toUpperCase() + row.many.slice(1), included: false };
  if (value === 1) return { text: `1 ${row.one}`, included: true };
  return { text: `Up to ${formatNumber(value, 0)} ${row.many}`, included: true };
}

/** What a plan includes, from the plan configuration: included lines first, then what it lacks. */
export function featureLines(id: PlanId): { text: string; included: boolean }[] {
  const plan = PLANS[id];
  const lines = [
    ...LIMIT_ROWS.map((row) => limitLine(plan.limits[row.key], row)),
    ...FEATURE_ROWS.map((feature) => ({ text: FEATURE_LABEL[feature], included: plan.features[feature] })),
    { text: plan.auditHistoryDays === null ? 'Full audit history' : `${plan.auditHistoryDays}-day audit history`, included: true },
  ];
  return [...lines.filter((line) => line.included), ...lines.filter((line) => !line.included)];
}

/** The three cards' grid. Cards line their rows up through subgrid; Enterprise centres under the others on tablets. */
export function PlanCardGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ul className={cn('grid gap-5 pt-3 md:grid-cols-2 xl:grid-cols-3', className)}>{children}</ul>;
}

/** The plan's coloured "Current plan"-style pill, for a card's action row. Not a button. */
export function PlanCardPill({ plan, children }: { plan: PlanId; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold shadow-sm', THEME[plan].fill)}>
      <Crown className="h-4 w-4" aria-hidden="true" />
      {children}
    </div>
  );
}

export function PlanCard({
  plan: id,
  pricing,
  interval,
  chip,
  popular,
  current,
  action,
}: {
  plan: PlanId;
  pricing: PlanPricing;
  interval: BillingInterval;
  /** The small label beside the name ("Current plan", "Your trial", the plan's tag), or null. */
  chip: string | null;
  /** Shows the floating "Most popular" badge. */
  popular: boolean;
  /** Marks the card as the store's plan (aria-current). */
  current: boolean;
  /** The last row: the page's own role-appropriate action, or nothing. */
  action: React.ReactNode;
}) {
  const plan = PLANS[id];
  const theme = THEME[id];
  const Icon = theme.icon;
  const Decoration = theme.art;
  const savePercent = annualSavingsPercent(pricing);
  const amount = interval === 'MONTHLY' ? pricing.monthly : pricing.annual;
  return (
    <li
      aria-current={current ? 'true' : undefined}
      className={cn(
        'relative row-span-4 grid grid-rows-subgrid gap-y-4 rounded-3xl border p-5 transition-shadow duration-200 sm:p-6',
        theme.card,
        id === 'ENTERPRISE' && 'md:col-span-2 md:w-[calc(50%-0.625rem)] md:justify-self-center xl:col-span-1 xl:w-auto xl:justify-self-stretch',
      )}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden="true">
        <Decoration className="absolute -bottom-3 -right-3 h-28 w-28 opacity-50" />
      </div>
      {popular && (
        <span className="absolute -top-3.5 left-5 z-10 inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-md">
          <Crown className="h-3.5 w-3.5" aria-hidden="true" /> Most popular
        </span>
      )}

      {/* Row 1: identity */}
      <div className="relative flex items-start gap-4">
        <span className={cn('flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl', theme.soft)}>
          <Icon className="h-7 w-7" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <h3 className="text-xl font-bold leading-tight">{plan.name}</h3>
            {chip && <span className={cn('rounded-full px-2.5 py-1 text-xs font-semibold', theme.soft)}>{chip}</span>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>
        </div>
      </div>

      {/* Row 2: price */}
      <div className="relative">
        {amount !== null ? (
          <>
            <p className="flex items-baseline gap-1.5">
              <span className="tabular text-4xl font-extrabold tracking-tight">{peso(amount)}</span>
              <span className="text-base text-muted-foreground">/ {interval === 'MONTHLY' ? 'month' : 'year'}</span>
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted-foreground">
              {interval === 'MONTHLY' && pricing.annual !== null && <span className="tabular">{peso(pricing.annual)} / year</span>}
              {interval === 'ANNUAL' && pricing.annualPerMonth !== null && (
                <span className="tabular">{peso(pricing.annualPerMonth)} a month, billed yearly</span>
              )}
              {savePercent !== null && <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', theme.soft)}>Save {savePercent}%</span>}
            </p>
          </>
        ) : (
          <>
            <p className="text-xl font-bold text-muted-foreground">
              {pricing.monthly === null && pricing.annual === null ? 'Pricing not yet available' : `Not offered ${INTERVAL_OPTION[interval].toLowerCase()}`}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">Prices are set by the platform administrator.</p>
          </>
        )}
      </div>

      {/* Row 3: what it includes */}
      <ul className="relative space-y-2.5 text-sm">
        {featureLines(id).map((line) => (
          <li key={line.text} className={cn('flex items-start gap-2.5', !line.included && 'text-muted-foreground')}>
            {line.included ? (
              <Check className={cn('mt-0.5 h-4 w-4 shrink-0', theme.check)} strokeWidth={3} aria-hidden="true" />
            ) : (
              <Minus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>
              {line.text}
              {!line.included && <span className="sr-only"> (not included)</span>}
            </span>
          </li>
        ))}
      </ul>

      {/* Row 4: action */}
      <div className="relative self-end">{action}</div>
    </li>
  );
}
