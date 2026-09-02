import type { Metadata } from 'next';
import { requirePermission } from '@/lib/session';
import { getStockPickerProducts } from '@/features/inventory/queries';
import { getCurrency } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';
import { AdjustmentForm } from '@/features/inventory/adjustment-form';

export const metadata: Metadata = { title: 'Stock adjustments' };
export const dynamic = 'force-dynamic';

export default async function AdjustmentsPage() {
  await requirePermission('inventory.create');

  const [products, currency] = await Promise.all([getStockPickerProducts(), getCurrency()]);

  return (
    <>
      <PageHeader
        title="Stock adjustment"
        description="Correct stock after a count, write off damage, or load opening balances."
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Adjustments' }]}
      />
      <AdjustmentForm products={products} currency={currency} />
    </>
  );
}
