'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Ban, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import type { PaymentMethod } from '@prisma/client';
import type { SaleDetail } from '@/features/sales/queries';
import { createReturnAction, voidSaleAction } from '@/features/sales/actions';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency, formatQuantity } from '@/lib/format';

/**
 * Void and return controls for a completed sale.
 *
 * Void reverses the whole invoice; a return handles part of it and refunds the
 * customer. Both are refused by the server when they would double-count, and
 * the message explains why.
 */
export function SaleActions({
  sale,
  currency,
  canVoid,
  canReturn,
}: {
  sale: SaleDetail;
  currency: string;
  canVoid: boolean;
  canReturn: boolean;
}) {
  const router = useRouter();

  const [voidOpen, setVoidOpen] = React.useState(false);
  const [voidReason, setVoidReason] = React.useState('');
  const [voiding, setVoiding] = React.useState(false);

  const [returnOpen, setReturnOpen] = React.useState(false);
  const [returnReason, setReturnReason] = React.useState('');
  const [restock, setRestock] = React.useState(true);
  const [refundMethod, setRefundMethod] = React.useState<PaymentMethod>('CASH');
  const [quantities, setQuantities] = React.useState<Record<string, string>>({});
  const [returning, setReturning] = React.useState(false);

  const returnableItems = sale.items.filter((item) => item.returnable > 0);
  const alreadyVoided = sale.status === 'VOIDED';
  const fullyReturned = sale.status === 'RETURNED';

  const refundTotal = returnableItems.reduce((acc, item) => {
    const quantity = Number(quantities[item.id]) || 0;
    if (quantity <= 0) return acc;
    // Mirror the server: refund at the price paid, net of the line's discount share.
    const effectiveUnit = item.quantity > 0 ? item.unitPrice - item.discount / item.quantity : item.unitPrice;
    return acc + effectiveUnit * quantity;
  }, 0);

  const onVoid = async () => {
    setVoiding(true);
    const result = await voidSaleAction({ saleId: sale.id, reason: voidReason });
    setVoiding(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success(`${sale.invoiceNumber} voided and stock restored.`);
    setVoidOpen(false);
    router.refresh();
  };

  const onReturn = async () => {
    const lines = Object.entries(quantities)
      .map(([saleItemId, value]) => ({ saleItemId, quantity: Number(value) || 0 }))
      .filter((line) => line.quantity > 0);

    if (lines.length === 0) {
      toast.error('Enter a quantity for at least one line.');
      return;
    }

    setReturning(true);
    const result = await createReturnAction({
      saleId: sale.id,
      reason: returnReason,
      restock,
      refundMethod,
      lines,
    });
    setReturning(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success(
      `Return ${result.data.returnNumber} processed — ${formatCurrency(result.data.total, currency)} refunded.`,
    );
    setReturnOpen(false);
    setQuantities({});
    setReturnReason('');
    router.refresh();
  };

  if (alreadyVoided) return null;

  return (
    <>
      {canReturn && !fullyReturned && returnableItems.length > 0 && (
        <Button variant="outline" onClick={() => setReturnOpen(true)}>
          <RotateCcw /> Record return
        </Button>
      )}

      {canVoid && sale.returns.length === 0 && (
        <Button variant="outline" onClick={() => setVoidOpen(true)}>
          <Ban /> Void sale
        </Button>
      )}

      {/* Void */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Void {sale.invoiceNumber}?</DialogTitle>
            <DialogDescription>
              Every item goes back into stock and the sale stops counting toward revenue. The invoice is kept
              on record, marked as voided.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="void-reason">Reason</Label>
            <Textarea
              id="void-reason"
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              rows={3}
              placeholder="Why is this sale being voided?"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)} disabled={voiding}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onVoid} loading={voiding} disabled={voidReason.trim().length < 4}>
              Void sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Return */}
      <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Return against {sale.invoiceNumber}</DialogTitle>
            <DialogDescription>
              Enter how much of each line is coming back. Only quantities not already returned can be selected.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <ul className="max-h-56 space-y-2 overflow-y-auto scrollbar-thin rounded-md border p-2">
              {returnableItems.map((item) => (
                <li key={item.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="tabular text-xs text-muted-foreground">
                      {formatQuantity(item.returnable)} of {formatQuantity(item.quantity)} returnable ·{' '}
                      {formatCurrency(item.unitPrice, currency)}
                    </p>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={item.returnable}
                    step="0.001"
                    value={quantities[item.id] ?? ''}
                    onChange={(event) =>
                      setQuantities((current) => ({ ...current, [item.id]: event.target.value }))
                    }
                    className="h-8 w-24 text-right"
                    aria-label={`Quantity to return for ${item.name}`}
                  />
                </li>
              ))}
            </ul>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="refund-method">Refund via</Label>
                <Select value={refundMethod} onValueChange={(value) => setRefundMethod(value as PaymentMethod)}>
                  <SelectTrigger id="refund-method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="GCASH">GCash</SelectItem>
                    <SelectItem value="CARD">Card</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-start justify-between gap-2 rounded-md border p-3">
                <div>
                  <Label htmlFor="restock">Return to stock</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Turn off if the goods came back damaged.
                  </p>
                </div>
                <Switch id="restock" checked={restock} onCheckedChange={setRestock} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="return-reason">Reason</Label>
              <Textarea
                id="return-reason"
                value={returnReason}
                onChange={(event) => setReturnReason(event.target.value)}
                rows={2}
                placeholder="Faulty, wrong item, changed mind…"
              />
            </div>

            <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
              <span className="text-sm font-medium">Refund total</span>
              <span className="tabular text-lg font-bold">{formatCurrency(refundTotal, currency)}</span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnOpen(false)} disabled={returning}>
              Cancel
            </Button>
            <Button
              onClick={onReturn}
              loading={returning}
              disabled={returnReason.trim().length < 4 || refundTotal <= 0}
            >
              Process return
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
