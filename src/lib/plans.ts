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
  /** One line on who the plan is for, shown on the plan cards. */
  description: string;
  limits: Record<LimitKey, number | null>;
  features: Record<Feature, boolean>;
  /** How far back a store can see its audit trail, in days; null = all of it. */
  auditHistoryDays: number | null;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  BASIC: {
    id: 'BASIC',
    name: 'Basic',
    description: 'For a single store getting started.',
    limits: { branches: 1, staff: 2, products: 1500, backgroundRemovalsPerMonth: 0 },
    features: { reportExports: false, customRoles: false, backgroundRemoval: false },
    auditHistoryDays: 90,
  },
  BUSINESS: {
    id: 'BUSINESS',
    name: 'Business',
    description: 'For growing stores with a team.',
    limits: { branches: 1, staff: 10, products: 5000, backgroundRemovalsPerMonth: 100 },
    features: { reportExports: true, customRoles: true, backgroundRemoval: true },
    auditHistoryDays: 365,
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'For busy stores with large catalogs and big teams.',
    limits: { branches: 1, staff: null, products: null, backgroundRemovalsPerMonth: 1000 },
    features: { reportExports: true, customRoles: true, backgroundRemoval: true },
    auditHistoryDays: null,
  },
};

/**
 * The plan a new store's free trial starts on. A trial always follows the
 * plan recorded on the store, so a store the administrator puts on Basic
 * gets Basic's quotas during its trial too (see effectivePlanId).
 */
export const TRIAL_PLAN: PlanId = 'BUSINESS';

/** Days after a trial or paid period ends during which the store still works normally. */
export const GRACE_DAYS = 7;

export const PLAN_ORDER: PlanId[] = ['BASIC', 'BUSINESS', 'ENTERPRISE'];

/**
 * What every plan includes, whatever its limits. Each of these ships today;
 * nothing planned belongs here (see COMING_SOON).
 *
 * Low stock is shown as indicators (sidebar badge, dashboard, report); no
 * notification is sent, so it is not called an alert.
 */
export const CORE_FEATURES = [
  'POS checkout and barcode scanning',
  'Inventory, stock-in and adjustments',
  'Low-stock indicators',
  'Product photos and printable receipts',
  'Cashier shifts and cash reconciliation',
  'Refunds, voids and cash movements',
  'Sales dashboard and standard reports',
] as const;

/**
 * Announced but not built. Shown as "Coming soon" and never as capacity.
 * Every store is one location today: `branches` is 1 on every plan until
 * multi-branch (branch creation, switching, per-branch stock and staff,
 * transfers) ships as its own project.
 */
export const COMING_SOON = ['Multi-branch (more than one location per store)'] as const;

/** Support is the same help desk on every plan. */
export const SUPPORT_LABEL = 'Help desk tickets';

/** The plan below this one, for "Everything in Basic"; null for the first plan. */
export function previousPlan(id: PlanId): PlanDefinition | null {
  const index = PLAN_ORDER.indexOf(id);
  return index > 0 ? PLANS[PLAN_ORDER[index - 1]] : null;
}

/** The cheapest plan that has a feature — for "available on Business" messages. */
export function lowestPlanWith(feature: Feature): PlanDefinition | null {
  for (const id of PLAN_ORDER) if (PLANS[id].features[feature]) return PLANS[id];
  return null;
}

export const FEATURE_LABEL: Record<Feature, string> = {
  reportExports: 'Report exports',
  customRoles: 'Custom roles and permission editing',
  backgroundRemoval: 'Photo background removal',
};

export const LIMIT_LABEL: Record<LimitKey, string> = {
  branches: 'locations',
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
