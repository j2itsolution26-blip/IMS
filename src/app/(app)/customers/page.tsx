import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { listCustomers } from '@/features/catalogue/queries';
import { CustomersManager } from '@/features/catalogue/managers';
import { getCurrency } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const user = await requirePermission('customers.view');
  const [rows, currency] = await Promise.all([listCustomers(), getCurrency()]);

  return (
    <>
      <PageHeader
        title="Customers"
        description="Optional for walk-in trade. Recording customers enables credit sales and best-customer reporting."
      />
      <CustomersManager
        rows={rows}
        currency={currency}
        permissions={{
          canCreate: userCan(user, 'customers.create'),
          canUpdate: userCan(user, 'customers.update'),
          canDelete: userCan(user, 'customers.delete'),
        }}
      />
    </>
  );
}
