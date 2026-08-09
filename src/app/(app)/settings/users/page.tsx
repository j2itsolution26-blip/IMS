import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { PageHeader } from '@/components/page-header';
import { UsersManager, type UserRow } from '@/features/admin/users-manager';

export const metadata: Metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const currentUser = await requirePermission('users.view');

  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        role: { select: { id: true, name: true, slug: true } },
      },
    }),
    prisma.role.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true } }),
  ]);

  const rows: UserRow[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    roleId: user.role.id,
    roleName: user.role.name,
    roleSlug: user.role.slug,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  }));

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts and what each of them can do. Public sign-up is disabled — accounts are created here."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Users' }]}
      />
      <UsersManager
        rows={rows}
        roles={roles}
        currentUserId={currentUser.id}
        permissions={{
          canCreate: userCan(currentUser, 'users.create'),
          canUpdate: userCan(currentUser, 'users.update'),
          canDelete: userCan(currentUser, 'users.delete'),
        }}
      />
    </>
  );
}
