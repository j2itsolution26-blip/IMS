import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { listWarehouses } from '@/features/catalogue/queries';
import { WarehousesManager } from '@/features/catalogue/managers';
import { getCurrency } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Warehouses' };
export const dynamic = 'force-dynamic';

export default async function WarehousesPage() {
  const user = await requirePermission('warehouses.view');
  const [rows, currency] = await Promise.all([listWarehouses(), getCurrency()]);

  return (
    <>
      <PageHeader
        title="Warehouses"
        description="Physical locations that hold stock. Values are the live sum of quantity × average cost."
      />
      <WarehousesManager
        rows={rows}
        currency={currency}
        permissions={{
          canCreate: userCan(user, 'warehouses.create'),
          canUpdate: userCan(user, 'warehouses.update'),
          canDelete: userCan(user, 'warehouses.delete'),
        }}
      />
    </>
  );
}
