import Link from 'next/link';
import type { StockStatus } from '@/server/analytics/inventory-analytics';
import { formatCurrency, formatDateTime, formatNumber, formatQuantity, formatRelative } from '@/lib/format';
import { formatPieces, type ProductUnit } from '@/lib/quantity';
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
  sellingPrice: number;
  /** Zero unless the viewer may see cost; the page strips it on the server. */
  costPrice: number;
  onHand: number;
  reorderLevel: number;
  status: StockStatus;
  /** The latest stock-ledger entry of any kind; null when stock never moved. */
  lastMovementAt: Date | null;
  unit: ProductUnit;
  allowsDecimal: boolean;
}

/**
 * Three stock states, in plain language. Five internal statuses collapse to
 * three — anything healthy or overstocked is simply "In stock".
 */
const STATUS_META: Record<StockStatus, { label: string; dot: string; pill: string; bar: string }> = {
  OUT_OF_STOCK: {
    label: 'Out of stock',
    dot: 'bg-destructive',
    pill: 'bg-destructive/10 text-destructive-text',
    bar: 'bg-destructive',
  },
  CRITICAL: { label: 'Low stock', dot: 'bg-warning', pill: 'bg-warning/15 text-warning-text', bar: 'bg-warning' },
  LOW: { label: 'Low stock', dot: 'bg-warning', pill: 'bg-warning/15 text-warning-text', bar: 'bg-warning' },
  HEALTHY: { label: 'In stock', dot: 'bg-success', pill: 'bg-success/10 text-success-text', bar: 'bg-success' },
  OVERSTOCK: { label: 'In stock', dot: 'bg-success', pill: 'bg-success/10 text-success-text', bar: 'bg-success' },
};

const HEAD = 'h-11 whitespace-nowrap px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const CELL = 'px-4 py-3';

/** A stable tint per product, so a photo-less row still reads as itself. */
const PLACEHOLDER_TINTS = [
  'bg-primary/10 text-primary',
  'bg-success/10 text-success-text',
  'bg-warning/15 text-warning-text',
  'bg-destructive/10 text-destructive-text',
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

/** When stock last moved — a sale, receipt, return or adjustment. */
function LastMovement({ at }: { at: Date | null }) {
  if (!at) return <span>No movements yet</span>;
  // Raw SQL hands back a Date, but never trust a driver with a time zone.
  const when = new Date(at);
  return (
    <time dateTime={when.toISOString()} title={formatDateTime(when)}>
      Moved {formatRelative(when)}
    </time>
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
  canViewCost,
}: {
  rows: InventoryListRow[];
  currency: string;
  canAdjustStock: boolean;
  canEditProduct: boolean;
  canViewCost: boolean;
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
                  {formatPieces(row.onHand, row.unit)}
                </span>
                <StatusPill status={row.status} />
              </div>
              <StockBar row={row} />
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {row.reorderLevel > 0 ? `Low at ${formatPieces(row.reorderLevel, row.unit)} · ` : ''}
                <LastMovement at={row.lastMovementAt} />
              </p>
            </div>
            <ProductRowActions
              productId={row.productId}
              productName={row.name}
              sku={row.sku}
              onHand={row.onHand}
              unit={row.unit}
              allowsDecimal={row.allowsDecimal}
              canAdjustStock={canAdjustStock}
              canEditProduct={canEditProduct}
            />
          </div>
        ))}
      </div>

      {/* Desktop: the full register, scrolling sideways rather than dropping
          columns, so nothing an owner needs disappears on a laptop. */}
      <div className="hidden sm:block">
        <Table className="min-w-[1140px]">
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD}>Product</TableHead>
              <TableHead className={HEAD}>Category</TableHead>
              <TableHead className={HEAD}>Price</TableHead>
              <TableHead className={HEAD}>Stock</TableHead>
              <TableHead className={HEAD}>Low at</TableHead>
              <TableHead className={HEAD}>Status</TableHead>
              <TableHead className={HEAD}>Last movement</TableHead>
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
                    {canViewCost ? (
                      <p className="tabular whitespace-nowrap text-xs text-muted-foreground">
                        Cost {formatCurrency(row.costPrice, currency)} · {formatNumber(margin, 0)}%
                      </p>
                    ) : (
                      <p className="whitespace-nowrap text-xs text-muted-foreground">per piece</p>
                    )}
                  </TableCell>

                  <TableCell className={cn(CELL, 'w-[240px]')}>
                    <div className="flex items-baseline gap-1.5">
                      <span
                        className={cn(
                          'tabular text-sm font-semibold',
                          row.status === 'OUT_OF_STOCK'
                            ? 'text-destructive-text'
                            : row.status === 'LOW' || row.status === 'CRITICAL'
                              ? 'text-warning-text'
                              : '',
                        )}
                      >
                        {formatQuantity(row.onHand)}
                      </span>
                      <span className="text-xs text-muted-foreground">pcs</span>
                    </div>
                    <StockBar row={row} />
                  </TableCell>

                  <TableCell className={cn(CELL, 'tabular whitespace-nowrap text-sm text-muted-foreground')}>
                    {row.reorderLevel > 0 ? formatPieces(row.reorderLevel, row.unit) : 'Not set'}
                  </TableCell>

                  <TableCell className={CELL}>
                    <StatusPill status={row.status} />
                  </TableCell>

                  <TableCell className={cn(CELL, 'whitespace-nowrap text-sm text-muted-foreground')}>
                    <LastMovement at={row.lastMovementAt} />
                  </TableCell>

                  <TableCell className={cn(CELL, 'text-right')}>
                    <ProductRowActions
                      productId={row.productId}
                      productName={row.name}
                      sku={row.sku}
                      onHand={row.onHand}
                      unit={row.unit}
                      allowsDecimal={row.allowsDecimal}
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
