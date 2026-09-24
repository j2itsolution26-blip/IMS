import Link from 'next/link';
import type { StockStatus } from '@/server/analytics/inventory-analytics';
import { formatCurrency, formatNumber, formatQuantity, formatRelative } from '@/lib/format';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ProductImage } from '@/components/product-image';
import { ProductRowActions } from '@/features/inventory/product-row-actions';
import { cn } from '@/lib/utils';

export interface InventoryListRow {
  productId: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  categoryName: string;
  unit: string;
  sellingPrice: number;
  costPrice: number;
  onHand: number;
  reorderLevel: number;
  status: StockStatus;
  updatedAt: Date;
}

/**
 * Three stock states, in plain language. Five internal statuses collapse to
 * three — anything healthy or overstocked is simply "In stock".
 */
const STATUS_META: Record<StockStatus, { label: string; dot: string; pill: string; bar: string }> = {
  OUT_OF_STOCK: {
    label: 'Out of stock',
    dot: 'bg-destructive',
    pill: 'bg-destructive/10 text-destructive',
    bar: 'bg-destructive',
  },
  CRITICAL: { label: 'Low stock', dot: 'bg-warning', pill: 'bg-warning/15 text-warning', bar: 'bg-warning' },
  LOW: { label: 'Low stock', dot: 'bg-warning', pill: 'bg-warning/15 text-warning', bar: 'bg-warning' },
  HEALTHY: { label: 'In stock', dot: 'bg-success', pill: 'bg-success/10 text-success', bar: 'bg-success' },
  OVERSTOCK: { label: 'In stock', dot: 'bg-success', pill: 'bg-success/10 text-success', bar: 'bg-success' },
};

const HEAD = 'h-11 whitespace-nowrap px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const CELL = 'px-4 py-3';

/** A stable tint per product, so a photo-less row still reads as itself. */
const PLACEHOLDER_TINTS = [
  'bg-primary/10 text-primary',
  'bg-success/10 text-success',
  'bg-warning/15 text-warning',
  'bg-destructive/10 text-destructive',
];

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function tintFor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PLACEHOLDER_TINTS[hash % PLACEHOLDER_TINTS.length];
}

/** Product photo, or its initials when there is no photo yet. */
function Thumbnail({ row }: { row: InventoryListRow }) {
  if (row.imageUrl) {
    return <ProductImage src={row.imageUrl} alt={row.name} size="sm" className="h-[42px] w-[42px] rounded-lg" />;
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg text-xs font-semibold',
        tintFor(row.sku || row.productId),
      )}
    >
      {initialsOf(row.name)}
    </span>
  );
}

/**
 * How full the shelf is, measured against twice the reorder level — the point
 * at which there is comfortably more than enough. Without a reorder level
 * there is no target to measure against, so a stocked product reads as full
 * rather than as an invented ratio.
 */
function StockBar({ row }: { row: InventoryListRow }) {
  const target = row.reorderLevel > 0 ? row.reorderLevel * 2 : row.onHand;
  const percent = target > 0 ? Math.min(100, Math.round((row.onHand / target) * 100)) : 0;

  return (
    <div className="mt-1.5 h-1.5 w-full max-w-[200px] overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full', STATUS_META[row.status].bar)} style={{ width: `${percent}%` }} />
    </div>
  );
}

function StatusPill({ status }: { status: StockStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium',
        meta.pill,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} aria-hidden="true" />
      {meta.label}
    </span>
  );
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
      {/* Mobile: a stacked list — seven columns on a phone is a squint. */}
      <div className="divide-y sm:hidden">
        {rows.map((row) => (
          <div key={row.productId} className="flex items-start gap-3 p-4">
            <Thumbnail row={row} />
            <div className="min-w-0 flex-1">
              <Link
                href={`/products/${row.productId}`}
                className="block truncate text-sm font-semibold hover:underline"
              >
                {row.name}
              </Link>
              <p className="truncate text-xs text-muted-foreground">{row.categoryName}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="tabular font-semibold">{formatCurrency(row.sellingPrice, currency)}</span>
                <span className="tabular text-muted-foreground">
                  {formatQuantity(row.onHand)} {row.unit}
                </span>
                <StatusPill status={row.status} />
              </div>
              <StockBar row={row} />
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
        ))}
      </div>

      {/* Desktop: the full register, scrolling sideways rather than dropping
          columns, so nothing an owner needs disappears on a laptop. */}
      <div className="hidden sm:block">
        <Table className="min-w-[1060px]">
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD}>Product</TableHead>
              <TableHead className={HEAD}>Category</TableHead>
              <TableHead className={HEAD}>Price</TableHead>
              <TableHead className={HEAD}>Stock</TableHead>
              <TableHead className={HEAD}>Status</TableHead>
              <TableHead className={HEAD}>Updated</TableHead>
              <TableHead className={cn(HEAD, 'text-right')}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const margin =
                row.sellingPrice > 0
                  ? Math.round(((row.sellingPrice - row.costPrice) / row.sellingPrice) * 100)
                  : 0;

              return (
                <TableRow key={row.productId}>
                  <TableCell className={CELL}>
                    <div className="flex items-center gap-3">
                      <Thumbnail row={row} />
                      <div className="min-w-0">
                        <Link
                          href={`/products/${row.productId}`}
                          className="block max-w-[15rem] truncate text-sm font-semibold hover:underline"
                        >
                          {row.name}
                        </Link>
                        <p className="max-w-[15rem] truncate text-xs text-muted-foreground">{row.sku}</p>
                      </div>
                    </div>
                  </TableCell>

                  <TableCell className={CELL}>
                    <span className="inline-flex whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                      {row.categoryName}
                    </span>
                  </TableCell>

                  <TableCell className={CELL}>
                    <p className="tabular whitespace-nowrap text-sm font-semibold">
                      {formatCurrency(row.sellingPrice, currency)}
                    </p>
                    <p className="tabular whitespace-nowrap text-xs text-muted-foreground">
                      Cost {formatCurrency(row.costPrice, currency)} · {formatNumber(margin, 0)}%
                    </p>
                  </TableCell>

                  <TableCell className={cn(CELL, 'w-[240px]')}>
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className={cn(
                          'tabular text-sm font-semibold',
                          row.status === 'OUT_OF_STOCK'
                            ? 'text-destructive'
                            : row.status === 'LOW' || row.status === 'CRITICAL'
                              ? 'text-warning'
                              : '',
                        )}
                      >
                        {formatQuantity(row.onHand)}
                      </span>
                      <span className="text-xs text-muted-foreground">{row.unit}</span>
                      {row.reorderLevel > 0 && (
                        <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
                          Reorder at {formatQuantity(row.reorderLevel)}
                        </span>
                      )}
                    </div>
                    <StockBar row={row} />
                  </TableCell>

                  <TableCell className={CELL}>
                    <StatusPill status={row.status} />
                  </TableCell>

                  <TableCell className={cn(CELL, 'whitespace-nowrap text-sm text-muted-foreground')}>
                    {formatRelative(row.updatedAt)}
                  </TableCell>

                  <TableCell className={cn(CELL, 'text-right')}>
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
