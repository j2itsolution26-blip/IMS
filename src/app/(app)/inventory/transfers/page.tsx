import type { Metadata } from 'next';
import { requirePermission } from '@/lib/session';
import { getStockPickerProducts, listActiveWarehouses } from '@/features/inventory/queries';
import { PageHeader } from '@/components/page-header';
import { TransferForm } from '@/features/inventory/transfer-form';
import type { StockPickerProduct } from '@/features/inventory/queries';

export const metadata: Metadata = { title: 'Stock transfers' };
export const dynamic = 'force-dynamic';

export default async function TransfersPage() {
  await requirePermission('inventory.create');

  const warehouses = await listActiveWarehouses();

  // Availability differs per source warehouse, so each is loaded up front —
  // switching the source must not require a round trip mid-entry.
  const perWarehouse = await Promise.all(
    warehouses.map(async (warehouse) => [warehouse.id, await getStockPickerProducts(warehouse.id)] as const),
  );

  const productsByWarehouse: Record<string, StockPickerProduct[]> = Object.fromEntries(perWarehouse);

  return (
    <>
      <PageHeader
        title="Stock transfer"
        description="Move stock between warehouses. Both legs are recorded together so nothing goes missing in transit."
        breadcrumbs={[{ label: 'Stock levels', href: '/inventory' }, { label: 'Transfers' }]}
      />
      <TransferForm warehouses={warehouses} productsByWarehouse={productsByWarehouse} />
    </>
  );
}
