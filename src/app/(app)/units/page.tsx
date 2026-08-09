import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { listUnits } from '@/features/catalogue/queries';
import { UnitsManager } from '@/features/catalogue/managers';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Units' };
export const dynamic = 'force-dynamic';

export default async function UnitsPage() {
  const user = await requirePermission('units.view');
  const rows = await listUnits();

  return (
    <>
      <PageHeader
        title="Units of measure"
        description="How each product is counted. Fractional units let you stock things sold by weight or volume."
      />
      <UnitsManager
        rows={rows}
        permissions={{
          canCreate: userCan(user, 'units.create'),
          canUpdate: userCan(user, 'units.update'),
          canDelete: userCan(user, 'units.delete'),
        }}
      />
    </>
  );
}
