'use client';

import * as React from 'react';
import { ChevronRight, LockKeyhole, ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PLANS, PLAN_ORDER, type PlanId } from '@/lib/plans';
import { annualSavingsLabel, planCardBadges, planCtaKind, planPricing, type BillingInterval } from '@/lib/billing';
import { cn } from '@/lib/utils';
import { ChangePlanDialog, type PlanAction } from '@/features/billing/change-plan-dialog';
import { PlanComparison, PlanFaq } from '@/features/billing/plan-comparison';
import { INTERVAL_OPTION, PlanCard, PlanCardGrid, PlanCardPill, THEME } from '@/features/billing/plan-card';
import type { BillingTermsInfo, PlanPrice, SubscriptionDates } from '@/features/billing/types';

const TOGGLE_LABEL: Record<BillingInterval, string> = { MONTHLY: 'Monthly', ANNUAL: 'Annually' };

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
  const savingLabel = annualSavingsLabel(prices);

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
    // Always drawn in the dark palette on navy, whatever the app theme: the
    // `dark` class switches the colour tokens for this section only.
    <div className="dark relative isolate overflow-hidden bg-[#070d1c] text-foreground [color-scheme:dark]">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
        style={{
          backgroundImage:
            'radial-gradient(60% 40% at 12% 0%, rgba(37,99,235,0.20), transparent 70%),' +
            'radial-gradient(45% 35% at 50% 8%, rgba(16,185,129,0.16), transparent 70%),' +
            'radial-gradient(50% 40% at 92% 4%, rgba(124,58,237,0.18), transparent 70%),' +
            'linear-gradient(180deg, #0a1428 0%, #070d1c 60%)',
        }}
      />
      <div className="flex flex-col items-center px-4 pb-4 pt-8 text-center sm:px-6 sm:pt-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300/90">Subscription plans</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">Choose Your Plan</h2>
        <p className="mt-3 max-w-2xl text-sm text-slate-300 sm:text-base">
          Pick the plan that matches your store today and change it as you grow. Every plan includes POS checkout, inventory, and sales reports.
        </p>
        {intervals.length > 1 && (
          <div role="group" aria-label="Billing period" className="mt-6 inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1 shadow-inner">
            {intervals.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={interval === option}
                onClick={() => setInterval(option)}
                className={cn(
                  'inline-flex min-h-10 items-center gap-2 rounded-full px-5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300',
                  interval === option ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-300 hover:text-white',
                )}
              >
                {TOGGLE_LABEL[option]}
                {option === 'ANNUAL' && savingLabel && (
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[11px] font-bold',
                      interval === option ? 'bg-emerald-100 text-emerald-800' : 'bg-emerald-400/15 text-emerald-300',
                    )}
                  >
                    {savingLabel}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        <p className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <LockKeyhole className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> Secure, role-based access
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ReceiptText className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" /> You pay the price shown, by invoice
          </span>
        </p>
      </div>

      <div className="space-y-8 p-4 sm:p-6 lg:p-8">
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

        <PlanComparison currentPlan={onTrial ? null : paidPlan} />
        <PlanFaq />
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
    </div>
  );
}
