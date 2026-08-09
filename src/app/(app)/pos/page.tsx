import type { Metadata } from 'next';
import { prisma } from '@/lib/prisma';
import { requirePermission, userCan } from '@/lib/session';
import { searchSellableProducts } from '@/features/products/queries';
import { getCompanyProfile } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';
import { PosTerminal } from '@/features/pos/pos-terminal';

export const metadata: Metadata = { title: 'Point of Sale' };
export const dynamic = 'force-dynamic';

export default async function PosPage() {
  const user = await requirePermission('pos.view');

  const [warehouses, customers, company] = await Promise.all([
    prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isDefault: true },
    }),
    prisma.customer.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      take: 200,
      select: { id: true, name: true },
    }),
    getCompanyProfile(),
  ]);

  const defaultWarehouse = warehouses.find((w) => w.isDefault) ?? warehouses[0];

  // Seed the grid so the till is usable the moment it loads, before any search.
  const initialProducts = defaultWarehouse
    ? await searchSellableProducts('', defaultWarehouse.id, 40)
    : [];

  return (
    <>
      <PageHeader
        title="Point of Sale"
        description="Scan or tap to build a basket. Stock is deducted the moment the sale completes."
      />

      <PosTerminal
        warehouses={warehouses}
        customers={customers}
        initialProducts={initialProducts}
        currency={company.currency}
        cashierName={user.name}
        canAddCustomers={userCan(user, 'customers.create')}
        company={{
          name: company.name,
          address: company.address,
          phone: company.phone,
          taxNumber: company.taxNumber,
          receiptFooter: company.receiptFooter,
        }}
      />
    </>
  );
}
