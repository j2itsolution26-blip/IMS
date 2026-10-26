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
  ImageUp,
  Info,
  Printer,
  QrCode,
  Receipt,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  TimerOff,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { PLANS } from '@/lib/plans';
import { INTERVAL_LABEL, invoiceExpiresAt, paymentReportProblems } from '@/lib/billing';
import { checkoutSteps } from '@/lib/billing-checkout';
import { BILLING_IMAGE_ACCEPT, BILLING_IMAGE_TYPES, checkImageSize, formatMegabytes } from '@/lib/billing-files';
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from '@/lib/subscription';
import { formatGcashNumber } from '@/lib/payment-accounts';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { submitPaymentAction, withdrawInvoiceAction } from '@/features/billing/actions';
import { InvoiceStatusBadge } from '@/features/billing/status-badges';
import { InvoiceDetail } from '@/features/billing/invoices-table';
import { THEME, featureLines } from '@/features/billing/plan-card';
import type { CheckoutAccount, InvoiceRow, OpenInvoiceInfo } from '@/features/billing/types';

const peso = (amount: number) => formatCurrency(amount, 'PHP');

/**
 * Checkout for the open invoice: the plan and amount, where to send the
 * money (GCash QR code and number), and submitting the receipt with the
 * reference. A submission waits as PENDING until the platform administrator
 * finds the money in the receiving account; nothing about the subscription
 * changes until then. Every check here is repeated on the server.
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
  receiptMaxBytes,
}: {
  /** The store's owner account: the only one that may pay. */
  canManage: boolean;
  suspended: boolean;
  storeName: string;
  invoice: OpenInvoiceInfo;
  /** The same invoice as a history row, for the print view. */
  printable: InvoiceRow | null;
  /** Accounts owners can pay into (enabled, and GCash with its QR code). */
  accounts: CheckoutAccount[];
  /** The administrator's free-text payment notes. */
  paymentNotes: string | null;
  /** The methods a payment can be reported with; the server enforces the same list. Empty: checkout is closed. */
  methods: PaymentMethod[];
  receiptMaxBytes: number;
}) {
  const router = useRouter();
  const [withdrawing, setWithdrawing] = React.useState(false);
  const [printing, setPrinting] = React.useState(false);
  const overdue = invoice.status === 'OVERDUE';
  const expired = invoice.status === 'EXPIRED';
  const canWithdraw = canManage && !suspended && !invoice.pending;
  const theme = THEME[invoice.plan];
  const PlanIcon = theme.icon;
  const included = featureLines(invoice.plan).filter((line) => line.included).slice(0, 4);

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
      {/* The invoice, in the plan's colours */}
      <section aria-labelledby="invoice-heading" className={cn('overflow-hidden rounded-card border shadow-card', theme.card)}>
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-6">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <FileText className="h-4 w-4" aria-hidden="true" />
              <span id="invoice-heading" className="font-medium text-foreground">
                Invoice <span className="font-mono">{invoice.number}</span>
              </span>
              <InvoiceStatusBadge status={invoice.status} />
            </p>
            <p className="mt-3 flex items-center gap-2">
              <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', theme.soft)}>
                <PlanIcon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span className="text-base font-semibold">
                {PLANS[invoice.plan].name} plan · {INTERVAL_LABEL[invoice.interval]}
              </span>
            </p>
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount due</p>
            <p className={cn('tabular text-4xl font-extrabold tracking-tight', (overdue || expired) && 'text-destructive-text')}>{peso(invoice.amount)}</p>
            <ul className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {included.map((line) => (
                <li key={line.text} className="flex items-center gap-1.5">
                  <Check className={cn('h-3.5 w-3.5 shrink-0', theme.check)} aria-hidden="true" />
                  {line.text}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {printable && (
              <Button variant="outline" size="sm" className="bg-card" onClick={() => setPrinting(true)}>
                <Printer aria-hidden="true" /> View &amp; print
              </Button>
            )}
            {canWithdraw && (
              <Button variant={expired ? 'outline' : 'ghost'} size="sm" className={expired ? 'bg-card' : undefined} onClick={() => setWithdrawing(true)}>
                {expired ? 'Withdraw and choose again' : 'Withdraw plan choice'}
              </Button>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t bg-border text-sm sm:grid-cols-4">
          <Fact label="Billing period">
            {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
          </Fact>
          <Fact label="Issued">{formatDate(invoice.issuedAt)}</Fact>
          <Fact label="Pay by">
            <span className={cn('inline-flex items-center gap-1', (overdue || expired) && 'font-semibold text-destructive-text')}>
              <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {formatDate(invoice.dueAt)}
            </span>
          </Fact>
          <Fact label="Reference for your payment">
            <span className="font-mono">{invoice.number}</span>
          </Fact>
        </dl>
      </section>

      {/* Where it stands */}
      <CheckoutProgress invoice={invoice} />

      {expired && !invoice.pending ? (
        <p role="status" className="flex items-start gap-2 rounded-card border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <TimerOff className="mt-0.5 h-4 w-4 shrink-0 text-destructive-text" aria-hidden="true" />
          <span>
            <span className="font-semibold text-destructive-text">This invoice expired on {formatDate(invoiceExpiresAt(new Date(invoice.dueAt)))}.</span>{' '}
            It no longer accepts payments. {canManage ? 'Withdraw it and choose your plan again to get a new invoice with current dates.' : 'The store owner can choose the plan again.'}{' '}
            If you already paid, contact support with your receipt.
          </span>
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <PaymentAccounts accounts={accounts} notes={paymentNotes} amount={invoice.amount} invoiceNumber={invoice.number} />
          <div className="space-y-3">
            {invoice.lastRejection && !invoice.pending && (
              <p role="status" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive-text" aria-hidden="true" />
                <span>
                  <span className="font-semibold text-destructive-text">Your last payment could not be verified</span> (
                  {formatDate(invoice.lastRejection.at)}): {invoice.lastRejection.reason} You can submit corrected proof below.
                </span>
              </p>
            )}
            {invoice.pending ? (
              <PendingVerification pending={invoice.pending} amount={invoice.amount} />
            ) : suspended ? (
              <p className="rounded-card border bg-muted/40 p-4 text-sm text-muted-foreground">
                This store is suspended, so payments cannot be submitted here. Contact support.
              </p>
            ) : !canManage ? (
              <p className="rounded-card border bg-muted/40 p-4 text-sm text-muted-foreground">Only the store owner can submit a payment.</p>
            ) : methods.length === 0 ? (
              <p role="status" className="flex items-start gap-2 rounded-card border border-warning/40 bg-warning/10 p-4 text-sm">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" aria-hidden="true" />
                <span>
                  <span className="font-semibold">Payments cannot be accepted yet.</span> The payment details have not been set up by the platform
                  administrator. Please do not send money until they appear here; contact support if you need to pay now.
                </span>
              </p>
            ) : (
              <ReportPaymentForm
                invoiceId={invoice.id}
                methods={methods}
                receiptMaxBytes={receiptMaxBytes}
                corrected={invoice.lastRejection !== null}
              />
            )}
          </div>
        </div>
      )}

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

// --- Progress -----------------------------------------------------------------

/** Choose plan → … → Active subscription, from this invoice's records only (lib/billing-checkout). */
function CheckoutProgress({ invoice }: { invoice: OpenInvoiceInfo }) {
  const steps = checkoutSteps({
    issuedAt: invoice.issuedAt,
    timeline: invoice.timeline,
    hasPending: invoice.pending !== null,
    rejectionReason: invoice.lastRejection?.reason ?? null,
  }).map((step) => ({ ...step, detail: step.note ?? (step.at ? formatDate(step.at) : '') }));
  return (
    <section aria-label="Payment progress" className="rounded-card border bg-card p-4 shadow-card sm:p-5">
      <ol className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6 lg:gap-2">
        {steps.map((step, index) => {
          const Icon: LucideIcon =
            step.state === 'failed' ? XCircle : step.state === 'done' ? Check : step.state === 'current' ? CircleDot : Clock;
          return (
            <li key={step.label} className="relative flex gap-3 lg:flex-col lg:items-center lg:text-center">
              {index < steps.length - 1 && (
                <span
                  className={cn(
                    'absolute hidden h-0.5 lg:left-[calc(50%+1.25rem)] lg:right-[calc(-50%+1.25rem)] lg:top-4 lg:block',
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
                  step.state === 'failed' && 'border-destructive bg-destructive/10 text-destructive-text',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-sm font-semibold',
                    step.state === 'upcoming' && 'text-muted-foreground',
                    step.state === 'failed' && 'text-destructive-text',
                  )}
                >
                  {step.label}
                  <span className="sr-only">
                    {' '}
                    — {step.state === 'done' ? 'done' : step.state === 'current' ? 'in progress' : step.state === 'failed' ? 'rejected' : 'not yet'}
                  </span>
                </p>
                {step.detail && (
                  <p className={cn('text-xs', step.state === 'failed' ? 'text-destructive-text' : 'text-muted-foreground')}>{step.detail}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// --- Pending ------------------------------------------------------------------------

function PendingVerification({ pending, amount }: { pending: NonNullable<OpenInvoiceInfo['pending']>; amount: number }) {
  return (
    <div role="status" className="rounded-card border border-warning/40 bg-warning/10 p-4 text-sm sm:p-5">
      <p className="flex items-center gap-2 font-semibold">
        <Clock className="h-4 w-4 text-warning-text" aria-hidden="true" /> Pending verification
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">Amount</dt>
        <dd className="tabular font-medium">{peso(amount)}</dd>
        <dt className="text-muted-foreground">{PAYMENT_METHOD_LABEL[pending.method]} reference</dt>
        <dd className="break-all font-mono font-medium">{pending.reference}</dd>
        <dt className="text-muted-foreground">Date paid</dt>
        <dd className="font-medium">{formatDate(pending.paidAt)}</dd>
        <dt className="text-muted-foreground">Submitted</dt>
        <dd className="font-medium">{formatDateTime(pending.submittedAt)}</dd>
      </dl>
      {pending.receiptId && (
        <a
          href={`/api/billing/receipts/${pending.receiptId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <Receipt className="h-4 w-4" aria-hidden="true" /> View the receipt you sent
        </a>
      )}
      <p className="mt-3 text-muted-foreground">
        <span className="font-medium text-foreground">What happens next:</span> the platform administrator checks that the money arrived in
        the receiving account. Your plan starts or extends only when they verify it, and you will get a notification either way. Nothing
        else is needed from you.
      </p>
    </div>
  );
}

// --- Payment accounts ----------------------------------------------------------

/** Where to send the money: the GCash QR code and number, and any bank accounts, each detail copyable. */
function PaymentAccounts({
  accounts,
  notes,
  amount,
  invoiceNumber,
}: {
  accounts: CheckoutAccount[];
  notes: string | null;
  amount: number;
  invoiceNumber: string;
}) {
  return (
    <section aria-labelledby="pay-to-heading" className="space-y-3 rounded-card border bg-card p-4 shadow-card sm:p-5">
      <div>
        <h3 id="pay-to-heading" className="text-base font-semibold">
          Pay via GCash
        </h3>
        <ol className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>
            <span className="font-semibold text-foreground">1.</span> Open GCash and scan the QR code, or send to the number below.
          </li>
          <li>
            <span className="font-semibold text-foreground">2.</span> Send exactly <span className="tabular font-semibold text-foreground">{peso(amount)}</span>. Put{' '}
            <span className="font-mono text-foreground">{invoiceNumber}</span> in the message if GCash asks for one.
          </li>
          <li>
            <span className="font-semibold text-foreground">3.</span> Take a screenshot of the receipt, then submit it with the reference number.
          </li>
        </ol>
      </div>

      {accounts.length > 0 ? (
        <ul className="space-y-3">
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
                <div className={cn('mt-3', account.qrSrc && 'grid gap-4 sm:grid-cols-[auto,1fr] sm:items-center')}>
                  {account.qrSrc && (
                    <div className="mx-auto w-full max-w-[15rem] rounded-xl border bg-white p-4 shadow-xs sm:mx-0 sm:w-56">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link; next/image cannot optimise it */}
                      <img src={account.qrSrc} alt={`GCash QR code for ${account.accountName}`} className="aspect-square w-full object-contain" />
                      <p className="mt-2 flex items-center justify-center gap-1 text-[11px] font-medium text-neutral-600">
                        <QrCode className="h-3.5 w-3.5" aria-hidden="true" /> Scan with GCash
                      </p>
                    </div>
                  )}
                  <dl className="space-y-2 text-sm">
                    <CopyRow label="Account name" value={account.accountName} />
                    <CopyRow label={account.kind === 'GCASH' ? 'GCash number' : 'Account number'} value={number} copyValue={account.accountNumber} mono />
                    <CopyRow label="Amount" value={peso(amount)} copyValue={amount.toFixed(2)} mono />
                  </dl>
                </div>
                {account.note && <p className="mt-2 text-xs text-muted-foreground">{account.note}</p>}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="flex items-start gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Payment details have not been set up yet. Please do not send money until the GCash QR code and number appear here.
        </p>
      )}

      {notes && accounts.length > 0 && <div className="whitespace-pre-wrap rounded-xl bg-muted/30 p-3 text-sm">{notes}</div>}

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

// --- Submission form ------------------------------------------------------------

const METHOD_ICON: Record<PaymentMethod, LucideIcon> = { GCASH: Smartphone, BANK_TRANSFER: Building2, OTHER: Receipt };

type FieldName = 'method' | 'reference' | 'paidAt' | 'notes' | 'receipt';

/** Submitting the receipt: checked here for quick feedback, then again by the server, which alone records it. */
function ReportPaymentForm({
  invoiceId,
  methods,
  receiptMaxBytes,
  corrected,
}: {
  invoiceId: string;
  methods: PaymentMethod[];
  receiptMaxBytes: number;
  corrected: boolean;
}) {
  const router = useRouter();
  const today = React.useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }, []);
  const [form, setForm] = React.useState<Record<Exclude<FieldName, 'receipt'>, string>>({
    method: methods[0] ?? '',
    reference: '',
    paidAt: today,
    notes: '',
  });
  const [receipt, setReceipt] = React.useState<File | null>(null);
  const [errors, setErrors] = React.useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const submitting = React.useRef(false);

  const set = (key: Exclude<FieldName, 'receipt'>, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const chooseReceipt = (file: File | null) => {
    setErrors((current) => ({ ...current, receipt: undefined }));
    if (!file) {
      setReceipt(null);
      return;
    }
    const problem =
      checkImageSize(file.size, receiptMaxBytes) ??
      (file.type && !(file.type in BILLING_IMAGE_TYPES) ? 'The receipt must be a JPG, PNG or WEBP image.' : null);
    if (problem) {
      setErrors((current) => ({ ...current, receipt: problem }));
      return;
    }
    setReceipt(file);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    const problems: Partial<Record<FieldName, string>> = paymentReportProblems(form, methods, new Date());
    if (!receipt) problems.receipt = 'Attach a screenshot of your GCash receipt.';
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
    const data = new FormData();
    data.set('invoiceId', invoiceId);
    data.set('method', form.method);
    data.set('reference', form.reference);
    data.set('paidAt', form.paidAt);
    if (form.notes.trim()) data.set('notes', form.notes.trim());
    data.set('receipt', receipt!);
    const result = await submitPaymentAction(data).catch(() => null);
    submitting.current = false;
    setBusy(false);
    if (!result) {
      setFormError('The payment could not be sent. Check your connection and try again; nothing was recorded.');
      return;
    }
    if (!result.ok) {
      const fieldErrors = Object.fromEntries(Object.entries(result.fieldErrors ?? {}).map(([key, messages]) => [key, messages[0]]));
      setErrors(fieldErrors);
      setFormError(Object.keys(fieldErrors).length > 0 ? null : result.error);
      return;
    }
    toast.success('Payment submitted. It is now pending verification.');
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
          {corrected ? 'Submit corrected proof' : 'Upload your receipt'}
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">After paying, attach the receipt and enter its details.</p>
      </div>

      {methods.length > 1 && (
        <fieldset className="space-y-1.5" aria-describedby={describedBy('method')}>
          <legend className="text-sm font-medium">How you paid</legend>
          <div className="grid gap-2 sm:grid-cols-2">
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
      )}

      <ReceiptDrop file={receipt} onChange={chooseReceipt} error={errors.receipt} maxBytes={receiptMaxBytes} describedBy={describedBy('receipt', 'pay-receipt-hint')} />
      {fieldError('receipt')}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pay-reference">{form.method === 'GCASH' ? 'GCash reference number' : 'Reference number'}</Label>
          <Input
            id="pay-reference"
            value={form.reference}
            onChange={(event) => set('reference', event.target.value)}
            autoComplete="off"
            inputMode={form.method === 'GCASH' ? 'numeric' : undefined}
            maxLength={64}
            className="font-mono"
            aria-invalid={Boolean(errors.reference)}
            aria-describedby={describedBy('reference', 'pay-reference-hint')}
          />
          <p id="pay-reference-hint" className="text-xs text-muted-foreground">
            Exactly as on your receipt (&ldquo;Ref No.&rdquo;).
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
          placeholder="e.g. Paid from my business GCash account"
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
        Submitting a receipt does not activate your plan. It starts or extends only after the platform administrator confirms the money
        arrived in the receiving account.
      </p>
      <Button type="submit" loading={busy} disabled={methods.length === 0} className="min-h-11 w-full">
        <ShieldCheck aria-hidden="true" /> {busy ? 'Uploading…' : 'Submit for verification'}
      </Button>
    </form>
  );
}

/** Click or drop a receipt image; shows a preview of what will be sent. */
function ReceiptDrop({
  file,
  onChange,
  error,
  maxBytes,
  describedBy,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  error?: string;
  maxBytes: number;
  describedBy?: string;
}) {
  const input = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [preview, setPreview] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pick = (files: FileList | null) => {
    onChange(files?.[0] ?? null);
    if (input.current) input.current.value = '';
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="pay-receipt">Payment receipt</Label>
      <input
        ref={input}
        id="pay-receipt"
        type="file"
        accept={BILLING_IMAGE_ACCEPT}
        className="sr-only"
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        onChange={(event) => pick(event.target.files)}
      />
      {file && preview ? (
        <div className="flex items-center gap-3 rounded-xl border bg-muted/20 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file */}
          <img src={preview} alt="Preview of your receipt" className="h-20 w-16 shrink-0 rounded-md border bg-white object-contain" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="truncate font-medium">{file.name}</p>
            <p className="text-xs text-muted-foreground">{formatMegabytes(file.size)}</p>
            <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={() => input.current?.click()}>
              Choose a different image
            </button>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => onChange(null)} aria-label="Remove the receipt">
            <X aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pick(event.dataTransfer.files);
          }}
          className={cn(
            'flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            dragging ? 'border-primary bg-primary/5' : error ? 'border-destructive/50' : 'hover:border-primary/50 hover:bg-muted/40',
          )}
        >
          <ImageUp className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium">Tap to upload, or drop the screenshot here</span>
          <span id="pay-receipt-hint" className="text-xs text-muted-foreground">
            JPG, PNG or WEBP, up to {formatMegabytes(maxBytes)}
          </span>
        </button>
      )}
    </div>
  );
}
