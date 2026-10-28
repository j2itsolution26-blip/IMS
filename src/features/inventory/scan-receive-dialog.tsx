'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Minus, PackagePlus, Plus, ScanLine, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { stockInAction } from '@/features/inventory/actions';
import type { StockPickerProduct } from '@/features/inventory/queries';
import { resolveStockScan } from '@/features/inventory/resolve-stock-scan';
import { ScannerPanel, primeAudio, type ScanFeedback } from '@/features/scanner/scanner-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatPieces, quantityProblem, type ProductUnit } from '@/lib/quantity';
import { cn } from '@/lib/utils';

/**
 * Receiving a delivery by scanning it.
 *
 * Each scan puts the product on a receiving list, or counts one more of it —
 * scanning the same pack again is how a delivery of twelve is tallied, and
 * the quantity can be typed over at any time. Nothing touches stock until
 * Save, which records each line through the same stock-in action as the
 * row's "Add stock" dialog, so the ledger, audit trail and permissions are
 * exactly the ones that already exist. A line is only shown as received once
 * the server has confirmed it.
 */

interface Line {
  productId: string;
  name: string;
  sku: string;
  onHand: number;
  quantity: string;
  saving: boolean;
  error?: string;
  unit: ProductUnit;
  allowsDecimal: boolean;
}

interface Received {
  productId: string;
  name: string;
  quantity: number;
  reference: string;
  unit: ProductUnit;
}

export function ScanReceiveDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [lines, setLinesState] = React.useState<Line[]>([]);
  const [received, setReceived] = React.useState<Received[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);

  // Mirrors `lines` synchronously so a scan can report the new tally in the
  // same breath as it records it.
  const linesRef = React.useRef<Line[]>([]);
  const setLines = (update: (current: Line[]) => Line[]) => {
    linesRef.current = update(linesRef.current);
    setLinesState(linesRef.current);
  };

  const savingRef = React.useRef(false);
  const cacheRef = React.useRef(new Map<string, StockPickerProduct>());

  const reset = () => {
    linesRef.current = [];
    setLinesState([]);
    setReceived([]);
    setConfirmDiscard(false);
    cacheRef.current = new Map();
  };

  const requestOpenChange = (next: boolean) => {
    if (next) {
      primeAudio();
      reset();
      setOpen(true);
      return;
    }
    if (savingRef.current) return;
    if (linesRef.current.length > 0) {
      setConfirmDiscard(true);
      return;
    }
    setOpen(false);
  };

  const onBarcodeDetected = async (code: string): Promise<ScanFeedback> => {
    // A line being saved must not change under the request carrying it.
    if (savingRef.current) return { tone: 'warning', title: 'Saving — scan again in a moment.' };

    const result = await resolveStockScan(code, { cache: cacheRef.current, verb: 'received' });
    if (!result.ok) return result.feedback;
    const product = result.product;

    let quantity = 1;
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (!existing) {
        return [
          {
            productId: product.id,
            name: product.name,
            sku: product.sku,
            onHand: product.onHand,
            quantity: '1',
            saving: false,
            unit: product.unit,
            allowsDecimal: product.allowsDecimal,
          },
          ...current,
        ];
      }
      quantity = (Number(existing.quantity) || 0) + 1;
      return current.map((line) =>
        line.productId === product.id ? { ...line, quantity: String(quantity), error: undefined } : line,
      );
    });
    setConfirmDiscard(false);

    return { tone: 'success', title: product.name, meta: `receiving ${formatPieces(quantity)}` };
  };

  const setQuantity = (productId: string, quantity: string) =>
    setLines((current) =>
      current.map((line) => (line.productId === productId ? { ...line, quantity, error: undefined } : line)),
    );

  const step = (productId: string, by: number) =>
    setLines((current) =>
      current.map((line) =>
        line.productId === productId
          ? { ...line, quantity: String(Math.max(0, Math.round(((Number(line.quantity) || 0) + by) * 1000) / 1000)), error: undefined }
          : line,
      ),
    );

  const remove = (productId: string) => setLines((current) => current.filter((line) => line.productId !== productId));

  const onSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);

    let savedCount = 0;
    let failedCount = 0;

    // One stock-in per product, in order. Each confirmed line leaves the list
    // at once, so a retry after a partial failure can never post it twice.
    for (const line of [...linesRef.current]) {
      const quantity = Number(line.quantity);
      const problem = quantityProblem(line.quantity, { allowsDecimal: line.allowsDecimal, unit: line.unit });
      if (problem) {
        failedCount += 1;
        setLines((current) =>
          current.map((l) => (l.productId === line.productId ? { ...l, error: problem } : l)),
        );
        continue;
      }

      setLines((current) =>
        current.map((l) => (l.productId === line.productId ? { ...l, saving: true, error: undefined } : l)),
      );
      const result = await stockInAction({ productId: line.productId, quantity });

      if (result.ok) {
        savedCount += 1;
        setLines((current) => current.filter((l) => l.productId !== line.productId));
        setReceived((current) => [
          { productId: line.productId, name: line.name, quantity, reference: result.data.reference, unit: line.unit },
          ...current,
        ]);
        // The cached on-hand figure is now out of date.
        cacheRef.current = new Map();
      } else {
        failedCount += 1;
        setLines((current) =>
          current.map((l) => (l.productId === line.productId ? { ...l, saving: false, error: result.error } : l)),
        );
      }
    }

    savingRef.current = false;
    setSaving(false);

    if (savedCount > 0) {
      toast.success(`Stock received for ${savedCount} product${savedCount === 1 ? '' : 's'}.`);
      router.refresh();
    }
    if (failedCount > 0) {
      toast.error(`${failedCount} line${failedCount === 1 ? ' was' : 's were'} not saved — see the list.`);
    }
  };

  const pendingPieces = lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);

  return (
    <>
      <Button type="button" variant="outline" size="lg" onClick={() => requestOpenChange(true)}>
        <ScanLine /> Receive stock
      </Button>

      <Dialog open={open} onOpenChange={requestOpenChange}>
        <DialogContent className="max-w-4xl gap-4 p-4 sm:p-6">
          <DialogHeader className="pr-6">
            <DialogTitle>Receive stock</DialogTitle>
            <DialogDescription>
              Scan each item in the delivery. Scanning the same product again adds one more. Stock is updated when you
              save.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <ScannerPanel
              mode="continuous"
              manualEntry
              countLabel={(count) => `${count} scanned`}
              // Quicker re-arm than the till: counting pieces of one product
              // is the point here.
              sameCodeCooldownMs={900}
              sameCodeReleaseMs={600}
              onBarcodeDetected={onBarcodeDetected}
            />

            <div className="flex min-h-0 flex-col gap-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">To receive</h3>
                {lines.length > 0 && (
                  <span className="tabular text-xs text-muted-foreground">
                    {lines.length} product{lines.length === 1 ? '' : 's'}
                    {lines.every((line) => line.unit === 'PIECE') ? ` · ${formatPieces(pendingPieces)}` : ''}
                  </span>
                )}
              </div>

              {lines.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-10 text-center">
                  <PackagePlus className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm text-muted-foreground">Scanned products appear here.</p>
                </div>
              ) : (
                <ul className="max-h-80 divide-y overflow-y-auto scrollbar-thin rounded-lg border md:max-h-[26rem]">
                  {lines.map((line) => (
                    <li key={line.productId} className={cn('space-y-1.5 p-3', line.error && 'bg-destructive/5')}>
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{line.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {line.sku} · on hand {formatPieces(line.onHand, line.unit)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          disabled={saving}
                          onClick={() => remove(line.productId)}
                          aria-label={`Remove ${line.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9"
                          disabled={saving}
                          onClick={() => step(line.productId, -1)}
                          aria-label={`One fewer ${line.name}`}
                        >
                          <Minus />
                        </Button>
                        <Input
                          type="number"
                          inputMode={line.allowsDecimal ? 'decimal' : 'numeric'}
                          min={line.allowsDecimal ? '0' : '1'}
                          step={line.allowsDecimal ? 'any' : '1'}
                          value={line.quantity}
                          disabled={saving}
                          onChange={(event) => setQuantity(line.productId, event.target.value)}
                          className="h-9 w-24 text-center tabular"
                          aria-label={`Quantity of ${line.name} received`}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9"
                          disabled={saving}
                          onClick={() => step(line.productId, 1)}
                          aria-label={`One more ${line.name}`}
                        >
                          <Plus />
                        </Button>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {line.saving ? 'Saving…' : 'pcs'}
                        </span>
                      </div>
                      {line.error && <p className="text-xs text-destructive-text">{line.error}</p>}
                    </li>
                  ))}
                </ul>
              )}

              {received.length > 0 && (
                <div className="space-y-1 rounded-lg border border-success/30 bg-success/5 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-success-text">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Received
                  </p>
                  <ul className="space-y-0.5">
                    {received.map((item) => (
                      <li key={item.reference} className="flex justify-between gap-2 text-xs">
                        <span className="truncate">{item.name}</span>
                        <span className="tabular shrink-0 text-muted-foreground">
                          +{formatPieces(item.quantity, item.unit)} · {item.reference}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {confirmDiscard ? (
            <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 sm:flex-row sm:items-center">
              <p className="flex-1 text-sm">
                {lines.length} product{lines.length === 1 ? ' hasn’t' : 's haven’t'} been saved. Close without
                receiving {lines.length === 1 ? 'it' : 'them'}?
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setConfirmDiscard(false)}>
                  Keep scanning
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    reset();
                    setOpen(false);
                  }}
                >
                  Discard
                </Button>
              </div>
            </div>
          ) : (
            <DialogFooter>
              <Button type="button" variant="outline" disabled={saving} onClick={() => requestOpenChange(false)}>
                {lines.length === 0 && received.length > 0 ? 'Done' : 'Close'}
              </Button>
              <Button type="button" loading={saving} disabled={lines.length === 0} onClick={onSave}>
                Save {lines.length > 0 ? `${lines.length} product${lines.length === 1 ? '' : 's'}` : ''}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
