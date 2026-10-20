import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { listCategories } from '@/features/catalogue/queries';
import { PageHeader } from '@/components/page-header';
import { CategoriesManager } from '@/features/catalogue/managers';

export const metadata: Metadata = { title: 'Categories' };
export const dynamic = 'force-dynamic';

export default async function CategoriesPage() {
  const user = await requirePermission('categories.view');

  const categories = await listCategories();

  const categoryPermissions = {
    canCreate: userCan(user, 'categories.create'),
    canUpdate: userCan(user, 'categories.update'),
    canDelete: userCan(user, 'categories.delete'),
  };

  return (
    <>
      <PageHeader
        title="Categories"
        description="Groups your products for the POS and reports. You can also add one while creating a product."
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Categories' }]}
      />
      <CategoriesManager rows={categories} permissions={categoryPermissions} />
    </>
  );
}
