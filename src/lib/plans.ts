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
  /**
   * Most active accounts per built-in staff role (see STAFF_SLOT_ROLES),
   * within the `staff` total; null = no per-role cap. When set, only the
   * built-in staff roles can be held by an active account — a custom role
   * would sidestep the slots. The owner never takes a slot.
   */
  staffSlots: Record<StaffSlotSlug, number> | null;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
  BASIC: {
    id: 'BASIC',
    name: 'Basic',
    description: 'For a single store getting started.',
    limits: { branches: 1, staff: 3, products: 1500, backgroundRemovalsPerMonth: 0 },
    features: { reportExports: false, customRoles: false, backgroundRemoval: false },
    auditHistoryDays: 90,
    // Two cashiers for two shifts, and one for stock.
    staffSlots: { cashier: 2, 'inventory-staff': 1 },
  },
  BUSINESS: {
    id: 'BUSINESS',
    name: 'Business',
    description: 'For growing stores with a team.',
    limits: { branches: 3, staff: 10, products: 5000, backgroundRemovalsPerMonth: 100 },
    features: { reportExports: true, customRoles: true, backgroundRemoval: true },
    auditHistoryDays: 365,
    staffSlots: null,
  },
  ENTERPRISE: {
    id: 'ENTERPRISE',
    name: 'Enterprise',
    description: 'For busy stores with large catalogs and big teams.',
    limits: { branches: 5, staff: null, products: null, backgroundRemovalsPerMonth: 1000 },
    features: { reportExports: true, customRoles: true, backgroundRemoval: true },
    auditHistoryDays: null,
    staffSlots: null,
  },
};

/**
 * The built-in staff roles that take slots on a plan with `staffSlots`
 * (Basic: two Cashiers and one Inventory Staff). Slots follow
 * the role, never its permissions, so they cannot be shuffled by editing a
 * role — and Basic cannot edit role permissions anyway.
 */
export const STAFF_SLOT_ROLES = [
  { slug: 'cashier', name: 'Cashier' },
  { slug: 'inventory-staff', name: 'Inventory Staff' },
] as const;

export type StaffSlotSlug = (typeof STAFF_SLOT_ROLES)[number]['slug'];

export function isStaffSlotRole(slug: string): slug is StaffSlotSlug {
  return STAFF_SLOT_ROLES.some((role) => role.slug === slug);
}

export function staffSlotName(slug: string): string {
  return STAFF_SLOT_ROLES.find((role) => role.slug === slug)?.name ?? slug;
}

/** A role's slot count on a plan; null when the plan has no per-role cap. */
export function staffSlotLimit(plan: Pick<PlanDefinition, 'staffSlots'>, slug: string): number | null {
  if (plan.staffSlots === null) return null;
  return isStaffSlotRole(slug) ? plan.staffSlots[slug] : 0;
}

/** "2 Cashiers, 1 Inventory Staff" */
export function staffSlotSummary(slots: Record<StaffSlotSlug, number>): string {
  return STAFF_SLOT_ROLES.map((role) => {
    const count = slots[role.slug];
    const plural = count !== 1 && !role.name.endsWith('Staff');
    return `${count} ${role.name}${plural ? 's' : ''}`;
  }).join(', ');
}

/** "Your plan allows 2 active Cashier accounts. …" */
export function roleSlotMessage(slug: string, limit: number, holders?: string | string[] | null): string {
  const name = staffSlotName(slug);
  const list = holders == null ? [] : Array.isArray(holders) ? holders : [holders];
  let filled = '';
  if (list.length > 0) {
    filled = limit === 1 ? ` The ${name} slot is already used by ${list[0]}.` : ` All ${limit} ${name} slots are in use (${list.join(', ')}).`;
  }
  return `Your plan allows ${limit} active ${name} account${limit === 1 ? '' : 's'}.${filled} Deactivate one of them, or upgrade to Business for up to 10 staff in any mix of roles.`;
}

export const CUSTOM_ROLE_ON_SLOTS_MESSAGE =
  'On the Basic plan an active staff account must be a Cashier or Inventory Staff. Choose one of those roles, or upgrade to use custom roles.';

/**
 * Account creations allowed per store per hour, on every plan. A guard against
 * scripted abuse, not a plan quota: Enterprise stays unlimited in total.
 */
export const STAFF_CREATIONS_PER_HOUR = 30;

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
  'CSV download of your products and sales',
] as const;

/**
 * Announced but not built. Shown as "Coming soon" and never as capacity.
 * Each branch manages its own stock-in and adjustments; moving stock between
 * branches is a later project.
 */
export const COMING_SOON = ['Stock transfers between branches'] as const;

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
  reportExports: 'Report exports (CSV, Excel, PDF)',
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
  const role = /PLAN_LIMIT: role ([a-z0-9-]+) (\d+)/.exec(message);
  if (role) return roleSlotMessage(role[1], Number(role[2]));
  if (/PLAN_LIMIT: custom-role/.test(message)) return CUSTOM_ROLE_ON_SLOTS_MESSAGE;
  const match = /PLAN_LIMIT: (products|staff|branches) (\d+)/.exec(message);
  if (!match) return null;
  return limitMessage(match[1] as 'products' | 'staff' | 'branches', Number(match[2]));
}
