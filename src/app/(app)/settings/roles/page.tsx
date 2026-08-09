import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { ALL_PERMISSIONS } from '@/lib/permissions';
import { PageHeader } from '@/components/page-header';
import { RolesManager, type RoleRow } from '@/features/admin/roles-manager';

export const metadata: Metadata = { title: 'Roles' };
export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const user = await requirePermission('roles.view');

  const roles = await prisma.role.findMany({
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

  const rows: RoleRow[] = roles.map((role) => ({
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
        allPermissions={ALL_PERMISSIONS.map((permission) => ({
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
