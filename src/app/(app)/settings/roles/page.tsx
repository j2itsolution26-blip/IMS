import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { storeDb } from '@/lib/tenant/context';
import { ALL_PERMISSIONS, isPlatformPermission } from '@/lib/permissions';
import { accountTier } from '@/server/services/account-policy';
import { PageHeader } from '@/components/page-header';
import { RolesManager, type RoleRow } from '@/features/admin/roles-manager';

export const metadata: Metadata = { title: 'Roles' };
export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const user = await requirePermission('roles.view');
  const db = await storeDb();

  const roles = await db.role.findMany({
    orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      isSystem: true,
      permissions: { select: { permission: { select: { key: true } } } },
      _count: { select: { users: true } },
    },
  });

  // The System Administrator role belongs to the platform, not the store, so
  // it is neither listed nor editable here (the actions refuse it as well).
  const rows: RoleRow[] = roles
    .filter(
      (role) =>
        accountTier({ slug: role.slug, permissions: role.permissions.map((item) => item.permission.key) }) !==
        'platform',
    )
    .map((role) => ({
      id: role.id,
      name: role.name,
      slug: role.slug,
      description: role.description,
      isSystem: role.isSystem,
      userCount: role._count.users,
      permissions: role.permissions.map((item) => item.permission.key),
    }));

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="What each role can see and do. Permissions are enforced on the server for every page and every action."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Roles' }]}
      />
      <RolesManager
        roles={rows}
        ownRoleId={user.role.id}
        // Platform administration is never offered here; a store role that
        // could grant it would be a route back to admin for anyone.
        allPermissions={ALL_PERMISSIONS.filter((p) => !isPlatformPermission(p.key)).map((permission) => ({
          key: permission.key,
          resource: permission.resource,
          action: permission.action,
        }))}
        permissions={{
          canCreate: userCan(user, 'roles.create'),
          canUpdate: userCan(user, 'roles.update'),
          canDelete: userCan(user, 'roles.delete'),
        }}
      />
    </>
  );
}
