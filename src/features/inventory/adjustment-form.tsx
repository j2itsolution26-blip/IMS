'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ScanLine, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { StockPickerProduct } from '@/features/inventory/queries';
import { createAdjustmentAction } from '@/features/inventory/actions';
import { ProductPicker, EmptyLines } from '@/features/inventory/product-picker';
import { resolveStockScan } from '@/features/inventory/resolve-stock-scan';
import { ScannerDialog } from '@/features/scanner/scanner-dialog';
import { primeAudio, type ScanFeedback } from '@/features/scanner/scanner-panel';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency } from '@/lib/format';
import { formatPieces } from '@/lib/quantity';
import { cn } from '@/lib/utils';

/**
 * Stock adjustment entry.
 *
 * Two modes, because they answer different questions:
 *   Counted  — "there are 47 on the shelf". The delta is derived.
 *   Change by — "write off 3 broken units". The delta is entered directly.
 *
 * The delta is previewed per line before anything is submitted, so the operator
 * can see the consequence of what they typed.
 */

interface Line {
  productId: string;
  name: string;
  sku: string;
  onHand: number;
  costPrice: number;
  value: string;
}

export function AdjustmentForm({
  products,
  currency,
  canViewCost,
}: {
  products: StockPickerProduct[];
  currency: string;
  /** Shows the cost-based value preview. Costs arrive as zero otherwise. */
  canViewCost: boolean;
}) {
  const router = useRouter();

  const [mode, setMode] = React.useState<'ABSOLUTE' | 'RELATIVE'>('ABSOLUTE');
  const [isOpeningBalance, setIsOpeningBalance] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [lines, setLinesState] = React.useState<Line[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  // Guards against a second submit (Enter pressed twice) recording the same
  // adjustment twice before `submitting` has re-rendered.
  const inFlight = React.useRef(false);
  const [scanning, setScanning] = React.useState(false);

  // Mirrors `lines` synchronously so a scan can report the new count in the
  // same breath as it records it.
  const linesRef = React.useRef<Line[]>([]);
  const setLines = (update: Line[] | ((current: Line[]) => Line[])) => {
    linesRef.current = typeof update === 'function' ? update(linesRef.current) : update;
    setLinesState(linesRef.current);
  };
  const scanCache = React.useRef(new Map<string, StockPickerProduct>());

  const lineFor = (product: StockPickerProduct, value = ''): Line => ({
    productId: product.id,
    name: product.name,
    sku: product.sku,
    onHand: product.onHand,
    costPrice: product.costPrice,
    value,
  });

  const addLine = (product: StockPickerProduct) => setLines((current) => [...current, lineFor(product)]);

  /**
   * One scan during a stock take is one piece on the shelf: it adds the
   * product to the list, or counts one more of it. A scan never changes stock
   * by itself — the counts go through "Apply adjustment" like typed ones.
   * In "Change by" mode a scan only puts the product on the list, since a
   * scan there would otherwise read as "add one to stock".
   */
  const onBarcodeDetected = async (code: string): Promise<ScanFeedback> => {
    if (submitting) return { tone: 'warning', title: 'Applying the adjustment — scan again in a moment.' };

    const result = await resolveStockScan(code, { local: products, cache: scanCache.current, verb: 'counted' });
    if (!result.ok) return result.feedback;
    const product = result.product;
    const existing = linesRef.current.find((line) => line.productId === product.id);

    if (mode === 'RELATIVE') {
      if (!existing) setLines((current) => [...current, lineFor(product)]);
      return { tone: 'success', title: product.name, meta: existing ? 'already listed' : 'added — enter the change' };
    }

    const counted = existing ? (Number(existing.value) || 0) + 1 : 1;
    setLines((current) =>
      existing
        ? current.map((line) => (line.productId === product.id ? { ...line, value: String(counted) } : line))
        : [...current, lineFor(product, '1')],
    );
    return { tone: 'success', title: product.name, meta: `counted ${formatPieces(counted)}` };
  };

  const removeLine = (productId: string) =>
    setLines((current) => current.filter((line) => line.productId !== productId));

  const setValue = (productId: string, value: string) =>
    setLines((current) => current.map((line) => (line.productId === productId ? { ...line, value } : line)));

  /** Whole pieces only: a blank, fractional or negative count is not a valid entry. */
  const isValidEntry = (line: Line): boolean => {
    if (line.value === '') return true;
    const entered = Number(line.value);
    return Number.isSafeInteger(entered) && (mode === 'RELATIVE' || entered >= 0);
  };

  const deltaFor = (line: Line): number => {
    const entered = Number(line.value);
    if (line.value === '' || !isValidEntry(line)) return 0;
    return mode === 'ABSOLUTE' ? entered - line.onHand : entered;
  };

  const effective = lines.filter((line) => deltaFor(line) !== 0);
  const valueImpact = effective.reduce((acc, line) => acc + deltaFor(line) * line.costPrice, 0);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlight.current) return;

    const invalid = lines.find((line) => !isValidEntry(line));
    if (invalid) {
      toast.error(
        mode === 'ABSOLUTE'
          ? `${invalid.name}: enter the pieces counted — a whole number, 0 or more.`
          : `${invalid.name}: enter the change in whole pieces, e.g. -3 or 12.`,
      );
      return;
    }

    if (effective.length === 0) {
      toast.error('Nothing to adjust — every line matches the current stock level.');
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    // No unit cost is sent: the server values each line at the product's
    // recorded average cost.
    const result = await createAdjustmentAction({
      mode,
      reason,
      isOpeningBalance,
      lines: effective.map((line) => ({
        productId: line.productId,
        quantity: Number(line.value),
      })),
    });
    setSubmitting(false);
    inFlight.current = false;

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success(`Adjustment ${result.data.reference} applied to ${result.data.count} product(s).`);
    setLines([]);
    setReason('');
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Adjustment details</CardTitle>
          <CardDescription>
            Every adjustment is written to the stock ledger and the audit trail with the reason you give.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mode">Entry mode</Label>
            <Select value={mode} onValueChange={(value) => setMode(value as 'ABSOLUTE' | 'RELATIVE')}>
              <SelectTrigger id="mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ABSOLUTE">Counted quantity (stock take)</SelectItem>
                <SelectItem value="RELATIVE">Change by (+/−)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="reason">Reason</Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="Stock take variance, damaged goods, expired items…"
              required
            />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-md border p-3 sm:col-span-2">
            <div>
              <Label htmlFor="opening">Opening balance</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Mark this as the initial stock load rather than a correction. Affects how the movement is
                labelled in the ledger.
              </p>
            </div>
            <Switch id="opening" checked={isOpeningBalance} onCheckedChange={setIsOpeningBalance} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Products</CardTitle>
          <CardDescription>
            {mode === 'ABSOLUTE'
              ? 'Enter the quantity you actually counted. The change is worked out for you.'
              : 'Enter how much to add (positive) or remove (negative).'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <div className="min-w-0 flex-1">
              <ProductPicker
                products={products}
                exclude={new Set(lines.map((line) => line.productId))}
                onSelect={addLine}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              aria-label={mode === 'ABSOLUTE' ? 'Scan to count' : 'Scan products'}
              onClick={() => {
                primeAudio();
                setScanning(true);
              }}
            >
              <ScanLine /> <span className="hidden sm:inline">{mode === 'ABSOLUTE' ? 'Scan to count' : 'Scan'}</span>
            </Button>
            <ScannerDialog
              open={scanning}
              onOpenChange={setScanning}
              title={mode === 'ABSOLUTE' ? 'Scan to count' : 'Scan products'}
              description={
                mode === 'ABSOLUTE'
                  ? 'Scan each piece on the shelf. Every scan counts one more of that product.'
                  : 'Scan products to add them to the adjustment list.'
              }
              mode="continuous"
              manualEntry
              countLabel={(count) => `${count} scanned`}
              // Quicker re-arm than the till: counting pieces of one product
              // is the point here.
              sameCodeCooldownMs={900}
              sameCodeReleaseMs={600}
              onBarcodeDetected={onBarcodeDetected}
            />
          </div>

          {lines.length === 0 ? (
            <EmptyLines message="Search above to add the products you're adjusting." />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">
                      {mode === 'ABSOLUTE' ? 'Counted' : 'Change by'}
                    </TableHead>
                    <TableHead className="text-right">Difference</TableHead>
                    {canViewCost && <TableHead className="hidden text-right sm:table-cell">Value</TableHead>}
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const delta = deltaFor(line);
                    return (
                      <TableRow key={line.productId}>
                        <TableCell>
                          <p className="font-medium">{line.name}</p>
                          <p className="text-xs text-muted-foreground">{line.sku}</p>
                        </TableCell>
                        <TableCell className="tabular text-right text-muted-foreground">
                          {formatPieces(line.onHand)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="1"
                            min={mode === 'ABSOLUTE' ? 0 : undefined}
                            inputMode="numeric"
                            value={line.value}
                            aria-invalid={!isValidEntry(line)}
                            onChange={(event) => setValue(line.productId, event.target.value)}
                            className="ml-auto h-8 w-28 text-right"
                            placeholder={mode === 'ABSOLUTE' ? String(line.onHand) : '0'}
                            aria-label={`${mode === 'ABSOLUTE' ? 'Counted quantity' : 'Change'} for ${line.name}`}
                          />
                        </TableCell>
                        <TableCell
                          className={cn(
                            'tabular text-right font-medium',
                            delta > 0 ? 'text-success' : delta < 0 ? 'text-destructive' : 'text-muted-foreground',
                          )}
                        >
                          {delta > 0 ? '+' : ''}
                          {formatPieces(delta)}
                        </TableCell>
                        {canViewCost && (
                          <TableCell className="tabular hidden text-right text-sm text-muted-foreground sm:table-cell">
                            {formatCurrency(delta * line.costPrice, currency)}
                          </TableCell>
                        )}
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeLine(line.productId)}
                            aria-label={`Remove ${line.name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {effective.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                {effective.length} line{effective.length === 1 ? '' : 's'} will change
              </span>
              {canViewCost && (
                <span className="tabular font-medium">
                  Stock value impact:{' '}
                  <span className={valueImpact < 0 ? 'text-destructive' : 'text-success'}>
                    {valueImpact > 0 ? '+' : ''}
                    {formatCurrency(valueImpact, currency)}
                  </span>
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          type="submit"
          loading={submitting}
          disabled={effective.length === 0 || reason.trim().length < 4}
        >
          Apply adjustment
        </Button>
      </div>
    </form>
  );
}
