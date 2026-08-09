import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { listSuppliers } from '@/features/catalogue/queries';
import { SuppliersManager } from '@/features/catalogue/managers';
import { getCurrency } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Suppliers' };
export const dynamic = 'force-dynamic';

export default async function SuppliersPage() {
  const user = await requirePermission('suppliers.view');
  const [rows, currency] = await Promise.all([listSuppliers(), getCurrency()]);

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Who you buy from. Spend and outstanding balances are calculated from actual purchase orders."
      />
      <SuppliersManager
        rows={rows}
        currency={currency}
        permissions={{
          canCreate: userCan(user, 'suppliers.create'),
          canUpdate: userCan(user, 'suppliers.update'),
          canDelete: userCan(user, 'suppliers.delete'),
        }}
      />
    </>
  );
}
