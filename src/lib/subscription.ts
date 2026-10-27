import { TRIAL_PLAN, type PlanId } from './plans';
import type { AccessState, StoreAccess, StoreSubscription } from './store-access';

/**
 * Subscription rules the platform administrator's actions follow, and the
 * wording the subscription screens use. Pure, so the date arithmetic is
 * unit-tested directly.
 */

/** A new store's free trial, on the trial plan (Business). */
export const TRIAL_DAYS = 14;

/** How many months one recorded payment may buy. */
export const PAYMENT_MONTHS = [1, 3, 6, 12] as const;
export type PaymentMonths = (typeof PAYMENT_MONTHS)[number];

/** The most a trial can be extended by in one go. */
export const MAX_TRIAL_EXTENSION_DAYS = 30;

export const PAYMENT_METHOD_LABEL = { GCASH: 'GCash', BANK_TRANSFER: 'Bank transfer', OTHER: 'Other' } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHOD_LABEL;

export const STATUS_LABEL: Record<StoreSubscription['status'], string> = {
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  SUSPENDED: 'Suspended',
};

export const ACCESS_LABEL: Record<AccessState, string> = {
  ACTIVE: 'Active',
  TRIAL: 'Trial',
  GRACE: 'Grace period',
  READ_ONLY: 'Read-only',
  SUSPENDED: 'Suspended',
};

export type AccessTone = 'success' | 'info' | 'warning' | 'danger';
export const ACCESS_TONE: Record<AccessState, AccessTone> = {
  ACTIVE: 'success',
  TRIAL: 'info',
  GRACE: 'warning',
  READ_ONLY: 'danger',
  SUSPENDED: 'danger',
};

const DAY = 86_400_000;

/**
 * Adds calendar months, keeping the time of day and clamping to the last day
 * of a shorter month (31 January + 1 month = 28 or 29 February).
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/**
 * The period a new payment covers. It starts at whichever is later — now, or
 * the end of the time the store already has (paid period, or a running
 * trial) — so paying early never loses days and paying late never backdates.
 */
export function paymentPeriod(
  subscription: Pick<StoreSubscription, 'status' | 'trialEndsAt' | 'currentPeriodEnd'>,
  months: number,
  now: Date,
): { start: Date; end: Date } {
  const currentEnd = subscription.status === 'TRIAL' ? subscription.trialEndsAt : subscription.currentPeriodEnd;
  const start = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now;
  return { start, end: addMonths(start, months) };
}

/**
 * The same GCash or bank reference typed differently ("ab 12-34 " and "AB12-34")
 * is still the same payment.
 */
export function normalizeReference(reference: string): string {
  return reference.replace(/\s+/g, '').toUpperCase();
}

/** Whole days from `now` until `date`, rounded up; 0 once it has passed. */
export function daysUntil(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return Math.max(0, Math.ceil((date.getTime() - now.getTime()) / DAY));
}

/** The trial a new store starts with. */
export function newTrial(now: Date): { plan: PlanId; status: 'TRIAL'; trialEndsAt: Date } {
  return { plan: TRIAL_PLAN, status: 'TRIAL', trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY) };
}

/**
 * One line telling the owner where the subscription stands and what happens
 * next. `null` dates mean "no end date".
 */
export function accessHeadline(access: StoreAccess, now: Date): string {
  const days = daysUntil(access.state === 'GRACE' ? access.graceEndsAt : access.endsAt, now);
  const inDays = (n: number | null) => (n === null ? '' : n === 0 ? 'today' : `in ${n} day${n === 1 ? '' : 's'}`);
  switch (access.state) {
    case 'TRIAL':
      return access.endsAt ? `Your ${access.plan.name} trial ends ${inDays(days)}.` : `You are on a ${access.plan.name} trial.`;
    case 'ACTIVE':
      return access.endsAt
        ? `Your ${access.plan.name} plan is paid up; the current period ends ${inDays(days)}.`
        : `Your ${access.plan.name} plan has no end date.`;
    case 'GRACE':
      return `Your subscription has ended. The store keeps working until the grace period ends ${inDays(days)}, then becomes read-only.`;
    case 'READ_ONLY':
      return 'Your subscription has ended. The store is read-only: you can view and export records, but not make changes.';
    case 'SUSPENDED':
      return 'This store has been suspended by the platform administrator.';
  }
}

/** Whether an in-app banner should show: the trial's last week, grace and read-only. */
export function shouldWarn(access: StoreAccess, now: Date): boolean {
  if (access.state === 'GRACE' || access.state === 'READ_ONLY') return true;
  if (access.state === 'TRIAL' && access.endsAt) return (daysUntil(access.endsAt, now) ?? 99) <= 7;
  return false;
}

export type StoreStatusId = StoreSubscription['status'];

export interface StoreTally {
  total: number;
  byStatus: Record<StoreStatusId, number>;
  byPlan: Record<PlanId, number>;
}

/**
 * Folds grouped store counts into the platform overview's totals. Every
 * status and plan is present, at zero when no store has it, so the overview
 * never renders a missing figure as if it were unknown.
 */
export function tallyStores(rows: { status: StoreStatusId; plan: PlanId; count: number }[]): StoreTally {
  const tally: StoreTally = {
    total: 0,
    byStatus: { TRIAL: 0, ACTIVE: 0, PAST_DUE: 0, SUSPENDED: 0 },
    byPlan: { BASIC: 0, BUSINESS: 0, ENTERPRISE: 0 },
  };
  for (const row of rows) {
    tally.total += row.count;
    tally.byStatus[row.status] += row.count;
    tally.byPlan[row.plan] += row.count;
  }
  return tally;
}
