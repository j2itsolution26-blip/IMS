import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes, ClipboardList, Tags } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { getStockLevels, type StockStatus } from '@/server/analytics/inventory-analytics';
import { getInventorySnapshot } from '@/server/analytics/dashboard';
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
import { StockInDialog } from '@/features/inventory/stock-in-dialog';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Inventory' };
export const dynamic = 'force-dynamic';

/** The spec's three-state stock badge: 🟢 In Stock, 🟠 Low Stock, 🔴 Out of Stock. */
const STATUS_META: Record<StockStatus, { label: string; variant: 'success' | 'warning' | 'destructive' }> = {
  OUT_OF_STOCK: { label: 'Out of Stock', variant: 'destructive' },
  CRITICAL: { label: 'Low Stock', variant: 'warning' },
  LOW: { label: 'Low Stock', variant: 'warning' },
  HEALTHY: { label: 'In Stock', variant: 'success' },
  OVERSTOCK: { label: 'In Stock', variant: 'success' },
};

const FILTER_STATUSES: { value: StockStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All statuses' },
  { value: 'HEALTHY', label: 'In Stock' },
  { value: 'LOW', label: 'Low Stock' },
  { value: 'OUT_OF_STOCK', label: 'Out of Stock' },
];

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; category?: string; page?: string }>;
}) {
  const user = await requirePermission('inventory.view');
  const params = await searchParams;

  const status: StockStatus | 'ALL' =
    params.status === 'LOW' || params.status === 'OUT_OF_STOCK' || params.status === 'HEALTHY'
      ? params.status
      : 'ALL';

  const [categories, currency, snapshot] = await Promise.all([
    prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    getCurrency(),
    getInventorySnapshot(),
  ]);

  const result = await getStockLevels({
    search: params.q,
    status,
    categoryId: params.category,
    page: Number(params.page) || 1,
    pageSize: 25,
  });

  const canAdjust = userCan(user, 'inventory.create');

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Live stock on hand for every product."
        actions={
          canAdjust && (
            <>
              <Button variant="outline" asChild>
                <Link href="/inventory/categories">
                  <Tags /> Categories &amp; units
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/inventory/movements">Movements</Link>
              </Button>
              <Button variant="outline" asChild>
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
        <StatCard label="Total products" value={formatNumber(snapshot.distinctProducts, 0)} />
        <StatCard
          label="Low stock"
          value={formatNumber(snapshot.lowStock + snapshot.criticalStock, 0)}
          tone={snapshot.criticalStock > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Out of stock"
          value={formatNumber(snapshot.outOfStock, 0)}
          tone={snapshot.outOfStock > 0 ? 'destructive' : 'success'}
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
            options: FILTER_STATUSES.filter((s) => s.value !== 'ALL').map((s) => ({ value: s.value, label: s.label })),
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
                  <TableHead className="hidden text-right sm:table-cell">Low-stock at</TableHead>
                  <TableHead className="hidden text-right lg:table-cell">Value</TableHead>
                  <TableHead className="hidden lg:table-cell">Last sold</TableHead>
                  <TableHead>Status</TableHead>
                  {canAdjust && <TableHead className="w-32" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.rows.map((row) => {
                  const meta = STATUS_META[row.status];
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
                        {formatQuantity(row.onHand)}
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
                      {canAdjust && (
                        <TableCell>
                          <StockInDialog productId={row.productId} productName={row.name} unit="units" />
                        </TableCell>
                      )}
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
