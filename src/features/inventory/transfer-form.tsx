'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { StockPickerProduct } from '@/features/inventory/queries';
import { createTransferAction } from '@/features/inventory/actions';
import { ProductPicker, EmptyLines } from '@/features/inventory/product-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatQuantity } from '@/lib/format';

/**
 * Inter-warehouse transfer.
 *
 * Availability shown per line is for the *source* warehouse, refetched whenever
 * the source changes — transferring from a location that cannot cover the
 * quantity is rejected server-side, and this stops the operator getting there.
 */

interface Line {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  available: number;
  quantity: string;
}

export function TransferForm({
  warehouses,
  productsByWarehouse,
}: {
  warehouses: { id: string; name: string; isDefault: boolean }[];
  /** Availability per warehouse, keyed by warehouse id. */
  productsByWarehouse: Record<string, StockPickerProduct[]>;
}) {
  const router = useRouter();

  const [fromWarehouseId, setFrom] = React.useState(
    warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? '',
  );
  const [toWarehouseId, setTo] = React.useState(
    warehouses.find((w) => w.id !== (warehouses.find((x) => x.isDefault)?.id ?? warehouses[0]?.id))?.id ?? '',
  );
  const [note, setNote] = React.useState('');
  const [lines, setLines] = React.useState<Line[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  const sourceProducts = productsByWarehouse[fromWarehouseId] ?? [];

  // Switching source invalidates the availability figures already on screen.
  React.useEffect(() => {
    setLines([]);
  }, [fromWarehouseId]);

  const addLine = (product: StockPickerProduct) =>
    setLines((current) => [
      ...current,
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        available: product.available,
        quantity: '',
      },
    ]);

  const removeLine = (productId: string) =>
    setLines((current) => current.filter((line) => line.productId !== productId));

  const setQuantity = (productId: string, quantity: string) =>
    setLines((current) =>
      current.map((line) => (line.productId === productId ? { ...line, quantity } : line)),
    );

  const valid = lines.filter((line) => Number(line.quantity) > 0);
  const overCommitted = lines.filter((line) => Number(line.quantity) > line.available);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (valid.length === 0) {
      toast.error('Enter a quantity for at least one product.');
      return;
    }
    if (overCommitted.length > 0) {
      toast.error('One or more lines exceed what is available at the source warehouse.');
      return;
    }

    setSubmitting(true);
    const result = await createTransferAction({
      fromWarehouseId,
      toWarehouseId,
      note: note.trim() || undefined,
      lines: valid.map((line) => ({ productId: line.productId, quantity: Number(line.quantity) })),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success(`Transfer ${result.data.reference} completed.`);
    setLines([]);
    setNote('');
    router.refresh();
  };

  if (warehouses.length < 2) {
    return (
      <Card className="p-8 text-center">
        <p className="font-medium">You need at least two warehouses</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Transfers move stock between locations. Create a second warehouse to use this screen.
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Route</CardTitle>
          <CardDescription>
            Both sides of the transfer are written in one transaction — stock can never leave one warehouse
            without arriving at the other.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="from">From</Label>
              <Select value={fromWarehouseId} onValueChange={setFrom}>
                <SelectTrigger id="from">
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

            <ArrowRight className="mx-auto mb-2 hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden="true" />

            <div className="space-y-1.5">
              <Label htmlFor="to">To</Label>
              <Select value={toWarehouseId} onValueChange={setTo}>
                <SelectTrigger id="to" aria-invalid={fromWarehouseId === toWarehouseId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {warehouses
                    .filter((warehouse) => warehouse.id !== fromWarehouseId)
                    .map((warehouse) => (
                      <SelectItem key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note">Note</Label>
            <Input
              id="note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional — e.g. restocking the branch"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Products</CardTitle>
          <CardDescription>Availability shown is what the source warehouse currently holds.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProductPicker
            products={sourceProducts.filter((product) => product.available > 0)}
            exclude={new Set(lines.map((line) => line.productId))}
            onSelect={addLine}
            placeholder="Search a product to transfer…"
          />

          {lines.length === 0 ? (
            <EmptyLines message="Search above to add the products you're moving." />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Transfer</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const requested = Number(line.quantity) || 0;
                    const tooMany = requested > line.available;

                    return (
                      <TableRow key={line.productId}>
                        <TableCell>
                          <p className="font-medium">{line.name}</p>
                          <p className="text-xs text-muted-foreground">{line.sku}</p>
                        </TableCell>
                        <TableCell className="tabular text-right text-muted-foreground">
                          {formatQuantity(line.available)} {line.unit}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            max={line.available}
                            step="0.001"
                            value={line.quantity}
                            onChange={(event) => setQuantity(line.productId, event.target.value)}
                            className="ml-auto h-8 w-28 text-right"
                            aria-invalid={tooMany}
                            aria-label={`Quantity to transfer for ${line.name}`}
                          />
                          {tooMany && (
                            <p className="mt-1 text-xs text-destructive">
                              Only {formatQuantity(line.available)} available
                            </p>
                          )}
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
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          type="submit"
          loading={submitting}
          disabled={valid.length === 0 || overCommitted.length > 0 || fromWarehouseId === toWarehouseId}
        >
          Complete transfer
        </Button>
      </div>
    </form>
  );
}
