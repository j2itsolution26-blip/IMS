'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Ban, Coins, PackageCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { PaymentMethod } from '@prisma/client';
import type { PurchaseOrderDetail } from '@/features/purchases/queries';
import {
  cancelPurchaseOrderAction,
  receivePurchaseOrderAction,
  recordSupplierPaymentAction,
} from '@/features/purchases/actions';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatQuantity } from '@/lib/format';

/**
 * Receiving, paying, and cancelling a purchase order.
 *
 * Receiving supports partial deliveries: the quantity field defaults to
 * everything still outstanding, and the landed cost can be corrected per line
 * if the supplier invoiced differently from the order.
 */
export function PurchaseActions({
  order,
  currency,
  canReceive,
  canPay,
  canCancel,
}: {
  order: PurchaseOrderDetail;
  currency: string;
  canReceive: boolean;
  canPay: boolean;
  canCancel: boolean;
}) {
  const router = useRouter();

  const [receiveOpen, setReceiveOpen] = React.useState(false);
  const [quantities, setQuantities] = React.useState<Record<string, string>>({});
  const [costs, setCosts] = React.useState<Record<string, string>>({});
  const [receiveNote, setReceiveNote] = React.useState('');
  const [receiving, setReceiving] = React.useState(false);

  const [payOpen, setPayOpen] = React.useState(false);
  const [method, setMethod] = React.useState<PaymentMethod>('BANK_TRANSFER');
  const [amount, setAmount] = React.useState('');
  const [reference, setReference] = React.useState('');
  const [paying, setPaying] = React.useState(false);

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState('');
  const [cancelling, setCancelling] = React.useState(false);

  const outstandingLines = order.items.filter((item) => item.outstanding > 0);
  const isOpen = order.status !== 'RECEIVED' && order.status !== 'CANCELLED';
  const anyReceived = order.items.some((item) => item.receivedQuantity > 0);

  const openReceive = () => {
    // Default to receiving everything still outstanding — the common case.
    setQuantities(
      Object.fromEntries(outstandingLines.map((item) => [item.id, String(item.outstanding)])),
    );
    setCosts(Object.fromEntries(outstandingLines.map((item) => [item.id, item.unitCost.toFixed(2)])));
    setReceiveOpen(true);
  };

  const onReceive = async () => {
    const lines = outstandingLines
      .map((item) => ({
        purchaseItemId: item.id,
        quantity: Number(quantities[item.id]) || 0,
        unitCost: Number(costs[item.id]) || item.unitCost,
      }))
      .filter((line) => line.quantity > 0);

    if (lines.length === 0) {
      toast.error('Enter a quantity for at least one line.');
      return;
    }

    setReceiving(true);
    const result = await receivePurchaseOrderAction({
      purchaseOrderId: order.id,
      note: receiveNote.trim() || undefined,
      lines,
    });
    setReceiving(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success(
      result.data.fullyReceived
        ? 'Order fully received — stock updated.'
        : `${result.data.lineCount} line(s) received — order partially complete.`,
    );
    setReceiveOpen(false);
    setReceiveNote('');
    router.refresh();
  };

  const onPay = async () => {
    setPaying(true);
    const result = await recordSupplierPaymentAction({
      purchaseOrderId: order.id,
      method,
      amount: Number(amount) || 0,
      reference: reference.trim() || undefined,
    });
    setPaying(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success('Payment recorded.');
    setPayOpen(false);
    setAmount('');
    setReference('');
    router.refresh();
  };

  const onCancel = async () => {
    setCancelling(true);
    const result = await cancelPurchaseOrderAction({
      purchaseOrderId: order.id,
      reason: cancelReason,
    });
    setCancelling(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success('Purchase order cancelled.');
    setCancelOpen(false);
    router.refresh();
  };

  const receiveValue = outstandingLines.reduce((acc, item) => {
    const quantity = Number(quantities[item.id]) || 0;
    const cost = Number(costs[item.id]) || item.unitCost;
    return acc + quantity * cost;
  }, 0);

  return (
    <>
      {canReceive && isOpen && outstandingLines.length > 0 && (
        <Button onClick={openReceive}>
          <PackageCheck /> Receive stock
        </Button>
      )}

      {canPay && order.balance > 0 && order.status !== 'CANCELLED' && (
        <Button
          variant="outline"
          onClick={() => {
            setAmount(order.balance.toFixed(2));
            setPayOpen(true);
          }}
        >
          <Coins /> Record payment
        </Button>
      )}

      {canCancel && isOpen && !anyReceived && (
        <Button variant="outline" onClick={() => setCancelOpen(true)}>
          <Ban /> Cancel
        </Button>
      )}

      {/* Receive */}
      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Receive stock for {order.orderNumber}</DialogTitle>
            <DialogDescription>
              Enter what actually arrived. Anything left outstanding stays on the order for a later delivery.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="max-h-72 overflow-y-auto scrollbar-thin rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right">Receiving</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outstandingLines.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.sku} · {formatQuantity(item.receivedQuantity)} of{' '}
                          {formatQuantity(item.quantity)} received
                        </p>
                      </TableCell>
                      <TableCell className="tabular text-right text-muted-foreground">
                        {formatQuantity(item.outstanding)} {item.unit}
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          max={item.outstanding}
                          step="0.001"
                          value={quantities[item.id] ?? ''}
                          onChange={(event) =>
                            setQuantities((current) => ({ ...current, [item.id]: event.target.value }))
                          }
                          className="ml-auto h-8 w-24 text-right"
                          aria-label={`Quantity received for ${item.name}`}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={costs[item.id] ?? ''}
                          onChange={(event) =>
                            setCosts((current) => ({ ...current, [item.id]: event.target.value }))
                          }
                          className="ml-auto h-8 w-28 text-right"
                          aria-label={`Unit cost for ${item.name}`}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <Textarea
              value={receiveNote}
              onChange={(event) => setReceiveNote(event.target.value)}
              rows={2}
              placeholder="Delivery note reference, condition on arrival… (optional)"
            />

            <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
              <span className="text-sm text-muted-foreground">Value being received</span>
              <span className="tabular font-semibold">{formatCurrency(receiveValue, currency)}</span>
            </div>

            <p className="text-xs text-muted-foreground">
              Receiving adds stock immediately and re-averages each product&apos;s cost from what you actually
              paid.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveOpen(false)} disabled={receiving}>
              Cancel
            </Button>
            <Button onClick={onReceive} loading={receiving}>
              Confirm receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Payment */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Record payment</DialogTitle>
            <DialogDescription>
              {formatCurrency(order.balance, currency)} outstanding to {order.supplier.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pay-method">Method</Label>
              <Select value={method} onValueChange={(value) => setMethod(value as PaymentMethod)}>
                <SelectTrigger id="pay-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="BANK_TRANSFER">Bank transfer</SelectItem>
                  <SelectItem value="GCASH">GCash</SelectItem>
                  <SelectItem value="MAYA">Maya</SelectItem>
                  <SelectItem value="CARD">Card</SelectItem>
                  <SelectItem value="CREDIT">On account</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pay-amount">Amount</Label>
              <Input
                id="pay-amount"
                type="number"
                min={0}
                max={order.balance}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="text-right"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pay-reference">Reference</Label>
              <Input
                id="pay-reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="Cheque or transaction number (optional)"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)} disabled={paying}>
              Cancel
            </Button>
            <Button onClick={onPay} loading={paying} disabled={Number(amount) <= 0}>
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel {order.orderNumber}?</DialogTitle>
            <DialogDescription>
              The order is kept on record and marked cancelled. This is only possible because no stock has been
              received against it yet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={cancelling}>
              Keep order
            </Button>
            <Button
              variant="destructive"
              onClick={onCancel}
              loading={cancelling}
              disabled={cancelReason.trim().length < 4}
            >
              Cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
