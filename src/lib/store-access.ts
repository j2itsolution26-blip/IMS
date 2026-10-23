import { GRACE_DAYS, PLANS, TRIAL_PLAN, type PlanDefinition, type PlanId } from './plans';

/**
 * What a store may do right now, from its subscription fields and the
 * server's clock — never the browser's.
 *
 *   ACTIVE     paid (or no end date): everything its plan allows
 *   TRIAL      trial not yet over: the trial plan's features
 *   GRACE      up to GRACE_DAYS after the trial or paid period ended (or
 *              PAST_DUE): still works normally, with a warning
 *   READ_ONLY  after the grace period: sign in, view and export only
 *   SUSPENDED  shut out entirely (handled by the store context)
 *
 * Pure, so every boundary is unit-tested.
 */

export type AccessState = 'ACTIVE' | 'TRIAL' | 'GRACE' | 'READ_ONLY' | 'SUSPENDED';

export interface StoreSubscription {
  plan: PlanId;
  status: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED';
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

export interface StoreAccess {
  state: AccessState;
  /** The plan whose features and quotas apply now (the trial plan during a trial). */
  plan: PlanDefinition;
  /** Whether ordinary business writes are allowed. */
  writable: boolean;
  /** When the trial or paid period ends / ended; null if it never does. */
  endsAt: Date | null;
  /** When the store becomes read-only; set while in GRACE. */
  graceEndsAt: Date | null;
}

const DAY = 86_400_000;

/** The plan whose rules apply: a trial uses the trial plan, never less than what was bought. */
export function effectivePlanId(subscription: Pick<StoreSubscription, 'plan' | 'status'>): PlanId {
  if (subscription.status !== 'TRIAL') return subscription.plan;
  const order: PlanId[] = ['BASIC', 'BUSINESS', 'ENTERPRISE'];
  return order.indexOf(subscription.plan) > order.indexOf(TRIAL_PLAN) ? subscription.plan : TRIAL_PLAN;
}

export function storeAccess(subscription: StoreSubscription, now: Date = new Date()): StoreAccess {
  const plan = PLANS[effectivePlanId(subscription)];

  if (subscription.status === 'SUSPENDED') {
    return { state: 'SUSPENDED', plan, writable: false, endsAt: subscription.currentPeriodEnd, graceEndsAt: null };
  }

  const endsAt = subscription.status === 'TRIAL' ? subscription.trialEndsAt : subscription.currentPeriodEnd;

  // Past due with no date to count the grace period from: nothing is left to wait for.
  if (subscription.status === 'PAST_DUE' && !endsAt) {
    return { state: 'READ_ONLY', plan, writable: false, endsAt: null, graceEndsAt: null };
  }

  const ended = subscription.status === 'PAST_DUE' || (endsAt !== null && now.getTime() >= endsAt.getTime());
  if (!ended) {
    return { state: subscription.status === 'TRIAL' ? 'TRIAL' : 'ACTIVE', plan, writable: true, endsAt, graceEndsAt: null };
  }

  const graceEndsAt = new Date((endsAt as Date).getTime() + GRACE_DAYS * DAY);
  if (now.getTime() < graceEndsAt.getTime()) {
    return { state: 'GRACE', plan, writable: true, endsAt, graceEndsAt };
  }
  return { state: 'READ_ONLY', plan, writable: false, endsAt, graceEndsAt };
}

/** The quotas to copy onto the store row for the database trigger. */
export function storedLimits(subscription: Pick<StoreSubscription, 'plan' | 'status'>): { productLimit: number | null; staffLimit: number | null } {
  const plan = PLANS[effectivePlanId(subscription)];
  return { productLimit: plan.limits.products, staffLimit: plan.limits.staff };
}
