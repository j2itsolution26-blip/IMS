import Link from 'next/link';
import type { StockStatus } from '@/server/analytics/inventory-analytics';
import { formatCurrency, formatQuantity } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProductImage } from '@/components/product-image';
import { ProductRowActions } from '@/features/inventory/product-row-actions';
import { cn } from '@/lib/utils';

export interface InventoryListRow {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  unit: string;
  sellingPrice: number;
  onHand: number;
  costPrice: number;
  status: StockStatus;
}

/** The spec's three-state stock badge, in plain language a store owner reads at a glance. */
const STATUS_META: Record<StockStatus, { label: string; variant: 'success' | 'warning' | 'destructive'; dot: string }> = {
  OUT_OF_STOCK: { label: 'Out of Stock', variant: 'destructive', dot: '🔴' },
  CRITICAL: { label: 'Low Stock', variant: 'warning', dot: '🟡' },
  LOW: { label: 'Low Stock', variant: 'warning', dot: '🟡' },
  HEALTHY: { label: 'In Stock', variant: 'success', dot: '🟢' },
  OVERSTOCK: { label: 'In Stock', variant: 'success', dot: '🟢' },
};

export function InventoryProductList({
  rows,
  currency,
  canAdjustStock,
  canEditProduct,
}: {
  rows: InventoryListRow[];
  currency: string;
  canAdjustStock: boolean;
  canEditProduct: boolean;
}) {
  return (
    <>
      {/* Mobile: a simple stacked list — no dense columns to squint at. */}
      <div className="divide-y sm:hidden">
        {rows.map((row) => {
          const meta = STATUS_META[row.status];
          return (
            <div key={row.productId} className="flex items-center justify-between gap-3 p-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <ProductImage src={row.imageUrl} alt={row.name} size="md" />
                <div className="min-w-0 flex-1">
                  <Link href={`/products/${row.productId}`} className="block truncate font-medium hover:underline">
                    {row.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                    <span>{formatCurrency(row.sellingPrice, currency)}</span>
                    <span>
                      {formatQuantity(row.onHand)} {row.unit}
                    </span>
                  </div>
                  <Badge variant={meta.variant} className="mt-1.5">
                    {meta.dot} {meta.label}
                  </Badge>
                </div>
              </div>
              <ProductRowActions
                productId={row.productId}
                productName={row.name}
                sku={row.sku}
                onHand={row.onHand}
                unit={row.unit}
                costPrice={row.costPrice}
                canAdjustStock={canAdjustStock}
                canEditProduct={canEditProduct}
              />
            </div>
          );
        })}
      </div>

      {/* Desktop: a clean table with comfortable spacing. */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Stock</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const meta = STATUS_META[row.status];
              return (
                <TableRow key={row.productId}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <ProductImage src={row.imageUrl} alt={row.name} size="sm" />
                      <Link href={`/products/${row.productId}`} className="font-medium hover:underline">
                        {row.name}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="tabular text-right">{formatCurrency(row.sellingPrice, currency)}</TableCell>
                  <TableCell
                    className={cn(
                      'tabular text-right font-medium',
                      row.status === 'OUT_OF_STOCK'
                        ? 'text-destructive'
                        : row.status === 'CRITICAL' || row.status === 'LOW'
                          ? 'text-warning'
                          : '',
                    )}
                  >
                    {formatQuantity(row.onHand)}{' '}
                    <span className="text-xs font-normal text-muted-foreground">{row.unit}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={meta.variant}>
                      {meta.dot} {meta.label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <ProductRowActions
                      productId={row.productId}
                      productName={row.name}
                      sku={row.sku}
                      onHand={row.onHand}
                      unit={row.unit}
                      costPrice={row.costPrice}
                      canAdjustStock={canAdjustStock}
                      canEditProduct={canEditProduct}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
