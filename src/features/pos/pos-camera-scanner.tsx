'use client';

import * as React from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatCurrency, formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ScannerDialog } from '@/features/scanner/scanner-dialog';
import { primeAudio, type ScanFeedback } from '@/features/scanner/scanner-panel';
import { QuantityInput } from '@/features/pos/quantity-input';

/**
 * The till's camera scanner: stays open and rings item after item into the
 * cart, the way a counter scanner does. The scanner itself is the shared one.
 *
 * A scan identifies the product; the cashier says how many. Under the camera
 * the cart is shown with an editable quantity on every line — the product
 * just scanned on top — so "scan Fudgee Barr, type 5, scan the next one"
 * never means closing the scanner or scanning a pack five times. These are
 * the cart's own lines: what's edited here is what's on the till when the
 * scanner closes.
 */

/** What became of one scan, reported back by the till's cart logic. */
export type ScanOutcome =
  | { kind: 'added'; productId: string; name: string; quantity: string }
  | { kind: 'not-found' }
  | { kind: 'unavailable'; name: string; message: string }
  | { kind: 'stock'; productId: string; name: string; message: string }
  | { kind: 'error'; message: string };

/** A cart line as the scanner needs to show it. */
export interface ScannerCartLine {
  productId: string;
  name: string;
  /** Barcode, or SKU when there is none. */
  code: string;
  unitPrice: number;
  quantity: number;
  discount: number;
  allowDecimal: boolean;
  unitAbbreviation: string;
}

function toFeedback(outcome: ScanOutcome): ScanFeedback {
  switch (outcome.kind) {
    case 'added':
      return { tone: 'success', title: outcome.name, meta: `× ${outcome.quantity}` };
    case 'not-found':
      return { tone: 'error', title: 'Product not found — type the code below or search the till' };
    case 'unavailable':
    case 'stock':
      return { tone: 'warning', title: outcome.message };
    case 'error':
      return { tone: 'error', title: outcome.message };
  }
}

export function PosCameraScanner({
  onScan,
  lines,
  total,
  itemCount,
  currency,
  onSetQuantity,
  onRemove,
  label = 'Scan barcode',
  size,
  className,
}: {
  /** Rings one decoded code into the cart and says what happened. */
  onScan: (code: string) => Promise<ScanOutcome>;
  lines: ScannerCartLine[];
  /** The till's grand total, discounts and tax included. */
  total: number;
  itemCount: number;
  currency: string;
  onSetQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  label?: string;
  size?: React.ComponentProps<typeof Button>['size'];
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [lastId, setLastId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size={size}
        className={className}
        onClick={() => {
          primeAudio();
          setLastId(null);
          setEditing(false);
          setOpen(true);
        }}
      >
        <Camera /> {label}
      </Button>

      <ScannerDialog
        open={open}
        onOpenChange={setOpen}
        title="Camera scanner"
        description="Scan a product, set how many the customer is buying, then scan the next one."
        mode="continuous"
        manualEntry
        countLabel={(count) => `${count} scanned`}
        previewClassName="aspect-[16/10]"
        holdDecoding={editing}
        holdLabel="Finish the quantity to scan"
        onBarcodeDetected={async (code) => {
          const outcome = await onScan(code);
          if (outcome.kind === 'added' || outcome.kind === 'stock') setLastId(outcome.productId);
          return toFeedback(outcome);
        }}
      >
        <ScannerCart
          lines={lines}
          lastId={lastId}
          total={total}
          itemCount={itemCount}
          currency={currency}
          onSetQuantity={onSetQuantity}
          onRemove={onRemove}
          onEditing={setEditing}
        />
      </ScannerDialog>
    </>
  );
}

function ScannerCart({
  lines,
  lastId,
  total,
  itemCount,
  currency,
  onSetQuantity,
  onRemove,
  onEditing,
}: {
  lines: ScannerCartLine[];
  lastId: string | null;
  total: number;
  itemCount: number;
  currency: string;
  onSetQuantity: (productId: string, quantity: number) => void;
  onRemove: (productId: string) => void;
  onEditing: (editing: boolean) => void;
}) {
  if (lines.length === 0) return null;

  // The product just scanned leads, so its quantity is right under the camera.
  const ordered = [...lines].sort((a, b) => Number(b.productId === lastId) - Number(a.productId === lastId));

  return (
    <div className="space-y-2">
      <ul className="max-h-[17rem] space-y-2 overflow-y-auto scrollbar-thin" aria-label="Cart">
        {ordered.map((line) => {
          const isLast = line.productId === lastId;
          const subtotal = line.unitPrice * line.quantity - line.discount;
          return (
            <li
              key={line.productId}
              className={cn('rounded-lg border p-2.5', isLast && 'border-primary/50 bg-primary/5')}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  {isLast && (
                    <p className="text-[11px] font-medium uppercase tracking-wide text-primary">Just scanned</p>
                  )}
                  <p className="truncate text-sm font-medium">{line.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">{line.code}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onRemove(line.productId)}
                  aria-label={`Remove ${line.name}`}
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <QuantityInput
                  value={line.quantity}
                  allowDecimal={line.allowDecimal}
                  onChange={(quantity) => onSetQuantity(line.productId, quantity)}
                  onFocusChange={onEditing}
                  label={`Quantity for ${line.name}`}
                  size={isLast ? 'lg' : 'default'}
                />
                <div className="min-w-0 text-right">
                  <p className="tabular text-xs text-muted-foreground">
                    {formatCurrency(line.unitPrice, currency)} / {line.unitAbbreviation}
                  </p>
                  <p className="tabular text-base font-semibold">{formatCurrency(subtotal, currency)}</p>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex items-baseline justify-between rounded-lg bg-muted px-3 py-2">
        <span className="text-sm text-muted-foreground">
          {lines.length} product{lines.length === 1 ? '' : 's'} · {formatQuantity(itemCount)} item
          {itemCount === 1 ? '' : 's'}
        </span>
        <span className="tabular text-lg font-bold">{formatCurrency(total, currency)}</span>
      </div>
    </div>
  );
}
