import type { Metadata } from 'next';
import { requirePermission } from '@/lib/session';
import { getStockPickerProducts, listActiveWarehouses } from '@/features/inventory/queries';
import type { StockPickerProduct } from '@/features/inventory/queries';
import { getCurrency } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';
import { AdjustmentForm } from '@/features/inventory/adjustment-form';

export const metadata: Metadata = { title: 'Stock adjustments' };
export const dynamic = 'force-dynamic';

export default async function AdjustmentsPage() {
  await requirePermission('inventory.create');

  const [warehouses, currency] = await Promise.all([listActiveWarehouses(), getCurrency()]);

  // On-hand is per warehouse, and a counted adjustment is applied as the
  // difference against it — so every warehouse is loaded up front. Loading only
  // the default one lets the operator switch warehouse and approve a difference
  // measured against a location they are not adjusting.
  const perWarehouse = await Promise.all(
    warehouses.map(async (warehouse) => [warehouse.id, await getStockPickerProducts(warehouse.id)] as const),
  );

  const productsByWarehouse: Record<string, StockPickerProduct[]> = Object.fromEntries(perWarehouse);

  return (
    <>
      <PageHeader
        title="Stock adjustment"
        description="Correct stock after a count, write off damage, or load opening balances."
        breadcrumbs={[{ label: 'Stock levels', href: '/inventory' }, { label: 'Adjustments' }]}
      />
      <AdjustmentForm
        warehouses={warehouses}
        productsByWarehouse={productsByWarehouse}
        currency={currency}
      />
    </>
  );
}
