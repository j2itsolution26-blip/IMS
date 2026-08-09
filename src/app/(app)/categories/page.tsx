import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { listCategories } from '@/features/catalogue/queries';
import { CategoriesManager } from '@/features/catalogue/managers';
import { PageHeader } from '@/components/page-header';

export const metadata: Metadata = { title: 'Categories' };
export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const user = await requirePermission('categories.view');
  const rows = await listCategories();

  return (
    <>
      <PageHeader
        title="Categories"
        description="Group products so the POS, stock reports, and sales analysis stay organised."
      />
      <CategoriesManager
        rows={rows}
        permissions={{
          canCreate: userCan(user, 'categories.create'),
          canUpdate: userCan(user, 'categories.update'),
          canDelete: userCan(user, 'categories.delete'),
        }}
      />
    </>
  );
}
