import Link from 'next/link';
import type { StockStatus } from '@/server/analytics/inventory-analytics';
import { formatCurrency, formatQuantity } from '@/lib/format';
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

/**
 * The spec's three stock states, in plain language a store owner reads at a
 * glance. Five internal statuses collapse to three — anything healthy or
 * overstocked is simply "In Stock".
 */
const STATUS_META: Record<StockStatus, { label: string; pill: string; dot: string; stock: string }> = {
  OUT_OF_STOCK: {
    label: 'Out of Stock',
    pill: 'bg-destructive/10 text-destructive ring-destructive/20',
    dot: 'bg-destructive',
    stock: 'text-destructive',
  },
  CRITICAL: {
    label: 'Low Stock',
    pill: 'bg-warning/15 text-warning ring-warning/25',
    dot: 'bg-warning',
    stock: 'text-warning',
  },
  LOW: {
    label: 'Low Stock',
    pill: 'bg-warning/15 text-warning ring-warning/25',
    dot: 'bg-warning',
    stock: 'text-warning',
  },
  HEALTHY: {
    label: 'In Stock',
    pill: 'bg-success/10 text-success ring-success/20',
    dot: 'bg-success',
    stock: 'text-foreground',
  },
  OVERSTOCK: {
    label: 'In Stock',
    pill: 'bg-success/10 text-success ring-success/20',
    dot: 'bg-success',
    stock: 'text-foreground',
  },
};

/** Compact status pill: a colour-coded dot plus the label, legible at a glance. */
function StockPill({ status }: { status: StockStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
        meta.pill,
      )}
    >
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dot)} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function Thumbnail({ src, alt }: { src: string | null; alt: string }) {
  return <ProductImage src={src} alt={alt} size="sm" fit="cover" className="h-10 w-10 shrink-0 rounded-lg" />;
}

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
      {/* Mobile: a stacked list — no dense columns to squint at. */}
      <ul className="divide-y sm:hidden">
        {rows.map((row) => (
          <li key={row.productId} className="flex items-center gap-3 px-4 py-3">
            <Thumbnail src={row.imageUrl} alt={row.name} />

            <div className="min-w-0 flex-1">
              <Link
                href={`/products/${row.productId}`}
                className="block truncate text-sm font-semibold hover:underline"
              >
                {row.name}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span className="tabular font-medium text-foreground">
                  {formatCurrency(row.sellingPrice, currency)}
                </span>
                <span aria-hidden="true">·</span>
                <span className={cn('tabular', STATUS_META[row.status].stock)}>
                  {formatQuantity(row.onHand)} {row.unit}
                </span>
              </div>
              <div className="mt-1.5">
                <StockPill status={row.status} />
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
          </li>
        ))}
      </ul>

      {/* Desktop: a clean table with comfortable rows. */}
      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead scope="col">Product</TableHead>
              <TableHead scope="col" className="text-right">
                Price
              </TableHead>
              <TableHead scope="col" className="text-right">
                Stock
              </TableHead>
              <TableHead scope="col">Status</TableHead>
              <TableHead scope="col" className="w-16 text-right">
                Action
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const meta = STATUS_META[row.status];
              return (
                <TableRow key={row.productId}>
                  <TableCell className="py-3">
                    <div className="flex items-center gap-3">
                      <Thumbnail src={row.imageUrl} alt={row.name} />
                      <Link
                        href={`/products/${row.productId}`}
                        className="min-w-0 truncate text-sm font-semibold hover:underline"
                      >
                        {row.name}
                      </Link>
                    </div>
                  </TableCell>

                  <TableCell className="tabular whitespace-nowrap py-3 text-right text-sm">
                    {formatCurrency(row.sellingPrice, currency)}
                  </TableCell>

                  <TableCell
                    className={cn(
                      'tabular whitespace-nowrap py-3 text-right text-sm font-medium',
                      meta.stock,
                    )}
                  >
                    {formatQuantity(row.onHand)}{' '}
                    <span className="text-xs font-normal text-muted-foreground">{row.unit}</span>
                  </TableCell>

                  <TableCell className="py-3">
                    <StockPill status={row.status} />
                  </TableCell>

                  <TableCell className="py-3 text-right">
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
