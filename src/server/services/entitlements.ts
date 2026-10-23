import 'server-only';

import { platformPrisma } from '@/lib/prisma';
import { AppError, FeatureLockedError, PlanLimitError, StoreReadOnlyError } from '@/lib/errors';
import { FEATURE_LABEL, limitMessage, lowestPlanWith, type Feature, type LimitKey } from '@/lib/plans';
import { storedLimits } from '@/lib/store-access';
import { storeParts } from '@/lib/store-time';
import { getStoreContext, type StoreContext } from '@/lib/tenant/context';
import { returnUsageUnit, takeUsageUnit } from '@/server/services/usage-counter';

/**
 * What a store's plan allows, checked on the server in every action and API
 * that uses a paid feature or adds to a quota. Separate from permissions: a
 * permission says whether this person may do it, the plan says whether this
 * store may.
 *
 * The plan comes from the store's row on the server (via the store context),
 * never from the browser. Platform administrators have no store and never
 * reach these checks.
 *
 * Products and staff are also capped by a database trigger
 * (migration 20261025090000), so two requests at once cannot both slip under
 * the limit; the checks here are for a clear message before trying.
 *
 * Platform-client use: `syncStoreLimits` writes the copied quotas onto the
 * store row, which the store-scoped client must not be able to change.
 */

/** Whether the store's current plan includes a feature. */
export function can(ctx: Pick<StoreContext, 'access'>, feature: Feature): boolean {
  return ctx.access.plan.features[feature];
}

function lockedMessage(feature: Feature): string {
  const plan = lowestPlanWith(feature);
  return `${FEATURE_LABEL[feature]} ${plan ? `are available on the ${plan.name} plan` : 'are not available on your plan'}. Upgrade to use them.`;
}

/** Throws unless the signed-in user's store has the feature. */
export async function requireFeature(feature: Feature): Promise<StoreContext> {
  const ctx = await getStoreContext();
  if (!can(ctx, feature)) throw new FeatureLockedError(lockedMessage(feature));
  return ctx;
}

/**
 * For API routes, which answer with a status rather than a thrown error: null
 * if the store has the feature, otherwise the response to send.
 */
export async function featureDenial(feature: Feature): Promise<{ status: number; error: string } | null> {
  try {
    await requireFeature(feature);
    return null;
  } catch (error) {
    if (error instanceof AppError) return { status: error.status, error: error.message };
    throw error;
  }
}

export interface LimitCheck {
  allowed: boolean;
  used: number;
  /** null = unlimited */
  limit: number | null;
}

/** The current-month bucket for metered quotas, in the store's time zone. */
export function usagePeriod(now: Date = new Date()): string {
  const { year, month } = storeParts(now);
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

async function countUsage(ctx: StoreContext, key: LimitKey): Promise<number> {
  switch (key) {
    case 'products':
      return ctx.db.product.count({ where: { status: { not: 'ARCHIVED' } } });
    case 'staff': {
      const store = await ctx.db.store.findUnique({ where: { id: ctx.storeId }, select: { ownerId: true } });
      return ctx.db.user.count({ where: { isActive: true, ...(store?.ownerId ? { id: { not: store.ownerId } } : {}) } });
    }
    case 'branches':
      return ctx.db.warehouse.count();
    case 'backgroundRemovalsPerMonth': {
      const row = await ctx.db.storeUsage.findUnique({
        where: { storeId_metric_period: { storeId: ctx.storeId, metric: 'backgroundRemovals', period: usagePeriod() } },
        select: { count: true },
      });
      return row?.count ?? 0;
    }
  }
}

/** Whether one more of `key` fits in the store's plan. */
export async function withinLimit(ctx: StoreContext, key: LimitKey, adding = 1): Promise<LimitCheck> {
  const limit = ctx.access.plan.limits[key];
  const used = await countUsage(ctx, key);
  return { allowed: limit === null || used + adding <= limit, used, limit };
}

/**
 * Throws if the store is read-only. Database writes are refused by the store
 * client anyway; this is for work that happens outside it first (Better Auth
 * account creation, file uploads, paid API calls).
 */
export async function requireWritable(): Promise<StoreContext> {
  const ctx = await getStoreContext();
  if (!ctx.access.writable) throw new StoreReadOnlyError();
  return ctx;
}

/** Throws unless the store is writable and one more of `key` fits. */
export async function requireWithinLimit(key: LimitKey, adding = 1): Promise<StoreContext> {
  const ctx = await requireWritable();
  const check = await withinLimit(ctx, key, adding);
  if (!check.allowed) throw new PlanLimitError(limitMessage(key, check.limit as number));
  return ctx;
}

/**
 * Takes one unit of a monthly metered quota, atomically: the counter row is
 * incremented only while it is under the limit, in one statement, so parallel
 * requests can never exceed it. Returns a `refund` to give the unit back if
 * the work then fails.
 */
export async function consumeMetered(
  ctx: StoreContext,
  metric: 'backgroundRemovals',
): Promise<{ refund: () => Promise<void> }> {
  if (!ctx.access.writable) throw new StoreReadOnlyError();
  const key: LimitKey = 'backgroundRemovalsPerMonth';
  const limit = ctx.access.plan.limits[key];
  const period = usagePeriod();

  if (!(await takeUsageUnit(ctx.db, ctx.storeId, metric, period, limit))) {
    throw new PlanLimitError(limitMessage(key, limit as number));
  }
  return { refund: () => returnUsageUnit(ctx.db, ctx.storeId, metric, period) };
}

/**
 * The earliest audit entry the store's plan lets it see; null = all of it.
 */
export function auditHistoryStart(ctx: { access: Pick<StoreContext['access'], 'plan'> }, now: Date = new Date()): Date | null {
  const days = ctx.access.plan.auditHistoryDays;
  return days === null ? null : new Date(now.getTime() - days * 86_400_000);
}

/**
 * Copies a store's quotas from the plan configuration onto its row, where the
 * database trigger reads them. Call after anything changes a store's plan or
 * status. Lowering a quota never deletes anything: rows already over it stay,
 * only new ones are refused.
 */
export async function syncStoreLimits(storeId: string): Promise<void> {
  const store = await platformPrisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { plan: true, status: true } });
  await platformPrisma.store.update({ where: { id: storeId }, data: storedLimits(store) });
}
