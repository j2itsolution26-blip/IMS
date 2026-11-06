import { FEATURE_LABEL, PLANS, previousPlan, staffSlotSummary, type Feature, type PlanDefinition, type PlanId } from '@/lib/plans';
import { formatNumber } from '@/lib/format';

/**
 * "Why Basic?" / "Why Business?" / "Why Enterprise?" copy for the pricing
 * cards. Every number comes from lib/plans, so the explanation can never
 * promise more than the plan allows. Anything announced but not built is
 * marked `soon` and shown as "Coming soon", never as included today.
 */

export interface PlanBenefit {
  text: string;
  /** Announced, not built: shown with a "Coming soon" label. */
  soon?: boolean;
}

export interface PlanReason {
  /** Who the plan is for, in one sentence. */
  headline: string;
  /** The plan's locations, said plainly ("Only one physical store location is included."). */
  locationNote: string;
  /** What the plan allows: locations, staff, products, history. */
  limits: PlanBenefit[];
  /** The day-to-day benefits. */
  benefits: PlanBenefit[];
  /** What it adds over the plan below; null for the first plan. */
  versus: { name: string; gains: string[] } | null;
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "two", "ten", "1,500": words for small counts, read the way an owner would say them. */
function count(value: number): string {
  return value <= 10 ? WORDS[value] : formatNumber(value, 0);
}

function plural(value: number, one: string, many: string): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/** "Up to three store locations", or "One store location". */
export function locationsText(value: number | null): string {
  if (value === null) return 'Unlimited store locations';
  return value === 1 ? 'One store location' : `Up to ${plural(value, 'store location', 'store locations')}`;
}

function staffText(value: number | null): string {
  return value === null ? 'Unlimited staff accounts' : `Up to ${plural(value, 'staff account', 'staff accounts')}`;
}

function productsText(value: number | null): string {
  return value === null ? 'Unlimited products' : `Up to ${formatNumber(value, 0)} products`;
}

function historyText(days: number | null): string {
  return days === null ? 'Full activity history' : `${formatNumber(days, 0)}-day activity history`;
}

const FEATURES: Feature[] = ['reportExports', 'customRoles', 'backgroundRemoval'];

/** What `plan` adds over `lower`, from the two configurations; nothing is claimed that the numbers do not show. */
export function gainsOver(plan: PlanDefinition, lower: PlanDefinition): string[] {
  const gains: string[] = [];
  const { branches: b, staff: s, products: p } = plan.limits;
  const { branches: lb, staff: ls, products: lp } = lower.limits;
  if (b === null && lb !== null) gains.push('Unlimited store locations');
  else if (b !== null && lb !== null && b > lb) {
    const more = plural(b - lb, 'more store location', 'more store locations');
    gains.push(`${more.charAt(0).toUpperCase()}${more.slice(1)} (${count(b)} instead of ${count(lb)})`);
  }
  if (s === null && ls !== null) gains.push(`Unlimited staff accounts (instead of ${count(ls)})`);
  else if (s !== null && ls !== null && s > ls) gains.push(`Up to ${count(s)} staff accounts (instead of ${count(ls)})`);
  if (plan.staffSlots === null && lower.staffSlots !== null) gains.push('Staff in any mix of roles');
  if (p === null && lp !== null) gains.push(`Unlimited products (instead of ${formatNumber(lp, 0)})`);
  else if (p !== null && lp !== null && p > lp) gains.push(`Up to ${formatNumber(p, 0)} products (instead of ${formatNumber(lp, 0)})`);
  for (const feature of FEATURES) if (plan.features[feature] && !lower.features[feature]) gains.push(FEATURE_LABEL[feature]);
  const removals = plan.limits.backgroundRemovalsPerMonth;
  const lowerRemovals = lower.limits.backgroundRemovalsPerMonth;
  if (lower.features.backgroundRemoval && removals !== null && lowerRemovals !== null && removals > lowerRemovals) {
    gains.push(`Up to ${formatNumber(removals, 0)} photo background removals a month (instead of ${formatNumber(lowerRemovals, 0)})`);
  }
  if (plan.auditHistoryDays !== lower.auditHistoryDays) gains.push(historyText(plan.auditHistoryDays));
  return gains;
}

const HEADLINE: Record<PlanId, string> = {
  BASIC:
    'Best for a single sari-sari store that needs reliable checkout, inventory tracking, and daily sales monitoring without paying for multi-location features.',
  BUSINESS:
    'Best for growing retailers who operate multiple stores and need to monitor sales, inventory, staff activity, and cash reconciliation from one owner account.',
  ENTERPRISE:
    'Best for retailers operating several physical stores who need greater operational capacity, centralized oversight, and stronger accountability across locations.',
};

export function planReason(id: PlanId): PlanReason {
  const plan = PLANS[id];
  const { branches, staff, products } = plan.limits;
  const multiBranch = branches === null || branches > 1;
  const lower = previousPlan(id);

  const benefits: PlanBenefit[] = [
    { text: 'POS checkout with barcode scanning and printable receipts' },
    { text: 'Inventory, stock-in and adjustments with low-stock indicators' },
    { text: 'Cashier shifts and cash reconciliation' },
    ...(multiBranch
      ? [{ text: 'Owner dashboard, sales and reports for each branch, or for all branches together' }]
      : [{ text: 'Sales dashboard and standard reports' }]),
    ...(plan.features.reportExports ? [{ text: FEATURE_LABEL.reportExports }] : []),
    ...(plan.features.customRoles ? [{ text: 'Custom roles and permissions' }] : []),
  ];

  return {
    headline: HEADLINE[id],
    locationNote:
      branches === 1
        ? 'Only one physical store location is included.'
        : branches === null
          ? 'Any number of physical store locations.'
          : `Up to ${count(branches)} physical store locations — a location is a store or branch, not a device.`,
    limits: [
      { text: locationsText(branches) },
      { text: plan.staffSlots ? `${staffText(staff)} (${staffSlotSummary(plan.staffSlots)})` : staffText(staff) },
      { text: productsText(products) },
      { text: historyText(plan.auditHistoryDays) },
    ],
    benefits,
    versus: lower ? { name: lower.name, gains: gainsOver(plan, lower) } : null,
  };
}
