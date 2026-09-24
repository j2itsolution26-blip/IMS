import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { getPosCategories, searchSellableProducts } from '@/features/products/queries';
import { getCompanyProfile, getSettings, readNumber } from '@/server/services/settings-service';
import { getOpenShift } from '@/server/services/shift-service';
import { PageHeader } from '@/components/page-header';
import { PosTerminal } from '@/features/pos/pos-terminal';

export const metadata: Metadata = { title: 'Point of Sale' };
export const dynamic = 'force-dynamic';

export default async function PosPage() {
  const user = await requirePermission('pos.view');

  const settings = await getSettings();
  const lowStockLevel = readNumber(settings, 'inventory.defaultLowStockLevel');

  const [company, openShift, initialProducts, categoryChips] = await Promise.all([
    getCompanyProfile(),
    getOpenShift(user.id),
    searchSellableProducts('', 40),
    getPosCategories(lowStockLevel),
  ]);

  return (
    <>
      <PageHeader
        title="Point of sale"
        description={`${user.name} · ${new Date().toLocaleDateString('en-PH', {
          weekday: 'long',
          day: 'numeric',
          month: 'short',
        })}`}
      />

      <PosTerminal
        initialProducts={initialProducts}
        currency={company.currency}
        taxRate={readNumber(settings, 'sales.defaultTaxRate')}
        cashierName={user.name}
        company={{
          name: company.name,
          address: company.address,
          phone: company.phone,
          receiptFooter: company.receiptFooter,
        }}
        gcash={{ number: company.gcashNumber, accountName: company.gcashName }}
        canEditStoreSettings={userCan(user, 'settings.update')}
        canCreateProducts={userCan(user, 'products.create')}
        categoryChips={categoryChips}
        lowStockLevel={lowStockLevel}
        openShift={openShift ? { id: openShift.id, openedAt: openShift.openedAt.toISOString(), openingCash: openShift.openingCash } : null}
      />
    </>
  );
}
