import type { Metadata } from 'next';
import { Package } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { getStockLevels, type StockStatus } from '@/server/analytics/inventory-analytics';
import { getInventorySnapshot } from '@/server/analytics/dashboard';
import { getProductFormOptions } from '@/features/products/queries';
import { getCurrency, getSettings, readNumber } from '@/server/services/settings-service';
import { formatNumber } from '@/lib/format';
import { PageHeader } from '@/components/page-header';
import { StatCard } from '@/components/stat-card';
import { EmptyState } from '@/components/empty-state';
import { PaginationBar } from '@/components/filter-bar';
import { AddProductDialog } from '@/features/inventory/add-product-dialog';
import { InventoryMoreMenu } from '@/features/inventory/inventory-more-menu';
import { InventorySearchFilter } from '@/features/inventory/inventory-search-filter';
import { InventoryProductList } from '@/features/inventory/inventory-product-list';

export const metadata: Metadata = { title: 'Inventory' };
export const dynamic = 'force-dynamic';

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const user = await requirePermission('inventory.view');
  const params = await searchParams;

  const status: StockStatus | 'ALL' = params.status === 'LOW' || params.status === 'OUT_OF_STOCK' ? params.status : 'ALL';

  const [options, currency, settings, snapshot] = await Promise.all([
    getProductFormOptions(),
    getCurrency(),
    getSettings(),
    getInventorySnapshot(),
  ]);

  const result = await getStockLevels({
    search: params.q,
    status,
    page: Number(params.page) || 1,
    pageSize: 25,
  });

  const canAdjustStock = userCan(user, 'inventory.create');
  const canEditProduct = userCan(user, 'products.update');
  const canCreateProduct = userCan(user, 'products.create');

  const defaultUnitId = options.units.find((u) => u.name.toLowerCase() === 'piece')?.id ?? options.units[0]?.id ?? '';
  const defaultReorderLevel = readNumber(settings, 'inventory.defaultLowStockLevel');

  const hasAnyProducts = snapshot.distinctProducts > 0;
  const hasActiveFilters = Boolean(params.q?.trim()) || status !== 'ALL';

  const rows = result.rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    sku: row.sku,
    unit: row.unitAbbreviation,
    sellingPrice: row.sellingPrice,
    onHand: row.onHand,
    costPrice: row.costPrice,
    status: row.status,
  }));

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Manage your products and stock."
        actions={
          <>
            {canAdjustStock && <InventoryMoreMenu />}
            {canCreateProduct && (
              <AddProductDialog
                categories={options.categories}
                defaultUnitId={defaultUnitId}
                defaultReorderLevel={defaultReorderLevel}
              />
            )}
          </>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Total products" value={formatNumber(snapshot.distinctProducts, 0)} />
        <StatCard
          label="Low stock"
          value={formatNumber(snapshot.lowStock + snapshot.criticalStock, 0)}
          tone={snapshot.lowStock + snapshot.criticalStock > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Out of stock"
          value={formatNumber(snapshot.outOfStock, 0)}
          tone={snapshot.outOfStock > 0 ? 'destructive' : 'success'}
        />
      </div>

      <InventorySearchFilter />

      <div className="rounded-lg border">
        {rows.length === 0 ? (
          !hasAnyProducts ? (
            <EmptyState
              icon={Package}
              title="No products yet"
              description="Add your first product to start selling."
              action={
                canCreateProduct && (
                  <AddProductDialog
                    categories={options.categories}
                    defaultUnitId={defaultUnitId}
                    defaultReorderLevel={defaultReorderLevel}
                  />
                )
              }
            />
          ) : (
            <EmptyState
              icon={Package}
              title="No products found"
              description={
                hasActiveFilters
                  ? "Try a different search, or clear the filter above."
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
            <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </div>
    </>
  );
}
