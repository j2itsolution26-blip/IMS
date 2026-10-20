import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { FINANCIAL_PERMISSION } from '@/lib/permissions';
import { getStockPickerProducts } from '@/features/inventory/queries';
import { getCurrency } from '@/server/services/settings-service';
import { PageHeader } from '@/components/page-header';
import { AdjustmentForm } from '@/features/inventory/adjustment-form';

export const metadata: Metadata = { title: 'Stock adjustments' };
export const dynamic = 'force-dynamic';

export default async function AdjustmentsPage() {
  const user = await requirePermission('inventory.create');
  const canViewCost = userCan(user, FINANCIAL_PERMISSION);

  const [products, currency] = await Promise.all([
    getStockPickerProducts({ includeCost: canViewCost }),
    getCurrency(),
  ]);

  return (
    <>
      <PageHeader
        title="Stock adjustment"
        description="Correct stock after a count, write off damage, or load opening balances."
        breadcrumbs={[{ label: 'Inventory', href: '/inventory/movements' }, { label: 'Adjustment' }]}
      />
      <AdjustmentForm products={products} currency={currency} canViewCost={canViewCost} />
    </>
  );
}
