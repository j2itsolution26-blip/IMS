import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes, Package, PackageCheck, PackageX, PhilippinePeso, TriangleAlert } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { getStockLevels, type StockFilter, type StockSort } from '@/server/analytics/inventory-analytics';
import { getInventorySnapshot } from '@/server/analytics/dashboard';
import { getProductFormOptions } from '@/features/products/queries';
import { getCurrency, getSettings, readNumber } from '@/server/services/settings-service';
import { isBackgroundRemovalConfigured, isStorageConfigured } from '@/lib/env';
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
import { ScanReceiveDialog } from '@/features/inventory/scan-receive-dialog';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Inventory' };
export const dynamic = 'force-dynamic';

const STATUS_FILTERS = ['ALL', 'IN_STOCK', 'LOW_ANY', 'OUT_OF_STOCK'] as const;
const SORTS = ['stock', 'name', 'price', 'value'] as const;

const PAGE_SIZE = 25;
const EXPORT_HREF = '/api/reports/inventory/export?format=csv';

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
  // Cost, margin and stock value are the owner's. Staff get the register
  // without them, and cannot sort by a value they are not allowed to see.
  const canViewCost = userCan(user, FINANCIAL_PERMISSION);
  const requestedSort: StockSort = (SORTS as readonly string[]).includes(params.sort ?? '')
    ? (params.sort as StockSort)
    : 'stock';
  const sort: StockSort = requestedSort === 'value' && !canViewCost ? 'stock' : requestedSort;

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
    sellingPrice: row.sellingPrice,
    costPrice: canViewCost ? row.costPrice : 0,
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
      defaultReorderLevel={defaultReorderLevel}
      currency={currency}
      storageEnabled={storageEnabled}
      backgroundRemovalEnabled={isBackgroundRemovalConfigured()}
    />
  );

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Manage your products and stock levels"
        actions={
          // Phones: Add Product full width on top, then Receive stock beside a
          // More menu that also carries Export. From `sm` up the original
          // single row returns, in its original order, via `order`.
          <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            {canCreateProduct && <div className="col-span-2 grid sm:order-4">{addProduct}</div>}
            {canAdjustStock && (
              <div className="grid min-w-0 sm:order-2 [&>button]:px-4 sm:[&>button]:px-6">
                <ScanReceiveDialog />
              </div>
            )}
            {(canAdjustStock || canExport) && (
              // Without stock tools the menu only carries Export, which desktop
              // shows as its own button — so the cell is phone-only then.
              <div className={cn('grid sm:order-1', !canAdjustStock && 'col-start-2 sm:hidden')}>
                <InventoryMoreMenu
                  showStockTools={canAdjustStock}
                  exportHref={canExport ? EXPORT_HREF : undefined}
                  className="px-4 sm:px-6"
                />
              </div>
            )}
            {/* The stock report the Reports section already generates — same
                figures, same permissions, just reachable from here too. */}
            {canExport && (
              <Button variant="outline" size="lg" className="hidden sm:order-3 sm:inline-flex" asChild>
                {/* A plain anchor: this returns a file, and client-side routing
                    has no idea what to do with a Content-Disposition. */}
                <a href={EXPORT_HREF}>Export</a>
              </Button>
            )}
          </div>
        }
      />

      {/* Two columns as soon as a phone can hold them; a single column only on
          the narrowest screens. */}
      <div className="mb-4 grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2 sm:mb-5 sm:gap-3 xl:grid-cols-4">
        <Kpi
          icon={<Boxes className="h-4 w-4" />}
          iconClass="bg-primary/10 text-primary"
          label="Total products"
          value={formatNumber(snapshot.distinctProducts, 0)}
          foot={`${formatNumber(options.categories.length, 0)} categor${options.categories.length === 1 ? 'y' : 'ies'}`}
        />
        {canViewCost ? (
          <Kpi
            icon={<PhilippinePeso className="h-4 w-4" />}
            iconClass="bg-success/10 text-success"
            label="Stock value (retail)"
            value={formatCompactCurrency(snapshot.retailValue, currency)}
            foot={`Cost ${formatCurrency(snapshot.costValue, currency)} · ${formatNumber(margin, 0)}% margin`}
          />
        ) : (
          <Kpi
            icon={<PackageCheck className="h-4 w-4" />}
            iconClass="bg-success/10 text-success"
            label="In stock"
            value={formatNumber(inStock, 0)}
            foot="Above their low-stock level"
            action={inStock > 0 ? { href: '/inventory?status=IN_STOCK', label: 'View' } : undefined}
          />
        )}
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
          showValueSort={canViewCost}
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
              canViewCost={canViewCost}
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
        'h-full min-w-0 p-3 sm:p-4',
        tone === 'warning' && 'border-warning/40 bg-warning/5',
        tone === 'destructive' && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md sm:h-7 sm:w-7 [&>svg]:h-3.5 [&>svg]:w-3.5 sm:[&>svg]:h-4 sm:[&>svg]:w-4',
            iconClass,
          )}
        >
          {icon}
        </span>
        <p className="min-w-0 truncate text-xs text-muted-foreground sm:text-sm">{label}</p>
      </div>

      <p
        className={cn(
          'tabular mt-1.5 truncate text-xl font-semibold leading-tight tracking-tight sm:mt-2 sm:text-2xl',
          tone === 'warning' && 'text-warning',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value}
      </p>

      <div className="mt-0.5 flex min-w-0 items-center justify-between gap-2 sm:mt-1">
        <p className="min-w-0 truncate text-xs text-muted-foreground">{foot}</p>
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
