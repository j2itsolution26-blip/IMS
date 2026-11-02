import type { Metadata } from 'next';
import { PLAN_ORDER } from '@/lib/plans';
import { requirePermission, userCan } from '@/lib/session';
import { getStoreContext } from '@/lib/tenant/context';
import { PageHeader } from '@/components/page-header';
import { isStoreOwner } from '@/server/platform/billing-service';
import { listBranches, staffPerBranch } from '@/server/services/branch-service';
import { BranchesManager } from '@/features/branches/branches-manager';

export const metadata: Metadata = { title: 'Branches' };
export const dynamic = 'force-dynamic';

/**
 * Settings → Branches: the store's physical locations. Anyone with
 * branches.view sees the list; only the owner account (with branches.manage)
 * changes it, and the server actions check that again.
 */
export default async function BranchesPage() {
  const user = await requirePermission('branches.view');
  const ctx = await getStoreContext();
  const [branches, staff] = await Promise.all([listBranches(ctx), staffPerBranch(ctx)]);
  const canManage = userCan(user, 'branches.manage') && (await isStoreOwner(user.id, ctx.storeId));
  const plan = ctx.access.plan;

  return (
    <div>
      <PageHeader
        title="Branches"
        description="Each branch is one physical store. Stock, sales and shifts belong to the branch where they happen."
        breadcrumbs={[{ label: 'Settings', href: '/settings' }, { label: 'Branches' }]}
      />
      <BranchesManager
        branches={branches.map((branch) => ({ ...branch, createdAt: branch.createdAt.toISOString(), staff: staff.get(branch.id) ?? 0 }))}
        limit={plan.limits.branches}
        planName={plan.name}
        canManage={canManage && ctx.access.writable}
        canUpgrade={userCan(user, 'billing.view') && PLAN_ORDER.indexOf(plan.id) < PLAN_ORDER.length - 1}
      />
    </div>
  );
}
