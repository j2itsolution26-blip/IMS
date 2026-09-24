import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes, Package, PackageX, PhilippinePeso, TriangleAlert } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { getStockLevels, type StockFilter, type StockSort } from '@/server/analytics/inventory-analytics';
import { getInventorySnapshot } from '@/server/analytics/dashboard';
import { getProductFormOptions } from '@/features/products/queries';
import { getCurrency, getSettings, readNumber } from '@/server/services/settings-service';
import { isStorageConfigured } from '@/lib/env';
import { formatCompactCurrency, formatCurrency, formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PaginationBar } from '@/components/filter-bar';
import { AddProductDialog } from '@/features/inventory/add-product-dialog';
import { InventoryMoreMenu } from '@/features/inventory/inventory-more-menu';
import { InventorySearchFilter } from '@/features/inventory/inventory-search-filter';
import { InventoryProductList } from '@/features/inventory/inventory-product-list';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Inventory' };
export const dynamic = 'force-dynamic';

const STATUS_FILTERS = ['ALL', 'IN_STOCK', 'LOW_ANY', 'OUT_OF_STOCK'] as const;
const SORTS = ['stock', 'name', 'price', 'value'] as const;

const PAGE_SIZE = 25;

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; category?: string; sort?: string; page?: string }>;
}) {
  const user = await requirePermission('inventory.view');
  const params = await searchParams;

  const status: StockFilter = (STATUS_FILTERS as readonly string[]).includes(params.status ?? '')
    ? (params.status as StockFilter)
    : 'ALL';
  const sort: StockSort = (SORTS as readonly string[]).includes(params.sort ?? '')
    ? (params.sort as StockSort)
    : 'stock';

  const [options, currency, settings, snapshot] = await Promise.all([
    getProductFormOptions(),
    getCurrency(),
    getSettings(),
    getInventorySnapshot(),
  ]);

  const result = await getStockLevels({
    search: params.q,
    status,
    categoryId: params.category,
    sort,
    page: Number(params.page) || 1,
    pageSize: PAGE_SIZE,
  });

  const canAdjustStock = userCan(user, 'inventory.create');
  const canEditProduct = userCan(user, 'products.update');
  const canCreateProduct = userCan(user, 'products.create');
  const canExport = userCan(user, 'reports.export');

  const defaultUnitId = options.units.find((u) => u.name.toLowerCase() === 'piece')?.id ?? options.units[0]?.id ?? '';
  const defaultReorderLevel = readNumber(settings, 'inventory.defaultLowStockLevel');
  const storageEnabled = isStorageConfigured();

  const lowStock = snapshot.lowStock + snapshot.criticalStock;
  const inStock = snapshot.healthyStock + snapshot.overStock;
  const margin =
    snapshot.retailValue > 0
      ? Math.round(((snapshot.retailValue - snapshot.costValue) / snapshot.retailValue) * 100)
      : 0;

  const hasAnyProducts = snapshot.distinctProducts > 0;
  const hasActiveFilters = Boolean(params.q?.trim()) || status !== 'ALL' || Boolean(params.category);

  const rows = result.rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    sku: row.sku,
    imageUrl: row.imageUrl,
    categoryName: row.categoryName,
    unit: row.unitAbbreviation,
    sellingPrice: row.sellingPrice,
    costPrice: row.costPrice,
    onHand: row.onHand,
    reorderLevel: row.reorderLevel,
    status: row.status,
    updatedAt: row.updatedAt,
  }));

  const firstRow = result.total === 0 ? 0 : (result.page - 1) * PAGE_SIZE + 1;
  const lastRow = Math.min(result.page * PAGE_SIZE, result.total);

  const addProduct = (
    <AddProductDialog
      categories={options.categories}
      defaultUnitId={defaultUnitId}
      defaultReorderLevel={defaultReorderLevel}
      currency={currency}
      storageEnabled={storageEnabled}
    />
  );

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Manage your products and stock levels"
        actions={
          <>
            {canAdjustStock && <InventoryMoreMenu />}
            {/* The stock report the Reports section already generates — same
                figures, same permissions, just reachable from here too. */}
            {canExport && (
              <Button variant="outline" size="lg" asChild>
                {/* A plain anchor: this returns a file, and client-side routing
                    has no idea what to do with a Content-Disposition. */}
                <a href="/api/reports/inventory/export?format=csv">Export</a>
              </Button>
            )}
            {canCreateProduct && addProduct}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={<Boxes className="h-4 w-4" />}
          iconClass="bg-primary/10 text-primary"
          label="Total products"
          value={formatNumber(snapshot.distinctProducts, 0)}
          foot={`${formatNumber(options.categories.length, 0)} categor${options.categories.length === 1 ? 'y' : 'ies'}`}
        />
        <Kpi
          icon={<PhilippinePeso className="h-4 w-4" />}
          iconClass="bg-success/10 text-success"
          label="Stock value (retail)"
          value={formatCompactCurrency(snapshot.retailValue, currency)}
          foot={`Cost ${formatCurrency(snapshot.costValue, currency)} · ${formatNumber(margin, 0)}% margin`}
        />
        <Kpi
          icon={<TriangleAlert className="h-4 w-4" />}
          iconClass="bg-warning/15 text-warning"
          label="Low stock"
          value={formatNumber(lowStock, 0)}
          foot="Below reorder level"
          tone={lowStock > 0 ? 'warning' : undefined}
          action={lowStock > 0 ? { href: '/inventory?status=LOW_ANY', label: 'View' } : undefined}
        />
        <Kpi
          icon={<PackageX className="h-4 w-4" />}
          iconClass="bg-destructive/10 text-destructive"
          label="Out of stock"
          value={formatNumber(snapshot.outOfStock, 0)}
          foot={snapshot.outOfStock > 0 ? 'Losing sales now' : 'Nothing to restock'}
          tone={snapshot.outOfStock > 0 ? 'destructive' : undefined}
          action={
            snapshot.outOfStock > 0 ? { href: '/inventory?status=OUT_OF_STOCK', label: 'Restock' } : undefined
          }
        />
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <InventorySearchFilter
          tabs={[
            { value: 'ALL', label: 'All', count: snapshot.distinctProducts },
            { value: 'IN_STOCK', label: 'In stock', count: inStock },
            { value: 'LOW_ANY', label: 'Low', count: lowStock },
            { value: 'OUT_OF_STOCK', label: 'Out', count: snapshot.outOfStock },
          ]}
          categories={options.categories}
        />

        {rows.length === 0 ? (
          !hasAnyProducts ? (
            <EmptyState
              icon={Package}
              title="No products yet"
              description="Add your first product to start selling."
              action={canCreateProduct ? addProduct : undefined}
            />
          ) : (
            <EmptyState
              icon={Package}
              title="No products found"
              description={
                hasActiveFilters
                  ? 'Try a different search, or clear the filters above.'
                  : 'No products to show.'
              }
            />
          )
        ) : (
          <>
            <InventoryProductList
              rows={rows}
              currency={currency}
              canAdjustStock={canAdjustStock}
              canEditProduct={canEditProduct}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
              <p className="text-xs text-muted-foreground">
                Showing {formatNumber(firstRow, 0)}–{formatNumber(lastRow, 0)} of{' '}
                {formatNumber(result.total, 0)} product{result.total === 1 ? '' : 's'}
              </p>
              <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} compact />
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** One headline figure, with the thing to do about it when there is one. */
function Kpi({
  icon,
  iconClass,
  label,
  value,
  foot,
  tone,
  action,
}: {
  icon: React.ReactNode;
  iconClass: string;
  label: string;
  value: string;
  foot: string;
  tone?: 'warning' | 'destructive';
  action?: { href: string; label: string };
}) {
  return (
    <Card
      className={cn(
        'h-full p-4',
        tone === 'warning' && 'border-warning/40 bg-warning/5',
        tone === 'destructive' && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', iconClass)}>
          {icon}
        </span>
        <p className="truncate text-sm text-muted-foreground">{label}</p>
      </div>

      <p
        className={cn(
          'tabular mt-2 text-2xl font-semibold tracking-tight',
          tone === 'warning' && 'text-warning',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value}
      </p>

      <div className="mt-1 flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">{foot}</p>
        {action && (
          <Link
            href={action.href}
            className="shrink-0 whitespace-nowrap text-xs font-medium text-primary hover:underline"
          >
            {action.label} →
          </Link>
        )}
      </div>
    </Card>
  );
}
