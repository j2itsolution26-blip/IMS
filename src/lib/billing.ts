import type { PlanId } from './plans';
import { storeAccess, type StoreAccess, type StoreSubscription } from './store-access';
import { addMonths } from './subscription';

/**
 * Billing rules: where a store stands, what an invoice covers and when it is
 * due, which reminder is owed, and what counts as revenue. Pure — every date
 * comes from the caller (the server's clock) — so each boundary is
 * unit-tested.
 *
 * Two things are kept separate throughout:
 *   - the lifecycle (trial, paid, lapsed, suspended), which drives access and
 *     comes from the store's subscription fields via `storeAccess`;
 *   - the billing state, which exists only when the owner chose a plan and
 *     accepted the terms (an OPEN invoice). A trial ending never creates one.
 */

const DAY = 86_400_000;

export type BillingInterval = 'MONTHLY' | 'ANNUAL';

export const INTERVAL_MONTHS: Record<BillingInterval, number> = { MONTHLY: 1, ANNUAL: 12 };
export const INTERVAL_LABEL: Record<BillingInterval, string> = { MONTHLY: 'Monthly', ANNUAL: 'Annual' };

/** A trial with this many days or fewer left shows as ending soon. */
export const TRIAL_ENDING_SOON_DAYS = 7;
/** An open invoice due within this many days shows as payment due. */
export const PAYMENT_DUE_SOON_DAYS = 7;
/** The least time an owner gets to pay a new invoice. */
export const PAYMENT_TERMS_DAYS = 3;

/**
 * Reminder thresholds, in days. Central so the policy is changed in one place.
 *   trial:      days before the trial ends (0 = the day it ends or after)
 *   invoiceDue: days before an open invoice is due (0 = due today or now)
 *   overdue:    days after an open invoice fell due
 */
export const REMINDER_DAYS = {
  trial: [7, 3, 1, 0],
  invoiceDue: [3, 0],
  overdue: [1, 7],
} as const;

export type Lifecycle =
  | 'TRIAL'
  | 'TRIAL_ENDING_SOON'
  | 'TRIAL_EXPIRED'
  | 'ACTIVE_PAID'
  | 'PAID_PERIOD_ENDED'
  | 'SUSPENDED';

export type BillingFlag = 'PLAN_SELECTED' | 'PAYMENT_DUE' | 'PAYMENT_PENDING' | 'PAST_DUE';

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  TRIAL: 'Trial',
  TRIAL_ENDING_SOON: 'Trial ending soon',
  TRIAL_EXPIRED: 'Trial expired',
  ACTIVE_PAID: 'Active (paid)',
  PAID_PERIOD_ENDED: 'Paid period ended',
  SUSPENDED: 'Suspended',
};

export const BILLING_LABEL: Record<BillingFlag, string> = {
  PLAN_SELECTED: 'Plan selected',
  PAYMENT_DUE: 'Payment due',
  PAYMENT_PENDING: 'Payment pending verification',
  PAST_DUE: 'Past due',
};

export interface OpenInvoiceSummary {
  id: string;
  dueAt: Date;
}

export interface BillingSnapshot {
  lifecycle: Lifecycle;
  /** Null when there is no billing obligation (no open invoice). */
  billing: BillingFlag | null;
  /** Inside the grace period after a trial or paid period ended. */
  grace: boolean;
  /** Past the grace period: read-only. */
  readOnly: boolean;
  access: StoreAccess;
}

/** Where a store stands now. */
export function billingSnapshot(input: {
  subscription: StoreSubscription;
  openInvoice: OpenInvoiceSummary | null;
  hasPendingPayment: boolean;
  now: Date;
}): BillingSnapshot {
  const { subscription, openInvoice, hasPendingPayment, now } = input;
  const access = storeAccess(subscription, now);

  let lifecycle: Lifecycle;
  if (subscription.status === 'SUSPENDED') {
    lifecycle = 'SUSPENDED';
  } else if (subscription.status === 'TRIAL') {
    if (access.state === 'TRIAL') {
      const left = access.endsAt ? (access.endsAt.getTime() - now.getTime()) / DAY : Number.POSITIVE_INFINITY;
      lifecycle = left <= TRIAL_ENDING_SOON_DAYS ? 'TRIAL_ENDING_SOON' : 'TRIAL';
    } else {
      lifecycle = 'TRIAL_EXPIRED';
    }
  } else if (subscription.status === 'ACTIVE' && access.state === 'ACTIVE') {
    lifecycle = 'ACTIVE_PAID';
  } else {
    lifecycle = 'PAID_PERIOD_ENDED';
  }

  return {
    lifecycle,
    billing: billingFlag(openInvoice, hasPendingPayment, now),
    grace: access.state === 'GRACE',
    readOnly: access.state === 'READ_ONLY',
    access,
  };
}

function billingFlag(openInvoice: OpenInvoiceSummary | null, hasPendingPayment: boolean, now: Date): BillingFlag | null {
  if (!openInvoice) return null;
  if (hasPendingPayment) return 'PAYMENT_PENDING';
  const msToDue = openInvoice.dueAt.getTime() - now.getTime();
  if (msToDue < 0) return 'PAST_DUE';
  if (msToDue <= PAYMENT_DUE_SOON_DAYS * DAY) return 'PAYMENT_DUE';
  return 'PLAN_SELECTED';
}

/**
 * The period a new invoice buys and when it is due.
 *
 * It starts when the store's current time runs out — the trial's end, or the
 * end of a paid period still running — or now if nothing is running, so
 * paying early never throws time away. It is due when it starts, but never
 * sooner than PAYMENT_TERMS_DAYS from now.
 */
export function invoicePeriod(input: {
  subscription: Pick<StoreSubscription, 'status' | 'trialEndsAt' | 'currentPeriodEnd'>;
  interval: BillingInterval;
  now: Date;
}): { periodStart: Date; periodEnd: Date; dueAt: Date } {
  const { subscription, interval, now } = input;
  const running =
    subscription.status === 'TRIAL'
      ? subscription.trialEndsAt
      : subscription.status === 'ACTIVE'
        ? subscription.currentPeriodEnd
        : null;
  const periodStart = running && running.getTime() > now.getTime() ? new Date(running.getTime()) : new Date(now.getTime());
  const periodEnd = addMonths(periodStart, INTERVAL_MONTHS[interval]);
  const earliestDue = now.getTime() + PAYMENT_TERMS_DAYS * DAY;
  const dueAt = new Date(Math.max(periodStart.getTime(), earliestDue));
  return { periodStart, periodEnd, dueAt };
}

export interface Reminder {
  /** Unique per event and window; raising it twice is a no-op. */
  key: string;
  title: string;
  body: string;
}

/**
 * The one reminder a store is owed right now, if any — the tightest threshold
 * crossed. Earlier thresholds that were missed (a job that did not run) are
 * not replayed; the dedupe key makes each one fire at most once.
 *
 * With an open invoice, invoice reminders replace trial reminders. A pending
 * payment silences invoice reminders: the owner has already acted.
 */
export function reminderFor(input: {
  subscription: Pick<StoreSubscription, 'status' | 'trialEndsAt'>;
  openInvoice: (OpenInvoiceSummary & { number: string }) | null;
  hasPendingPayment: boolean;
  now: Date;
}): Reminder | null {
  const { subscription, openInvoice, hasPendingPayment, now } = input;

  if (openInvoice) {
    if (hasPendingPayment) return null;
    const msToDue = openInvoice.dueAt.getTime() - now.getTime();
    if (msToDue < 0) {
      const daysOver = Math.floor(-msToDue / DAY);
      const threshold = [...REMINDER_DAYS.overdue].reverse().find((days) => daysOver >= days);
      if (threshold === undefined) return null;
      return {
        key: `invoice:${openInvoice.id}:overdue-${threshold}`,
        title: 'Payment overdue',
        body: `Invoice ${openInvoice.number} is ${threshold === 1 ? 'past' : `${threshold} days past`} its due date. Pay and submit the reference to keep full access.`,
      };
    }
    // Whole days left, rounded down: under 24 hours to go is "due today".
    const daysToDue = Math.floor(msToDue / DAY);
    const threshold = [...REMINDER_DAYS.invoiceDue].sort((a, b) => a - b).find((days) => daysToDue <= days);
    if (threshold === undefined) return null;
    return {
      key: `invoice:${openInvoice.id}:due-${threshold}`,
      title: daysToDue === 0 ? 'Payment due today' : `Payment due in ${daysToDue} day${daysToDue === 1 ? '' : 's'}`,
      body: `Invoice ${openInvoice.number} is due. Pay and submit the reference from Subscription & Billing.`,
    };
  }

  if (subscription.status !== 'TRIAL' || !subscription.trialEndsAt) return null;
  const msLeft = subscription.trialEndsAt.getTime() - now.getTime();
  const daysLeft = Math.max(0, Math.ceil(msLeft / DAY));
  const threshold = [...REMINDER_DAYS.trial].sort((a, b) => a - b).find((days) => daysLeft <= days);
  if (threshold === undefined) return null;
  const anchor = subscription.trialEndsAt.toISOString().slice(0, 10);
  if (msLeft <= 0) {
    return {
      key: `trial:${anchor}:ended`,
      title: 'Your trial has ended',
      body: 'Choose a plan to keep using everything. Nothing is charged until you choose one.',
    };
  }
  return {
    key: `trial:${anchor}:${threshold}d`,
    title: `Your trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
    body: 'Choose a plan before it ends to keep using everything. Nothing is charged until you choose one.',
  };
}

export interface PaymentForRevenue {
  status: 'PENDING' | 'VERIFIED' | 'REJECTED';
  voidedAt: Date | null;
  amount: number;
  months: number;
  periodStart: Date;
  periodEnd: Date;
}

/** Only verified, non-void money is revenue — never a pending or rejected claim. */
export function isRevenue(payment: Pick<PaymentForRevenue, 'status' | 'voidedAt'>): boolean {
  return payment.status === 'VERIFIED' && payment.voidedAt === null;
}

/**
 * Monthly recurring revenue: each verified, non-void payment whose period
 * covers `now`, spread evenly over the months it bought. Stores with nothing
 * verified covering today contribute nothing — a trial or an unpaid invoice
 * is not revenue.
 */
export function monthlyRecurringRevenue(payments: PaymentForRevenue[], now: Date): number {
  const total = payments
    .filter(
      (payment) =>
        isRevenue(payment) &&
        payment.months > 0 &&
        payment.periodStart.getTime() <= now.getTime() &&
        now.getTime() < payment.periodEnd.getTime(),
    )
    .reduce((sum, payment) => sum + payment.amount / payment.months, 0);
  return Math.round(total * 100) / 100;
}

/** `INV-20261029-3F9A1C`: date of issue plus a random suffix supplied by the caller. */
export function formatInvoiceNumber(issuedAt: Date, suffix: string): string {
  const date = issuedAt.toISOString().slice(0, 10).replace(/-/g, '');
  return `INV-${date}-${suffix.toUpperCase()}`;
}

/** Plans an owner can buy, cheapest first, from whatever prices exist. */
export function purchasablePlans(prices: { plan: PlanId; interval: BillingInterval; amount: number }[]): PlanId[] {
  const order: PlanId[] = ['BASIC', 'BUSINESS', 'ENTERPRISE'];
  return order.filter((plan) => prices.some((price) => price.plan === plan && price.amount > 0));
}
