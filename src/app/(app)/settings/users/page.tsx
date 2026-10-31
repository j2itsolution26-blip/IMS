import type { Metadata } from 'next';
import { requirePermission, userCan } from '@/lib/session';
import { getStoreContext } from '@/lib/tenant/context';
import { auditWindowWhere } from '@/server/services/audit-queries';
import { OWNER_ROLE_SLUG } from '@/lib/permissions';
import { STORE_ACCOUNT_WHERE, canAssignRole, canManageAccount } from '@/server/services/account-policy';
import { PageHeader } from '@/components/page-header';
import { StaffAccountsManager, type StaffRow } from '@/features/admin/staff-accounts-manager';
import { CapacityNotice } from '@/features/subscription/capacity-notice';
import { capacityFor } from '@/server/services/plan-ui';
import { shiftReference } from '@/lib/shift-review';

export const metadata: Metadata = { title: 'Staff Accounts' };
export const dynamic = 'force-dynamic';

const ROLE_SELECT = {
  id: true,
  name: true,
  slug: true,
  permissions: { select: { permission: { select: { key: true } } } },
} as const;

const toPolicyRole = (role: { slug: string; permissions: { permission: { key: string } }[] }) => ({
  slug: role.slug,
  permissions: role.permissions.map((item) => item.permission.key),
});

export default async function StaffAccountsPage() {
  const currentUser = await requirePermission('users.view');
  const ctx = await getStoreContext();
  const { db } = ctx;

  // Scoped in the query, not filtered afterwards: platform accounts never
  // leave the database for a store screen.
  const [users, roles] = await Promise.all([
    db.user.findMany({
      where: STORE_ACCOUNT_WHERE,
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        phone: true,
        isActive: true,
        role: { select: ROLE_SELECT },
      },
    }),
    db.role.findMany({ orderBy: { name: 'asc' }, select: ROLE_SELECT }),
  ]);

  // Open drawers and the latest Deactivated / Reactivated entry per account,
  // so the owner sees what a status change affects and who last made one.
  const ids = users.map((user) => user.id);
  const [openShifts, statusEntries] = await Promise.all([
    db.cashierShift.findMany({ where: { status: 'OPEN', userId: { in: ids } }, select: { id: true, number: true, userId: true, openedAt: true } }),
    db.auditLog.findMany({
      where: {
        // The plan's audit history window, as on every store audit screen.
        ...auditWindowWhere(ctx),
        entity: 'User',
        entityId: { in: ids },
        OR: [{ summary: { startsWith: 'Deactivated ' } }, { summary: { startsWith: 'Reactivated ' } }],
      },
      orderBy: { createdAt: 'desc' },
      select: { entityId: true, summary: true, createdAt: true, user: { select: { name: true } } },
    }),
  ]);
  const openShiftOf = new Map(openShifts.map((shift) => [shift.userId, shift]));
  const lastStatusOf = new Map<string, (typeof statusEntries)[number]>();
  for (const entry of statusEntries) if (entry.entityId && !lastStatusOf.has(entry.entityId)) lastStatusOf.set(entry.entityId, entry);

  const actor = {
    id: currentUser.id,
    role: { slug: currentUser.role.slug, permissions: currentUser.permissions },
  };
  const canUpdate = userCan(currentUser, 'users.update');
  const canDelete = userCan(currentUser, 'users.delete');

  // The menu shows exactly what the server actions will accept, from the same
  // policy — so a hidden item is never the only thing standing in the way.
  const rows: StaffRow[] = users.map((user) => {
    const subject = { id: user.id, role: toPolicyRole(user.role) };
    const may = (operation: Parameters<typeof canManageAccount>[2]) =>
      canManageAccount(actor, subject, operation).allowed;

    return {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      phone: user.phone,
      roleId: user.role.id,
      roleName: user.role.name,
      isOwner: user.role.slug === OWNER_ROLE_SLUG,
      isActive: user.isActive,
      openShift: (() => {
        const shift = openShiftOf.get(user.id);
        return shift ? { id: shift.id, reference: shiftReference(shift.number), openedAt: shift.openedAt.toISOString() } : null;
      })(),
      lastStatusChange: (() => {
        const entry = lastStatusOf.get(user.id);
        return entry ? { summary: entry.summary, at: entry.createdAt.toISOString(), by: entry.user?.name ?? null } : null;
      })(),
      actions: {
        edit: canUpdate && may('edit'),
        changeRole: canUpdate && may('changeRole'),
        changeStatus: canUpdate && may('changeStatus'),
        resetPassword: canUpdate && may('resetPassword'),
        remove: canDelete && may('delete'),
      },
    };
  });

  // Owner and administrator roles are never assignable here, and delegated
  // staff only see roles no broader than their own.
  const assignableRoles = roles
    .filter((role) => canAssignRole(actor, toPolicyRole(role)).allowed)
    .map((role) => ({ id: role.id, name: role.name }));

  return (
    <>
      <PageHeader
        title="Staff Accounts"
        description="Manage the people who use your store system."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Staff Accounts' }]}
      />
      {userCan(currentUser, 'users.create') && <CapacityNotice capacity={await capacityFor('staff')} noun="active staff accounts" />}
      <StaffAccountsManager
        rows={rows}
        roles={assignableRoles}
        currentUserId={currentUser.id}
        permissions={{
          canCreate: userCan(currentUser, 'users.create'),
          canUpdate,
          canDelete,
        }}
      />
    </>
  );
}
