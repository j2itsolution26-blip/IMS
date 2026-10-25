import { FEATURE_LABEL, PLANS, PLAN_ORDER, type Feature, type LimitKey, type PlanId } from './plans';
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

// --- Presentation rules for the Subscription & Billing screen -----------------
//
// Pure, so what the owner is shown is unit-tested against the same states the
// server stores. None of these decide anything: the server re-checks every
// action.

/**
 * How an invoice reads to the owner. Stored states are only OPEN, PAID and
 * VOID; "awaiting verification" and "overdue" are an open invoice seen
 * against its payments and the clock.
 */
export type InvoiceDisplayStatus = 'OPEN' | 'AWAITING_VERIFICATION' | 'OVERDUE' | 'PAID' | 'VOID';

export const INVOICE_STATUS_LABEL: Record<InvoiceDisplayStatus, string> = {
  OPEN: 'Open',
  AWAITING_VERIFICATION: 'Awaiting verification',
  OVERDUE: 'Overdue',
  PAID: 'Paid',
  VOID: 'Void',
};

export function invoiceDisplayStatus(
  invoice: { status: 'OPEN' | 'PAID' | 'VOID'; dueAt: Date },
  hasPendingPayment: boolean,
  now: Date,
): InvoiceDisplayStatus {
  if (invoice.status !== 'OPEN') return invoice.status;
  if (hasPendingPayment) return 'AWAITING_VERIFICATION';
  return invoice.dueAt.getTime() < now.getTime() ? 'OVERDUE' : 'OPEN';
}

/** A voided payment is void whatever its review said; only VERIFIED, non-void money counts. */
export type PaymentDisplayStatus = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'VOID';

export const PAYMENT_STATUS_LABEL: Record<PaymentDisplayStatus, string> = {
  PENDING: 'Awaiting verification',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  VOID: 'Void',
};

export function paymentDisplayStatus(payment: Pick<PaymentForRevenue, 'status' | 'voidedAt'>): PaymentDisplayStatus {
  return payment.voidedAt ? 'VOID' : payment.status;
}

export interface PlanPricing {
  monthly: number | null;
  annual: number | null;
  /** Annual divided by 12, when an annual price exists. */
  annualPerMonth: number | null;
  /** What a year of monthly payments costs minus the annual price; null unless both exist and annual is cheaper. */
  annualSavings: number | null;
}

const cents = (amount: number) => Math.round(amount * 100) / 100;

/** One plan's published prices. Nothing is assumed for an interval with no price. */
export function planPricing(prices: { plan: PlanId; interval: BillingInterval; amount: number }[], plan: PlanId): PlanPricing {
  const find = (interval: BillingInterval) => prices.find((price) => price.plan === plan && price.interval === interval && price.amount > 0)?.amount ?? null;
  const monthly = find('MONTHLY');
  const annual = find('ANNUAL');
  const savings = monthly !== null && annual !== null ? cents(monthly * 12 - annual) : null;
  return {
    monthly,
    annual,
    annualPerMonth: annual === null ? null : cents(annual / 12),
    annualSavings: savings !== null && savings > 0 ? savings : null,
  };
}

/** Moving from one plan to another, by plan order. */
export type PlanDirection = 'CURRENT' | 'UPGRADE' | 'DOWNGRADE';

export function planDirection(from: PlanId, to: PlanId): PlanDirection {
  const delta = PLAN_ORDER.indexOf(to) - PLAN_ORDER.indexOf(from);
  return delta === 0 ? 'CURRENT' : delta > 0 ? 'UPGRADE' : 'DOWNGRADE';
}

export interface PlanDifference {
  label: string;
  from: string;
  to: string;
  /** Whether the change gives the store less. */
  lower: boolean;
}

const LIMIT_NAME: Record<LimitKey, string> = {
  branches: 'Branches',
  staff: 'Staff accounts',
  products: 'Products',
  backgroundRemovalsPerMonth: 'Background removals / month',
};

const limitValue = (value: number | null) => (value === null ? 'Unlimited' : value === 0 ? 'None' : value.toLocaleString('en-PH'));
const rank = (value: number | null) => (value === null ? Number.POSITIVE_INFINITY : value);
const historyValue = (days: number | null) => (days === null ? 'All' : `${days} days`);

/** What changes, limit by limit and feature by feature, between two plans. Read from the plan configuration. */
export function planDifferences(from: PlanId, to: PlanId): PlanDifference[] {
  const a = PLANS[from];
  const b = PLANS[to];
  const rows: PlanDifference[] = [];
  for (const key of Object.keys(LIMIT_NAME) as LimitKey[]) {
    if (a.limits[key] === b.limits[key]) continue;
    rows.push({ label: LIMIT_NAME[key], from: limitValue(a.limits[key]), to: limitValue(b.limits[key]), lower: rank(b.limits[key]) < rank(a.limits[key]) });
  }
  for (const feature of Object.keys(FEATURE_LABEL) as Feature[]) {
    if (a.features[feature] === b.features[feature]) continue;
    rows.push({
      label: FEATURE_LABEL[feature],
      from: a.features[feature] ? 'Included' : 'Not included',
      to: b.features[feature] ? 'Included' : 'Not included',
      lower: !b.features[feature],
    });
  }
  if (a.auditHistoryDays !== b.auditHistoryDays) {
    rows.push({
      label: 'Audit history',
      from: historyValue(a.auditHistoryDays),
      to: historyValue(b.auditHistoryDays),
      lower: rank(b.auditHistoryDays) < rank(a.auditHistoryDays),
    });
  }
  return rows;
}

/** A usage meter at 80% or more is close to its limit. */
export const USAGE_NEAR_RATIO = 0.8;

export type UsageLevel = 'UNLIMITED' | 'NOT_INCLUDED' | 'OK' | 'NEAR' | 'FULL' | 'OVER';

export function usageLevel(used: number, limit: number | null): UsageLevel {
  if (limit === null) return 'UNLIMITED';
  if (limit === 0) return used > 0 ? 'OVER' : 'NOT_INCLUDED';
  if (used > limit) return 'OVER';
  if (used === limit) return 'FULL';
  return used / limit >= USAGE_NEAR_RATIO ? 'NEAR' : 'OK';
}

/** `••••7890`: enough to recognise a transfer without repeating it in full on every row. */
export function maskReference(reference: string): string {
  return reference.length <= 4 ? reference : `••••${reference.slice(-4)}`;
}

/**
 * Where the owner stands on paying, in one word for the summary. Derived from
 * the billing flag only: with no open invoice nothing is owed — never a
 * price, even on a trial.
 */
export type PaymentState = 'NOTHING_OWED' | 'INVOICE_OPEN' | 'DUE_SOON' | 'AWAITING_VERIFICATION' | 'OVERDUE';

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  NOTHING_OWED: 'Nothing owed',
  INVOICE_OPEN: 'Invoice open',
  DUE_SOON: 'Payment due soon',
  AWAITING_VERIFICATION: 'Awaiting verification',
  OVERDUE: 'Overdue',
};

export const PAYMENT_STATE_TONE: Record<PaymentState, 'success' | 'info' | 'warning' | 'danger'> = {
  NOTHING_OWED: 'success',
  INVOICE_OPEN: 'info',
  DUE_SOON: 'warning',
  AWAITING_VERIFICATION: 'warning',
  OVERDUE: 'danger',
};

export function paymentState(flag: BillingFlag | null): PaymentState {
  switch (flag) {
    case null:
      return 'NOTHING_OWED';
    case 'PLAN_SELECTED':
      return 'INVOICE_OPEN';
    case 'PAYMENT_DUE':
      return 'DUE_SOON';
    case 'PAYMENT_PENDING':
      return 'AWAITING_VERIFICATION';
    case 'PAST_DUE':
      return 'OVERDUE';
  }
}

/** The annual saving as a whole percentage of a year of monthly payments; null when there is none. */
export function annualSavingsPercent(pricing: Pick<PlanPricing, 'monthly' | 'annualSavings'>): number | null {
  if (pricing.monthly === null || pricing.annualSavings === null) return null;
  const percent = Math.round((pricing.annualSavings / (pricing.monthly * 12)) * 100);
  return percent > 0 ? percent : null;
}

/** The best annual saving across all plans, for "Save up to N%"; null when no plan saves anything. */
export function maxAnnualSavingsPercent(prices: { plan: PlanId; interval: BillingInterval; amount: number }[]): number | null {
  const percents = PLAN_ORDER.map((plan) => annualSavingsPercent(planPricing(prices, plan))).filter((p): p is number => p !== null);
  return percents.length ? Math.max(...percents) : null;
}

/** The plan the cards recommend. A label only: it is never shown as selected. */
export const POPULAR_PLAN: PlanId = 'BUSINESS';

/**
 * The badges on one plan card. "Current" is a plan the store has paid for;
 * during a trial the trial plan is "your trial", which is not a purchase, so
 * it can still be chosen. The popular label gives way to "current".
 */
export function planCardBadges(
  plan: PlanId,
  input: { paidPlan: PlanId | null; effectivePlan: PlanId; onTrial: boolean },
): { current: boolean; trial: boolean; popular: boolean } {
  const current = !input.onTrial && input.paidPlan === plan;
  return {
    current,
    trial: input.onTrial && input.effectivePlan === plan,
    popular: plan === POPULAR_PLAN && !current,
  };
}

/** The billing history date filter. */
export type HistoryRange = 'all' | '30d' | '90d' | 'year';

export const HISTORY_RANGE_LABEL: Record<HistoryRange, string> = {
  all: 'All time',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  year: 'This year',
};

/** The earliest moment a range includes, or null for all time. "This year" starts on 1 January, local time. */
export function historyRangeStart(range: HistoryRange, now: Date): Date | null {
  switch (range) {
    case 'all':
      return null;
    case '30d':
      return new Date(now.getTime() - 30 * DAY);
    case '90d':
      return new Date(now.getTime() - 90 * DAY);
    case 'year':
      return new Date(now.getFullYear(), 0, 1);
  }
}
