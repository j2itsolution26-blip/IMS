'use client';

import * as React from 'react';
import { Check, ChevronRight, Crown, Gem, Minus, Package, Users, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FEATURE_LABEL, PLANS, PLAN_ORDER, type Feature, type LimitKey, type PlanId } from '@/lib/plans';
import {
  annualSavingsPercent,
  maxAnnualSavingsPercent,
  planCardBadges,
  planCtaKind,
  planPricing,
  type BillingInterval,
} from '@/lib/billing';
import { formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ChangePlanDialog, type PlanAction } from '@/features/billing/change-plan-dialog';
import { BasicArt, BusinessArt, EnterpriseArt } from '@/features/billing/plan-art';
import type { BillingTermsInfo, PlanPrice, SubscriptionDates } from '@/features/billing/types';

const peso = (amount: number) => formatCurrency(amount, 'PHP');

const INTERVAL_OPTION: Record<BillingInterval, string> = { MONTHLY: 'Monthly', ANNUAL: 'Yearly' };

/**
 * Each plan's colour identity: Basic blue, Business green, Enterprise purple.
 * Presentation only — what a plan includes lives in lib/plans.
 */
const THEME: Record<
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
function featureLines(id: PlanId): { text: string; included: boolean }[] {
  const plan = PLANS[id];
  const lines = [
    ...LIMIT_ROWS.map((row) => limitLine(plan.limits[row.key], row)),
    ...FEATURE_ROWS.map((feature) => ({ text: FEATURE_LABEL[feature], included: plan.features[feature] })),
    { text: plan.auditHistoryDays === null ? 'Full audit history' : `${plan.auditHistoryDays}-day audit history`, included: true },
  ];
  return [...lines.filter((line) => line.included), ...lines.filter((line) => !line.included)];
}

const CTA_VERB: Record<'CHOOSE' | 'UPGRADE' | 'DOWNGRADE', string> = { CHOOSE: 'Choose', UPGRADE: 'Upgrade to', DOWNGRADE: 'Downgrade to' };

export interface PlanCardsProps {
  prices: PlanPrice[];
  terms: BillingTermsInfo | null;
  paymentInstructions: string | null;
  canManage: boolean;
  /** The plan in force (the trial plan during a trial). */
  effectivePlan: PlanId;
  /** The plan the store has paid for; null during a trial. */
  paidPlan: PlanId | null;
  /** True while the trial runs or after it lapsed with nothing bought. */
  onTrial: boolean;
  billingInterval: BillingInterval | null;
  subscription: SubscriptionDates;
  openInvoiceNumber: string | null;
  suspended: boolean;
  /** The billing status message, rendered on the server. */
  banner: React.ReactNode;
}

/**
 * The pricing section: hero, billing message, and Basic / Business /
 * Enterprise read from the plan configuration and the published price list.
 * Choosing a plan opens the confirmation dialog; the server re-checks the
 * price, terms version and store state, and only issues an invoice.
 */
export function PlanCards(props: PlanCardsProps) {
  const {
    prices,
    terms,
    paymentInstructions,
    canManage,
    effectivePlan,
    paidPlan,
    onTrial,
    billingInterval,
    subscription,
    openInvoiceNumber,
    suspended,
    banner,
  } = props;
  const selfService = prices.some((price) => price.amount > 0) && terms !== null;
  const intervals = (['MONTHLY', 'ANNUAL'] as const).filter((interval) => prices.some((price) => price.interval === interval && price.amount > 0));
  const [interval, setInterval] = React.useState<BillingInterval>(
    billingInterval && intervals.includes(billingInterval) ? billingInterval : (intervals[0] ?? 'MONTHLY'),
  );
  const [choice, setChoice] = React.useState<{ plan: PlanId; action: PlanAction; amount: number; savings: number | null } | null>(null);
  const bestSaving = maxAnnualSavingsPercent(prices);

  // Why the buttons are off, when they are. Suspension and an open invoice are also explained in the banner.
  const blocked: string | null = !selfService
    ? null
    : suspended
      ? 'This store is suspended, so plans cannot be changed.'
      : openInvoiceNumber
        ? `Invoice ${openInvoiceNumber} is open. Pay it or withdraw it before choosing another plan.`
        : !canManage
          ? 'Only the store owner can change the plan.'
          : null;
  const canChoose = selfService && blocked === null;

  return (
    <>
      <div className="relative flex flex-col gap-4 border-b px-4 pb-5 pt-6 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="relative max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Subscription plans</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Choose the right plan for your business</h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Upgrade, downgrade, or continue with your current plan. Every plan includes core POS, inventory, and sales. Downgrading never
            deletes data.
          </p>
          {intervals.length > 1 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Billing period" className="inline-flex rounded-full border bg-card p-1 shadow-xs">
                {intervals.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={interval === option}
                    onClick={() => setInterval(option)}
                    className={cn(
                      'min-h-9 rounded-full px-5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      interval === option ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {INTERVAL_OPTION[option]}
                  </button>
                ))}
              </div>
              {bestSaving !== null && (
                <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success-text">Save up to {bestSaving}% yearly</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        {banner}

        <ul className="grid gap-5 pt-3 md:grid-cols-2 xl:grid-cols-3">
          {PLAN_ORDER.map((id) => {
            const plan = PLANS[id];
            const theme = THEME[id];
            const Icon = theme.icon;
            const Decoration = theme.art;
            const pricing = planPricing(prices, id);
            const savePercent = annualSavingsPercent(pricing);
            const amount = interval === 'MONTHLY' ? pricing.monthly : pricing.annual;
            const badges = planCardBadges(id, { paidPlan, effectivePlan, onTrial });
            const cta = planCtaKind(id, { paidPlan, effectivePlan, onTrial, priced: selfService && amount !== null });
            const choose = (action: PlanAction) =>
              amount !== null && setChoice({ plan: id, action, amount, savings: interval === 'ANNUAL' ? pricing.annualSavings : null });
            const chip = badges.current ? 'Current plan' : badges.trial ? 'Your trial' : id === 'BUSINESS' ? null : theme.tag;
            return (
              <li
                key={id}
                aria-current={badges.current ? 'true' : undefined}
                className={cn(
                  'relative row-span-4 grid grid-rows-subgrid gap-y-4 rounded-3xl border p-5 transition-shadow duration-200 sm:p-6',
                  theme.card,
                  id === 'ENTERPRISE' && 'md:col-span-2 md:w-[calc(50%-0.625rem)] md:justify-self-center xl:col-span-1 xl:w-auto xl:justify-self-stretch',
                )}
              >
                <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]" aria-hidden="true">
                  <Decoration className="absolute -bottom-3 -right-3 h-28 w-28 opacity-50" />
                </div>
                {badges.popular && (
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
                        {savePercent !== null && (
                          <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', theme.soft)}>Save {savePercent}%</span>
                        )}
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
                <div className="relative self-end">
                  {cta === 'CURRENT' || cta === 'CURRENT_TRIAL' ? (
                    <>
                      <div className={cn('flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold shadow-sm', theme.fill)}>
                        <Crown className="h-4 w-4" aria-hidden="true" />
                        {cta === 'CURRENT' ? 'Current plan' : 'Current plan (Trial)'}
                      </div>
                      {canChoose && amount !== null && (
                        <Button variant="link" className="mt-1 h-auto w-full py-1.5 text-xs" onClick={() => choose(cta === 'CURRENT' ? 'CURRENT' : 'CHOOSE')}>
                          {cta === 'CURRENT' ? `Renew ${plan.name} early` : `Choose ${plan.name} to keep it after your trial`}
                        </Button>
                      )}
                    </>
                  ) : cta === 'UNAVAILABLE' ? (
                    <Button variant="outline" disabled className="min-h-12 w-full rounded-xl bg-card/70">
                      {selfService ? `Not offered ${INTERVAL_OPTION[interval].toLowerCase()}` : 'Not available yet'}
                    </Button>
                  ) : (
                    <Button className={cn('min-h-12 w-full rounded-xl text-sm font-semibold', theme.fill, theme.hover)} disabled={!canChoose} onClick={() => choose(cta)}>
                      {CTA_VERB[cta]} {plan.name}
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {blocked && <p className="text-center text-sm text-muted-foreground">{blocked}</p>}
      </div>

      {choice && terms && (
        <ChangePlanDialog
          plan={choice.plan}
          from={effectivePlan}
          action={choice.action}
          interval={interval}
          amount={choice.amount}
          annualSavings={choice.savings}
          subscription={subscription}
          terms={terms}
          paymentInstructions={paymentInstructions}
          onClose={() => setChoice(null)}
        />
      )}
    </>
  );
}
