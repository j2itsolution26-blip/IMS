import type { Metadata } from 'next';
import { PLAN_ORDER } from '@/lib/plans';
import { requirePermission, userCan } from '@/lib/session';
import { getStoreContext } from '@/lib/tenant/context';
import { getBranchScope } from '@/lib/tenant/branch';
import { isStoreOwner } from '@/server/platform/billing-service';
import { listBranches } from '@/server/services/branch-service';
import { STORE_ACCOUNT_WHERE } from '@/server/services/account-policy';
import { BranchesManager } from '@/features/branches/branches-manager';
import { rankBranches } from '@/lib/branch-choice';
import { parseBranchParams } from '@/lib/branch-list';

export const metadata: Metadata = { title: 'Branch Management' };
export const dynamic = 'force-dynamic';

/**
 * Settings → Branches: the store's physical locations. Anyone with
 * branches.view sees the branches their account may see (staff: their own);
 * only the owner account (with branches.manage) changes them, and the server
 * actions check that again. Every figure comes from the store-scoped client,
 * so nothing from another store can appear.
 */
export default async function BranchesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission('branches.view');
  const ctx = await getStoreContext();
  const [all, scope, isOwner] = await Promise.all([listBranches(ctx), getBranchScope(), isStoreOwner(user.id, ctx.storeId)]);
  const plan = ctx.access.plan;

  // The plan counts every active branch in the store, whoever is looking.
  const activeInStore = all.filter((branch) => branch.isActive);
  // After a downgrade, active branches past the limit are restricted: the
  // main branch and the oldest stay usable (src/lib/branch-choice.ts).
  const restricted = new Set(
    rankBranches(activeInStore, plan.limits.branches)
      .filter((branch) => branch.restricted)
      .map((branch) => branch.id),
  );

  // Staff held to one branch see only that one.
  const visible = scope.visibleIds ? all.filter((branch) => scope.visibleIds!.includes(branch.id)) : all;
  const ids = visible.map((branch) => branch.id);

  const [staff, lastSales] = await Promise.all([
    ctx.db.user.findMany({
      where: { AND: [STORE_ACCOUNT_WHERE, { isActive: true, warehouseId: { in: ids } }] },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, username: true, warehouseId: true, role: { select: { name: true } } },
    }),
    ctx.db.sale.groupBy({ by: ['warehouseId'], where: { warehouseId: { in: ids } }, _max: { createdAt: true } }),
  ]);
  const lastSaleOf = new Map(lastSales.map((row) => [row.warehouseId, row._max.createdAt?.toISOString() ?? null]));

  const canManage = userCan(user, 'branches.manage') && isOwner;

  return (
    <BranchesManager
      branches={visible.map((branch) => ({
        ...branch,
        createdAt: branch.createdAt.toISOString(),
        lastSaleAt: lastSaleOf.get(branch.id) ?? null,
        restricted: restricted.has(branch.id),
      }))}
      staff={staff.map((member) => ({ id: member.id, name: member.name, username: member.username, roleName: member.role.name, branchId: member.warehouseId as string }))}
      activeInStore={activeInStore.length}
      limit={plan.limits.branches}
      planName={plan.name}
      canManage={canManage}
      writable={ctx.access.writable}
      canUpgrade={userCan(user, 'billing.view') && PLAN_ORDER.indexOf(plan.id) < PLAN_ORDER.length - 1}
      canManageStaff={userCan(user, 'users.view')}
      initialParams={parseBranchParams(await searchParams)}
    />
  );
}
