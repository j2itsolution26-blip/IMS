'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createAdjustmentAction } from '@/features/inventory/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatQuantity } from '@/lib/format';

/**
 * A single-product stock count correction — "there are actually 47 on the
 * shelf". A thin, single-line wrapper over the same adjustment ledger the
 * full Adjustments page writes to, so an owner never has to learn "counted
 * quantity" vs "change by" or pick a product from a list.
 */
export function CorrectStockDialog({
  open,
  onOpenChange,
  productId,
  productName,
  currentStock,
  unit,
  costPrice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  currentStock: number;
  unit: string;
  costPrice: number;
}) {
  const router = useRouter();
  const [value, setValue] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (open) setValue(String(currentStock));
  }, [open, currentStock]);

  const onSave = async () => {
    const counted = Number(value);
    if (!Number.isFinite(counted) || counted < 0) {
      toast.error('Enter the actual quantity on the shelf.');
      return;
    }

    setSaving(true);
    const result = await createAdjustmentAction({
      mode: 'ABSOLUTE',
      reason: 'Stock count correction',
      isOpeningBalance: false,
      lines: [{ productId, quantity: counted, unitCost: costPrice }],
    });
    setSaving(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success(`${productName} stock corrected to ${formatQuantity(counted)} ${unit}.`);
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct stock — {productName}</DialogTitle>
          <DialogDescription>Enter what&apos;s actually on the shelf right now.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="correct-stock-qty">Actual count ({unit})</Label>
          <Input
            id="correct-stock-qty"
            type="number"
            step="0.001"
            min="0"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && onSave()}
          />
          <p className="text-xs text-muted-foreground">
            Currently recorded: {formatQuantity(currentStock)} {unit}
          </p>
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
