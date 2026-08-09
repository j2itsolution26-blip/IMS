import type { Metadata } from 'next';
import { requirePermission } from '@/lib/session';
import { getStockPickerProducts, listActiveWarehouses } from '@/features/inventory/queries';
import { getCurrency } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';
import { AdjustmentForm } from '@/features/inventory/adjustment-form';

export const metadata: Metadata = { title: 'Stock adjustments' };
export const dynamic = 'force-dynamic';

export default async function AdjustmentsPage() {
  await requirePermission('inventory.create');

  const [warehouses, currency] = await Promise.all([listActiveWarehouses(), getCurrency()]);
  const defaultWarehouse = warehouses.find((w) => w.isDefault) ?? warehouses[0];
  const products = defaultWarehouse ? await getStockPickerProducts(defaultWarehouse.id) : [];

  return (
    <>
      <PageHeader
        title="Stock adjustment"
        description="Correct stock after a count, write off damage, or load opening balances."
        breadcrumbs={[{ label: 'Stock levels', href: '/inventory' }, { label: 'Adjustments' }]}
      />
      <AdjustmentForm warehouses={warehouses} products={products} currency={currency} />
    </>
  );
}
