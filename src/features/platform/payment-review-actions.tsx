'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/format';
import { rejectPaymentAction, verifyPaymentAction } from '@/features/platform/subscription-actions';

/**
 * Approve or reject one payment, each behind its own confirmation. Approving
 * asks the administrator to state they found the money in the receiving
 * account — a receipt alone is not proof. The server re-checks every state
 * under a lock, so a second click or a second administrator cannot apply it twice.
 */
export function PaymentReviewActions({
  paymentId,
  storeId,
  storeName,
  amount,
  reference,
  planName,
  blocked,
}: {
  paymentId: string;
  storeId: string;
  storeName: string;
  amount: number;
  reference: string;
  planName: string;
  /** Why approval is not possible right now (e.g. the invoice is closed); rejecting stays possible. */
  blocked: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState<'approve' | 'reject' | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setOpen(null);
    setConfirmed(false);
    setReason('');
    setError(null);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    const result =
      open === 'approve'
        ? await verifyPaymentAction({ paymentId, storeId, confirmedReceived: confirmed })
        : await rejectPaymentAction({ paymentId, storeId, reason });
    setBusy(false);
    if (!result.ok) {
      setError(result.fieldErrors?.reason?.[0] ?? result.fieldErrors?.confirmedReceived?.[0] ?? result.error);
      router.refresh();
      return;
    }
    toast.success(open === 'approve' ? `Payment approved. ${planName} is active for ${storeName}.` : 'Payment rejected. The owner has been told why.');
    setOpen(null);
    router.refresh();
  };

  const peso = formatCurrency(amount, 'PHP');

  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={() => setOpen('approve')} disabled={blocked !== null} className="min-h-11 sm:flex-1">
          <BadgeCheck aria-hidden="true" /> Approve payment
        </Button>
        <Button variant="outline" onClick={() => setOpen('reject')} className="min-h-11 border-destructive/40 text-destructive-text hover:bg-destructive/10 sm:flex-1">
          <XCircle aria-hidden="true" /> Reject payment
        </Button>
      </div>
      {blocked && <p className="mt-2 text-xs text-muted-foreground">{blocked}</p>}

      <Dialog open={open !== null} onOpenChange={(value) => !value && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{open === 'approve' ? 'Approve this payment?' : 'Reject this payment?'}</DialogTitle>
            <DialogDescription>
              {open === 'approve'
                ? `${peso} from ${storeName}, reference ${reference}. Approving marks the invoice paid and activates ${planName} straight away.`
                : `${peso} from ${storeName}, reference ${reference}. The invoice stays unpaid and the plan does not change. The owner sees your reason and can submit corrected proof.`}
            </DialogDescription>
          </DialogHeader>

          {open === 'approve' ? (
            <label className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
              <Checkbox checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} className="mt-0.5" />
              <span>
                I found <span className="font-semibold">{peso}</span> with reference <span className="font-mono">{reference}</span> in the
                receiving GCash account. The receipt alone is not proof.
              </span>
            </label>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">Reason (the owner sees this)</Label>
              <Textarea
                id="reject-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={300}
                placeholder="e.g. No payment with this reference arrived. Check the reference number and submit again."
                className="min-h-[96px]"
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive-text">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            {open === 'approve' ? (
              <Button onClick={run} loading={busy} disabled={!confirmed}>
                Approve and activate
              </Button>
            ) : (
              <Button variant="destructive" onClick={run} loading={busy} disabled={reason.trim().length < 5}>
                Reject payment
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
