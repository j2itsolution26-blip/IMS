import type { Metadata } from 'next';
import { requirePermission } from '@/lib/session';
import { searchSellableProducts } from '@/features/products/queries';
import { getCompanyProfile, getSettings, readNumber } from '@/server/services/settings-service';
import { getOpenShift } from '@/server/services/shift-service';
import { PageHeader } from '@/components/page-header';
import { PosTerminal } from '@/features/pos/pos-terminal';

export const metadata: Metadata = { title: 'Point of Sale' };
export const dynamic = 'force-dynamic';

export default async function PosPage() {
  const user = await requirePermission('pos.view');

  const [company, settings, openShift, initialProducts] = await Promise.all([
    getCompanyProfile(),
    getSettings(),
    getOpenShift(user.id),
    searchSellableProducts('', 40),
  ]);

  return (
    <>
      <PageHeader
        title="Point of Sale"
        description="Scan or tap to build a basket. Stock is deducted the moment the sale completes."
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
        openShift={openShift ? { id: openShift.id, openedAt: openShift.openedAt.toISOString(), openingCash: openShift.openingCash } : null}
      />
    </>
  );
}
