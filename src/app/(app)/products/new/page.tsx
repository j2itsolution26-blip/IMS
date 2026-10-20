import type { Metadata } from 'next';
import { AlertTriangle } from 'lucide-react';
import { requirePermission, userCan } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { getProductFormOptions } from '@/features/products/queries';
import { getCurrency, getSettings, readNumber } from '@/server/services/settings-service';
import { isBackgroundRemovalConfigured, isStorageConfigured } from '@/lib/env';
import { PageHeader } from '@/components/page-header';
import { ProductForm } from '@/features/products/product-form';

export const metadata: Metadata = { title: 'New product' };
export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  const user = await requirePermission('products.create');

  const [options, currency, settings] = await Promise.all([getProductFormOptions(), getCurrency(), getSettings()]);
  const defaultLowStockLevel = readNumber(settings, 'inventory.defaultLowStockLevel');

  // A product cannot be saved without a category, so say so up front rather
  // than letting the user fill in a long form and fail at the last step. One
  // can be added inline via the "+" button next to the picker below.
  const noCategories = options.categories.length === 0;

  return (
    <>
      <PageHeader
        title="New product"
        breadcrumbs={[{ label: 'Products', href: '/products' }, { label: 'New' }]}
      />

      {noCategories && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            You need at least one category — use the <strong>+</strong> button next to the Category field
            below to add one.
          </p>
        </div>
      )}

      <ProductForm
        options={options}
        currency={currency}
        storageEnabled={isStorageConfigured()}
        backgroundRemovalEnabled={isBackgroundRemovalConfigured()}
        canViewProfit={userCan(user, FINANCIAL_PERMISSION)}
        defaultValues={{ reorderLevel: defaultLowStockLevel }}
      />
    </>
  );
}
