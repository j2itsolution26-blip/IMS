'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { stockInAction } from '@/features/inventory/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { UNITS, formatPieces, quantityProblem, type ProductUnit } from '@/lib/quantity';

/**
 * "Add stock" — the lightweight receiving flow, shown as Current / Add / New
 * so an owner never has to think in terms of "inventory movements".
 * Controlled by the parent (the row's action menu) rather than owning its own
 * trigger, since it can be opened from more than one place.
 */
export function StockInDialog({
  open,
  onOpenChange,
  productId,
  productName,
  currentStock,
  unit = 'PIECE',
  allowsDecimal,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  currentStock: number;
  unit?: ProductUnit;
  /**
   * Whether the product takes fractions. Unknown (undefined) accepts up to 3
   * decimals and leaves the product's own rule to the server.
   */
  allowsDecimal?: boolean;
}) {
  const wholeOnly = allowsDecimal === false;
  const plural = UNITS[unit].plural;
  const router = useRouter();
  const [quantity, setQuantity] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  // A second Enter press while the first save is in flight must not receive
  // the same delivery twice. State updates are async, so a ref is the guard.
  const inFlight = React.useRef(false);

  React.useEffect(() => {
    if (open) setQuantity('');
  }, [open]);

  const added = Number(quantity);
  const addedOk = quantityProblem(quantity, { allowsDecimal: !wholeOnly, unit }) === null;
  const newStock = Math.round((currentStock + (addedOk ? added : 0)) * 1000) / 1000;

  const onSave = async () => {
    if (inFlight.current) return;
    const qty = Number(quantity);
    const problem = quantityProblem(quantity, { allowsDecimal: !wholeOnly, unit });
    if (problem) {
      toast.error(`Quantity received: ${problem}`);
      return;
    }

    inFlight.current = true;
    setSaving(true);
    const result = await stockInAction({ productId, quantity: qty });
    setSaving(false);
    inFlight.current = false;

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`${productName}: received ${formatPieces(qty, unit)}.`);
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add stock — {productName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
            <span className="text-muted-foreground">Current stock</span>
            <span className="tabular font-medium">{formatPieces(currentStock, unit)}</span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-stock-qty">Quantity received ({plural})</Label>
            <Input
              id="add-stock-qty"
              type="number"
              step={wholeOnly ? '1' : 'any'}
              min={wholeOnly ? '1' : '0'}
              inputMode={wholeOnly ? 'numeric' : 'decimal'}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && onSave()}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span className="text-muted-foreground">New stock</span>
            <span className="tabular font-semibold">{formatPieces(newStock, unit)}</span>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" loading={saving} onClick={onSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
