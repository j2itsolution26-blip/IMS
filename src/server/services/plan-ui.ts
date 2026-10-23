import 'server-only';

import { getCurrentUser } from '@/lib/session';
import { FEATURE_LABEL, LIMIT_LABEL, lowestPlanWith, type Feature, type LimitKey } from '@/lib/plans';
import { getStoreContext } from '@/lib/tenant/context';
import { can, withinLimit } from '@/server/services/entitlements';
import type { UpgradeInfo } from '@/features/subscription/upgrade-dialog';

/**
 * What the pages need to show a plan restriction: computed on the server from
 * the same entitlement checks the actions enforce, so the badge and the
 * refusal always agree. Display only; the actions remain the boundary.
 */

async function canManageBilling(): Promise<boolean> {
  const user = await getCurrentUser();
  return Boolean(user?.permissions.has('billing.view'));
}

/** null when the store's plan includes the feature (or there is no store). */
export async function upgradeInfoFor(feature: Feature): Promise<UpgradeInfo | null> {
  const user = await getCurrentUser();
  if (!user?.store) return null;
  const ctx = await getStoreContext();
  if (can(ctx, feature)) return null;
  const plan = lowestPlanWith(feature);
  return {
    title: `${FEATURE_LABEL[feature]} — ${plan ? `${plan.name} plan` : 'not on your plan'}`,
    description: `${FEATURE_LABEL[feature]} are not included in the ${ctx.access.plan.name} plan${plan ? `. They are available on ${plan.name} and above` : ''}.`,
    planName: plan?.name ?? null,
    canManageBilling: await canManageBilling(),
  };
}

export interface CapacityInfo {
  used: number;
  limit: number | null;
  /** null = unlimited */
  remaining: number | null;
  /** Set when nothing more fits. */
  full: UpgradeInfo | null;
}

/** How much of a quota is left, and the dialog to show when it is used up. */
export async function capacityFor(key: LimitKey): Promise<CapacityInfo | null> {
  const user = await getCurrentUser();
  if (!user?.store) return null;
  const ctx = await getStoreContext();
  const check = await withinLimit(ctx, key);
  const remaining = check.limit === null ? null : Math.max(0, check.limit - check.used);
  return {
    used: check.used,
    limit: check.limit,
    remaining,
    full:
      remaining === 0
        ? {
            title: 'Plan limit reached',
            description: `Your ${ctx.access.plan.name} plan allows ${check.limit} ${LIMIT_LABEL[key]}, and all of them are in use. Nothing is deleted when you reach a limit; upgrade, or free a place (for example by archiving or deactivating), to add more.`,
            planName: null,
            canManageBilling: await canManageBilling(),
          }
        : null,
  };
}
