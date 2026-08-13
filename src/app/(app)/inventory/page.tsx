import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeftRight, Boxes, ClipboardList } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { getStockLevels, type StockStatus } from '@/server/analytics/inventory-analytics';
import { getInventorySnapshot } from '@/server/analytics/dashboard';
import { listActiveWarehouses } from '@/features/inventory/queries';
import { prisma } from '@/lib/prisma';
import { getCurrency } from '@/server/services/settings-service';
import { formatCurrency, formatDate, formatNumber, formatQuantity } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/empty-state';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Stock levels' };
export const dynamic = 'force-dynamic';

const STATUS_META: Record<StockStatus, { label: string; variant: 'success' | 'secondary' | 'warning' | 'destructive' }> = {
  OUT_OF_STOCK: { label: 'Out of stock', variant: 'destructive' },
  CRITICAL: { label: 'Critical', variant: 'destructive' },
  LOW: { label: 'Low', variant: 'warning' },
  HEALTHY: { label: 'Healthy', variant: 'success' },
  OVERSTOCK: { label: 'Overstocked', variant: 'secondary' },
};

const STATUS_KEYS = Object.keys(STATUS_META) as StockStatus[];

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; warehouse?: string; category?: string; page?: string }>;
}) {
  const user = await requirePermission('inventory.view');
  const params = await searchParams;

  const [warehouses, categories, currency, snapshot] = await Promise.all([
    listActiveWarehouses(),
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    getCurrency(),
    getInventorySnapshot(),
  ]);

  const result = await getStockLevels({
    search: params.q,
    status: STATUS_KEYS.includes(params.status as StockStatus) ? (params.status as StockStatus) : 'ALL',
    warehouseId: params.warehouse,
    categoryId: params.category,
    page: Number(params.page) || 1,
    pageSize: 25,
  });

  const canAdjust = userCan(user, 'inventory.create');

  // Unfiltered, the quantities below are company-wide totals. A product can read
  // "Healthy" here while a till sells from a warehouse holding none of it, so the
  // split is shown wherever the total spans locations or sits somewhere unsellable.
  const warehouseFiltered = Boolean(params.warehouse);

  return (
    <>
      <PageHeader
        title="Stock levels"
        description="Live on-hand quantities, totalled across every warehouse unless you filter to one. Available is on-hand minus anything reserved for unfulfilled orders."
        actions={
          canAdjust && (
            <>
              <Button variant="outline" asChild>
                <Link href="/inventory/transfers">
                  <ArrowLeftRight /> Transfer
                </Link>
              </Button>
              <Button asChild>
                <Link href="/inventory/adjustments">
                  <ClipboardList /> Adjust stock
                </Link>
              </Button>
            </>
          )
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Stock value"
          value={formatCurrency(snapshot.costValue, currency)}
          hint={`${formatCurrency(snapshot.retailValue, currency)} at retail`}
        />
        <StatCard
          label="Available units"
          value={formatQuantity(snapshot.available)}
          hint={snapshot.reserved > 0 ? `${formatQuantity(snapshot.reserved)} reserved` : 'Nothing reserved'}
        />
        <StatCard
          label="Below reorder"
          value={formatNumber(snapshot.lowStock + snapshot.criticalStock, 0)}
          tone={snapshot.criticalStock > 0 ? 'warning' : 'default'}
          hint={`${snapshot.criticalStock} critical`}
        />
        <StatCard
          label="Out of stock"
          value={formatNumber(snapshot.outOfStock, 0)}
          tone={snapshot.outOfStock > 0 ? 'destructive' : 'success'}
          hint={`${snapshot.deadStock} dead stock lines`}
        />
      </div>

      <FilterBar
        searchPlaceholder="Search name, SKU, or barcode…"
        selects={[
          {
            name: 'status',
            label: 'Stock status',
            allLabel: 'All statuses',
            width: 'w-[160px]',
            options: STATUS_KEYS.map((key) => ({ value: key, label: STATUS_META[key].label })),
          },
          {
            name: 'warehouse',
            label: 'Warehouse',
            allLabel: 'All warehouses',
            options: warehouses.map((w) => ({ value: w.id, label: w.name })),
          },
          {
            name: 'category',
            label: 'Category',
            allLabel: 'All categories',
            options: categories.map((c) => ({ value: c.id, label: c.name })),
          },
        ]}
      />

      <div className="rounded-lg border">
        {result.rows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="Nothing to show"
            description="Either no products match these filters, or no trackable products have been created yet."
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="hidden md:table-cell">Category</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Available</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Reorder at</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Value</TableHead>
                  <TableHead className="hidden lg:table-cell">Last sold</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row) => {
                  const meta = STATUS_META[row.status];
                  const showSplit =
                    !warehouseFiltered &&
                    (row.warehouseBreakdown.length > 1 ||
                      row.warehouseBreakdown.some((entry) => !entry.isActive));
                  return (
                    <TableRow key={row.productId}>
                      <TableCell>
                        <Link href={`/products/${row.productId}`} className="font-medium hover:underline">
                          {row.name}
                        </Link>
                        <p className="text-xs text-muted-foreground">{row.sku}</p>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {row.categoryName}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatQuantity(row.onHand)}
                        {showSplit && (
                          <span className="mt-1 block text-xs font-normal">
                            {row.warehouseBreakdown.map((entry) => (
                              <span
                                key={entry.warehouseId}
                                className={cn(
                                  'block truncate',
                                  entry.isActive ? 'text-muted-foreground' : 'text-warning',
                                )}
                                title={
                                  entry.isActive
                                    ? undefined
                                    : `${entry.warehouseName} is deactivated — this stock cannot be sold.`
                                }
                              >
                                {formatQuantity(entry.quantity)} · {entry.warehouseName}
                                {!entry.isActive && ' (inactive)'}
                              </span>
                            ))}
                          </span>
                        )}
                      </TableCell>
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
                        {formatQuantity(row.available)}
                        {row.reserved > 0 && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            {formatQuantity(row.reserved)} reserved
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="tabular hidden text-right text-sm text-muted-foreground sm:table-cell">
                        {row.reorderLevel > 0 || row.minStock > 0
                          ? formatQuantity(row.reorderLevel || row.minStock)
                          : '—'}
                      </TableCell>
                      <TableCell className="tabular hidden text-right lg:table-cell">
                        {formatCurrency(row.stockValue, currency)}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                        {row.lastSoldAt ? formatDate(row.lastSoldAt) : 'never'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </div>
    </>
  );
}
