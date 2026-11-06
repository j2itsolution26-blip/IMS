'use client';

import * as React from 'react';
import { ChevronRight, LockKeyhole, ReceiptText, Store } from 'lucide-react';
import { PLANS, PLAN_ORDER, type PlanId } from '@/lib/plans';
import { formatNumber } from '@/lib/format';
import { annualSavingsLabel, planCardBadges, planCtaKind, planPricing, type BillingInterval } from '@/lib/billing';
import { cn } from '@/lib/utils';
import { ChangePlanDialog, type PlanAction } from '@/features/billing/change-plan-dialog';
import { PlanComparison, PlanFaq } from '@/features/billing/plan-comparison';
import { INTERVAL_OPTION, PlanCard, PlanCardGrid, PlanCardPill, THEME, higherPlan, planButtonClass, type LocationUsage } from '@/features/billing/plan-card';
import type { BillingTermsInfo, PlanPrice, SubscriptionDates } from '@/features/billing/types';

const TOGGLE_LABEL: Record<BillingInterval, string> = { MONTHLY: 'Monthly', ANNUAL: 'Annual' };

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
  /** Locations in use, counted the way the branch limit is enforced; null when unknown. */
  locationsUsed: number | null;
  /** Whether the viewer may add a branch. */
  canAddBranch: boolean;
  /** The billing status message, rendered on the server. */
  banner: React.ReactNode;
}

/** "Upgrade to Business for up to 3 locations." — from the plan configuration. */
function fullLocationsHint(plan: PlanId, canChoose: boolean): string {
  const next = higherPlan(plan);
  if (!next) return 'This plan includes the most locations of any plan.';
  const limit = PLANS[next].limits.branches;
  const room = limit === null ? 'more locations' : `up to ${formatNumber(limit, 0)} locations`;
  return canChoose ? `Every location is in use. Upgrade to ${PLANS[next].name} for ${room}.` : `Every location is in use. ${PLANS[next].name} allows ${room}.`;
}

/**
 * The pricing section: heading, billing period, billing message, and Basic /
 * Business / Enterprise read from the plan configuration and the published
 * price list. Choosing a plan opens the confirmation dialog; the server
 * re-checks the price, terms version and store state, and only issues an
 * invoice — nothing changes the plan on a click.
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
    locationsUsed,
    canAddBranch,
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

  const usageFor = (id: PlanId): LocationUsage | null => {
    if (id !== effectivePlan || locationsUsed === null) return null;
    const limit = PLANS[id].limits.branches;
    const room = limit === null || locationsUsed < limit;
    return {
      used: locationsUsed,
      limit,
      addHref: room && canAddBranch && !suspended ? '/settings/branches' : null,
      fullHint: room ? null : fullLocationsHint(id, canChoose),
    };
  };

  return (
    // Always drawn dark, whatever the app theme: the `dark` class switches the
    // colour tokens for this section only.
    <div className="dark relative isolate overflow-hidden bg-[#0b0c0e] text-zinc-100 [color-scheme:dark]">
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        aria-hidden="true"
        style={{
          backgroundImage:
            'radial-gradient(40% 30% at 18% 0%, rgba(59,130,246,0.10), transparent 70%),' +
            'radial-gradient(40% 32% at 50% 0%, rgba(16,185,129,0.12), transparent 70%),' +
            'radial-gradient(40% 30% at 84% 0%, rgba(139,92,246,0.11), transparent 70%)',
        }}
      />
      <div className="flex flex-col items-center px-4 pb-2 pt-8 text-center sm:px-6 sm:pt-10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Subscription plans</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">Choose the plan for your store</h2>
        <p className="mt-3 max-w-2xl text-sm text-zinc-400 sm:text-base">
          Every plan includes POS checkout, barcode scanning, inventory and sales reports. Plans differ in locations, staff and products.
        </p>
        {intervals.length > 1 && (
          <div role="group" aria-label="Billing period" className="mt-6 inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1">
            {intervals.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={interval === option}
                onClick={() => setInterval(option)}
                className={cn(
                  'inline-flex min-h-10 items-center gap-2 rounded-full px-5 py-1.5 text-sm font-semibold transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
                  interval === option ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400 hover:text-white',
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
        <p className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5">
            <Store className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" /> A location is a physical store or branch, not a device
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ReceiptText className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" /> You pay the price shown, by invoice
          </span>
          <span className="inline-flex items-center gap-1.5">
            <LockKeyhole className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" /> Your data stays when you change plans
          </span>
        </p>
      </div>

      <div className="space-y-10 p-4 sm:p-6 lg:p-8">
        {banner}

        <PlanCardGrid>
          {PLAN_ORDER.map((id) => {
            const plan = PLANS[id];
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
                badge={badges.current ? 'Current plan' : badges.trial ? 'Your trial' : THEME[id].tag}
                current={badges.current || badges.trial}
                locationUsage={usageFor(id)}
                action={
                  cta === 'CURRENT' || cta === 'CURRENT_TRIAL' ? (
                    <>
                      <PlanCardPill plan={id}>{cta === 'CURRENT' ? 'Current Plan' : 'Current Plan (Trial)'}</PlanCardPill>
                      {canChoose && amount !== null && (
                        <button
                          type="button"
                          className="w-full rounded-md py-1.5 text-xs font-semibold text-zinc-300 underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                          onClick={() => choose(cta === 'CURRENT' ? 'CURRENT' : 'CHOOSE')}
                        >
                          {cta === 'CURRENT' ? `Renew ${plan.name} early` : `Choose ${plan.name} to keep it after your trial`}
                        </button>
                      )}
                    </>
                  ) : cta === 'UNAVAILABLE' ? (
                    <button type="button" disabled className="min-h-12 w-full rounded-xl border border-white/10 bg-white/[0.03] text-sm font-semibold text-zinc-500">
                      {selfService ? `Not offered ${INTERVAL_OPTION[interval].toLowerCase()}` : 'Not available yet'}
                    </button>
                  ) : (
                    <button type="button" className={planButtonClass(id)} disabled={!canChoose} onClick={() => choose(cta)}>
                      {CTA_VERB[cta]} {plan.name}
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )
                }
              />
            );
          })}
        </PlanCardGrid>

        {blocked && <p className="text-center text-sm text-zinc-400">{blocked}</p>}

        <PlanComparison currentPlan={onTrial ? null : paidPlan} prices={prices} />
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
