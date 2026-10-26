'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { PAYMENT_METHOD_LABEL } from '@/lib/subscription';
import { rejectPaymentAction, verifyPaymentAction, voidInvoiceAction } from '@/features/platform/subscription-actions';

export interface QueueRow {
  id: string;
  storeId: string;
  storeName: string;
  invoiceNumber: string | null;
  amount: number;
  method: keyof typeof PAYMENT_METHOD_LABEL;
  reference: string;
  paidAt: string;
  submittedAt: string;
  submittedBy: string;
  notes: string | null;
}

type Review = { kind: 'verify' | 'reject'; row: QueueRow } | null;

/**
 * Payments owners reported, oldest first. Verifying is the only way an
 * owner-reported payment changes a subscription, so it asks the
 * administrator to confirm the money actually arrived.
 */
export function BillingQueue({ rows, canManage }: { rows: QueueRow[]; canManage: boolean }) {
  const [review, setReview] = React.useState<Review>(null);

  return (
    <>
      <ul className="divide-y">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium">
                {row.storeName}
                {row.invoiceNumber && <span className="ml-2 font-mono text-xs text-muted-foreground">{row.invoiceNumber}</span>}
              </p>
              <p className="text-sm">
                <span className="tabular font-semibold">{formatCurrency(row.amount, 'PHP')}</span> · {PAYMENT_METHOD_LABEL[row.method]} ·{' '}
                <span className="font-mono">{row.reference}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                Paid {formatDate(row.paidAt)} · reported {formatDateTime(row.submittedAt)} by {row.submittedBy}
                {row.notes ? ` · “${row.notes}”` : ''}
              </p>
            </div>
            {canManage && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setReview({ kind: 'reject', row })}>
                  <XCircle /> Reject
                </Button>
                <Button size="sm" onClick={() => setReview({ kind: 'verify', row })}>
                  <CheckCircle2 /> Verify
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {review && <ReviewDialog review={review} onClose={() => setReview(null)} />}
    </>
  );
}

function ReviewDialog({ review, onClose }: { review: NonNullable<Review>; onClose: () => void }) {
  const router = useRouter();
  const { kind, row } = review;
  const [checked, setChecked] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result =
      kind === 'verify'
        ? await verifyPaymentAction({ paymentId: row.id, storeId: row.storeId, confirmedReceived: checked })
        : await rejectPaymentAction({ paymentId: row.id, storeId: row.storeId, reason });
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors?.reason?.[0] ?? result.error);
      return;
    }
    toast.success(kind === 'verify' ? `Payment verified; ${row.storeName} is active.` : 'Payment rejected; the owner was told why.');
    onClose();
    router.refresh();
  };

  const amount = formatCurrency(row.amount, 'PHP');

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{kind === 'verify' ? 'Verify payment' : 'Reject payment'}</DialogTitle>
          <DialogDescription>
            {row.storeName}: {amount} by {PAYMENT_METHOD_LABEL[row.method]}, reference <span className="font-mono">{row.reference}</span>.
          </DialogDescription>
        </DialogHeader>

        {kind === 'verify' ? (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={checked} onCheckedChange={(value) => setChecked(value === true)} className="mt-0.5" />
            <span>
              I checked that {amount} with this reference arrived. The invoice is marked paid and the store&apos;s plan starts or extends now.
            </span>
          </label>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="reject-reason">Reason (the owner sees this)</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. No GCash transfer with this reference has arrived."
              maxLength={300}
            />
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-text">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={kind === 'verify' ? 'default' : 'destructive'}
            onClick={submit}
            loading={busy}
            disabled={kind === 'verify' ? !checked : reason.trim().length < 5}
          >
            {kind === 'verify' ? 'Verify payment' : 'Reject payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Voids an open invoice the owner should not owe. A reason is required and audited. */
export function VoidInvoiceButton({ invoiceId, storeId, number }: { invoiceId: string; storeId: string; number: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await voidInvoiceAction({ invoiceId, storeId, reason });
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors?.reason?.[0] ?? result.error);
      return;
    }
    toast.success(`Invoice ${number} voided.`);
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Void
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Void invoice {number}?</DialogTitle>
            <DialogDescription>The owner will no longer owe it. The invoice is kept, marked void, with your reason.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-invoice-reason">Reason</Label>
            <Textarea id="void-invoice-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={300} />
          </div>
          {error && <p className="text-sm text-destructive-text">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submit} loading={busy} disabled={reason.trim().length < 5}>
              Void invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
