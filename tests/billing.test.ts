import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_TERMS_DAYS,
  annualSavingsPercent,
  billingBannerKind,
  billingSnapshot,
  formatInvoiceNumber,
  historyRangeStart,
  invoiceDisplayStatus,
  invoicePeriod,
  isRevenue,
  maskReference,
  maxAnnualSavingsPercent,
  monthlyRecurringRevenue,
  overviewStatus,
  paymentDisplayStatus,
  paymentReportProblems,
  paymentTimeline,
  planCardBadges,
  planCtaKind,
  planDifferences,
  planDirection,
  planPricing,
  purchasablePlans,
  reminderFor,
  usageLevel,
} from '@/lib/billing';
import type { StoreSubscription } from '@/lib/store-access';

const DAY = 86_400_000;
const NOW = new Date('2026-10-29T04:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

const trial = (daysLeft: number): StoreSubscription => ({
  plan: 'BUSINESS',
  status: 'TRIAL',
  trialEndsAt: at(daysLeft),
  currentPeriodEnd: null,
});
const paid = (daysLeft: number): StoreSubscription => ({
  plan: 'BASIC',
  status: 'ACTIVE',
  trialEndsAt: null,
  currentPeriodEnd: at(daysLeft),
});

// --- Lifecycle ---------------------------------------------------------------

test('a trial with time left is a trial, then ending soon within 7 days', () => {
  assert.equal(billingSnapshot({ subscription: trial(10), openInvoice: null, hasPendingPayment: false, now: NOW }).lifecycle, 'TRIAL');
  assert.equal(billingSnapshot({ subscription: trial(7), openInvoice: null, hasPendingPayment: false, now: NOW }).lifecycle, 'TRIAL_ENDING_SOON');
  assert.equal(billingSnapshot({ subscription: trial(0.5), openInvoice: null, hasPendingPayment: false, now: NOW }).lifecycle, 'TRIAL_ENDING_SOON');
});

test('an ended trial is expired: in grace for 7 days, then read-only', () => {
  const graced = billingSnapshot({ subscription: trial(-2), openInvoice: null, hasPendingPayment: false, now: NOW });
  assert.equal(graced.lifecycle, 'TRIAL_EXPIRED');
  assert.equal(graced.grace, true);
  assert.equal(graced.readOnly, false);
  const lapsed = billingSnapshot({ subscription: trial(-8), openInvoice: null, hasPendingPayment: false, now: NOW });
  assert.equal(lapsed.lifecycle, 'TRIAL_EXPIRED');
  assert.equal(lapsed.readOnly, true);
});

test('an expired trial never implies a payment obligation', () => {
  const snapshot = billingSnapshot({ subscription: trial(-30), openInvoice: null, hasPendingPayment: false, now: NOW });
  assert.equal(snapshot.billing, null);
});

test('a running paid period is active; an ended one is not', () => {
  assert.equal(billingSnapshot({ subscription: paid(20), openInvoice: null, hasPendingPayment: false, now: NOW }).lifecycle, 'ACTIVE_PAID');
  assert.equal(billingSnapshot({ subscription: paid(-1), openInvoice: null, hasPendingPayment: false, now: NOW }).lifecycle, 'PAID_PERIOD_ENDED');
});

test('a suspended store is suspended whatever else is true', () => {
  const snapshot = billingSnapshot({
    subscription: { ...paid(20), status: 'SUSPENDED' },
    openInvoice: { id: 'i', dueAt: at(-10) },
    hasPendingPayment: false,
    now: NOW,
  });
  assert.equal(snapshot.lifecycle, 'SUSPENDED');
});

// --- Billing state -----------------------------------------------------------

test('an open invoice is plan selected, then payment due, then past due', () => {
  const flag = (dueInDays: number) =>
    billingSnapshot({ subscription: trial(10), openInvoice: { id: 'i', dueAt: at(dueInDays) }, hasPendingPayment: false, now: NOW }).billing;
  assert.equal(flag(10), 'PLAN_SELECTED');
  assert.equal(flag(7), 'PAYMENT_DUE');
  assert.equal(flag(0.1), 'PAYMENT_DUE');
  assert.equal(flag(-0.1), 'PAST_DUE');
});

test('a pending payment shows as pending, even past the due date', () => {
  const snapshot = billingSnapshot({ subscription: trial(-1), openInvoice: { id: 'i', dueAt: at(-3) }, hasPendingPayment: true, now: NOW });
  assert.equal(snapshot.billing, 'PAYMENT_PENDING');
});

test('lifecycle and billing are independent: trial ending soon with a plan selected', () => {
  const snapshot = billingSnapshot({ subscription: trial(5), openInvoice: { id: 'i', dueAt: at(5) }, hasPendingPayment: false, now: NOW });
  assert.equal(snapshot.lifecycle, 'TRIAL_ENDING_SOON');
  assert.equal(snapshot.billing, 'PAYMENT_DUE');
});

// --- Invoice period and due date ---------------------------------------------

test('an invoice during a trial starts when the trial ends and is due then', () => {
  const period = invoicePeriod({ subscription: trial(10), interval: 'MONTHLY', now: NOW });
  assert.equal(period.periodStart.toISOString(), at(10).toISOString());
  assert.equal(period.dueAt.toISOString(), at(10).toISOString());
  assert.equal(period.periodEnd.getUTCMonth(), (at(10).getUTCMonth() + 1) % 12);
});

test('an invoice with no time running starts now and is due after the payment terms', () => {
  const period = invoicePeriod({ subscription: trial(-5), interval: 'ANNUAL', now: NOW });
  assert.equal(period.periodStart.toISOString(), NOW.toISOString());
  assert.equal(period.dueAt.toISOString(), at(PAYMENT_TERMS_DAYS).toISOString());
  assert.equal(period.periodEnd.getUTCFullYear(), NOW.getUTCFullYear() + 1);
});

test('a trial ending tomorrow still gives the full payment terms', () => {
  const period = invoicePeriod({ subscription: trial(1), interval: 'MONTHLY', now: NOW });
  assert.equal(period.periodStart.toISOString(), at(1).toISOString());
  assert.equal(period.dueAt.toISOString(), at(PAYMENT_TERMS_DAYS).toISOString());
});

test('renewing early stacks after the current paid period', () => {
  const period = invoicePeriod({ subscription: paid(12), interval: 'MONTHLY', now: NOW });
  assert.equal(period.periodStart.toISOString(), at(12).toISOString());
});

// --- Reminders ---------------------------------------------------------------

test('trial reminders fire at 7, 3, 1 days and on expiry, once per window', () => {
  const key = (daysLeft: number) =>
    reminderFor({ subscription: trial(daysLeft), openInvoice: null, hasPendingPayment: false, now: NOW })?.key ?? null;
  assert.equal(key(10), null);
  assert.match(key(6.5)!, /:7d$/);
  assert.match(key(5)!, /:7d$/, 'same window, same key: no duplicate');
  assert.match(key(2.2)!, /:3d$/);
  assert.match(key(0.4)!, /:1d$/);
  assert.match(key(-1)!, /:ended$/);
  // The same trial, checked again weeks later, still yields the same key.
  const ended = trial(-1);
  const later = new Date(NOW.getTime() + 20 * DAY);
  assert.equal(
    reminderFor({ subscription: ended, openInvoice: null, hasPendingPayment: false, now: NOW })?.key,
    reminderFor({ subscription: ended, openInvoice: null, hasPendingPayment: false, now: later })?.key,
    'the ended reminder never repeats',
  );
});

test('with an open invoice, invoice reminders replace trial reminders', () => {
  const reminder = reminderFor({
    subscription: trial(2),
    openInvoice: { id: 'inv1', number: 'INV-1', dueAt: at(2.5) },
    hasPendingPayment: false,
    now: NOW,
  });
  assert.equal(reminder?.key, 'invoice:inv1:due-3');
});

test('invoice reminders: due soon, due today, then overdue at 1 and 7 days', () => {
  const key = (dueInDays: number) =>
    reminderFor({ subscription: paid(5), openInvoice: { id: 'inv', number: 'INV-1', dueAt: at(dueInDays) }, hasPendingPayment: false, now: NOW })?.key ?? null;
  assert.equal(key(10), null);
  assert.equal(key(2.5), 'invoice:inv:due-3');
  assert.equal(key(0.3), 'invoice:inv:due-0');
  assert.equal(key(-0.5), null, 'within the first day overdue, the due-today reminder already went out');
  assert.equal(key(-1.5), 'invoice:inv:overdue-1');
  assert.equal(key(-9), 'invoice:inv:overdue-7');
});

test('a pending payment silences invoice reminders', () => {
  const reminder = reminderFor({
    subscription: paid(5),
    openInvoice: { id: 'inv', number: 'INV-1', dueAt: at(-3) },
    hasPendingPayment: true,
    now: NOW,
  });
  assert.equal(reminder, null);
});

test('a paid store with no invoice gets no reminder', () => {
  assert.equal(reminderFor({ subscription: paid(2), openInvoice: null, hasPendingPayment: false, now: NOW }), null);
});

// --- Revenue -----------------------------------------------------------------

const payment = (over: Partial<Parameters<typeof monthlyRecurringRevenue>[0][number]> = {}) => ({
  status: 'VERIFIED' as const,
  voidedAt: null,
  amount: 1200,
  months: 12,
  periodStart: at(-30),
  periodEnd: at(300),
  ...over,
});

test('only verified, non-void payments are revenue', () => {
  assert.equal(isRevenue(payment()), true);
  assert.equal(isRevenue(payment({ status: 'PENDING' })), false);
  assert.equal(isRevenue(payment({ status: 'REJECTED' })), false);
  assert.equal(isRevenue(payment({ voidedAt: NOW })), false);
});

test('MRR spreads covering verified payments over their months and ignores the rest', () => {
  const mrr = monthlyRecurringRevenue(
    [
      payment(), // 1200 / 12 = 100
      payment({ amount: 499, months: 1, periodStart: at(-5), periodEnd: at(25) }), // 499
      payment({ status: 'PENDING', amount: 9999, months: 1 }),
      payment({ voidedAt: NOW, amount: 9999, months: 1 }),
      payment({ periodStart: at(-400), periodEnd: at(-35) }), // expired
      payment({ periodStart: at(10), periodEnd: at(40) }), // not started
    ],
    NOW,
  );
  assert.equal(mrr, 599);
});

// --- Small helpers -----------------------------------------------------------

test('invoice numbers carry the issue date and an uppercase suffix', () => {
  assert.equal(formatInvoiceNumber(NOW, '3f9a1c'), 'INV-20261029-3F9A1C');
});

test('only plans with a configured price can be bought', () => {
  assert.deepEqual(purchasablePlans([]), []);
  assert.deepEqual(
    purchasablePlans([
      { plan: 'ENTERPRISE', interval: 'MONTHLY', amount: 2000 },
      { plan: 'BASIC', interval: 'ANNUAL', amount: 3000 },
    ]),
    ['BASIC', 'ENTERPRISE'],
  );
});

// --- Migration agrees with the code ------------------------------------------

test('billing.manage is an owner permission, inserted with the catalogue description', async () => {
  const { readFileSync } = await import('node:fs');
  const { ALL_PERMISSIONS, STORE_PERMISSION_KEYS } = await import('@/lib/permissions');
  const sql = readFileSync('prisma/migrations/20261029090000_billing/migration.sql', 'utf8');
  assert.ok(STORE_PERMISSION_KEYS.includes('billing.manage'));
  const definition = ALL_PERMISSIONS.find((p) => p.key === 'billing.manage');
  assert.ok(definition && sql.includes(`'billing.manage', 'billing', 'manage', '${definition.description}'`));
  assert.match(sql, /WHERE r\."slug" = 'owner' AND r\."storeId" IS NOT NULL/);
});

test('the migration keeps billing records permanent and one open invoice per store', async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync('prisma/migrations/20261029090000_billing/migration.sql', 'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX "invoices_one_open_per_store" ON "invoices"\("storeId"\) WHERE "status" = 'OPEN'/);
  assert.match(sql, /invoices cannot be edited/);
  assert.match(sql, /this payment has already been reviewed/);
  assert.match(sql, /only a verified payment can be voided/);
  assert.match(sql, /"status" "SubscriptionPaymentStatus" NOT NULL DEFAULT 'VERIFIED'/, 'existing payments stay verified');
});

// --- Owner actions cannot be pointed at another store or price ----------------

test('owner billing actions take the store from the session and never accept an amount', async () => {
  const { readFileSync } = await import('node:fs');
  const actions = readFileSync('src/features/billing/actions.ts', 'utf8');
  assert.match(actions, /authorize\('billing\.manage'\)/);
  assert.match(actions, /storeId: user\.store\.id/);
  assert.doesNotMatch(actions, /storeId: z\./, 'no store id in any input schema');
  assert.doesNotMatch(actions, /amount: z\./, 'no amount in any input schema');
  assert.doesNotMatch(actions, /verifyPayment|rejectPayment|voidInvoice/, 'owners cannot verify, reject or void');
});

test('invoice amounts come from the stored price list and payments copy the invoice', async () => {
  const { readFileSync } = await import('node:fs');
  const service = readFileSync('src/server/platform/billing-service.ts', 'utf8');
  const select = service.slice(service.indexOf('export async function selectPlan'), service.indexOf('export async function withdrawInvoice'));
  assert.match(select, /tx\.planPrice\.findUnique/);
  assert.match(select, /amount: price\.amount/);
  const submit = service.slice(service.indexOf('export async function submitPayment'), service.indexOf('// --- Administrator'));
  assert.match(submit, /status: 'PENDING'/);
  assert.match(submit, /amount: invoice\.amount/);
  assert.doesNotMatch(submit, /tx\.store\.update/, 'submitting a payment never changes the subscription');
});

// --- Presentation rules -------------------------------------------------------

test('an open invoice reads as awaiting verification, overdue or open; closed ones keep their state', () => {
  assert.equal(invoiceDisplayStatus({ status: 'OPEN', dueAt: at(3) }, false, NOW), 'OPEN');
  assert.equal(invoiceDisplayStatus({ status: 'OPEN', dueAt: at(-1) }, false, NOW), 'OVERDUE');
  assert.equal(invoiceDisplayStatus({ status: 'OPEN', dueAt: at(-1) }, true, NOW), 'AWAITING_VERIFICATION');
  assert.equal(invoiceDisplayStatus({ status: 'PAID', dueAt: at(-1) }, false, NOW), 'PAID');
  assert.equal(invoiceDisplayStatus({ status: 'VOID', dueAt: at(-1) }, true, NOW), 'VOID');
});

test('a voided payment is void even if it was verified; a pending one is never shown as paid', () => {
  assert.equal(paymentDisplayStatus({ status: 'VERIFIED', voidedAt: NOW }), 'VOID');
  assert.equal(paymentDisplayStatus({ status: 'VERIFIED', voidedAt: null }), 'VERIFIED');
  assert.equal(paymentDisplayStatus({ status: 'PENDING', voidedAt: null }), 'PENDING');
  assert.equal(paymentDisplayStatus({ status: 'REJECTED', voidedAt: null }), 'REJECTED');
});

test('annual savings are twelve monthly payments minus the annual price, only when both are published', () => {
  const prices = [
    { plan: 'BASIC' as const, interval: 'MONTHLY' as const, amount: 499 },
    { plan: 'BASIC' as const, interval: 'ANNUAL' as const, amount: 4990 },
    { plan: 'BUSINESS' as const, interval: 'MONTHLY' as const, amount: 999 },
    { plan: 'ENTERPRISE' as const, interval: 'MONTHLY' as const, amount: 1499 },
    { plan: 'ENTERPRISE' as const, interval: 'ANNUAL' as const, amount: 20000 },
  ];
  const basic = planPricing(prices, 'BASIC');
  assert.equal(basic.annualSavings, 998);
  assert.equal(basic.annualPerMonth, 415.83);
  assert.deepEqual(planPricing(prices, 'BUSINESS'), { monthly: 999, annual: null, annualPerMonth: null, annualSavings: null });
  // An annual price dearer than twelve months is no saving.
  assert.equal(planPricing(prices, 'ENTERPRISE').annualSavings, null);
  assert.deepEqual(planPricing([], 'BASIC'), { monthly: null, annual: null, annualPerMonth: null, annualSavings: null });
});

test('plan direction follows plan order', () => {
  assert.equal(planDirection('BASIC', 'BUSINESS'), 'UPGRADE');
  assert.equal(planDirection('ENTERPRISE', 'BASIC'), 'DOWNGRADE');
  assert.equal(planDirection('BUSINESS', 'BUSINESS'), 'CURRENT');
});

test('plan differences come from the plan configuration and flag what a downgrade loses', () => {
  const down = planDifferences('BUSINESS', 'BASIC');
  const products = down.find((row) => row.label === 'Products');
  assert.deepEqual(products, { label: 'Products', from: '5,000', to: '500', lower: true });
  assert.ok(down.find((row) => row.label === 'Report exports')?.lower);
  assert.ok(planDifferences('BASIC', 'ENTERPRISE').every((row) => !row.lower));
  assert.deepEqual(planDifferences('BASIC', 'BASIC'), []);
});

test('usage levels: near at 80%, full at the limit, over beyond it', () => {
  assert.equal(usageLevel(10, null), 'UNLIMITED');
  assert.equal(usageLevel(0, 0), 'NOT_INCLUDED');
  assert.equal(usageLevel(3, 0), 'OVER');
  assert.equal(usageLevel(399, 500), 'OK');
  assert.equal(usageLevel(400, 500), 'NEAR');
  assert.equal(usageLevel(500, 500), 'FULL');
  assert.equal(usageLevel(501, 500), 'OVER');
  assert.equal(usageLevel(0, 1), 'OK');
});

test('references are masked to their last four characters', () => {
  assert.equal(maskReference('1234567890'), '••••7890');
  assert.equal(maskReference('AB12'), 'AB12');
});

test('savings percentages come from the configured prices, rounded to whole percent', () => {
  const prices = [
    { plan: 'BASIC' as const, interval: 'MONTHLY' as const, amount: 499 },
    { plan: 'BASIC' as const, interval: 'ANNUAL' as const, amount: 4990 },
    { plan: 'BUSINESS' as const, interval: 'MONTHLY' as const, amount: 999 },
    { plan: 'BUSINESS' as const, interval: 'ANNUAL' as const, amount: 9990 },
    { plan: 'ENTERPRISE' as const, interval: 'MONTHLY' as const, amount: 1499 },
    { plan: 'ENTERPRISE' as const, interval: 'ANNUAL' as const, amount: 14990 },
  ];
  // 998 / 5988 = 16.67%
  assert.equal(annualSavingsPercent(planPricing(prices, 'BASIC')), 17);
  assert.equal(annualSavingsPercent(planPricing(prices, 'ENTERPRISE')), 17);
  assert.equal(maxAnnualSavingsPercent(prices), 17);
  // A bigger discount on one plan raises "up to".
  const deal = prices.map((price) => (price.plan === 'BUSINESS' && price.interval === 'ANNUAL' ? { ...price, amount: 8990 } : price));
  assert.equal(maxAnnualSavingsPercent(deal), 25);
  // No annual price, or no saving: nothing is claimed.
  assert.equal(annualSavingsPercent(planPricing(prices.filter((price) => price.interval === 'MONTHLY'), 'BASIC')), null);
  assert.equal(maxAnnualSavingsPercent(prices.filter((price) => price.interval === 'MONTHLY')), null);
  assert.equal(maxAnnualSavingsPercent([]), null);
});

test('plan card badges: the trial plan is choosable, popular gives way to current', () => {
  const trial = { paidPlan: null, effectivePlan: 'BUSINESS' as const, onTrial: true };
  assert.deepEqual(planCardBadges('BUSINESS', trial), { current: false, trial: true, popular: true });
  assert.deepEqual(planCardBadges('BASIC', trial), { current: false, trial: false, popular: false });
  const paidBusiness = { paidPlan: 'BUSINESS' as const, effectivePlan: 'BUSINESS' as const, onTrial: false };
  assert.deepEqual(planCardBadges('BUSINESS', paidBusiness), { current: true, trial: false, popular: false });
  const paidBasic = { paidPlan: 'BASIC' as const, effectivePlan: 'BASIC' as const, onTrial: false };
  assert.deepEqual(planCardBadges('BASIC', paidBasic), { current: true, trial: false, popular: false });
  // Business is still recommended, but not marked as the store's plan.
  assert.deepEqual(planCardBadges('BUSINESS', paidBasic), { current: false, trial: false, popular: true });
});

test('history ranges: all time has no start; this year starts on 1 January', () => {
  const now = new Date(2026, 9, 25, 12);
  assert.equal(historyRangeStart('all', now), null);
  assert.equal(historyRangeStart('30d', now)?.getTime(), now.getTime() - 30 * DAY);
  assert.equal(historyRangeStart('90d', now)?.getTime(), now.getTime() - 90 * DAY);
  assert.equal(historyRangeStart('year', now)?.getTime(), new Date(2026, 0, 1).getTime());
});

test('plan card buttons: a store is never offered its own plan as an upgrade', () => {
  const trial = { paidPlan: null, effectivePlan: 'BUSINESS' as const, onTrial: true, priced: true };
  assert.equal(planCtaKind('BUSINESS', trial), 'CURRENT_TRIAL');
  assert.equal(planCtaKind('BASIC', trial), 'CHOOSE');
  assert.equal(planCtaKind('ENTERPRISE', trial), 'CHOOSE');
  const basic = { paidPlan: 'BASIC' as const, effectivePlan: 'BASIC' as const, onTrial: false, priced: true };
  assert.equal(planCtaKind('BASIC', basic), 'CURRENT');
  assert.equal(planCtaKind('BUSINESS', basic), 'UPGRADE');
  const enterprise = { paidPlan: 'ENTERPRISE' as const, effectivePlan: 'ENTERPRISE' as const, onTrial: false, priced: true };
  assert.equal(planCtaKind('BASIC', enterprise), 'DOWNGRADE');
  assert.equal(planCtaKind('ENTERPRISE', enterprise), 'CURRENT');
});

test('plan card buttons: no published price means no choice, but the current plan still reads as current', () => {
  const trial = { paidPlan: null, effectivePlan: 'BUSINESS' as const, onTrial: true, priced: false };
  assert.equal(planCtaKind('BASIC', trial), 'UNAVAILABLE');
  assert.equal(planCtaKind('BUSINESS', trial), 'CURRENT_TRIAL');
  assert.equal(planCtaKind('BASIC', { paidPlan: 'BASIC', effectivePlan: 'BASIC', onTrial: false, priced: false }), 'CURRENT');
});

test('the billing banner states the most urgent true thing and never implies a debt without an invoice', () => {
  const kind = (accessState: 'ACTIVE' | 'TRIAL' | 'GRACE' | 'READ_ONLY' | 'SUSPENDED', billing: Parameters<typeof billingBannerKind>[0]['billing'], selfService = true) =>
    billingBannerKind({ accessState, billing, selfService });
  assert.equal(kind('SUSPENDED', 'PAST_DUE'), 'SUSPENDED');
  assert.equal(kind('ACTIVE', 'PAST_DUE'), 'INVOICE_OVERDUE');
  assert.equal(kind('TRIAL', 'PAYMENT_PENDING'), 'PAYMENT_PENDING');
  assert.equal(kind('TRIAL', 'PAYMENT_DUE'), 'INVOICE_DUE');
  assert.equal(kind('TRIAL', 'PLAN_SELECTED'), 'INVOICE_OPEN');
  assert.equal(kind('READ_ONLY', null, false), 'READ_ONLY');
  assert.equal(kind('GRACE', null), 'GRACE');
  assert.equal(kind('TRIAL', null, false), 'PRICING_UNAVAILABLE');
  assert.equal(kind('ACTIVE', null, false), 'PRICING_UNAVAILABLE');
  assert.equal(kind('TRIAL', null), 'TRIAL');
  assert.equal(kind('ACTIVE', null), 'ACTIVE');
  // Without an invoice, no state that speaks of payment is chosen.
  for (const state of ['ACTIVE', 'TRIAL', 'GRACE', 'READ_ONLY', 'SUSPENDED'] as const) {
    for (const selfService of [true, false]) {
      assert.ok(!['INVOICE_OVERDUE', 'PAYMENT_PENDING', 'INVOICE_DUE', 'INVOICE_OPEN'].includes(kind(state, null, selfService)));
    }
  }
});

test('the overview shows one status: suspension, then what is owed, then the lifecycle', () => {
  assert.equal(overviewStatus('SUSPENDED', 'PAST_DUE'), 'SUSPENDED');
  assert.equal(overviewStatus('ACTIVE', 'PAST_DUE'), 'OVERDUE');
  assert.equal(overviewStatus('TRIAL', 'PAYMENT_PENDING'), 'UNDER_REVIEW');
  assert.equal(overviewStatus('TRIAL', 'PAYMENT_DUE'), 'AWAITING_PAYMENT');
  assert.equal(overviewStatus('ACTIVE', 'PLAN_SELECTED'), 'AWAITING_PAYMENT');
  assert.equal(overviewStatus('READ_ONLY', null), 'READ_ONLY');
  assert.equal(overviewStatus('GRACE', null), 'GRACE');
  assert.equal(overviewStatus('TRIAL', null), 'TRIAL');
  assert.equal(overviewStatus('ACTIVE', null), 'ACTIVE');
  // A trial with no invoice owes nothing, whatever the dates say.
  const trial = billingSnapshot({
    subscription: { plan: 'BUSINESS', status: 'TRIAL', trialEndsAt: new Date(NOW.getTime() + 10 * DAY), currentPeriodEnd: null },
    openInvoice: null,
    hasPendingPayment: false,
    now: NOW,
  });
  assert.equal(overviewStatus(trial.access.state, trial.billing), 'TRIAL');
});

const ISSUED = new Date(NOW.getTime() - 5 * DAY);
const paymentRecord = (overrides: Partial<Parameters<typeof paymentTimeline>[0]['payments'][number]> = {}) => ({
  status: 'PENDING' as const,
  voidedAt: null,
  createdAt: new Date(NOW.getTime() - 2 * DAY),
  verifiedAt: null,
  rejectedAt: null,
  rejectReason: null,
  ...overrides,
});
const states = (steps: ReturnType<typeof paymentTimeline>) => steps.map((step) => `${step.key}:${step.state}`);

test('payment timeline: an unpaid invoice waits for a report, a pending one for review', () => {
  assert.deepEqual(states(paymentTimeline({ issuedAt: ISSUED, invoiceStatus: 'OPEN', paidAt: null, payments: [] })), [
    'ISSUED:done',
    'REPORTED:current',
    'REVIEW:upcoming',
    'DECISION:upcoming',
    'ACTIVATED:upcoming',
  ]);
  const pending = paymentTimeline({ issuedAt: ISSUED, invoiceStatus: 'OPEN', paidAt: null, payments: [paymentRecord()] });
  assert.deepEqual(states(pending), ['ISSUED:done', 'REPORTED:done', 'REVIEW:current', 'DECISION:upcoming', 'ACTIVATED:upcoming']);
  assert.equal(pending[0].at?.getTime(), ISSUED.getTime());
});

test('payment timeline: a rejection shows its reason, and only a paid invoice shows the plan as active', () => {
  const rejectedAt = new Date(NOW.getTime() - DAY);
  const rejected = paymentTimeline({
    issuedAt: ISSUED,
    invoiceStatus: 'OPEN',
    paidAt: null,
    payments: [paymentRecord({ status: 'REJECTED', rejectedAt, rejectReason: 'Reference not found.' })],
  });
  assert.deepEqual(states(rejected), ['ISSUED:done', 'REPORTED:done', 'REVIEW:done', 'DECISION:failed', 'ACTIVATED:upcoming']);
  assert.equal(rejected[3].reason, 'Reference not found.');

  // A newer pending report after a rejection is what counts; void reports are ignored.
  const retried = paymentTimeline({
    issuedAt: ISSUED,
    invoiceStatus: 'OPEN',
    paidAt: null,
    payments: [
      paymentRecord({ status: 'REJECTED', createdAt: new Date(NOW.getTime() - 3 * DAY), rejectedAt, rejectReason: 'x' }),
      paymentRecord({ createdAt: new Date(NOW.getTime() - DAY) }),
      paymentRecord({ status: 'VERIFIED', voidedAt: NOW, createdAt: NOW, verifiedAt: NOW }),
    ],
  });
  assert.deepEqual(states(retried), ['ISSUED:done', 'REPORTED:done', 'REVIEW:current', 'DECISION:upcoming', 'ACTIVATED:upcoming']);

  // A verified payment on an invoice not (yet) marked paid never shows the plan as active.
  const notPaid = paymentTimeline({
    issuedAt: ISSUED,
    invoiceStatus: 'OPEN',
    paidAt: null,
    payments: [paymentRecord({ status: 'VERIFIED', verifiedAt: NOW })],
  });
  assert.equal(notPaid[4].state, 'upcoming');

  const paid = paymentTimeline({
    issuedAt: ISSUED,
    invoiceStatus: 'PAID',
    paidAt: NOW,
    payments: [paymentRecord({ status: 'VERIFIED', verifiedAt: NOW })],
  });
  assert.ok(paid.every((step) => step.state === 'done'));
  assert.equal(paid[4].at?.getTime(), NOW.getTime());
});

test('payment report checks match the server rules and point at the field', () => {
  const now = new Date(2026, 9, 25, 15);
  const ok = { method: 'GCASH', reference: 'ABC12345', paidAt: '2026-10-25', notes: '' };
  assert.deepEqual(paymentReportProblems(ok, ['GCASH'], now), {});
  assert.ok(paymentReportProblems({ ...ok, method: 'OTHER' }, ['GCASH', 'BANK_TRANSFER'], now).method, 'only offered methods');
  assert.ok(paymentReportProblems({ ...ok, reference: ' 12 ' }, ['GCASH'], now).reference);
  assert.ok(paymentReportProblems({ ...ok, reference: 'x'.repeat(65) }, ['GCASH'], now).reference);
  assert.ok(paymentReportProblems({ ...ok, paidAt: '2026-10-26' }, ['GCASH'], now).paidAt, 'not in the future');
  assert.ok(paymentReportProblems({ ...ok, paidAt: '2026-07-27' }, ['GCASH'], now).paidAt, 'not more than 90 days ago');
  assert.deepEqual(paymentReportProblems({ ...ok, paidAt: '2026-07-28' }, ['GCASH'], now), {});
  assert.ok(paymentReportProblems({ ...ok, paidAt: '2026-02-30' }, ['GCASH'], now).paidAt, 'real dates only');
  assert.ok(paymentReportProblems({ ...ok, paidAt: '' }, ['GCASH'], now).paidAt);
  assert.ok(paymentReportProblems({ ...ok, notes: 'x'.repeat(501) }, ['GCASH'], now).notes);
});
