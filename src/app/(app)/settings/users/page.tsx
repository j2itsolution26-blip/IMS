import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { OWNER_ROLE_SLUG } from '@/lib/permissions';
import { PageHeader } from '@/components/page-header';
import { StaffAccountsManager, type StaffRow } from '@/features/admin/staff-accounts-manager';

export const metadata: Metadata = { title: 'Staff Accounts' };
export const dynamic = 'force-dynamic';

export default async function StaffAccountsPage() {
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
        role: { select: { id: true, name: true, slug: true } },
      },
    }),
    prisma.role.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true } }),
  ]);

  const rows: StaffRow[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    roleId: user.role.id,
    roleName: user.role.name,
    isOwner: user.role.slug === OWNER_ROLE_SLUG,
    isActive: user.isActive,
  }));

  // Owner is established once, during first-run setup, so it is never an
  // option when adding or editing a staff account.
  const assignableRoles = roles
    .filter((role) => role.slug !== OWNER_ROLE_SLUG)
    .map((role) => ({ id: role.id, name: role.name }));

  return (
    <>
      <PageHeader
        title="Staff Accounts"
        description="Manage the people who use your store system."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Staff Accounts' }]}
      />
      <StaffAccountsManager
        rows={rows}
        roles={assignableRoles}
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
