'use client';

import * as React from 'react';
import { Check, Info, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FEATURE_LABEL, PLANS, PLAN_ORDER, type Feature, type LimitKey, type PlanId } from '@/lib/plans';
import { INTERVAL_LABEL, planDirection, planPricing, type BillingInterval } from '@/lib/billing';
import { formatCurrency, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ACTION_VERB, ChangePlanDialog, type PlanAction } from '@/features/billing/change-plan-dialog';
import type { BillingTermsInfo, PlanPrice, SubscriptionDates } from '@/features/billing/types';

const peso = (amount: number) => formatCurrency(amount, 'PHP');

const LIMIT_ROWS: { key: LimitKey; one: string; many: string }[] = [
  { key: 'branches', one: 'branch', many: 'branches' },
  { key: 'staff', one: 'staff account', many: 'staff accounts' },
  { key: 'products', one: 'product', many: 'products' },
  { key: 'backgroundRemovalsPerMonth', one: 'background removal / month', many: 'background removals / month' },
];
const FEATURE_ROWS: Feature[] = ['reportExports', 'customRoles'];

function limitLine(value: number | null, row: { one: string; many: string }): { text: string; included: boolean } {
  if (value === null) return { text: `Unlimited ${row.many}`, included: true };
  if (value === 0) return { text: `No ${row.many}`, included: false };
  if (value === 1) return { text: `1 ${row.one}`, included: true };
  return { text: `Up to ${formatNumber(value, 0)} ${row.many}`, included: true };
}

export interface PlanCardsProps {
  prices: PlanPrice[];
  terms: BillingTermsInfo | null;
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
  const { prices, terms, canManage, effectivePlan, paidPlan, onTrial, billingInterval, subscription, openInvoiceNumber, suspended } = props;
  const selfService = prices.some((price) => price.amount > 0) && terms !== null;
  const intervals = (['MONTHLY', 'ANNUAL'] as const).filter((interval) => prices.some((price) => price.interval === interval && price.amount > 0));
  const [interval, setInterval] = React.useState<BillingInterval>(
    billingInterval && intervals.includes(billingInterval) ? billingInterval : (intervals[0] ?? 'MONTHLY'),
  );
  const [choice, setChoice] = React.useState<{ plan: PlanId; action: PlanAction; amount: number } | null>(null);

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
    <div className="space-y-4 p-4">
      {!selfService ? (
        <p role="status" className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            Self-service plan changes are unavailable until the platform administrator publishes prices
            {terms ? '' : ' and billing terms'}. Nothing is owed. You can still pay the administrator directly; they will record it
            for you.
          </span>
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {intervals.length > 1 ? (
            <div role="group" aria-label="Billing period" className="inline-flex rounded-full bg-muted p-1">
              {intervals.map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={interval === option}
                  onClick={() => setInterval(option)}
                  className={cn(
                    'min-h-9 rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    interval === option ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {INTERVAL_LABEL[option]}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Billed {INTERVAL_LABEL[interval].toLowerCase()}.</p>
          )}
          {blocked && <p className="text-sm text-muted-foreground">{blocked}</p>}
        </div>
      )}

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id];
          const pricing = planPricing(prices, id);
          const amount = interval === 'MONTHLY' ? pricing.monthly : pricing.annual;
          const isEffective = id === effectivePlan;
          const action: PlanAction = onTrial || !paidPlan ? 'CHOOSE' : planDirection(paidPlan, id);
          const current = !onTrial && paidPlan === id;
          return (
            <li
              key={id}
              className={cn('flex flex-col rounded-xl border bg-card p-4', isEffective && 'border-primary/50 ring-1 ring-primary/30')}
              aria-current={isEffective ? 'true' : undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold">{plan.name}</h3>
                  <p className="text-xs text-muted-foreground">{plan.description}</p>
                </div>
                {current ? (
                  <Badge>Current plan</Badge>
                ) : isEffective && onTrial ? (
                  <Badge variant="outline">Your trial</Badge>
                ) : null}
              </div>

              {selfService && (
                <div className="mt-3 min-h-[3.5rem]">
                  {amount !== null ? (
                    <>
                      <p>
                        <span className="tabular text-2xl font-bold">{peso(amount)}</span>
                        <span className="text-sm text-muted-foreground"> / {interval === 'MONTHLY' ? 'month' : 'year'}</span>
                      </p>
                      {interval === 'ANNUAL' && pricing.annualPerMonth !== null && (
                        <p className="text-xs text-muted-foreground">
                          {peso(pricing.annualPerMonth)} a month, billed yearly
                          {pricing.annualSavings !== null && (
                            <span className="font-medium text-success-text"> · save {peso(pricing.annualSavings)}</span>
                          )}
                        </p>
                      )}
                      {interval === 'MONTHLY' && pricing.annual !== null && (
                        <p className="text-xs text-muted-foreground">
                          or {peso(pricing.annual)} / year
                          {pricing.annualSavings !== null && (
                            <span className="font-medium text-success-text"> (save {peso(pricing.annualSavings)})</span>
                          )}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not offered {interval === 'MONTHLY' ? 'monthly' : 'annually'}.</p>
                  )}
                </div>
              )}

              <ul className="mt-3 space-y-1.5 border-t pt-3 text-sm">
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
                  className="mt-4 min-h-10"
                  variant={action === 'UPGRADE' || (action === 'CHOOSE' && isEffective) ? 'default' : 'outline'}
                  disabled={amount === null || blocked !== null}
                  onClick={() => amount !== null && setChoice({ plan: id, action, amount })}
                >
                  {current ? ACTION_VERB[action] : `${ACTION_VERB[action]} ${plan.name}`}
                </Button>
              )}
            </li>
          );
        })}
      </ul>

      {choice && terms && (
        <ChangePlanDialog
          plan={choice.plan}
          from={effectivePlan}
          action={choice.action}
          interval={interval}
          amount={choice.amount}
          subscription={subscription}
          terms={terms}
          onClose={() => setChoice(null)}
        />
      )}
    </div>
  );
}

function FeatureLine({ included, text }: { included: boolean; text: string }) {
  return (
    <li className={cn('flex items-start gap-2', !included && 'text-muted-foreground')}>
      {included ? (
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-text" aria-hidden="true" />
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
