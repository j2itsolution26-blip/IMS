'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Clock, FileText, Info, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PLANS, type PlanId } from '@/lib/plans';
import { BILLING_LABEL, INTERVAL_LABEL, invoicePeriod, type BillingFlag, type BillingInterval } from '@/lib/billing';
import { PAYMENT_METHOD_LABEL } from '@/lib/subscription';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { selectPlanAction, submitPaymentAction, withdrawInvoiceAction } from '@/features/billing/actions';

export interface BillingPanelProps {
  canManage: boolean;
  subscription: { status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED'; trialEndsAt: string | null; currentPeriodEnd: string | null };
  prices: { plan: PlanId; interval: BillingInterval; amount: number }[];
  terms: { version: number; body: string } | null;
  paymentInstructions: string | null;
  openInvoice: {
    id: string;
    number: string;
    plan: PlanId;
    interval: BillingInterval;
    amount: number;
    periodStart: string;
    periodEnd: string;
    dueAt: string;
    flag: BillingFlag;
    pending: { method: keyof typeof PAYMENT_METHOD_LABEL; reference: string; submittedAt: string } | null;
    lastRejection: { reason: string; at: string } | null;
  } | null;
}

const peso = (amount: number) => formatCurrency(amount, 'PHP');
const fieldClass =
  'flex h-9 w-full rounded-full border border-input bg-transparent px-3.5 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** The owner's billing actions. Every check here is repeated on the server. */
export function BillingPanel(props: BillingPanelProps) {
  return props.openInvoice ? <OpenInvoice {...props} invoice={props.openInvoice} /> : <PlanChooser {...props} />;
}

// --- No open invoice: choose a plan --------------------------------------------

function PlanChooser({ canManage, subscription, prices, terms }: BillingPanelProps) {
  const intervals = (['MONTHLY', 'ANNUAL'] as const).filter((interval) => prices.some((price) => price.interval === interval));
  const [interval, setInterval] = React.useState<BillingInterval>(intervals[0] ?? 'MONTHLY');
  const [choice, setChoice] = React.useState<PlanId | null>(null);

  if (prices.length === 0 || !terms) {
    return (
      <div className="space-y-2 p-4 text-sm">
        <p className="flex items-start gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          Paid plans are not open for self-service yet. The platform administrator has not published prices
          {terms ? '' : ' and billing terms'}.
        </p>
        <p className="text-muted-foreground">
          Nothing is owed. You can still pay the administrator directly; they will record it for you.
        </p>
      </div>
    );
  }

  const offered = (['BASIC', 'BUSINESS', 'ENTERPRISE'] as const)
    .map((plan) => ({ plan, price: prices.find((p) => p.plan === plan && p.interval === interval) }))
    .filter((row): row is { plan: PlanId; price: { plan: PlanId; interval: BillingInterval; amount: number } } => Boolean(row.price));

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm text-muted-foreground">
        Choosing a plan issues an invoice for you to pay. Nothing changes and nothing is charged until your payment is
        verified.
      </p>

      {intervals.length > 1 && (
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full bg-muted p-1">
          {intervals.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={interval === option}
              onClick={() => setInterval(option)}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                interval === option ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {INTERVAL_LABEL[option]}
            </button>
          ))}
        </div>
      )}

      <ul className="grid gap-3 sm:grid-cols-3">
        {offered.map(({ plan, price }) => {
          const definition = PLANS[plan];
          const limit = (value: number | null, noun: string) => (value === null ? `Unlimited ${noun}` : `Up to ${value.toLocaleString('en-PH')} ${noun}`);
          return (
            <li key={plan} className="flex flex-col rounded-xl border p-4">
              <p className="font-semibold">{definition.name}</p>
              <p className="mt-1">
                <span className="tabular text-xl font-bold">{peso(price.amount)}</span>
                <span className="text-sm text-muted-foreground"> / {interval === 'MONTHLY' ? 'month' : 'year'}</span>
              </p>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                <li>{limit(definition.limits.products, 'products')}</li>
                <li>{limit(definition.limits.staff, 'staff accounts')}</li>
                <li>{limit(definition.limits.branches, 'branches')}</li>
              </ul>
              {canManage && (
                <Button className="mt-4" variant="outline" onClick={() => setChoice(plan)}>
                  Choose {definition.name}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {!canManage && <p className="text-xs text-muted-foreground">Only the store owner can choose a plan.</p>}

      {choice && (
        <ChoosePlanDialog
          plan={choice}
          interval={interval}
          amount={offered.find((row) => row.plan === choice)!.price.amount}
          subscription={subscription}
          terms={terms}
          onClose={() => setChoice(null)}
        />
      )}
    </div>
  );
}

function ChoosePlanDialog({
  plan,
  interval,
  amount,
  subscription,
  terms,
  onClose,
}: {
  plan: PlanId;
  interval: BillingInterval;
  amount: number;
  subscription: BillingPanelProps['subscription'];
  terms: { version: number; body: string };
  onClose: () => void;
}) {
  const router = useRouter();
  const [accepted, setAccepted] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // A preview only; the server recomputes the period from its own clock.
  const period = invoicePeriod({
    subscription: {
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt ? new Date(subscription.trialEndsAt) : null,
      currentPeriodEnd: subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null,
    },
    interval,
    now: new Date(),
  });

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await selectPlanAction({ plan, interval, termsVersion: terms.version, acceptTerms: accepted });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`Invoice ${result.data.number} issued.`);
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Choose {PLANS[plan].name}</DialogTitle>
          <DialogDescription>Review the amount and terms. An invoice is issued; nothing is charged automatically.</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border p-3 text-sm">
          <dt className="text-muted-foreground">Plan</dt>
          <dd className="font-medium">{PLANS[plan].name}</dd>
          <dt className="text-muted-foreground">Billing</dt>
          <dd className="font-medium">{INTERVAL_LABEL[interval]}</dd>
          <dt className="text-muted-foreground">Amount due</dt>
          <dd className="tabular font-semibold">{peso(amount)}</dd>
          <dt className="text-muted-foreground">Covers</dt>
          <dd className="font-medium">
            {formatDate(period.periodStart)} – {formatDate(period.periodEnd)}
          </dd>
          <dt className="text-muted-foreground">Due by</dt>
          <dd className="font-medium">{formatDate(period.dueAt)}</dd>
        </dl>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">Billing terms (version {terms.version})</p>
          <div className="max-h-48 overflow-y-auto scrollbar-thin whitespace-pre-wrap rounded-xl border bg-muted/30 p-3 text-xs leading-relaxed">
            {terms.body}
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={accepted} onCheckedChange={(value) => setAccepted(value === true)} className="mt-0.5" />
          <span>
            I agree to these billing terms and to pay {peso(amount)} for {PLANS[plan].name} ({INTERVAL_LABEL[interval].toLowerCase()}) by{' '}
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

// --- Open invoice: pay and report ----------------------------------------------

const FLAG_TONE: Record<BillingFlag, string> = {
  PLAN_SELECTED: 'bg-primary/10 text-primary',
  PAYMENT_DUE: 'bg-warning/15 text-warning-text',
  PAYMENT_PENDING: 'bg-primary/10 text-primary',
  PAST_DUE: 'bg-destructive/10 text-destructive-text',
};

function OpenInvoice({
  canManage,
  paymentInstructions,
  invoice,
}: BillingPanelProps & { invoice: NonNullable<BillingPanelProps['openInvoice']> }) {
  const router = useRouter();
  const [withdrawing, setWithdrawing] = React.useState(false);

  const withdraw = async () => {
    const result = await withdrawInvoiceAction({ invoiceId: invoice.id });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Plan choice withdrawn.');
    router.refresh();
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Invoice {invoice.number}
          </p>
          <p className="mt-1">
            <span className="tabular text-2xl font-bold">{peso(invoice.amount)}</span>
            <span className="ml-1.5 text-sm text-muted-foreground">amount due</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {PLANS[invoice.plan].name}, {INTERVAL_LABEL[invoice.interval].toLowerCase()} · covers {formatDate(invoice.periodStart)} –{' '}
            {formatDate(invoice.periodEnd)}
          </p>
        </div>
        <div className="text-right">
          <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold', FLAG_TONE[invoice.flag])}>
            {BILLING_LABEL[invoice.flag]}
          </span>
          <p className="mt-1 flex items-center justify-end gap-1 text-sm">
            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> Due {formatDate(invoice.dueAt)}
          </p>
        </div>
      </div>

      {invoice.lastRejection && !invoice.pending && (
        <p role="status" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
          Your last payment could not be verified ({formatDate(invoice.lastRejection.at)}): {invoice.lastRejection.reason}
        </p>
      )}

      {invoice.pending ? (
        <p role="status" className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            {PAYMENT_METHOD_LABEL[invoice.pending.method]} payment <span className="font-mono">{invoice.pending.reference}</span>{' '}
            submitted {formatDate(invoice.pending.submittedAt)}. It is awaiting verification by the platform administrator; your plan
            starts as soon as it is verified.
          </span>
        </p>
      ) : (
        <>
          <div className="space-y-1.5">
            <p className="text-sm font-medium">How to pay</p>
            {paymentInstructions ? (
              <div className="whitespace-pre-wrap rounded-xl border bg-muted/30 p-3 text-sm">{paymentInstructions}</div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Payment instructions have not been published yet. Contact the platform administrator for GCash or bank details.
              </p>
            )}
          </div>
          {canManage ? (
            <SubmitPaymentForm invoiceId={invoice.id} />
          ) : (
            <p className="text-xs text-muted-foreground">Only the store owner can report a payment.</p>
          )}
        </>
      )}

      {canManage && !invoice.pending && (
        <div className="border-t pt-3">
          <Button variant="ghost" size="sm" onClick={() => setWithdrawing(true)}>
            Withdraw plan choice
          </Button>
          <ConfirmDialog
            open={withdrawing}
            onOpenChange={setWithdrawing}
            title="Withdraw your plan choice?"
            description={`Invoice ${invoice.number} is voided and nothing is owed for it. You can choose a plan again any time.`}
            confirmLabel="Withdraw"
            destructive
            onConfirm={withdraw}
          />
        </div>
      )}
    </div>
  );
}

function SubmitPaymentForm({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = React.useState({ method: 'GCASH', reference: '', paidAt: today, notes: '' });
  const [errors, setErrors] = React.useState<Record<string, string[] | undefined>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    setFormError(null);
    const result = await submitPaymentAction({ invoiceId, ...form, notes: form.notes || undefined });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      setFormError(result.fieldErrors && Object.keys(result.fieldErrors).length > 0 ? null : result.error);
      return;
    }
    toast.success('Payment submitted for verification.');
    router.refresh();
  };

  const err = (key: string) => errors[key]?.[0];

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border p-3" noValidate>
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Receipt className="h-4 w-4 text-primary" aria-hidden="true" /> Report your payment
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="pay-method">Method</Label>
          <select id="pay-method" className={fieldClass} value={form.method} onChange={set('method')}>
            {Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pay-reference">Reference number</Label>
          <Input id="pay-reference" value={form.reference} onChange={set('reference')} autoComplete="off" aria-invalid={Boolean(err('reference'))} />
          {err('reference') && <p className="text-xs text-destructive-text">{err('reference')}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pay-date">Date paid</Label>
          <Input id="pay-date" type="date" max={today} value={form.paidAt} onChange={set('paidAt')} aria-invalid={Boolean(err('paidAt'))} />
          {err('paidAt') && <p className="text-xs text-destructive-text">{err('paidAt')}</p>}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pay-notes">Note for the administrator (optional)</Label>
        <Input id="pay-notes" value={form.notes} onChange={set('notes')} maxLength={500} />
      </div>
      {formError && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
          {formError}
        </p>
      )}
      <Button type="submit" loading={busy}>
        Submit for verification
      </Button>
    </form>
  );
}
