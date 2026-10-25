'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  Building2,
  CalendarClock,
  Check,
  CircleDot,
  Clock,
  Copy,
  FileText,
  Info,
  Printer,
  Send,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PLANS } from '@/lib/plans';
import { INTERVAL_LABEL, paymentReportProblems, type TimelineStepKey } from '@/lib/billing';
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from '@/lib/subscription';
import { formatGcashNumber, type PaymentAccount } from '@/lib/payment-accounts';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { submitPaymentAction, withdrawInvoiceAction } from '@/features/billing/actions';
import { InvoiceStatusBadge } from '@/features/billing/status-badges';
import { InvoiceDetail } from '@/features/billing/invoices-table';
import type { InvoiceRow, OpenInvoiceInfo } from '@/features/billing/types';

const peso = (amount: number) => formatCurrency(amount, 'PHP');

/**
 * The open invoice and everything needed to settle it: the invoice itself,
 * where to send the money, reporting the payment, and where it stands. A
 * report waits as PENDING until the platform administrator verifies it;
 * nothing about the subscription changes until then. Every check here is
 * repeated on the server.
 */
export function InvoicePayment({
  canManage,
  suspended,
  storeName,
  invoice,
  printable,
  accounts,
  paymentNotes,
  methods,
}: {
  canManage: boolean;
  suspended: boolean;
  storeName: string;
  invoice: OpenInvoiceInfo;
  /** The same invoice as a history row, for the print view. */
  printable: InvoiceRow | null;
  /** Accounts shown to owners (enabled only). */
  accounts: PaymentAccount[];
  /** The administrator's free-text payment notes. */
  paymentNotes: string | null;
  /** The methods a payment can be reported with; the server enforces the same list. */
  methods: PaymentMethod[];
}) {
  const router = useRouter();
  const [withdrawing, setWithdrawing] = React.useState(false);
  const [printing, setPrinting] = React.useState(false);
  const overdue = invoice.status === 'OVERDUE';
  const canReport = canManage && !suspended && !invoice.pending;

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
    <div className="space-y-4">
      {/* The invoice */}
      <section
        aria-labelledby="invoice-heading"
        className={cn(
          'overflow-hidden rounded-card border bg-card shadow-card',
          overdue ? 'border-destructive/40' : invoice.pending ? 'border-info/30' : 'border-warning/40',
        )}
      >
        <div
          className={cn(
            'flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6',
            overdue ? 'bg-destructive/5' : invoice.pending ? 'bg-info/5' : 'bg-warning/5',
          )}
        >
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" aria-hidden="true" />
              <span id="invoice-heading" className="font-medium text-foreground">
                Invoice <span className="font-mono">{invoice.number}</span>
              </span>
              <InvoiceStatusBadge status={invoice.status} />
            </p>
            <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount payable</p>
            <p className={cn('tabular text-4xl font-extrabold tracking-tight', overdue && 'text-destructive-text')}>{peso(invoice.amount)}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {PLANS[invoice.plan].name} plan, billed {INTERVAL_LABEL[invoice.interval].toLowerCase()}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {printable && (
              <Button variant="outline" size="sm" className="bg-card" onClick={() => setPrinting(true)}>
                <Printer aria-hidden="true" /> View &amp; print
              </Button>
            )}
            {canReport && (
              <Button variant="ghost" size="sm" onClick={() => setWithdrawing(true)}>
                Withdraw plan choice
              </Button>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t bg-border text-sm sm:grid-cols-4">
          <Fact label="Billing period">
            {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
          </Fact>
          <Fact label="Issued">{formatDate(invoice.issuedAt)}</Fact>
          <Fact label="Due">
            <span className={cn('inline-flex items-center gap-1', overdue && 'font-semibold text-destructive-text')}>
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {formatDate(invoice.dueAt)}
            </span>
          </Fact>
          <Fact label="Plan">
            {PLANS[invoice.plan].name} · {INTERVAL_LABEL[invoice.interval]}
          </Fact>
        </dl>
      </section>

      {/* Where it stands */}
      <PaymentTimeline steps={invoice.timeline} />

      {/* Paying it */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PaymentAccounts accounts={accounts} notes={paymentNotes} amount={invoice.amount} />
        <div className="space-y-3">
          {invoice.lastRejection && !invoice.pending && (
            <p role="status" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive-text" aria-hidden="true" />
              <span>
                <span className="font-semibold text-destructive-text">Your last report could not be verified</span> (
                {formatDate(invoice.lastRejection.at)}): {invoice.lastRejection.reason} Check the details and report it again.
              </span>
            </p>
          )}
          {invoice.pending ? (
            <div role="status" className="rounded-card border border-info/30 bg-info/5 p-4 text-sm sm:p-5">
              <p className="flex items-center gap-2 font-semibold">
                <Clock className="h-4 w-4 text-info-text" aria-hidden="true" /> Payment reported — under review
              </p>
              <p className="mt-2 text-muted-foreground">
                {PAYMENT_METHOD_LABEL[invoice.pending.method]} reference <span className="font-mono text-foreground">{invoice.pending.reference}</span>,
                submitted {formatDateTime(invoice.pending.submittedAt)}. The platform administrator checks that the money arrived; your plan
                starts or extends only when they verify it. Nothing else is needed from you.
              </p>
            </div>
          ) : suspended ? (
            <p className="rounded-card border bg-muted/40 p-4 text-sm text-muted-foreground">
              This store is suspended, so payments cannot be reported here. Contact support.
            </p>
          ) : canManage ? (
            <ReportPaymentForm invoiceId={invoice.id} methods={methods} />
          ) : (
            <p className="rounded-card border bg-muted/40 p-4 text-sm text-muted-foreground">Only the store owner can report a payment.</p>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={withdrawing}
        onOpenChange={setWithdrawing}
        title="Withdraw your plan choice?"
        description={`Invoice ${invoice.number} is voided and nothing is owed for it. You can choose a plan again any time.`}
        confirmLabel="Withdraw"
        destructive
        onConfirm={withdraw}
      />
      {printing && printable && <InvoiceDetail invoice={printable} storeName={storeName} onClose={() => setPrinting(false)} />}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card px-4 py-3 sm:px-6">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}

// --- Timeline -----------------------------------------------------------------

const STEP_LABEL: Record<TimelineStepKey, string> = {
  ISSUED: 'Invoice issued',
  REPORTED: 'Payment reported',
  REVIEW: 'Under review',
  DECISION: 'Verified',
  ACTIVATED: 'Plan active',
};

/** Where this invoice's payment stands, step by step, from its records only. */
function PaymentTimeline({ steps }: { steps: OpenInvoiceInfo['timeline'] }) {
  return (
    <section aria-label="Payment progress" className="rounded-card border bg-card p-4 shadow-card sm:p-5">
      <ol className="grid gap-4 sm:grid-cols-5 sm:gap-2">
        {steps.map((step, index) => {
          const failed = step.state === 'failed';
          const label = step.key === 'DECISION' && failed ? 'Rejected' : STEP_LABEL[step.key];
          const Icon: LucideIcon = failed ? XCircle : step.state === 'done' ? Check : step.state === 'current' ? CircleDot : Clock;
          return (
            <li key={step.key} className="relative flex gap-3 sm:flex-col sm:items-center sm:text-center">
              {index < steps.length - 1 && (
                <span
                  className={cn(
                    'absolute hidden h-0.5 sm:left-[calc(50%+1.25rem)] sm:right-[calc(-50%+1.25rem)] sm:top-4 sm:block',
                    step.state === 'done' ? 'bg-primary' : 'bg-border',
                  )}
                  aria-hidden="true"
                />
              )}
              <span
                className={cn(
                  'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2',
                  step.state === 'done' && 'border-primary bg-primary text-primary-foreground',
                  step.state === 'current' && 'border-warning bg-warning/15 text-warning-text',
                  step.state === 'upcoming' && 'border-border bg-card text-muted-foreground',
                  failed && 'border-destructive bg-destructive/10 text-destructive-text',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className={cn('text-sm font-semibold', step.state === 'upcoming' && 'text-muted-foreground', failed && 'text-destructive-text')}>
                  {label}
                  <span className="sr-only">
                    {' '}
                    — {step.state === 'done' ? 'done' : step.state === 'current' ? 'in progress' : failed ? 'rejected' : 'not yet'}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {step.at ? formatDate(step.at) : step.state === 'current' ? (step.key === 'REVIEW' ? 'Waiting for the administrator' : 'Waiting for you') : ''}
                </p>
                {failed && step.reason && <p className="mt-0.5 text-xs text-destructive-text">{step.reason}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// --- Payment accounts ----------------------------------------------------------

/** Where to send the money: one card per account the administrator shows, each detail copyable. */
function PaymentAccounts({ accounts, notes, amount }: { accounts: PaymentAccount[]; notes: string | null; amount: number }) {
  return (
    <section aria-labelledby="pay-to-heading" className="space-y-3 rounded-card border bg-card p-4 shadow-card sm:p-5">
      <div>
        <h3 id="pay-to-heading" className="text-base font-semibold">
          Pay to
        </h3>
        <ol className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>
            <span className="font-semibold text-foreground">1.</span> Send exactly <span className="tabular font-semibold text-foreground">{peso(amount)}</span> to one of
            the accounts below.
          </li>
          <li>
            <span className="font-semibold text-foreground">2.</span> Keep your receipt and note its reference number.
          </li>
          <li>
            <span className="font-semibold text-foreground">3.</span> Report the payment here. Your plan updates once it is verified.
          </li>
        </ol>
      </div>

      {accounts.length > 0 ? (
        <ul className="space-y-2.5">
          {accounts.map((account) => {
            const Icon = account.kind === 'GCASH' ? Smartphone : Building2;
            const number = account.kind === 'GCASH' ? formatGcashNumber(account.accountNumber) : account.accountNumber;
            return (
              <li key={account.id} className="rounded-xl border bg-muted/20 p-3">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-info/10 text-info-text">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {account.kind === 'GCASH' ? 'GCash' : account.bankName}
                  {account.kind === 'BANK_TRANSFER' && <span className="text-xs font-normal text-muted-foreground">Bank transfer</span>}
                </p>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <CopyRow label="Account name" value={account.accountName} />
                  <CopyRow label={account.kind === 'GCASH' ? 'GCash number' : 'Account number'} value={number} copyValue={account.accountNumber} mono />
                </dl>
                {account.note && <p className="mt-2 text-xs text-muted-foreground">{account.note}</p>}
              </li>
            );
          })}
        </ul>
      ) : notes ? null : (
        <p className="flex items-start gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Payment details have not been published yet. Contact support for the GCash or bank details.
        </p>
      )}

      {notes && <div className="whitespace-pre-wrap rounded-xl bg-muted/30 p-3 text-sm">{notes}</div>}

      <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" aria-hidden="true" />
        <span>
          <span className="font-semibold">Pay only to the accounts shown here.</span> TindahanProMax never asks you to pay another account,
          or by text message or phone call.
        </span>
      </p>
    </section>
  );
}

function CopyRow({ label, value, copyValue, mono }: { label: string; value: string; copyValue?: string; mono?: boolean }) {
  const [copied, setCopied] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyValue ?? value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy. Select the text and copy it instead.');
    }
  };

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className={cn('break-all font-semibold', mono && 'font-mono tracking-wide')}>{value}</dd>
      </div>
      <Button variant="outline" size="sm" className="h-8 shrink-0 bg-card" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
        {copied ? <Check className="text-success-text" aria-hidden="true" /> : <Copy aria-hidden="true" />}
        <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
      </Button>
    </div>
  );
}

// --- Report form ------------------------------------------------------------------

const METHOD_ICON: Record<PaymentMethod, LucideIcon> = { GCASH: Smartphone, BANK_TRANSFER: Building2, OTHER: Send };

type FieldName = 'method' | 'reference' | 'paidAt' | 'notes';

/** Reporting a payment: checked here for quick feedback, then again by the server, which alone records it. */
function ReportPaymentForm({ invoiceId, methods }: { invoiceId: string; methods: PaymentMethod[] }) {
  const router = useRouter();
  const today = React.useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);
  const [form, setForm] = React.useState<Record<FieldName, string>>({ method: methods[0] ?? '', reference: '', paidAt: today, notes: '' });
  const [errors, setErrors] = React.useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const submitting = React.useRef(false);

  const set = (key: FieldName, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    const problems = paymentReportProblems(form, methods, new Date());
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      setFormError(null);
      document.getElementById(`pay-${Object.keys(problems)[0]}`)?.focus();
      return;
    }
    submitting.current = true;
    setBusy(true);
    setErrors({});
    setFormError(null);
    const result = await submitPaymentAction({ invoiceId, ...form, notes: form.notes.trim() || undefined });
    submitting.current = false;
    setBusy(false);
    if (!result.ok) {
      const fieldErrors = Object.fromEntries(Object.entries(result.fieldErrors ?? {}).map(([key, messages]) => [key, messages[0]]));
      setErrors(fieldErrors);
      setFormError(Object.keys(fieldErrors).length > 0 ? null : result.error);
      return;
    }
    toast.success('Payment reported. The platform administrator will verify it.');
    router.refresh();
  };

  const describedBy = (key: FieldName, hint?: string) => [errors[key] ? `pay-${key}-error` : null, hint].filter(Boolean).join(' ') || undefined;
  const fieldError = (key: FieldName) =>
    errors[key] ? (
      <p id={`pay-${key}-error`} className="text-xs text-destructive-text">
        {errors[key]}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} className="space-y-4 rounded-card border bg-card p-4 shadow-card sm:p-5" noValidate aria-labelledby="report-heading">
      <div>
        <h3 id="report-heading" className="text-base font-semibold">
          Report your payment
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">After paying, enter the details from your receipt.</p>
      </div>

      <fieldset className="space-y-1.5" aria-describedby={describedBy('method')}>
        <legend className="text-sm font-medium">How you paid</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {methods.map((method, index) => {
            const Icon = METHOD_ICON[method];
            const selected = form.method === method;
            return (
              <label
                key={method}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-ring',
                  selected ? 'border-primary bg-primary/5 text-foreground' : 'hover:bg-muted/50',
                )}
              >
                <input
                  type="radio"
                  name="pay-method"
                  id={index === 0 ? 'pay-method' : undefined}
                  value={method}
                  checked={selected}
                  onChange={() => set('method', method)}
                  className="sr-only"
                />
                <Icon className={cn('h-4 w-4', selected ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                {PAYMENT_METHOD_LABEL[method]}
                {selected && <Check className="ml-auto h-4 w-4 text-primary" aria-hidden="true" />}
              </label>
            );
          })}
        </div>
        {fieldError('method')}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pay-reference">Reference number</Label>
          <Input
            id="pay-reference"
            value={form.reference}
            onChange={(event) => set('reference', event.target.value)}
            autoComplete="off"
            maxLength={64}
            className="font-mono"
            aria-invalid={Boolean(errors.reference)}
            aria-describedby={describedBy('reference', 'pay-reference-hint')}
          />
          <p id="pay-reference-hint" className="text-xs text-muted-foreground">
            Exactly as on your receipt. Each reference can be reported once.
          </p>
          {fieldError('reference')}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pay-paidAt">Date paid</Label>
          <Input
            id="pay-paidAt"
            type="date"
            max={today}
            value={form.paidAt}
            onChange={(event) => set('paidAt', event.target.value)}
            aria-invalid={Boolean(errors.paidAt)}
            aria-describedby={describedBy('paidAt')}
          />
          {fieldError('paidAt')}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="pay-notes">Note for the administrator (optional)</Label>
        <Input
          id="pay-notes"
          value={form.notes}
          onChange={(event) => set('notes', event.target.value)}
          maxLength={500}
          placeholder="e.g. Paid from my business account"
          aria-invalid={Boolean(errors.notes)}
          aria-describedby={describedBy('notes')}
        />
        {fieldError('notes')}
      </div>

      {formError && (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
          {formError}
        </p>
      )}

      <p className="flex items-start gap-2 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground">
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        Reporting a payment does not activate your plan. It starts or extends only after the platform administrator verifies that the
        money arrived.
      </p>
      <Button type="submit" loading={busy} disabled={methods.length === 0} className="min-h-11 w-full">
        <ShieldCheck aria-hidden="true" /> Submit for verification
      </Button>
    </form>
  );
}
