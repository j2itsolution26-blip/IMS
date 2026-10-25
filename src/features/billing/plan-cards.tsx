'use client';

import * as React from 'react';
import { Building2, Check, Crown, Info, Minus, Package, Users, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FEATURE_LABEL, PLANS, PLAN_ORDER, type Feature, type LimitKey, type PlanId } from '@/lib/plans';
import {
  annualSavingsPercent,
  maxAnnualSavingsPercent,
  planCardBadges,
  planDirection,
  planPricing,
  type BillingInterval,
} from '@/lib/billing';
import { formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ACTION_VERB, ChangePlanDialog, type PlanAction } from '@/features/billing/change-plan-dialog';
import type { BillingTermsInfo, PlanPrice, SubscriptionDates } from '@/features/billing/types';

const peso = (amount: number) => formatCurrency(amount, 'PHP');

const PLAN_ICON: Record<PlanId, LucideIcon> = { BASIC: Package, BUSINESS: Users, ENTERPRISE: Building2 };

const INTERVAL_OPTION: Record<BillingInterval, string> = { MONTHLY: 'Monthly', ANNUAL: 'Yearly' };

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
}

/**
 * Basic / Business / Enterprise, read from the plan configuration and the
 * published price list. Choosing one opens the confirmation dialog; the
 * server re-checks the price, terms version and store state.
 */
export function PlanCards(props: PlanCardsProps) {
  const { prices, terms, paymentInstructions, canManage, effectivePlan, paidPlan, onTrial, billingInterval, subscription, openInvoiceNumber, suspended } =
    props;
  const selfService = prices.some((price) => price.amount > 0) && terms !== null;
  const intervals = (['MONTHLY', 'ANNUAL'] as const).filter((interval) => prices.some((price) => price.interval === interval && price.amount > 0));
  const [interval, setInterval] = React.useState<BillingInterval>(
    billingInterval && intervals.includes(billingInterval) ? billingInterval : (intervals[0] ?? 'MONTHLY'),
  );
  const [choice, setChoice] = React.useState<{ plan: PlanId; action: PlanAction; amount: number; savings: number | null } | null>(null);
  const bestSaving = maxAnnualSavingsPercent(prices);

  const blocked: string | null = !selfService
    ? null
    : suspended
      ? 'This store is suspended, so plans cannot be changed. Contact support.'
      : openInvoiceNumber
        ? `Invoice ${openInvoiceNumber} is open. Pay it or withdraw it before choosing another plan.`
        : !canManage
          ? 'Only the store owner can change the plan.'
          : null;

  return (
    <>
      <div className="flex flex-col gap-3 border-b p-4 sm:p-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold leading-tight">Choose the right plan for your business</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upgrade, downgrade, or continue with your current plan. Every plan includes core POS, inventory, and sales. Downgrading never
            deletes data.
          </p>
        </div>
        {selfService && intervals.length > 1 && (
          <div className="flex shrink-0 items-center gap-2">
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
            {bestSaving !== null && <Badge variant="success">Save up to {bestSaving}%</Badge>}
          </div>
        )}
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        {!selfService ? (
          <p role="status" className="flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>
              Self-service plan changes are unavailable until the platform administrator publishes prices
              {terms ? '' : ' and billing terms'}. Nothing is owed. You can still pay the administrator directly; they will record it for
              you.
            </span>
          </p>
        ) : (
          <>
            {intervals.length === 1 && <p className="text-sm text-muted-foreground">Billed {INTERVAL_OPTION[interval].toLowerCase()}.</p>}
            {blocked && (
              <p role="status" className="flex items-start gap-2 rounded-xl border bg-muted/40 p-3 text-sm">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {blocked}
              </p>
            )}
          </>
        )}

        <ul className="grid gap-4 pt-2 md:grid-cols-3">
          {PLAN_ORDER.map((id) => {
            const plan = PLANS[id];
            const Icon = PLAN_ICON[id];
            const pricing = planPricing(prices, id);
            const savePercent = annualSavingsPercent(pricing);
            const amount = interval === 'MONTHLY' ? pricing.monthly : pricing.annual;
            const badges = planCardBadges(id, { paidPlan, effectivePlan, onTrial });
            const action: PlanAction = onTrial || !paidPlan ? 'CHOOSE' : planDirection(paidPlan, id);
            return (
              <li
                key={id}
                aria-current={badges.current ? 'true' : undefined}
                className={cn(
                  'relative flex flex-col rounded-2xl border bg-card p-5 transition-shadow hover:shadow-md',
                  badges.popular && 'border-2 border-primary/70 bg-gradient-to-b from-mint to-card shadow-md',
                  badges.current && 'ring-2 ring-primary/40',
                )}
              >
                {badges.popular && (
                  <span className="absolute -top-3 left-4 inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground shadow-sm">
                    <Crown className="h-3.5 w-3.5" aria-hidden="true" /> Most popular
                  </span>
                )}

                <div className="flex items-start gap-3">
                  <span
                    className={cn(
                      'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                      badges.popular ? 'bg-primary/15 text-primary' : 'bg-mint text-primary',
                    )}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-lg font-bold leading-tight">{plan.name}</h3>
                      {badges.current ? <Badge>Current plan</Badge> : badges.trial ? <Badge>Your trial</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{plan.description}</p>
                  </div>
                </div>

                {selfService && (
                  <div className="mt-4 min-h-[4.25rem]">
                    {amount !== null ? (
                      <>
                        <p className="flex items-baseline gap-1">
                          <span className="tabular text-3xl font-extrabold tracking-tight">{peso(amount)}</span>
                          <span className="text-sm text-muted-foreground">/ {interval === 'MONTHLY' ? 'month' : 'year'}</span>
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                          {interval === 'MONTHLY' && pricing.annual !== null && <span className="tabular">or {peso(pricing.annual)} / year</span>}
                          {interval === 'ANNUAL' && pricing.annualPerMonth !== null && (
                            <span className="tabular">{peso(pricing.annualPerMonth)} a month, billed yearly</span>
                          )}
                          {savePercent !== null && <Badge variant="success">Save {savePercent}%</Badge>}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">Not offered {interval === 'MONTHLY' ? 'monthly' : 'yearly'}.</p>
                    )}
                  </div>
                )}

                <ul className="mt-4 space-y-2 text-sm">
                  {LIMIT_ROWS.map((row) => {
                    const line = limitLine(plan.limits[row.key], row);
                    return <FeatureLine key={row.key} included={line.included} text={line.text} />;
                  })}
                  {FEATURE_ROWS.map((feature) => (
                    <FeatureLine key={feature} included={plan.features[feature]} text={FEATURE_LABEL[feature]} />
                  ))}
                  <FeatureLine
                    included
                    text={plan.auditHistoryDays === null ? 'Full audit history' : `${plan.auditHistoryDays}-day audit history`}
                  />
                </ul>

                {selfService && canManage && (
                  <Button
                    className="mt-5 min-h-11 w-full"
                    variant={badges.popular || action === 'UPGRADE' ? 'default' : 'outline'}
                    disabled={amount === null || blocked !== null}
                    onClick={() =>
                      amount !== null && setChoice({ plan: id, action, amount, savings: interval === 'ANNUAL' ? pricing.annualSavings : null })
                    }
                  >
                    {ACTION_VERB[action]} {plan.name}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
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

function FeatureLine({ included, text }: { included: boolean; text: string }) {
  return (
    <li className={cn('flex items-start gap-2.5', !included && 'text-muted-foreground')}>
      {included ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-text" strokeWidth={2.5} aria-hidden="true" />
      ) : (
        <Minus className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span>
        {text}
        {!included && <span className="sr-only"> (not included)</span>}
      </span>
    </li>
  );
}
