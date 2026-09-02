import type { Metadata } from 'next';
import Link from 'next/link';
import { Package, Plus } from 'lucide-react';
import type { ProductStatus } from '@prisma/client';
import { requirePermission, userCan } from '@/lib/session';
import { listProducts, getProductFormOptions } from '@/features/products/queries';
import { getCurrency } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/empty-state';
import { FilterBar, PaginationBar } from '@/components/filter-bar';
import { ProductTable } from '@/features/products/product-table';
import { PRODUCT_STATUS_OPTIONS } from '@/features/products/schema';

export const metadata: Metadata = { title: 'Products' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  category?: string;
  status?: string;
  page?: string;
}

const STATUS_VALUES = new Set<string>(PRODUCT_STATUS_OPTIONS.map((option) => option.value));

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePermission('products.view');
  const params = await searchParams;

  const [options, currency] = await Promise.all([getProductFormOptions(), getCurrency()]);

  const result = await listProducts({
    search: params.q,
    categoryId: params.category,
    status: STATUS_VALUES.has(params.status ?? '') ? (params.status as ProductStatus) : 'ALL',
    page: Number(params.page) || 1,
    pageSize: 20,
  });

  const hasFilters = Boolean(params.q || params.category || params.status);
  const canCreate = userCan(user, 'products.create');

  return (
    <>
      <PageHeader
        title="Products"
        description="Your catalogue and live stock on hand."
        actions={
          canCreate && (
            <Button asChild>
              <Link href="/products/new">
                <Plus /> New product
              </Link>
            </Button>
          )
        }
      />

      <FilterBar
        searchPlaceholder="Search name, SKU, or barcode…"
        selects={[
          {
            name: 'status',
            label: 'Status',
            allLabel: 'All statuses',
            width: 'w-[150px]',
            options: PRODUCT_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
          },
          {
            name: 'category',
            label: 'Category',
            allLabel: 'All categories',
            options: options.categories.map((c) => ({ value: c.id, label: c.name })),
          },
        ]}
      />

      <div className="rounded-lg border">
        {result.rows.length === 0 ? (
          hasFilters ? (
            <EmptyState
              icon={Package}
              title="No products match those filters"
              description="Try clearing the filters or widening your search."
            />
          ) : (
            <EmptyState
              icon={Package}
              title="No products yet"
              description="Add your first product to start tracking stock, selling at the till, and building reports."
              action={
                canCreate && (
                  <Button asChild>
                    <Link href="/products/new">
                      <Plus /> Add your first product
                    </Link>
                  </Button>
                )
              }
            />
          )
        ) : (
          <>
            <ProductTable
              rows={result.rows}
              currency={currency}
              canUpdate={userCan(user, 'products.update')}
              canDelete={userCan(user, 'products.delete')}
            />
            <PaginationBar page={result.page} pageCount={result.pageCount} total={result.total} />
          </>
        )}
      </div>
    </>
  );
}
