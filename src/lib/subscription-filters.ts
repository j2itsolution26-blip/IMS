import type { BillingInterval, StorePlan } from '@prisma/client';
import type { BillingFlag, Lifecycle } from './billing';

/**
 * The administrator's subscription filters, over rows built by
 * `loadSubscriptionRows`. Pure, so each filter is unit-tested.
 */

export const SUBSCRIPTION_FILTERS = [
  { value: 'all', label: 'All stores' },
  { value: 'trial', label: 'Active trials' },
  { value: 'trial-ending', label: 'Trials ending soon' },
  { value: 'trial-expired', label: 'Expired trials' },
  { value: 'plan-selected', label: 'Plan selected' },
  { value: 'payment-due', label: 'Payment due' },
  { value: 'pending', label: 'Pending verification' },
  { value: 'paid', label: 'Paid active' },
  { value: 'past-due', label: 'Past due' },
  { value: 'grace', label: 'Grace period' },
  { value: 'suspended', label: 'Suspended' },
] as const;

export type SubscriptionFilter = (typeof SUBSCRIPTION_FILTERS)[number]['value'];

export interface SubscriptionRow {
  storeId: string;
  storeName: string;
  owner: { name: string; username: string; email: string; phone: string | null } | null;
  plan: StorePlan;
  lifecycle: Lifecycle;
  billing: BillingFlag | null;
  grace: boolean;
  readOnly: boolean;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  openInvoice: {
    id: string;
    number: string;
    plan: StorePlan;
    interval: BillingInterval;
    amount: number;
    currency: string;
    dueAt: Date;
  } | null;
  pendingPaymentId: string | null;
  lastVerifiedPayment: { at: Date; amount: number } | null;
  lastPaymentStatus: 'PENDING' | 'VERIFIED' | 'REJECTED' | null;
}

export function matchesFilter(row: SubscriptionRow, filter: SubscriptionFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'trial':
      return row.lifecycle === 'TRIAL' || row.lifecycle === 'TRIAL_ENDING_SOON';
    case 'trial-ending':
      return row.lifecycle === 'TRIAL_ENDING_SOON';
    case 'trial-expired':
      return row.lifecycle === 'TRIAL_EXPIRED';
    case 'plan-selected':
      return row.billing === 'PLAN_SELECTED';
    case 'payment-due':
      return row.billing === 'PAYMENT_DUE';
    case 'pending':
      return row.billing === 'PAYMENT_PENDING';
    case 'paid':
      return row.lifecycle === 'ACTIVE_PAID';
    case 'past-due':
      return row.billing === 'PAST_DUE';
    case 'grace':
      return row.grace;
    case 'suspended':
      return row.lifecycle === 'SUSPENDED';
  }
}

export function countByFilter(rows: SubscriptionRow[]): Record<SubscriptionFilter, number> {
  return Object.fromEntries(
    SUBSCRIPTION_FILTERS.map(({ value }) => [value, rows.filter((row) => matchesFilter(row, value)).length]),
  ) as Record<SubscriptionFilter, number>;
}

export function filterRows(rows: SubscriptionRow[], filter: SubscriptionFilter, search: string): SubscriptionRow[] {
  const term = search.trim().toLowerCase();
  return rows.filter((row) => {
    if (!matchesFilter(row, filter)) return false;
    if (!term) return true;
    return [row.storeName, row.owner?.name, row.owner?.username, row.owner?.email, row.openInvoice?.number]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(term));
  });
}

