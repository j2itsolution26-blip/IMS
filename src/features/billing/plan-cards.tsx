'use client';

import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PLANS, PLAN_ORDER, type PlanId } from '@/lib/plans';
import { maxAnnualSavingsPercent, planCardBadges, planCtaKind, planPricing, type BillingInterval } from '@/lib/billing';
import { cn } from '@/lib/utils';
import { ChangePlanDialog, type PlanAction } from '@/features/billing/change-plan-dialog';
import { INTERVAL_OPTION, PlanCard, PlanCardGrid, PlanCardPill, THEME } from '@/features/billing/plan-card';
import type { BillingTermsInfo, PlanPrice, SubscriptionDates } from '@/features/billing/types';

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

        <PlanCardGrid>
          {PLAN_ORDER.map((id) => {
            const plan = PLANS[id];
            const theme = THEME[id];
            const pricing = planPricing(prices, id);
            const amount = interval === 'MONTHLY' ? pricing.monthly : pricing.annual;
            const badges = planCardBadges(id, { paidPlan, effectivePlan, onTrial });
            const cta = planCtaKind(id, { paidPlan, effectivePlan, onTrial, priced: selfService && amount !== null });
            const choose = (action: PlanAction) =>
              amount !== null && setChoice({ plan: id, action, amount, savings: interval === 'ANNUAL' ? pricing.annualSavings : null });
            return (
              <PlanCard
                key={id}
                plan={id}
                pricing={pricing}
                interval={interval}
                chip={badges.current ? 'Current plan' : badges.trial ? 'Your trial' : id === 'BUSINESS' ? null : theme.tag}
                popular={badges.popular}
                current={badges.current}
                action={
                  cta === 'CURRENT' || cta === 'CURRENT_TRIAL' ? (
                    <>
                      <PlanCardPill plan={id}>{cta === 'CURRENT' ? 'Current plan' : 'Current plan (Trial)'}</PlanCardPill>
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
                  )
                }
              />
            );
          })}
        </PlanCardGrid>

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
