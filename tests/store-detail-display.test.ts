import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { storeAccess } from '@/lib/store-access';
import { actorRole, countdownText, historyKind, invoiceBadge, paymentBadge, periodCountdown } from '@/lib/store-detail-display';

const DAY = 86_400_000;
const NOW = new Date('2026-10-25T04:00:00Z');
const at = (days: number) => new Date(NOW.getTime() + days * DAY);

test('the countdown follows the store clock: trial, paid, grace, read-only, suspended', () => {
  const trial = periodCountdown(storeAccess({ plan: 'BUSINESS', status: 'TRIAL', trialEndsAt: at(13), currentPeriodEnd: null }, NOW), NOW);
  assert.deepEqual({ label: trial.label, days: trial.days, tone: trial.tone }, { label: 'Trial ends', days: 13, tone: 'info' });
  assert.equal(periodCountdown(storeAccess({ plan: 'BUSINESS', status: 'TRIAL', trialEndsAt: at(3), currentPeriodEnd: null }, NOW), NOW).tone, 'warning');

  const paid = periodCountdown(storeAccess({ plan: 'BASIC', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: at(20) }, NOW), NOW);
  assert.deepEqual({ label: paid.label, days: paid.days, tone: paid.tone }, { label: 'Paid through', days: 20, tone: 'success' });

  const grace = periodCountdown(storeAccess({ plan: 'BASIC', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: at(-2) }, NOW), NOW);
  assert.equal(grace.label, 'Read-only from');
  assert.equal(grace.tone, 'warning');
  assert.ok(grace.days !== null && grace.days > 0);

  const readOnly = periodCountdown(storeAccess({ plan: 'BASIC', status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: at(-30) }, NOW), NOW);
  assert.deepEqual({ days: readOnly.days, tone: readOnly.tone }, { days: null, tone: 'danger' });

  const suspended = periodCountdown(storeAccess({ plan: 'BASIC', status: 'SUSPENDED', trialEndsAt: null, currentPeriodEnd: at(30) }, NOW), NOW);
  assert.deepEqual({ label: suspended.label, days: suspended.days }, { label: 'Suspended', days: null });

  assert.equal(countdownText(null), null);
  assert.equal(countdownText(0), 'Ends today');
  assert.equal(countdownText(1), '1 day left');
  assert.equal(countdownText(12), '12 days left');
});

test('invoice badges: paid is never owing, void is neutral, an open one is open, past due, or awaiting verification', () => {
  assert.deepEqual(invoiceBadge({ status: 'PAID', dueAt: at(-10), hasPendingPayment: false }, NOW), { label: 'Paid', tone: 'success' });
  assert.deepEqual(invoiceBadge({ status: 'VOID', dueAt: at(-10), hasPendingPayment: false }, NOW), { label: 'Void', tone: 'neutral' });
  assert.deepEqual(invoiceBadge({ status: 'OPEN', dueAt: at(5), hasPendingPayment: false }, NOW), { label: 'Open', tone: 'warning' });
  assert.deepEqual(invoiceBadge({ status: 'OPEN', dueAt: at(-1), hasPendingPayment: false }, NOW), { label: 'Past due', tone: 'danger' });
  assert.deepEqual(invoiceBadge({ status: 'OPEN', dueAt: at(-1), hasPendingPayment: true }, NOW), { label: 'Payment to verify', tone: 'info' });
});

test('payment badges are distinct, and void wins over the review', () => {
  assert.deepEqual(paymentBadge({ status: 'PENDING', voidedAt: null }), { label: 'Pending', tone: 'warning' });
  assert.deepEqual(paymentBadge({ status: 'VERIFIED', voidedAt: null }), { label: 'Verified', tone: 'success' });
  assert.deepEqual(paymentBadge({ status: 'REJECTED', voidedAt: null }), { label: 'Rejected', tone: 'danger' });
  assert.deepEqual(paymentBadge({ status: 'VERIFIED', voidedAt: NOW }), { label: 'Void', tone: 'neutral' });
});

test('history entries name who acted relative to the store, and what kind of change it was', () => {
  const store = { id: 's1', ownerId: 'owner' };
  assert.equal(actorRole(null, store), 'SYSTEM');
  assert.equal(actorRole({ id: 'owner', storeId: 's1' }, store), 'OWNER');
  assert.equal(actorRole({ id: 'cashier', storeId: 's1' }, store), 'STAFF');
  assert.equal(actorRole({ id: 'admin', storeId: null }, store), 'ADMIN');
  assert.equal(actorRole({ id: 'other', storeId: 's2' }, store), 'ADMIN');

  assert.equal(historyKind({ entity: 'SubscriptionPayment', summary: 'Verified payment' }), 'PAYMENT');
  assert.equal(historyKind({ entity: 'Invoice', summary: 'Chose Business' }), 'INVOICE');
  assert.equal(historyKind({ entity: 'Store', summary: 'Changed plan from Basic to Business' }), 'PLAN');
  assert.equal(historyKind({ entity: 'Store', summary: 'Extended the trial by 7 days' }), 'STATUS');
});

test('the store page still requires platform.view, and changes still require platform.manage', () => {
  const page = readFileSync('src/app/(app)/system-admin/stores/[id]/page.tsx', 'utf8');
  assert.match(page, /requirePermission\('platform\.view'\)/);
  assert.match(page, /const canManage = userCan\(admin, 'platform\.manage'\)/);
  // Every change control is gated on canManage.
  for (const control of ['VoidInvoiceButton', 'VoidPaymentButton']) {
    for (const match of page.matchAll(new RegExp(`<${control}`, 'g'))) {
      const before = page.slice(Math.max(0, match.index! - 200), match.index);
      assert.match(before, /canManage &&/, `${control} must be behind canManage`);
    }
  }
  assert.match(page, /<StoreControls[^>]*canManage=\{canManage\}/);
});
