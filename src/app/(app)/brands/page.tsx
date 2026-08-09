import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { listBrands } from '@/features/catalogue/queries';
import { BrandsManager } from '@/features/catalogue/managers';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Brands' };
export const dynamic = 'force-dynamic';

export default async function BrandsPage() {
  const user = await requirePermission('brands.view');
  const rows = await listBrands();

  return (
    <>
      <PageHeader
        title="Brands"
        description="Optional. Assigning brands lets you break revenue down by manufacturer."
      />
      <BrandsManager
        rows={rows}
        permissions={{
          canCreate: userCan(user, 'brands.create'),
          canUpdate: userCan(user, 'brands.update'),
          canDelete: userCan(user, 'brands.delete'),
        }}
      />
    </>
  );
}
