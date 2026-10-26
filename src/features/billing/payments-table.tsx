'use client';

import * as React from 'react';
import { Receipt, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PLANS } from '@/lib/plans';
import { PAYMENT_STATUS_LABEL, maskReference, type PaymentDisplayStatus } from '@/lib/billing';
import { PAYMENT_METHOD_LABEL } from '@/lib/subscription';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PaymentStatusBadge } from '@/features/billing/status-badges';
import { HistoryPager, HistoryToolbar, useHistoryList } from '@/features/billing/history-parts';
import { CompactEmpty, DetailRow } from '@/features/billing/compact-empty';
import type { PaymentRow } from '@/features/billing/types';

const peso = (amount: number) => formatCurrency(amount, 'PHP');

/**
 * Payments reported by the owner and payments the administrator recorded.
 * Only verified, non-void ones paid for anything; the rest are labelled as
 * what they are.
 */
export function PaymentsTable({ payments }: { payments: PaymentRow[] }) {
  const list = useHistoryList(
    payments,
    (payment, query) =>
      payment.reference.toLowerCase().includes(query.replace(/\s+/g, '')) || (payment.invoiceNumber ?? '').toLowerCase().includes(query),
    (payment) => payment.status,
    (payment) => payment.paidAt,
  );
  const [open, setOpen] = React.useState<PaymentRow | null>(null);
  const statuses = (Object.keys(PAYMENT_STATUS_LABEL) as PaymentDisplayStatus[])
    .filter((status) => payments.some((payment) => payment.status === status))
    .map((value) => ({ value, label: PAYMENT_STATUS_LABEL[value] }));

  if (payments.length === 0) {
    return (
      <CompactEmpty
        icon={Receipt}
        title="No payments yet"
        description="Payments you report, or the administrator records, appear here. Only verified payments count."
      />
    );
  }

  return (
    <>
      <HistoryToolbar
        idPrefix="payments"
        search={list.search}
        onSearch={list.setSearch}
        searchPlaceholder="Search reference or invoice number"
        status={list.status}
        onStatus={list.setStatus}
        statuses={statuses}
        range={list.range}
        onRange={list.setRange}
      />

      {list.filtered.length === 0 ? (
        <CompactEmpty icon={SearchX} title="No matching payments" description="Try another search, status or date range." />
      ) : (
        <>
          <ul className="divide-y sm:hidden">
            {list.visible.map((payment) => (
              <li key={payment.id} className={cn('space-y-1 px-4 py-3', payment.status === 'VOID' && 'text-muted-foreground')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm">{formatDate(payment.paidAt)}</span>
                  <PaymentStatusBadge status={payment.status} />
                </div>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    {PAYMENT_METHOD_LABEL[payment.method]} <span className="font-mono text-xs">{maskReference(payment.reference)}</span>
                  </span>
                  <span className={cn('tabular font-semibold', payment.status === 'VOID' && 'line-through')}>{peso(payment.amount)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {payment.invoiceNumber ? `For ${payment.invoiceNumber}` : 'Recorded directly'} · by {payment.recordedBy}
                </p>
                <Button variant="outline" size="sm" className="mt-1 min-h-10 w-full" onClick={() => setOpen(payment)}>
                  View details
                </Button>
              </li>
            ))}
          </ul>

          <div className="relative hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Payment history</caption>
              <thead>
                <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="h-10 px-4 font-semibold">Paid</th>
                  <th scope="col" className="h-10 px-4 text-right font-semibold">Amount</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Method</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Reference</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Status</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Recorded by</th>
                  <th scope="col" className="h-10 px-4 font-semibold">Invoice</th>
                  <th scope="col" className="h-10 px-4 text-right font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.visible.map((payment) => (
                  <tr key={payment.id} className={cn('border-b last:border-0', payment.status === 'VOID' && 'text-muted-foreground')}>
                    <td className="px-4 py-2.5">{formatDate(payment.paidAt)}</td>
                    <td className={cn('px-4 py-2.5 text-right tabular-nums', payment.status === 'VOID' && 'line-through')}>
                      {peso(payment.amount)}
                    </td>
                    <td className="px-4 py-2.5">{PAYMENT_METHOD_LABEL[payment.method]}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{maskReference(payment.reference)}</td>
                    <td className="px-4 py-2.5">
                      <PaymentStatusBadge status={payment.status} />
                    </td>
                    <td className="px-4 py-2.5">{payment.recordedBy}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{payment.invoiceNumber ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setOpen(payment)} aria-label={`View payment from ${formatDate(payment.paidAt)}`}>
                        Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <HistoryPager page={list.page} pages={list.pages} total={list.filtered.length} onPage={list.setPage} />
        </>
      )}

      {open && <PaymentDetail payment={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function PaymentDetail({ payment, onClose }: { payment: PaymentRow; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {PAYMENT_METHOD_LABEL[payment.method]} payment, {formatDate(payment.paidAt)}
          </DialogTitle>
          <DialogDescription>
            {payment.status === 'PENDING'
              ? 'Submitted and pending verification. It has not paid for anything yet.'
              : payment.status === 'VERIFIED'
                ? 'Verified by the platform administrator.'
                : payment.status === 'REJECTED'
                  ? 'The administrator could not verify this payment.'
                  : 'This payment was voided and no longer counts.'}
          </DialogDescription>
        </DialogHeader>
        <div>
          <PaymentStatusBadge status={payment.status} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <DetailRow label="Amount">
            <span className="tabular">{peso(payment.amount)}</span>
          </DetailRow>
          <DetailRow label="Reference">
            <span className="font-mono">{payment.reference}</span>
          </DetailRow>
          <DetailRow label="Plan">
            {PLANS[payment.plan].name}, {payment.months} month{payment.months === 1 ? '' : 's'}
          </DetailRow>
          <DetailRow label="Covers">
            {formatDate(payment.periodStart)} – {formatDate(payment.periodEnd)}
          </DetailRow>
          <DetailRow label="Invoice">{payment.invoiceNumber ?? 'Recorded directly by the administrator'}</DetailRow>
          <DetailRow label="Recorded">
            {formatDateTime(payment.submittedAt)} by {payment.recordedBy}
          </DetailRow>
          {payment.verifiedAt && <DetailRow label="Verified">{formatDateTime(payment.verifiedAt)}</DetailRow>}
          {payment.rejectReason && <DetailRow label="Rejection reason">{payment.rejectReason}</DetailRow>}
          {payment.voidReason && <DetailRow label="Void reason">{payment.voidReason}</DetailRow>}
          {payment.notes && <DetailRow label="Note">{payment.notes}</DetailRow>}
          {payment.receiptId && (
            <DetailRow label="Receipt">
              <a
                href={`/api/billing/receipts/${payment.receiptId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                View receipt
              </a>
            </DetailRow>
          )}
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
