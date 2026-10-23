/**
 * The subscription plans: what each one allows. This is the only place the
 * numbers live; everything else asks `can` / `withinLimit` in
 * src/server/services/entitlements.ts.
 *
 * Pure (no server imports), so the rules are unit-tested directly and the
 * subscription screen can show them.
 */

export type PlanId = 'BASIC' | 'BUSINESS' | 'ENTERPRISE';

/** On/off features. */
export type Feature = 'reportExports' | 'customRoles' | 'backgroundRemoval';

/** Countable quotas. `null` means unlimited. */
export type LimitKey = 'branches' | 'staff' | 'products' | 'backgroundRemovalsPerMonth';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  limits: Record<LimitKey, number | null>;
  features: Record<Feature, boolean>;
  /** How far back a store can see its audit trail, in days; null = all of it. */
  auditHistoryDays: number | null;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  BASIC: {
    id: 'BASIC',
    name: 'Basic',
    limits: { branches: 1, staff: 3, products: 500, backgroundRemovalsPerMonth: 0 },
    features: { reportExports: false, customRoles: false, backgroundRemoval: false },
    auditHistoryDays: 90,
  },
  BUSINESS: {
    id: 'BUSINESS',
    name: 'Business',
    limits: { branches: 3, staff: 15, products: 5000, backgroundRemovalsPerMonth: 100 },
    features: { reportExports: true, customRoles: true, backgroundRemoval: true },
    auditHistoryDays: 365,
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    limits: { branches: 10, staff: null, products: null, backgroundRemovalsPerMonth: 1000 },
    features: { reportExports: true, customRoles: true, backgroundRemoval: true },
    auditHistoryDays: null,
  },
};

/** A trial gets this plan's features while it lasts. */
export const TRIAL_PLAN: PlanId = 'BUSINESS';

/** Days after a trial or paid period ends during which the store still works normally. */
export const GRACE_DAYS = 7;

export const PLAN_ORDER: PlanId[] = ['BASIC', 'BUSINESS', 'ENTERPRISE'];

/** The cheapest plan that has a feature — for "available on Business" messages. */
export function lowestPlanWith(feature: Feature): PlanDefinition | null {
  for (const id of PLAN_ORDER) if (PLANS[id].features[feature]) return PLANS[id];
  return null;
}

export const FEATURE_LABEL: Record<Feature, string> = {
  reportExports: 'Report exports',
  customRoles: 'Custom roles',
  backgroundRemoval: 'Photo background removal',
};

export const LIMIT_LABEL: Record<LimitKey, string> = {
  branches: 'branches',
  staff: 'active staff accounts',
  products: 'products (archived ones do not count)',
  backgroundRemovalsPerMonth: 'background removals this month',
};

export function limitMessage(key: LimitKey, limit: number): string {
  return `Your plan allows ${limit} ${LIMIT_LABEL[key]}. Upgrade your plan to add more.`;
}

/**
 * The message for a quota the database trigger refused ("PLAN_LIMIT: products
 * 500"), or null if the error is something else.
 */
export function planLimitFromDatabase(message: string): string | null {
  const match = /PLAN_LIMIT: (products|staff) (\d+)/.exec(message);
  if (!match) return null;
  return limitMessage(match[1] as 'products' | 'staff', Number(match[2]));
}
