import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { listCategories, listUnits } from '@/features/catalogue/queries';
import { PageHeader } from '@/components/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';
import { CategoriesManager, UnitsManager } from '@/features/catalogue/managers';

export const metadata: Metadata = { title: 'Categories & units' };
export const dynamic = 'force-dynamic';

export default async function CategoriesAndUnitsPage() {
  const user = await requirePermission('categories.view');

  const [categories, units] = await Promise.all([listCategories(), listUnits()]);

  const categoryPermissions = {
    canCreate: userCan(user, 'categories.create'),
    canUpdate: userCan(user, 'categories.update'),
    canDelete: userCan(user, 'categories.delete'),
  };
  const unitPermissions = {
    canCreate: userCan(user, 'units.create'),
    canUpdate: userCan(user, 'units.update'),
    canDelete: userCan(user, 'units.delete'),
  };

  return (
    <>
      <PageHeader
        title="Categories & units"
        description="Reference lists used across the catalogue. You can also add one inline while creating a product."
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Categories & units' }]}
      />

      <Tabs defaultValue="categories">
        <TabsList>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
        </TabsList>
        <TabsContent value="categories" className="mt-4">
          <CategoriesManager rows={categories} permissions={categoryPermissions} />
        </TabsContent>
        <TabsContent value="units" className="mt-4">
          <UnitsManager rows={units} permissions={unitPermissions} />
        </TabsContent>
      </Tabs>
    </>
  );
}
