'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { stockInAction } from '@/features/inventory/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatQuantity } from '@/lib/format';

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
  unit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  currentStock: number;
  unit: string;
}) {
  const router = useRouter();
  const [quantity, setQuantity] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setQuantity('');
  }, [open]);

  const added = Number(quantity);
  const newStock = currentStock + (Number.isFinite(added) ? added : 0);

  const onSave = async () => {
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Enter a quantity greater than zero.');
      return;
    }

    setSaving(true);
    const result = await stockInAction({ productId, quantity: qty });
    setSaving(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    toast.success(`${productName} stocked in.`);
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
            <span className="tabular font-medium">
              {formatQuantity(currentStock)} {unit}
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-stock-qty">Add</Label>
            <Input
              id="add-stock-qty"
              type="number"
              step="0.001"
              min="0"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && onSave()}
            />
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
            <span className="text-muted-foreground">New stock</span>
            <span className="tabular font-semibold">
              {formatQuantity(newStock)} {unit}
            </span>
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
