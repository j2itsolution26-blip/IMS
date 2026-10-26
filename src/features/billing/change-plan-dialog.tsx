'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PLANS, type PlanId } from '@/lib/plans';
import { INTERVAL_LABEL, invoicePeriod, planDifferences, type BillingInterval, type PlanDirection } from '@/lib/billing';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { selectPlanAction } from '@/features/billing/actions';
import type { BillingTermsInfo, SubscriptionDates } from '@/features/billing/types';

const peso = (amount: number) => formatCurrency(amount, 'PHP');

/** 'CHOOSE' is a trial or lapsed store picking a plan, where "upgrade" means nothing. */
export type PlanAction = PlanDirection | 'CHOOSE';

export const ACTION_VERB: Record<PlanAction, string> = {
  CHOOSE: 'Choose',
  UPGRADE: 'Upgrade to',
  DOWNGRADE: 'Downgrade to',
  CURRENT: 'Renew',
};

/**
 * Confirming a plan choice. It says what is charged, for which period, when
 * the change takes effect and which limits move — then issues an invoice. The
 * period shown is a preview; the server works it out again from its own clock
 * and the stored price.
 *
 * Timing follows `verifyPayment`: nothing changes until the administrator
 * verifies the payment; then the chosen plan applies at once and the paid
 * time runs to the invoice's period end. There is no proration.
 */
export function ChangePlanDialog({
  plan,
  from,
  action,
  interval,
  amount,
  annualSavings,
  subscription,
  terms,
  paymentInstructions,
  onClose,
}: {
  plan: PlanId;
  /** The plan in force now (the trial plan during a trial). */
  from: PlanId;
  action: PlanAction;
  interval: BillingInterval;
  amount: number;
  /** For an annual choice: what it saves against twelve monthly payments, from the published prices. */
  annualSavings: number | null;
  subscription: SubscriptionDates;
  terms: BillingTermsInfo;
  paymentInstructions: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [accepted, setAccepted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const period = invoicePeriod({
    subscription: {
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null,
      currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null,
    },
    interval,
    now: new Date(),
  });
  const differences = planDifferences(from, plan);
  const name = PLANS[plan].name;
  const per = interval === 'MONTHLY' ? 'month' : 'year';

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await selectPlanAction({ plan, interval, termsVersion: terms.version, acceptTerms: accepted });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`Invoice ${result.data.number} issued. Pay it, then report the payment.`);
    onClose();
    router.refresh();
  };

  const timing =
    subscription.status === 'TRIAL' && subscription.trialEndsAt && new Date(subscription.trialEndsAt).getTime() > Date.now()
      ? `Your trial keeps running until the payment is verified. Then ${name} applies straight away, and the paid time runs to ${formatDate(period.periodEnd)} — trial days left over are not lost.`
      : action === 'DOWNGRADE'
        ? `Nothing changes until the payment is verified. Then ${name}'s lower limits apply straight away, including for days left on your current period, and your paid time runs to ${formatDate(period.periodEnd)}. Nothing is deleted: records over a limit stay, but no more can be added.`
        : `Nothing changes until the payment is verified. Then ${name} applies straight away, and your paid time runs to ${formatDate(period.periodEnd)}.`;
  // A lapsed store's paid time starts when the payment is verified, not when the invoice is issued.
  const running =
    (subscription.status === 'TRIAL' && subscription.trialEndsAt && new Date(subscription.trialEndsAt).getTime() > Date.now()) ||
    (subscription.status === 'ACTIVE' && subscription.currentPeriodEnd && new Date(subscription.currentPeriodEnd).getTime() > Date.now());
  const lapsedNote = running ? null : 'Your paid time is counted from the day your payment is verified, so a late verification never costs you days.';

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {ACTION_VERB[action]} {name}
          </DialogTitle>
          <DialogDescription>Choosing a plan issues an invoice for you to pay. Nothing is charged automatically.</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border p-3 text-sm">
          <dt className="text-muted-foreground">Plan</dt>
          <dd className="flex items-center gap-1.5 font-medium">
            {from !== plan && (
              <>
                <span className="text-muted-foreground">{PLANS[from].name}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-label="to" />
              </>
            )}
            {name}
          </dd>
          <dt className="text-muted-foreground">Billing</dt>
          <dd className="font-medium">{INTERVAL_LABEL[interval]}</dd>
          <dt className="text-muted-foreground">Price</dt>
          <dd className="font-medium tabular">
            {peso(amount)} <span className="font-normal text-muted-foreground">/ {per}</span>
          </dd>
          <dt className="text-muted-foreground">Discount</dt>
          <dd className="font-medium tabular">
            {annualSavings !== null ? (
              <span className="text-success-text">{peso(annualSavings)} less than 12 monthly payments</span>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Covers</dt>
          <dd className="font-medium">
            {formatDate(period.periodStart)} – {formatDate(period.periodEnd)}
          </dd>
          <dt className="text-muted-foreground">Due by</dt>
          <dd className="font-medium">{formatDate(period.dueAt)}</dd>
          <dt className="border-t pt-2 font-semibold">Total payable</dt>
          <dd className="border-t pt-2 text-base font-bold tabular">{peso(amount)}</dd>
        </dl>

        <div className="space-y-2 text-sm">
          <p className="flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{timing}</span>
          </p>
          <p className="pl-6 text-xs text-muted-foreground">
            The full {INTERVAL_LABEL[interval].toLowerCase()} price applies; there is no proration or credit for time left on your current plan. Dates are a
            preview and are confirmed when the invoice is issued.
          </p>
          {lapsedNote && <p className="pl-6 text-xs text-muted-foreground">{lapsedNote}</p>}
        </div>

        {differences.length > 0 && (
          <div className="overflow-hidden rounded-xl border">
            <table className="w-full text-sm">
              <caption className="sr-only">What changes</caption>
              <thead>
                <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-semibold">What changes</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{PLANS[from].name}</th>
                  <th scope="col" className="px-3 py-2 font-semibold">{name}</th>
                </tr>
              </thead>
              <tbody>
                {differences.map((row) => (
                  <tr key={row.label} className="border-b last:border-0">
                    <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted-foreground">
                      {row.label}
                    </th>
                    <td className="px-3 py-1.5 tabular-nums">{row.from}</td>
                    <td className={cn('px-3 py-1.5 font-medium tabular-nums', row.lower && 'text-warning-text')}>{row.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <details className="group rounded-xl border bg-muted/30">
          <summary className="cursor-pointer select-none rounded-xl px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Billing terms (version {terms.version})
          </summary>
          <div className="max-h-48 overflow-y-auto scrollbar-thin whitespace-pre-wrap border-t px-3 py-2 text-xs leading-relaxed">
            {terms.body}
          </div>
        </details>

        <details className="group rounded-xl border bg-muted/30">
          <summary className="cursor-pointer select-none rounded-xl px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            How to pay
          </summary>
          <div className="max-h-48 space-y-2 overflow-y-auto scrollbar-thin border-t px-3 py-2 text-xs leading-relaxed">
            <p className="whitespace-pre-wrap">
              {paymentInstructions ??
                'Payment details have not been published yet. After the invoice is issued, contact support for the GCash or bank details.'}
            </p>
            <p className="text-muted-foreground">
              After paying, report the reference number on the invoice. The plan starts once the administrator verifies it.
            </p>
          </div>
        </details>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={accepted} onCheckedChange={(value) => setAccepted(value === true)} className="mt-0.5" />
          <span>
            I agree to the billing terms and to pay {peso(amount)} for {name} ({INTERVAL_LABEL[interval].toLowerCase()}) by{' '}
            {formatDate(period.dueAt)}.
          </span>
        </label>

        {error && (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={confirm} loading={busy} disabled={!accepted}>
            Confirm and issue invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
