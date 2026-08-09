import type { Metadata } from 'next';
import { requirePermission } from '@/lib/session';
import { getPurchaseFormOptions } from '@/features/purchases/queries';
import { getReorderSuggestions } from '@/server/analytics/dashboard';
import { getCurrency } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';
import { PurchaseOrderForm, type ReorderSeed } from '@/features/purchases/purchase-order-form';

export const metadata: Metadata = { title: 'New purchase order' };
export const dynamic = 'force-dynamic';

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ reorder?: string }>;
}) {
  await requirePermission('purchases.create');
  const params = await searchParams;

  const [options, currency] = await Promise.all([getPurchaseFormOptions(), getCurrency()]);

  // `?reorder=1` pre-fills the order from the live reorder suggestions, so the
  // dashboard's "Create order" button lands on a ready-to-review draft.
  let seed: ReorderSeed[] | undefined;
  if (params.reorder) {
    const suggestions = await getReorderSuggestions(25);
    seed = suggestions
      .filter((item) => item.suggestedQuantity > 0)
      .map((item) => ({ productId: item.productId, suggestedQuantity: item.suggestedQuantity }));
  }

  return (
    <>
      <PageHeader
        title="New purchase order"
        description="Record what you're buying. Stock arrives when you receive against the order."
        breadcrumbs={[{ label: 'Purchases', href: '/purchases' }, { label: 'New' }]}
      />
      <PurchaseOrderForm
        suppliers={options.suppliers}
        warehouses={options.warehouses}
        products={options.products}
        currency={currency}
        seed={seed}
      />
    </>
  );
}
