import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { requirePermission } from '@/lib/session';
import { getProductFormOptions } from '@/features/products/queries';
import { getCurrency } from '@/server/services/settings-service';
import { isStorageConfigured } from '@/lib/env';
import { PageHeader } from '@/components/page-header';
import { ProductForm } from '@/features/products/product-form';

export const metadata: Metadata = { title: 'New product' };
export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  await requirePermission('products.create');

  const [options, currency] = await Promise.all([getProductFormOptions(), getCurrency()]);

  // A product cannot be saved without both, so say so up front rather than
  // letting the user fill in a long form and fail at the last step.
  const missing = [
    options.categories.length === 0 ? { label: 'category', href: '/categories' } : null,
    options.units.length === 0 ? { label: 'unit of measure', href: '/units' } : null,
  ].filter((item): item is { label: string; href: string } => item !== null);

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
            You need at least one{' '}
            {missing.map((item, index) => (
              <span key={item.label}>
                {index > 0 && ' and one '}
                <Link href={item.href} className="font-medium underline">
                  {item.label}
                </Link>
              </span>
            ))}{' '}
            before you can save a product.
          </p>
        </div>
      )}

      <ProductForm options={options} currency={currency} storageEnabled={isStorageConfigured()} />
    </>
  );
}
