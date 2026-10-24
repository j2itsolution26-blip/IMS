'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, Clock, FileText, Info, Receipt, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PLANS } from '@/lib/plans';
import { BILLING_LABEL, INTERVAL_LABEL, type BillingFlag } from '@/lib/billing';
import { PAYMENT_METHOD_LABEL } from '@/lib/subscription';
import { formatCurrency, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { submitPaymentAction, withdrawInvoiceAction } from '@/features/billing/actions';
import type { OpenInvoiceInfo } from '@/features/billing/types';

const peso = (amount: number) => formatCurrency(amount, 'PHP');
const fieldClass =
  'flex h-9 w-full rounded-full border border-input bg-transparent px-3.5 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const FLAG_TONE: Record<BillingFlag, string> = {
  PLAN_SELECTED: 'bg-primary/10 text-primary',
  PAYMENT_DUE: 'bg-warning/15 text-warning-text',
  PAYMENT_PENDING: 'bg-primary/10 text-primary',
  PAST_DUE: 'bg-destructive/10 text-destructive-text',
};

/**
 * The open invoice: what is owed, how to pay it, and reporting the payment.
 * A report waits as PENDING until the platform administrator verifies it;
 * nothing about the subscription changes until then. Every check here is
 * repeated on the server.
 */
export function InvoicePayment({
  canManage,
  suspended,
  paymentInstructions,
  invoice,
}: {
  canManage: boolean;
  suspended: boolean;
  paymentInstructions: string | null;
  invoice: OpenInvoiceInfo;
}) {
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
    <div className="grid gap-4 p-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <FileText className="h-3.5 w-3.5" aria-hidden="true" /> Invoice <span className="font-mono normal-case">{invoice.number}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
            <span className="tabular text-3xl font-bold">{peso(invoice.amount)}</span>
            <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold', FLAG_TONE[invoice.flag])}>
              {BILLING_LABEL[invoice.flag]}
            </span>
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Plan</dt>
            <dd>
              {PLANS[invoice.plan].name}, {INTERVAL_LABEL[invoice.interval].toLowerCase()}
            </dd>
            <dt className="text-muted-foreground">Covers</dt>
            <dd>
              {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
            </dd>
            <dt className="text-muted-foreground">Due</dt>
            <dd className="flex items-center gap-1">
              <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> {formatDate(invoice.dueAt)}
            </dd>
          </dl>
        </div>

        <div className="space-y-1.5">
          <p className="text-sm font-medium">How to pay</p>
          {paymentInstructions ? (
            <div className="whitespace-pre-wrap rounded-xl border bg-muted/30 p-3 text-sm">{paymentInstructions}</div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Payment instructions have not been published yet. Contact support for the GCash or bank details.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3 lg:col-span-3">
        {invoice.lastRejection && !invoice.pending && (
          <p role="status" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
            Your last payment report could not be verified ({formatDate(invoice.lastRejection.at)}): {invoice.lastRejection.reason}
          </p>
        )}

        {invoice.pending ? (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-sm">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">Payment reported — awaiting verification</p>
              <p>
                {PAYMENT_METHOD_LABEL[invoice.pending.method]} reference <span className="font-mono">{invoice.pending.reference}</span>,
                submitted {formatDate(invoice.pending.submittedAt)}. The platform administrator checks that the money arrived; your
                plan changes only once it is verified.
              </p>
            </div>
          </div>
        ) : suspended ? (
          <p className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
            This store is suspended, so payments cannot be reported here. Contact support.
          </p>
        ) : canManage ? (
          <SubmitPaymentForm invoiceId={invoice.id} />
        ) : (
          <p className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">Only the store owner can report a payment.</p>
        )}

        {canManage && !invoice.pending && !suspended && (
          <div className="flex justify-end">
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
    if (form.reference.trim().length < 4) {
      setErrors({ reference: ['Enter the full reference number.'] });
      return;
    }
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
    toast.success('Payment reported. It will be verified by the platform administrator.');
    router.refresh();
  };

  const err = (key: string) => errors[key]?.[0];

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border p-3 sm:p-4" noValidate>
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Receipt className="h-4 w-4 text-primary" aria-hidden="true" /> Report your payment
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">After paying by GCash or bank transfer, enter the reference from your receipt.</p>
      </div>
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
          <Input
            id="pay-reference"
            value={form.reference}
            onChange={set('reference')}
            autoComplete="off"
            maxLength={64}
            aria-invalid={Boolean(err('reference'))}
            aria-describedby={err('reference') ? 'pay-reference-error' : undefined}
          />
          {err('reference') && (
            <p id="pay-reference-error" className="text-xs text-destructive-text">
              {err('reference')}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pay-date">Date paid</Label>
          <Input
            id="pay-date"
            type="date"
            max={today}
            value={form.paidAt}
            onChange={set('paidAt')}
            aria-invalid={Boolean(err('paidAt'))}
            aria-describedby={err('paidAt') ? 'pay-date-error' : undefined}
          />
          {err('paidAt') && (
            <p id="pay-date-error" className="text-xs text-destructive-text">
              {err('paidAt')}
            </p>
          )}
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
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Reporting a payment does not verify it. Your plan changes only after the platform administrator confirms the money arrived.
      </p>
      <Button type="submit" loading={busy} className="min-h-10 w-full sm:w-auto">
        <ShieldCheck aria-hidden="true" /> Submit for verification
      </Button>
    </form>
  );
}
