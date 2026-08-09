import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requirePermission } from '@/lib/session';
import { getProduct, getProductFormOptions } from '@/features/products/queries';
import { getCurrency } from '@/server/services/settings-service';
import { isStorageConfigured } from '@/lib/env';
import { toNum } from '@/lib/decimal';
import { PageHeader } from '@/components/page-header';
import { ProductForm } from '@/features/products/product-form';

export const metadata: Metadata = { title: 'Edit product' };
export const dynamic = 'force-dynamic';

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission('products.update');
  const { id } = await params;

  const [product, options, currency] = await Promise.all([
    getProduct(id),
    getProductFormOptions(),
    getCurrency(),
  ]);

  if (!product) notFound();

  return (
    <>
      <PageHeader
        title={`Edit ${product.name}`}
        breadcrumbs={[
          { label: 'Products', href: '/products' },
          { label: product.name, href: `/products/${product.id}` },
          { label: 'Edit' },
        ]}
      />

      <ProductForm
        productId={product.id}
        options={options}
        currency={currency}
        storageEnabled={isStorageConfigured()}
        defaultValues={{
          name: product.name,
          sku: product.sku,
          barcode: product.barcode ?? '',
          description: product.description ?? '',
          imageUrl: product.imageUrl ?? '',
          categoryId: product.categoryId,
          unitId: product.unitId,
          brandId: product.brandId ?? 'none',
          supplierId: product.supplierId ?? 'none',
          costPrice: toNum(product.costPrice),
          sellingPrice: toNum(product.sellingPrice),
          taxRate: toNum(product.taxRate),
          minStock: toNum(product.minStock),
          maxStock: toNum(product.maxStock),
          reorderLevel: toNum(product.reorderLevel),
          reorderQty: toNum(product.reorderQty),
          status: product.status,
          isTrackable: product.isTrackable,
        }}
      />
    </>
  );
}
