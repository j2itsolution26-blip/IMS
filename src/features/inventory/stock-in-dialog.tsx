'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { PackagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { stockInAction } from '@/features/inventory/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/**
 * "Stock In → Enter Quantity → Save" — the lightweight receiving flow.
 * Deliberately simpler than a full adjustment: no reason field, one product.
 */
export function StockInDialog({ productId, productName, unit }: { productId: string; productName: string; unit: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [quantity, setQuantity] = React.useState('');
  const [saving, setSaving] = React.useState(false);

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
    setQuantity('');
    setOpen(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PackagePlus className="h-4 w-4" /> Stock in
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stock in — {productName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="stock-in-qty">Quantity received ({unit})</Label>
          <Input
            id="stock-in-qty"
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
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
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
