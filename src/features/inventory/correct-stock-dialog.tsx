'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createAdjustmentAction } from '@/features/inventory/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatPieces } from '@/lib/quantity';

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  currentStock: number;
}) {
  const router = useRouter();
  const [value, setValue] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  // Blocks a repeated Enter from recording the same correction twice.
  const inFlight = React.useRef(false);

  React.useEffect(() => {
    if (open) setValue(String(currentStock));
  }, [open, currentStock]);

  const onSave = async () => {
    if (inFlight.current) return;
    const counted = Number(value);
    if (!Number.isSafeInteger(counted) || counted < 0) {
      toast.error('Enter the number of pieces on the shelf — a whole number.');
      return;
    }

    inFlight.current = true;
    setSaving(true);
    // No unit cost is sent: the server values the correction at the
    // product's recorded average cost.
    const result = await createAdjustmentAction({
      mode: 'ABSOLUTE',
      reason: 'Stock count correction',
      isOpeningBalance: false,
      lines: [{ productId, quantity: counted }],
    });
    setSaving(false);
    inFlight.current = false;

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success(`${productName} stock corrected to ${formatPieces(counted)}.`);
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct stock — {productName}</DialogTitle>
          <DialogDescription>Enter how many pieces are actually on the shelf right now.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="correct-stock-qty">Actual count (pcs)</Label>
          <Input
            id="correct-stock-qty"
            type="number"
            step="1"
            min="0"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && onSave()}
          />
          <p className="text-xs text-muted-foreground">Currently recorded: {formatPieces(currentStock)}</p>
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
