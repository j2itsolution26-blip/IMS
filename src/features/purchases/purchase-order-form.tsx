'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PurchaseFormProduct } from '@/features/purchases/queries';
import { createPurchaseOrderAction } from '@/features/purchases/actions';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProductPicker, EmptyLines } from '@/features/inventory/product-picker';
import { formatCurrency, formatQuantity } from '@/lib/format';

/**
 * Purchase-order builder.
 *
 * Creating an order changes no stock — that happens on receiving. Costs default
 * to each product's current average cost and can be overridden per line when
 * the supplier quotes something different.
 */

interface Line {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  quantity: string;
  unitCost: string;
  taxRate: string;
  discount: string;
}

export interface ReorderSeed {
  productId: string;
  suggestedQuantity: number;
}

export function PurchaseOrderForm({
  suppliers,
  warehouses,
  products,
  currency,
  seed,
}: {
  suppliers: { id: string; name: string; leadTimeDays: number }[];
  warehouses: { id: string; name: string; isDefault: boolean }[];
  products: PurchaseFormProduct[];
  currency: string;
  /** Pre-filled lines when arriving from a reorder suggestion. */
  seed?: ReorderSeed[];
}) {
  const router = useRouter();

  const [supplierId, setSupplierId] = React.useState(suppliers[0]?.id ?? '');
  const [warehouseId, setWarehouseId] = React.useState(
    warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? '',
  );
  const [status, setStatus] = React.useState<'DRAFT' | 'ORDERED'>('ORDERED');
  const [expectedDate, setExpectedDate] = React.useState('');
  const [orderDiscount, setOrderDiscount] = React.useState('0');
  const [shipping, setShipping] = React.useState('0');
  const [notes, setNotes] = React.useState('');
  const [lines, setLines] = React.useState<Line[]>([]);
  const [submitting, setSubmitting] = React.useState(false);

  const toLine = React.useCallback(
    (product: PurchaseFormProduct, quantity = 1): Line => ({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      unit: product.unit,
      quantity: String(quantity),
      unitCost: product.costPrice.toFixed(2),
      taxRate: String(product.taxRate),
      discount: '0',
    }),
    [],
  );

  // Seed from a reorder suggestion once on mount.
  React.useEffect(() => {
    if (!seed?.length) return;
    const byId = new Map(products.map((product) => [product.id, product]));
    const seeded = seed
      .map((item) => {
        const product = byId.get(item.productId);
        return product ? toLine(product, item.suggestedQuantity) : null;
      })
      .filter((line): line is Line => line !== null);

    if (seeded.length > 0) {
      setLines(seeded);
      const supplierOfFirst = byId.get(seed[0].productId)?.supplierId;
      if (supplierOfFirst) setSupplierId(supplierOfFirst);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Default the expected date from the supplier's stated lead time. */
  React.useEffect(() => {
    const supplier = suppliers.find((s) => s.id === supplierId);
    if (supplier && supplier.leadTimeDays > 0 && !expectedDate) {
      const date = new Date(Date.now() + supplier.leadTimeDays * 86_400_000);
      setExpectedDate(date.toISOString().slice(0, 10));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  const addLine = (product: { id: string }) => {
    const full = products.find((item) => item.id === product.id);
    if (full) setLines((current) => [...current, toLine(full)]);
  };

  const updateLine = (productId: string, patch: Partial<Line>) =>
    setLines((current) =>
      current.map((line) => (line.productId === productId ? { ...line, ...patch } : line)),
    );

  const removeLine = (productId: string) =>
    setLines((current) => current.filter((line) => line.productId !== productId));

  /** Pulls in everything this supplier supplies that is at or below its reorder point. */
  const fillFromSupplier = () => {
    const candidates = products.filter(
      (product) => product.supplierId === supplierId && !lines.some((line) => line.productId === product.id),
    );

    if (candidates.length === 0) {
      toast.info('No further products are assigned to this supplier.');
      return;
    }

    setLines((current) => [
      ...current,
      ...candidates.map((product) => toLine(product, product.reorderQty > 0 ? product.reorderQty : 1)),
    ]);
  };

  const totals = React.useMemo(() => {
    let subtotal = 0;
    let tax = 0;

    for (const line of lines) {
      const quantity = Number(line.quantity) || 0;
      const cost = Number(line.unitCost) || 0;
      const discount = Number(line.discount) || 0;
      const net = Math.max(0, cost * quantity - discount);
      subtotal += net;
      tax += (net * (Number(line.taxRate) || 0)) / 100;
    }

    const discount = Number(orderDiscount) || 0;
    const ship = Number(shipping) || 0;

    return {
      subtotal: round(subtotal),
      tax: round(tax),
      total: round(Math.max(0, subtotal + tax + ship - discount)),
    };
  }, [lines, orderDiscount, shipping]);

  const validLines = lines.filter((line) => Number(line.quantity) > 0);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (validLines.length === 0) {
      toast.error('Add at least one product with a quantity.');
      return;
    }

    setSubmitting(true);
    const result = await createPurchaseOrderAction({
      supplierId,
      warehouseId,
      status,
      expectedDate: expectedDate || undefined,
      discount: Number(orderDiscount) || 0,
      shippingCost: Number(shipping) || 0,
      notes: notes.trim() || undefined,
      items: validLines.map((line) => ({
        productId: line.productId,
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost) || 0,
        taxRate: Number(line.taxRate) || 0,
        discount: Number(line.discount) || 0,
      })),
    });
    setSubmitting(false);

    if (!result.ok) {
      toast.error(result.error, { duration: 8000 });
      return;
    }

    toast.success(`Purchase order ${result.data.orderNumber} created.`);
    router.push(`/purchases/${result.data.id}`);
    router.refresh();
  };

  if (suppliers.length === 0 || warehouses.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="font-medium">Missing setup</p>
        <p className="mt-1 text-sm text-muted-foreground">
          You need at least one active supplier and one warehouse before raising a purchase order.
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Order details</CardTitle>
            <CardDescription>
              Raising an order does not change stock. Stock moves when you receive against it.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="supplier">Supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger id="supplier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="warehouse">Deliver to</Label>
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
              <Label htmlFor="expected">Expected delivery</Label>
              <Input
                id="expected"
                type="date"
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as 'DRAFT' | 'ORDERED')}>
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DRAFT">Draft — not sent yet</SelectItem>
                  <SelectItem value="ORDERED">Ordered — sent to supplier</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Delivery instructions, quote reference…"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Totals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label="Subtotal" value={formatCurrency(totals.subtotal, currency)} />
            <Row label="Tax" value={formatCurrency(totals.tax, currency)} />

            <div className="space-y-1.5">
              <Label htmlFor="shipping">Shipping</Label>
              <Input
                id="shipping"
                type="number"
                min={0}
                step="0.01"
                value={shipping}
                onChange={(event) => setShipping(event.target.value)}
                className="text-right"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="order-discount">Order discount</Label>
              <Input
                id="order-discount"
                type="number"
                min={0}
                step="0.01"
                value={orderDiscount}
                onChange={(event) => setOrderDiscount(event.target.value)}
                className="text-right"
              />
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <span className="font-semibold">Total</span>
              <span className="tabular text-xl font-bold">{formatCurrency(totals.total, currency)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">Products</CardTitle>
            <CardDescription>Costs default to the current average cost for each product.</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={fillFromSupplier}>
            <Wand2 /> Add supplier&apos;s products
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <ProductPicker
            products={products.map((product) => ({
              id: product.id,
              name: product.name,
              sku: product.sku,
              unit: product.unit,
              costPrice: product.costPrice,
              onHand: product.onHand,
              available: product.onHand,
            }))}
            exclude={new Set(lines.map((line) => line.productId))}
            onSelect={addLine}
            placeholder="Search a product to order…"
          />

          {lines.length === 0 ? (
            <EmptyLines message="Search above to add the products you're ordering." />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Unit cost</TableHead>
                    <TableHead className="hidden text-right sm:table-cell">Tax %</TableHead>
                    <TableHead className="text-right">Line total</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const quantity = Number(line.quantity) || 0;
                    const cost = Number(line.unitCost) || 0;
                    const discount = Number(line.discount) || 0;
                    const net = Math.max(0, cost * quantity - discount);
                    const lineTotal = net + (net * (Number(line.taxRate) || 0)) / 100;

                    return (
                      <TableRow key={line.productId}>
                        <TableCell>
                          <p className="font-medium">{line.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {line.sku} · {line.unit}
                          </p>
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="0.001"
                            value={line.quantity}
                            onChange={(event) => updateLine(line.productId, { quantity: event.target.value })}
                            className="ml-auto h-8 w-24 text-right"
                            aria-label={`Quantity for ${line.name}`}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.unitCost}
                            onChange={(event) => updateLine(line.productId, { unitCost: event.target.value })}
                            className="ml-auto h-8 w-28 text-right"
                            aria-label={`Unit cost for ${line.name}`}
                          />
                        </TableCell>
                        <TableCell className="hidden text-right sm:table-cell">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step="0.01"
                            value={line.taxRate}
                            onChange={(event) => updateLine(line.productId, { taxRate: event.target.value })}
                            className="ml-auto h-8 w-20 text-right"
                            aria-label={`Tax rate for ${line.name}`}
                          />
                        </TableCell>
                        <TableCell className="tabular text-right font-medium">
                          {formatCurrency(lineTotal, currency)}
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

          {validLines.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {validLines.length} line{validLines.length === 1 ? '' : 's'} ·{' '}
              {formatQuantity(validLines.reduce((acc, line) => acc + (Number(line.quantity) || 0), 0))} units
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" loading={submitting} disabled={validLines.length === 0}>
          {status === 'DRAFT' ? 'Save draft' : 'Create purchase order'}
        </Button>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular font-medium">{value}</span>
    </div>
  );
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
