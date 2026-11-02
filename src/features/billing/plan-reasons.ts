import { PLANS, type PlanId } from '@/lib/plans';
import { formatNumber } from '@/lib/format';

/**
 * "Why choose this plan?" copy for the pricing cards. Every number comes from
 * lib/plans, so the explanation can never promise more than the plan allows.
 * Anything not built yet (more than one location) is marked `soon` and shown
 * as "Coming soon", never as something the plan includes today.
 */

export interface PlanBenefit {
  text: string;
  /** Announced, not built: shown with a "Coming soon" label. */
  soon?: boolean;
}

export interface PlanReason {
  headline: string;
  summary: string;
  benefits: PlanBenefit[];
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "two", "ten", "1,500": words for small counts, read the way an owner would say them. */
function count(value: number): string {
  return value <= 10 ? WORDS[value] : formatNumber(value, 0);
}

function plural(value: number, one: string, many: string): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/** "Up to three locations", or "One store location" when the plan has just one. */
function locations(value: number): string {
  return value === 1 ? 'One store location' : `Up to ${plural(value, 'location', 'locations')}`;
}

function staff(value: number | null): string {
  return value === null ? 'Unlimited staff accounts' : `Up to ${plural(value, 'staff account', 'staff accounts')}`;
}

function products(value: number | null): string {
  return value === null ? 'Unlimited products under the existing system rules' : `Up to ${formatNumber(value, 0)} products`;
}

function auditHistory(days: number | null): string {
  return days === null ? 'Full audit history' : `${formatNumber(days, 0)}-day audit history`;
}

export function planReason(id: PlanId): PlanReason {
  const plan = PLANS[id];
  const { staff: staffLimit, products: productLimit, backgroundRemovalsPerMonth: removals } = plan.limits;
  const moreLocationsSoon = plan.limits.branches !== null && plan.plannedBranches > plan.limits.branches;
  const locationBenefit: PlanBenefit = { text: locations(plan.plannedBranches), soon: moreLocationsSoon };
  const removalsBenefit: PlanBenefit[] =
    plan.features.backgroundRemoval && removals ? [{ text: `Up to ${formatNumber(removals, 0)} photo background removals per month` }] : [];
  const exportsBenefit: PlanBenefit[] = plan.features.reportExports ? [{ text: 'Report exports (CSV, Excel, PDF)' }] : [];
  const rolesBenefit: PlanBenefit[] = plan.features.customRoles ? [{ text: 'Custom roles and permissions' }] : [];
  const soonNote = moreLocationsSoon
    ? ` Support for ${locations(plan.plannedBranches).toLowerCase()} is coming soon to this plan; today every store has one location.`
    : '';

  switch (id) {
    case 'BASIC':
      return {
        headline: 'Best for small stores starting with digital POS and inventory management.',
        summary:
          `Choose ${plan.name} if you operate one store and want an affordable way to manage sales, inventory, barcode scanning, receipts and cashier shifts. ` +
          `It includes ${locations(plan.plannedBranches).toLowerCase()}, ${staff(staffLimit).toLowerCase()} and ${products(productLimit).toLowerCase()}, ` +
          'without paying for advanced features you do not need yet.',
        benefits: [
          { text: 'Affordable starting price' },
          { text: 'Essential POS and inventory features' },
          locationBenefit,
          { text: 'Suitable for small retail shops and sari-sari stores' },
        ],
      };
    case 'BUSINESS':
      return {
        headline: 'Best for growing businesses that need a bigger team and more control.',
        summary:
          `Choose ${plan.name} if your business is expanding. It gives you ${staff(staffLimit).toLowerCase()}, ${products(productLimit).toLowerCase()}, ` +
          `report exports, custom roles and permissions, and a ${auditHistory(plan.auditHistoryDays).toLowerCase()} to help you run a growing operation.` +
          soonNote,
        benefits: [locationBenefit, { text: staff(staffLimit) }, { text: products(productLimit) }, ...removalsBenefit, ...exportsBenefit, ...rolesBenefit, { text: auditHistory(plan.auditHistoryDays) }],
      };
    case 'ENTERPRISE':
      return {
        headline: 'Best for established businesses that need more capacity and centralized control.',
        summary:
          `Choose ${plan.name} if you manage a large retail team or a big catalog. It has ${staff(staffLimit).toLowerCase()} and ${products(productLimit).toLowerCase()}, ` +
          `with ${auditHistory(plan.auditHistoryDays).toLowerCase()} and report exports.` +
          soonNote,
        benefits: [
          locationBenefit,
          { text: staff(staffLimit) },
          { text: products(productLimit) },
          ...removalsBenefit,
          { text: auditHistory(plan.auditHistoryDays) },
          ...exportsBenefit,
          ...(moreLocationsSoon ? [{ text: 'Centralized multi-branch management', soon: true }] : []),
        ],
      };
  }
}
