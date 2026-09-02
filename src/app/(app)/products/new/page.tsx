import type { Metadata } from 'next';
import { AlertTriangle } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { getProductFormOptions } from '@/features/products/queries';
import { getCurrency, getSettings, readNumber } from '@/server/services/settings-service';
import { isStorageConfigured } from '@/lib/env';
import { PageHeader } from '@/components/page-header';
import { ProductForm } from '@/features/products/product-form';

export const metadata: Metadata = { title: 'New product' };
export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  await requirePermission('products.create');

  const [options, currency, settings] = await Promise.all([getProductFormOptions(), getCurrency(), getSettings()]);
  const defaultLowStockLevel = readNumber(settings, 'inventory.defaultLowStockLevel');

  // A product cannot be saved without both, so say so up front rather than
  // letting the user fill in a long form and fail at the last step. Both can
  // be added inline via the "+" button next to their picker below.
  const missing = [
    options.categories.length === 0 ? 'category' : null,
    options.units.length === 0 ? 'unit of measure' : null,
  ].filter((label): label is string => label !== null);

  return (
    <>
      <PageHeader
        title="New product"
        breadcrumbs={[{ label: 'Products', href: '/products' }, { label: 'New' }]}
      />

      {missing.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <p>
            You need at least one {missing.join(' and one ')} — use the <strong>+</strong> button next to that
            field below to add one.
          </p>
        </div>
      )}

      <ProductForm
        options={options}
        currency={currency}
        storageEnabled={isStorageConfigured()}
        defaultValues={{ reorderLevel: defaultLowStockLevel }}
      />
    </>
  );
}
