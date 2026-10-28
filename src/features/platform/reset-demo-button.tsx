'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { resetDemoStoreAction } from '@/features/platform/subscription-actions';

/**
 * Resets a demo store's sample data. Only shown for demo stores, and the
 * server refuses any other store; the administrator types the name to confirm.
 */
export function ResetDemoButton({ storeId, storeName }: { storeId: string; storeName: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (busy || typed.trim() !== storeName) return;
    setBusy(true);
    const result = await resetDemoStoreAction({ storeId, confirmName: typed.trim() });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }
    toast.success(`${storeName} reset: ${result.data.products} sample products loaded.`);
    setOpen(false);
    setTyped('');
    router.refresh();
  };

  return (
    <>
      <Button variant="outline" size="lg" className="h-11" onClick={() => setOpen(true)}>
        <RotateCcw /> Reset demo data
      </Button>
      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset {storeName}?</DialogTitle>
            <DialogDescription>
              Deletes this demo store&apos;s sales, refunds, shifts, cash and GCash entries, stock, products and categories,
              then loads the sample catalogue again. Accounts, settings and the audit log stay. Only demo stores can be
              reset; real stores never can.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="demo-reset-confirm">Type the store name to confirm</Label>
            <Input id="demo-reset-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={storeName} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submit} loading={busy} disabled={typed.trim() !== storeName}>
              Reset demo data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
