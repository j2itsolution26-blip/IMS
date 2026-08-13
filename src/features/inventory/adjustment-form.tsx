'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { StockPickerProduct } from '@/features/inventory/queries';
import { createAdjustmentAction } from '@/features/inventory/actions';
import { ProductPicker, EmptyLines } from '@/features/inventory/product-picker';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatCurrency, formatQuantity } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Stock adjustment entry.
 *
 * Two modes, because they answer different questions:
 *   Counted  — "there are 47 on the shelf". The delta is derived.
 *   Change by — "write off 3 broken units". The delta is entered directly.
 *
 * The delta is previewed per line before anything is submitted, so the operator
 * can see the consequence of what they typed. On-hand is read for the selected
 * warehouse — the same one the server measures the counted difference against,
 * so the previewed difference is the one that gets applied.
 */

interface Line {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  onHand: number;
  costPrice: number;
  value: string;
}

export function AdjustmentForm({
  warehouses,
  productsByWarehouse,
  currency,
}: {
  warehouses: { id: string; name: string; isDefault: boolean }[];
  /** On-hand per warehouse, keyed by warehouse id. */
  productsByWarehouse: Record<string, StockPickerProduct[]>;
  currency: string;
}) {
  const router = useRouter();

  const [warehouseId, setWarehouseId] = React.useState(
    warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? '',
  );
  const [mode, setMode] = React.useState<'ABSOLUTE' | 'RELATIVE'>('ABSOLUTE');
  const [isOpeningBalance, setIsOpeningBalance] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [lines, setLines] = React.useState<Line[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  const products = productsByWarehouse[warehouseId] ?? [];
  const selectedWarehouse = warehouses.find((w) => w.id === warehouseId);

  // Switching warehouse invalidates every on-hand figure already on screen.
  React.useEffect(() => {
    setLines([]);
  }, [warehouseId]);

  const addLine = (product: StockPickerProduct) =>
    setLines((current) => [
      ...current,
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        onHand: product.onHand,
        costPrice: product.costPrice,
        value: '',
      },
    ]);

  const removeLine = (productId: string) =>
    setLines((current) => current.filter((line) => line.productId !== productId));

  const setValue = (productId: string, value: string) =>
    setLines((current) => current.map((line) => (line.productId === productId ? { ...line, value } : line)));

  const deltaFor = (line: Line): number => {
    const entered = Number(line.value);
    if (!Number.isFinite(entered) || line.value === '') return 0;
    return mode === 'ABSOLUTE' ? entered - line.onHand : entered;
  };

  const effective = lines.filter((line) => deltaFor(line) !== 0);
  const valueImpact = effective.reduce((acc, line) => acc + deltaFor(line) * line.costPrice, 0);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (effective.length === 0) {
      toast.error('Nothing to adjust — every line matches the current stock level.');
      return;
    }

    setSubmitting(true);
    const result = await createAdjustmentAction({
      warehouseId,
      mode,
      reason,
      isOpeningBalance,
      lines: effective.map((line) => ({
        productId: line.productId,
        quantity: Number(line.value),
        unitCost: line.costPrice,
      })),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success(`Adjustment ${result.data.reference} applied to ${result.data.count} product(s).`);
    setLines([]);
    setReason('');
    router.refresh();
  };

  if (warehouses.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="font-medium">No warehouse configured</p>
        <p className="mt-1 text-sm text-muted-foreground">Create a warehouse before adjusting stock.</p>
      </Card>
    );
  }

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
            <Label htmlFor="warehouse">Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger id="warehouse">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((warehouse) => (
                  <SelectItem key={warehouse.id} value={warehouse.id}>
                    {warehouse.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
              : 'Enter how much to add (positive) or remove (negative).'}{' '}
            {selectedWarehouse
              ? `On hand is what ${selectedWarehouse.name} currently holds.`
              : 'On hand is what the selected warehouse currently holds.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProductPicker
            products={products}
            exclude={new Set(lines.map((line) => line.productId))}
            onSelect={addLine}
          />

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
                    <TableHead className="hidden text-right sm:table-cell">Value</TableHead>
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
                          {formatQuantity(line.onHand)} {line.unit}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            step="0.001"
                            value={line.value}
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
                          {formatQuantity(delta)}
                        </TableCell>
                        <TableCell className="tabular hidden text-right text-sm text-muted-foreground sm:table-cell">
                          {formatCurrency(delta * line.costPrice, currency)}
                        </TableCell>
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
              <span className="tabular font-medium">
                Stock value impact:{' '}
                <span className={valueImpact < 0 ? 'text-destructive' : 'text-success'}>
                  {valueImpact > 0 ? '+' : ''}
                  {formatCurrency(valueImpact, currency)}
                </span>
              </span>
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
