import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ExternalLink, ImageOff } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { PLANS } from '@/lib/plans';
import { INTERVAL_LABEL, LIFECYCLE_LABEL, billingSnapshot, invoiceExpiresAt } from '@/lib/billing';
import { PAYMENT_METHOD_LABEL } from '@/lib/subscription';
import { formatMegabytes } from '@/lib/billing-files';
import { getPaymentReview } from '@/server/platform/payment-review-queries';
import { Panel } from '@/components/panel';
import { Button } from '@/components/ui/button';
import { InvoiceStatusBadge, PaymentStatusBadge } from '@/features/billing/status-badges';
import { PaymentReviewActions } from '@/features/platform/payment-review-actions';

export const metadata: Metadata = { title: 'Review payment' };
export const dynamic = 'force-dynamic';

const peso = (amount: number) => formatCurrency(amount, 'PHP');

/**
 * One owner-submitted payment: the receipt, what was submitted, the invoice
 * it pays, and the store it would activate — everything needed to check the
 * money against the receiving account before approving or rejecting.
 */
export default async function PaymentReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('platform.view');
  const canManage = userCan(user, 'platform.manage');
  const { id } = await params;
  if (!/^[a-z0-9]{20,40}$/i.test(id)) notFound();
  const now = new Date();
  const payment = await getPaymentReview(id, now);
  if (!payment) notFound();

  const { store, invoice } = payment;
  const lifecycle = billingSnapshot({ subscription: store, openInvoice: null, hasPendingPayment: false, now }).lifecycle;
  const amountMatches = invoice ? payment.amount === invoice.amount : false;
  const lateSubmission = invoice ? payment.submittedAt.getTime() > invoiceExpiresAt(invoice.dueAt).getTime() : false;
  const blocked = !invoice
    ? 'This payment is not linked to an invoice.'
    : invoice.status === 'PAID' || invoice.status === 'VOID'
      ? 'Its invoice is already closed. Reject this payment instead.'
      : !amountMatches
        ? 'The amount does not match the invoice. Reject this payment instead.'
        : lateSubmission
          ? 'It was submitted after the invoice expired. Reject it and void the invoice.'
          : store.status === 'SUSPENDED'
            ? 'The store is suspended. Reactivate it before approving.'
            : null;

  const warnings = [
    payment.receipt === null && 'No receipt was attached (submitted before receipts were required).',
    payment.receipt && payment.receipt.sameImageElsewhere > 0 &&
      `The same receipt image was also sent for ${payment.receipt.sameImageElsewhere} other payment${payment.receipt.sameImageElsewhere === 1 ? '' : 's'}.`,
    payment.sameReferenceElsewhere > 0 &&
      `This reference was used before, on ${payment.sameReferenceElsewhere} rejected submission${payment.sameReferenceElsewhere === 1 ? '' : 's'}.`,
    invoice && !amountMatches && `The amount (${peso(payment.amount)}) differs from the invoice (${peso(invoice.amount)}).`,
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="mb-5 space-y-2">
        <Link href="/system-admin/payments" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Payment verification
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-display">
            {peso(payment.amount)} from {store.name}
          </h1>
          <PaymentStatusBadge status={payment.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {PAYMENT_METHOD_LABEL[payment.method]} reference <span className="font-mono text-foreground">{payment.reference}</span> · submitted{' '}
          {formatDateTime(payment.submittedAt)} by {payment.submittedBy}
        </p>
      </div>

      {warnings.length > 0 && (
        <div role="status" className="mb-4 space-y-1 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
          {warnings.map((warning) => (
            <p key={warning} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-text" aria-hidden="true" />
              {warning}
            </p>
          ))}
        </div>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-5">
        <Panel title="Receipt" description="What the owner uploaded. Check it against the receiving account." className="xl:col-span-2">
          <div className="p-4">
            {payment.receipt ? (
              <>
                <a
                  href={`/api/billing/receipts/${payment.receipt.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block overflow-hidden rounded-xl border bg-white"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed link; next/image cannot optimise it */}
                  <img
                    src={`/api/billing/receipts/${payment.receipt.id}`}
                    alt={`Receipt submitted by ${store.name}`}
                    className="mx-auto max-h-[640px] w-full object-contain"
                  />
                </a>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {payment.receipt.originalName} · {formatMegabytes(payment.receipt.sizeBytes)}
                  </span>
                  <a
                    href={`/api/billing/receipts/${payment.receipt.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    Open full size <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                </div>
              </>
            ) : (
              <p className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                <ImageOff className="h-6 w-6" aria-hidden="true" /> No receipt attached
              </p>
            )}
          </div>
        </Panel>

        <div className="space-y-4 xl:col-span-3">
          <Panel title="Decision" description={payment.status === 'PENDING' ? 'Only after you have found the money.' : 'This payment has been reviewed.'}>
            <div className="p-4">
              {payment.status === 'PENDING' ? (
                canManage ? (
                  <PaymentReviewActions
                    paymentId={payment.id}
                    storeId={store.id}
                    storeName={store.name}
                    amount={payment.amount}
                    reference={payment.reference}
                    planName={PLANS[invoice?.plan ?? store.plan].name}
                    blocked={blocked}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Only an administrator with manage access can approve or reject payments.</p>
                )
              ) : payment.review ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">{payment.status === 'REJECTED' ? 'Rejected by' : 'Approved by'}</dt>
                  <dd className="font-medium">{payment.review.by}</dd>
                  <dt className="text-muted-foreground">When</dt>
                  <dd className="font-medium">{formatDateTime(payment.review.at)}</dd>
                  {payment.review.reason && (
                    <>
                      <dt className="text-muted-foreground">Reason</dt>
                      <dd>{payment.review.reason}</dd>
                    </>
                  )}
                  {payment.status === 'VERIFIED' && (
                    <>
                      <dt className="text-muted-foreground">Bought</dt>
                      <dd className="font-medium">
                        {formatDate(payment.periodStart)} – {formatDate(payment.periodEnd)}
                      </dd>
                    </>
                  )}
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">This payment is void.</p>
              )}
            </div>
          </Panel>

          <Panel title="Submitted details">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
              <Detail label="Amount">
                <span className="tabular">{peso(payment.amount)}</span>
              </Detail>
              <Detail label="Method">{PAYMENT_METHOD_LABEL[payment.method]}</Detail>
              <Detail label="Reference">
                <span className="break-all font-mono">{payment.reference}</span>
              </Detail>
              <Detail label="Date paid">{formatDate(payment.paidAt)}</Detail>
              <Detail label="Submitted">{formatDateTime(payment.submittedAt)}</Detail>
              <Detail label="Submitted by">{payment.submittedBy}</Detail>
              {payment.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">Note from the owner</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap">{payment.notes}</dd>
                </div>
              )}
            </dl>
          </Panel>

          {invoice && (
            <Panel
              title={`Invoice ${invoice.number}`}
              description="What the owner agreed to pay."
              action={<InvoiceStatusBadge status={invoice.status} />}
            >
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
                <Detail label="Plan requested">
                  {PLANS[invoice.plan].name}, {INTERVAL_LABEL[invoice.interval].toLowerCase()}
                </Detail>
                <Detail label="Amount due">
                  <span className="tabular">{peso(invoice.amount)}</span>
                </Detail>
                <Detail label="Quoted period">
                  {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
                </Detail>
                <Detail label="Due">
                  {formatDate(invoice.dueAt)} <span className="text-muted-foreground">(expires {formatDate(invoiceExpiresAt(invoice.dueAt))})</span>
                </Detail>
                <Detail label="Terms accepted">
                  Version {invoice.termsVersion}, {formatDateTime(invoice.acceptedAt)} by {invoice.acceptedBy}
                </Detail>
              </dl>
            </Panel>
          )}

          <Panel
            title={store.name}
            description="The store this payment would activate."
            action={
              <Button asChild size="sm" variant="ghost">
                <Link href={`/system-admin/stores/${store.id}`}>Open store</Link>
              </Button>
            }
          >
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2">
              <Detail label="Owner">
                {store.owner ? (
                  <>
                    {store.owner.name}
                    <span className="block text-xs text-muted-foreground">
                      {[store.owner.email, store.owner.phone].filter(Boolean).join(' · ')}
                    </span>
                  </>
                ) : (
                  'No owner'
                )}
              </Detail>
              <Detail label="Current subscription">
                {PLANS[store.plan].name} · {LIFECYCLE_LABEL[lifecycle]}
              </Detail>
              <Detail label={store.status === 'TRIAL' ? 'Trial ends' : 'Paid until'}>
                {store.status === 'TRIAL'
                  ? store.trialEndsAt
                    ? formatDate(store.trialEndsAt)
                    : '—'
                  : store.currentPeriodEnd
                    ? formatDate(store.currentPeriodEnd)
                    : '—'}
              </Detail>
              <Detail label="After approval">
                {invoice ? `${PLANS[invoice.plan].name}, active; the paid time continues any running period, or starts at approval` : '—'}
              </Detail>
            </dl>
          </Panel>

          <Panel title="Payment history" description="This store's other payments, newest first.">
            {payment.history.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No other payments.</p>
            ) : (
              <ul className="divide-y">
                {payment.history.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span className="min-w-0">
                      <Link href={`/system-admin/payments/${row.id}`} className="font-mono text-xs hover:underline">
                        {row.reference}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {formatDateTime(row.submittedAt)}
                        {row.invoiceNumber ? ` · ${row.invoiceNumber}` : ' · recorded directly'}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular">{peso(row.amount)}</span>
                      <PaymentStatusBadge status={row.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
